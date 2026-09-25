import crypto from 'node:crypto';

export class AppError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
  }
}

export const badRequest = (code: string, message: string) => new AppError(400, code, message);
export const unauthorized = (message = 'Authentication required') => new AppError(401, 'UNAUTHORIZED', message);
export const forbidden = (code = 'FORBIDDEN', message = 'You are not authorized to perform this action') =>
  new AppError(403, code, message);
export const notFound = (message = 'Resource not found') => new AppError(404, 'NOT_FOUND', message);
export const conflict = (code: string, message: string) => new AppError(409, code, message);
export const unprocessable = (code: string, message: string) => new AppError(422, code, message);

export function uuid(): string {
  return crypto.randomUUID();
}

export function sha256(input: string): string {
  return crypto.createHash('sha256').update(input).digest('hex');
}

export function randomToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString('base64url');
}

export function paginate(page: number | undefined, pageSize: number | undefined): { limit: number; offset: number } {
  const p = Math.max(1, page ?? 1);
  const size = Math.min(200, Math.max(1, pageSize ?? 50));
  return { limit: size, offset: (p - 1) * size };
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}