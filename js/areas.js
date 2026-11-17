/**
 * Disease-area classification, inferred from the title.
 *
 * Like the subject groups in classify.js this is a navigation aid, not an EMA
 * field. Rules are ordered and the first match wins; a title that names no
 * disease, organ system or patient condition is "Not disease-specific", which
 * is the honest answer for most quality, non-clinical and procedural texts.
 *
 * Product-specific bioequivalence guidances are titled by substance only, so
 * they are mapped through SUBSTANCE_AREA: a hand-written table giving each
 * substance's main authorised use.
 */

/** @typedef {{id:string,label:string,short:string}} Area */

/** @type {Area[]} */
export const AREAS = [
  { id: 'infection', label: 'Infections, parasites & vaccines', short: 'Infections' },
  { id: 'oncology', label: 'Oncology', short: 'Oncology' },
  { id: 'cardio', label: 'Cardiovascular', short: 'Cardiovascular' },
  { id: 'haem', label: 'Haematology & blood products', short: 'Haematology' },
  { id: 'neuro', label: 'Neurology', short: 'Neurology' },
  { id: 'psych', label: 'Psychiatry', short: 'Psychiatry' },
  { id: 'endo', label: 'Endocrinology & metabolism', short: 'Endocrine' },
  { id: 'immuno', label: 'Immunology, rheumatology & bone', short: 'Immunology' },
  { id: 'resp', label: 'Respiratory & allergy', short: 'Respiratory' },
  { id: 'gastro', label: 'Gastroenterology & hepatology', short: 'Gastro' },
  { id: 'renal', label: 'Nephrology & urology', short: 'Renal' },
  { id: 'repro', label: 'Reproductive health & pregnancy', short: 'Reproductive' },
  { id: 'pain', label: 'Pain & anaesthesia', short: 'Pain' },
  { id: 'derm', label: 'Dermatology', short: 'Dermatology' },
  { id: 'eye', label: 'Ophthalmology', short: 'Eye' },
  { id: 'general', label: 'No disease named', short: 'No disease named' },
];

export const AREA_BY_ID = Object.fromEntries(AREAS.map((a) => [a.id, a]));

/** Substance (lower case, as the title starts) → area, for bioequivalence guidances. */
const SUBSTANCE_AREA = {
  oncology:
    'niraparib everolimus dabrafenib azacitidine paclitaxel nilotinib trametinib bosutinib olaparib ibrutinib enzalutamide dasatinib lapatinib palbociclib sorafenib abiraterone alectinib gefitinib cabozantinib vismodegib pegylated crizotinib vandetanib vemurafenib pazopanib lenalidomide sunitinib capecitabine imatinib erlotinib aprepitant',
  infection:
    'raltegravir ledipasvir emtricitabine rilpivirine entecavir dolutegravir oseltamivir posaconazole voriconazole liposomal elvitegravir telithromycin',
  endo: 'semaglutide liraglutide sitagliptin metformin repaglinide exenatide levothyroxine carglumic miglustat cholic octreotide lanreotide',
  cardio: 'aliskiren ticagrelor rivaroxaban dronedarone prasugrel dabigatran apixaban acenocoumarol ezetimibe',
  neuro: 'zonisamide fingolimod memantine fampridine dimethyl levodopa',
  psych: 'vortioxetine lurasidone methylphenidate paliperidone agomelatine asenapine melatonin',
  haem: 'eltrombopag deferasirox',
  immuno: 'tofacitinib tacrolimus sirolimus colchicine',
  pain: 'ibuprofen paracetamol',
  gastro: 'ursodeoxycholic budesonide,',
  renal: 'tolvaptan tadalafil',
  resp: 'pirfenidone',
  repro: 'etonogestrel',
};
const AREA_OF_SUBSTANCE = new Map(
  Object.entries(SUBSTANCE_AREA).flatMap(([area, names]) => names.split(' ').map((n) => [n, area])),
);

/** Ordered rules: [areaId, pattern]. */
const RULES = [
  ['oncology', /cancer|oncolog|oncolytic|anticancer|anti-cancer|tumou?rs?\b|neoplas|leuk(?:a)?emia|lymphoma|myeloma|carcinoma|melanoma|cytotoxic|chemotherap|radiotherap|fibrosarcoma|haematological malignanc/i],
  ['eye', /ophthalm|\beye\b|ocular|glaucoma|macular|retin(?:al|opathy)/i],
  ['derm', /dermat|psoria(?:sis|tic)(?! arthritis)|\bacne\b|\bskin\b|eczema|\bcutaneous|wound|alopecia/i],
  ['haem', /haemophilia|\bh(?:a)?emato|factor (?:VIII|IX|VII)|coagulation|von Willebrand|an(?:a)?emia|thalass(?:a)?emia|sickle|immunoglobulin|plasma.derived|plasma master|\bplasma\b|\bblood\b(?! level)|antithrombin|prothrombin|fibrin|human albumin|granulocyte|thrombocytop|neutropenia|iron (?:overload|deficien)|erythropoietin|epoetin|\bG-CSF\b|filgrastim|haemoglobin/i],
  ['cardio', /cardio|cardiac|\bheart\b|hypertension(?! in the lung)|anti-?arrhythm|arrhythmi|atrial|\bQT\b|coronary|angina|myocardial|lipid|cholesterol|thrombo(?:embol|sis|tic)|anticoagul|antiplatelet|stroke|peripheral.arterial|\bvascular|\bvenous|heparin|atheroscl|fibrinolytic|acetyl-salicylic/i],
  ['resp', /asthma|\bCOPD\b|chronic obstructive|respiratory|pulmonary|\blung\b|cystic fibrosis|inhal|nasal|rhinitis|rhino|allerg|bronch|cough|metered dose/i],
  ['infection', /(?<!non-)infect|antibacterial|antibiotic|antimicrobial(?! preservative)|antiviral|antifungal|\bHIV\b|hepatitis|tubercul|malaria|influenza|vaccin|respiratory syncytial|bacteri(?!al endotoxin)|sepsis|fung(?:al|i)|parasit|anthelmintic|helminth|coccidi|\bflea|\btick|\bmite|\blice\b|\bfl(?:y|ies)\b|mastitis|smallpox|pandemic|COVID|coronavirus|pneumococ|meningococ|\bMRSA\b|staphylococc|\bresistance\b|macrolides|aminoglycosides|cephalosporins|quinolones|aminopenicillins|pleuromutilins|colistin|polymyxin|tetracyclin|intramammary|bluetongue|foot-and-mouth|rabies|avian|swine fever|salmonell|leishmani|pathogen|zoonotic|insecticid|nematod|varroa|bacteriophage/i],
  ['immuno', /rheumat|arthritis|\blupus\b|systemic sclerosis|scleroderma|ankylosing|spondyl|osteopor|osteoarthr|\bbone\b|\bgout\b|transplant|immunosuppress|immune.mediated|autoimmun|musculoskeletal|cartilage|chondrocyte|lameness|sarcopenia|fibromyalgia/i],
  ['endo', /diabet|insulin|obesity|weight control|thyroid|growth hormone|somatropin|endocrin|metabol(?:ic|ism) disorder|lipodystrophy|hyperphosphat|hypogonad|acromegal|gaucher|lysosomal|enzyme replacement|inborn error|glucagon/i],
  ['gastro', /crohn|ulcerative colitis|irritable bowel|bowel|gastro|\bliver\b|hepatic|cirrhosis|biliary|cholangitis|reflux|constipation|diarrh|nausea|emesis|pancrea|helicobacter|colitis|oesophag|ruminal|digestive/i],
  ['renal', /kidney|renal|nephro|urolog|urinary|incontinence|prostat|erectile|bladder|dialysis|hyperkal/i],
  ['repro', /contracept|hormone replacement|menopaus|pregnan|fertility|reproduct|lactation|breastfeeding|gyn(?:a)?ecolog|endometri|\boestr(?:ogen|adiol|us)|\bestr(?:ogen|adiol)|\buterine|zootechnical|\bsex hormone|vaginal|follicle/i],
  ['psych', /depress|schizophren|anxiety|bipolar|\bADHD\b|attention.deficit|panic|insomnia|sleep|obsessive|autis|psychiatr|psychos|alcohol depend|smoking|nicotine|dependence potential|drug dependence|abuse|post-?traumatic|social (?:anxiety|phobia)|premenstrual dysphoric|\bSSRIs?\b|suicid|behaviou?ral/i],
  ['neuro', /duchenne|muscular dystrophy|muscular atrophy|interferon beta|epilep|parkinson|alzheimer|dementia|multiple sclerosis|migraine|neuro|amyotrophic|\bALS\b|huntington|spinal|seizure|stroke|cerebr|myasthenia|restless legs|neuropath|\bCNS\b|central nervous/i],
  ['pain', /\bpain\b|analges|an(?:a)?esthe|sedati|opioid|nociceptive|\bNSAIDs?\b|non-steroidal anti-inflammatory|anti-inflammatory/i],
];

/**
 * @param {string} title
 * @returns {string} area id
 */
export function classifyArea(title) {
  if (/product-specific bioequivalence/i.test(title)) {
    const first = title.trim().split(/[\s/]+/)[0].toLowerCase();
    return AREA_OF_SUBSTANCE.get(first) ?? 'general';
  }
  for (const [id, re] of RULES) if (re.test(title)) return id;
  return 'general';
}
