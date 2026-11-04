import { requireOwner } from '../_lib/auth.js';
import { route } from '../_lib/http.js';
import { countdownLine } from '../_lib/log.js';

/**
 * Shows the wait for Groq's rate limit in the terminal (the page shows the same countdown). Answers when the time is up;
 * if the page stops waiting first (Stop pressed, tab closed), the countdown ends with it.
 */
export default route('POST', async (req, res) => {
  await requireOwner(req);
  const seconds = Math.min(300, Math.max(1, Math.round(Number(req.body?.seconds)) || 60));
  const label = String(req.body?.label || 'Groq rate limit').slice(0, 160);
  let gone = false;
  res.on('close', () => {
    gone = true;
  });
  await countdownLine(label, seconds, () => gone);
  if (!gone) res.status(200).json({ ok: true });
});
