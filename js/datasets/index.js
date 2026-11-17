/**
 * The datasets the atlas can show. Each one is a plain object that tells the
 * generic app how to read, filter, colour, arrange and describe its records;
 * see guidelines.js for the smallest complete example.
 */
import guidelines from './guidelines.js';
import medicines from './medicines.js';

export const DATASETS = [guidelines, medicines];
export const DATASET_BY_ID = Object.fromEntries(DATASETS.map((d) => [d.id, d]));
export const DATASET_BY_PREFIX = Object.fromEntries(DATASETS.map((d) => [d.prefix, d]));
