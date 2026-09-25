// Domain enums
export * from './domain/enums.js';

// Entity types
export * from './domain/types.js';

// Rules configuration
export * from './rules/parameterDefs.js';
export * from './rules/disciplines.js';
export * from './rules/divisions.js';
export * from './rules/categories.js';

// Scoring engine (pure, UI-independent)
export * from './scoring/engine.js';
export * from './scoring/target.js';
export * from './scoring/rankings.js';
export * from './scoring/powerFactor.js';
export * from './scoring/precision.js';
export * from './scoring/errors.js';
export * from './scoring/types.js';

// RBAC matrix
export * from './rbac/roles.js';

// Validation schemas
export * from './schemas/index.js';

export function makeId(): string {
  return crypto.randomUUID();
}