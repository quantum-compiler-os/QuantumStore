import { HttpError } from './http.js';
import { logLine } from './log.js';
import { failureReason, withRetry } from './net.js';
import { parseJsonObject, type ChatMessage } from './categorySuggest.js';

const ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';
export const DEFAULT_MODEL = 'openai/gpt-oss-120b';

export function groqConfigured(env: Record<string, string | undefined> = process.env) {
  return groqKeys(env).length > 0;
}

type GroqKey = { name: string; value: string };

/** GROQ_API_KEY, then GROQ_API_KEY_2 … GROQ_API_KEY_9 (blank ones skipped). When one reaches its limit the next is used. */
export function groqKeys(env: Record<string, string | undefined> = process.env): GroqKey[] {
  const names = ['GROQ_API_KEY', ...Array.from({ length: 8 }, (_, i) => `GROQ_API_KEY_${i + 2}`)];
  return names.flatMap((name) => {
    const value = env[name]?.trim();
    return value ? [{ name, value }] : [];
  });
}

/** Which key to start with: the one that answered last, so a limited key is not asked again first. */
const sharedRotation = { active: 0 };

type Options = {
  /** Overridable so tests start from the first key. */
  rotation?: { active: number };
  timeoutMs?: number;
  /** Answer budget; the short classification calls keep the default, writing a listing needs more. */
  maxTokens?: number;
  env?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
  /** Pause before the one retry after a 429; overridable so tests do not wait. */
  rateLimitWaitMs?: number;
  /** First pause before retrying a failed connection (it doubles each time); overridable so tests do not wait. */
  retryDelayMs?: number;
};

const MAX_RATE_LIMIT_WAIT_MS = 10_000;

/** How long Groq asks us to wait (`retry-after`, seconds), within reason; `fallback` when it does not say. */
export function rateLimitWait(response: Response, fallback: number) {
  const seconds = Number(response.headers.get('retry-after'));
  return Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds * 1000, MAX_RATE_LIMIT_WAIT_MS) : fallback;
}

/** One Groq chat completion in JSON mode, returned as a parsed object. The key and model come from the environment. */
export async function chatJson(messages: ChatMessage[], options: Options = {}) {
  const { timeoutMs = 20_000, maxTokens = 1024, env = process.env, fetchImpl = fetch, rateLimitWaitMs = 3_000, retryDelayMs = 1_000, rotation = sharedRotation } = options;
  const keys = groqKeys(env);
  if (!keys.length) throw new HttpError(404, 'AI suggestions are off: set GROQ_API_KEY in the Launcher environment');

  const model = env.GROQ_MODEL || DEFAULT_MODEL;
  const payload = JSON.stringify({
    model,
    messages,
    temperature: 0,
    // Room for a reasoning model's thinking as well as the short JSON answer.
    max_tokens: maxTokens,
    // Classification needs no long chain of thought; keeps answers fast and cheap.
    ...(model.startsWith('openai/gpt-oss') ? { reasoning_effort: 'low' } : {}),
    response_format: { type: 'json_object' },
  });
  const send = (key: GroqKey) =>
    withRetry(
      () =>
        fetchImpl(ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key.value}` },
          body: payload,
          signal: AbortSignal.timeout(timeoutMs),
        }),
      // A dropped connection or DNS hiccup (EAI_AGAIN, ENOTFOUND…) is retried a few times with growing pauses
      // (~1s, 2s, 4s); a slow answer is not (that would multiply the wait).
      { retries: 3, delayMs: retryDelayMs, retryOn: (err) => failureReason(err) !== 'timed out' },
    );
  let key = keys[rotation.active % keys.length];
  let response: Response;
  try {
    response = await send(key);
    // This key reached its limit: carry on with the next one straight away, and keep using whichever answers.
    for (let tried = 1; response.status === 429 && tried < keys.length; tried += 1) {
      const next = keys[(rotation.active + 1) % keys.length];
      logLine(`groq: ${key.name} reached its rate limit, switching to ${next.name}`);
      rotation.active = (rotation.active + 1) % keys.length;
      key = next;
      response = await send(key);
    }
    if (response.status === 429) {
      // Every key is limited (Groq's per-minute limit): wait as asked and try once more.
      await new Promise((resolve) => setTimeout(resolve, rateLimitWait(response, rateLimitWaitMs)));
      response = await send(key);
    }
  } catch (err) {
    const reason = failureReason(err);
    throw new HttpError(
      504,
      reason === 'timed out' ? 'Groq did not answer in time — try again' : `Could not reach Groq (${reason}) — check your connection and try again`,
    );
  }

  if (response.status === 401 || response.status === 403) {
    throw new HttpError(502, `Groq rejected the API key — check ${key.name}`);
  }
  if (response.status === 429) throw new HttpError(429, 'Groq rate limit reached — try again in a moment');
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    const message = /"message"\s*:\s*"([^"]{1,200})/.exec(detail)?.[1];
    throw new HttpError(502, `Groq error (${response.status})${message ? `: ${message}` : ''}`);
  }

  const body = (await response.json().catch(() => null)) as {
    choices?: Array<{ message?: { content?: string } }>;
  } | null;
  return parseJsonObject(body?.choices?.[0]?.message?.content || '');
}
