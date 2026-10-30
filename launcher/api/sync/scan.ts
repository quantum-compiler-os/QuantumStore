import { requireOwner } from '../_lib/auth.js';
import { route } from '../_lib/http.js';
import { realSyncDeps } from '../_lib/syncDeps.js';
import { previewSync } from '../_lib/syncRun.js';

/** What a sync would do right now (imports, listings, removals), without doing any of it. */
export default route('GET', async (req, res) => {
  await requireOwner(req);
  const preview = await previewSync(realSyncDeps(String(req.headers.authorization), () => {}));
  res.status(200).json({ ok: true, preview });
});
