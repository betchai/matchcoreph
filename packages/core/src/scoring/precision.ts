/**
 * Decimal handling strategy.
 *
 * All intermediate calculations run in full IEEE-754 double precision. Values
 * are only rounded at presentation/report boundaries using the precision that
 * the active ruleset declares. Rounding uses an epsilon guard so that
 * e.g. 57.142857... → 57.1429 and 6.4/8*100 → exactly 80.0000 without float drift.
 */

export function roundTo(value: number, dp: number): number {
  if (!Number.isFinite(value)) return value;
  const f = 10 ** dp;
  return Math.round((value + Number.EPSILON) * f) / f;
}

export function roundTime(value: number, dp = 2): number {
  return roundTo(value, dp);
}

export function roundHitFactor(value: number, dp = 4): number {
  return roundTo(value, dp);
}

export function roundStagePoints(value: number, dp = 4): number {
  return roundTo(value, dp);
}

export function toFixedString(value: number, dp: number): string {
  return roundTo(value, dp).toFixed(dp);
}

export const EPSILON = 1e-12;

export function approxEqual(a: number, b: number, tolerance = EPSILON): boolean {
  return Math.abs(a - b) <= Math.max(Math.abs(a), Math.abs(b), 1) * tolerance;
}