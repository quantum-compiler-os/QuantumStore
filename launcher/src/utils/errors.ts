import axios from 'axios';

const DEV_HINT = 'Start it with `npm run dev` from the project root, then try again.';

const CONNECTION_MESSAGES = {
  offline: 'You appear to be offline. Check your connection and try again.',
  unreachable: import.meta.env.DEV
    ? `Can't reach the API server on port 5000. ${DEV_HINT}`
    : "Can't reach the server right now. Check your connection and try again.",
  timeout: 'The server took too long to respond. Please try again.',
  unavailable: import.meta.env.DEV
    ? `The API server isn't responding. ${DEV_HINT}`
    : 'The server is temporarily unavailable. Please try again in a moment.',
  server: 'Something went wrong on our end. Please try again in a moment.',
};

/** Pull the API's own message out of a JSON error body, ignoring HTML/proxy bodies. */
function apiMessage(data: unknown) {
  if (!data || typeof data !== 'object') return '';
  const { message, error } = data as { message?: unknown; error?: unknown };
  if (typeof message === 'string' && message.trim()) return message.trim();
  if (typeof error === 'string' && error.trim()) return error.trim();
  return '';
}

/** True when the request never reached the API (offline, server down, proxy 502). */
export function isConnectionError(err: unknown) {
  if (!axios.isAxiosError(err) || axios.isCancel(err)) return false;
  if (!err.response) return true;
  return [502, 503, 504].includes(err.response.status);
}

export function getErrorMessage(err: unknown, fallback = 'Something went wrong') {
  if (!axios.isAxiosError(err) || axios.isCancel(err)) return fallback;

  const { response, code } = err;

  if (!response) {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return CONNECTION_MESSAGES.offline;
    if (code === 'ECONNABORTED' || code === 'ETIMEDOUT') return CONNECTION_MESSAGES.timeout;
    return CONNECTION_MESSAGES.unreachable;
  }

  const fromApi = apiMessage(response.data);
  if (fromApi) return fromApi;

  if (response.status === 504) return CONNECTION_MESSAGES.timeout;
  if (response.status === 502 || response.status === 503) return CONNECTION_MESSAGES.unavailable;
  if (response.status >= 500) return CONNECTION_MESSAGES.server;

  return fallback;
}
