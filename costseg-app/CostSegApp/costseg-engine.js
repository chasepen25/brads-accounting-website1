// Calculation engine and reference data. No interface code — this is the part
// that must be right, and it is the part validated against the ELR workbooks.
import { CAT_RAW, CCI_RAW } from "./costseg-data.js";

/* ============================ PARSE PINNED DATA ============================ */
const CCI = (() => {
  const byZip = {}, list = [];
  CCI_RAW.split("~").forEach(rec => {
    const p = rec.split("|");
    const e = { city: p[0], state: p[1], mat: +p[2], inst: +p[3], total: +p[4], zips: p[5].split(",") };
    list.push(e); e.zips.forEach(z => byZip[z] = e);
  });
  return { byZip, list };
})();

const CATALOG = CAT_RAW.split("~").map(rec => {
  const p = rec.split("|");
  return { csi: p[0], name: p[1], unit: p[2], op: +p[3], base: +p[4], desc: p[5] };
});
const CAT_BY_CSI = {}; CATALOG.forEach(c => CAT_BY_CSI[c.csi] = c);

// Many catalog items share a name and unit but come at several price points —
// sometimes a stated minimum/maximum, sometimes a different spec, class or
// capacity. Group them so a line can be switched between options without being
// re-entered. This is the quickest lever for pulling a study's segregated
// percentage down, since the cheaper option is often a defensible choice.
const VARIANTS = (() => {
  // "Cabinets Min" and "Cabinets Max" are the same item; so are two entries that
  // share a name outright. Normalise the name so both cases group together.
  const normName = n => String(n).toLowerCase()
    .replace(/\s*\b(min|max|minimum|maximum)\b\s*$/i, "").replace(/\s+/g, " ").trim();
  const groups = {};
  CATALOG.forEach(c => {
    const k = normName(c.name) + "|" + c.unit;
    (groups[k] = groups[k] || []).push(c);
  });
  const map = {};
  Object.keys(groups).forEach(k => {
    const g = groups[k];
    if (g.length < 2) return;
    if (g.every(c => c.op === g[0].op)) return;          // same price: nothing to choose
    const sorted = g.slice().sort((a, b) => a.op - b.op);

    // Stated minimum/maximum, in the name or the description?
    const isMin = c => /\bmin(imum)?\b/i.test(c.name) || /\bminimum\b/i.test(c.desc);
    const isMax = c => /\bmax(imum)?\b/i.test(c.name) || /\bmaximum\b/i.test(c.desc);
    const stated = sorted.length === 2 && sorted.some(isMin) && sorted.some(isMax);

    let labels;
    if (stated) {
      labels = sorted.map(c => (isMin(c) ? "Min" : "Max"));
    } else {
      // Label by whatever distinguishes the descriptions, once the shared opening is removed.
      let pre = sorted[0].desc;
      sorted.forEach(c => { while (pre && c.desc.indexOf(pre) !== 0) pre = pre.slice(0, -1); });
      const cut = Math.max(0, pre.lastIndexOf(",") + 1);
      labels = sorted.map(c => {
        let t = c.desc.slice(cut).replace(/^[,\s]+/, "").replace(/\u2026|\.\.\./g, "")
          .replace(/\s+/g, " ").trim();
        t = t.split(",").slice(0, 2).join(",").trim();
        return t.length > 30 ? t.slice(0, 29).trim() + "\u2026" : t;
      });
      // If that didn't actually separate them, fall back to position.
      const useless = labels.some(x => !x) || new Set(labels).size < labels.length;
      if (useless) labels = sorted.length === 2
        ? ["Min", "Max"]
        : sorted.map((c, i) => i === 0 ? "Lowest" : i === sorted.length - 1 ? "Highest" : "Option " + (i + 1));
    }

    const opts = sorted.map((c, i) => ({
      csi: c.csi, label: labels[i], op: c.op, unit: c.unit, name: c.name, desc: c.desc,
      edge: i === 0 ? "lowest" : (i === sorted.length - 1 ? "highest" : null),
    }));
    sorted.forEach(c => { map[c.csi] = { key: k, stated: stated, opts: opts, current: c.csi }; });
  });
  return map;
})();
const variantsFor = csi => VARIANTS[csi] || null;

/* ============================ REFERENCE TABLES ============================ */
const MACRS = {
  5: [20, 32, 19.2, 11.52, 11.52, 5.76],
  7: [14.29, 24.49, 17.49, 12.49, 8.93, 8.92, 8.93, 4.46],
  15: [5, 9.5, 8.55, 7.7, 6.93, 6.23, 5.9, 5.9, 5.91, 5.9, 5.91, 5.9, 5.91, 5.9, 5.91, 2.95],
};
const MM39_Y1 = [2.461, 2.247, 2.033, 1.819, 1.605, 1.391, 1.177, 0.963, 0.749, 0.535, 0.321, 0.107];
const MM275_Y1 = [3.485, 3.182, 2.879, 2.576, 2.273, 1.970, 1.667, 1.364, 1.061, 0.758, 0.455, 0.152];

function schedule(life, month) {
  if (MACRS[life]) return MACRS[life].slice();
  if (life === 39) {
    const y1 = MM39_Y1[month - 1], mid = 2.564;
    const out = [y1]; for (let i = 0; i < 38; i++) out.push(mid);
    out.push(Math.round((100 - y1 - 38 * mid) * 1000) / 1000);
    return out;
  }
  if (life === 27.5) {
    const y1 = MM275_Y1[month - 1], mid = 3.636;
    const out = [y1]; for (let i = 0; i < 26; i++) out.push(mid);
    out.push(Math.round((100 - y1 - 26 * mid) * 1000) / 1000);
    return out;
  }
  return [100];
}

// OBBBA: 100% bonus restored for property acquired after 2025-01-19.
function bonusRate(acqDateStr, override) {
  if (override != null && override !== "") return Math.max(0, Math.min(1, +override / 100));
  if (!acqDateStr) return 0;
  const d = new Date(acqDateStr + "T00:00:00");
  // Pre-TCJA acquisitions get no bonus (used property only became eligible 9/28/2017).
  if (d < new Date("2017-09-28T00:00:00")) return 0;
  if (d >= new Date("2025-01-20T00:00:00")) return 1;      // OBBBA restoration
  const y = d.getFullYear();
  const table = { 2017: 1, 2018: 1, 2019: 1, 2020: 1, 2021: 1, 2022: 1, 2023: 0.8, 2024: 0.6, 2025: 0.4 };
  return table[y] != null ? table[y] : 0;
}

const CATEGORIES = [
  "Counters & Cabinets", "Shelving", "Shelving/Paneling", "Break Room Sinks",
  "Wall Coverings and Blinds", "Appliances", "Surveillance/Security Cameras",
  "Flooring", "Special Plumbing & Sinks", "Telephone/Communications Equipment",
  "Electrical Distribution System", "Millwork & Trim", "Window Treatments",
  "Site Improvements", "Landscaping", "Paving & Sidewalks", "Fencing",
  "Signage", "Special Lighting", "Exterior Lighting", "Special HVAC",
  "Ceiling Fans", "Data/TV Equipment", "Furniture & Equipment", "Other Assets",
];
// Categories that count as site work rather than personal property.
const SITE_CATS = ["Site Improvements", "Landscaping", "Paving & Sidewalks", "Fencing", "Signage"];
const CAT_COLOR = {
  "Counters & Cabinets": "#9c5a2d", "Shelving": "#5d7488", "Shelving/Paneling": "#7d8fa0",
  "Break Room Sinks": "#3d7ea6", "Wall Coverings and Blinds": "#7a3b5f",
  "Appliances": "#9b2226", "Surveillance/Security Cameras": "#a4635e",
  "Flooring": "#2f4858", "Special Plumbing & Sinks": "#3c8dbc",
  "Telephone/Communications Equipment": "#b5726f", "Electrical Distribution System": "#39587a",
  "Millwork & Trim": "#8a6d4a", "Window Treatments": "#6d3b56", "Site Improvements": "#4a6b45",
  "Landscaping": "#3d7a3d", "Paving & Sidewalks": "#5f6368", "Fencing": "#7a7250",
  "Signage": "#7d4a78", "Other Assets": "#6b6b6b",
  "Special HVAC": "#8a9a4a", "Special Lighting": "#93861f", "Exterior Lighting": "#8f7d1c",
  "Land Improvements": "#55693f", "Data/TV Equipment": "#b5726f",
  "Concrete Swimming Pool": "#2b6b7a", "Ceiling Fans": "#4f7a6a",
  "Furniture & Equipment": "#6a5a8a",
};

// Recovery-class tint, used to band the life sections apart from each other.
const LIFE_TINT = {
  "5": { bg: "#eaf1fb", bar: "#2563eb", ink: "#14346e" },
  "7": { bg: "#eaf6ec", bar: "#16a34a", ink: "#14532d" },
  "15": { bg: "#fdf1e6", bar: "#ea7317", ink: "#7c3b06" },
  "QIP": { bg: "#f5edfc", bar: "#a855f7", ink: "#4c1d78" },
  "39": { bg: "#eef3f8", bar: "#5b9bd5", ink: "#1e3a5c" },
};

// One accent per tab, so the active tab and its content read as a place.
const TAB_COLOR = {
  "Overview": "#0f766e", "Bases": "#1d4ed8", "Takeoff": "#9c5a2d", "Exterior": "#3d7a3d",
  "Electrical": "#b45309", "Depr Adj": "#7c3aed", "Unit Cost Detail": "#0e7490",
  "Indirect Costs": "#b91c1c", "Depreciation Report": "#334155",
  "Summary Table": "#065f46", "Review & Deliver": "#1e40af",
};

// Overview cards, each with its own left edge so sections are findable by colour.
const CARD_ACCENT = {
  "Study team": "#0f766e", "Owner info": "#1d4ed8", "Property info": "#9c5a2d",
  "Tax info": "#b91c1c", "Site visit (ATG fields)": "#7c3aed",
};

// Stable per-item swatch color for the Exterior measurement list.
const SWATCH = ["#e8b23a", "#8b3a2e", "#2f9e4f", "#8b5cf6", "#ec4899", "#3b82f6", "#0ea5e9", "#f97316", "#14b8a6", "#a855f7"];
const swatchFor = key => SWATCH[Math.abs([...String(key)].reduce((a, c) => (a * 31 + c.charCodeAt(0)) | 0, 7)) % SWATCH.length];

// Items that always come with other items. Adding the parent creates these too,
// scaled by `mult` off the parent's quantity and converted where the units differ.
// unitFrom/unitTo let a companion priced in another unit take the same measurement
// (concrete measured in S.F. drives grading priced per S.Y., for instance).
const COMPANIONS = {
  // --- Sinks: every sink needs a faucet and a rough-in ---
  "224116162100": [{ csi: "224139101000", mult: 1 }, { csi: "224116164980", mult: 1 }],
  "224116162200": [{ csi: "224139101000", mult: 1 }, { csi: "224116164980", mult: 1 }],
  "224116163100": [{ csi: "224139101000", mult: 1 }, { csi: "224116164980", mult: 1 }],
  "224116163200": [{ csi: "224139101000", mult: 1 }, { csi: "224116164980", mult: 1 }],
  "224116163400": [{ csi: "224139101000", mult: 1 }, { csi: "224116164980", mult: 1 }],
  "224216165910": [{ csi: "224139101000", mult: 1 }, { csi: "224116164980", mult: 1 }],
  "224216165920": [{ csi: "224139101000", mult: 2 }, { csi: "224116164980", mult: 1 }],
  "224216165930": [{ csi: "224139101000", mult: 3 }, { csi: "224116164980", mult: 1 }],
  "224216165940": [{ csi: "224139101000", mult: 1 }, { csi: "224116164980", mult: 1 }],
  "224216406760": [{ csi: "224216406790", mult: 1 }],                    // mop sink -> floor rough-in
  "224136103100": [{ csi: "224136109600", mult: 1 }],                    // laundry sink -> rough-in
  "224216306036": [{ csi: "224116164980", mult: 1 }],                    // classroom sink -> rough-in

  // --- Concrete flatwork: gravel base, grading, and storm water on the same area ---
  "320610100400": [
    { csi: "320610100450", mult: 1 },                                     // concrete base, same S.F.
    { csi: "312216100012", mult: 1, unitFrom: "S.F.", unitTo: "S.Y." },   // fine grading, S.F./9
    { csi: "334233500030", mult: 1 },                                     // storm water, same S.F.
  ],
  "321216140020": [
    { csi: "312216100012", mult: 1, unitFrom: "S.F.", unitTo: "S.Y." },
    { csi: "334233500030", mult: 1 },
  ],
  "321216140055": [
    { csi: "312216100012", mult: 1, unitFrom: "S.F.", unitTo: "S.Y." },
    { csi: "334233500030", mult: 1 },
  ],
  "321416100200": [{ csi: "321416100540", mult: 1 }, { csi: "334233500030", mult: 1 }],
  "321416101500": [{ csi: "321416100540", mult: 1 }, { csi: "334233500030", mult: 1 }],
  "321313250020": [{ csi: "334233500030", mult: 9, unitFrom: "S.Y.", unitTo: "S.F." }],

  // --- Grass: irrigation and topsoil follow the sodded area ---
  // Grass is priced per M.S.F. (thousand S.F.), so the multiplier alone converts:
  // 1 M.S.F. = 1,000 S.F. of sprinklers = 111.11 S.Y. of topsoil.
  "329223101000": [
    { csi: "328423100900", mult: 1000 },        // underground sprinklers, S.F.
    { csi: "329119130800", mult: 1000 / 9 },    // topsoil, S.Y.
  ],
  "321813100200": [{ csi: "329119130800", mult: 1, unitFrom: "S.F.", unitTo: "S.Y." }],

  // --- Planting beds get topsoil ---
  "329113161200": [{ csi: "329119130800", mult: 1 }],
  "329113160100": [{ csi: "329119130800", mult: 1 }],
  "329113161900": [{ csi: "329119130800", mult: 1 }],

  // --- Light poles need foundations, and a luminaire per pole ---
  "265613102840": [{ csi: "107516107400", mult: 1 }, { csi: "265621202700", mult: 1 }],
  "265613102860": [{ csi: "107516107400", mult: 1 }, { csi: "265621202700", mult: 1 }],
  "265613103000": [{ csi: "107516107400", mult: 1 }, { csi: "265621202700", mult: 1 }],

  // --- Data and coax drops: box plus 120 ft of cable per outlet ---
  "271543130320": [{ csi: "260533160650", mult: 1 }, { csi: "271513137214", mult: 1.2 }],
  "271533103540": [{ csi: "271533103960", mult: 1.2 }],
  "271513132370": [{ csi: "260533160050", mult: 1 }, { csi: "271513132200", mult: 1.2 }],

  // --- Appliances that need plumbing ---
  "113013245000": [{ csi: "224139701980", mult: 1 }],                     // washer -> rough-in
  "113013172950": [{ csi: "224116164980", mult: 1 }],                     // dishwasher -> rough-in
  "113013183300": [{ csi: "224116164980", mult: 1 }],                     // disposal -> rough-in

  // --- The first camera brings the head-end system; later cameras don't ---
  "282313102600": [{ csi: "282313102400", mult: 1, once: true }],

  // --- Carpet always needs pad underneath, same square yardage ---
  "096816103100": [{ csi: "096810109000", mult: 1 }],   // carpet
  "096816103300": [{ csi: "096810109000", mult: 1 }],   // carpet sheets
  "096813101180": [{ csi: "096810109000", mult: 1 }],   // carpet tile

  // --- Fencing: a gate per run ---
  "323119105400": [{ csi: "323119106300", mult: 0 }],                     // suggested, qty set by user
};

// Property types treated as residential for the suggestion rules below.
const RESIDENTIAL_TYPES = [
  "Single dwelling unit - No land", "Townhome", "Single-Family Home", "Short-term Rental",
  "Small Multi-family", "Garden Apartments", "Walk-up Apartments", "Mid-rise Apartments",
  "High-rise Apartments", "Assisted Living",
  "Mixed-Use - multifamily & retail", "Mixed - Multifamily & Office",
];
const isResidential = t => RESIDENTIAL_TYPES.indexOf(String(t || "")) >= 0;

// Items a property almost certainly has, inferred from its type and vintage.
// Nothing is added without a click — the app just works out what to propose.
function suggestedItems(o) {
  const res = isResidential(o.propertyType);
  const yr = +o.yearBuilt || 0;
  const out = [];
  if (!res) return out;
  if (yr && yr >= 2006) {
    out.push({ csi: "271543130320", qty: 4, category: "Telephone/Communications Equipment", life: 5,
      why: "Residential built " + yr + " \u2014 structured wiring is standard from the mid-2000s" });
    out.push({ csi: "271533103540", qty: 2, category: "Telephone/Communications Equipment", life: 5,
      why: "Coaxial drops for cable/satellite" });
  } else if (yr && yr <= 2005) {
    out.push({ csi: "271513132370", qty: 4, category: "Telephone/Communications Equipment", life: 5,
      why: "Residential built " + yr + " \u2014 telephone jacks predate structured data wiring" });
    out.push({ csi: "271533103540", qty: 2, category: "Telephone/Communications Equipment", life: 5,
      why: "Coaxial drops for cable/satellite" });
  }
  out.push({ csi: "223430132060", qty: 1, category: "Special Plumbing & Sinks", life: 5,
    why: "Every residential unit has a water heater" });
  return out;
}

// One-click starter sets. Each entry adds a single unit; companions fire as usual,
// so the sink brings its faucet and rough-in along with it.
const PRESETS = {
  "Add Common Kitchen Items": [
    { csi: "113013172950", qty: 1, category: "Appliances", life: 5 },   // dishwasher
    { csi: "224116163100", qty: 1, category: "Special Plumbing & Sinks", life: 5 }, // single bowl SS sink
    { csi: "113013151250", qty: 1, category: "Appliances", life: 5 },   // microwave
    { csi: "113013150020", qty: 1, category: "Appliances", life: 5 },   // range
    { csi: "113013166150", qty: 1, category: "Appliances", life: 5 },   // fridge w/ ice maker
  ],
};

// Items billed by face area or volume but measured as a run on the ground —
// retaining walls, fences, enclosures. A height turns linear feet into the
// unit the catalog actually prices.
function needsHeight(cat) {
  if (!cat) return null;
  const u = cat.unit;
  const isFace = (u === "S.F." || u === "S.Y." || u === "SF Surf");
  const isVol = (u === "C.F." || u === "C.Y.");
  if (!isFace && !isVol) return null;
  const t = (cat.name + " " + cat.desc).toLowerCase();
  if (!/wall|fence|enclosure|partition|gabion|retaining|screen|parapet/.test(t)) return null;
  return { volume: isVol, unit: u };
}

// Catalog units that describe an area, so a quantity can be given as a share of
// the building's floor plate instead of a measured figure.
const AREA_UNITS = { "S.F.": 1, "S.Y.": 9, "C.S.F.": 100, "M.S.F.": 1000, "SF Flr.": 1, "SF Surf": 1, "SF Hor.": 1 };

// Scale a parent quantity into a companion's own unit of measure.
function companionQty(parentQty, c) {
  let q = parentQty * (c.mult == null ? 1 : c.mult);
  if (c.unitFrom && c.unitTo && c.unitFrom !== c.unitTo) {
    const div = { "S.F.>S.Y.": 9, "S.Y.>S.F.": 1 / 9, "S.F.>M.S.F.": 1000, "M.S.F.>S.F.": 1 / 1000,
                  "L.F.>C.L.F.": 100, "C.L.F.>L.F.": 1 / 100, "M.S.F.>S.Y.": 1 / 1 };
    const k = c.unitFrom + ">" + c.unitTo;
    if (div[k] != null) q = q / div[k];
  }
  return Math.round(q * 10000) / 10000;
}

const DEFAULT_RULES = [
  { desc: "Architectural Fees, for new construction, minimum", csi: "01113 110 0060", unit: "Project", pct: 4.9, base: "basis" },
  { desc: "Engineering Fees, electrical, minimum", csi: "01113 130 0200", unit: "Contract", pct: 4.1, base: "electrical" },
  { desc: "Engineering Fees, landscaping & site development, minimum", csi: "01113 130 0800", unit: "Contract", pct: 2.5, base: "site" },
  { desc: "Engineering Fees, mechanical (plumbing & HVAC), minimum", csi: "01113 130 1000", unit: "Contract", pct: 4.1, base: "mechanical" },
  { desc: "Engineering Fees, structural, minimum", csi: "01113 130 1200", unit: "Project", pct: 1.0, base: "basis" },
  { desc: "Permits Rule of Thumb, most cities, minimum", csi: "01412 650 0020", unit: "Job", pct: 0.5, base: "basis" },
  { desc: "Overhead & Profit, typical by size of project", csi: "01311 380 0300", unit: "%", pct: 30.0, base: "op" },
];

// Building subcomponents carved out of the 39-year remainder, proportional to the SF model.
const SUBCOMPONENTS = [
  { key: "plumbing", label: "Plumbing", csi: "171 010 2720" },
  { key: "hvac", label: "HVAC", csi: "171 010 2720" },
  { key: "fireProtection", label: "Fire Protection", csi: "171 010 2720" },
  { key: "roof", label: "Roof", csi: "B3010" },
];

/* ============================ HELPERS ============================ */
const uid = () => Math.random().toString(36).slice(2, 9);
// Life is carried by the dropdown on the line, so a "7yr " prefix on the name is
// redundant. Strip it from anything typed or carried over from an older study.
const cleanName = n => String(n || "").replace(/^\s*(5|7|15|20|27\.5|39)\s*[- ]?(yr|year)\.?\s+/i, "").trim();
const money = (n, d = 0) => (n == null || isNaN(n)) ? "—" :
  (n < 0 ? "-" : "") + "$" + Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
const pct = (n, d = 2) => (n == null || isNaN(n)) ? "—" : (n * 100).toFixed(d) + "%";
const num = (n, d = 2) => (n == null || isNaN(n)) ? "—" : n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
const fmtDate = s => { if (!s) return "—"; const p = s.split("-"); return (+p[1]) + "/" + (+p[2]) + "/" + p[0].slice(2); };
function evalQty(s) {
  if (typeof s === "number") return s;
  const t = String(s).replace(/[^0-9+\-*/.() ]/g, "");
  if (!t.trim()) return 0;
  try { const v = Function('"use strict";return (' + t + ")")(); return isFinite(v) ? v : 0; } catch (err) { return 0; }
}

// Convert a measured quantity into the catalog's billing unit.
function convertUnit(qty, measured, catUnit) {
  const c = (catUnit || measured || "").trim();
  if (c === measured) return { qty: qty, unit: c };
  if (measured === "S.F.") {
    if (c === "S.Y.") return { qty: qty / 9, unit: c };
    if (c === "M.S.F.") return { qty: qty / 1000, unit: c };
    if (c === "C.S.F.") return { qty: qty / 100, unit: c };
    if (c === "SF Surf" || c === "SF Hor." || c === "SF Flr." || c === "SF Shlf") return { qty: qty, unit: c };
  }
  if (measured === "L.F.") {
    if (c === "C.L.F.") return { qty: qty / 100, unit: c };
    if (c === "M.L.F.") return { qty: qty / 1000, unit: c };
    if (c === "V.L.F.") return { qty: qty, unit: c };
  }
  if (measured === "C.F." && c === "C.Y.") return { qty: qty / 27, unit: c };
  if (measured === "Ea." && c === "Pair") return { qty: qty / 2, unit: c };
  return { qty: qty, unit: c || measured };
}

// Geometry over normalized (0..1) points, scaled by feet-per-pixel.
function lineFeet(pts, ftPerPx, W, H) {
  let d = 0;
  for (let i = 1; i < pts.length; i++) {
    const dx = (pts[i].x - pts[i - 1].x) * W, dy = (pts[i].y - pts[i - 1].y) * H;
    d += Math.sqrt(dx * dx + dy * dy);
  }
  return d * ftPerPx;
}
function areaFeet(pts, ftPerPx, W, H) {
  if (pts.length < 3) return 0;
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length];
    a += (p.x * W) * (q.y * H) - (q.x * W) * (p.y * H);
  }
  return Math.abs(a / 2) * ftPerPx * ftPerPx;
}
// An auto line follows its parent's category unless it is clearly site work.
function guessCompanionCategory(name, parentCat) {
  const n = String(name || "").toLowerCase();
  if (/storm ?water|grading|topsoil|sprinkler|irrigat|base|bedding/.test(n)) {
    if (/topsoil|sprinkler|irrigat/.test(n)) return "Landscaping";
    if (/storm ?water|grading/.test(n)) return "Site Improvements";
    return "Paving & Sidewalks";
  }
  if (/foundation|luminaire/.test(n)) return "Site Improvements";
  return parentCat;
}

// Which takeoff category an item belongs to, from its name and RS Means wording.
// Ordered: the first rule that matches wins, so the specific beat the general.
const CATEGORY_RULES = [
  ["Electrical Distribution System", /electrical distribution|panelboard|breaker|switchgear|feeder/i],
  ["Surveillance/Security Cameras", /camera|cctv|closed circuit|surveillance|alarm|card reader/i],
  ["Telephone/Communications Equipment", /telephone|coaxial|data outlet|data box|utp|voice\/data|intercom|public address|speaker|sound cable|nurse call/i],
  ["Appliances", /refrigerat|freezer|microwave|oven|cooking range|cooktop|dishwasher|disposal|range hood|washer|dryer|laundry equipment|ice ?(cube )?maker|trash compactor|central vacuum/i],
  ["Break Room Sinks", /break ?room/i],
  ["Special Plumbing & Sinks", /sink|faucet|water heater|floor drain|trench drain|interceptor|rough-in|wash fountain|eyewash|cleanout|drain, floor/i],
  ["Flooring", /carpet|floating floor|resilient floor|vinyl (composition|sheet|tile)|linoleum|wood (block|strip) floor|access floor|rubber tile|marble flooring|travertine/i],
  ["Wall Coverings and Blinds", /blind|drapery|curtain|shade,|wall covering|wallpaper|shutter|slatwall|panel system|hardboard paneling/i],
  ["Window Treatments", /window treatment/i],
  ["Counters & Cabinets", /countertop|counter top|cabinet|casework|vanity|bar, built-in|back bar|front bar/i],
  ["Shelving/Paneling", /shelving|shelf|bookcase|pallet rack/i],
  ["Millwork & Trim", /molding|moldings|trim|chair rail|crown/i],
  ["Exterior Lighting", /luminaire|wall pack|floodlight|light pole|bollard light|exterior led|landscape lighting|parking led|roadway/i],
  ["Special Lighting", /incandescent fixture|pendent|pendant|chandelier|track lighting|sconce|high hat|fluorescent fixture|interior led/i],
  ["Ceiling Fans", /ceiling fan/i],
  ["Special HVAC", /exhaust hood|make-up air|fume exhauster|air curtain|condensing unit|rooftop air conditioner|window unit air|space heater|fan coil|chimney vent|ductwork|louver|roof exhauster/i],
  ["Landscaping", /shrub|tree|mulch|sod|sodding|topsoil|planting|irrigat|sprinkler|drip|landscape edging|artificial turf|grass/i],
  ["Paving & Sidewalks", /sidewalk|driveway|patio|asphalt|paving|paver|curb|gutter|grading|parking bumper|wheel stop|pavement marking|concrete pavement/i],
  ["Fencing", /fence|gate|gabion|retaining wall|bollard|railing/i],
  ["Signage", /\bsign\b|signage|pole sign|markerboard/i],
  ["Site Improvements", /storm ?water|site seating|park bench|flagpole|light pole|luminaire|wall pack|floodlight|exterior led|bollard light|landscape lighting|swimming pool|playground|tennis court|dock,|walkway cover|awning|canopy/i],
  ["Ceiling Fans", /ceiling fan/i],
  ["Special HVAC", /exhaust hood|make-up air|fume exhauster|air curtain|condensing unit|rooftop air conditioner|window unit air|space heater|fan coil|chimney vent|ductwork|louver|roof exhauster/i],
  ["Exterior Lighting", /exterior|roadway|parking led|street/i],
  ["Special Lighting", /incandescent fixture|pendent|pendant|chandelier|track lighting|sconce|high hat|fluorescent fixture|interior led|lamp/i],
  ["Data/TV Equipment", /coax|television|antenna/i],
  ["Furniture & Equipment", /hotel furniture|dormitory furniture|office furniture|restaurant furniture|wood tables|booths|mattress|library furniture|lockers|safes|teller window|scales|crane|hoist|lift|compressor|generator|dock (leveler|shelter|bumper|seal)|clean room|refrigeration room|checkout counter|projection screen|school equipment|movie equipment|fuel dispenser|parking (gate|equipment|control)|security (gate|vault)|partitions|chalkboard|mirrors|awnings, fabric/i],
  ["Site Improvements", /solar|photovoltaic|utility connection|trailer/i],
];
function categoryFor(item) {
  if (!item) return "Other Assets";
  const t = (item.name || "") + " " + (item.desc || "");
  for (let i = 0; i < CATEGORY_RULES.length; i++) if (CATEGORY_RULES[i][1].test(t)) return CATEGORY_RULES[i][0];
  return "Other Assets";
}

function guessCategory(name) {
  const n = String(name || "").toLowerCase();
  if (/asphalt|paving|concrete|curb|sidewalk|walk|stall|parking/.test(n)) return "Paving & Sidewalks";
  if (/tree|shrub|mulch|grass|sod|plant|landscap|irrigat|sprinkler/.test(n)) return "Landscaping";
  if (/fence|gate/.test(n)) return "Fencing";
  if (/sign/.test(n)) return "Signage";
  return "Site Improvements";
}



// Which everyday measuring unit feeds a given catalog billing unit, and the divisor.
const MEASURE_IN = {
  "S.Y.": { from: "S.F.", div: 9 },
  "C.S.F.": { from: "S.F.", div: 100 },
  "M.S.F.": { from: "S.F.", div: 1000 },
  "C.L.F.": { from: "L.F.", div: 100 },
  "M.L.F.": { from: "L.F.", div: 1000 },
  "C.Y.": { from: "C.F.", div: 27 },
  "Pair": { from: "Ea.", div: 2 },
  "SF Surf": { from: "S.F.", div: 1 },
  "SF Hor.": { from: "S.F.", div: 1 },
  "SF Flr.": { from: "S.F.", div: 1 },
  "SF Shlf": { from: "S.F.", div: 1 },
};

/* ============================ QUANTITY ROLLUP ============================ */
// Groups takeoff lines into families and totals quantities by unit of measure,
// so the operator can see what has been captured so far at a glance.
function familyOf(name, cat) { return cat || "Other Assets"; }

function rollup(lines) {
  const items = {}, units = {}, fams = {};
  lines.forEach(l => {
    const q = l.qtyN != null ? l.qtyN : evalQty(l.qty);
    const amt = l.total != null ? l.total : q * (l.unitCost || 0);
    const fam = familyOf(l.name, l.category);
    const k = fam + "|" + l.name + "|" + l.unit;
    if (!items[k]) items[k] = { fam: fam, name: l.name, unit: l.unit, qty: 0, amt: 0, rows: 0, lives: {} };
    items[k].qty += q; items[k].amt += amt; items[k].rows++; items[k].lives[l.life] = 1;
    if (!units[l.unit]) units[l.unit] = { qty: 0, amt: 0 };
    units[l.unit].qty += q; units[l.unit].amt += amt;
    if (!fams[fam]) fams[fam] = { qty: 0, amt: 0, rows: 0 };
    fams[fam].amt += amt; fams[fam].rows++;
  });
  const list = Object.keys(items).map(k => items[k]).sort((a, b) =>
    a.fam === b.fam ? b.amt - a.amt : (a.fam < b.fam ? -1 : 1));
  return { items: list, units: units, fams: fams };
}




/* ============================ PDF SITEMAPS ============================ */
// Sitemaps usually arrive as PDF — a Google Earth or county GIS export. The browser
// can't draw a PDF into an <img>, so page one is rendered to a canvas first and the
// canvas is used as the image. Everything downstream is unchanged.
let _pdfjs = null;
function loadPdfJs() {
  if (_pdfjs) return Promise.resolve(_pdfjs);
  const CDN = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.6.82/";
  return import("pdfjs-dist/build/pdf.mjs")
    .catch(() => import(/* @vite-ignore */ CDN + "pdf.min.mjs"))
    .then(mod => {
      const lib = mod.getDocument ? mod : (mod.default || mod);
      try { lib.GlobalWorkerOptions.workerSrc = CDN + "pdf.worker.min.mjs"; } catch (e) { }
      _pdfjs = lib;
      return lib;
    });
}

// Renders one page big enough to trace accurately without being unwieldy.
function renderPdfPage(file, pageNo, onDone, onError) {
  const rd = new FileReader();
  rd.onload = () => {
    loadPdfJs().then(pdfjs => {
      pdfjs.getDocument({ data: new Uint8Array(rd.result) }).promise.then(doc => {
        const n = Math.min(Math.max(1, pageNo || 1), doc.numPages);
        doc.getPage(n).then(page => {
          const base = page.getViewport({ scale: 1 });
          // Aim for ~2400px on the long edge; enough detail to click an edge cleanly.
          const scale = Math.min(4, Math.max(1.5, 2400 / Math.max(base.width, base.height)));
          const vp = page.getViewport({ scale: scale });
          const canvas = document.createElement("canvas");
          canvas.width = Math.round(vp.width); canvas.height = Math.round(vp.height);
          page.render({ canvasContext: canvas.getContext("2d"), viewport: vp }).promise.then(() => {
            onDone({
              url: canvas.toDataURL("image/png"),
              w: canvas.width, h: canvas.height,
              pages: doc.numPages, page: n,
            });
          }, onError);
        }, onError);
      }, onError);
    }, onError);
  };
  rd.onerror = onError;
  rd.readAsArrayBuffer(file);
}





// Your firm's identity. Everything branded in the app and the report reads from
// here, so there is one place to change when the letterhead changes.
const DEFAULT_FIRM = {
  name: "",                     // e.g. "Acme Cost Segregation"
  legalName: "",                // entity that certifies the study
  city: "", state: "",
  signerTitle: "Account Manager",
  certifierTitle: "Owner",
  engine: "",                   // optional build tag printed in the footer
};

/* ============================ SEED STUDY ============================ */
function seedStudy() {
  const yr = new Date().getFullYear();
  return {
    overview: {
      specialist: "", studyNumber: "", brand: "",
      taxpayer: "", addressee: "",
      street: "", city: "", state: "", zip: "",
      parcel: "", propertyType: "\u2014 choose \u2014", buildingLife: 39,
      totalSqft: "", acres: "", lotUnit: "AC", stories: "", yearBuilt: "",
      description: "", improvements: "",
      taxYear: yr, fyeMonth: 12, adsElection: false,
      visitType: "SV (In Person)", inspector: "", visitDate: "",
      carriedOver: "",
    },
    bases: [],
    buildings: [],
    lines: [],
    sheets: [{ id: "s1", name: "Sitemap", img: null, imgW: 0, imgH: 0, scale: null, measurements: [] }],
    removedAuto: [],
    autoOff: {},
    panels: [],
    actuals: [],
    rules: DEFAULT_RULES.map(r => Object.assign({}, r, { id: uid(), on: true })),
    settings: { modelQuality: "median", deprAdjUncapped: true, historical: 1, reconcile: 1, elecDefaultPct: 40 },
    documents: [],
    firm: Object.assign({}, DEFAULT_FIRM),
  };
}

/* ============================ EXTERIOR DERIVATION ============================ */
// Measurements of the same catalog item stack into one shared takeoff line.
function exteriorStacks(S) {
  const stacks = {};
  S.sheets.forEach(sh => {
    const ft = sh.scale ? sh.scale.ft / sh.scale.px : 0;
    const W = sh.imgW || 1000, H = sh.imgH || 1000;
    sh.measurements.forEach(m => {
      const cat = CAT_BY_CSI[m.csi];
      let raw = 0, measured = "Ea.";
      if (m.tool === "count") { raw = m.pts.length; measured = "Ea."; }
      else if (m.tool === "line") {
        const lf = ft ? lineFeet(m.pts, ft, W, H) : 0;
        const nh = needsHeight(cat);
        if (nh && m.height > 0) {
          // A wall drawn as a run: length x height gives the face area the catalog prices.
          raw = nh.volume ? lf * m.height * (m.thickness || 1) : lf * m.height;
          measured = nh.volume ? "C.F." : "S.F.";
        } else { raw = lf; measured = "L.F."; }
      }
      else { raw = ft ? areaFeet(m.pts, ft, W, H) : 0; measured = "S.F."; }
      const conv = convertUnit(raw, measured, cat ? cat.unit : null);
      const key = (m.csi || m.label) + "|" + m.life;
      if (!stacks[key]) stacks[key] = {
        key: key, csi: m.csi, name: (cat ? cat.name : m.label), life: m.life,
        unit: conv.unit, catUnit: cat ? cat.unit : measured, measured: measured,
        unitCost: cat ? cat.op : 0, qty: 0, parts: [],
        category: m.category || guessCategory(cat ? cat.name : m.label),
      };
      stacks[key].qty += conv.qty;
      stacks[key].parts.push({
        id: m.id, qty: conv.qty, tool: m.tool, measured: measured, raw: raw,
        runFt: m.tool === "line" && ft ? lineFeet(m.pts, ft, W, H) : null,
        height: m.height || null,
      });
    });
  });
  return Object.keys(stacks).map(k => stacks[k]);
}

// Site items implied by other takeoffs (storm water from impervious area, irrigation from grass).
function autoSiteItems(stacks, removed) {
  const out = [];
  const impervious = stacks.filter(s => /concrete|asphalt|paving|sidewalk/i.test(s.name) && s.measured === "S.F.")
    .reduce((a, s) => a + s.parts.reduce((x, p) => x + p.raw, 0), 0);
  if (impervious > 0) out.push({ id: "auto_storm", name: "Storm water Management", qty: impervious, unit: "S.F.", unitCost: 1.15, life: 15, category: "Site Improvements" });
  const grass = stacks.filter(s => /grass|sod|lawn|turf/i.test(s.name))
    .reduce((a, s) => a + s.parts.reduce((x, p) => x + p.raw, 0), 0);
  if (grass > 0) out.push({ id: "auto_irrig", name: "Sprinklers / drip irrigation", qty: grass, unit: "S.F.", unitCost: 1.42, life: 15, category: "Landscaping" });
  return out.filter(x => removed.indexOf(x.id) === -1);
}

/* ============================ ENGINE ============================ */
function compute(S) {
  const zip3 = String(S.overview.zip || "").slice(0, 3);
  const cci = CCI.byZip[zip3] || null;
  const location = cci ? cci.total / 100 : 1;
  const historical = S.settings.historical;
  const reconcile = S.settings.reconcile;

  const bases = S.bases.map(b => {
    const land = b.landIsPct ? (b.amount || 0) * (b.land || 0) / 100 : (b.land || 0);
    const depreciable = (b.adjustedBasis != null && b.adjustedBasis !== "")
      ? +b.adjustedBasis : (b.amount || 0) - land;
    return Object.assign({}, b, { landAmt: land, depreciable: depreciable });
  });
  const totalDepreciable = bases.reduce((a, b) => a + b.depreciable, 0);
  const totalCost = bases.reduce((a, b) => a + (b.amount || 0), 0);
  const totalLand = bases.reduce((a, b) => a + b.landAmt, 0);
  const primaryBasisId = bases[0] ? bases[0].id : null;

  const buildings = S.buildings.map(g => {
    const m = g.sfModel;
    const qk = S.settings.modelQuality;
    const rsPerSf = m ? (qk === "q1" ? m.q1 : qk === "q3" ? m.q3 : m.median) : 0;
    const modelTotal = rsPerSf * (g.sqft || 0);
    return Object.assign({}, g, { rsPerSf: rsPerSf, modelTotal: modelTotal, adjustedRs: modelTotal * location * historical * reconcile });
  });
  const totalAdjustedRs = buildings.reduce((a, g) => a + g.adjustedRs, 0);
  const deprAdjRaw = totalAdjustedRs > 0 ? totalDepreciable / totalAdjustedRs : 0;
  const deprAdj = S.settings.deprAdjUncapped ? deprAdjRaw : Math.min(1, deprAdjRaw);
  // Takeoff lines are national-average dollars, so they carry the location index.
  // SF-model lines are already local (location sits in the RCN denominator), so they don't.
  const adjFactor = historical * location * deprAdj;
  const adjFactorSF = historical * deprAdj;

  /* --- Electrical: amps split drives Electrical Distribution System lines --- */
  const elecByBuilding = {};
  const elecDefaultPct = S.settings.elecDefaultPct == null ? 40 : +S.settings.elecDefaultPct;
  buildings.forEach(g => {
    const panels = S.panels.filter(p => p.buildingId === g.id);
    let tally = { "5-Year": 0, "7-Year": 0, "15-Year": 0, "Building": 0 };
    panels.forEach(p => p.dots.forEach(d => { tally[d.life] += d.amps * (p.mult || 1); }));
    let total = tally["5-Year"] + tally["7-Year"] + tally["15-Year"] + tally["Building"];
    // No circuit survey recorded: fall back to the standard rule of thumb —
    // a set share to 5-year personalty, the remainder to the building.
    const defaulted = total === 0;
    if (defaulted) {
      tally = { "5-Year": elecDefaultPct, "7-Year": 0, "15-Year": 0, "Building": 100 - elecDefaultPct };
      total = 100;
    }
    const divs = g.sfModel ? g.sfModel.divisions : null;
    const elecTotal = (divs ? divs.electrical : 0) * (g.sqft || 0);
    elecByBuilding[g.id] = {
      tally: tally, total: total, elecTotal: elecTotal,
      panelCount: panels.length, defaulted: defaulted,
    };
  });

  const edsLines = [];
  Object.keys(elecByBuilding).forEach(gid => {
    const e = elecByBuilding[gid];
    if (!e.total || !e.elecTotal) return;
    [["5-Year", 5], ["7-Year", 7], ["15-Year", 15]].forEach(pair => {
      const share = e.tally[pair[0]] / e.total;
      if (share <= 0) return;
      edsLines.push({
        id: "eds_" + gid + "_" + pair[1], basisId: primaryBasisId, buildingId: gid,
        derived: e.defaulted ? "electrical-default" : "electrical",
        csi: "260533", name: "Electrical Distribution System", unit: "% of elec.",
        category: "Electrical Distribution System", life: pair[1], source: "estimated",
        qty: String(Math.round(share * 10000) / 100), unitCost: e.elecTotal / 100,
      });
    });
  });

  /* --- Exterior: sitemap measurements become takeoff lines --- */
  const stacks = exteriorStacks(S);
  const autos = autoSiteItems(stacks, S.removedAuto);
  const siteLines = stacks.map(s => ({
    id: "ext_" + s.key, basisId: primaryBasisId, buildingId: null, derived: "exterior",
    csi: s.csi, name: s.name, unit: s.unit, category: s.category, life: s.life,
    source: "estimated", qty: String(s.qty), unitCost: s.unitCost,
  })).concat(autos.map(a => ({
    id: "ext_" + a.id, basisId: primaryBasisId, buildingId: null, derived: "exterior-auto",
    csi: "", name: a.name, unit: a.unit, category: a.category, life: a.life,
    source: "estimated", qty: String(a.qty), unitCost: a.unitCost,
  })));

  /* --- Building subcomponents priced straight off the SF model (39-year) --- */
  const bldgLines = [];
  buildings.forEach(g => {
    const d = g.sfModel ? g.sfModel.divisions : null;
    if (!d) return;
    SUBCOMPONENTS.forEach(sc => {
      const rate = d[sc.key] || 0;
      if (rate <= 0) return;
      bldgLines.push({
        id: "bld_" + g.id + "_" + sc.key, basisId: primaryBasisId, buildingId: g.id, derived: "sfmodel",
        csi: sc.csi, name: sc.label, unit: "S.F.", category: sc.label, life: 39,
        source: "sfmodel", qty: String(g.sqft || 0), unitCost: rate,
      });
    });
    const e = elecByBuilding[g.id];
    const bShare = (e && e.total) ? e.tally["Building"] / e.total : 1;
    const elecRate = (d.electrical || 0) * bShare;
    if (elecRate > 0) bldgLines.push({
      id: "bld_" + g.id + "_eds", basisId: primaryBasisId, buildingId: g.id, derived: "sfmodel",
      csi: "171 010 2900", name: "Electrical Distribution System", unit: "S.F.",
      category: "Electrical Distribution System", life: 39,
      source: "sfmodel", qty: String(g.sqft || 0), unitCost: elecRate,
    });
  });

  // Derived items the operator has switched off don't count toward anything.
  const offMap = S.autoOff || {};
  const ownLines = S.lines.filter(l => !(l.auto && offMap[l.csi]));
  const allRaw = ownLines.concat(edsLines).concat(siteLines).concat(bldgLines);
  const lines = allRaw.map(l => {
    const qty = evalQty(l.qty);
    const total = qty * (l.unitCost || 0);
    const f = l.source === "actual" ? 1 : (l.source === "sfmodel" ? adjFactorSF : adjFactor);
    return Object.assign({}, l, { qtyN: qty, total: total, adjFactor: f, direct: total * f });
  });
  const takeoffUnadjusted = ownLines.reduce((a, l) => a + evalQty(l.qty) * (l.unitCost || 0), 0);
  const isSeg = l => l.life !== 39 && l.life !== 27.5;
  const directSegregated = lines.filter(isSeg).reduce((a, l) => a + l.direct, 0);
  const directBldgSub = lines.filter(l => !isSeg(l)).reduce((a, l) => a + l.direct, 0);

  /* --- Schedule C-1 --- */
  const div = buildings.reduce((acc, g) => {
    const d = g.sfModel ? g.sfModel.divisions : {};
    acc.electrical += (d.electrical || 0) * (g.sqft || 0);
    acc.mechanical += ((d.mechanical != null ? d.mechanical : (d.plumbing || 0) + (d.hvac || 0))) * (g.sqft || 0);
    acc.site += ((d.siteWork != null ? d.siteWork : (d.site || 0))) * (g.sqft || 0);
    return acc;
  }, { electrical: 0, mechanical: 0, site: 0 });

  // Site-development fee is charged on the segregated land improvements actually taken off;
  // the electrical and mechanical fees are charged on the unadjusted SF-model division costs.
  const site15 = lines.filter(l => l.life === 15).reduce((a, l) => a + l.direct, 0);
  const feeBase = { electrical: div.electrical, mechanical: div.mechanical, site: site15 };
  const ruleRows = S.rules.filter(r => r.on).map(r => {
    let base = 0;
    if (r.base === "basis") base = totalDepreciable;
    else if (r.base === "op") base = totalDepreciable / (1 + r.pct / 100);
    else base = feeBase[r.base] || 0;
    return Object.assign({}, r, { baseAmt: base, total: base * r.pct / 100 });
  });
  const estimatedPool = ruleRows.reduce((a, r) => a + r.total, 0);
  const documented = S.actuals.reduce((a, x) => a + (+x.amount || 0), 0);
  const pool = estimatedPool + documented;
  const lessIndirect = totalDepreciable - pool;
  const indirectRatio = lessIndirect > 0 ? pool / lessIndirect : 0;

  const lines2 = lines.map(l => {
    const indirect = l.direct * indirectRatio;
    return Object.assign({}, l, { indirect: indirect, grand: l.direct + indirect });
  });
  const indirectSegregated = lines2.filter(isSeg).reduce((a, l) => a + l.indirect, 0);
  const totalSegregated = directSegregated + indirectSegregated;
  const buildingResidual = lessIndirect - directSegregated;
  const indirectNonSeg = pool - indirectSegregated;
  const buildingAmt = buildingResidual + indirectNonSeg;
  const structureDirect = buildingResidual - directBldgSub;
  const structureRemainder = structureDirect + structureDirect * indirectRatio;

  const classes = {};
  lines2.filter(isSeg).forEach(l => {
    const k = String(l.life);
    if (!classes[k]) classes[k] = { life: k, direct: 0, indirect: 0, total: 0 };
    classes[k].direct += l.direct; classes[k].indirect += l.indirect; classes[k].total += l.direct + l.indirect;
  });

  /* --- Building subcomponents for the executive summary --- */
  const subMap = {};
  lines2.filter(l => !isSeg(l)).forEach(l => {
    if (!subMap[l.category]) subMap[l.category] = { label: l.category, amount: 0, direct: 0, indirect: 0, lines: [] };
    subMap[l.category].amount += l.grand; subMap[l.category].direct += l.direct;
    subMap[l.category].indirect += l.indirect; subMap[l.category].lines.push(l);
  });
  const subs = Object.keys(subMap).map(k => subMap[k]);
  if (structureRemainder > 0.5) subs.push({
    label: "Building Structure Remainder", amount: structureRemainder,
    direct: structureDirect, indirect: structureRemainder - structureDirect, lines: [],
  });

  /* --- Depreciation --- */
  const primary = bases[0] || {};
  const inSvc = primary.inServiceDate || (S.overview.taxYear + "-01-01");
  const svcYear = +inSvc.slice(0, 4), svcMonth = +inSvc.slice(5, 7);
  const bLife = +S.overview.buildingLife || 39;
  const bonus = S.overview.adsElection ? 0 : bonusRate(primary.acqDate, primary.bonusOverride);

  const units = [];
  [5, 7, 15].forEach(L => {
    const c = classes[L];
    if (c && c.total > 0.005) units.push({
      label: L + "-Year", life: L, amount: c.total, bonus: bonus, method: "200DB",
      conv: "HY", irc: "1245", ads: L === 5 ? 5 : (L === 7 ? 10 : 20),
    });
  });
  const qipAmt = classes["QIP"] ? classes["QIP"].total : 0;
  if (qipAmt > 0.005) units.push({ label: "QIP", life: 15, amount: qipAmt, bonus: bonus, method: "SL", conv: "HY", irc: "1250", ads: 20 });
  units.push({ label: "BUILDING", life: bLife, amount: buildingAmt, bonus: 0, method: "SL", conv: "MM", irc: "1250", ads: bLife === 39 ? 40 : 30 });

  const taxYear = +S.overview.taxYear;
  const yearsOut = 45;
  const byYear = [];
  for (let i = 0; i < yearsOut; i++) byYear.push({ year: svcYear + i, "5": 0, "7": 0, "15": 0, QIP: 0, BUILDING: 0, total: 0 });

  units.forEach(u => {
    const sch = schedule(u.life, (u.life === 39 || u.life === 27.5) ? svcMonth : 1);
    const bonusAmt = u.amount * u.bonus, rem = u.amount - bonusAmt;
    const key = u.label === "BUILDING" ? "BUILDING" : (u.label === "QIP" ? "QIP" : String(u.life));
    let allowed = 0; u.years = [];
    for (let i = 0; i < sch.length && i < yearsOut; i++) {
      let amt = rem * sch[i] / 100;
      if (i === 0) amt += bonusAmt;
      u.years.push(amt);
      if (byYear[i]) { byYear[i][key] += amt; byYear[i].total += amt; }
      if (svcYear + i < taxYear) allowed += amt;
    }
    u.allowedThrough = allowed;
    u.currentYear = u.years[taxYear - svcYear] || 0;
  });

  const totalAllowed = units.reduce((a, u) => a + u.allowedThrough, 0);
  const totalTaken = bases.reduce((a, b) => a + (+b.fedDeprTaken || 0), 0);
  units.forEach(u => {
    u.taken = totalAllowed > 0 ? totalTaken * (u.allowedThrough / totalAllowed) : 0;
    u.catchUp = u.allowedThrough - u.taken;
  });

  /* --- Schedule D detail rows: each class broken into its asset categories --- */
  const unitRows = [];
  units.forEach(u => {
    const isB = u.label === "BUILDING";
    const pool2 = lines2.filter(l => isB ? !isSeg(l) : String(l.life) === String(u.life));
    const byCat = {};
    pool2.forEach(l => { byCat[l.category] = (byCat[l.category] || 0) + l.grand; });
    const kids = Object.keys(byCat).map(c => ({ label: c.toUpperCase(), amount: byCat[c] }));
    if (isB && structureRemainder > 0.5) kids.push({ label: "BUILDING STRUCTURE", amount: structureRemainder });
    const sum = kids.reduce((a, k) => a + k.amount, 0);
    // Distribute the class's depreciation across its categories in proportion to amount.
    kids.forEach(k => {
      k.share = sum > 0 ? k.amount / sum : 0;
      k.currentYear = u.currentYear * k.share;
      k.allowedThrough = u.allowedThrough * k.share;
      k.taken = u.taken * k.share;
      k.catchUp = u.catchUp * k.share;
      k.assetClass = isB ? "—" : (u.life === 15 ? "00.3" : "57.0");
      k.method = isB ? "SL" : (u.life === 15 ? "150DB" : "200DB");
    });
    unitRows.push({ unit: u, kids: kids });
  });

  const warnings = [];
  buildings.forEach(g => { if (!g.sfModel) warnings.push(g.name + ": no SF model — upload the RS Means SF estimate export on the Takeoff tab."); });
  if (!cci) warnings.push("Zip " + (S.overview.zip || "(blank)") + " not found in the City Cost Index — location adjustment defaulted to 100%.");
  if (totalAdjustedRs === 0 && allRaw.length > 0 && buildings.length > 0)
    warnings.push("No building with an SF-model upload — RCN is $0, so the depreciation adjustment zeroes every estimated line.");
  S.sheets.forEach(sh => { if (sh.img && !sh.scale) warnings.push(sh.name + ": scale not set — line and area measurements read 0 until you set it."); });

  return {
    cci: cci, zip3: zip3, location: location, historical: historical, reconcile: reconcile,
    deprAdj: deprAdj, deprAdjRaw: deprAdjRaw, adjFactor: adjFactor,
    bases: bases, totalDepreciable: totalDepreciable, totalCost: totalCost, totalLand: totalLand,
    buildings: buildings, totalAdjustedRs: totalAdjustedRs,
    lines: lines2, takeoffUnadjusted: takeoffUnadjusted, directSegregated: directSegregated,
    indirectSegregated: indirectSegregated, totalSegregated: totalSegregated,
    ruleRows: ruleRows, estimatedPool: estimatedPool, documented: documented, pool: pool,
    lessIndirect: lessIndirect, indirectRatio: indirectRatio,
    buildingResidual: buildingResidual, indirectNonSeg: indirectNonSeg, buildingAmt: buildingAmt,
    subs: subs, classes: classes, units: units, unitRows: unitRows, byYear: byYear,
    adjFactorSF: adjFactorSF, structureRemainder: structureRemainder, structureDirect: structureDirect,
    bldgLines: bldgLines, directBldgSub: directBldgSub, site15: site15,
    catchUp: totalAllowed - totalTaken,
    hasPrior: (totalAllowed > 0.5 || totalTaken > 0.5),
    currentDeduction: units.reduce((a, u) => a + u.currentYear, 0),
    totalAllowed: totalAllowed, totalTaken: totalTaken,
    taxYear: taxYear, svcYear: svcYear, svcMonth: svcMonth, bonus: bonus, warnings: warnings,
    stacks: stacks, autos: autos, elecByBuilding: elecByBuilding, elecDefaultPct: elecDefaultPct, edsLines: edsLines, siteLines: siteLines,
    segPct: totalDepreciable > 0 ? totalSegregated / totalDepreciable : 0,
  };
}


/* ---- Property types, as they appear in the study dropdown ---- */
const PROPERTY_TYPES = [
  "— choose —",
  "Single dwelling unit - No land", "Townhome", "Single-Family Home", "Short-term Rental",
  "Small Multi-family", "Garden Apartments", "Walk-up Apartments", "Mid-rise Apartments",
  "High-rise Apartments", "Assisted Living",
  "Office Condo", "Inline Office Suite", "Office - Suburban", "Medical Office",
  "Low-rise Office Building", "Mid-rise Office Building", "Office - Central Business District",
  "Office - Park",
  "Inline/Endcap Retail Unit", "Retail - Out Parcel / standalone", "Retail - Strip/Shopping Center",
  "Retail - Community Retail Center", "Retail - Power Center",
  "Inline/Endcap Restaurant", "Retail - Restaurant",
  "Industrial - Light Assembly", "Industrial - Flex Warehouse", "Industrial - Bulk Warehouse",
  "Hotel - Light Service", "Hotel - Full Service", "Motel",
  "Special Purpose - Car Wash", "Special Purpose - Gas Station / Service Station",
  "Special Purpose - Auto Garage", "Special Purpose - Mobile Home Park",
  "Special Purpose - Trailer Park", "Special Purpose - Storage Facilities",
  "Special Purpose - Recreation Center",
  "Mixed-Use - multifamily & retail", "Mixed-Use - office & retail", "Mixed - Multifamily & Office",
];
// Building-system rows we look for inside an RS Means Square Foot Estimate export.
const SF_SYSTEMS = [
  { key: "siteWork", label: "Site Work", codes: ["01"], labels: ["site work", "sitework"] },
  { key: "foundation", label: "Foundation", codes: ["02"], labels: ["foundation", "substructure"] },
  { key: "framing", label: "Framing", codes: ["03"], labels: ["framing", "superstructure"] },
  { key: "exteriorWalls", label: "Exterior Walls", codes: ["04"], labels: ["exterior wall", "exterior closure", "shell"] },
  { key: "roof", label: "Roofing", codes: ["05"], labels: ["roofing", "roof"] },
  { key: "interiorFinishes", label: "Interiors", codes: ["06"], labels: ["interiors", "interior finish"] },
  { key: "specialties", label: "Specialties", codes: ["07"], labels: ["specialties", "equipment & furnishings"] },
  { key: "mechanical", label: "Mechanical", codes: ["08"], labels: ["mechanical"] },
  { key: "electrical", label: "Electrical", codes: ["09"], labels: ["electrical"] },
  { key: "plumbing", label: "Plumbing", codes: [], labels: ["plumbing"] },
  { key: "hvac", label: "HVAC", codes: [], labels: ["heating, ventilating", "hvac", "air conditioning"] },
  { key: "fireProtection", label: "Fire Protection", codes: [], labels: ["fire protection", "fire suppression", "sprinkler"] },
  { key: "elevators", label: "Elevators", codes: [], labels: ["elevator", "conveying"] },
];
// Reads an RS Means Square Foot Estimate export. The native layout puts a label in
// column A and its value in column B for the header block, then a division table
// where column G marks level (1 = division, 4 = component) and column E is $/S.F.
function parseSfModel(rows) {
  const asNum = c => {
    if (typeof c === "number") return isFinite(c) ? c : NaN;
    if (typeof c !== "string") return NaN;
    const t = c.replace(/[$,%\s]/g, "");
    return /^-?\d*\.?\d+$/.test(t) && t !== "" ? parseFloat(t) : NaN;
  };
  const txt = c => (c == null ? "" : String(c)).trim();
  const found = {}, divisions = [];
  let perSf = 0, area = 0, title = "", buildingType = "", release = "", stories = 0;
  let perSfWhere = "", areaWhere = "", buildingCost = 0;

  rows.forEach(r => {
    if (!r || !r.length) return;
    const a = txt(r[0]).toLowerCase(), b = r[1];
    const line = r.map(txt).join(" | ").toLowerCase();

    // Header block: "Label:" in column A, value in column B.
    if (/^cost per square foot/.test(a) || /^cost\/s\.?f/.test(a)) {
      const v = asNum(b); if (isFinite(v)) { perSf = v; perSfWhere = txt(r[0]); }
    }
    if (/^floor area|^building area|^gross area|^model area/.test(a)) {
      const v = asNum(b); if (isFinite(v)) { area = v; areaWhere = txt(r[0]); }
    }
    if (/^estimate name/.test(a)) title = txt(b);
    if (/^building type/.test(a)) buildingType = txt(b);
    if (/^data release/.test(a)) release = txt(b);
    if (/^story count/.test(a)) stories = asNum(b) || 0;
    if (/^building cost/.test(a)) { const v = asNum(b); if (isFinite(v)) buildingCost = v; }
    // "Total Building Cost" summary row carries $/S.F. in column E.
    if (/^total building cost/.test(a)) {
      const v = asNum(r[4]); if (isFinite(v) && !perSf) { perSf = v; perSfWhere = "Total Building Cost"; }
      const c = asNum(r[5]); if (isFinite(c) && !buildingCost) buildingCost = c;
    }

    // Division rows: level flag 1 in the last column, $/S.F. in column E.
    if (asNum(r[6]) === 1) {
      const code = txt(r[0]), name = txt(r[1]), costSf = asNum(r[4]), cost = asNum(r[5]);
      if (name && isFinite(costSf)) {
        divisions.push({ code: code, name: name, costSf: costSf, cost: isFinite(cost) ? cost : 0 });
        const sys = SF_SYSTEMS.filter(x =>
          x.codes.indexOf(code) >= 0 || x.labels.some(l => name.toLowerCase().indexOf(l) >= 0))[0];
        if (sys && found[sys.key] == null) found[sys.key] = costSf;
      }
    }
    // Fallback for exports without the level flag.
    if (!divisions.length) {
      SF_SYSTEMS.forEach(sys => {
        if (found[sys.key] != null) return;
        if (!sys.labels.some(l => line.indexOf(l) >= 0)) return;
        const n = r.map(asNum).filter(v => isFinite(v) && v > 0 && v < 400);
        if (n.length) found[sys.key] = n[0];
      });
    }
  });

  if (!perSf) {
    const all = [];
    rows.forEach(r => (r || []).forEach(c => { const v = asNum(c); if (isFinite(v) && v > 40 && v < 1500) all.push(v); }));
    if (all.length) perSf = all.sort((x, y) => y - x)[0];
  }
  return {
    perSf: perSf, area: area, title: title, buildingType: buildingType, release: release,
    stories: stories, buildingCost: buildingCost, divisions: found, divisionRows: divisions,
    perSfWhere: perSfWhere, areaWhere: areaWhere, rowCount: rows.length,
  };
}
// Flattens a workbook to rows for the parser, and keeps a text preview for diagnosis.
function sheetRows(wb) {
  let rows = [], preview = [];
  wb.SheetNames.forEach(n => {
    const r = XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, blankrows: false, raw: true });
    rows = rows.concat(r);
    r.slice(0, 60).forEach(x => {
      const line = (x || []).map(c => (c == null ? "" : String(c))).join(" | ").trim();
      if (line.replace(/\|/g, "").trim()) preview.push(n + ": " + line);
    });
  });
  return { rows: rows, preview: preview };
}

export {
  PROPERTY_TYPES, SF_SYSTEMS, parseSfModel, sheetRows,
  CCI, CATALOG, CAT_BY_CSI, VARIANTS, MACRS, MM39_Y1,
  MM275_Y1, schedule, bonusRate, CATEGORIES, SITE_CATS, CAT_COLOR,
  LIFE_TINT, TAB_COLOR, CARD_ACCENT, SWATCH, swatchFor, COMPANIONS,
  companionQty, DEFAULT_RULES, SUBCOMPONENTS, MEASURE_IN, AREA_UNITS, CATEGORY_RULES,
  categoryFor, needsHeight, RESIDENTIAL_TYPES, isResidential, suggestedItems, PRESETS,
  DEFAULT_FIRM, familyOf, rollup, uid, money, pct,
  num, fmtDate, evalQty, cleanName, convertUnit, lineFeet,
  areaFeet, guessCategory, guessCompanionCategory, loadPdfJs, renderPdfPage, seedStudy,
  exteriorStacks, autoSiteItems, compute,
};
