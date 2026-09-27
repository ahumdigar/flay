import { AppError } from './errors.js';

interface FetchJsonOptions extends RequestInit {
  timeoutMs?: number;
  provider: string;
  maxBytes?: number;
}

const RATE_LIMIT_RETRY_CAP_MS = 5_000;

export async function fetchJson<T>(url: string | URL, options: FetchJsonOptions): Promise<T> {
  return fetchJsonAttempt<T>(url, options, 0);
}

async function fetchJsonAttempt<T>(url: string | URL, options: FetchJsonOptions, attempt: number): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 4500);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const maxBytes = options.maxBytes ?? 5_000_000;
    const text = await readBoundedResponse(response, maxBytes, options.provider);
    let payload: unknown;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      throw new AppError(502, 'PROVIDER_BAD_RESPONSE', `${options.provider} returned an invalid response.`, true);
    }
    if (!response.ok) {
      if (response.status === 429 && attempt === 0 && isReadRequest(options.method)) {
        await wait(retryDelayMs(response, options.provider));
        return fetchJsonAttempt<T>(url, options, attempt + 1);
      }
      const record = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
      const issue = record.error && typeof record.error === 'object' && 'issues' in record.error
        ? (record.error as { issues?: Array<{ path?: Array<string | number>; message?: string }> }).issues?.[0]
        : undefined;
      const structuredReason = issue?.message
        ? `${Array.isArray(issue.path) ? issue.path.join('.') : 'request'}: ${issue.message}`
        : undefined;
      const reason = [record.error, record.cause, record.message, record.msg, structuredReason]
        .find((value): value is string => typeof value === 'string' && value.length > 0)?.slice(0, 300);
      const message = response.status === 429
        ? `${options.provider} is temporarily rate-limited. Wait a few seconds and retry, or configure a free Jupiter API key for steadier access.`
        : reason ? `${options.provider}: ${reason}` : `${options.provider} rejected the request.`;
      throw new AppError(
        response.status >= 500 ? 502 : response.status,
        response.status === 429 ? 'PROVIDER_RATE_LIMITED' : 'PROVIDER_REJECTED',
        message,
        response.status >= 429 || response.status >= 500,
      );
    }
    return payload as T;
  } catch (error) {
    if (error instanceof AppError) throw error;
    if (error instanceof Error && error.name === 'AbortError') {
      throw new AppError(504, 'PROVIDER_TIMEOUT', `${options.provider} did not respond in time.`, true);
    }
    throw new AppError(502, 'PROVIDER_UNAVAILABLE', `${options.provider} is currently unreachable.`, true);
  } finally {
    clearTimeout(timeout);
  }
}

function isReadRequest(method?: string): boolean {
  return !method || method.toUpperCase() === 'GET' || method.toUpperCase() === 'HEAD';
}

function retryDelayMs(response: Response, provider: string): number {
  const value = response.headers.get('retry-after');
  if (value) {
    const seconds = Number(value);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.min(RATE_LIMIT_RETRY_CAP_MS, Math.ceil(seconds * 1000));
    const date = Date.parse(value);
    if (Number.isFinite(date)) return Math.min(RATE_LIMIT_RETRY_CAP_MS, Math.max(0, date - Date.now()));
  }
  return provider.toLowerCase().startsWith('jupiter') ? 2_100 : 1_000;
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function readBoundedResponse(response: Response, maxBytes: number, provider: string): Promise<string> {
  const tooLarge = () => new AppError(502, 'PROVIDER_RESPONSE_TOO_LARGE', `${provider} returned an unexpectedly large response.`, true);
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) throw tooLarge();
  if (!response.body) return '';

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      bytes += next.value.byteLength;
      if (bytes > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw tooLarge();
      }
      chunks.push(next.value);
    }
    return Buffer.concat(chunks, bytes).toString('utf8');
  } finally {
    reader.releaseLock();
  }
}
