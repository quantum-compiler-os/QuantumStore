import { HttpError } from './http.js';
import { parseJsonObject, type ChatMessage } from './categorySuggest.js';

const ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';
export const DEFAULT_MODEL = 'openai/gpt-oss-120b';

export function groqConfigured(env: Record<string, string | undefined> = process.env) {
  return Boolean(env.GROQ_API_KEY);
}

type Options = {
  timeoutMs?: number;
  env?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
};

/** One Groq chat completion in JSON mode, returned as a parsed object. The key and model come from the environment. */
export async function chatJson(messages: ChatMessage[], options: Options = {}) {
  const { timeoutMs = 20_000, env = process.env, fetchImpl = fetch } = options;
  const apiKey = env.GROQ_API_KEY;
  if (!apiKey) throw new HttpError(404, 'AI suggestions are off: set GROQ_API_KEY in the Launcher environment');

  const model = env.GROQ_MODEL || DEFAULT_MODEL;
  let response: Response;
  try {
    response = await fetchImpl(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        messages,
        temperature: 0,
        // Room for a reasoning model's thinking as well as the short JSON answer.
        max_tokens: 1024,
        // Classification needs no long chain of thought; keeps answers fast and cheap.
        ...(model.startsWith('openai/gpt-oss') ? { reasoning_effort: 'low' } : {}),
        response_format: { type: 'json_object' },
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    throw new HttpError(504, 'Groq did not answer in time — try again');
  }

  if (response.status === 401 || response.status === 403) {
    throw new HttpError(502, 'Groq rejected the API key — check GROQ_API_KEY');
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
