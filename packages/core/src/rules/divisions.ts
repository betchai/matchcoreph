import type { Discipline } from '../domain/enums.js';
import { MATCH_LEVELS } from '../domain/enums.js';

export interface DivisionDefault {
  code: string;
  name: string;
  discipline: Discipline;
  majorAllowed: boolean;
  minorAllowed: boolean;
  prefixMajor: boolean;
  maximumCapacity: number | null;
  notes: string;
}

/**
 * Default division catalogue available on match creation. Stored as database
 * rows and scoped to a ruleset — never hard-coded into scoring logic.
 *
 * Power factor eligibility follows the IPSC Handgun January 2026 edition:
 *  - Open   : Major or Minor allowed
 *  - Standard: Major or Minor allowed
 *  - Classic: Major or Minor allowed (Classic declared-Major loads limited to 8)
 *  - Production / Production Optics / Production Optics Light: Minor only
 *  - Revolver: Major or Minor allowed
 */
export const DIVISION_DEFAULTS: DivisionDefault[] = [
  { code: 'OPEN', name: 'Open', discipline: 'HANDGUN', majorAllowed: true, minorAllowed: true, prefixMajor: false, maximumCapacity: null, notes: 'Unlimited modifications; optics and compensators allowed.' },
  { code: 'STANDARD', name: 'Standard', discipline: 'HANDGUN', majorAllowed: true, minorAllowed: true, prefixMajor: false, maximumCapacity: null, notes: '' },
  { code: 'PRODUCTION', name: 'Production', discipline: 'HANDGUN', majorAllowed: false, minorAllowed: true, prefixMajor: false, maximumCapacity: null, notes: 'Approved handgun list only; Minor power factor scoring only.' },
  { code: 'PRODUCTION_OPTICS', name: 'Production Optics', discipline: 'HANDGUN', majorAllowed: false, minorAllowed: true, prefixMajor: false, maximumCapacity: null, notes: 'Approved handgun list with optical sight; Minor only.' },
  { code: 'PRODUCTION_OPTICS_LIGHT', name: 'Production Optics Light', discipline: 'HANDGUN', majorAllowed: false, minorAllowed: true, prefixMajor: false, maximumCapacity: null, notes: 'Production Optics Light division.' },
  { code: 'CLASSIC', name: 'Classic', discipline: 'HANDGUN', majorAllowed: true, minorAllowed: true, prefixMajor: false, maximumCapacity: null, notes: 'Classic (single-action) — declared Major limited to 8 rounds loaded.' },
  { code: 'REVOLVER', name: 'Revolver', discipline: 'HANDGUN', majorAllowed: true, minorAllowed: true, prefixMajor: false, maximumCapacity: null, notes: '' },
  { code: 'PCC_OPTICS', name: 'PCC Optics', discipline: 'PCC', majorAllowed: false, minorAllowed: true, prefixMajor: false, maximumCapacity: null, notes: '' },
  { code: 'PCC_IRON', name: 'PCC Iron', discipline: 'PCC', majorAllowed: false, minorAllowed: true, prefixMajor: false, maximumCapacity: null, notes: '' },
  { code: 'SA_OPEN', name: 'Semi Auto Open', discipline: 'RIFLE', majorAllowed: true, minorAllowed: true, prefixMajor: false, maximumCapacity: null, notes: '' },
  { code: 'SA_STANDARD', name: 'Semi Auto Standard', discipline: 'RIFLE', majorAllowed: true, minorAllowed: true, prefixMajor: false, maximumCapacity: null, notes: '' },
  { code: 'MAC', name: 'Manual Action Contemporary', discipline: 'RIFLE', majorAllowed: true, minorAllowed: true, prefixMajor: false, maximumCapacity: null, notes: '' },
  { code: 'MAB', name: 'Manual Action Bolt', discipline: 'RIFLE', majorAllowed: true, minorAllowed: true, prefixMajor: false, maximumCapacity: null, notes: '' },
  { code: 'MR_OPEN', name: 'Open', discipline: 'MINI_RIFLE', majorAllowed: false, minorAllowed: true, prefixMajor: false, maximumCapacity: null, notes: '' },
  { code: 'MR_STANDARD', name: 'Standard', discipline: 'MINI_RIFLE', majorAllowed: false, minorAllowed: true, prefixMajor: false, maximumCapacity: null, notes: '' },
  { code: 'SG_OPEN', name: 'Open', discipline: 'SHOTGUN', majorAllowed: false, minorAllowed: true, prefixMajor: false, maximumCapacity: null, notes: '' },
  { code: 'SG_MODIFIED', name: 'Modified', discipline: 'SHOTGUN', majorAllowed: false, minorAllowed: true, prefixMajor: false, maximumCapacity: null, notes: '' },
  { code: 'SG_STANDARD', name: 'Standard', discipline: 'SHOTGUN', majorAllowed: false, minorAllowed: true, prefixMajor: false, maximumCapacity: null, notes: '' },
  { code: 'SG_STANDARD_MANUAL', name: 'Standard Manual', discipline: 'SHOTGUN', majorAllowed: false, minorAllowed: true, prefixMajor: false, maximumCapacity: null, notes: '' },
  { code: 'AA_OPEN', name: 'Open', discipline: 'ACTION_AIR', majorAllowed: false, minorAllowed: true, prefixMajor: false, maximumCapacity: null, notes: '' },
  { code: 'AA_STANDARD', name: 'Standard', discipline: 'ACTION_AIR', majorAllowed: false, minorAllowed: true, prefixMajor: false, maximumCapacity: null, notes: '' },
  { code: 'AA_CLASSIC', name: 'Classic', discipline: 'ACTION_AIR', majorAllowed: false, minorAllowed: true, prefixMajor: false, maximumCapacity: null, notes: '' },
  { code: 'AA_PRODUCTION', name: 'Production', discipline: 'ACTION_AIR', majorAllowed: false, minorAllowed: true, prefixMajor: false, maximumCapacity: null, notes: '' },
  { code: 'AA_PRODUCTION_OPTICS', name: 'Production Optics', discipline: 'ACTION_AIR', majorAllowed: false, minorAllowed: true, prefixMajor: false, maximumCapacity: null, notes: '' },
];

export const MATCH_LEVEL_LABELS: Record<(typeof MATCH_LEVELS)[number], string> = {
  1: 'Level I',
  2: 'Level II',
  3: 'Level III',
  4: 'Level IV',
  5: 'Level V',
};

export function divisionsForDiscipline(discipline: Discipline): DivisionDefault[] {
  return DIVISION_DEFAULTS.filter((d) => d.discipline === discipline);
}