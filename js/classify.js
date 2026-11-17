/**
 * Title-based classification.
 *
 * The EMA export carries only title, category, two dates and a URL. Everything
 * here is *inferred from the title text* so the atlas has something to group
 * by. It is a heuristic, labelled as such in the UI, and never presented as an
 * EMA field. Rules are ordered: the first match wins.
 */

/** @typedef {{id:string,label:string,short:string,about:string}} Group */

/** @type {Group[]} */
export const GROUPS = [
  { id: 'clinical', label: 'Clinical efficacy & safety', short: 'Clinical',
    about: 'Clinical investigation and development of medicines for a condition or population.' },
  { id: 'quality', label: 'Quality & manufacturing', short: 'Quality',
    about: 'Chemistry, manufacturing, specifications, stability and excipients.' },
  { id: 'ich', label: 'ICH harmonised guidelines', short: 'ICH',
    about: 'International Council for Harmonisation texts adopted in the EU (Q, S, E and M series).' },
  { id: 'bio', label: 'Biologicals & advanced therapies', short: 'Biologicals',
    about: 'Vaccines, plasma products, biosimilars, cell and gene therapies.' },
  { id: 'psbe', label: 'Product-specific bioequivalence', short: 'Bioequivalence',
    about: 'Substance-by-substance guidance on demonstrating bioequivalence.' },
  { id: 'nonclinical', label: 'Non-clinical, safety & residues', short: 'Non-clinical',
    about: 'Toxicology, environmental risk, user safety and residues.' },
  { id: 'vich', label: 'VICH harmonised guidelines', short: 'VICH',
    about: 'Veterinary harmonisation texts (the GL series).' },
  { id: 'smpc', label: 'Core SmPC & labelling', short: 'Labelling',
    about: 'Core summaries of product characteristics, package leaflets and labelling.' },
  { id: 'herbal', label: 'Herbal medicines', short: 'Herbal',
    about: 'Herbal substances, preparations and traditional herbal medicinal products.' },
  { id: 'pk', label: 'Pharmacokinetics & pharmacology', short: 'PK',
    about: 'Pharmacokinetics, bioavailability, interactions and modelling.' },
  { id: 'other', label: 'Other topics', short: 'Other',
    about: 'Titles that match none of the keyword rules.' },
];

export const GROUP_BY_ID = Object.fromEntries(GROUPS.map((g) => [g.id, g]));

/** Ordered rules: [groupId, pattern]. */
const RULES = [
  ['vich', /\bVICH\b/],
  ['ich', /\bICH\b/],
  ['psbe', /product-specific bioequivalence/i],
  ['smpc', /core s(?:ummary|mpc)|summary of product characteristics|package leaflet|\bSmPC\b|labell?ing|product information|product literature/i],
  ['herbal', /\bherbal|\bherb\b|\bplant-derived|essential oil/i],
  ['bio', /vaccin|plasma|immunoglobulin|biological|biosimilar|monoclonal|recombinant|gene.therap|cell.based|stem cell|advanced.therap|allergen|\bblood\b|factor (?:VIII|IX)|\bvir(?:al|us)|\bTSE\b|spongiform|immunological|antibod|biotech|insulin|heparin|xenogeneic|\bvectors?\b|genetically modified|\bDNA\b|interferon|somatropin|erythropoietin|epoetin|\bG-CSF\b|cell bank|seed lot|chondrocyte|mycoplasma|adjuvant|antisera|endotoxin|pyrogen/i],
  ['nonclinical', /non-?clinical|pre-?clinical|toxic|carcinogen|genotox|mutagen|juvenile animal|photosafety|environmental|user safety|residue|\bMRLs?\b|withdrawal period|consumer safety|acceptable daily intake|\bADI\b|ecotox|safety pharmacology|animal models?|3Rs|animal testing|injection site/i],
  ['pk', /pharmacokinetic|bioequivalence|bioavailab|interaction|modified.release|biowaiver|pharmacogen|pharmacodynamic|modelling|\bPBPK\b|bioanalytical|exposure.response|dose.finding/i],
  ['quality', /\bquality\b|manufactur|stability|impurit|specification|excipient|sterili[sz]|validation|dosage form|pharmaceutical development|development pharmaceutics|starting material|\bwater\b|packag|chemistry|active substance|finished product|dissolution|container|shelf.life|in-use|radiopharmaceutical|near infrared|real time release|parametric release|inhalation|transdermal|nasal|medicinal gases|declaration of|residual solvent|catalyst|\bGMP\b|pharmacopoeia|storage|process|formulation|tablets|sachets|potency/i],
  ['clinical', /clinical|treatment|efficacy|\btrials?\b|patient|paediatric|children|neonat|elderly|geriatric|prophyla|therap|disease|disorder|prevention|diagnos|infection|cancer|oncolog|antimicrobial|anthelmintic|ectoparasit|parasit|antibacterial|antibiotic|vaccination|syndrome|pain|studies|study|population|registry|registries|biomarker|endpoint|statistic|non-inferiority|multiplicity|missing data|adaptive|subgroup|baseline|placebo|pharmacovigilance|risk management|real.world|dose|target animal|field/i],
];

/** Single-word and salt-style titles are almost all excipient labelling notes. */
const EXCIPIENT = /^[A-Z][\w\- ,()]{2,60}$/;

/**
 * @param {string} title
 * @param {string[]} cats lower-case audiences, e.g. ['human','herbal']
 * @returns {string} group id
 */
export function classify(title, cats) {
  for (const [id, re] of RULES) if (re.test(title)) return id;
  if (cats.length === 1 && cats[0] === 'herbal') return 'herbal';
  if (cats.includes('herbal')) return 'herbal';
  if (title.split(/\s+/).length <= 4 && EXCIPIENT.test(title)) return 'quality';
  return 'other';
}

/**
 * Pulls the reference code regulators actually cite: "Q3D", "E6(R3)", "GL49".
 * @param {string} title
 * @returns {string|null}
 */
export function extractCode(title) {
  let m = /\bVICH\s+GL\s?(\d+)/i.exec(title);
  if (m) return `GL${m[1]}`;
  if (/\bICH\b/.test(title)) {
    m = /\b([EMQS]\d{1,2}[A-Z]?)(?:\s?\((R\d+)\))?(?![\w])/.exec(title.replace(/^.*?\bICH\b/, ''));
    if (m) return m[2] ? `${m[1]}(${m[2]})` : m[1];
  }
  return null;
}

/** ICH series letter → the name the ICH itself uses. */
export const ICH_SERIES = { Q: 'Quality', S: 'Safety', E: 'Efficacy', M: 'Multidisciplinary' };
