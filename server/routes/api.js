import { Router } from 'express';
import {
  loadConfig,
  saveConfig,
  addIngressRule,
  updateIngressRule,
  deleteIngressRule
} from '../lib/config-yml.js';
import { listCredentialFiles } from '../lib/credentials.js';
import {
  routeDns,
  getCloudflaredStatus,
  getLoginInstructions,
  checkCloudflaredUpdate,
  updateCloudflared
} from '../lib/cloudflare.js';
import {
  startTunnel,
  stopTunnel,
  restartTunnel,
  getTunnelStatus,
  applyConfigIfRequested,
  initTunnelManager
} from '../lib/tunnel-manager.js';
import { validateTunnelName, applyHostnameSuffix } from '../lib/validation.js';
import { readCloudflaredLog } from '../lib/cloudflared-log.js';
import {
  CLOUDFLARED_CONFIG,
  CLOUDFLARED_DIR,
  CLOUDFLARED_LOG_FILE,
  CONTROL_MODE,
  SYSTEMD_UNIT,
  INGRESS_HOSTNAME_SUFFIX,
  ROUTE_DNS_DEFAULT
} from '../lib/env.js';

const router = Router();

router.get('/health', (_req, res) => {
  res.json({ ok: true });
});

router.get('/cloudflared/status', async (_req, res, next) => {
  try {
    const status = await getCloudflaredStatus();
    res.json(status);
  } catch (err) {
    next(err);
  }
});

router.get('/cloudflared/logs', async (req, res, next) => {
  try {
    const since = req.query.since;
    const lines = req.query.lines;
    const log = await readCloudflaredLog(CLOUDFLARED_LOG_FILE, { since, lines });
    res.json(log);
  } catch (err) {
    next(err);
  }
});

router.post('/cloudflared/login', async (_req, res, next) => {
  try {
    const instructions = await getLoginInstructions();
    res.json(instructions);
  } catch (err) {
    next(err);
  }
});

router.get('/cloudflared/update/check', async (_req, res, next) => {
  try {
    const check = await checkCloudflaredUpdate();
    res.json(check);
  } catch (err) {
    next(err);
  }
});

router.post('/cloudflared/update', async (req, res, next) => {
  try {
    const result = await updateCloudflared({ force: req.body?.force === true });
    if (result.skipped) {
      return res.json(result);
    }
    if (req.body?.restart !== false) {
      const { restartTunnel } = await import('../lib/tunnel-manager.js');
      await restartTunnel();
      result.restarted = true;
      result.message =
        'cloudflared updated and tunnel restarted. Traffic may have dropped briefly.';
    } else {
      result.restarted = false;
      result.message = 'cloudflared updated. Restart the tunnel to use the new version.';
    }
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.get('/config', async (_req, res, next) => {
  try {
    const config = await loadConfig();
    res.json({
      ...config,
      controlMode: CONTROL_MODE,
      systemdUnit: SYSTEMD_UNIT
    });
  } catch (err) {
    next(err);
  }
});

router.put('/config', async (req, res, next) => {
  try {
    const { tunnel, credentialsFile } = req.body;
    const current = await loadConfig();
    const nameCheck = validateTunnelName(tunnel);
    if (nameCheck !== true) {
      return res.status(400).json({ error: nameCheck });
    }
    const config = await saveConfig({
      tunnel,
      credentialsFile,
      ingress: current.ingress,
      catchAll: current.catchAll
    });
    const apply = await applyConfigIfRequested(req.body.restart === true);
    res.json({ ...config, apply });
  } catch (err) {
    next(err);
  }
});

router.get('/config/ingress', async (_req, res, next) => {
  try {
    const config = await loadConfig();
    res.json({
      ingress: config.ingress.map((rule, index) => ({ index, ...rule })),
      catchAll: config.catchAll
    });
  } catch (err) {
    next(err);
  }
});

router.post('/config/ingress', async (req, res, next) => {
  try {
    const { service, routeDns: doDns, restart } = req.body;
    const hostname = applyHostnameSuffix(req.body.hostname, INGRESS_HOSTNAME_SUFFIX);
    const config = await addIngressRule({ hostname, service });
    if (doDns && config.tunnel) {
      await routeDns(config.tunnel, hostname);
    }
    const apply = await applyConfigIfRequested(restart !== false);
    res.status(201).json({ ...config, apply });
  } catch (err) {
    next(err);
  }
});

router.patch('/config/ingress/:index', async (req, res, next) => {
  try {
    const index = parseInt(req.params.index, 10);
    const { service } = req.body;
    const hostname = applyHostnameSuffix(req.body.hostname, INGRESS_HOSTNAME_SUFFIX);
    const config = await updateIngressRule(index, { hostname, service });
    const apply = await applyConfigIfRequested(req.body.restart !== false);
    res.json({ ...config, apply });
  } catch (err) {
    next(err);
  }
});

router.delete('/config/ingress/:index', async (req, res, next) => {
  try {
    const index = parseInt(req.params.index, 10);
    const config = await deleteIngressRule(index);
    const apply = await applyConfigIfRequested(req.query.restart !== 'false');
    res.json({ ...config, apply });
  } catch (err) {
    next(err);
  }
});

router.get('/credentials', async (_req, res, next) => {
  try {
    const files = await listCredentialFiles();
    res.json({ files, cloudflaredDir: CLOUDFLARED_DIR });
  } catch (err) {
    next(err);
  }
});

router.get('/tunnel/status', async (_req, res, next) => {
  try {
    const status = await getTunnelStatus();
    res.json(status);
  } catch (err) {
    next(err);
  }
});

router.post('/tunnel/start', async (_req, res, next) => {
  try {
    const state = await startTunnel();
    const status = await getTunnelStatus();
    res.json({ state, status });
  } catch (err) {
    next(err);
  }
});

router.post('/tunnel/stop', async (_req, res, next) => {
  try {
    await stopTunnel();
    const status = await getTunnelStatus();
    res.json({ status });
  } catch (err) {
    next(err);
  }
});

router.post('/tunnel/restart', async (_req, res, next) => {
  try {
    const state = await restartTunnel();
    const status = await getTunnelStatus();
    res.json({ state, status });
  } catch (err) {
    next(err);
  }
});

router.get('/meta', (_req, res) => {
  res.json({
    cloudflaredDir: CLOUDFLARED_DIR,
    cloudflaredConfig: CLOUDFLARED_CONFIG,
    cloudflaredLogFile: CLOUDFLARED_LOG_FILE,
    controlMode: CONTROL_MODE,
    systemdUnit: SYSTEMD_UNIT,
    authRequired: Boolean(process.env.HTB_API_KEY),
    ingressHostnameSuffix: INGRESS_HOSTNAME_SUFFIX || null,
    routeDnsDefault: ROUTE_DNS_DEFAULT
  });
});

export { router, initTunnelManager };
