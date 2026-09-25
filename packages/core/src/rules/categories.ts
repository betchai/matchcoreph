export interface CategoryDefault {
  code: string;
  name: string;
  description: string;
}

export const CATEGORY_DEFAULTS: CategoryDefault[] = [
  { code: 'OVERALL', name: 'Overall', description: 'All competitors.' },
  { code: 'LADY', name: 'Lady', description: 'Female competitors.' },
  { code: 'JUNIOR', name: 'Junior', description: 'Competitors within the junior age band.' },
  { code: 'SENIOR', name: 'Senior', description: 'Competitors within the senior age band.' },
  { code: 'SUPER_SENIOR', name: 'Super Senior', description: 'Competitors within the super senior age band.' },
];

/** Age-band defaults (configurable per match/ruleset; not an official classification without explicit configuration). */
export interface CategoryAgeBand {
  /** Inclusive lower year, exclusive upper year. null = open ended. */
  junior: { min: number | null; max: number | null };
  senior: { min: number | null; max: number | null };
  superSenior: { min: number | null; max: number | null };
}

export const CATEGORY_AGE_BANDS: CategoryAgeBand = {
  junior: { min: null, max: 21 },
  senior: { min: 50, max: null },
  superSenior: { min: 60, max: null },
};