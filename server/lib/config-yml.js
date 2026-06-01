import { readFile, writeFile, rename, copyFile } from 'fs/promises';
import YAML from 'yaml';
import { CLOUDFLARED_CONFIG } from './env.js';
import { validateCredentialsPath } from './credentials.js';
import { validateHostname, validateServiceUrl, validateTunnelName } from './validation.js';

const CATCH_ALL = { service: 'http_status:404' };

function isCatchAllRule(rule) {
  if (!rule || typeof rule !== 'object') return false;
  const svc = rule.service;
  return typeof svc === 'string' && svc.startsWith('http_status:');
}

export function splitIngress(ingress = []) {
  const editable = [];
  let catchAll = { ...CATCH_ALL };
  for (const rule of ingress) {
    if (isCatchAllRule(rule)) {
      catchAll = rule;
    } else {
      editable.push(rule);
    }
  }
  return { editable, catchAll };
}

export function buildIngress(editable, catchAll = CATCH_ALL) {
  return [...editable, catchAll];
}

export async function loadConfig() {
  let raw;
  try {
    raw = await readFile(CLOUDFLARED_CONFIG, 'utf-8');
  } catch (err) {
    if (err.code === 'ENOENT') {
      return {
        tunnel: '',
        credentialsFile: '',
        ingress: [],
        configPath: CLOUDFLARED_CONFIG,
        exists: false
      };
    }
    throw err;
  }

  const doc = YAML.parse(raw) || {};
  const tunnel = doc.tunnel || '';
  const credentialsFile = doc['credentials-file'] || doc.credentialsFile || '';
  const ingress = Array.isArray(doc.ingress) ? doc.ingress : [];
  const { editable, catchAll } = splitIngress(ingress);

  const credCheck = credentialsFile
    ? await validateCredentialsPath(credentialsFile)
    : { valid: false, error: 'No credentials-file set' };

  return {
    tunnel,
    credentialsFile,
    credentialsValid: credCheck.valid,
    credentialsError: credCheck.error || null,
    ingress: editable,
    catchAll,
    configPath: CLOUDFLARED_CONFIG,
    exists: true
  };
}

async function atomicWriteYaml(doc) {
  const content = YAML.stringify(doc, { lineWidth: 0 });
  const tmp = `${CLOUDFLARED_CONFIG}.tmp`;
  const bak = `${CLOUDFLARED_CONFIG}.bak`;

  try {
    await copyFile(CLOUDFLARED_CONFIG, bak);
  } catch {
    // no existing file to backup
  }

  await writeFile(tmp, content, 'utf-8');
  await rename(tmp, CLOUDFLARED_CONFIG);
}

export async function saveConfig({ tunnel, credentialsFile, ingress, catchAll }) {
  const nameCheck = validateTunnelName(tunnel);
  if (nameCheck !== true) throw new Error(nameCheck);

  const credCheck = await validateCredentialsPath(credentialsFile);
  if (!credCheck.valid) throw new Error(credCheck.error);

  const editable = Array.isArray(ingress) ? ingress : [];
  for (const rule of editable) {
    if (rule.hostname) {
      const h = validateHostname(rule.hostname);
      if (h !== true) throw new Error(h);
    }
    if (rule.service) {
      const s = validateServiceUrl(rule.service);
      if (s !== true) throw new Error(s);
    }
  }

  const doc = {
    tunnel,
    'credentials-file': credentialsFile,
    ingress: buildIngress(editable, catchAll || CATCH_ALL)
  };

  await atomicWriteYaml(doc);
  return loadConfig();
}

export async function addIngressRule({ hostname, service }) {
  const config = await loadConfig();
  const editable = [...config.ingress, { hostname, service }];
  return saveConfig({
    tunnel: config.tunnel,
    credentialsFile: config.credentialsFile,
    ingress: editable,
    catchAll: config.catchAll
  });
}

export async function updateIngressRule(index, { hostname, service }) {
  const config = await loadConfig();
  if (index < 0 || index >= config.ingress.length) {
    throw new Error('Ingress rule index out of range');
  }

  const editable = [...config.ingress];
  editable[index] = { hostname, service };

  return saveConfig({
    tunnel: config.tunnel,
    credentialsFile: config.credentialsFile,
    ingress: editable,
    catchAll: config.catchAll
  });
}

export async function deleteIngressRule(index) {
  const config = await loadConfig();
  if (index < 0 || index >= config.ingress.length) {
    throw new Error('Ingress rule index out of range');
  }

  const editable = config.ingress.filter((_, i) => i !== index);
  return saveConfig({
    tunnel: config.tunnel,
    credentialsFile: config.credentialsFile,
    ingress: editable,
    catchAll: config.catchAll
  });
}
