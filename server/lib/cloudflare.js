import { execa } from 'execa';
import { readFile, access } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';
import { constants } from 'fs';
import {
  CLOUDFLARED_BIN,
  CLOUDFLARED_DIR,
  CLOUDFLARED_CONFIG,
  CLOUDFLARED_UPDATE_MODE
} from './env.js';
import { parseCloudflaredVersion, compareVersions } from './version.js';

const UPDATE_TIMEOUT_MS = 180000;
const GITHUB_LATEST_RELEASE_API =
  'https://api.github.com/repos/cloudflare/cloudflared/releases/latest';
const GITHUB_RELEASES_PAGE = 'https://github.com/cloudflare/cloudflared/releases/latest';

async function findCertPath() {
  const candidates = [
    join(CLOUDFLARED_DIR, 'cert.pem'),
    join(homedir(), '.cloudflared', 'cert.pem'),
    '/etc/cloudflared/cert.pem',
    '/root/.cloudflared/cert.pem'
  ];
  for (const p of candidates) {
    try {
      await access(p, constants.F_OK);
      return p;
    } catch {
      // try next
    }
  }
  return null;
}

const CF_EXEC_TIMEOUT_MS = 45_000;

function cf(args, options = {}) {
  return execa(CLOUDFLARED_BIN, args, {
    timeout: CF_EXEC_TIMEOUT_MS,
    ...options
  });
}

export async function checkCloudflaredInstalled() {
  try {
    await cf(['--version']);
    return true;
  } catch {
    return false;
  }
}

export async function checkAuthenticated() {
  try {
    const { stdout } = await cf(['tunnel', 'list'], { reject: false });
    return !stdout.includes('Please login');
  } catch {
    return false;
  }
}

export async function routeDns(tunnelName, hostname) {
  await cf(['tunnel', 'route', 'dns', tunnelName, hostname]);
}

/** Best-effort: capture login URL from cloudflared (headless servers). */
export async function getLoginInstructions() {
  try {
    const proc = cf(['tunnel', 'login'], {
      timeout: 8000,
      reject: false,
      stdout: 'pipe',
      stderr: 'pipe'
    });
    const { stdout, stderr } = await proc;
    const combined = `${stdout}\n${stderr}`;
    const urlMatch = combined.match(/https:\/\/[^\s]+/);
    return {
      manual: !urlMatch,
      url: urlMatch ? urlMatch[0] : null,
      message: urlMatch
        ? 'Open this URL in a browser to authenticate with Cloudflare'
        : 'Run `cloudflared tunnel login` on the server (SSH), then refresh this page.'
    };
  } catch {
    return {
      manual: true,
      url: null,
      message: 'Run `cloudflared tunnel login` on the server (SSH), then refresh this page.'
    };
  }
}

export async function parseCloudflaredTunnels() {
  try {
    const { stdout } = await cf(['tunnel', 'list']);
    const lines = stdout.split('\n');
    const tunnels = [];
    let dataStarted = false;

    for (const line of lines) {
      if (line.includes('ID') && line.includes('NAME') && line.includes('CREATED')) {
        dataStarted = true;
        continue;
      }
      if (dataStarted && line.trim()) {
        const parts = line.trim().split(/\s+/);
        if (parts.length >= 3) {
          const [id, name, created, ...connectionParts] = parts;
          const connections = connectionParts.join(' ');
          tunnels.push({
            id: id.trim(),
            name: name.trim(),
            created: created.trim(),
            connections: connections.trim(),
            isConnected: connections.includes('x')
          });
        }
      }
    }
    return tunnels;
  } catch {
    return [];
  }
}

export async function getTunnelInfo(name) {
  try {
    const { stdout } = await cf(['tunnel', 'info', name]);
    return stdout;
  } catch {
    return null;
  }
}

export async function getCloudflaredVersion() {
  try {
    const { stdout } = await cf(['--version']);
    return stdout.trim();
  } catch {
    return null;
  }
}

export async function getAccountInfo() {
  try {
    const certPath = await findCertPath();
    if (!certPath) return null;
    const certContent = await readFile(certPath, 'utf-8');
    const tokenMatch = certContent.match(
      /-----BEGIN ARGO TUNNEL TOKEN-----\n([\s\S]+?)\n-----END ARGO TUNNEL TOKEN-----/
    );
    if (!tokenMatch) return null;

    const tokenData = Buffer.from(tokenMatch[1].replace(/\n/g, ''), 'base64').toString(
      'utf-8'
    );
    const parsed = JSON.parse(tokenData);
    return {
      accountId: parsed.accountID,
      zoneId: parsed.zoneID,
      hasApiToken: !!parsed.apiToken
    };
  } catch {
    return null;
  }
}

async function fetchGitHubLatestVersion() {
  const res = await fetch(GITHUB_LATEST_RELEASE_API, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'homelab-tunnel-buddy'
    },
    signal: AbortSignal.timeout(15000)
  });
  if (!res.ok) {
    throw new Error(`GitHub API returned ${res.status}`);
  }
  const data = await res.json();
  const tag = data.tag_name || '';
  return tag.replace(/^v/i, '') || null;
}

async function getAptCandidateVersion() {
  try {
    const { stdout } = await execa('apt-cache', ['policy', 'cloudflared'], {
      reject: false
    });
    const match = stdout.match(/Candidate:\s*(\S+)/);
    if (!match || match[1] === '(none)') return null;
    return parseCloudflaredVersion(match[1]) || match[1];
  } catch {
    return null;
  }
}

/** Compare installed version to GitHub + apt candidate before upgrading. */
export async function checkCloudflaredUpdate() {
  const versionRaw = await getCloudflaredVersion();
  const currentParsed = parseCloudflaredVersion(versionRaw);
  const updateMethod = await resolveUpdateMethod();

  let latestGitHub = null;
  let githubError = null;
  try {
    latestGitHub = await fetchGitHubLatestVersion();
  } catch (err) {
    githubError = err.message;
  }

  const aptCandidate = await getAptCandidateVersion();

  const latestForUpgrade =
    updateMethod === 'apt' && aptCandidate ? aptCandidate : latestGitHub;

  const updateAvailableGitHub =
    currentParsed && latestGitHub
      ? compareVersions(currentParsed, latestGitHub) < 0
      : null;

  const updateAvailableApt =
    currentParsed && aptCandidate
      ? compareVersions(currentParsed, aptCandidate) < 0
      : null;

  let updateAvailable = null;
  if (updateMethod === 'apt') {
    updateAvailable = updateAvailableApt ?? updateAvailableGitHub;
  } else if (currentParsed && latestForUpgrade) {
    updateAvailable = compareVersions(currentParsed, latestForUpgrade) < 0;
  } else {
    updateAvailable = updateAvailableGitHub;
  }

  return {
    current: versionRaw,
    currentParsed,
    latestGitHub,
    latestApt: aptCandidate,
    latestForUpgrade,
    updateAvailable,
    updateAvailableGitHub,
    updateAvailableApt,
    updateMethod,
    githubUrl: GITHUB_RELEASES_PAGE,
    githubError
  };
}

async function canUpdateViaApt() {
  try {
    await execa('which', ['apt-get']);
    await execa('dpkg', ['-l', 'cloudflared']);
    const { stdout } = await execa('apt-cache', ['policy', 'cloudflared'], {
      reject: false
    });
    return /Candidate:\s*\S+/.test(stdout) && !/Candidate:\s*\(none\)/.test(stdout);
  } catch {
    return false;
  }
}

async function isDpkgCloudflaredPackage() {
  try {
    await execa('dpkg', ['-l', 'cloudflared']);
    return true;
  } catch {
    return false;
  }
}

async function resolveUpdateMethod() {
  const mode = CLOUDFLARED_UPDATE_MODE.toLowerCase();
  if (mode !== 'auto') return mode;
  // Cloudflare docs: apt install → use apt-get install --only-upgrade
  if (await canUpdateViaApt()) return 'apt';
  if (await isDpkgCloudflaredPackage()) return 'dpkg';
  return 'builtin';
}

async function getDebArchitecture() {
  try {
    const { stdout } = await execa('dpkg', ['--print-architecture']);
    return stdout.trim() || 'amd64';
  } catch {
    return 'amd64';
  }
}

async function updateViaDpkg() {
  const arch = await getDebArchitecture();
  const debPath = '/tmp/cloudflared-update.deb';
  const url = `https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${arch}.deb`;
  await execa('curl', ['-fsSL', '-o', debPath, url], { timeout: UPDATE_TIMEOUT_MS });
  const { stdout, stderr, exitCode } = await execa('dpkg', ['-i', debPath], {
    timeout: UPDATE_TIMEOUT_MS,
    reject: false
  });
  const combined = [stdout, stderr].filter(Boolean).join('\n');
  if (exitCode !== 0) {
    const err = new Error(combined || 'dpkg install failed');
    err.status = 500;
    throw err;
  }
  return combined;
}

async function updateViaApt() {
  const env = { ...process.env, DEBIAN_FRONTEND: 'noninteractive' };

  const update = await execa('apt-get', ['update'], {
    timeout: UPDATE_TIMEOUT_MS,
    env,
    reject: false
  });

  const upgrade = await execa(
    'apt-get',
    ['install', '-y', '--only-upgrade', 'cloudflared'],
    { timeout: UPDATE_TIMEOUT_MS, env, reject: false }
  );

  const combined = [update.stdout, update.stderr, upgrade.stdout, upgrade.stderr]
    .filter(Boolean)
    .join('\n');

  if (upgrade.exitCode !== 0) {
    const err = new Error(combined || 'apt upgrade cloudflared failed');
    err.status = 500;
    throw err;
  }

  return combined;
}

async function updateViaBuiltin() {
  const { stdout, stderr, exitCode } = await cf(['update'], {
    timeout: UPDATE_TIMEOUT_MS,
    reject: false
  });
  const combined = [stdout, stderr].filter(Boolean).join('\n');
  if (exitCode !== 0) {
    const err = new Error(combined || 'cloudflared update failed');
    err.status = 500;
    throw err;
  }
  return combined;
}

/** Upgrade cloudflared binary (dpkg .deb, apt, or `cloudflared update`). */
export async function updateCloudflared(options = {}) {
  const installed = await checkCloudflaredInstalled();
  if (!installed) {
    throw new Error('cloudflared is not installed');
  }

  const check = await checkCloudflaredUpdate();
  if (check.updateAvailable === false && !options.force) {
    return {
      skipped: true,
      message: `Already up to date (${check.currentParsed || check.current}).`,
      ...check
    };
  }

  const versionBefore = check.current || (await getCloudflaredVersion());
  const method = await resolveUpdateMethod();
  let output;

  switch (method) {
    case 'dpkg':
      output = await updateViaDpkg();
      break;
    case 'apt':
      output = await updateViaApt();
      break;
    case 'builtin':
      output = await updateViaBuiltin();
      break;
    default:
      throw new Error(
        `Invalid CLOUDFLARED_UPDATE_MODE "${method}". Use auto, dpkg, apt, or builtin.`
      );
  }

  const versionAfter = await getCloudflaredVersion();
  const versionAfterParsed = parseCloudflaredVersion(versionAfter);
  return {
    skipped: false,
    method,
    versionBefore,
    versionAfter,
    versionAfterParsed,
    output,
    ...check
  };
}

export async function getCloudflaredStatus() {
  const installed = await checkCloudflaredInstalled();
  const authenticated = installed ? await checkAuthenticated() : false;
  const version = installed ? await getCloudflaredVersion() : null;
  const account = authenticated ? await getAccountInfo() : null;
  const tunnels = authenticated ? await parseCloudflaredTunnels() : [];
  const update =
    installed ? await checkCloudflaredUpdate().catch((err) => ({
      updateAvailable: null,
      githubError: err.message
    })) : null;

  return {
    installed,
    authenticated,
    version,
    account,
    tunnels,
    update,
    cloudflaredDir: CLOUDFLARED_DIR,
    configPath: CLOUDFLARED_CONFIG
  };
}
