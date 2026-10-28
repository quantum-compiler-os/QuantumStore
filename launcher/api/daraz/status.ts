import { requireOwner } from '../_lib/auth';
import { getConnection } from '../_lib/daraz';
import { route } from '../_lib/http';

export default route('GET', async (req, res) => {
  await requireOwner(req);
  const configured = Boolean(process.env.DARAZ_APP_KEY && process.env.DARAZ_APP_SECRET && process.env.DARAZ_REDIRECT_URI);
  const conn = configured ? await getConnection() : null;
  res.status(200).json({
    ok: true,
    configured,
    // Not a secret; shown so a "redirect uri does not match" error is easy to compare with the Daraz console.
    redirectUri: process.env.DARAZ_REDIRECT_URI || null,
    connected: Boolean(conn),
    account: conn?.account || null,
    country: conn?.country || null,
    connectedAt: conn?.connectedAt || null,
    refreshExpiresAt: conn?.refreshExpiresAt || null,
  });
});
