# cloudflared: command quick reference

Fast lookup for **locally-managed tunnels** on your Ubuntu LXC. Run commands **inside the tunnel container** (`ssh root@tunnel-host.lan`) unless noted.

**Official docs (full list):** [Useful commands](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/local-management/tunnel-useful-commands/)

**Homelab guides:** [INSTALL.md](INSTALL.md) | [TROUBLESHOOTING.md](TROUBLESHOOTING.md)

---

## Manage `cloudflared`

| Command | Description |
|---------|-------------|
| `cloudflared version` | Print version and build date |
| `cloudflared update` | Check GitHub for a newer binary and update (if installed from GitHub `.deb`/source) |
| `cloudflared help` | List top-level commands |
| `cloudflared tunnel help` | List all `tunnel` subcommands |

```bash
cloudflared --version
sudo cloudflared update
```

---

## Manage tunnels

| Command | Description |
|---------|-------------|
| `cloudflared tunnel login` | Browser auth; creates `cert.pem` under `~/.cloudflared/` |
| `cloudflared tunnel list` | Active tunnels, created time, connections (`-d` includes deleted) |
| `cloudflared tunnel create <NAME>` | Create tunnel + credentials JSON |
| `cloudflared tunnel run <NAME>` | Run tunnel (CLI only; prefer `systemd` in production) |
| `cloudflared tunnel --config <path> run <NAME>` | Run with explicit config file |
| `cloudflared tunnel info <NAME or UUID>` | Connector details and replica IDs |
| `cloudflared tunnel cleanup <NAME or UUID>` | Delete **stale connections** (not the tunnel itself) |
| `cloudflared tunnel cleanup --connector-id <ID> <NAME>` | Remove one connector replica |
| `cloudflared tunnel delete <NAME or UUID>` | Delete tunnel (`-f` if still connected) |
| `cloudflared tail <UUID>` | Livestream tunnel logs |

### Homelab examples

```bash
sudo cloudflared tunnel login
sudo cloudflared tunnel list
sudo cloudflared tunnel create my-tunnel
sudo cloudflared tunnel info my-tunnel

# Stale connectors after LXC rebuild (see TROUBLESHOOTING.md)
sudo cloudflared tunnel cleanup my-tunnel
sudo systemctl restart cloudflared

# Production run (config + systemd)
sudo cloudflared --config /etc/cloudflared/config.yml tunnel run
# Or: systemctl start cloudflared
```

**Config file:** `/etc/cloudflared/config.yml`. `tunnel:` must match name or UUID from `tunnel list`; `credentials-file:` points at `/root/.cloudflared/<uuid>.json`.

---

## Published applications (DNS & ingress)

Ingress hostnames are defined in `config.yml`. DNS must route each hostname to this tunnel.

| Command | Description |
|---------|-------------|
| `cloudflared tunnel route dns <TUNNEL> <hostname>` | Create DNS **CNAME** for hostname -> tunnel |
| `cloudflared tunnel route lb <TUNNEL> <hostname> <pool>` | Add tunnel endpoint to a load balancer pool |

### Homelab examples

```bash
# One hostname
sudo cloudflared tunnel route dns my-tunnel app1.example.com

# Match tunnel name in config.yml / credentials
sudo cloudflared tunnel route dns my-tunnel app2.example.com
```

In **Homelab Tunnel Buddy**, use **Create DNS CNAME** when adding an ingress route (calls `route dns` for you).

**Ingress shape** (`/etc/cloudflared/config.yml`):

```yaml
tunnel: my-tunnel
credentials-file: /root/.cloudflared/a1b2c3d4-e5f6-7890-abcd-ef1234567890.json
ingress:
  - hostname: app.example.com
    service: http://10.0.0.50:8080
  - service: http_status:404
```

---

## Private networks (WARP / Zero Trust)

Only needed if you route **private IP/CIDR** through the tunnel (not typical for simple homelab HTTP apps).

| Command | Description |
|---------|-------------|
| `cloudflared tunnel route ip add <CIDR> <TUNNEL>` | Add private network route (`--vnet` optional) |
| `cloudflared tunnel route ip show` | List IP routes (aliases: `list`) |
| `cloudflared tunnel route ip delete ...` | Remove IP route |
| `cloudflared tunnel route ip get <IP/CIDR>` | Which route matches an IP |
| `cloudflared tunnel vnet add <NAME>` | Create virtual network (`-d` = default) |
| `cloudflared tunnel vnet list` | List virtual networks |
| `cloudflared tunnel vnet delete <NAME>` | Delete VNET (remove IP routes first) |

---

## systemd + Homelab Tunnel Buddy (this project)

| Task | Command |
|------|---------|
| Restart tunnel | `sudo systemctl restart cloudflared` |
| Restart UI | `sudo systemctl restart homelab-tunnel-buddy` |
| Tunnel logs (file) | `sudo tail -f /var/log/cloudflared.log` |
| Homelab Tunnel Buddy logs | `sudo journalctl -u homelab-tunnel-buddy -f` |
| UI health | `curl -s http://127.0.0.1:3847/api/health` |

Homelab Tunnel Buddy uses `HTB_CONTROL_MODE=systemd` to call `systemctl` on `cloudflared.service`. See [README.md: Configuration](README.md#configuration).

---

## Common workflows

### Fresh install on Ubuntu LXC

1. Install `cloudflared` via apt ([INSTALL.md Part 1](INSTALL.md#part-1-install-system-packages-ubuntu))
2. `cloudflared tunnel login`
3. `cloudflared tunnel create <name>`
4. Edit `/etc/cloudflared/config.yml`
5. `cloudflared tunnel route dns <name> <hostname>` per app
6. Install `cloudflared.service` -> `systemctl enable --now cloudflared`

-> [INSTALL.md](INSTALL.md)

### Re-install after `apt purge cloudflared`

1. Reinstall via apt ([INSTALL.md Part 1](INSTALL.md#part-1-install-system-packages-ubuntu))
2. Restore `cloudflared.service` ([Part 2.4](INSTALL.md#24-install-and-start-cloudflaredservice))
3. `systemctl start cloudflared` (keep existing `config.yml` + credentials if kept)

-> [TROUBLESHOOTING.md: Uninstall](TROUBLESHOOTING.md#uninstall-cloudflared-re-install)

### Fix duplicate connectors / wrong tunnel

1. `cloudflared tunnel list`
2. `cloudflared tunnel cleanup <name>` on each tunnel
3. Stop old hosts; only one `cloudflared.service` with correct credentials
4. `systemctl restart cloudflared`

-> [TROUBLESHOOTING.md: cleanup](TROUBLESHOOTING.md#cloudflared-tunnel-cleanup)

### First app works, others 404

1. `cloudflared tunnel route dns <tunnel> <hostname>` for each app
2. If LAN DNS overrides public names, fix split-DNS or internal proxy hosts ([TROUBLESHOOTING.md](TROUBLESHOOTING.md#first-app-works-others-404-on-dns))
3. `curl -sI -H "Host: ..." http://<backend-ip>/`

-> [TROUBLESHOOTING.md: 404](TROUBLESHOOTING.md#first-app-works-others-404-on-dns)

---

## Related links

- [Useful commands (Cloudflare)](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/local-management/tunnel-useful-commands/)
- [Configuration file](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/local-management/configuration-file/)
- [Install cloudflared](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/downloads/)
- [Tunnel logs](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/monitor-tunnels/logs/)
