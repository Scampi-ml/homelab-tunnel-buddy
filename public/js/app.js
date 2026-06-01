import { api, getApiKey, setApiKey, getMeta } from './api.js';
import { activateLogsView, deactivateLogsView, initLogsUi } from './logs.js';
import {
  expandSettingsNav,
  isSettingsView,
  initSettingsUi,
  loadSettingsApp,
  loadSettingsTunnel
} from './settings.js';

const $ = (id) => document.getElementById(id);

let toastTimer;
/** @type {{ ingressHostnameSuffix?: string | null, routeDnsDefault?: boolean } | null} */
let uiMeta = null;

function buildFullHostname(label) {
  const raw = label.trim();
  const suffix = uiMeta?.ingressHostnameSuffix?.replace(/^\./, '');
  if (!raw || !suffix) return raw;
  const lower = raw.toLowerCase();
  const suf = suffix.toLowerCase();
  if (lower === suf || lower.endsWith(`.${suf}`)) return raw;
  return `${raw}.${suffix}`;
}

function stripHostnameSuffix(hostname) {
  const suffix = uiMeta?.ingressHostnameSuffix?.replace(/^\./, '');
  if (!suffix || !hostname) return hostname;
  const tail = `.${suffix.toLowerCase()}`;
  if (hostname.toLowerCase().endsWith(tail)) return hostname.slice(0, -tail.length);
  return hostname;
}

function applyRouteHostnameUi() {
  const suffix = uiMeta?.ingressHostnameSuffix?.replace(/^\./, '');
  const suffixEl = $('route-hostname-suffix');
  const input = $('route-hostname');
  if (suffix) {
    suffixEl.textContent = `.${suffix}`;
    suffixEl.classList.remove('hidden');
    input.placeholder = 'app1';
  } else {
    suffixEl.classList.add('hidden');
    input.placeholder = 'app.example.com';
  }
}

function toast(msg, isError = false) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.toggle('hidden', false);
  el.style.borderColor = isError ? 'var(--danger)' : 'var(--border)';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), 3500);
}

function toastApply(data) {
  if (data?.apply?.message) toast(data.apply.message);
}

function showAuthOverlay(show) {
  $('auth-overlay').classList.toggle('hidden', !show);
}

async function ensureAuth() {
  const meta = await getMeta();
  uiMeta = meta;
  if (!meta.authRequired) {
    showAuthOverlay(false);
    return;
  }
  if (getApiKey()) {
    try {
      await api('/config');
      showAuthOverlay(false);
      return;
    } catch (e) {
      if (e.code !== 'UNAUTHORIZED') throw e;
      setApiKey('');
    }
  }
  showAuthOverlay(true);
}

$('api-key-save').addEventListener('click', async () => {
  const key = $('api-key-input').value.trim();
  if (!key) return;
  setApiKey(key);
  try {
    await api('/config');
    showAuthOverlay(false);
    await refreshAll();
  } catch {
    setApiKey('');
    toast('Invalid API key. Use the value from this server\'s .env file', true);
  }
});

function setRunningUI(running) {
  const badge = $('tunnel-running-badge');
  badge.textContent = running ? 'Running' : 'Stopped';
  badge.className = `badge ${running ? 'running' : 'stopped'}`;
  $('btn-start').disabled = running;
  $('btn-stop').disabled = !running;
}

async function loadTunnelCard() {
  const [config, status] = await Promise.all([
    api('/config'),
    api('/tunnel/status')
  ]);

  $('tunnel-name').textContent = config.tunnel || '—';
  const credEl = $('credentials-path');
  credEl.textContent = config.credentialsFile || '—';
  credEl.style.color = config.credentialsValid ? 'var(--success)' : 'var(--danger)';

  const cfConn = status.cloudflareConnected
    ? `Connected (${status.connections || 'active'})`
    : 'Not connected';
  $('cf-connection').textContent = cfConn;

  setRunningUI(status.running);

  return { config, status };
}

function renderIngress(ingress) {
  const tbody = $('ingress-tbody');
  tbody.innerHTML = '';

  if (!ingress?.length) {
    tbody.innerHTML = '<tr><td colspan="4" class="empty">No ingress routes. Add one to expose a hostname.</td></tr>';
    return;
  }

  for (const row of ingress) {
    const tr = document.createElement('tr');
    const publicUrl = `https://${row.hostname}`;
    tr.innerHTML = `
      <td>${escapeHtml(row.hostname)}</td>
      <td class="mono">${escapeHtml(row.service)}</td>
      <td>
        <a href="${escapeHtml(publicUrl)}" class="public-url-link" target="_blank" rel="noopener noreferrer">${escapeHtml(publicUrl)}</a>
      </td>
      <td>
        <div class="row-actions">
          <button type="button" class="btn ghost" data-edit="${row.index}">Edit</button>
          <button type="button" class="btn ghost" data-delete="${row.index}">Delete</button>
        </div>
      </td>
    `;
    tbody.appendChild(tr);
  }

  tbody.querySelectorAll('[data-edit]').forEach((btn) => {
    btn.addEventListener('click', () => openRouteDialog(parseInt(btn.dataset.edit, 10)));
  });

  tbody.querySelectorAll('[data-delete]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('Delete this ingress route?')) return;
      try {
        const data = await api(`/config/ingress/${btn.dataset.delete}?restart=true`, {
          method: 'DELETE'
        });
        toast('Route deleted');
        toastApply(data);
        await refreshAll();
      } catch (e) {
        toast(e.message, true);
      }
    });
  });
}

function escapeHtml(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

async function refreshIngress() {
  const { ingress } = await api('/config/ingress');
  renderIngress(ingress);
}

function setUpdateButton(u) {
  const btn = $('btn-update-cloudflared');
  if (!u || u.updateAvailable === null) {
    btn.textContent = 'Update cloudflared';
    btn.disabled = false;
    btn.title = 'Check GitHub releases and apt, then upgrade if newer';
    return;
  }
  if (u.updateAvailable) {
    btn.textContent = `Update to ${u.latestForUpgrade || 'latest'}`;
    btn.disabled = false;
    btn.title = `Upgrade from ${u.currentParsed} (GitHub: ${u.latestGitHub || '?'})`;
  } else {
    btn.textContent = 'Up to date';
    btn.disabled = true;
    btn.title = `Installed ${u.currentParsed} matches available release`;
  }
}

async function loadCloudflaredStatus() {
  const s = await api('/cloudflared/status');
  $('cf-installed').textContent = s.installed ? 'Yes' : 'No';
  $('cf-auth').textContent = s.authenticated ? 'Yes' : 'No';
  $('cf-version').textContent = s.version || '—';
  $('cf-account').textContent = s.account?.accountId || '—';

  const u = s.update;
  if (u) {
    $('cf-latest-github').innerHTML = u.latestGitHub
      ? `${u.latestGitHub} <a href="${u.githubUrl}" class="copy-link" target="_blank" rel="noopener">releases</a>`
      : u.githubError || '—';
    $('cf-latest-apt').textContent = u.latestApt || '—';
    setUpdateButton(u);
  }

  const hint = $('login-hint');
  if (!s.authenticated && s.installed) {
    hint.classList.remove('hidden');
    hint.innerHTML =
      'Not authenticated. Run <code>cloudflared tunnel login</code> on the server, or ';
    const link = document.createElement('a');
    link.href = '#';
    link.textContent = 'get login URL';
    link.className = 'copy-link';
    link.addEventListener('click', async (e) => {
      e.preventDefault();
      try {
        const r = await api('/cloudflared/login', { method: 'POST' });
        if (r.url) {
          window.open(r.url, '_blank');
          toast('Open the Cloudflare login page in the new tab');
        } else {
          toast(r.message);
        }
      } catch (err) {
        toast(err.message, true);
      }
    });
    hint.appendChild(link);
    hint.appendChild(document.createTextNode('.'));
  } else {
    hint.classList.add('hidden');
    hint.textContent = '';
  }
}

async function refreshAll() {
  const [ingress, tunnel, cloudflared] = await Promise.allSettled([
    refreshIngress(),
    loadTunnelCard(),
    loadCloudflaredStatus()
  ]);
  const failures = [];
  if (ingress.status === 'rejected') failures.push(`Ingress: ${ingress.reason?.message}`);
  if (tunnel.status === 'rejected') failures.push(`Tunnel: ${tunnel.reason?.message}`);
  if (cloudflared.status === 'rejected') {
    failures.push(`Cloudflared: ${cloudflared.reason?.message}`);
  }
  if (failures.length) {
    const err = new Error(failures.join(' · '));
    if (ingress.status === 'rejected' && ingress.reason?.code) err.code = ingress.reason.code;
    else if (tunnel.status === 'rejected' && tunnel.reason?.code) err.code = tunnel.reason.code;
    else if (cloudflared.status === 'rejected' && cloudflared.reason?.code) {
      err.code = cloudflared.reason.code;
    }
    throw err;
  }
}

async function refreshCurrentView() {
  switch (currentView) {
    case 'ingress':
      await refreshIngress();
      break;
    case 'tunnel':
      await loadTunnelCard();
      break;
    case 'cloudflared':
      await loadCloudflaredStatus();
      break;
    case 'logs':
      activateLogsView();
      break;
    case 'settings-tunnel':
      await loadSettingsTunnel();
      break;
    case 'settings-app':
      await loadSettingsApp();
      break;
    default:
      await refreshAll();
  }
}

const VIEW_IDS = [
  'ingress',
  'tunnel',
  'cloudflared',
  'logs',
  'settings-tunnel',
  'settings-app'
];
const VIEW_TITLES = {
  ingress: 'Ingress routes',
  tunnel: 'Tunnel',
  cloudflared: 'Cloudflared',
  logs: 'Tunnel logs',
  'settings-tunnel': 'Tunnel config',
  'settings-app': 'App & paths'
};
let currentView = 'ingress';

function setView(name, { refresh = true } = {}) {
  currentView = name;
  document.querySelectorAll('.nav-item[data-view]').forEach((el) => {
    el.classList.toggle('active', el.dataset.view === name);
  });
  expandSettingsNav(isSettingsView(name));
  for (const id of VIEW_IDS) {
    $(`view-${id}`).classList.toggle('hidden', name !== id);
  }
  $('page-title').textContent = VIEW_TITLES[name] || name;

  if (!refresh) return;

  if (name === 'logs') {
    activateLogsView();
  } else {
    deactivateLogsView();
    refreshCurrentView().catch((e) => toast(e.message, true));
  }
}

document.querySelectorAll('.nav-item[data-view]').forEach((btn) => {
  btn.addEventListener('click', () => setView(btn.dataset.view));
});

initLogsUi({});

initSettingsUi({
  onSaved: (data) => {
    toast('Tunnel config saved');
    toastApply(data);
    loadTunnelCard().catch(() => {});
  },
  onError: (err) => toast(err.message, true)
});

$('btn-refresh').addEventListener('click', () => {
  refreshCurrentView().catch((e) => toast(e.message, true));
});

$('btn-start').addEventListener('click', async () => {
  $('tunnel-message').classList.add('hidden');
  try {
    await api('/tunnel/start', { method: 'POST' });
    toast('Tunnel started');
    await loadTunnelCard();
  } catch (e) {
    $('tunnel-message').textContent = e.message;
    $('tunnel-message').className = 'message error';
    toast(e.message, true);
  }
});

$('btn-stop').addEventListener('click', async () => {
  try {
    await api('/tunnel/stop', { method: 'POST' });
    toast('Tunnel stopped');
    await loadTunnelCard();
  } catch (e) {
    toast(e.message, true);
  }
});

$('btn-update-cloudflared').addEventListener('click', async () => {
  const btn = $('btn-update-cloudflared');
  if (btn.disabled) return;

  let check;
  try {
    check = await api('/cloudflared/update/check');
  } catch (e) {
    toast(e.message, true);
    return;
  }

  if (check.updateAvailable === false) {
    toast(`Already up to date (${check.currentParsed})`);
    setUpdateButton(check);
    return;
  }

  const target = check.latestForUpgrade || check.latestGitHub || 'latest';
  const ok = confirm(
    `Upgrade cloudflared ${check.currentParsed || ''} → ${target}?\n\n` +
      'Uses apt upgrade when configured, then restarts the tunnel.\n' +
      'Tunneled traffic will drop briefly.'
  );
  if (!ok) return;

  btn.disabled = true;
  try {
    toast('Updating cloudflared…');
    const result = await api('/cloudflared/update', {
      method: 'POST',
      body: JSON.stringify({ restart: true })
    });
    if (result.skipped) {
      toast(result.message);
      setUpdateButton(result);
      return;
    }
    const after = result.versionAfterParsed || result.versionAfter;
    const before = result.currentParsed || parseVersionFromResult(result.versionBefore);
    const msg = [
      result.message,
      before && after ? `${before} → ${after}` : null
    ]
      .filter(Boolean)
      .join(' ');
    toast(msg || 'Update complete');
  } catch (e) {
    toast(e.message, true);
  } finally {
    btn.disabled = false;
    await loadCloudflaredStatus();
    if (currentView === 'tunnel') await loadTunnelCard();
  }
});

function parseVersionFromResult(text) {
  if (!text) return null;
  const m = text.match(/(\d{4}\.\d+\.\d+)/);
  return m ? m[1] : text;
}

$('btn-restart').addEventListener('click', async () => {
  try {
    await api('/tunnel/restart', { method: 'POST' });
    toast('Tunnel restarted');
    await loadTunnelCard();
  } catch (e) {
    toast(e.message, true);
  }
});

const routeDialog = $('route-dialog');

function openRouteDialog(editIndex = null) {
  const isEdit = editIndex !== null && !Number.isNaN(editIndex);
  $('route-dialog-title').textContent = isEdit ? 'Edit route' : 'Add route';
  $('route-index').value = isEdit ? String(editIndex) : '';
  $('route-dns-label').classList.toggle('hidden', isEdit);
  $('route-hostname').value = '';
  $('route-service').value = '';
  $('route-dns').checked = !isEdit && Boolean(uiMeta?.routeDnsDefault);
  applyRouteHostnameUi();

  if (isEdit) {
    api('/config/ingress').then(({ ingress }) => {
      const row = ingress.find((r) => r.index === editIndex);
      if (row) {
        $('route-hostname').value = stripHostnameSuffix(row.hostname);
        $('route-service').value = row.service;
      }
    });
  }

  routeDialog.showModal();
}

$('btn-add-route').addEventListener('click', () => openRouteDialog(null));

$('route-cancel').addEventListener('click', () => routeDialog.close());

$('route-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const index = $('route-index').value;
  const body = {
    hostname: buildFullHostname($('route-hostname').value),
    service: $('route-service').value.trim(),
    routeDns: $('route-dns').checked
  };

  try {
    let data;
    if (index === '') {
      data = await api('/config/ingress', {
        method: 'POST',
        body: JSON.stringify({ ...body, restart: true })
      });
      toast('Route added');
    } else {
      data = await api(`/config/ingress/${index}`, {
        method: 'PATCH',
        body: JSON.stringify({
          hostname: body.hostname,
          service: body.service,
          restart: true
        })
      });
      toast('Route updated');
    }
    toastApply(data);
    routeDialog.close();
    await refreshAll();
  } catch (err) {
    toast(err.message, true);
  }
});

setView('ingress', { refresh: false });

(async () => {
  try {
    await ensureAuth();
    await refreshAll();
  } catch (e) {
    console.error(e);
    if (e.code === 'UNAUTHORIZED') {
      showAuthOverlay(true);
      toast('Invalid or missing API key', true);
    } else {
      toast(e.message || 'Failed to load', true);
    }
  }
})();
