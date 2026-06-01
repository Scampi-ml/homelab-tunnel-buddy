const API_BASE = '/api';
const STORAGE_KEY = 'htb_api_key';

export function getApiKey() {
  return sessionStorage.getItem(STORAGE_KEY) || '';
}

export function setApiKey(key) {
  if (key) sessionStorage.setItem(STORAGE_KEY, key);
  else sessionStorage.removeItem(STORAGE_KEY);
}

export async function api(path, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {})
  };

  const key = getApiKey();
  if (key) headers.Authorization = `Bearer ${key}`;

  let res;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers
    });
  } catch (err) {
    const hint =
      'Cannot reach the API. Confirm the URL uses http:// (unless you use an HTTPS proxy), homelab-tunnel-buddy is running on port 3847, and this PC can resolve the host.';
    const e = new Error(err instanceof TypeError ? hint : err.message || hint);
    e.code = 'NETWORK';
    e.cause = err;
    throw e;
  }

  const data = await res.json().catch(() => ({}));

  if (res.status === 401) {
    const err = new Error(data.error || 'Unauthorized');
    err.code = 'UNAUTHORIZED';
    throw err;
  }

  if (!res.ok) {
    const err = new Error(data.error || res.statusText);
    err.status = res.status;
    throw err;
  }

  return data;
}

export async function getMeta() {
  return api('/meta');
}
