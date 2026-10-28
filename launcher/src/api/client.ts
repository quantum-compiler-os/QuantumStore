import axios from 'axios';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL
    ? `${String(import.meta.env.VITE_API_URL).replace(/\/$/, '')}/api`
    : '/api',
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('ql_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// If the API origin is misconfigured, the static host's SPA fallback answers /api/* with
// index.html (200 OK). Treat that as a failure instead of handing HTML to callers.
api.interceptors.response.use((response) => {
  const type = String(response.headers['content-type'] || '');
  if (type.includes('text/html')) {
    return Promise.reject(
      new Error(`API request to ${response.config.url} returned HTML — check VITE_API_URL for this build.`),
    );
  }
  return response;
});

export default api;
export { api };
