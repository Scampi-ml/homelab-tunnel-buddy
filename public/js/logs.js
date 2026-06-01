import { api } from './api.js';

const POLL_MS = 2000;
const TAIL_LINES = 400;
const MAX_BUFFER_LINES = 3000;

let logOffset = 0;
let lineBuffer = [];
let pollTimer = null;
let active = false;

const $ = (id) => document.getElementById(id);

function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function formatMeta(data) {
  const parts = [data.path];
  if (data.exists) {
    parts.push(formatBytes(data.size));
    if (data.modifiedAt) parts.push(new Date(data.modifiedAt).toLocaleString());
  } else {
    parts.push('not found');
  }
  return parts.join(' · ');
}

function getFilterText() {
  return ($('log-filter')?.value || '').trim().toLowerCase();
}

function trimBuffer() {
  if (lineBuffer.length > MAX_BUFFER_LINES) {
    lineBuffer = lineBuffer.slice(-MAX_BUFFER_LINES);
  }
}

function paintLogOutput(scrollBottom = true) {
  const pre = $('log-output');
  const q = getFilterText();
  const lines = q ? lineBuffer.filter((l) => l.toLowerCase().includes(q)) : lineBuffer;

  if (!lines.length) {
    pre.textContent = q ? '(no matching lines)' : '';
  } else {
    pre.textContent = lines.join('\n');
  }

  if (scrollBottom && $('log-follow')?.checked) {
    pre.scrollTop = pre.scrollHeight;
  }
}

function showHint(msg, isError = false) {
  const el = $('log-hint');
  if (!msg) {
    el.classList.add('hidden');
    el.textContent = '';
    return;
  }
  el.classList.remove('hidden');
  el.className = isError ? 'message error' : 'message';
  el.textContent = msg;
}

async function fetchFullTail() {
  const data = await api(`/cloudflared/logs?lines=${TAIL_LINES}`);
  $('log-meta').textContent = formatMeta(data);
  logOffset = data.offset ?? 0;

  if (!data.exists) {
    lineBuffer = [];
    paintLogOutput(false);
    showHint(
      data.hint ||
        'Enable logging: add --loglevel info --logfile /var/log/cloudflared.log to cloudflared.service, then restart.'
    );
    return;
  }

  lineBuffer = data.lines || [];
  trimBuffer();
  showHint(data.truncated ? `Showing last ${TAIL_LINES} lines (file is larger).` : '');
  paintLogOutput(true);
}

async function fetchAppend() {
  const data = await api(`/cloudflared/logs?since=${logOffset}`);
  $('log-meta').textContent = formatMeta(data);

  if (!data.exists) {
    showHint(data.hint || 'Log file not found.');
    return;
  }

  if (data.rotated) {
    await fetchFullTail();
    return;
  }

  logOffset = data.offset ?? logOffset;
  const newLines = data.lines || [];
  if (!newLines.length) return;

  if (data.truncated) {
    await fetchFullTail();
    showHint('Log grew quickly; reloaded tail.');
    return;
  }

  lineBuffer.push(...newLines);
  trimBuffer();
  paintLogOutput(true);
}

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

function startPolling() {
  stopPolling();
  if (!$('log-follow')?.checked || !active) return;
  pollTimer = setInterval(() => {
    fetchAppend().catch((e) => showHint(e.message, true));
  }, POLL_MS);
}

export function activateLogsView() {
  active = true;
  fetchFullTail()
    .then(() => startPolling())
    .catch((e) => {
      lineBuffer = [];
      $('log-output').textContent = '';
      showHint(e.message, true);
    });
}

export function deactivateLogsView() {
  active = false;
  stopPolling();
}

export function initLogsUi() {
  $('btn-log-refresh')?.addEventListener('click', () => {
    fetchFullTail().catch((e) => showHint(e.message, true));
  });

  $('btn-log-clear')?.addEventListener('click', () => {
    lineBuffer = [];
    paintLogOutput(false);
    showHint('');
  });

  $('log-filter')?.addEventListener('input', () => paintLogOutput(true));

  $('log-follow')?.addEventListener('change', () => {
    if ($('log-follow').checked && active) startPolling();
    else stopPolling();
  });
}
