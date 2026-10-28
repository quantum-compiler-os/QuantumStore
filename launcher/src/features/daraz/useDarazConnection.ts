import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getDarazConnectUrl, getDarazStatus } from '../../api/daraz';
import { getErrorMessage } from '../../utils/errors';

const POLL_MS = 3000;
const GIVE_UP_MS = 5 * 60 * 1000;

/**
 * Daraz connection status plus a `connect()` that opens Daraz's consent page in a NEW tab.
 * Navigating the current tab fails inside embedded previews (Daraz sends X-Frame-Options: DENY),
 * so the tab that runs the Launcher stays put and polls until the other tab finishes the approval.
 */
export function useDarazConnection() {
  const [connecting, setConnecting] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [authUrl, setAuthUrl] = useState('');
  const [connectError, setConnectError] = useState('');

  const query = useQuery({
    queryKey: ['daraz', 'status'],
    queryFn: getDarazStatus,
    retry: false,
    refetchInterval: waiting ? POLL_MS : false,
  });
  const connected = Boolean(query.data?.connected);

  useEffect(() => {
    if (waiting && connected) {
      setWaiting(false);
      setAuthUrl('');
    }
  }, [waiting, connected]);

  useEffect(() => {
    if (!waiting) return undefined;
    const timer = setTimeout(() => setWaiting(false), GIVE_UP_MS);
    return () => clearTimeout(timer);
  }, [waiting]);

  async function connect() {
    setConnecting(true);
    setConnectError('');
    try {
      const url = await getDarazConnectUrl();
      setAuthUrl(url);
      window.open(url, '_blank');
      // Only wait for a change when we are not connected yet; a reconnect finishes in the other tab.
      setWaiting(!connected);
    } catch (err) {
      setConnectError(getErrorMessage(err, 'Could not start the Daraz connection'));
    } finally {
      setConnecting(false);
    }
  }

  return {
    status: query.data,
    statusError: query.error,
    statusLoading: query.isLoading,
    refetchStatus: query.refetch,
    connected,
    connecting,
    waiting,
    authUrl,
    connectError,
    connect,
  };
}
