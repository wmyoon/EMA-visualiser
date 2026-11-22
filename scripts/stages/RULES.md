# Regulatory stage of each scientific guideline: assessment rules

Each of EMA's 1,001 scientific guidelines is given the stage of the regulatory
process it mainly concerns. The judgement is made by reading the guideline's
current document (`.cache/guidelines/text/<id>.txt`, made by
`npm run download-guidelines`). Each assessment records its reasoning and a
quote from the document as evidence.

## EMA's framework

EMA's regulatory pages describe the life of a medicine in three stages and a
group of topics that span them
([human](https://www.ema.europa.eu/en/human-regulatory-overview),
[veterinary](https://www.ema.europa.eu/en/veterinary-regulatory-overview)):

| EMA stage | What EMA files there |
|---|---|
| **Research and development** | Clinical trials, scientific advice, paediatric and orphan development, PRIME, quality by design, ethical use of animals, scientific guidelines; for veterinary medicines also maximum residue limits and limited markets |
| **Marketing authorisation** | Pre-authorisation guidance, application types (generic and hybrid, biosimilar, conditional, accelerated), evaluation, product information; for veterinary medicines also environmental risk assessment |
| **Post-authorisation** | Variations, renewals, pharmacovigilance, referrals, quality defects and recalls, shortages, transfers |
| **Topics that span the product lifecycle** | Compliance (GMP, GCP, GLP), pharmacovigilance overview, advanced therapies, biosimilars, plasma master files, public health threats |

The six stages used here sit inside that framework:

| Code | Stage | Within EMA's framework |
|---|---|---|
| `NC` | Non-clinical development | Research and development |
| `CD` | Clinical development | Research and development |
| `MA` | Marketing authorisation | Marketing authorisation |
| `PA` | Post-authorisation | Post-authorisation |
| `QM` | Quality and manufacturing | Spans the lifecycle: quality is built in development, filed in the dossier and kept up through GMP and variations, and EMA lists compliance among the topics that span the lifecycle |
| `XC` | Cross-cutting | Spans the lifecycle |

## What to record

One JSON object per guideline:

```json
{"id": "126cwx2", "stage": "MA", "secondary": "CD", "confidence": "high",
 "confidence_reason": null, "food_chain": false,
 "reasoning": "One to three plain sentences.",
 "evidence": "A short quote, copied exactly from the document"}
```

- **stage**: the one stage the guideline mainly concerns. Judge by what the
  guideline asks the reader to do, not by which EMA web section it sits in.
- **secondary**: a second stage it clearly also serves, or `null`. Never the
  same as `stage`.
- **confidence**: `high` when the rules below or the document settle it;
  `medium` when two stages are close; `low` when the document gives little to
  go on.
- **confidence_reason**: `null` for high confidence; otherwise one of
  - `spans-stages`: the guideline covers two or more stages about equally;
  - `outside-framework`: it serves a procedure the six stages do not name
    (master-file certification, a classification or scope decision);
  - `policy-paper`: a reflection, position or concept paper whose stage
    depends on what it eventually leads to;
  - `limited-source`: only the page summary, a very short note or a scan was
    available.
- **food_chain**: `true` when the subject is the safety of food from treated
  animals (residues, maximum residue limits, withdrawal periods, consumer
  safety) or antimicrobial resistance reaching people through food.
  Otherwise `false`. It is normally only true for veterinary guidelines.
- **reasoning**: one to three sentences in plain English saying what the
  guideline governs and why that puts it in the stage. Do not repeat the
  title. Do not start with "This guideline".
- **evidence**: 8 to 40 words copied exactly from the document text (or,
  when there is no text, from the page summary) that best shows the
  guideline's purpose or scope. The recorder checks it word for word,
  ignoring case, punctuation and bare numbers. A quote that runs across a
  hyphenated line break may fail; pick another.

## Conventions

These settle the common cases. Follow them so that similar guidelines land in
the same place.

**Clinical development (`CD`)**
- Guidelines on the clinical investigation of medicines for a disease,
  condition or population: `CD`, secondary `MA`.
- Clinical trial design, conduct and statistics (ICH E series on trials, GCP,
  platform trials, multiregional trials, paediatric trials, first-in-human):
  `CD`.
- Clinical pharmacology and pharmacokinetics (interactions, PK in organ
  impairment, exposure-response, modelling and simulation, pharmacogenomics):
  `CD`, secondary `MA`.
- Biomarkers and qualification of novel methods: `CD`.
- Veterinary studies in the target species (target animal safety, efficacy,
  field trials, VICH GCP, anthelmintic and ectoparasiticide efficacy): `CD`,
  secondary `MA`.
- Clinical sections of advanced-therapy and vaccine guidelines: `CD`.

**Non-clinical development (`NC`)**
- Toxicology, safety pharmacology, genotoxicity, carcinogenicity,
  reproductive toxicity, ICH S series, immunogenicity in animals: `NC`.
- Environmental risk assessment, ecotoxicity, fate in soil, water or manure:
  `NC`, secondary `MA`.
- User safety of veterinary medicines: `NC`, secondary `MA`.
- Veterinary residue studies: methods for residue safety and residue
  kinetics (VICH GL22 to GL57, acceptable daily intake, acute reference dose,
  metabolism and marker-residue depletion studies, analytical methods for
  residue studies): `NC`, `food_chain: true`.

**Quality and manufacturing (`QM`)**
- Pharmaceutical development, manufacture, process validation, GMP,
  specifications, stability, impurities, excipient quality, container
  closure, sterilisation, ICH Q series, quality of biologicals and advanced
  therapies, antigen and plasma master-file content: `QM`.
- Quality changes after authorisation (comparability after a manufacturing
  change, post-approval change management): `QM`, secondary `PA`.

**Marketing authorisation (`MA`)**
- What an application must contain, dossier format (CTD), data requirements
  for an application type: `MA`.
- Bioequivalence, both the general guideline and product-specific
  bioequivalence guidance: `MA`, secondary `CD`.
- Biosimilarity (comparability with a reference product for a biosimilar):
  `MA`, secondary `CD` (or `QM` for quality comparability).
- Product information: SmPC, package leaflet, labelling, excipients in the
  labelling and package leaflet, core SmPCs: `MA`, secondary `PA`.
- Herbal monographs, list entries and data requirements for herbal and
  traditional herbal registrations: `MA`.
- Veterinary maximum residue limits as a procedure or policy (data
  requirements for MRL applications, extrapolating MRLs to other species,
  whether a substance needs an MRL, risk-analysis approach): `MA`,
  secondary `NC`, `food_chain: true`.
- Veterinary withdrawal periods (milk, edible tissue, injection sites):
  `MA`, secondary `NC`, `food_chain: true`.
- Veterinary limited markets and minor use or minor species: data
  requirements for applications: `MA`, secondary `NC`; `food_chain: true`
  when residue data are involved.
- Antimicrobial resistance risk to people assessed for an application:
  `MA`, secondary `NC`; `food_chain: true` for food-producing animals.

**Post-authorisation (`PA`)**
- Pharmacovigilance, risk management, PSURs, post-authorisation safety and
  efficacy studies, signal management: `PA` (risk management plans:
  secondary `MA`).
- Variations, renewals, referrals, safety reviews of products already on the
  market, quality defects: `PA`.
- Reflection papers on the use of antimicrobial classes already authorised in
  animals (resistance and its impact on human health): `PA`, secondary `XC`;
  `food_chain: true` for food-producing animals.

**Cross-cutting (`XC`)**
- Use sparingly: terminology, data standards, principles that apply equally
  to every stage (for example the 3Rs across testing, general guidance on
  guideline development itself).

**Other documents**
- Concept papers and reflection papers: assess the subject the guideline will
  cover. If that leaves the stage open, lower the confidence with
  `policy-paper`.
- Questions and answers: assess by subject.
- Where only the page summary was available, say so in the reasoning and use
  `limited-source` if it lowers confidence.
