import { requireOwner } from '../_lib/auth.js';
import { chatJson } from '../_lib/groq.js';
import { HttpError, route } from '../_lib/http.js';
import { logLine } from '../_lib/log.js';
import { MAX_CANDIDATES, finderMessages, knownShops, readFinderAnswer } from '../_lib/storeFinder.js';

/**
 * Shops that sell `focus`: known shops that fit first, then the ones the AI names. They are only candidates: the page
 * checks each one before reading it. Without the AI (no key, or it is busy) the known shops are still returned.
 */
export default route('POST', async (req, res) => {
  await requireOwner(req);
  const body = req.body || {};
  const focus = typeof body.focus === 'string' ? body.focus.slice(0, 120) : '';
  const count = Math.min(MAX_CANDIDATES, Math.max(5, Number(body.count) || 20));
  const exclude = Array.isArray(body.exclude) ? body.exclude.filter((h: unknown): h is string => typeof h === 'string').slice(0, 300) : [];

  const known = knownShops(focus, exclude);
  let named: ReturnType<typeof readFinderAnswer> = [];
  let aiError = '';
  try {
    const answer = await chatJson(finderMessages(focus, count, exclude), { maxTokens: 3000, timeoutMs: 60_000 });
    named = readFinderAnswer(answer, [...exclude, ...known.map((shop) => shop.host)]);
  } catch (err) {
    aiError = err instanceof Error ? err.message : 'The AI could not answer';
  }
  logLine(`store finder: "${focus || 'anything'}" — ${known.length} known shops, ${named.length} named by the AI${aiError ? ` (AI: ${aiError})` : ''}`);
  const shops = [...known, ...named];
  if (!shops.length) throw new HttpError(502, aiError || 'No new shops found — try other words, or try again');
  res.status(200).json({ ok: true, shops, ...(aiError ? { aiError } : {}) });
});
