/**
 * The regulatory stage of each scientific guideline, set within EMA's own
 * description of a medicine's lifecycle.
 *
 * EMA's regulatory pages divide the lifecycle into three stages, Research and
 * development, Marketing authorisation and Post-authorisation, and list
 * further "topics that span the product lifecycle":
 * https://www.ema.europa.eu/en/human-regulatory-overview and
 * https://www.ema.europa.eu/en/veterinary-regulatory-overview
 *
 * Each guideline was assessed into one of six finer stages by reading its
 * current document (data/guideline-stages.json, built by
 * scripts/stages/build.mjs following scripts/stages/RULES.md). The
 * assessments are this project's, not EMA's.
 */

/** EMA's lifecycle stages, in order, and the topics that span them. */
export const EMA_STAGES = [
  { id: 'rd', label: 'Research and development', short: 'R&D', url: 'https://www.ema.europa.eu/en/human-regulatory-overview/research-development' },
  { id: 'ma', label: 'Marketing authorisation', short: 'Authorisation', url: 'https://www.ema.europa.eu/en/human-regulatory-overview/marketing-authorisation' },
  { id: 'pa', label: 'Post-authorisation', short: 'Post-authorisation', url: 'https://www.ema.europa.eu/en/human-regulatory-overview/post-authorisation' },
  { id: 'span', label: 'Topics that span the product lifecycle', short: 'Spans the lifecycle', url: 'https://www.ema.europa.eu/en/human-regulatory-overview#topics-that-span-the-product-lifecycle-38489' },
];
export const EMA_STAGE_BY_ID = Object.fromEntries(EMA_STAGES.map((s) => [s.id, s]));

/** The six stages the guidelines were assessed into, each inside one of EMA's. */
export const STAGES = [
  { id: 'NC', label: 'Non-clinical development', short: 'Non-clinical', ema: 'rd',
    about: 'Laboratory and animal studies before and alongside trials: toxicology, safety pharmacology, residues, environmental risk.' },
  { id: 'CD', label: 'Clinical development', short: 'Clinical', ema: 'rd',
    about: 'Trials in people, or in the target animals: design, conduct, statistics, disease-specific efficacy and safety, paediatric development.' },
  { id: 'MA', label: 'Marketing authorisation', short: 'Authorisation', ema: 'ma',
    about: 'What an application must contain and show: dossier format, bioequivalence for generics, biosimilarity, product information.' },
  { id: 'PA', label: 'Post-authorisation', short: 'Post-authorisation', ema: 'pa',
    about: 'Life after approval: pharmacovigilance, risk management, variations, renewals, safety reviews of marketed products.' },
  { id: 'QM', label: 'Quality and manufacturing', short: 'Quality', ema: 'span',
    about: 'Pharmaceutical development, manufacture, GMP, specifications and stability. Built in development, filed in the dossier and kept up after approval.' },
  { id: 'XC', label: 'Cross-cutting', short: 'Cross-cutting', ema: 'span',
    about: 'Guidance that applies equally across the stages, such as terminology and general principles.' },
];
export const STAGE_BY_ID = Object.fromEntries(STAGES.map((s) => [s.id, s]));

export const CONFIDENCE = {
  high: { label: 'High', token: '--conf-high' },
  medium: { label: 'Medium', token: '--conf-medium' },
  low: { label: 'Low', token: '--conf-low' },
};

/** Why an assessment is less than certain, in words for the card. */
export const CONFIDENCE_REASONS = {
  'spans-stages': 'it covers more than one stage about equally',
  'outside-framework': 'it serves a procedure the six stages do not name',
  'policy-paper': 'it is a reflection, position or concept paper whose stage depends on what follows it',
  'limited-source': 'little text was available to judge from',
};

/**
 * The Lifecycle arrangement as a timeline: a medicine's life runs left to
 * right, EMA's three stages are phases along it, its milestones are gates
 * across it, and each assessed stage is a bar over the part of the life it
 * applies to, as in a Gantt chart. Bars overlap where the work does:
 * non-clinical studies continue through the trials, and quality and
 * cross-cutting guidance spans the whole life.
 *
 * The scale is schematic, not proportional: development takes years, the
 * authorisation procedure months. Durations are EMA's
 * (https://www.ema.europa.eu/en/human-regulatory-overview/marketing-authorisation/obtaining-eu-marketing-authorisation-step-step).
 */
export const TIMELINE = {
  end: 100,
  phases: [
    { ema: 'rd', from: 0, to: 44, span: '8–15 years', short: 'R&D' },
    { ema: 'ma', from: 44, to: 74, span: 'about a year', short: 'Authorisation' },
    { ema: 'pa', from: 74, to: 100, span: 'on the market', short: 'Post-auth.' },
  ],
  milestones: [
    { at: 14, label: 'First trials in people', short: 'Trials' },
    { at: 44, label: 'Application', short: 'Filed', about: 'Marketing authorisation application submitted to EMA' },
    { at: 62, label: 'Opinion', about: 'CHMP or CVMP opinion, within 210 active days' },
    { at: 74, label: 'Decision', about: 'European Commission decision, within 67 days of the opinion' },
  ],
  /** Bars, back to front: [from, to] on the timeline. */
  lanes: [
    { id: 'NC', from: 0, to: 44 },
    { id: 'CD', from: 14, to: 44 },
    { id: 'MA', from: 44, to: 74 },
    { id: 'PA', from: 74, to: 100 },
    { id: 'QM', from: 0, to: 100, spans: true },
    { id: 'XC', from: 0, to: 100, spans: true },
  ],
};

/** `{ url → assessment }` from data/guideline-stages.json; unusable entries are skipped. */
export function indexStages(file) {
  const map = new Map();
  for (const s of Array.isArray(file?.stages) ? file.stages : []) {
    if (!s || typeof s.url !== 'string' || !STAGE_BY_ID[s.stage]) continue;
    map.set(s.url, {
      stage: s.stage,
      secondary: STAGE_BY_ID[s.secondary] ? s.secondary : null,
      confidence: s.confidence in CONFIDENCE ? s.confidence : 'medium',
      reason: s.confidence_reason in CONFIDENCE_REASONS ? s.confidence_reason : null,
      foodChain: s.food_chain === true,
      reasoning: String(s.reasoning ?? ''),
      evidence: String(s.evidence ?? ''),
      evidenceSource: ['page summary', 'document title'].includes(s.evidence_source) ? s.evidence_source : 'document',
      document: typeof s.document === 'string' ? s.document : null,
      documentStatus: typeof s.document_status === 'string' ? s.document_status : null,
      documentUrl: typeof s.document_url === 'string' ? s.document_url : null,
    });
  }
  return map;
}
