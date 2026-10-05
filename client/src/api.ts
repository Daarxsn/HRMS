export interface RequestOptions extends RequestInit {}
export interface ApiError extends Error { status?: number; requestId?: string | null; code?: string }

const base = (import.meta.env.VITE_API_URL || '/api').replace(/\/$/, '');

export async function request(path: string, options: RequestOptions = {}): Promise<any> {
  const headers = new Headers(options.headers || {});
  const hasJsonBody = Boolean(options.body) && !(options.body instanceof FormData);
  if (hasJsonBody && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  if (!headers.has('Accept')) headers.set('Accept', 'application/json, text/csv');

  const controller = options.signal ? null : new AbortController();
  const timeout = controller ? globalThis.setTimeout(() => controller.abort(), 15000) : null;
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  const authEndpoint = /^\/auth\/(me|google|demo|logout)(?:\/|$)/.test(normalizedPath);

  try {
    const response = await fetch(`${base}${normalizedPath}`, {
      ...options,
      headers,
      credentials: 'include',
      signal: options.signal || controller?.signal
    });

    const type = response.headers.get('content-type') || '';
    if (!response.ok) {
      const data = type.includes('application/json') ? await response.json().catch(() => ({})) : {};
      if (response.status === 401 && !authEndpoint) globalThis.dispatchEvent?.(new CustomEvent('hrms:session-expired'));
      const requestId = data.requestId || response.headers.get('X-Request-ID') || null;
      const message = data.error || `Request failed (${response.status}).`;
      const error = new Error(requestId && response.status >= 500 ? `${message} Reference: ${requestId}` : message) as ApiError;
      error.status = response.status;
      error.requestId = requestId;
      throw error;
    }

    if (type.includes('text/csv')) return response.blob();
    return type.includes('application/json') ? response.json() : response;
  } catch (error) {
    const err = error as Error & { code?: string; name?: string };
    if (err?.name === 'AbortError') { const timeoutError = new Error('The request timed out. Please check your connection and try again.') as ApiError; timeoutError.code='TIMEOUT'; throw timeoutError; }
    if (err instanceof TypeError) { const networkError = new Error('We could not reach the server. Check your connection and try again.') as ApiError; networkError.code='NETWORK'; throw networkError; }
    throw error;
  } finally {
    if (timeout) globalThis.clearTimeout(timeout);
  }
}
export const get = (path: string) => request(path);
export const post = (path: string, body: unknown = {}) => request(path, { method: 'POST', body: body instanceof FormData ? body : JSON.stringify(body) });
export const patch = (path: string, body: unknown = {}) => request(path, { method: 'PATCH', body: JSON.stringify(body) });
export const put = (path: string, body: unknown = {}) => request(path, { method: 'PUT', body: JSON.stringify(body) });
export const del = (path: string) => request(path, { method: 'DELETE' });

export function formatDate(value?: string | number | Date | null, options: Intl.DateTimeFormatOptions = { day:'numeric', month:'short', year:'numeric' }) {
  if (!value) return '—';
  const date = new Date(`${String(value).slice(0,10)}T12:00:00`);
  return new Intl.DateTimeFormat('en-IN', options).format(date);
}
export function formatTime(value?: string | number | Date | null) {
  if (!value) return '—';
  const date = new Date(typeof value === 'string' && !value.endsWith('Z') ? `${value.replace(' ','T')}Z` : value);
  return new Intl.DateTimeFormat('en-IN', { hour:'numeric', minute:'2-digit', timeZone:'Asia/Kolkata' }).format(date);
}
export function formatMinutes(minutes?: number | null) { if (minutes == null) return '—'; return `${Math.floor(minutes / 60)}h ${String(Math.round(minutes % 60)).padStart(2,'0')}m`; }
export const todayLocal = () => new Intl.DateTimeFormat('en-CA', { timeZone:'Asia/Kolkata', year:'numeric', month:'2-digit', day:'2-digit' }).format(new Date());
export const initials = (name = '') => name.split(/\s+/).filter(Boolean).slice(0,2).map((part)=>part[0]).join('').toUpperCase();
