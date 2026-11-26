// Report generator. Builds the deliverable as a self-contained HTML document and
// hands it to the browser's print dialog, where "Save as PDF" produces the file.
import { CAT_BY_CSI, SITE_CATS, money, pct, num, fmtDate } from "./costseg-engine.js";
/* ============================ REPORT GENERATOR ============================ */
// Produces the same document every time: a fixed sequence of sections, every
// schedule always present (empty ones say so), deterministic page breaks, and
// a table of contents whose page numbers are read back out of the built pages.

const RPT_CSS = `
@page { size: letter; margin: 0.75in 0.8in 0.7in 0.8in; }
* { box-sizing: border-box; }
body { font-family: 'Times New Roman', Times, Georgia, serif; font-size: 10.5pt; color: #1a1a1a; margin: 0; line-height: 1.5; }
.page { page-break-after: always; position: relative; min-height: 9.05in; padding-bottom: 26pt; }
.page:last-child { page-break-after: auto; }
h1 { font-family: Helvetica, Arial, sans-serif; font-size: 30pt; font-weight: 800; color: #1668e3; margin: 0 0 18pt; letter-spacing: -0.5pt; }
h2 { font-family: Helvetica, Arial, sans-serif; font-size: 13pt; font-weight: 700; letter-spacing: 1.2pt; text-transform: uppercase; margin: 0 0 3pt; }
h3 { font-family: Helvetica, Arial, sans-serif; font-size: 11pt; font-weight: 700; margin: 16pt 0 5pt; }
h4 { font-size: 11pt; font-weight: 700; margin: 13pt 0 4pt; font-style: italic; }
.brand { font-family: Helvetica, Arial, sans-serif; font-size: 11pt; letter-spacing: 2.4pt; margin-bottom: 52pt; }
.brand b { font-weight: 800; }
.brand span { color: #7b7b7b; font-weight: 600; }
.eyebrow { font-family: Helvetica, Arial, sans-serif; font-size: 8.5pt; letter-spacing: 1.6pt; color: #7b7b7b; text-transform: uppercase; font-weight: 700; margin-bottom: 4pt; }
.owner { font-family: Helvetica, Arial, sans-serif; font-size: 15pt; font-weight: 800; margin: 0 0 3pt; }
.addr { font-size: 11.5pt; margin-bottom: 3pt; }
.date { color: #8a8a8a; font-size: 10pt; }
.cover-photo { margin-top: 34pt; background: #f4f4f4; border-radius: 10pt; padding: 12pt; }
.cover-photo img { width: 100%; max-height: 4.2in; object-fit: cover; display: block; border-radius: 4pt; }
.cover-ph { margin-top: 34pt; background: #f4f4f4; border: 0.75pt dashed #cfcfcf; border-radius: 10pt;
  height: 3.1in; display: flex; align-items: center; justify-content: center; color: #aaa;
  font-family: Helvetica, Arial, sans-serif; font-size: 9pt; letter-spacing: 1pt; text-transform: uppercase; }
.runhead { display: flex; justify-content: space-between; font-family: Helvetica, Arial, sans-serif; font-size: 8.5pt;
  letter-spacing: 1.4pt; text-transform: uppercase; color: #666; border-bottom: 0.5pt solid #ccc;
  padding-bottom: 5pt; margin-bottom: 16pt; font-weight: 700; }
.toc ul { padding: 0; margin: 0; }
.toc li { display: flex; justify-content: space-between; padding: 4.5pt 0; border-bottom: 0.5pt dotted #d5d5d5; list-style: none; }
.toc .ind { padding-left: 16pt; color: #555; }
table { width: 100%; border-collapse: collapse; font-size: 8.7pt; font-variant-numeric: tabular-nums; margin: 7pt 0; }
th { font-family: Helvetica, Arial, sans-serif; font-size: 6.6pt; letter-spacing: 0.5pt; text-transform: uppercase;
  color: #666; font-weight: 700; text-align: left; padding: 5pt 4pt; border-bottom: 0.75pt solid #333; vertical-align: bottom; }
td { padding: 4pt; border-bottom: 0.4pt solid #e8e8e8; vertical-align: top; }
.r { text-align: right; }
tr.sect td { background: #efefef; font-family: Helvetica, Arial, sans-serif; font-size: 7.2pt; font-weight: 700;
  letter-spacing: 0.8pt; text-transform: uppercase; padding: 4pt; }
tr.cat td { font-family: Helvetica, Arial, sans-serif; font-size: 7pt; font-weight: 700; letter-spacing: 0.6pt;
  text-transform: uppercase; color: #555; padding-top: 7pt; border-bottom: none; }
tr.tot td { font-weight: 700; border-top: 0.75pt solid #333; border-bottom: 0.75pt solid #333; background: #fafafa; }
tr.sub td { font-weight: 700; border-top: 0.5pt solid #999; }
td.empty { color: #999; font-style: italic; padding: 9pt 4pt; }
.kpis { display: flex; gap: 10pt; margin: 12pt 0 16pt; }
.kpi { flex: 1; border: 0.5pt solid #ddd; border-radius: 6pt; padding: 10pt 12pt; text-align: center; }
.kpi .l { font-family: Helvetica, Arial, sans-serif; font-size: 6.8pt; letter-spacing: 1pt; text-transform: uppercase; color: #7b7b7b; font-weight: 700; }
.kpi .v { font-family: Helvetica, Arial, sans-serif; font-size: 17pt; font-weight: 800; margin-top: 3pt; }
.divider { background: #1668e3; color: #fff; padding: 1.9in 0.55in 0.5in; }
.divider .part { font-family: Helvetica, Arial, sans-serif; font-size: 9pt; letter-spacing: 5pt; opacity: 0.85; }
.divider .t { font-family: Helvetica, Arial, sans-serif; font-size: 40pt; font-weight: 800; line-height: 1.02; margin: 14pt 0 20pt; letter-spacing: -1pt; }
.divider .s { font-size: 11pt; opacity: 0.92; }
dl.facts { margin: 0; }
dl.facts > div { display: flex; justify-content: space-between; padding: 4.5pt 0; border-bottom: 0.4pt solid #e8e8e8; }
dl.facts dt { color: #555; margin: 0; }
dl.facts dd { margin: 0; font-weight: 600; text-align: right; }
p { margin: 0 0 8pt; text-align: justify; }
ul.plain, ol.plain { margin: 0 0 9pt; padding-left: 15pt; }
ul.plain li, ol.plain li { margin-bottom: 3.5pt; }
.sig { font-family: 'Brush Script MT', 'Segoe Script', cursive; font-size: 19pt; margin: 16pt 0 1pt; }
.fn { font-size: 7.6pt; color: #777; margin-top: 6pt; line-height: 1.45; }
blockquote { margin: 8pt 0 8pt 16pt; padding-left: 11pt; border-left: 2pt solid #ddd; font-style: italic; color: #333; }
.footer { position: absolute; bottom: 6pt; left: 0; right: 0; font-family: Helvetica, Arial, sans-serif;
  font-size: 6.8pt; letter-spacing: 1pt; color: #999; text-transform: uppercase; text-align: center; }
.pageno { position: absolute; bottom: 6pt; right: 0; font-family: Helvetica, Arial, sans-serif; font-size: 7.5pt; color: #999; }
.divider .footer, .divider .pageno { color: rgba(255,255,255,0.65); }
`;

function esc(x) {
  return String(x == null ? "" : x).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
}
const M0 = n => money(n, 0);











/* ---- Canonical section order. Never varies between studies. ---- */
const SECTIONS = [
  "Executive Summary", "Certification", "Subject Property", "Property Overview",
  "Schedule A \u2014 Schedule of Assets", "Property Units & Costs",
  "Schedule B \u2014 Depreciable Unit Costs", "Schedule C \u2014 Indirect Costs Detail & Allocation",
  "Schedule D \u2014 Unit Summary and Federal Depreciation Schedule", "Methodology & Procedures",
  "Statement of Assumptions and Limiting Conditions", "Classification of \u00a71245 and \u00a71250 Property",
  "Justifications for Asset Reclassifications", "Appendix A \u2014 Workpapers",
  "Appendix B \u2014 AMT Depreciation Schedule",
];

/* ---- Canonical justification blocks, always emitted in this order. ---- */
const JUSTIFICATIONS = [
  { group: "Cabinets, Counters, & Shelving",
    cats: ["Counters & Cabinets", "Shelving", "Shelving/Paneling", "Millwork & Trim"],
    text: "Cabinets, counters, and shelving are easily removable and therefore qualify as tangible personal property. These items qualify as tangible personal property because they meet the definition in Reg. Sec. 1.48-1(c). The Senate Finance Committee Report on the Revenue Act of 1978 identified similar items such as booths for seating and beverage bars, as tangible personal property. In Metro National Corp. v. Commissioner, No. 33279-84, TCM 1987-38, cabinets were found to be tangible personal property. The cabinets were easily movable and there was no damage to the cabinets or to the building structure. In Morrison Inc. v. Commissioner, No. 34300-83, TCM 1986-129, the court disallowed vanity cabinets and counters in public restrooms; however, those items were disallowed because they were considered a necessary part of the public restrooms and were attached such that removal would damage the underlying walls. The subject cabinets, counters, and shelving are not permanently attached to the walls and are not necessary in the operation and maintenance of the building. Rev. Rul. 75-178, 1975-1 C.B. 9 concludes tangible personal property based on (1) the manner of attachment and (2) the degree of permanence." },
  { group: "Furniture, Fixtures, & Equipment",
    cats: ["Appliances", "Surveillance/Security Cameras", "Telephone/Communications Equipment", "Other Assets"],
    text: "Furniture, fixtures, and equipment necessary to the primary business operations qualifies as tangible personal property. Commonly identified items include appliances, data/TV and telephone wiring, ceiling fans, PA systems, overhead speakers, loading dock equipment, interior bollards, and Eliason doors. These items qualify as 5-year equipment under the class lives set forth in Rev. Proc. 87-56 due to their integral part in the process of the distributive trade or business. Telephone wiring, connections, and equipment qualifies as 7-year property. These items qualify as tangible personal property based on (1) the manner of attachment and (2) the degree of permanence as outlined in Rev. Rul. 75-178, 1975-1 C.B. 9. These items have no relationship to the operation or maintenance of the building. See also Reg. Sec. 1.48-1(c); Rev. Rul. 65-079, 1965-1 C.B. 26; and Rev. Rul. 80-151, 1980-1 C.B. 7." },
  { group: "Plumbing Service for Personal Property",
    cats: ["Special Plumbing & Sinks", "Break Room Sinks"],
    text: "Certain plumbing items are necessary to the course of business and/or for the use of equipment. Floor drains, washer/dryer rough-ins, and grease interceptors qualify as tangible personal property. These special plumbing items qualify as 5-year property. These items are not to be considered structural components, as they do not relate to the operations of the building. Rather, the subject piping and plumbing equipment serve qualified \u00a71245 property and therefore qualifies as tangible personal property. This conclusion is supported by Rev. Rul. 66-299, 1966-2 C.B. 14, which states that \u201cspecial plumbing connections which are necessary to and are used directly with a specific item of machinery or equipment, or between specific items of individual machinery or equipment, are not deemed structural components of the building, but are essentially items of machinery or equipment, and qualify as \u00a71245 property.\u201d In Hospital Corporation of America v. Commissioner, 109 T.C. No. 2 (1997), plumbing connections to personal property was eligible as \u00a71245 property. In Duaine v. Commissioner, No. 12330-82, TCM 1985-39, plumbing and gas fixtures that connected equipment to incoming utility company \u201cstubouts\u201d qualified because they were necessary to and used directly with specific pieces of equipment." },
  { group: "Floor & Wall Coverings",
    cats: ["Flooring", "Wall Coverings and Blinds", "Window Treatments"],
    text: "As discussed in Hospital Corporation of America v. Commissioner, 109 T.C. No. 2 (1997) and Rev. Rul. 67-349, 1967-2 C.B. 48, floor and wall coverings installed in a manner so as not to be a permanent covering of the floor or wall qualify as tangible personal property. These rulings held that if the floor or wall coverings are not an integral part of the floor or wall, they could not be considered a structural component of the building. The coverings reflected in this report are not integral parts, nor permanent coverings, of the structural components of the building; they can be removed without sustaining damage and without affecting the structural integrity of the building." },
  { group: "Electrical Distribution for Personal Property",
    cats: ["Electrical Distribution System"],
    text: "Electrical distribution serving \u00a71245 property is itself \u00a71245 property. In Hospital Corp. of America v. Commissioner, 109 T.C. 21 (1997), the court held that branch circuits and related wiring dedicated to items of personal property are not structural components of the building. The allocation applied in this Study is derived from a circuit-level survey of each panel, in which every breaker was recorded and assigned to the load it serves; the resulting amperage shares determine the portion of the building\u2019s electrical system allocated to each recovery period." },
  { group: "Land Improvements",
    cats: ["Site Improvements", "Landscaping", "Paving & Sidewalks", "Fencing", "Signage"],
    text: "Land improvements are assigned a 15-year recovery period under Asset Class 00.3 of Rev. Proc. 87-56, which describes land improvements as depreciable improvements made directly to or added to land. This class includes sidewalks, driveways, parking areas, curbing, fencing, landscaping, site drainage, and exterior lighting. Whether such improvements are \u00a71245 or \u00a71250 property is inconsequential given that Asset Class 00.3 governs the recovery period in either case." },
];

function buildReport(S, C, opts) {
  const o = S.overview;
  const addr = o.street + ", " + o.city + ", " + o.state + " " + o.zip;
  const shortAddr = String(o.street || "").toUpperCase();
  const today = new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
  const b0 = C.bases[0] || {};
  const inSvc = fmtDate(b0.inServiceDate);

  // Fixed page registry. Order never varies; the TOC reads its numbers from here.
  const P = [];
  const add = (body, tocLabel, indent) => P.push({ body: body, toc: tocLabel || null, indent: !!indent });
  const runhead = t => '<div class="runhead"><span>' + esc(t) + '</span><span>' + esc(shortAddr) + '</span></div>';
  const firm = S.firm || {};
  const FNAME = firm.name || o.brand || "COST SEGREGATION";
  const FLEGAL = firm.legalName || firm.name || "the firm";
  const FPLACE = [firm.city, firm.state].filter(Boolean).join(", ");
  const foot = [FLEGAL.toUpperCase(), FPLACE.toUpperCase(), "STUDY " + esc(o.studyNumber),
    firm.engine ? "ENGINE " + esc(firm.engine) : ""].filter(Boolean).join(" &middot; ");

  // Deterministic chunking: schedules break at a fixed row budget rather than
  // wherever a given browser happens to run out of vertical space.
  const ROWS_PER_PAGE = 30;
  function paginate(rowObjs) {
    const out = []; let cur = [], w = 0;
    rowObjs.forEach(r => {
      const rw = r.w || 1;
      if (w + rw > ROWS_PER_PAGE && cur.length) { out.push(cur); cur = []; w = 0; }
      cur.push(r.h); w += rw;
    });
    if (cur.length) out.push(cur);
    return out.length ? out : [[]];
  }

  /* ---------- Cover ---------- */
  add('<div class="page">'
    + '<div class="brand">' + esc(FNAME.toUpperCase()) + '</div>'
    + '<h1>COST SEGREGATION REPORT</h1>'
    + '<div class="eyebrow">Prepared for</div>'
    + '<div class="owner">' + esc(o.taxpayer || "Owner") + '</div>'
    + '<div class="addr">' + esc(addr) + '</div>'
    + '<div class="date">' + today + ' &middot; Tax Year ' + esc(o.taxYear) + '</div>'
    + (opts.coverPhoto
      ? '<div class="cover-photo"><img src="' + opts.coverPhoto + '"></div>'
      : '<div class="cover-ph">Cover photograph</div>')
    + '</div>');

  /* ---------- TOC placeholder, filled after pagination ---------- */
  const TOC_INDEX = P.length;
  add("__TOC__");

  /* ---------- Executive summary ---------- */
  const classRows = C.units.length
    ? C.units.map(u => '<tr><td>' + esc(u.label === "BUILDING" ? "Building" : u.label + " Property")
      + '</td><td class="r">' + u.life + '</td><td class="r">' + M0(u.amount) + '</td><td class="r">'
      + pct(u.amount / C.totalDepreciable) + '</td></tr>').join("")
    : '<tr><td colspan="4" class="empty">No asset classes computed.</td></tr>';
  add('<div class="page">' + runhead("Executive Summary")
    + '<div class="date" style="margin-bottom:14pt">' + today + '</div>'
    + '<div style="margin-bottom:14pt"><b>' + esc(o.taxpayer || "Owner") + '</b><br>' + esc(o.city + ", " + o.state) + '</div>'
    + '<p>Dear ' + esc(o.addressee || o.taxpayer || "Owner") + ':</p>'
    + '<p>We write to announce the completion of our engagement to perform a cost segregation study for the '
    + esc(o.taxYear) + ' tax year for ' + esc(o.taxpayer) + ' ("Owner"). The purpose of our investigation was to provide '
    + 'correct MACRS classifications for the fixed assets located at ' + esc(addr) + ' ("Property"). We have enclosed a '
    + 'comprehensive Report which outlines the Study\'s findings and explains the methodologies and justifications we used.</p>'
    + '<p>The summarized result of our analysis is as follows:</p>'
    + '<div class="eyebrow" style="margin-top:12pt">Summary of Benefits</div>'
    + '<div class="kpis">'
    + '<div class="kpi"><div class="l">Total Segregated Costs</div><div class="v">' + M0(C.totalSegregated) + '</div></div>'
    + '<div class="kpi"><div class="l">Total ' + esc(o.taxYear) + ' Depreciation</div><div class="v">' + M0(C.currentDeduction) + '</div></div>'
    + '<div class="kpi"><div class="l">&sect;481(a) Adjustment</div><div class="v">'
    + (Math.abs(C.catchUp) < 0.5 ? "N/A" : M0(C.catchUp)) + '</div></div></div>'
    + '<table><thead><tr><th>Asset Class</th><th class="r">Recovery Life</th><th class="r">Allocated Basis</th>'
    + '<th class="r">% of Basis</th></tr></thead><tbody>' + classRows + '</tbody></table>'
    + '<p style="margin-top:12pt">In accordance with IRS regulations, it\'s crucial that you maintain records documenting the '
    + 'cost basis and depreciation allowance for each segregated item. These records should include purchase contracts, closing '
    + 'statements, invoices, construction drawings and payment records, among others. Our findings are based on the details of '
    + 'such information made available to us.</p>'
    + '<p>We advise you to review the accompanying Report to ensure the accuracy of material facts. If any misstatements or '
    + 'omissions exist, it is imperative that we are contacted urgently. Our methods are founded on the most current court cases, '
    + 'regulations, and provisions of the Internal Revenue Code. As such, the validity of this Study is subject to the influence '
    + 'of amendments to the legislation and future judicial decisions. ' + esc(FNAME) + ' will not alter its approach to a '
    + 'completed study without your explicit request.</p>'
    + '<p>We appreciate the opportunity to work with you on this project.</p>'
    + '<p>Sincerely,</p><div class="sig">' + esc(o.specialist) + '</div>'
    + '<div>' + esc(o.specialist) + '<br><span style="color:#666">'
    + esc(firm.signerTitle || "Account Manager") + ' | ' + esc(FNAME) + '</span></div>'
    + '<div class="footer">' + foot + '</div></div>', SECTIONS[0]);

  /* ---------- Certification ---------- */
  add('<div class="page">' + runhead("Certification")
    + '<p>Our review of the information provided allowed us to identify certain components of the Property that qualify for '
    + 'reduced recovery periods under the Modified Accelerated Cost Recovery System (MACRS). These classifications are known '
    + 'under &sect;1245 and &sect;1250 of the Internal Revenue Code as personal property and real property land improvements and '
    + 'are assigned 5-, 7-, and 15-year recovery periods by the MACRS General Depreciation System (GDS). This Study aimed to '
    + 'distinguish these assets from the building components and allow the Owner to depreciate them over their applicable '
    + 'recovery periods.</p>'
    + '<p>We, ' + esc(FLEGAL) + ', certify to the best of our knowledge that:</p>'
    + '<ul class="plain">'
    + '<li>This Study was prepared in accordance with relevant tax regulations and decisions by experienced individuals with knowledge of accounting and engineering principles.</li>'
    + '<li>We completed a thorough review of the information provided and applied correct costing and modeling practices in order to generate reasonable basis allocations.</li>'
    + '<li>We performed an inspection of the site to confirm that the subject property and assets did exist as described.</li>'
    + '<li>Neither the engagement, nor our compensation is contingent on a particular result.</li>'
    + '<li>The undersigned project engineer certifies that the necessary work has been performed to support the conclusions made herein.</li>'
    + '</ul>'
    + '<p style="margin-top:20pt">Authored by:</p><div class="sig">' + esc(o.specialist) + '</div>'
    + '<div>' + esc(o.specialist) + '<br><span style="color:#666">'
    + esc(firm.certifierTitle || "Owner") + ' | ' + esc(FLEGAL) + '</span></div>'
    + '<div class="footer">' + foot + '</div></div>', SECTIONS[1]);

  /* ---------- Part One divider ---------- */
  add('<div class="page divider"><div class="part">P A R T &nbsp; O N E</div>'
    + '<div class="t">SUBJECT<br>PROPERTY</div><div class="s">' + esc(addr) + '</div>'
    + '<div class="footer">' + foot + '</div></div>', SECTIONS[2]);

  /* ---------- Property overview ---------- */
  const catsPresent = {};
  C.lines.filter(l => l.life !== 39 && l.life !== 27.5).forEach(l => { catsPresent[l.category] = 1; });
  const catList = Object.keys(catsPresent).map(c => c.toLowerCase()).sort();
  const catSentence = catList.length
    ? (catList.length > 1 ? catList.slice(0, -1).join(", ") + " and " + catList[catList.length - 1] : catList[0])
    : "personal property";
  // The written description leads; the square-footage and takeoff sentences always follow,
  // so a custom description supplements the composed paragraph instead of replacing it.
  const siteCats = {}, personalCats = {};
  C.lines.filter(l => l.life !== 39 && l.life !== 27.5).forEach(l => {
    (SITE_CATS.indexOf(l.category) >= 0 ? siteCats : personalCats)[l.category] = 1;
  });
  const listOf = obj => {
    const a = Object.keys(obj).map(c => c.toLowerCase()).sort();
    if (!a.length) return "";
    return a.length > 1 ? a.slice(0, -1).join(", ") + " and " + a[a.length - 1] : a[0];
  };
  const lead = (function () {
    let t = String(o.description || "").trim();
    if (!t) return "The subject is a " + String(o.propertyType || "property").toLowerCase()
      + " that was purchased and put into service in "
      + (b0.inServiceDate ? b0.inServiceDate.slice(0, 4) : o.taxYear) + ".";
    // Fragments like "a special purpose car wash" become proper sentences.
    if (!/^[A-Z]/.test(t)) t = "The subject is " + t;
    if (!/[.!?]$/.test(t)) t += ".";
    return t;
  })();
  const sizeSentence = "The property is situated in " + o.city + ", " + o.state
    + (o.totalSqft ? ", with approximately " + (+o.totalSqft).toLocaleString() + " square feet of improvements" : "")
    + (o.acres ? " on a " + num(+o.acres, 2) + "-acre lot" : "") + ".";
  const siteSentence = listOf(siteCats) ? " Site improvements include " + listOf(siteCats) + "." : "";
  const personalSentence = listOf(personalCats)
    ? " Personal properties found on site include, but are not limited to, " + listOf(personalCats) + "." : "";
  const desc = lead + " " + sizeSentence + siteSentence + personalSentence;
  const facts = [["Location", o.street + ", " + o.city + ", " + o.state], ["Zip Code", o.zip],
  ["Parcel Number(s)", o.parcel || "unknown"], ["Land Area", (o.acres ? num(o.acres, 2) : "0.00") + " AC"],
  ["Property Type (Business use)", o.propertyType], ["Number of Buildings", S.buildings.length],
  ["Rentable Area", o.totalSqft ? (+o.totalSqft).toLocaleString() + " ft\u00b2" : "\u2014 ft\u00b2"],
  ["Number of Stories", o.stories || "\u2014"], ["Year of Original Construction", o.yearBuilt || "unknown"],
  ["Acquisition Date", fmtDate(b0.acqDate)], ["Date Placed in Service", inSvc], ["Study Tax Year", o.taxYear]];
  add('<div class="page">' + runhead("Subject Property &middot; Property Overview")
    + '<h3>General Description</h3><p>' + esc(desc) + '</p>'
    + (o.improvements ? '<p>' + esc(o.improvements) + '</p>' : "")
    + '<dl class="facts" style="margin-top:14pt">'
    + facts.map(f => '<div><dt>' + esc(f[0]) + '</dt><dd>' + esc(f[1]) + '</dd></div>').join("")
    + '</dl><div class="footer">' + foot + '</div></div>', SECTIONS[3]);

  /* ---------- Schedule A ---------- */
  add('<div class="page">' + runhead("Schedule A &middot; Schedule of Assets")
    + '<h2>Schedule A</h2><div class="eyebrow">Schedule of Assets</div>'
    + '<table><thead><tr><th>Description</th><th>Date Placed in Service</th><th class="r">Cost Basis</th>'
    + '<th class="r">Depreciable Basis</th><th>Method</th><th class="r">Life</th></tr></thead><tbody>'
    + '<tr class="sect"><td colspan="6">Costs in Analysis</td></tr>'
    + (C.bases.length ? C.bases.map(b => '<tr><td>' + esc(b.name) + '</td><td>' + fmtDate(b.inServiceDate)
      + '</td><td class="r">' + M0(b.amount - b.landAmt) + '</td><td class="r">' + M0(b.depreciable)
      + '</td><td>SL</td><td class="r">' + esc(o.buildingLife) + '</td></tr>').join("")
      : '<tr><td colspan="6" class="empty">No bases entered.</td></tr>')
    + '<tr class="sub"><td>Total</td><td></td><td class="r">' + M0(C.totalCost - C.totalLand) + '</td><td class="r">'
    + M0(C.totalDepreciable) + '</td><td colspan="2"></td></tr>'
    + '<tr class="sect"><td colspan="6">Excluded Costs</td></tr>'
    + '<tr><td>Land</td><td>' + inSvc + '</td><td class="r">' + M0(C.totalLand)
    + '</td><td class="r">&mdash;</td><td>L</td><td class="r">&ndash;</td></tr>'
    + '<tr class="sub"><td>Total</td><td></td><td class="r">' + M0(C.totalLand) + '</td><td colspan="3"></td></tr>'
    + '<tr class="tot"><td>Total</td><td></td><td class="r">' + M0(C.totalCost) + '</td><td class="r">'
    + M0(C.totalDepreciable) + '</td><td colspan="2"></td></tr>'
    + '</tbody></table><div class="footer">' + foot + '</div></div>', SECTIONS[4]);

  /* ---------- Part Two divider ---------- */
  add('<div class="page divider"><div class="part">P A R T &nbsp; T W O</div>'
    + '<div class="t">PROPERTY<br>UNITS &amp; COSTS</div><div class="s">' + esc(addr) + '</div>'
    + '<div class="footer">' + foot + '</div></div>', SECTIONS[5]);

  /* ---------- Schedule B, chunked deterministically ---------- */
  const SB_HEAD = '<table><thead><tr><th>CSI Number</th><th>Description</th><th>Cost Type</th><th class="r">Quantity</th>'
    + '<th>Unit</th><th class="r">Unit Cost</th><th class="r">Adj Factor*</th><th class="r">Direct</th>'
    + '<th class="r">Indirect</th><th class="r">Total</th></tr></thead><tbody>';
  const sbRows = [];
  const segLines = C.lines.filter(l => l.life !== 39 && l.life !== 27.5);
  const byLife = {};
  segLines.forEach(l => {
    const k = String(l.life);
    if (!byLife[k]) byLife[k] = {};
    if (!byLife[k][l.category]) byLife[k][l.category] = [];
    byLife[k][l.category].push(l);
  });
  // Every recovery class always prints, present or not.
  ["5", "7", "15", "QIP"].forEach(k => {
    const title = (k === "QIP" ? "QIP" : k + "-Year") + " Property";
    sbRows.push({ h: '<tr class="sect"><td colspan="10">' + title + '</td></tr>', w: 1.2 });
    if (!byLife[k]) {
      sbRows.push({ h: '<tr><td colspan="10" class="empty">None identified in this Study.</td></tr>', w: 1.2 });
      sbRows.push({ h: '<tr class="sub"><td colspan="7">Total ' + title + '</td><td class="r">$0</td><td class="r">$0</td><td class="r">$0</td></tr>', w: 1.2 });
      return;
    }
    let d = 0, i = 0, t = 0;
    Object.keys(byLife[k]).sort().forEach(cat => {
      sbRows.push({ h: '<tr class="cat"><td colspan="10">' + esc(cat) + '</td></tr>', w: 1.2 });
      byLife[k][cat].forEach(l => {
        d += l.direct; i += l.indirect; t += l.grand;
        const dsc = CAT_BY_CSI[l.csi] ? CAT_BY_CSI[l.csi].desc : l.name;
        sbRows.push({
          h: '<tr><td>' + esc(l.csi || "\u2014") + '</td><td>' + esc(dsc.length > 88 ? dsc.slice(0, 85) + "\u2026" : dsc)
            + '</td><td>' + (l.source === "actual" ? "Actual" : "Estimate") + '</td><td class="r">' + num(l.qtyN)
            + '</td><td>' + esc(l.unit) + '</td><td class="r">' + M0(l.unitCost) + '</td><td class="r">'
            + l.adjFactor.toFixed(2) + '</td><td class="r">' + M0(l.direct) + '</td><td class="r">' + M0(l.indirect)
            + '</td><td class="r">' + M0(l.grand) + '</td></tr>', w: 1.6,
        });
      });
    });
    sbRows.push({ h: '<tr class="sub"><td colspan="7">Total ' + title + '</td><td class="r">' + M0(d)
      + '</td><td class="r">' + M0(i) + '</td><td class="r">' + M0(t) + '</td></tr>', w: 1.2 });
  });
  sbRows.push({ h: '<tr class="sect"><td colspan="10">Building</td></tr>', w: 1.2 });
  C.lines.filter(l => l.life === 39 || l.life === 27.5).forEach(l => {
    sbRows.push({
      h: '<tr><td>' + esc(l.csi || "\u2014") + '</td><td>' + esc(l.name) + '</td><td>SF Model</td><td class="r">'
        + num(l.qtyN) + '</td><td>' + esc(l.unit) + '</td><td class="r">' + M0(l.unitCost) + '</td><td class="r">'
        + l.adjFactor.toFixed(2) + '</td><td class="r">' + M0(l.direct) + '</td><td class="r">' + M0(l.indirect)
        + '</td><td class="r">' + M0(l.grand) + '</td></tr>', w: 1.4,
    });
  });
  sbRows.push({ h: '<tr><td>&mdash;</td><td>Building Structure Remainder</td><td>&mdash;</td><td class="r">&mdash;</td>'
    + '<td>&mdash;</td><td class="r">&mdash;</td><td class="r">&mdash;</td><td class="r">' + M0(C.structureDirect)
    + '</td><td class="r">' + M0(C.structureRemainder - C.structureDirect) + '</td><td class="r">'
    + M0(C.structureRemainder) + '</td></tr>', w: 1.4 });
  sbRows.push({ h: '<tr class="sub"><td colspan="7">Total Building</td><td class="r">' + M0(C.buildingResidual)
    + '</td><td class="r">' + M0(C.indirectNonSeg) + '</td><td class="r">' + M0(C.buildingAmt) + '</td></tr>', w: 1.2 });
  sbRows.push({ h: '<tr class="tot"><td colspan="7">Total Depreciable Unit Costs (Including Building)</td><td class="r">'
    + M0(C.lessIndirect) + '</td><td class="r">' + M0(C.pool) + '</td><td class="r">' + M0(C.totalDepreciable)
    + '</td></tr>', w: 1.4 });

  const sbPages = paginate(sbRows);
  sbPages.forEach((chunk, idx) => {
    const cont = idx > 0 ? ' (continued)' : '';
    add('<div class="page">' + runhead("Schedule B &middot; Depreciable Unit Costs" + cont)
      + (idx === 0 ? '<h2>Schedule B</h2><div class="eyebrow">Depreciable Unit Costs</div>' : '')
      + SB_HEAD + chunk.join("") + '</tbody></table>'
      + (idx === sbPages.length - 1
        ? '<div class="fn">* The adjustment factor reconciles national-average unit costs to the subject property: location, '
        + 'historical, depreciation, and basis adjustments (see Cost Reconciliation). Items with actual costs receive a factor of 1.</div>'
        : '')
      + '<div class="footer">' + foot + '</div></div>', idx === 0 ? SECTIONS[6] : null);
  });

  /* ---------- Schedule C ---------- */
  add('<div class="page">' + runhead("Schedule C &middot; Indirect Costs")
    + '<h2>Schedule C-1</h2><div class="eyebrow">Indirect Costs Detail</div>'
    + '<table><thead><tr><th>Description</th><th>CSI Number</th><th>Unit</th><th class="r">Amount</th>'
    + '<th class="r">Percentage of "Amount" including OH&amp;P</th><th class="r">Total</th></tr></thead><tbody>'
    + (C.ruleRows.length ? C.ruleRows.map(r => '<tr><td>' + esc(r.desc) + '</td><td>' + esc(r.csi) + '</td><td>'
      + esc(r.unit) + '</td><td class="r">' + M0(r.baseAmt) + '</td><td class="r">' + r.pct + '%</td><td class="r">'
      + M0(r.total) + '</td></tr>').join("") : '<tr><td colspan="6" class="empty">No estimated indirect rules active.</td></tr>')
    + S.actuals.map(a => '<tr><td>' + esc(a.desc) + '</td><td>Actual</td><td>Invoice</td><td class="r">&mdash;</td>'
      + '<td class="r">&mdash;</td><td class="r">' + M0(a.amount) + '</td></tr>').join("")
    + '<tr class="tot"><td colspan="5">Total</td><td class="r">' + M0(C.pool) + '</td></tr></tbody></table>'
    + '<h2 style="margin-top:22pt">Schedule C-2</h2><div class="eyebrow">Indirect Costs Allocation</div>'
    + '<table><thead><tr><th>Description</th><th class="r">Costs</th><th class="r">Relative Percentage&sup1;</th></tr></thead><tbody>'
    + '<tr><td>Depreciable Costs in Analysis</td><td class="r">' + M0(C.totalDepreciable) + '</td><td></td></tr>'
    + '<tr><td>Indirect Costs</td><td class="r">' + M0(C.pool) + '</td><td></td></tr>'
    + '<tr class="sub"><td>Total Less Indirect Costs</td><td class="r">' + M0(C.lessIndirect) + '</td><td></td></tr>'
    + '<tr><td>Segregated Costs</td><td class="r">' + M0(C.directSegregated) + '</td><td class="r">'
    + pct(C.lessIndirect ? C.directSegregated / C.lessIndirect : 0) + '</td></tr>'
    + '<tr><td>Indirect Costs Associated with Segregated Assets</td><td class="r">' + M0(C.indirectSegregated)
    + '</td><td class="r">' + pct(C.pool ? C.indirectSegregated / C.pool : 0) + '</td></tr>'
    + '<tr class="sub"><td>Total Segregated Costs</td><td class="r">' + M0(C.totalSegregated) + '</td><td></td></tr>'
    + '<tr><td>Non-Segregated Building Costs</td><td class="r">' + M0(C.buildingResidual) + '</td><td class="r">'
    + pct(C.lessIndirect ? C.buildingResidual / C.lessIndirect : 0) + '</td></tr>'
    + '<tr><td>Indirect Costs Associated with Non-Segregated Assets</td><td class="r">' + M0(C.indirectNonSeg)
    + '</td><td class="r">' + pct(C.pool ? C.indirectNonSeg / C.pool : 0) + '</td></tr>'
    + '<tr class="sub"><td>Total Non-Segregated Costs</td><td class="r">' + M0(C.buildingAmt) + '</td><td></td></tr>'
    + '<tr class="tot"><td>Total</td><td class="r">' + M0(C.totalDepreciable) + '</td><td class="r">100.00%</td></tr>'
    + '</tbody></table>'
    + '<div class="fn">1 &mdash; The proportion of the item\'s cost relative to the total cost in its category.</div>'
    + '<div class="footer">' + foot + '</div></div>', SECTIONS[7]);

  /* ---------- Schedule D, chunked deterministically ---------- */
  const PRIOR = !!C.hasPrior;                 // hide empty §481(a) columns entirely
  const NCOL = PRIOR ? 14 : 11;
  const SD_HEAD = '<table><thead><tr><th>Unit Classification</th><th>Date Placed in Service</th><th class="r">Amount</th>'
    + '<th class="r">Asset Class</th><th>IRC Sec.</th><th class="r">GDS Life</th><th class="r">ADS Life</th><th>Method</th>'
    + '<th>Conv.</th><th class="r">Bonus %</th>'
    + (PRIOR ? '<th class="r">Allowed Through ' + (C.taxYear - 1) + '</th>'
      + '<th class="r">Taken Through ' + (C.taxYear - 1) + '</th><th class="r">Catch-Up (&sect;481(a))</th>' : '')
    + '<th class="r">' + C.taxYear + ' Tax Year Deduction</th></tr></thead><tbody>';
  const sdRows = [];
  C.unitRows.forEach(ur => {
    const u = ur.unit;
    sdRows.push({ h: '<tr class="sect"><td colspan="' + NCOL + '">'
      + (u.label === "BUILDING" ? u.life + " Year Property" : u.label.replace("-", " ") + " Property")
      + '</td></tr>', w: 1.2 });
    if (!ur.kids.length) sdRows.push({ h: '<tr><td colspan="' + NCOL + '" class="empty">None identified in this Study.</td></tr>', w: 1.2 });
    ur.kids.forEach(k => {
      sdRows.push({
        h: '<tr><td>' + esc(k.label) + '</td><td>' + inSvc + '</td><td class="r">' + M0(k.amount) + '</td>'
          + '<td class="r">' + k.assetClass + '</td><td>' + u.irc + '</td><td class="r">' + u.life + '</td>'
          + '<td class="r">' + u.ads + '</td><td>' + k.method + '</td><td>' + u.conv + '</td>'
          + '<td class="r">' + (u.bonus * 100).toFixed(0) + '%</td>'
          + (PRIOR ? '<td class="r">' + M0(k.allowedThrough) + '</td><td class="r">' + M0(k.taken)
            + '</td><td class="r">' + M0(k.catchUp) + '</td>' : '')
          + '<td class="r">' + M0(k.currentYear) + '</td></tr>', w: 1.3,
      });
    });
    sdRows.push({ h: '<tr class="sub"><td></td><td></td><td class="r">' + M0(u.amount) + '</td><td colspan="7"></td>'
      + (PRIOR ? '<td class="r">' + M0(u.allowedThrough) + '</td><td class="r">' + M0(u.taken)
        + '</td><td class="r">' + M0(u.catchUp) + '</td>' : '')
      + '<td class="r">' + M0(u.currentYear) + '</td></tr>', w: 1.2 });
  });
  sdRows.push({ h: '<tr class="tot"><td>Depreciable Basis</td><td></td><td class="r">' + M0(C.totalDepreciable) + '</td>'
    + '<td colspan="7">Total ' + C.taxYear + ' Deduction</td>'
    + (PRIOR ? '<td class="r">' + M0(C.totalAllowed) + '</td><td class="r">' + M0(C.totalTaken)
      + '</td><td class="r">' + M0(C.catchUp) + '</td>' : '')
    + '<td class="r">' + M0(C.currentDeduction) + '</td></tr>', w: 1.4 });

  const sdPages = paginate(sdRows);
  sdPages.forEach((chunk, idx) => {
    const cont = idx > 0 ? ' (continued)' : '';
    add('<div class="page">' + runhead("Schedule D &middot; Unit Summary and Federal Depreciation" + cont)
      + (idx === 0 ? '<h2>Schedule D</h2><div class="eyebrow">Unit Summary and Federal Depreciation Schedule</div>' : '')
      + SD_HEAD + chunk.join("") + '</tbody></table>'
      + (idx === sdPages.length - 1
        ? '<div class="fn">Half-year convention applied based on this study\u2019s in-service profile &mdash; a taxpayer-level '
        + 'assumption; confirm with the CPA.</div>' : '')
      + '<div class="footer">' + foot + '</div></div>', idx === 0 ? SECTIONS[8] : null);
  });

  /* ---------- Part Three divider ---------- */
  add('<div class="page divider"><div class="part">P A R T &nbsp; T H R E E</div>'
    + '<div class="t">METHODOLOGY<br>&amp; PROCEDURES</div><div class="s">' + esc(addr) + '</div>'
    + '<div class="footer">' + foot + '</div></div>', SECTIONS[9]);

  /* ---------- Methodology, page 1 ---------- */
  add('<div class="page">' + runhead("Methodology &amp; Procedures")
    + '<h3>Cost Segregation Methodology</h3>'
    + '<p>The Cost Segregation Audit Technique Guide (2022) states:</p>'
    + '<blockquote>"For income tax purposes, cost segregation studies involve the allocation of the total cost of property into '
    + 'the appropriate property classes and recovery periods in order to properly compute depreciation deductions...At this time, '
    + 'there is no standard format for either cost segregation or cost segregation reports." (p 17)</blockquote>'
    + '<p>In the absence of standardized cost segregation techniques, this report aims to reflect the IRS\'s principle elements of '
    + 'a quality cost segregation study. Below, we outline our efforts to create a cost segregation study that is both accurate '
    + 'and well-documented according to the following three points:</p>'
    + '<ul class="plain"><li>Assets should be classified into property classes (e.g., land, land improvements, building, equipment, furniture and fixtures)</li>'
    + '<li>Study preparers should explain the rationale for classifying assets as either &sect;1245 or &sect;1250 property</li>'
    + '<li>Studies should substantiate the cost basis of each asset and reconcile total allocated costs to total actual costs</li></ul>'
    + '<h4>Excluded Costs</h4>'
    + '<p>The allocation of an acquired property\'s purchase price must begin with an allocation to the value of land. This should '
    + 'be based either on an appraisal report done on the property before purchase or the local real estate assessment at the time '
    + 'of purchase. It is preferable to establish the land value with an actual appraised or assessed value; however, in the case '
    + 'of an unreasonable valuation, the non-depreciable land value may also be determined using the improvements-to-land ratio '
    + 'commonly utilized by property tax assessors.</p>'
    + '<p>We also recognize the possibility of additional improvements or costs that should be excluded from the basis '
    + 'calculations. These include, but are not limited to, furnishings and equipment installed after acquisition costs were '
    + 'finalized, business-specific property added by persons other than the taxpayer (such as a tenant), and expenses that the '
    + 'taxpayer has elected not to capitalize.</p>'
    + '<p>This study defines the term "Depreciable Basis" as the portion of the total cost basis remaining after non-depreciable '
    + 'accounts &mdash; such as land &mdash; have been allocated.</p>'
    + '<h4>Approach</h4>'
    + '<p>The methodology utilized in allocating total project costs to various assets is critical to achieving an accurate cost '
    + 'segregation study. Cost segregation subject properties are typically either newly constructed or acquired property, and '
    + 'each necessitates a different overall approach.</p>'
    + '<p>When construction cost information for a property is not available, it must be reconstructed using the cost data, '
    + 'methods, and techniques normally used for property appraisal. The concept underlying this methodology is calculation of the '
    + '"Replacement Cost New" (RCN) for the building and its components. This model is then reconciled to the total acquisition '
    + 'cost using various multipliers that account for the age, location, and depreciation of the property thus far.</p>'
    + '<p>This report employed a method that most closely resembles the Detailed Engineering Cost Estimate Approach, while also '
    + 'incorporating practices from the other 5 most common cost segregation study approaches. Qualified costing experts performed '
    + 'these calculations utilizing all available information combined with findings from a field inspection to the property.</p>'
    + '<div class="footer">' + foot + '</div></div>', null);

  /* ---------- Methodology, page 2 ---------- */
  add('<div class="page">' + runhead("Methodology &amp; Procedures")
    + '<h4>Tax Analysis</h4>'
    + '<p>Once construction costs have been accurately calculated, they must be categorized into applicable asset classes for the '
    + 'determination of depreciation deductions. These classifications are made by experienced financial analysts in accordance '
    + 'with Rev. Proc. 87-56, the current IRS Pronouncement.</p>'
    + '<h4>Cost Reconciliation</h4>'
    + '<p>There are four multipliers used in this study to reconcile the RCN to the total purchase price. Because asset costs are '
    + 'estimated using national averages, certain factors must be considered for costs to be reasonable for any given property.</p>'
    + '<p><b>Location Adjustment</b> &mdash; The RS Means Construction Cost Database publishes a table containing regression '
    + 'factors that compare local labor and material rates per zip code to national averages.'
    + (C.cci ? ' The subject property falls within the ' + esc(C.cci.city) + ', ' + esc(C.cci.state) + ' index area (zip '
      + esc(C.zip3) + 'xx), where material costs index at ' + C.cci.mat + ' and installation at ' + C.cci.inst
      + ' against a national average of 100.' : '') + '</p>'
    + '<p><b>Historical Adjustment</b> &mdash; For studies in which the tax year is later than the original in-service year, raw '
    + 'unit cost estimates may be unreliable. In order to allocate property costs retroactively, current cost estimates must be '
    + 'adjusted to reflect past industry rates.</p>'
    + '<p><b>Depreciation Adjustment</b> &mdash; While the historical adjustment is used to adjust cost data to reflect past '
    + 'conditions, the depreciation adjustment is used to estimate the current value of assets (as of the acquisition date) by '
    + 'accounting for their decrease in value since the building\'s construction.</p>'
    + '<p><b>Basis Adjustment</b> &mdash; The final factor applied is meant to align estimated project costs with the actual '
    + 'depreciable basis of the property. Note that items for which actual costs were given receive a basis adjustment factor of 1.</p>'
    + '<dl class="facts" style="margin-top:12pt">'
    + '<div><dt>Location Adjustment</dt><dd>' + C.location.toFixed(4) + '</dd></div>'
    + '<div><dt>Historical Adjustment</dt><dd>' + C.historical.toFixed(4) + '</dd></div>'
    + '<div><dt>Depreciation Adjustment</dt><dd>' + C.deprAdj.toFixed(4) + '</dd></div>'
    + '<div><dt>Basis Adjustment</dt><dd>' + C.reconcile.toFixed(4) + '</dd></div></dl>'
    + '<h4>Documentation</h4>'
    + '<p>This study\'s validity depends on the information provided. Documentation of the property, the cost thereof, and the '
    + 'assets contained therein is available upon request and may include:</p>'
    + '<ul class="plain"><li>Purchasing agreements / Settlement statements</li><li>Depreciation schedules</li>'
    + '<li>Property tax records</li><li>Field inspection photos and recordings</li>'
    + '<li>Overhead imaging from third-party mapping software</li>'
    + '<li>Construction documents (plans, drawings, specifications, etc.)</li><li>Appraisals</li>'
    + '<li>Records of interviews performed by ' + esc(FNAME) + ' to prepare this study</li>'
    + '<li>Other relevant findings or disclosures made by the Client or related parties</li></ul>'
    + '<h4>Procedures</h4>'
    + '<ul class="plain"><li>Interviewed the client and related parties to confirm the accuracy of our engagement.</li>'
    + '<li>Reviewed available architectural drawings, site maps, and engineering records.</li>'
    + '<li>Performed an inspection of the property to gather asset "takeoffs" and identify real and personal property assets with recovery periods of less than 39 years.</li>'
    + '<li>Reviewed available project cost information to ensure correct calculation of the depreciable basis and non-depreciable accounts.</li>'
    + '<li>Computed the property\'s Replacement Cost New, factoring in location, history, and obsolescence.</li>'
    + '<li>Reconciled the capitalized costs to the actual project cost.</li>'
    + '<li>Assigned appropriate cost recovery periods to the individual assemblies and components of the property.</li>'
    + '<li>Compiled a cost segregation report that defines our engagement, describes the subject property, displays the study\'s findings, and explains the framework and justifications used.</li></ul>'
    + '<div class="footer">' + foot + '</div></div>', null);

  /* ---------- Assumptions ---------- */
  const assumptions = [
    ["Information Accuracy", "The accuracy of information provided by others, used in this report, is assumed but not completely verified or audited. No guarantees are given concerning the accuracy of this information."],
    ["Client Responsibility", "The capitalized basis for this report was provided by the client, and therefore, responsibility for its accuracy rests with the client."],
    ["Right to Adjust", esc(FLEGAL) + " reserves the right to make adjustments to the report if additional information becomes available."],
    ["Usage Limitation", "This report is intended for the specific purpose of identifying Internal Revenue Code &sect;1245 and &sect;1250 property and establishing appropriate cost recovery periods for the Property. Any use outside of that specified purpose is considered invalid."],
    ["Third-party Reliance", "No third party may rely on the report without prior written consent."],
    ["Role Clarification", esc(FLEGAL) + " does not assume the role of Certified Public Accountant (CPA) or Tax Advisor and will not prepare or make tax filings on behalf of the client."],
    ["Service Scope", "Our services are limited to those described in the report. Neither " + esc(FLEGAL) + " nor any individual involved in the preparation of this report shall be required to give further consultation or appear at legal proceedings without prior specific arrangement. Therefore, the Client is advised to seek competent tax counsel for assistance."],
  ];
  add('<div class="page">' + runhead("Statement of Assumptions and Limiting Conditions")
    + '<p>This report is subject to the following assumptions and limiting conditions:</p><ol class="plain">'
    + assumptions.map(a => '<li><b>' + a[0] + ':</b> ' + a[1] + '</li>').join("")
    + '</ol><div class="footer">' + foot + '</div></div>', SECTIONS[10]);

  /* ---------- Classification ---------- */
  add('<div class="page">' + runhead("Classification of &sect;1245 and &sect;1250 Property")
    + '<p>The Cost Segregation Audit Technique Guide (2022) states:</p>'
    + '<blockquote>"The primary issue in cost segregation studies is the proper classification of assets as either &sect;1245 or '
    + '&sect;1250 property." (p 96)</blockquote>'
    + '<p>The purpose of this section is to explain the rationale and reasoning behind our classifications of the property\'s '
    + 'components. Our methodology relies heavily on relevant provisions, regulations, and case decisions that support these '
    + 'classifications.</p>'
    + '<h4>Definitions</h4>'
    + '<p><b>Section 1245 Property</b> &mdash; Section 1245(a)(3) provides that "&sect;1245 property" is any property which is or '
    + 'has been subject to depreciation under &sect;167 and which is either personal property or other tangible property (not '
    + 'including a building or its structural components) that was used as an integral part of certain activities. A building or '
    + 'its structural components is specifically excluded from the definition of &sect;1245 property.</p>'
    + '<p><b>Tangible Personal Property</b> &mdash; Treas. Reg. &sect;1.48-1(c) defines \'tangible personal property\' as any '
    + 'tangible property except land and improvements thereto, such as buildings or other inherently permanent structures.</p>'
    + '<p><b>Building</b> &mdash; Treas. Reg. &sect;1.48-1(e)(1) defines a "building" as any structure or edifice enclosing a space '
    + 'within its walls, and usually covered by a roof, the purpose of which is to provide shelter or housing, or to provide '
    + 'working, office, parking, display, or sales space.</p>'
    + '<p><b>Structural Component</b> &mdash; Treas. Reg. &sect;1.48-1(e)(2) provides that "structural components" includes such '
    + 'parts of a building as walls, partitions, floors, and ceilings, as well as any permanent coverings therefor; windows and '
    + 'doors; all components of a central air conditioning or heating system; plumbing and plumbing fixtures; electric wiring and '
    + 'lighting fixtures; chimneys; stairs, escalators, and elevators; sprinkler systems; fire escapes; and other components '
    + 'relating to the operation or maintenance of a building.</p>'
    + '<h4>Tests for Distinguishing &sect;1245 and &sect;1250 Property</h4>'
    + '<p>There is no generally standardized test for segregating property into &sect;1245 and &sect;1250 classifications. Each '
    + 'situation depends on the facts and circumstances involved. As such, the primary way to determine whether an asset is '
    + '&sect;1245 property is to ascertain that it is not a building or structural component. In Rev. Rul. 75-178, 1975-1 C.B. 9, '
    + 'the Service considered that the classification of property as \'personal\' or \'inherently permanent\' should be made based '
    + 'on the manner of attachment to the land or the structure and how permanently the property is designed to remain in place.</p>'
    + '<h4>Inherently Permanent Test</h4>'
    + '<p>Based on an analysis of Whiteco Industries, Inc. v. Commissioner, 65 T.C. 664 (1975) and prior case law, the Tax Court '
    + 'put forth six questions designed to determine whether an asset qualifies as tangible personal property, referred to as the '
    + '"Whiteco Factors":</p>'
    + '<ul class="plain"><li>Is the property capable of being moved, and has it in fact been moved?</li>'
    + '<li>Is the property designed or constructed to remain permanently in place?</li>'
    + '<li>Are there circumstances which tend to show the expected or intended lengths of affixation?</li>'
    + '<li>How substantial of a job is the removal of the property and how time-consuming is it? Is it "readily removable"?</li>'
    + '<li>How much damage will the property sustain upon its removal?</li>'
    + '<li>What is the manner of affixation of the property to the land?</li></ul>'
    + '<p>Note that movability is not a determinative measure of permanence. The court in Whiteco held that affixation to land does '
    + 'not exclude the property from the category of tangible personal property. In L.L. Bean, Inc. v. Commissioner, T.C. Memo. '
    + '1997-175, aff\'d, 145 F.3d 53 (1st Cir. 1998), the court held that the mere fact that a structure is theoretically capable '
    + 'of being moved does not establish that it is not inherently permanent.</p>'
    + '<p>See Amerisouth XXXII, Ltd. v. Commissioner, T.C. Memo. 2012-67; Trentadue v. Commissioner, 128 T.C. 91 (2007); PDV '
    + 'America, Inc. and Subs. v. Commissioner, T.C. Memo. 2004-118; Hospital Corp. of America and Subs. v. Commissioner, 109 '
    + 'T.C. 21 (1997).</p>'
    + '<div class="footer">' + foot + '</div></div>', SECTIONS[11]);

  /* ---------- Justifications: canonical order, only groups actually present ---------- */
  const blocks = JUSTIFICATIONS.filter(j => j.cats.some(c => catsPresent[c]))
    .map(j => '<h4>' + esc(j.group) + '</h4><p>' + j.text + '</p>');
  const lifeList = Object.keys(C.classes).sort((a, b) => a - b);
  add('<div class="page">' + runhead("Supplemental Support &middot; Justifications for Asset Reclassifications")
    + '<p>Each short-life asset category identified in this study is supported on two grounds: (1) the asset\'s character as '
    + 'tangible personal property or land improvement rather than a structural component of the building, and (2) its assigned '
    + 'recovery period under Rev. Proc. 87-56 given the taxpayer\'s business activity.</p>'
    + '<p>The classification framework above (Treas. Reg. &sect;1.48-1, the Whiteco Factors, and Rev. Rul. 75-178) governs the '
    + 'structural-versus-nonstructural determination for every reclassified component: an asset qualifies for a reduced recovery '
    + 'period only where it is not a building or an inherently permanent structural component thereof, or where it constitutes a '
    + 'depreciable land improvement under Asset Class 00.3. The category-level discussions below apply that framework to the '
    + 'specific asset categories segregated in this Study.</p>'
    + (blocks.length ? blocks.join("") : '<p><i>No short-life asset categories were segregated in this Study.</i></p>')
    + '<h4>Recovery-Period Qualifications</h4>'
    + (lifeList.length
      ? lifeList.map(L => '<p><b>' + L + '-Year Property:</b> Recovery period assigned per Rev. Proc. 87-56 based on the '
        + 'taxpayer\'s business activity (a ' + esc(String(o.propertyType || "").toLowerCase()) + ').</p>').join("")
      : '<p>No reclassified property in this Study.</p>')
    + '<div class="footer">' + foot + '</div></div>', SECTIONS[12]);

  /* ---------- Appendix A: always included ---------- */
  add('<div class="page">' + runhead("Appendix A &middot; Workpapers")
    + '<h2>Appendix A</h2><div class="eyebrow">Workpapers</div>'
    + '<h3>Pinned data releases</h3><dl class="facts">'
    + '<div><dt>RS Means catalog</dt><dd>2026 Q1 &mdash; takeoff export (open shop)</dd></div>'
    + '<div><dt>City Cost Index</dt><dd>2026 Updated City Cost Index</dd></div>'
    + '<div><dt>Location index area</dt><dd>'
    + (C.cci ? esc(C.cci.city + ", " + C.cci.state + " (zip " + C.zip3 + "xx)") : "not resolved") + '</dd></div>'
    + '<div><dt>Material / Installation / Total index</dt><dd>'
    + (C.cci ? C.cci.mat + " / " + C.cci.inst + " / " + C.cci.total : "&mdash;") + '</dd></div>'
    + '<div><dt>Takeoff adjustment factor</dt><dd>' + C.adjFactor.toFixed(4) + '</dd></div>'
    + '<div><dt>SF-model adjustment factor</dt><dd>' + C.adjFactorSF.toFixed(4) + '</dd></div>'
    + '<div><dt>Indirect ratio</dt><dd>' + pct(C.indirectRatio) + '</dd></div>'
    + '<div><dt>Site visit</dt><dd>' + esc(o.visitType + " \u00b7 " + o.inspector + " \u00b7 " + fmtDate(o.visitDate)) + '</dd></div>'
    + '<div><dt>Valuation specialist</dt><dd>' + esc(o.specialist) + '</dd></div>'
    + '</dl>'
    + '<h3>Electrical circuit survey</h3>'
    + (S.buildings.map(g => {
      const e = C.elecByBuilding[g.id];
      if (!e || !e.total) return '<p><b>' + esc(g.name) + '</b> &mdash; no circuit survey recorded.</p>';
      if (e.defaulted) return '<p><b>' + esc(g.name) + '</b> &mdash; no circuit survey recorded; the standard '
        + 'allocation was applied: ' + num(C.elecDefaultPct, 0) + '% of the building electrical system to 5-year '
        + 'personalty, the remaining ' + num(100 - C.elecDefaultPct, 0) + '% to the building.</p>';
      return '<p><b>' + esc(g.name) + '</b> &mdash; ' + e.panelCount + ' panel(s), ' + e.total + 'A recorded: '
        + ["5-Year", "7-Year", "15-Year", "Building"].map(k => k + " " + (e.tally[k] || 0) + "A ("
          + ((e.tally[k] || 0) / e.total * 100).toFixed(1) + "%)").join(", ") + '.</p>';
    }).join("") || '<p>No buildings defined.</p>')
    + '<h3>Open warnings at generation</h3>'
    + (C.warnings.length ? '<ul class="plain">' + C.warnings.map(w => '<li>' + esc(w) + '</li>').join("") + '</ul>'
      : '<p>None. All inputs resolved cleanly.</p>')
    + '<div class="footer">' + foot + '</div></div>', SECTIONS[13]);

  /* ---------- Appendix B: always included ---------- */
  const yr = C.byYear.filter(y => y.total > 0.5);
  add('<div class="page">' + runhead("Appendix B &middot; AMT Depreciation Schedule")
    + '<h2>Appendix B</h2><div class="eyebrow">AMT Depreciation Schedule</div>'
    + '<table><thead><tr><th>Tax Year</th><th class="r">5-Year</th><th class="r">7-Year</th><th class="r">15-Year</th>'
    + '<th class="r">QIP</th><th class="r">Building</th><th class="r">Total</th></tr></thead><tbody>'
    + (yr.length ? yr.slice(0, 28).map(y => '<tr><td>' + y.year + '</td>'
      + ["5", "7", "15", "QIP", "BUILDING"].map(k => '<td class="r">' + (y[k] > 0.5 ? M0(y[k]) : "&mdash;") + '</td>').join("")
      + '<td class="r"><b>' + M0(y.total) + '</b></td></tr>').join("")
      : '<tr><td colspan="7" class="empty">No depreciation computed.</td></tr>')
    + '</tbody></table>'
    + '<div class="fn">Post-1986 property depreciated under the 150% declining balance method for AMT purposes is shown at its '
    + 'regular-tax amount where bonus depreciation has been claimed in full, in which case no AMT adjustment arises.</div>'
    + '<div class="footer">' + foot + '</div></div>', SECTIONS[14]);

  /* ---------- Build the table of contents from the finished page list ---------- */
  const tocItems = [];
  P.forEach((pg, i) => { if (pg.toc) tocItems.push({ label: pg.toc, page: i + 1, indent: pg.indent }); });
  P[TOC_INDEX].body = '<div class="page">'
    + '<h2>Table of Contents</h2><div class="eyebrow" style="margin-bottom:14pt">'
    + esc(o.taxpayer || "Owner") + ' &middot; Tax Year ' + esc(o.taxYear) + '</div>'
    + '<div class="toc"><ul>'
    + tocItems.map(t => '<li class="' + (t.indent ? "ind" : "") + '"><span>' + esc(t.label) + '</span><span>'
      + t.page + '</span></li>').join("")
    + '</ul></div><div class="footer">' + foot + '</div></div>';

  // Stamp page numbers into every page (the document numbers itself, so the
  // printed numbers match the table of contents regardless of browser chrome).
  const html = P.map((pg, i) => {
    const n = '<div class="pageno">' + (i + 1) + '</div></div>';
    return pg.body.slice(0, pg.body.lastIndexOf("</div>")) + n;
  }).join("");

  return '<!DOCTYPE html><html><head><meta charset="utf-8"><title>'
    + esc((o.taxpayer || "Client") + " \u2014 Final Report \u2014 " + o.street)
    + '</title><style>' + RPT_CSS + '</style></head><body>' + html + '</body></html>';
}


// Per-owner Schedule D: one page each, showing that owner's share.
function openOwnerSchedules(S, C, owners) {
  const list = (owners || []).filter(o => o.name && +o.pct);
  if (!list.length) { alert("Add at least one owner with a name and a share percentage."); return; }
  const o = S.overview;
  const addr = o.street + ", " + o.city + ", " + o.state + " " + o.zip;
  const inSvc = fmtDate((C.bases[0] || {}).inServiceDate);
  const pages = list.map(ow => {
    const share = (+ow.pct) / 100;
    const rows = C.units.map(u => '<tr><td>' + esc(u.label === "BUILDING" ? "Building" : u.label + " Property")
      + '</td><td>' + inSvc + '</td><td class="r">' + u.life + '</td><td>' + u.method + '</td>'
      + '<td class="r">' + (u.bonus * 100).toFixed(0) + '%</td>'
      + '<td class="r">' + M0(u.amount) + '</td><td class="r">' + M0(u.amount * share) + '</td>'
      + '<td class="r">' + M0(u.currentYear * share) + '</td></tr>').join("");
    return '<div class="page">'
      + '<div class="runhead"><span>Schedule D &middot; Owner Depreciation</span><span>' + esc(String(o.street).toUpperCase()) + '</span></div>'
      + '<h2>' + esc(ow.name) + '</h2><div class="eyebrow">' + num(+ow.pct, 2) + '% ownership &middot; Tax Year ' + esc(o.taxYear) + '</div>'
      + '<p style="margin-top:10pt">' + esc(addr) + '</p>'
      + '<div class="kpis"><div class="kpi"><div class="l">Allocated Basis</div><div class="v">'
      + M0(C.totalDepreciable * share) + '</div></div>'
      + '<div class="kpi"><div class="l">Segregated Share</div><div class="v">' + M0(C.totalSegregated * share) + '</div></div>'
      + '<div class="kpi"><div class="l">' + esc(o.taxYear) + ' Deduction</div><div class="v">'
      + M0(C.currentDeduction * share) + '</div></div></div>'
      + '<table><thead><tr><th>Unit Classification</th><th>In Service</th><th class="r">Life</th><th>Method</th>'
      + '<th class="r">Bonus</th><th class="r">Study Amount</th><th class="r">Owner Share</th>'
      + '<th class="r">' + C.taxYear + ' Deduction</th></tr></thead><tbody>' + rows
      + '<tr class="tot"><td colspan="5">Total</td><td class="r">' + M0(C.totalDepreciable) + '</td>'
      + '<td class="r">' + M0(C.totalDepreciable * share) + '</td><td class="r">'
      + M0(C.currentDeduction * share) + '</td></tr></tbody></table>'
      + '<div class="fn">Amounts are this owner\'s pro-rata share of the study totals at ' + num(+ow.pct, 2)
      + '%. Confirm allocation against the operating agreement and K-1s before filing.</div>'
      + '<div class="footer">' + esc(((S.firm || {}).legalName || (S.firm || {}).name || "").toUpperCase())
      + ' &middot; STUDY ' + esc(o.studyNumber) + '</div></div>';
  }).join("");
  const html = '<!DOCTYPE html><html><head><meta charset="utf-8"><title>'
    + esc((o.taxpayer || "Client") + " \u2014 Owner Schedules \u2014 " + o.street)
    + '</title><style>' + RPT_CSS + '</style></head><body>' + pages + '</body></html>';
  const w = window.open("", "_blank");
  if (!w) { alert("Please allow pop-ups so the schedules can open."); return; }
  w.document.open(); w.document.write(html); w.document.close();
  setTimeout(() => { try { w.focus(); w.print(); } catch (e) { } }, 700);
}

function openReport(S, C, opts) {
  const html = buildReport(S, C, opts);
  const w = window.open("", "_blank");
  if (!w) { alert("Please allow pop-ups for this site so the report can open."); return; }
  w.document.open(); w.document.write(html); w.document.close();
  setTimeout(() => { try { w.focus(); w.print(); } catch (e) { } }, 700);
}

/* ============================ APP ============================ */
const TABS = ["Overview", "Bases", "Takeoff", "Exterior", "Electrical", "Depr Adj", "Unit Cost Detail", "Indirect Costs", "Depreciation Report", "Summary Table", "Review & Deliver"];


export { RPT_CSS, buildReport, openReport, openOwnerSchedules, SECTIONS, JUSTIFICATIONS };
