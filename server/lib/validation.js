export function validateTunnelName(name) {
  if (!name || typeof name !== 'string') {
    return 'Tunnel name is required';
  }
  if (name.length < 3) {
    return 'Tunnel name must be at least 3 characters long';
  }
  if (!/^[a-zA-Z0-9-_]+$/.test(name)) {
    return 'Tunnel name can only contain letters, numbers, hyphens, and underscores';
  }
  return true;
}

export function validateServiceUrl(url) {
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return 'Service URL must use http or https';
    }
    return true;
  } catch {
    return 'Invalid URL format';
  }
}

export function applyHostnameSuffix(hostname, suffix) {
  const raw = (hostname || '').trim();
  const suf = (suffix || '').trim().replace(/^\.+/, '');
  if (!raw || !suf) return raw;
  const lower = raw.toLowerCase();
  const sufLower = suf.toLowerCase();
  if (lower === sufLower || lower.endsWith(`.${sufLower}`)) return raw;
  return `${raw}.${suf}`;
}

export function stripHostnameSuffix(hostname, suffix) {
  const raw = (hostname || '').trim();
  const suf = (suffix || '').trim().replace(/^\.+/, '');
  if (!raw || !suf) return raw;
  const tail = `.${suf.toLowerCase()}`;
  if (raw.toLowerCase().endsWith(tail)) return raw.slice(0, -tail.length);
  return raw;
}

export function validateHostname(hostname) {
  if (!hostname || typeof hostname !== 'string') {
    return 'Hostname is required';
  }
  const hostnameRegex =
    /^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)*[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/;
  if (!hostnameRegex.test(hostname)) {
    return 'Invalid hostname format';
  }
  return true;
}
