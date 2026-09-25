import type { PowerFactor } from '../domain/enums.js';

/**
 * Power Factor = (Bullet weight in grains × Velocity in ft/s) / 1000.
 * Thresholds are configurable per ruleset (IPSC: Minor ≥ 125, Major ≥ 160).
 */
export function calculatePowerFactor(bulletWeightGrains: number, velocityFps: number): number {
  return (bulletWeightGrains * velocityFps) / 1000;
}

export function classifyPowerFactor(
  pf: number,
  minorMinimum: number,
  majorMinimum: number,
): PowerFactor {
  if (pf >= majorMinimum) return 'MAJOR';
  if (pf >= minorMinimum) return 'MINOR';
  return 'NOT_APPLICABLE';
}

export function averageVelocity(v1: number | null, v2: number | null, v3: number | null): number | null {
  const shots = [v1, v2, v3].filter((v): v is number => v !== null && v !== undefined);
  if (shots.length === 0) return null;
  return shots.reduce((a, b) => a + b, 0) / shots.length;
}