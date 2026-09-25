import type { Discipline, ScoringMethod, TargetType } from '../domain/enums.js';

export interface DisciplineDefinition {
  code: Discipline;
  name: string;
  abbreviation: string;
  defaultRulesetKey: string;
  scoringMethods: ScoringMethod[];
  targetTypes: TargetType[];
  notes: string;
}

export const DISCIPLINE_DEFINITIONS: Record<Discipline, DisciplineDefinition> = {
  HANDGUN: {
    code: 'HANDGUN',
    name: 'Handgun',
    abbreviation: 'HG',
    defaultRulesetKey: 'PPSA-HANDGUN-2026',
    scoringMethods: ['COMSTOCK', 'VIRGINIA_COUNT', 'FIXED_TIME', 'PSMOC_POINTS_FACTOR', 'PSMOC_TIME'],
    targetTypes: ['PAPER', 'PAPER_NO_SHOOT', 'STEEL', 'POPPER', 'PLATE', 'CUSTOM'],
    notes: 'Handgun discipline. IPSC/PPSA rulesets use Comstock/Virginia Count/Fixed Time with power-factor Major/Minor point tables. PSMOC rulesets add Points Factor and Time Scoring with full-load/minimum-load tables. Paper target zones A/C/D; poppers and plates score on knockdown.',
  },
  PCC: {
    code: 'PCC',
    name: 'Pistol Calibre Carbine',
    abbreviation: 'PCC',
    defaultRulesetKey: 'IPSC-PCC-2026',
    scoringMethods: ['COMSTOCK', 'VIRGINIA_COUNT', 'FIXED_TIME'],
    targetTypes: ['PAPER', 'PAPER_NO_SHOOT', 'STEEL', 'POPPER', 'PLATE', 'CUSTOM'],
    notes: 'IPSC Pistol Calibre Carbine discipline.',
  },
  RIFLE: {
    code: 'RIFLE',
    name: 'Rifle',
    abbreviation: 'RF',
    defaultRulesetKey: 'IPSC-RIFLE-2026',
    scoringMethods: ['COMSTOCK', 'VIRGINIA_COUNT', 'FIXED_TIME'],
    targetTypes: ['PAPER', 'PAPER_NO_SHOOT', 'STEEL', 'POPPER', 'PLATE', 'CUSTOM'],
    notes: 'IPSC Rifle discipline.',
  },
  MINI_RIFLE: {
    code: 'MINI_RIFLE',
    name: 'Mini Rifle',
    abbreviation: 'MR',
    defaultRulesetKey: 'IPSC-MINI-RIFLE-2026',
    scoringMethods: ['COMSTOCK', 'VIRGINIA_COUNT', 'FIXED_TIME'],
    targetTypes: ['PAPER', 'PAPER_NO_SHOOT', 'STEEL', 'POPPER', 'PLATE', 'CUSTOM'],
    notes: 'IPSC Mini Rifle discipline.',
  },
  SHOTGUN: {
    code: 'SHOTGUN',
    name: 'Shotgun',
    abbreviation: 'SG',
    defaultRulesetKey: 'IPSC-SHOTGUN-2026',
    scoringMethods: ['COMSTOCK', 'VIRGINIA_COUNT', 'FIXED_TIME'],
    targetTypes: ['PAPER', 'PAPER_NO_SHOOT', 'STEEL', 'POPPER', 'PLATE', 'CUSTOM'],
    notes: 'IPSC Shotgun discipline. Shotgun stages also apply pellet-count scoring policies configured per ruleset.',
  },
  ACTION_AIR: {
    code: 'ACTION_AIR',
    name: 'Action Air',
    abbreviation: 'AA',
    defaultRulesetKey: 'IPSC-ACTION-AIR-2026',
    scoringMethods: ['COMSTOCK', 'VIRGINIA_COUNT', 'FIXED_TIME'],
    targetTypes: ['PAPER', 'PAPER_NO_SHOOT', 'STEEL', 'POPPER', 'PLATE', 'CUSTOM'],
    notes: 'IPSC Action Air discipline family.',
  },
};

export const DISCIPLINE_CODES = Object.keys(DISCIPLINE_DEFINITIONS) as Discipline[];

export function disciplineName(code: Discipline): string {
  return DISCIPLINE_DEFINITIONS[code]?.name ?? code;
}