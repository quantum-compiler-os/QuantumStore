import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_MODEL, chatJson, groqConfigured } from '../api/_lib/groq';

const messages = [{ role: 'user' as const, content: 'hi' }];

function reply(status: number, body: unknown) {
  return vi.fn(async () => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status }));
}

describe('chatJson', () => {
  it('sends the key, model and JSON mode, and returns the parsed answer', async () => {
    const fetchImpl = reply(200, { choices: [{ message: { content: '{"group":"Fashion"}' } }] });
    const result = await chatJson(messages, { env: { GROQ_API_KEY: 'gsk_test' }, fetchImpl });
    expect(result).toEqual({ group: 'Fashion' });

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.groq.com/openai/v1/chat/completions');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer gsk_test');
    const sent = JSON.parse(String(init.body));
    expect(sent).toMatchObject({ model: DEFAULT_MODEL, temperature: 0, response_format: { type: 'json_object' } });
    // The default is a reasoning model, so it is asked to think briefly.
    expect(sent.reasoning_effort).toBe('low');
  });

  it('uses GROQ_MODEL when set', async () => {
    const fetchImpl = reply(200, { choices: [{ message: { content: '{}' } }] });
    await chatJson(messages, { env: { GROQ_API_KEY: 'k', GROQ_MODEL: 'llama-3.1-8b-instant' }, fetchImpl });
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    const sent = JSON.parse(String(init.body));
    expect(sent.model).toBe('llama-3.1-8b-instant');
    expect(sent).not.toHaveProperty('reasoning_effort');
  });

  it('explains a missing key without calling Groq', async () => {
    const fetchImpl = reply(200, {});
    await expect(chatJson(messages, { env: {}, fetchImpl })).rejects.toMatchObject({ status: 404 });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('turns Groq failures into clear errors', async () => {
    const env = { GROQ_API_KEY: 'k' };
    await expect(chatJson(messages, { env, fetchImpl: reply(401, {}) })).rejects.toThrow(/rejected the API key/);
    await expect(chatJson(messages, { env, fetchImpl: reply(429, {}) })).rejects.toMatchObject({ status: 429 });
    await expect(
      chatJson(messages, { env, fetchImpl: reply(400, { error: { message: 'model not found' } }) }),
    ).rejects.toThrow(/model not found/);
    await expect(chatJson(messages, { env, fetchImpl: reply(200, { choices: [{ message: { content: 'nope' } }] }) })).rejects.toThrow(
      /could not be read/,
    );
  });

  it('reports a timeout or network failure as 504', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('aborted');
    });
    await expect(chatJson(messages, { env: { GROQ_API_KEY: 'k' }, fetchImpl })).rejects.toMatchObject({ status: 504 });
  });
});

describe('groqConfigured', () => {
  it('is true only when a key is present', () => {
    expect(groqConfigured({ GROQ_API_KEY: 'k' })).toBe(true);
    expect(groqConfigured({ GROQ_API_KEY: '' })).toBe(false);
    expect(groqConfigured({})).toBe(false);
  });
});
