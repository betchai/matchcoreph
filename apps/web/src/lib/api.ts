import { API_BASE } from '../env.js';

export class ApiError extends Error {
  status: number;
  code?: string;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export async function api<T = unknown>(path: string, opts: { method?: string; json?: unknown } = {}): Promise<T> {
  const headers: Record<string, string> = {};
  let body: string | undefined;
  if (opts.json !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(opts.json);
  }
  const res = await fetch(`${API_BASE}${path}`, { method: opts.method ?? 'GET', headers, body, credentials: 'include' });
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    const msg = String(
      (data && typeof data === 'object' && 'message' in data && (data as { message: unknown }).message) ||
        (data && typeof data === 'object' && 'error' in data && (data as { error: unknown }).error) ||
        `Request failed (${res.status})`,
    );
    const code =
      data && typeof data === 'object'
        ? 'code' in data
          ? String((data as { code: unknown }).code)
          : 'error' in data
            ? String((data as { error: unknown }).error)
            : undefined
        : undefined;
    throw new ApiError(msg, res.status, code);
  }
  return data as T;
}