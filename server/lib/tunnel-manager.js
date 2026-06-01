import { spawn } from 'child_process';
import { readFile, writeFile, unlink } from 'fs/promises';
import { execa } from 'execa';
import {
  CLOUDFLARED_BIN,
  CLOUDFLARED_CONFIG,
  CONTROL_MODE,
  RUNNING_STATE_FILE,
  SYSTEMD_UNIT
} from './env.js';
import { loadConfig } from './config-yml.js';
import {
  checkCloudflaredInstalled,
  getTunnelInfo,
  parseCloudflaredTunnels
} from './cloudflare.js';

let runningState = null;

function isPidAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function loadRunningState() {
  try {
    const data = await readFile(RUNNING_STATE_FILE, 'utf-8');
    const parsed = JSON.parse(data);
    if (parsed.pid && isPidAlive(parsed.pid)) {
      runningState = parsed;
      return parsed;
    }
    await unlink(RUNNING_STATE_FILE).catch(() => {});
  } catch {
    // no state file
  }
  runningState = null;
  return null;
}

async function saveRunningState(state) {
  runningState = state;
  if (state) {
    await writeFile(RUNNING_STATE_FILE, JSON.stringify(state, null, 2));
  } else {
    await unlink(RUNNING_STATE_FILE).catch(() => {});
  }
}

export async function initTunnelManager() {
  await loadRunningState();
}

export function getRunningState() {
  return runningState;
}

async function isSystemdActive() {
  try {
    const { stdout } = await execa('systemctl', ['is-active', SYSTEMD_UNIT], {
      reject: false
    });
    return stdout.trim() === 'active';
  } catch {
    return false;
  }
}

export async function isTunnelRunning() {
  if (CONTROL_MODE === 'systemd') {
    return isSystemdActive();
  }
  if (runningState?.pid) {
    return isPidAlive(runningState.pid);
  }
  return false;
}

async function startViaSpawn(tunnelName) {
  const subprocess = spawn(
    CLOUDFLARED_BIN,
    ['tunnel', '--config', CLOUDFLARED_CONFIG, 'run'],
    { stdio: 'ignore', detached: true }
  );
  subprocess.unref();

  const state = {
    tunnelName,
    pid: subprocess.pid,
    configPath: CLOUDFLARED_CONFIG,
    startedAt: new Date().toISOString(),
    mode: 'spawn'
  };

  subprocess.on('exit', () => {
    if (runningState?.pid === subprocess.pid) {
      saveRunningState(null);
    }
  });

  await saveRunningState(state);
  return state;
}

async function stopViaSpawn() {
  if (!runningState?.pid) {
    throw new Error('Tunnel is not running');
  }
  try {
    process.kill(runningState.pid, 'SIGTERM');
  } catch {
    // already dead
  }
  await saveRunningState(null);
}

async function startViaSystemd(tunnelName) {
  await execa('systemctl', ['start', SYSTEMD_UNIT]);
  const state = {
    tunnelName,
    systemd: true,
    unit: SYSTEMD_UNIT,
    startedAt: new Date().toISOString(),
    mode: 'systemd'
  };
  await saveRunningState(state);
  return state;
}

async function stopViaSystemd() {
  await execa('systemctl', ['stop', SYSTEMD_UNIT]);
  await saveRunningState(null);
}

export async function startTunnel() {
  const installed = await checkCloudflaredInstalled();
  if (!installed) {
    throw new Error('cloudflared is not installed');
  }

  const config = await loadConfig();
  if (!config.exists || !config.tunnel) {
    throw new Error('config.yml is missing or has no tunnel name');
  }
  if (!config.credentialsValid) {
    throw new Error(config.credentialsError || 'Invalid credentials file');
  }

  if (await isTunnelRunning()) {
    throw new Error(`Tunnel '${config.tunnel}' is already running`);
  }

  if (CONTROL_MODE === 'systemd') {
    return startViaSystemd(config.tunnel);
  }
  return startViaSpawn(config.tunnel);
}

export async function stopTunnel() {
  if (!(await isTunnelRunning())) {
    throw new Error('Tunnel is not running');
  }

  if (CONTROL_MODE === 'systemd') {
    return stopViaSystemd();
  }
  return stopViaSpawn();
}

/** Reload cloudflared after config.yml changes (systemd restart or stop/start). */
export async function restartTunnel() {
  const installed = await checkCloudflaredInstalled();
  if (!installed) {
    throw new Error('cloudflared is not installed');
  }

  if (CONTROL_MODE === 'systemd') {
    await execa('systemctl', ['restart', SYSTEMD_UNIT]);
    const config = await loadConfig();
    await saveRunningState({
      tunnelName: config.tunnel,
      systemd: true,
      unit: SYSTEMD_UNIT,
      startedAt: new Date().toISOString(),
      mode: 'systemd'
    });
    return { mode: 'systemd', unit: SYSTEMD_UNIT };
  }

  const wasRunning = await isTunnelRunning();
  if (wasRunning) {
    await stopTunnel();
  }
  return startTunnel();
}

export async function applyConfigIfRequested(restart) {
  if (!restart) return null;
  const running = await isTunnelRunning();
  if (!running) {
    return { restarted: false, message: 'Config saved. Start the tunnel to apply changes.' };
  }
  await restartTunnel();
  return { restarted: true, message: 'Config saved and tunnel restarted.' };
}

function tunnelIdFromCredentials(credentialsFile) {
  const match = credentialsFile?.match(/([a-f0-9-]{36})\.json$/i);
  return match ? match[1] : null;
}

/** True when `cloudflared tunnel info` shows active edge connections. */
function isConnectedFromTunnelInfo(infoText) {
  if (!infoText) return false;
  return /\d+x[a-z0-9]+/i.test(infoText) && /EDGE/i.test(infoText);
}

export async function getTunnelStatus() {
  const config = await loadConfig();
  await loadRunningState();

  const running = await isTunnelRunning();
  let info = null;
  let cfEntry = null;
  const credentialsTunnelId = tunnelIdFromCredentials(config.credentialsFile);

  if (config.tunnel) {
    info = await getTunnelInfo(config.tunnel);
    const tunnels = await parseCloudflaredTunnels();
    cfEntry =
      tunnels.find((t) => t.name === config.tunnel) ||
      (credentialsTunnelId
        ? tunnels.find((t) => t.id === credentialsTunnelId)
        : null) ||
      tunnels.find((t) => t.name && info?.includes(t.name));
  }

  const connectedFromInfo = isConnectedFromTunnelInfo(info);
  const connectedFromList = cfEntry?.isConnected ?? false;

  return {
    tunnelName: config.tunnel,
    tunnelDisplayName: cfEntry?.name ?? null,
    running,
    pid: runningState?.pid ?? null,
    controlMode: CONTROL_MODE,
    systemdUnit: CONTROL_MODE === 'systemd' ? SYSTEMD_UNIT : null,
    startedAt: runningState?.startedAt ?? null,
    cloudflareConnected: connectedFromInfo || connectedFromList,
    connections: cfEntry?.connections ?? (connectedFromInfo ? 'active' : null),
    info
  };
}
