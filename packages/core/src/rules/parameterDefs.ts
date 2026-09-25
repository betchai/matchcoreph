import type { ExtraHitPolicy, ScoringZone, TieBreakMethod } from '../domain/enums.js';

export interface ScoringRuleParams {
  paperPointsMinor: Record<ScoringZone, number>;
  paperPointsMajor: Record<ScoringZone, number>;
  /** PSMOC Full Load paper point values (A=5, C=4, D=2 by default). Governs stages declared as FULL_LOAD. */
  paperPointsFullLoad: Record<ScoringZone, number>;
  /** PSMOC Minimum Load paper point values (A=5, C=3, D=1 by default). Governs stages declared as MINIMUM_LOAD. */
  paperPointsMinimumLoad: Record<ScoringZone, number>;
  steelPointValue: number;
  paperDefaultRequiredHits: number;
  missPenalty: number;
  noShootPenalty: number;
  proceduralPenalty: number;
  otherPenalty: number;
  extraHitPolicy: ExtraHitPolicy;
  /** PSMOC: permits unlimited shots on targets when true (shots fired beyond the
   *  stipulated maximum incur no additional procedural). Configurable per ruleset. */
  psmocUnlimitedShots: boolean;
  virginiaCountExtraShotsProcedural: boolean;
  virginiaCountMissingShotsAsMiss: boolean;
  fixedTimeStopsAtFixedTime: boolean;
  stagePointsMinZero: boolean;
  tieBreakMethod: TieBreakMethod;
  allowZeroTime: boolean;
  minorPowerFactorMinimum: number;
  majorPowerFactorMinimum: number;
  precisionHitFactor: number;
  precisionStagePoints: number;
  precisionTime: number;
  // PSMOC Time Scoring: seconds added to the raw time per scoring-zone hit and
  // per rule-defined penalty. All values are ruleset parameters, never hard-coded.
  timeAdjustAlpha: number;
  timeAdjustCharlie: number;
  timeAdjustDelta: number;
  timePenaltyMiss: number;
  timePenaltyNoShoot: number;
  timePenaltyProcedural: number;
  timePenaltyOther: number;
}

export interface RuleParameterDef {
  key: string;
  label: string;
  description: string;
  defaultValue: string;
  parse: (value: string) => unknown;
}

const parseZoneMap = (value: string): Record<ScoringZone, number> => {
  const map: Record<ScoringZone, number> = { A: 0, C: 0, D: 0 };
  for (const entry of value.split(',')) {
    const [zone, points] = entry.split(':');
    const z = zone as ScoringZone;
    if (z === 'A' || z === 'C' || z === 'D') map[z] = Number(points);
  }
  return map;
};

const parseBool = (value: string): boolean => value.toLowerCase() === 'true';

export const RULE_PARAMETER_DEFS: readonly RuleParameterDef[] = [
  {
    key: 'scoring.paper.fullLoad',
    label: 'Paper target point values (PSMOC Full Load)',
    description: 'Points awarded per scoring zone on paper targets for PSMOC Full Load stages. PSMOC: A=5, C=4, D=2.',
    defaultValue: 'A:5,C:4,D:2',
    parse: parseZoneMap,
  },
  {
    key: 'scoring.paper.minimumLoad',
    label: 'Paper target point values (PSMOC Minimum Load)',
    description: 'Points awarded per scoring zone on paper targets for PSMOC Minimum Load stages. PSMOC: A=5, C=3, D=1.',
    defaultValue: 'A:5,C:3,D:1',
    parse: parseZoneMap,
  },
  {
    key: 'scoring.paper.minor',
    label: 'Paper target point values (Minor power factor)',
    description: 'Points awarded per scoring zone on paper targets for Minor. IPSC Handgun: A=5, C=3, D=1.',
    defaultValue: 'A:5,C:3,D:1',
    parse: parseZoneMap,
  },
  {
    key: 'scoring.paper.major',
    label: 'Paper target point values (Major power factor)',
    description: 'Points awarded per scoring zone on paper targets for Major. IPSC Handgun: A=5, C=4, D=2.',
    defaultValue: 'A:5,C:4,D:2',
    parse: parseZoneMap,
  },
  {
    key: 'scoring.steel.pointValue',
    label: 'Steel / Popper / Plate point value per hit',
    description: 'IPSC: poppers and plates score 5 points each when hit.',
    defaultValue: '5',
    parse: Number,
  },
  {
    key: 'scoring.paper.defaultRequiredHits',
    label: 'Default required scoring hits per paper target',
    description: 'Used when a stage target does not specify its own required hits. IPSC default is 2. The engine never guesses: if neither this default nor a target value is set, the configuration is flagged.',
    defaultValue: '2',
    parse: Number,
  },
  {
    key: 'penalty.miss',
    label: 'Miss penalty (points per miss)',
    description: 'IPSC Handgun: a miss incurs a 10-point penalty.',
    defaultValue: '10',
    parse: Number,
  },
  {
    key: 'penalty.noShoot',
    label: 'No-Shoot penalty (points per hit)',
    description: 'IPSC Handgun: each hit on a no-shoot target incurs a 10-point penalty.',
    defaultValue: '10',
    parse: Number,
  },
  {
    key: 'penalty.procedural',
    label: 'Procedural penalty (points each)',
    description: 'IPSC Handgun: a procedural penalty is 10 points.',
    defaultValue: '10',
    parse: Number,
  },
  {
    key: 'penalty.other',
    label: 'Other penalty (points each)',
    description: 'Value applied to custom / other penalty events when configured.',
    defaultValue: '10',
    parse: Number,
  },
  {
    key: 'scoring.psmoc.unlimitedShots',
    label: 'PSMOC: unlimited shots permitted',
    description: 'PSMOC rulesets permit unlimited shots on targets where allowed. When true, shots fired beyond the stipulated stage maximum incur no additional procedural penalty. Configurable per ruleset/version.',
    defaultValue: 'true',
    parse: parseBool,
  },
  {
    key: 'scoring.extraHitPolicy',
    label: 'Policy for extra hits on a scored target',
    description: 'How hits in excess of the stipulated number of scoring hits per target are treated. TREAT_AS_MISS counts each excess hit as a miss (10 points). IGNORE ignores them. REQUIRE_CONFIG surfaces a configuration error rather than deciding.',
    defaultValue: 'TREAT_AS_MISS',
    parse: (v) => v as ExtraHitPolicy,
  },
  {
    key: 'scoring.virginiaCount.extraShotsProcedural',
    label: 'Virginia Count: procedural per extra shot',
    description: 'IPSC: in Virginia Count a competitor who fires more shots than the maximum stipulated incurs a procedural penalty per extra shot.',
    defaultValue: 'true',
    parse: parseBool,
  },
  {
    key: 'scoring.virginiaCount.missingShotsAsMiss',
    label: 'Virginia Count: required shots not fired count as misses',
    description: 'In Virginia Count, any required shot not fired incurs a miss penalty for that required hit.',
    defaultValue: 'true',
    parse: parseBool,
  },
  {
    key: 'scoring.fixedTime.timeStopsAtFixedTime',
    label: 'Fixed Time: time stops at the fixed stage time',
    description: 'In Fixed Time, the elapsed time is deemed to stop at the prescribed stage time regardless of actual time used.',
    defaultValue: 'true',
    parse: parseBool,
  },
  {
    key: 'scoring.stagePoints.minZero',
    label: 'Minimum stage points floor of zero',
    description: 'If enabled, computed stage points are clamped to a minimum of 0 even when net score is negative. Configurable per ruleset/match.',
    defaultValue: 'false',
    parse: parseBool,
  },
  {
    key: 'scoring.tieBreakMethod',
    label: 'Default tie-break method',
    description: 'How identical totals are ranked. NONE displays "TIE" rather than inventing a winner. Other methods are configurable.',
    defaultValue: 'NONE',
    parse: (v) => v as TieBreakMethod,
  },
  {
    key: 'scoring.allowZeroTime',
    label: 'Permit a recorded time of zero',
    description: 'If false, a time of exactly zero is treated as invalid and the score cannot be calculated for hit factor.',
    defaultValue: 'false',
    parse: parseBool,
  },
  {
    key: 'powerFactor.minor.minimum',
    label: 'Minor power factor minimum (grain × ft/s / 1000)',
    description: 'IPSC: Minor is 125 and above.',
    defaultValue: '125',
    parse: Number,
  },
  {
    key: 'powerFactor.major.minimum',
    label: 'Major power factor minimum (grain × ft/s / 1000)',
    description: 'IPSC: Major is 160 and above.',
    defaultValue: '160',
    parse: Number,
  },
  {
    key: 'precision.hitFactor',
    label: 'Hit factor decimal places',
    description: 'Hit factors are displayed/rounded to this precision. Internal calculation keeps full precision.',
    defaultValue: '4',
    parse: Number,
  },
  {
    key: 'precision.stagePoints',
    label: 'Stage points decimal places',
    description: 'Stage points and match totals are displayed/rounded to this precision. Internal totals keep full precision.',
    defaultValue: '4',
    parse: Number,
  },
  {
    key: 'precision.time',
    label: 'Time decimal places',
    description: 'Time is recorded to this many decimal places.',
    defaultValue: '2',
    parse: Number,
  },
  {
    key: 'scoring.time.adjust.alpha',
    label: 'Time Scoring: seconds added per Alpha hit',
    description: 'PSMOC Time Scoring: time added to the raw time for each scoring Alpha hit on a paper target. Typically 0, but configurable per ruleset/version.',
    defaultValue: '0',
    parse: Number,
  },
  {
    key: 'scoring.time.adjust.charlie',
    label: 'Time Scoring: seconds added per Charlie hit',
    description: 'PSMOC Time Scoring: time added to the raw time for each scoring Charlie hit on a paper target. Configurable per ruleset/version.',
    defaultValue: '1',
    parse: Number,
  },
  {
    key: 'scoring.time.adjust.delta',
    label: 'Time Scoring: seconds added per Delta hit',
    description: 'PSMOC Time Scoring: time added to the raw time for each scoring Delta hit on a paper target. Configurable per ruleset/version.',
    defaultValue: '3',
    parse: Number,
  },
  {
    key: 'scoring.time.penalty.miss',
    label: 'Time Scoring: seconds per miss',
    description: 'PSMOC Time Scoring: seconds added to the raw time per required scoring hit not achieved (miss). Configurable per ruleset/version.',
    defaultValue: '5',
    parse: Number,
  },
  {
    key: 'scoring.time.penalty.noShoot',
    label: 'Time Scoring: seconds per no-shoot hit',
    description: 'PSMOC Time Scoring: seconds added to the raw time per hit on a no-shoot/penalty target. Configurable per ruleset/version.',
    defaultValue: '5',
    parse: Number,
  },
  {
    key: 'scoring.time.penalty.procedural',
    label: 'Time Scoring: seconds per procedural',
    description: 'PSMOC Time Scoring: seconds added to the raw time per procedural penalty. Configurable per ruleset/version.',
    defaultValue: '5',
    parse: Number,
  },
  {
    key: 'scoring.time.penalty.other',
    label: 'Time Scoring: seconds per other penalty',
    description: 'PSMOC Time Scoring: seconds added to the raw time per other rule-defined penalty. Configurable per ruleset/version.',
    defaultValue: '5',
    parse: Number,
  },
];

export const DEFAULT_SCORING_RULE_PARAMS: ScoringRuleParams = {
  paperPointsMinor: { A: 5, C: 3, D: 1 },
  paperPointsMajor: { A: 5, C: 4, D: 2 },
  paperPointsFullLoad: { A: 5, C: 4, D: 2 },
  paperPointsMinimumLoad: { A: 5, C: 3, D: 1 },
  steelPointValue: 5,
  paperDefaultRequiredHits: 2,
  missPenalty: 10,
  noShootPenalty: 10,
  proceduralPenalty: 10,
  otherPenalty: 10,
  extraHitPolicy: 'TREAT_AS_MISS',
  psmocUnlimitedShots: true,
  virginiaCountExtraShotsProcedural: true,
  virginiaCountMissingShotsAsMiss: true,
  fixedTimeStopsAtFixedTime: true,
  stagePointsMinZero: false,
  tieBreakMethod: 'NONE',
  allowZeroTime: false,
  minorPowerFactorMinimum: 125,
  majorPowerFactorMinimum: 160,
  precisionHitFactor: 4,
  precisionStagePoints: 4,
  precisionTime: 2,
  timeAdjustAlpha: 0,
  timeAdjustCharlie: 1,
  timeAdjustDelta: 3,
  timePenaltyMiss: 5,
  timePenaltyNoShoot: 5,
  timePenaltyProcedural: 5,
  timePenaltyOther: 5,
};

export interface RuleParameterRow {
  key: string;
  value: string;
}

/** Builds a typed ScoringRuleParams object from stored parameter rows (defaults win for missing keys). */
export function buildScoringRuleParams(rows: RuleParameterRow[]): ScoringRuleParams {
  const params: ScoringRuleParams = { ...DEFAULT_SCORING_RULE_PARAMS };
  const byKey = new Map(rows.map((r) => [r.key, r.value]));
  for (const def of RULE_PARAMETER_DEFS) {
    const raw = byKey.get(def.key);
    if (raw === undefined || raw === null || raw === '') continue;
    const parsed = def.parse(raw);
    switch (def.key) {
      case 'scoring.paper.fullLoad':
        params.paperPointsFullLoad = parsed as Record<ScoringZone, number>;
        break;
      case 'scoring.paper.minimumLoad':
        params.paperPointsMinimumLoad = parsed as Record<ScoringZone, number>;
        break;
      case 'scoring.paper.minor':
        params.paperPointsMinor = parsed as Record<ScoringZone, number>;
        break;
      case 'scoring.paper.major':
        params.paperPointsMajor = parsed as Record<ScoringZone, number>;
        break;
      case 'scoring.steel.pointValue':
        params.steelPointValue = parsed as number;
        break;
      case 'scoring.paper.defaultRequiredHits':
        params.paperDefaultRequiredHits = parsed as number;
        break;
      case 'penalty.miss':
        params.missPenalty = parsed as number;
        break;
      case 'penalty.noShoot':
        params.noShootPenalty = parsed as number;
        break;
      case 'penalty.procedural':
        params.proceduralPenalty = parsed as number;
        break;
      case 'penalty.other':
        params.otherPenalty = parsed as number;
        break;
      case 'scoring.extraHitPolicy':
        params.extraHitPolicy = parsed as ExtraHitPolicy;
        break;
      case 'scoring.psmoc.unlimitedShots':
        params.psmocUnlimitedShots = parsed as boolean;
        break;
      case 'scoring.virginiaCount.extraShotsProcedural':
        params.virginiaCountExtraShotsProcedural = parsed as boolean;
        break;
      case 'scoring.virginiaCount.missingShotsAsMiss':
        params.virginiaCountMissingShotsAsMiss = parsed as boolean;
        break;
      case 'scoring.fixedTime.timeStopsAtFixedTime':
        params.fixedTimeStopsAtFixedTime = parsed as boolean;
        break;
      case 'scoring.stagePoints.minZero':
        params.stagePointsMinZero = parsed as boolean;
        break;
      case 'scoring.tieBreakMethod':
        params.tieBreakMethod = parsed as TieBreakMethod;
        break;
      case 'scoring.allowZeroTime':
        params.allowZeroTime = parsed as boolean;
        break;
      case 'powerFactor.minor.minimum':
        params.minorPowerFactorMinimum = parsed as number;
        break;
      case 'powerFactor.major.minimum':
        params.majorPowerFactorMinimum = parsed as number;
        break;
      case 'precision.hitFactor':
        params.precisionHitFactor = parsed as number;
        break;
      case 'precision.stagePoints':
        params.precisionStagePoints = parsed as number;
        break;
      case 'precision.time':
        params.precisionTime = parsed as number;
        break;
      case 'scoring.time.adjust.alpha':
        params.timeAdjustAlpha = parsed as number;
        break;
      case 'scoring.time.adjust.charlie':
        params.timeAdjustCharlie = parsed as number;
        break;
      case 'scoring.time.adjust.delta':
        params.timeAdjustDelta = parsed as number;
        break;
      case 'scoring.time.penalty.miss':
        params.timePenaltyMiss = parsed as number;
        break;
      case 'scoring.time.penalty.noShoot':
        params.timePenaltyNoShoot = parsed as number;
        break;
      case 'scoring.time.penalty.procedural':
        params.timePenaltyProcedural = parsed as number;
        break;
      case 'scoring.time.penalty.other':
        params.timePenaltyOther = parsed as number;
        break;
    }
  }
  return params;
}

export interface RulesetDefaults {
  organizationCode: string;
  name: string;
  description: string;
  sourceCitation: string;
  parameters: RuleParameterRow[];
}

const IPSC_2026_CITATION =
  'IPSC Competition Rules, January 2026 editions; IPSC Competition Rules Interpretations February & May 2026';

export const RULESET_DEFAULTS: Record<string, RulesetDefaults> = {
  'IPSC-HANDGUN-2026': {
    organizationCode: 'IPSC',
    name: 'IPSC Handgun Rules',
    description: 'IPSC Handgun Competition Rules, January 2026 Edition with applicable 2026 interpretations.',
    sourceCitation: `IPSC Handgun Competition Rules, January 2026 Edition (final 29 Dec 2025); ${IPSC_2026_CITATION}.`,
    parameters: [],
  },
  'PPSA-HANDGUN-2026': {
    organizationCode: 'PPSA',
    name: 'PPSA/IPSC Handgun Rules',
    description:
      'PPSA-sanctioned handgun competitions follow the IPSC Handgun Competition Rules (January 2026 Edition) with Philippine classification parameters applied.',
    sourceCitation: `PPSA adopts IPSC Handgun Competition Rules, January 2026 Edition; ${IPSC_2026_CITATION}.`,
    parameters: [],
  },
  'PSMOC-HANDGUN-2026': {
    organizationCode: 'PSMOC',
    name: 'PSMOC Handgun Rules',
    description:
      'PSMOC Handgun Competition Rules with two configurable scoring methods: Points Factor (raw points minus penalties, divided by time) and Time Scoring (raw time plus per-zone and per-penalty time adjustments). Full Load and Minimum Load paper point values are ruleset parameters.',
    sourceCitation:
      'PSMOC Philippine Shooters and Match Officers Confederation, Handgun Competition Rules (representative 2026 parameters; all values are configurable ruleset parameters).',
    parameters: [
      { key: 'scoring.paper.fullLoad', value: 'A:5,C:4,D:2' },
      { key: 'scoring.paper.minimumLoad', value: 'A:5,C:3,D:1' },
      { key: 'scoring.paper.minor', value: 'A:5,C:3,D:1' },
      { key: 'scoring.paper.major', value: 'A:5,C:4,D:2' },
      { key: 'scoring.steel.pointValue', value: '5' },
      { key: 'scoring.paper.defaultRequiredHits', value: '2' },
      { key: 'penalty.miss', value: '10' },
      { key: 'penalty.noShoot', value: '10' },
      { key: 'penalty.procedural', value: '10' },
      { key: 'penalty.other', value: '10' },
      { key: 'scoring.extraHitPolicy', value: 'IGNORE' },
      { key: 'scoring.psmoc.unlimitedShots', value: 'true' },
      { key: 'scoring.time.adjust.alpha', value: '0' },
      { key: 'scoring.time.adjust.charlie', value: '1' },
      { key: 'scoring.time.adjust.delta', value: '3' },
      { key: 'scoring.time.penalty.miss', value: '5' },
      { key: 'scoring.time.penalty.noShoot', value: '5' },
      { key: 'scoring.time.penalty.procedural', value: '5' },
      { key: 'scoring.time.penalty.other', value: '5' },
    ],
  },
  'IPSC-PCC-2026': {
    organizationCode: 'IPSC',
    name: 'IPSC Pistol Calibre Carbine Rules',
    description: 'IPSC Pistol Calibre Carbine Competition Rules, January 2026 Edition.',
    sourceCitation: `IPSC PCC Competition Rules, January 2026 Edition; ${IPSC_2026_CITATION}.`,
    parameters: [],
  },
  'IPSC-RIFLE-2026': {
    organizationCode: 'IPSC',
    name: 'IPSC Rifle Rules',
    description: 'IPSC Rifle Competition Rules, January 2026 Edition.',
    sourceCitation: `IPSC Rifle Competition Rules, January 2026 Edition; ${IPSC_2026_CITATION}.`,
    parameters: [],
  },
  'IPSC-MINI-RIFLE-2026': {
    organizationCode: 'IPSC',
    name: 'IPSC Mini Rifle Rules',
    description: 'IPSC Mini Rifle Competition Rules, January 2026 Edition.',
    sourceCitation: `IPSC Mini Rifle Competition Rules, January 2026 Edition; ${IPSC_2026_CITATION}.`,
    parameters: [],
  },
  'IPSC-SHOTGUN-2026': {
    organizationCode: 'IPSC',
    name: 'IPSC Shotgun Rules',
    description: 'IPSC Shotgun Competition Rules, January 2026 Edition.',
    sourceCitation: `IPSC Shotgun Competition Rules, January 2026 Edition; ${IPSC_2026_CITATION}.`,
    parameters: [],
  },
  'IPSC-ACTION-AIR-2026': {
    organizationCode: 'IPSC',
    name: 'IPSC Action Air Rules',
    description: 'IPSC Action Air Competition Rules, January 2026 Edition.',
    sourceCitation: `IPSC Action Air Competition Rules, January 2026 Edition; ${IPSC_2026_CITATION}.`,
    parameters: [],
  },
};