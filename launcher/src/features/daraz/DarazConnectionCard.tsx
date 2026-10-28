import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { disconnectDaraz, getDarazConnectUrl, getDarazStatus } from '../../api/daraz';
import { useConfirm } from '../../context/ConfirmContext';
import { useToast } from '../../context/ToastContext';
import { getErrorMessage } from '../../utils/errors';

function formatDate(value: string | null) {
  return value ? new Date(value).toLocaleDateString(undefined, { dateStyle: 'medium' }) : '—';
}

/** Connect / reconnect / disconnect the Daraz seller account (OAuth round trip via /launcher-api). */
export default function DarazConnectionCard() {
  const toast = useToast();
  const confirm = useConfirm();
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();
  const [working, setWorking] = useState(false);
  const { data: status, isLoading, error } = useQuery({
    queryKey: ['daraz', 'status'],
    queryFn: getDarazStatus,
    retry: false,
  });

  // Daraz sends the browser back here as /settings?daraz=connected|error&reason=…
  useEffect(() => {
    const result = params.get('daraz');
    if (!result) return;
    if (result === 'connected') toast.success('Daraz connected');
    else toast.error(`Could not connect Daraz: ${params.get('reason') || 'unknown error'}`);
    queryClient.invalidateQueries({ queryKey: ['daraz'] });
    setParams({}, { replace: true });
  }, [params, setParams, toast, queryClient]);

  async function connect() {
    setWorking(true);
    try {
      window.location.assign(await getDarazConnectUrl());
    } catch (err) {
      toast.error(getErrorMessage(err, 'Could not start the Daraz connection'));
      setWorking(false);
    }
  }

  async function disconnect() {
    const ok = await confirm('Publishing to Daraz stops until you connect again. Existing listings are untouched.', {
      title: 'Disconnect Daraz?',
      confirmLabel: 'Disconnect',
      tone: 'danger',
    });
    if (!ok) return;
    try {
      await disconnectDaraz();
      await queryClient.invalidateQueries({ queryKey: ['daraz'] });
      toast.success('Daraz disconnected');
    } catch (err) {
      toast.error(getErrorMessage(err, 'Could not disconnect'));
    }
  }

  return (
    <div className="admin-form daraz-card">
      <h2>Daraz connection</h2>
      {isLoading && <p className="muted">Checking…</p>}
      {error && <p className="form-error">{getErrorMessage(error, 'Could not check the Daraz connection')}</p>}
      {status && !status.configured && (
        <p className="muted">
          Not configured. Set DARAZ_APP_KEY, DARAZ_APP_SECRET and DARAZ_REDIRECT_URI in the Launcher environment, and
          add the same redirect URL to your Daraz app.
        </p>
      )}
      {status?.configured && !status.connected && (
        <>
          <p className="muted">Not connected. You will be sent to Daraz to approve access for your seller account.</p>
          <div className="admin-quick">
            <button type="button" className="btn btn-primary" disabled={working} onClick={connect}>
              {working ? 'Opening Daraz…' : 'Connect Daraz'}
            </button>
          </div>
        </>
      )}
      {status?.connected && (
        <>
          <p>
            Connected{status.account ? ` as ${status.account}` : ''}
            {status.country ? ` (${status.country.toUpperCase()})` : ''} since {formatDate(status.connectedAt)}.
          </p>
          <p className="muted">
            Access renews automatically. If publishing ever reports an expired connection (around{' '}
            {formatDate(status.refreshExpiresAt)}), reconnect.
          </p>
          <div className="admin-quick">
            <button type="button" className="btn btn-secondary" disabled={working} onClick={connect}>
              Reconnect
            </button>
            <button type="button" className="btn btn-ghost" onClick={disconnect}>
              Disconnect
            </button>
          </div>
        </>
      )}
    </div>
  );
}
