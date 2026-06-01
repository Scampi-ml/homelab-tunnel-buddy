import { homedir } from 'os';
import { join } from 'path';

const defaultCloudflaredDir =
  process.platform === 'win32'
    ? join(homedir(), '.cloudflared')
    : '/root/.cloudflared';

const DEFAULT_APP_DIR = '/opt/homelab-tunnel-buddy';

export const PORT = parseInt(process.env.PORT || '3847', 10);
export const CLOUDFLARED_DIR = process.env.CLOUDFLARED_DIR || defaultCloudflaredDir;
export const CLOUDFLARED_CONFIG =
  process.env.CLOUDFLARED_CONFIG || join(CLOUDFLARED_DIR, 'config.yml');
export const CLOUDFLARED_BIN = process.env.CLOUDFLARED_PATH || 'cloudflared';

/** File written when cloudflared runs with --logfile (see INSTALL.md) */
export const CLOUDFLARED_LOG_FILE =
  process.env.CLOUDFLARED_LOG_FILE || '/var/log/cloudflared.log';

export const HTB_API_KEY = process.env.HTB_API_KEY || '';

export const RUNNING_STATE_FILE =
  process.env.HTB_STATE_FILE ||
  join(process.env.HTB_DATA_DIR || DEFAULT_APP_DIR, '.homelab-tunnel-buddy-running.json');

/** spawn = start cloudflared directly; systemd = systemctl start/stop unit */
export const CONTROL_MODE = process.env.HTB_CONTROL_MODE || 'systemd';

export const SYSTEMD_UNIT = process.env.HTB_SYSTEMD_UNIT || 'cloudflared.service';

/** Comma-separated directories to scan for *.json credential files */
export const CREDENTIALS_DIRS = (
  process.env.CREDENTIALS_DIRS ||
  `${CLOUDFLARED_DIR},/root/.cloudflared,/etc/cloudflared`
)
  .split(',')
  .map((d) => d.trim())
  .filter(Boolean);

/** auto | apt | dpkg | builtin: how POST /api/cloudflared/update installs (apt = Cloudflare docs) */
export const CLOUDFLARED_UPDATE_MODE = process.env.CLOUDFLARED_UPDATE_MODE || 'apt';

/** e.g. example.com: UI/API append to hostname when user enters only the label (app1 → app1.example.com) */
export const INGRESS_HOSTNAME_SUFFIX = (process.env.HTB_INGRESS_HOSTNAME_SUFFIX || '')
  .trim()
  .replace(/^\.+/, '');

/** When true, “Create DNS CNAME” is checked by default in the add-route dialog */
export const ROUTE_DNS_DEFAULT = process.env.HTB_ROUTE_DNS_DEFAULT === 'true';
