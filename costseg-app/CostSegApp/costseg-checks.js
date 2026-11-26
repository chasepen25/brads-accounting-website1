// Pre-delivery review: what a reviewer would ask, asked automatically.
import { CAT_BY_CSI, AREA_UNITS, money, pct, num } from "./costseg-engine.js";
/* ============================ REVIEW CHECKS ============================ */
// A last look before delivery. Each check is a question a reviewer would ask
// anyway; having the app ask first means nothing obvious reaches a client.
// A warning is not an error — several of these are fine once confirmed.

function runChecks(S, C) {
  const pass = [], warn = [];
  const o = S.overview;
  const ok = t => pass.push(t);
  const flag = (t, detail) => warn.push({ text: t, detail: detail || "" });

  /* --- the adjustment chain --- */
  if (C.totalAdjustedRs > 0) {
    if (C.deprAdj > 0.25 && C.deprAdj < 4)
      ok("Depreciation adjustment plausible (" + C.deprAdj.toFixed(4) + ")");
    else
      flag("Depreciation adjustment is " + C.deprAdj.toFixed(4),
        "Outside the range a normal study lands in. Check the SF model $/sqft, the square footage and the basis.");
  } else if (S.buildings.length) {
    flag("No SF model loaded", "Every estimated line adjusts to zero without one.");
  }

  /* --- square footage --- */
  const bSqft = S.buildings.reduce((a, g) => a + (+g.sqft || 0), 0);
  if (!S.buildings.length) flag("No buildings entered");
  else if (!+o.totalSqft) flag("Property square footage is blank");
  else if (Math.abs(bSqft - +o.totalSqft) <= Math.max(1, +o.totalSqft * 0.02))
    ok("Total sqft matches buildings");
  else
    flag("Property sqft (" + (+o.totalSqft).toLocaleString() + ") doesn't match the buildings ("
      + bSqft.toLocaleString() + ")", "Fine for a partial-building study; otherwise one of them is wrong.");

  /* --- dates --- */
  const yb = +o.yearBuilt || 0;
  const early = S.bases.filter(b => b.inServiceDate && yb && +b.inServiceDate.slice(0, 4) < yb);
  if (!S.bases.length) flag("No basis entered");
  else if (!early.length) ok("In-service dates \u2265 year built");
  else flag(early.length + " basis in service before the building was built");

  /* --- line hygiene --- */
  const own = C.lines.filter(l => !l.derived);
  const noQty = own.filter(l => !(l.qtyN > 0));
  const noCost = own.filter(l => !(l.unitCost > 0));
  if (!own.length) flag("No takeoff lines");
  else {
    if (!noQty.length) ok("Every estimated line has a quantity");
    else flag(noQty.length + " line(s) have no quantity", noQty.slice(0, 4).map(l => l.name).join(", "));
    if (!noCost.length) ok("All lines priced");
    else flag(noCost.length + " line(s) have no unit cost", noCost.slice(0, 4).map(l => l.name).join(", "));
  }

  /* --- duplicates: same item, same scope, same life --- */
  const seen = {};
  own.forEach(l => {
    const k = [l.csi || l.name, l.buildingId || "-", l.life].join("|");
    (seen[k] = seen[k] || []).push(l);
  });
  const dupes = Object.keys(seen).filter(k => seen[k].length > 1);
  if (dupes.length)
    flag(dupes.length + " item(s) entered more than once in the same scope/life",
      "Fine if intentional (separate areas) \u2014 check they are not accidental double counts.");
  else if (own.length) ok("No duplicate items in the same scope");

  /* --- exterior --- */
  S.sheets.forEach(sh => {
    if (!sh.img) return;
    if (!sh.scale) flag('Sheet "' + sh.name + '" has no scale set', "Lengths and areas read zero until it does.");
    else ok('Exterior sheet "' + sh.name + '" fully synced (' + sh.measurements.length + " measurements)");
  });

  /* --- flooring can't exceed the floor --- */
  const floor = own.filter(l => AREA_UNITS[l.unit]
    && /floor|carpet|tile|vinyl|linoleum|wood block|wood strip/i.test(l.name + " " + l.category))
    .reduce((a, l) => a + l.qtyN * AREA_UNITS[l.unit], 0);
  if (floor > 0 && +o.totalSqft) {
    if (floor <= +o.totalSqft * 1.02)
      ok("Flooring within property sqft (" + Math.round(floor).toLocaleString() + " of "
        + (+o.totalSqft).toLocaleString() + " S.F.)");
    else
      flag("Flooring exceeds the building (" + Math.round(floor).toLocaleString() + " of "
        + (+o.totalSqft).toLocaleString() + " S.F.)", "Usually a square-yard figure entered as square feet.");
  }

  /* --- provenance --- */
  const noSrc = S.bases.filter(b => !b.amountSource);
  const noLand = S.bases.filter(b => (b.landIsPct ? +b.land : +b.land) > 0 && !b.landSource);
  if (S.bases.length) {
    if (!noSrc.length) ok("Every basis amount has a source");
    else flag(noSrc.length + " basis amount(s) have no source", "Substantiation is the first thing an examiner asks for.");
    if (!noLand.length) ok("Land values sourced");
    else flag(noLand.length + " land value(s) have no source");
  }

  /* --- deliverables --- */
  if (S.__hasCover) ok("Cover photo uploaded"); else flag("No cover photo");
  if (o.visitType && o.inspector && o.visitDate) ok("Site visit recorded");
  else flag("Site visit incomplete", "Type, inspector and date are all ATG fields.");
  if (S.buildings.length && S.buildings.every(g => g.sfModel)) ok("SF model present");
  else if (S.buildings.length) flag("SF model missing on " + S.buildings.filter(g => !g.sfModel).length + " building(s)");

  /* --- electrical --- */
  const defaulted = S.buildings.filter(g => (C.elecByBuilding[g.id] || {}).defaulted);
  if (S.buildings.length && !defaulted.length) ok("Circuit survey recorded for every building");
  else if (defaulted.length)
    flag(defaulted.length + " building(s) using the default electrical split",
      "Defensible, but a dotted panel is stronger.");

  return { pass: pass, warn: warn };
}

/* ============================ JUDGMENT INVENTORY ============================ */
// Everything the preparer decided rather than the catalog deciding for them.
// This is what a reviewer wants to see, and what an examiner will ask about.
function judgmentInventory(S, C) {
  const items = [];
  const removed = (S.removedAuto || []).concat(Object.keys(S.autoOff || {}));
  if (removed.length) {
    const names = removed.map(k => {
      const c = CAT_BY_CSI[k];
      if (c) return { name: c.name, note: "site" };
      const l = S.lines.filter(x => x.csi === k)[0];
      return { name: l ? l.name : k, note: "auto" };
    });
    items.push({
      title: "Removed auto items", count: names.length,
      sub: "assembly companions this property doesn't have",
      rows: names.map(n => ({ label: n.name, note: "(" + n.note + ")" })),
    });
  }
  const overridden = S.lines.filter(l => l.override);
  if (overridden.length) items.push({
    title: "Overridden lines", count: overridden.length,
    sub: "unit cost or recovery life set by hand",
    rows: overridden.slice(0, 12).map(l => ({ label: l.name, note: l.life + "-yr \u00b7 " + money(l.unitCost, 2) })),
  });
  if (!S.settings.deprAdjUncapped && C.deprAdjRaw > 1.0001) items.push({
    title: "Depreciation adjustment capped", count: 1,
    sub: "computed " + C.deprAdjRaw.toFixed(4) + ", applied 1.0000",
    rows: [{ label: "Capped at 100%", note: "reduces segregated cost" }],
  });
  const bo = S.bases.filter(b => b.bonusOverride !== "" && b.bonusOverride != null);
  if (bo.length) items.push({
    title: "Bonus rate overridden", count: bo.length, sub: "set away from the federal date table",
    rows: bo.map(b => ({ label: b.name, note: b.bonusOverride + "%" })),
  });
  const custom = S.lines.filter(l => !l.csi && !l.auto);
  if (custom.length) items.push({
    title: "Custom lines", count: custom.length, sub: "not from the RS Means catalog",
    rows: custom.slice(0, 12).map(l => ({ label: l.name, note: money(l.unitCost, 2) + "/" + l.unit })),
  });
  const actual = S.lines.filter(l => l.source === "actual");
  if (actual.length) items.push({
    title: "Actual-cost lines", count: actual.length, sub: "invoiced, so unadjusted",
    rows: actual.slice(0, 12).map(l => ({ label: l.name, note: money(l.qtyN * l.unitCost, 2) })),
  });
  return items;
}

/* ============================ BENCHMARKS ============================ */
// Ranges from work already delivered — not IRS guidance. Outside the range means
// look, not wrong. Seeded thinly on purpose: these should come from your own
// delivered studies, which is why the panel says how many it is drawing on.
const BENCHMARK_SEED = {
  "Short-term Rental": {
    n: 0,
    segPct: [2.1, 36.0, 44.0], five: [1.4, 24.0, 37.0], seven: [0, 0, 0.7],
    fifteen: [0, 12.0, 32.0], perSqft: [85.81, 111.05, 186.55],
  },
};

function benchmarksFor(S, C) {
  const type = S.overview.propertyType;
  const corpus = (S.benchmarks && S.benchmarks[type]) || BENCHMARK_SEED[type] || null;
  const sqft = +S.overview.totalSqft || 0;
  const cls = life => {
    const u = C.units.filter(x => String(x.life) === String(life) && x.label !== "BUILDING")[0];
    return u && C.totalDepreciable ? u.amount / C.totalDepreciable * 100 : 0;
  };
  const mine = {
    segPct: C.segPct * 100,
    five: cls(5), seven: cls(7), fifteen: cls(15),
    perSqft: sqft ? C.totalSegregated / sqft : 0,
  };
  if (!corpus) return { corpus: null, mine: mine, type: type };
  const rows = [
    ["Segregated %", mine.segPct, corpus.segPct, "%"],
    ["5-Year %", mine.five, corpus.five, "%"],
    ["7-Year %", mine.seven, corpus.seven, "%"],
    ["15-Year %", mine.fifteen, corpus.fifteen, "%"],
    ["Segregated $/sqft", mine.perSqft, corpus.perSqft, "$"],
  ].map(r => ({
    label: r[0], value: r[1], low: r[2][0], median: r[2][1], high: r[2][2], unit: r[3],
    inRange: r[1] >= r[2][0] && r[1] <= r[2][2],
  }));
  return { corpus: corpus, rows: rows, mine: mine, type: type, n: corpus.n || 0 };
}


export { runChecks, judgmentInventory, benchmarksFor, BENCHMARK_SEED };
