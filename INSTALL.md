# Homelab Tunnel Buddy: Clean install (Ubuntu on Proxmox LXC)

Step-by-step **manual** setup on an **Ubuntu 22.04 or 24.04 LTS** container, typically a **Proxmox LXC** (e.g. `tunnel-host`) dedicated to `cloudflared` and Homelab Tunnel Buddy.

**Reference docs:** [README.md](README.md) | [TROUBLESHOOTING.md](TROUBLESHOOTING.md) | [CLOUDFLARED-COMMANDS.md](CLOUDFLARED-COMMANDS.md)

**Time:** ~15 minutes  
**Where:** Inside the **Ubuntu LXC**, not on the Proxmox host  
**Install path:** `/opt/homelab-tunnel-buddy`  
**UI port:** `3847`

---

## Table of contents

- [What you need before starting](#what-you-need-before-starting)
- [Proxmox LXC (Ubuntu)](#proxmox-lxc-ubuntu)
- [Part 1: Install system packages (Ubuntu)](#part-1-install-system-packages-ubuntu)
- [Part 2: Cloudflare tunnel (first-time only)](#part-2-cloudflare-tunnel-first-time-only)
- [Part 3: Copy the app onto the Ubuntu LXC](#part-3-copy-the-app-onto-the-ubuntu-lxc)
- [Part 4: Install Homelab Tunnel Buddy](#part-4-install-homelab-tunnel-buddy)
- [Part 5: LAN access](#part-5-lan-access)
- [Part 6: First use in the browser](#part-6-first-use-in-the-browser)
- [Verification checklist](#verification-checklist)
- [Troubleshooting](#troubleshooting)
- [File reference](#file-reference)
- [Updating the app later](#updating-the-app-later)

---

## What you need before starting

- **Ubuntu LXC** (or VM) with root or `sudo`
- SSH into the **container** (e.g. `ssh root@tunnel-host.lan`) or `pct enter <ctid>` from Proxmox
- A Cloudflare account and zone (domain on Cloudflare)
- Either:
  - **Already done:** `cloudflared tunnel login`, `tunnel create`, credentials JSON, and `cloudflared.service`. Skip to [Part 3](#part-3-copy-the-app-onto-the-ubuntu-lxc) or [Part 4](#part-4-install-homelab-tunnel-buddy) if the app is already copied, or
  - **Fresh:** follow [Part 1-2](#part-1-install-system-packages-ubuntu) first

---

## Proxmox LXC (Ubuntu)


| Step | Action                                                                                                   |
| ---- | -------------------------------------------------------------------------------------------------------- |
| 1    | In Proxmox, create an LXC from an **Ubuntu 22.04/24.04** template                                        |
| 2    | Prefer **privileged** for `systemd` + `cloudflared`; or unprivileged with **Features -> Nesting** enabled |
| 3    | Assign LAN IP / DNS (e.g. `tunnel-host.lan`, `192.168.1.x`)                                              |
| 4    | SSH into the **Ubuntu** environment; all commands below run **inside the LXC**                          |


Verify you are in the container:

```bash
hostname          # e.g. tunnel-host
lsb_release -ds   # Ubuntu 24.04.2 LTS (or similar)
```

Do **not** run `apt install` for Homelab Tunnel Buddy on the Proxmox hypervisor unless the tunnel runs on the host itself.

---

## Part 1: Install system packages (Ubuntu)

Run inside the Ubuntu LXC:

```bash
sudo apt update
sudo apt install -y curl ca-certificates
```

### Node.js 20+

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo bash -
sudo apt install -y nodejs
node -v    # must show v20.x or higher
which node
```

### cloudflared (skip if already installed)

**Recommended:** Cloudflare apt repository ([install docs](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/downloads/)):

```bash
# Add Cloudflare GPG key
sudo mkdir -p --mode=0755 /usr/share/keyrings
curl -fsSL https://pkg.cloudflare.com/cloudflare-public-v2.gpg | sudo tee /usr/share/keyrings/cloudflare-public-v2.gpg >/dev/null

# Add this repo to your apt repositories
echo 'deb [signed-by=/usr/share/keyrings/cloudflare-public-v2.gpg] https://pkg.cloudflare.com/cloudflared any main' | sudo tee /etc/apt/sources.list.d/cloudflared.list

# Install cloudflared
sudo apt-get update && sudo apt-get install -y cloudflared
cloudflared --version
which cloudflared   # usually /usr/bin/cloudflared
```

---

## Part 2: Cloudflare tunnel (first-time only)

### 2.1 Log in to Cloudflare

```bash
sudo cloudflared tunnel login
```

Open the URL shown, approve access in the browser. This creates `cert.pem` (often under `/root/.cloudflared/`).

### 2.2 Create a named tunnel

```bash
sudo cloudflared tunnel create my-tunnel
```

Note the credentials file path printed, e.g.:

`/root/.cloudflared/a1b2c3d4-e5f6-7890-abcd-ef1234567890.json`

That file is JSON with `AccountTag`, `TunnelSecret`, and `TunnelID` (created by Cloudflare; do not hand-edit except when recovering from a token).

List tunnels:

```bash
sudo cloudflared tunnel list
```

Use the **tunnel name** from this list in `config.yml` (e.g. `my-tunnel`).

### 2.3 Create `/etc/cloudflared/config.yml`

```bash
sudo mkdir -p /etc/cloudflared
sudo nano /etc/cloudflared/config.yml
```

Example (use **your** tunnel name and credentials path from `tunnel create`):

```yaml
tunnel: my-tunnel
credentials-file: /root/.cloudflared/a1b2c3d4-e5f6-7890-abcd-ef1234567890.json

ingress:
  - hostname: app.example.com
    service: http://192.168.1.10:80
  - service: http_status:404
```

The last rule must be a catch-all `http_status:404`. Add one `hostname` + `service` block per app.

### 2.4 Install and start `cloudflared.service`

```bash
sudo nano /etc/systemd/system/cloudflared.service
```

Paste:

```ini
[Unit]
Description=cloudflared
After=network-online.target
Wants=network-online.target

[Service]
TimeoutStartSec=15
Type=notify
ExecStart=/usr/bin/cloudflared --no-autoupdate --loglevel info --logfile /var/log/cloudflared.log --config /etc/cloudflared/config.yml tunnel run
Restart=on-failure
RestartSec=5s

[Install]
WantedBy=multi-user.target
```

Enable and start:

```bash
sudo systemctl daemon-reload
sudo touch /var/log/cloudflared.log
sudo chmod 644 /var/log/cloudflared.log
sudo systemctl enable --now cloudflared
sudo systemctl status cloudflared
sudo cloudflared tunnel list
```

Homelab Tunnel Buddy can show this log under **Tunnel logs** (set `CLOUDFLARED_LOG_FILE` in `.env` if you use a different path).

### 2.5 DNS for each public hostname (per app)

For each `hostname` in `config.yml`, create a DNS route to this tunnel:

```bash
sudo cloudflared tunnel route dns my-tunnel app.example.com
```

Or enable **Create DNS CNAME** when adding routes in Homelab Tunnel Buddy later.

---

## Part 3: Copy the app onto the Ubuntu LXC

The repo is a **single project** at the root: `package.json`, `server/`, and `public/` in the same directory.

### Option A: Git clone (inside the Ubuntu LXC)

```bash
sudo mkdir -p /opt/homelab-tunnel-buddy
sudo git clone https://github.com/Scampi-ml/homelab-tunnel-buddy.git /opt/homelab-tunnel-buddy
cd /opt/homelab-tunnel-buddy
ls package.json server/ public/
```

### Option B: SCP from your PC to the LXC

```bash
# On your PC (from the repo root); use the LXC hostname or IP
scp -r . root@tunnel-host.lan:/opt/homelab-tunnel-buddy
# Or: scp -r . root@192.168.1.100:/opt/homelab-tunnel-buddy
```

Exclude `node_modules`; run `npm install` on the Ubuntu LXC instead.

### Option C: Tarball

On your PC, upload an archive; on the LXC:

```bash
sudo mkdir -p /opt/homelab-tunnel-buddy
sudo tar -xzf /tmp/homelab-tunnel-buddy-upload.tar.gz -C /opt/homelab-tunnel-buddy
```

Expected layout:

```
/opt/homelab-tunnel-buddy/
  package.json
  server/
  public/
  .env          # create in Part 4
```

### Verify on the Ubuntu LXC

```bash
ls /opt/homelab-tunnel-buddy/package.json
ls /opt/homelab-tunnel-buddy/server/index.js
hostname    # confirm you are on the tunnel LXC
```

---

## Part 4: Install Homelab Tunnel Buddy

```bash
cd /opt/homelab-tunnel-buddy
sudo npm install --omit=dev
```

### 4.1 Create `.env`

```bash
sudo nano /opt/homelab-tunnel-buddy/.env
sudo chmod 600 /opt/homelab-tunnel-buddy/.env
```

Copy from [.env.example](.env.example) on the server, or set at minimum:

```ini
PORT=3847
CLOUDFLARED_DIR=/etc/cloudflared
CLOUDFLARED_CONFIG=/etc/cloudflared/config.yml
CLOUDFLARED_PATH=/usr/bin/cloudflared
CLOUDFLARED_LOG_FILE=/var/log/cloudflared.log
HTB_API_KEY=paste-a-long-random-secret-here

HTB_CONTROL_MODE=systemd
HTB_SYSTEMD_UNIT=cloudflared.service
HTB_STATE_FILE=/opt/homelab-tunnel-buddy/.homelab-tunnel-buddy-running.json
CREDENTIALS_DIRS=/etc/cloudflared,/root/.cloudflared
CLOUDFLARED_UPDATE_MODE=apt

# Optional (see below)
HTB_INGRESS_HOSTNAME_SUFFIX=example.com
HTB_ROUTE_DNS_DEFAULT=true
```

#### Optional UI settings

**`HTB_INGRESS_HOSTNAME_SUFFIX`:** If set (e.g. `example.com`), the **Add route** dialog only asks for a short label (`app1`). The UI saves `app1.example.com` as the hostname.

**`HTB_ROUTE_DNS_DEFAULT`:** Controls the **Create DNS CNAME via cloudflared** checkbox when you add a new ingress route.


| Value            | Checkbox on **Add route** |
| ---------------- | ------------------------- |
| `true`           | **Checked** by default    |
| `false` or unset | **Unchecked** by default  |


You can still turn the checkbox off or on before saving; this only sets the **initial** state when the dialog opens.

**What the checkbox does when checked (and you save a new route):**

1. Homelab Tunnel Buddy writes the hostname and service URL to `/etc/cloudflared/config.yml` (as usual).
2. It also runs (on the server):
  ```bash
   cloudflared tunnel route dns <tunnel-name> <full-hostname>
  ```
   That creates a **DNS CNAME** in Cloudflare for that hostname, pointing at your tunnel (same as the [CLI](CLOUDFLARED-COMMANDS.md#published-applications-dns--ingress)).
3. If the tunnel is running, it can restart `cloudflared` so the new ingress rule is picked up.

**Requirements:**

- `cloudflared tunnel login` must have authorized the **zone** that owns the hostname (e.g. `example.com`).
- `tunnel:` in `config.yml` must match the tunnel name used by `route dns` (from `cloudflared tunnel list`).
- The hostname must be under that zone (e.g. `app1.example.com`, not another domain).

**Not affected:**

- **Edit route:** the DNS checkbox is hidden; editing does not run `route dns` again. Add DNS manually in the Cloudflare dashboard or run `cloudflared tunnel route dns` once per hostname.
- **Existing routes:** only applies when you click **Add route**.

**Example:**

```ini
HTB_INGRESS_HOSTNAME_SUFFIX=example.com
HTB_ROUTE_DNS_DEFAULT=true
```

Open **Ingress routes** -> **Add route** -> enter label `app1`, service `http://192.168.1.10:80` -> **Create DNS CNAME** is already checked -> **Save**. Homelab Tunnel Buddy adds `app1.example.com` to `config.yml` and creates the CNAME in Cloudflare.

After changing this in `.env`, restart Homelab Tunnel Buddy:

```bash
sudo systemctl restart homelab-tunnel-buddy
```

Generate a random API key:

```bash
openssl rand -hex 32
```

**Important:** `HTB_CONTROL_MODE=systemd` means the UI controls your existing `cloudflared.service`. It does not start a second tunnel.

Full variable reference: [README.md  Configuration](README.md#configuration).

### 4.2 Quick test (optional)

```bash
cd /opt/homelab-tunnel-buddy
sudo npm start
```

In another SSH session:

```bash
curl -s http://127.0.0.1:3847/api/health

# All other /api routes need the key from .env:
export API_KEY="paste-from-opt-homelab-tunnel-buddy-env"
curl -s -H "Authorization: Bearer $API_KEY" http://127.0.0.1:3847/api/config
curl -s -H "Authorization: Bearer $API_KEY" http://127.0.0.1:3847/api/tunnel/status
```

Stop the test with `Ctrl+C`.

### 4.3 Install `homelab-tunnel-buddy.service`

```bash
sudo nano /etc/systemd/system/homelab-tunnel-buddy.service
```

Paste:

```ini
[Unit]
Description=Homelab Tunnel Buddy
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/homelab-tunnel-buddy

# Uses .env in the app directory (edit /opt/homelab-tunnel-buddy/.env)
EnvironmentFile=-/opt/homelab-tunnel-buddy/.env

Environment=PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
Environment=NODE_ENV=production

ExecStart=/usr/bin/env node server/index.js

Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

Enable and start:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now homelab-tunnel-buddy
sudo systemctl status homelab-tunnel-buddy
```

Logs:

```bash
sudo journalctl -u homelab-tunnel-buddy -f
```

If the unit fails to start, see [README.md: Run on Ubuntu](README.md#run-on-ubuntu).

---

## Part 5: LAN access

Homelab Tunnel Buddy listens on **port 3847** on all interfaces. From any machine on your LAN:

```
http://<ubuntu-lxc-ip>:3847
```

Example: `http://tunnel-host.lan:3847` if LAN DNS points at the LXC.

Use **`http://`**, not `https://`, unless you add your own TLS terminator. Firefox **HTTPS-Only** can break the UI if it upgrades the URL without a certificate on port 3847.

Set a strong **HTB_API_KEY** in `.env` before exposing the UI on the LAN. Ingress **service** URLs should point **directly** at each app (e.g. `http://192.168.1.50:8080`), not at another reverse proxy, unless you deliberately route that way.

<details>
<summary>Optional: reverse proxy in front of the UI (e.g. Nginx Proxy Manager)</summary>

Only if you want a friendly LAN hostname instead of `:3847`:

1. **Proxy Host** -> domain e.g. `tunnels.home.lan` -> forward to `http://<ubuntu-lxc-ip>:3847`
2. Prefer LAN-only access; keep **HTB_API_KEY** set
3. Open the UI via your proxy URL and enter the API key

Ingress routes for public hostnames still use direct app backends in `config.yml` unless you design otherwise.

</details>

---

## Part 6: First use in the browser

1. **Tunnel** (sidebar): check tunnel name, credentials path (green = file exists), Cloudflare connection.
2. **Ingress routes** -> **Add route**:
  - **Hostname:** `app.yourdomain.com`
  - **Service URL:** `http://<app-ip>:port` (direct to the app)
  - **Create DNS CNAME:** checked automatically if `HTB_ROUTE_DNS_DEFAULT=true` in `.env` (see [Part 4.1](#41-create-env))
3. The UI restarts `cloudflared` automatically when the tunnel is already running.
4. Test `https://app.yourdomain.com` from outside your LAN.

---

## Verification checklist

```bash
# confirm Ubuntu LXC
hostname
lsb_release -ds

# cloudflared
sudo systemctl is-active cloudflared
sudo cloudflared tunnel list

# tunnel buddy
sudo systemctl is-active homelab-tunnel-buddy
curl -s http://127.0.0.1:3847/api/health

# config readable by app
sudo cat /etc/cloudflared/config.yml
sudo ls -la /root/.cloudflared/*.json /etc/cloudflared/*.json 2>/dev/null
```

In the UI:

- **Cloudflared** -> Installed: Yes, Authenticated: Yes
- **Ingress routes** table matches `config.yml`
- Start / Stop / Restart tunnel works
- New ingress route appears in `/etc/cloudflared/config.yml`
- **Tunnel logs** shows output (requires `--logfile` on `cloudflared`)

---

## Troubleshooting


| Problem                            | Fix                                                                                                                                                                              |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| UI shows **Unauthorized**          | Key must match `.env` exactly; clear site data / use private window; run `grep HTB_API_KEY /opt/homelab-tunnel-buddy/.env`. After key change: `systemctl restart homelab-tunnel-buddy`. |
| Works with `curl` but not browser  | Hard-refresh (Ctrl+F5); use `http://` not `https://`; re-enter **HTB_API_KEY**; see [TROUBLESHOOTING.md](TROUBLESHOOTING.md#homelab-tunnel-buddy-ui) |
| `homelab-tunnel-buddy` failed immediately  | `journalctl -u homelab-tunnel-buddy -n 40`; often missing Node `npm install` or bad `.env` path |
| `203/EXEC`                         | Install Node 20+; unit uses `/usr/bin/env node`                                                                                                                                  |
| UI loads but API 401               | Wrong API key; check `.env` and re-enter in browser                                                                                                                              |
| Credentials file red in UI         | Fix path in `config.yml` or copy JSON to that path                                                                                                                               |
| Ingress saved but site not updated | `systemctl restart cloudflared` or use **Restart tunnel** in UI                                                                                                                  |
| Two tunnels fighting               | `systemd` only; `cloudflared tunnel cleanup <name>` ([TROUBLESHOOTING.md](TROUBLESHOOTING.md))                                                                                   |
| Log view empty                     | Add `--logfile /var/log/cloudflared.log` to `cloudflared.service`; set `CLOUDFLARED_LOG_FILE` in `.env`                                                                          |
| `systemctl` does nothing in LXC    | Use **privileged** LXC or enable **Nesting**; run commands inside the CT, not on Proxmox                                                                                         |
| Browser cannot reach `:3847`       | From another PC: ping LXC IP; inside CT: `ss -tlnp | grep 3847`; check Proxmox/LXC firewall                                                                                      |


More detail: [TROUBLESHOOTING.md](TROUBLESHOOTING.md) | [README.md](README.md).

---

## File reference


| Path                                       | Purpose                                   |
| ------------------------------------------ | ----------------------------------------- |
| `/opt/homelab-tunnel-buddy/`                       | App code (`server/`, `public/`)           |
| `/opt/homelab-tunnel-buddy/.env`                   | Homelab Tunnel Buddy settings                     |
| `/etc/cloudflared/config.yml`              | Tunnel + ingress (edited by UI)           |
| `/root/.cloudflared/*.json`                | Tunnel credentials (secret)               |
| `/var/log/cloudflared.log`                 | Tunnel log file (UI **Tunnel logs** view) |
| `/etc/systemd/system/cloudflared.service`  | Tunnel process                            |
| `/etc/systemd/system/homelab-tunnel-buddy.service` | Homelab Tunnel Buddy UI process                   |


---

## Updating the app later

```bash
cd /opt/homelab-tunnel-buddy
sudo git pull   # or copy new files from your PC (see below)
sudo npm install --omit=dev
sudo systemctl restart homelab-tunnel-buddy
```

From your PC (excludes `node_modules` and `.env`):

```bash
scp -r server public package.json package-lock.json .env.example root@<ubuntu-host>:/opt/homelab-tunnel-buddy/
```

Do **not** overwrite `.env` unless you intend to reset settings.