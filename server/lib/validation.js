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

/** Cloudflare published-application origins. See https://developers.cloudflare.com/tunnel/routing/#supported-protocols */
const SERVICE_URL_PROTOCOLS = new Set(['http:', 'https:', 'ssh:', 'tcp:', 'rdp:', 'smb:']);
const SERVICE_BUILTIN = /^(hello_world|bastion|http_status:\d{3})$/;
const SERVICE_UNIX = /^(unix\+tls|unix):.+/;

export function validateServiceUrl(url) {
  if (!url || typeof url !== 'string') {
    return 'Service URL is required';
  }
  const trimmed = url.trim();
  if (SERVICE_BUILTIN.test(trimmed) || SERVICE_UNIX.test(trimmed)) {
    return true;
  }
  try {
    const parsed = new URL(trimmed);
    if (!SERVICE_URL_PROTOCOLS.has(parsed.protocol)) {
      return 'Service must use http, https, ssh, tcp, rdp, smb, unix, hello_world, or http_status';
    }
    return true;
  } catch {
    return 'Invalid service URL format';
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
