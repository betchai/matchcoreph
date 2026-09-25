export class ScoringConfigError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'ScoringConfigError';
    this.code = code;
  }
}

export interface ConfigIssue {
  code: string;
  targetId?: string;
  message: string;
}