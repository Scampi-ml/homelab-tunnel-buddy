import { api, getMeta } from './api.js';

const $ = (id) => document.getElementById(id);

export function expandSettingsNav(open) {
  const submenu = $('nav-settings-submenu');
  const toggle = $('nav-settings-toggle');
  if (!submenu || !toggle) return;
  submenu.classList.toggle('hidden', !open);
  toggle.classList.toggle('expanded', open);
  toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
}

export function isSettingsView(view) {
  return view === 'settings-tunnel' || view === 'settings-app';
}

export async function loadSettingsTunnel() {
  const [config, creds] = await Promise.all([api('/config'), api('/credentials')]);

  $('settings-tunnel-name').value = config.tunnel || '';
  $('settings-credentials').value = config.credentialsFile || '';

  const select = $('settings-credentials-select');
  select.innerHTML = '<option value="">— pick a credentials file —</option>';
  for (const f of creds.files || []) {
    const opt = document.createElement('option');
    opt.value = f.path;
    opt.textContent = `${f.name} (${f.directory})`;
    if (f.path === config.credentialsFile) opt.selected = true;
    select.appendChild(opt);
  }

  const status = $('settings-tunnel-status');
  if (!config.exists) {
    status.textContent = `Config file not found: ${config.configPath}`;
    status.className = 'message error';
    status.classList.remove('hidden');
  } else if (config.credentialsValid) {
    status.textContent = 'Credentials file found.';
    status.className = 'message';
    status.classList.remove('hidden');
  } else {
    status.textContent = config.credentialsError || 'Credentials file missing or invalid.';
    status.className = 'message error';
    status.classList.remove('hidden');
  }

  $('settings-config-path').textContent = config.configPath || '—';
}

export async function loadSettingsApp() {
  const meta = await getMeta();
  $('settings-meta-config').textContent = meta.cloudflaredConfig || '—';
  $('settings-meta-dir').textContent = meta.cloudflaredDir || '—';
  $('settings-meta-log').textContent = meta.cloudflaredLogFile || '—';
  $('settings-meta-control').textContent = meta.controlMode || '—';
  $('settings-meta-unit').textContent = meta.systemdUnit || '—';
  $('settings-meta-suffix').textContent = meta.ingressHostnameSuffix || '(none)';
  $('settings-meta-dns-default').textContent = meta.routeDnsDefault ? 'Yes' : 'No';
  $('settings-meta-auth').textContent = meta.authRequired ? 'Required' : 'Disabled';
}

export async function saveSettingsTunnel() {
  const tunnel = $('settings-tunnel-name').value.trim();
  const credentialsFile = $('settings-credentials').value.trim();
  const restart = $('settings-restart-after-save').checked;

  const data = await api('/config', {
    method: 'PUT',
    body: JSON.stringify({ tunnel, credentialsFile, restart })
  });

  return data;
}

export function initSettingsUi({ onSaved, onError }) {
  $('nav-settings-toggle')?.addEventListener('click', () => {
    const submenu = $('nav-settings-submenu');
    const isHidden = submenu?.classList.contains('hidden');
    expandSettingsNav(isHidden);
  });

  $('settings-credentials-select')?.addEventListener('change', (e) => {
    const val = e.target.value;
    if (val) $('settings-credentials').value = val;
  });

  $('settings-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('settings-save');
    btn.disabled = true;
    try {
      const data = await saveSettingsTunnel();
      await loadSettingsTunnel();
      onSaved?.(data);
    } catch (err) {
      onError?.(err);
    } finally {
      btn.disabled = false;
    }
  });
}
