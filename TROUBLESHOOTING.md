# Homelab Tunnel Buddy: Troubleshooting

Homelab guide for **Ubuntu on Proxmox LXC** running `cloudflared` and Homelab Tunnel Buddy at `/opt/homelab-tunnel-buddy`.

**See also:** [README.md](README.md) | [INSTALL.md](INSTALL.md) | [CLOUDFLARED-COMMANDS.md](CLOUDFLARED-COMMANDS.md)

---

## Table of contents

- [Uninstall cloudflared (re-install)](#uninstall-cloudflared-re-install)
- [cloudflared tunnel cleanup](#cloudflared-tunnel-cleanup)
- [First app works, others 404 on DNS](#first-app-works-others-404-on-dns)
- [Homelab Tunnel Buddy UI](#homelab-tunnel-buddy-ui)
- [homelab-tunnel-buddy.service won't start](#homelab-tunnel-buddyservice-wont-start)
- [cloudflared service](#cloudflared-service)
- [Proxmox LXC](#proxmox-lxc)
- [Useful commands](#useful-commands)

---

## Uninstall cloudflared (re-install)

On the **Ubuntu LXC** (inside the container, not on Proxmox):

```bash
sudo systemctl stop cloudflared
sudo systemctl disable cloudflared
sudo apt-get remove -y cloudflared
sudo apt-get purge -y cloudflared
sudo rm -f /etc/systemd/system/cloudflared.service
sudo systemctl daemon-reload
```

**Homelab Tunnel Buddy** (`homelab-tunnel-buddy.service`) can stay running; the UI will show cloudflared as not installed until you reinstall.

### Kept on disk (for easy re-install)

| Path | Contents |
|------|----------|
| `/etc/cloudflared/config.yml` | Ingress rules |
| `/root/.cloudflared/*.json` | Tunnel credentials |
| `/root/.cloudflared/cert.pem` | Login cert |

### Full wipe (optional)

Only if you want a completely fresh tunnel setup:

```bash
sudo rm -rf /etc/cloudflared /root/.cloudflared /var/log/cloudflared.log
```

Then after reinstall: `cloudflared tunnel login`, `tunnel create`, new `config.yml`.

### Reinstall

Follow [INSTALL.md Part 1](INSTALL.md#part-1-install-system-packages-ubuntu) (Cloudflare apt repo) and [Part 2.4](INSTALL.md#24-install-and-start-cloudflaredservice), then:

```bash
sudo systemctl enable --now cloudflared
```

---

## cloudflared tunnel cleanup

### What it does

`cloudflared tunnel cleanup` **deletes stale connector sessions** for a tunnel in Cloudflare's control plane. It does **not**:

- Delete the tunnel itself
- Remove DNS records or ingress rules in `config.yml`
- Uninstall `cloudflared`

Use it when you see **duplicate connectors**, old LXC/VM instances still connected, or odd routing after rebuilding a container.

### When to use it

| Symptom | Try cleanup |
|---------|-------------|
| `cloudflared tunnel list` shows many `CONNECTIONS` for one tunnel | Yes |
| Rebuilt the Ubuntu LXC but hostname still "connected" elsewhere | Yes |
| Two tunnels (`my-tunnel` + old name) and traffic seems to hit the wrong one | Cleanup **both**, then only run the tunnel you want |
| 404 / flapping right after migrating to a new credentials JSON | Yes, then restart `cloudflared` |

### Command

Run **on the Ubuntu LXC** (SSH or `pct enter`), as root:

```bash
# By tunnel name (from `cloudflared tunnel list`)
sudo cloudflared tunnel cleanup my-tunnel

# Or by UUID
sudo cloudflared tunnel cleanup b2c3d4e5-f6a7-8901-bcde-f12345678901
```

Optional: only remove a specific connector (from `cloudflared tunnel info <name>`):

```bash
sudo cloudflared tunnel cleanup my-tunnel --connector-id <CONNECTOR_ID>
```

### After cleanup

1. Restart the local daemon so a fresh connector registers:

```bash
sudo systemctl restart cloudflared
sleep 3
sudo cloudflared tunnel list
```

2. Confirm **one** active connector for the tunnel you use (e.g. `my-tunnel`) and that `CONNECTIONS` repopulates (e.g. `1xams15, 1xbru01`).

3. Test a public hostname:

```bash
curl -sI https://app1.example.com/ | head -1
```

### Example: two tunnels on one account

```bash
sudo cloudflared tunnel list
# my-tunnel            <- current tunnel
# old-tunnel <- unused tunnel; may still have connectors

sudo cloudflared tunnel cleanup my-tunnel
sudo cloudflared tunnel cleanup old-tunnel
sudo systemctl restart cloudflared   # on the LXC that should run my-tunnel only
```

Stop `cloudflared` on any **other** host still using `old-tunnel` credentials, or retire that tunnel in the Cloudflare dashboard.

### What cleanup is not

| Command | Purpose |
|---------|---------|
| `cloudflared tunnel cleanup <name>` | Remove **stale connections** only |
| `cloudflared tunnel delete <name>` | **Delete the tunnel** from Cloudflare (destructive) |
| `cloudflared tunnel route dns ...` | Add/update **DNS CNAME** to this tunnel |
| `systemctl restart cloudflared` | Restart local process; does not clear remote stale connectors |

---

## First app works, others 404 on DNS

**Internal IP works; public hostname returns 404.** Common causes:

### 1. DNS not routed to this tunnel

Each hostname needs a Cloudflare DNS route to the tunnel that has the matching ingress rule.

```bash
sudo cloudflared tunnel route dns my-tunnel app2.example.com
sudo cloudflared tunnel route dns my-tunnel app3.example.com
```

In Homelab Tunnel Buddy: add route with **Create DNS CNAME** checked.

Check:

```bash
dig +short app2.example.com @1.1.1.1
```

### 2. LAN DNS bypasses the tunnel

If Pi-hole or your router resolves `*.example.com` to an **internal IP** (another reverse proxy or old server), the browser never hits Cloudflare. The first hostname may work if that box has a matching vhost; others return **404**.

**Fix:** Point public hostnames to Cloudflare in DNS (`dig @1.1.1.1`), or add matching internal proxy hosts for every FQDN. Prefer **one** path: either all traffic via the tunnel, or document each internal override.

### 3. Ingress vs `tunnel:` name in `config.yml`

`credentials-file` must match the tunnel you run. The `tunnel:` field should match the name from `cloudflared tunnel list` (e.g. `my-tunnel`):

```yaml
tunnel: my-tunnel
credentials-file: /root/.cloudflared/<uuid>.json
```

Then:

```bash
sudo systemctl restart cloudflared
```

### 4. Verify backend from the LXC

```bash
curl -sI -H "Host: app2.example.com" http://192.168.1.20:8080/ | head -1
curl -sI https://app2.example.com/ | head -1
```

First line = app OK on LAN; second = tunnel + DNS OK.

---

## Homelab Tunnel Buddy UI

| Problem | Fix |
|---------|-----|
| **`TypeError: NetworkError` on load** | Use **`http://host:3847`** (not `https://`); disable Firefox HTTPS-Only for this host; confirm `curl http://host:3847/api/health` works from your PC; `systemctl restart homelab-tunnel-buddy` |
| **`401 Unauthorized`** | `grep HTB_API_KEY /opt/homelab-tunnel-buddy/.env`; `sudo systemctl restart homelab-tunnel-buddy`; re-enter key in UI (private window if needed) |
| **Works with `curl` but not browser** | Hard-refresh (Ctrl+F5); re-enter **HTB_API_KEY**; same URL scheme as `curl` (`http://`) |
| **UI loads but API 401** | Wrong API key in browser vs `.env` |
| **Connection refused on :3847** | `sudo systemctl is-active homelab-tunnel-buddy`; `ss -tlnp \| grep 3847` |
| **Ingress saved, site unchanged** | **Restart tunnel** in UI or `sudo systemctl restart cloudflared` |
| **Two tunnels / flapping** | `HTB_CONTROL_MODE=systemd` only; one `cloudflared.service`; [cleanup](#cloudflared-tunnel-cleanup) stale connectors |
| **Log view empty** | Add `--logfile /var/log/cloudflared.log` to `cloudflared` `ExecStart`; set `CLOUDFLARED_LOG_FILE` in `.env`; ensure the UI process can read the log file |

```bash
sudo journalctl -u homelab-tunnel-buddy -n 40 --no-pager
```

---

## homelab-tunnel-buddy.service won't start

```bash
sudo journalctl -xeu homelab-tunnel-buddy.service --no-pager -n 40
which node && node -v
ls -la /opt/homelab-tunnel-buddy/server/index.js
test -d /opt/homelab-tunnel-buddy/node_modules || (cd /opt/homelab-tunnel-buddy && sudo npm install)
cd /opt/homelab-tunnel-buddy && sudo npm start
```

| Symptom | Fix on Ubuntu |
|---------|----------------|
| `status=203/EXEC` | Install Node 20+; unit uses `/usr/bin/env node` |
| `Failed to load environment files` | Create `/opt/homelab-tunnel-buddy/.env` (see [`.env.example`](.env.example)) |
| `ENOENT` on `server/index.js` | `WorkingDirectory` must be `/opt/homelab-tunnel-buddy` in the unit |
| `Cannot find package` | `cd /opt/homelab-tunnel-buddy && sudo npm install --omit=dev` |
| `EADDRINUSE` | Change `PORT` in `.env` or free port 3847 |

Install steps: [INSTALL.md Part 4](INSTALL.md#part-4-install-homelab-tunnel-buddy).

---

## cloudflared service

| Problem | Fix |
|---------|-----|
| **Please login** | `sudo cloudflared tunnel login` |
| **Tunnel down** | `sudo systemctl status cloudflared`; `sudo cloudflared tunnel list`; check `credentials-file` in `/etc/cloudflared/config.yml` |
| **`ping_group_range` / GID 0 warning** | Usually harmless; tunnel often still works. Optional: `sudo sysctl -w net.ipv4.ping_group_range="0 65534"` and persist in `/etc/sysctl.d/` |
| **203/EXEC** (cloudflared unit) | Install `cloudflared`; use `/usr/bin/cloudflared` in `ExecStart` |
| **Config not applied** | `sudo systemctl restart cloudflared` after editing `config.yml` |
| **Credentials file red in UI** | Fix path in `config.yml` or copy JSON to that path |

```bash
sudo cloudflared tunnel list
sudo cloudflared tunnel info my-tunnel
sudo tail -50 /var/log/cloudflared.log
```

---

## Proxmox LXC

| Problem | Fix |
|---------|-----|
| **`systemctl` fails / units inactive** | Use a **privileged** LXC or enable **Nesting**; run all commands **inside** the CT, not on the Proxmox host |
| **Cannot reach `:3847` from LAN** | Ping LXC IP from another PC; inside CT: `ss -tlnp \| grep 3847`; check Proxmox/LXC firewall |
| **Wrong machine updated** | `hostname` should be your tunnel CT (e.g. `tunnel-host`) before install |

More install issues: [INSTALL.md  Troubleshooting](INSTALL.md#troubleshooting).

---

## Useful commands

```bash
# Tunnels and connectors
sudo cloudflared tunnel list
sudo cloudflared tunnel info my-tunnel
sudo cloudflared tunnel cleanup my-tunnel
sudo systemctl restart cloudflared

# Config
sudo cat /etc/cloudflared/config.yml
sudo systemctl status cloudflared homelab-tunnel-buddy

# Health
curl -s http://127.0.0.1:3847/api/health
curl -sI https://app.example.com/ | head -5

# DNS route (per hostname)
sudo cloudflared tunnel route dns my-tunnel <hostname>
```

---

## Related Cloudflare docs

- [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/)
- **[CLOUDFLARED-COMMANDS.md](CLOUDFLARED-COMMANDS.md):** full CLI quick reference for this repo
- [Useful commands (official)](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/local-management/tunnel-useful-commands/)
