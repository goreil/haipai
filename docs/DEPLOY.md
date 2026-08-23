# Haipai Deployment Guide

This documents the full deployment pipeline for haipai-trainer.com.

## Architecture

```
GitHub (push to main)
  -> GitHub Actions (test + deploy)
    -> SSH into Hetzner VPS
      -> git pull + docker-compose restart
```

- **Server**: Hetzner CX22 (2 vCPU, 4 GB RAM), Debian 12
- **Stack**: Flask/gunicorn in Docker Compose, behind **host** nginx +
  host certbot (nginx is not a compose service; it proxies to the published
  127.0.0.1:5000)
- **Domain**: haipai-trainer.com (A + AAAA -> server IP). The old
  haipai.ylue.de still resolves here — see "Domain migration" below.
- **HTTPS**: Let's Encrypt via certbot container
- **Database**: SQLite in Docker volume (`app-data`)

## How Deploys Work

The docker-compose uses **bind mounts** for Python files and static assets, plus gunicorn `--reload`. This means:

- **Python/static changes**: `git pull` is enough. Gunicorn auto-reloads Python files; static files are served directly from the bind mount.
- **Dockerfile/requirements changes**: Need `docker-compose up -d --build` to rebuild the image.
- **Database migrations**: Must be run manually if schema changes.

The GitHub Actions deploy workflow (`.github/workflows/deploy.yml`) handles this automatically:
1. Runs tests
2. SSHes into the server
3. Runs `git pull`
4. If Dockerfile/requirements changed, rebuilds; otherwise restarts app

## Setting Up Auto-Deploy

### 1. Generate a deploy SSH key

On your local machine:
```bash
ssh-keygen -t ed25519 -f ~/.ssh/haipai_deploy -N ""
```

### 2. Add the public key to the server

```bash
ssh root@YOUR_SERVER_IP
cat >> ~/.ssh/authorized_keys << 'EOF'
<paste contents of ~/.ssh/haipai_deploy.pub>
EOF
```

### 3. Add GitHub repository secrets

Go to your GitHub repo -> Settings -> Secrets and variables -> Actions, and add:

| Secret | Value |
|--------|-------|
| `DEPLOY_HOST` | Your server IP (e.g., `65.21.xxx.xxx`) |
| `DEPLOY_USER` | `root` (or a deploy user) |
| `DEPLOY_SSH_KEY` | Contents of `~/.ssh/haipai_deploy` (the **private** key) |

### 4. Verify

Push a commit to main. The Actions tab should show:
1. **test** job: runs pytest
2. **deploy** job: SSHes and updates the server

## Manual Deploy (Fallback)

If auto-deploy isn't set up yet, or you need to deploy manually:

```bash
ssh root@YOUR_SERVER_IP
cd /opt/haipai
git pull origin main

# If only code changed:
docker-compose restart app

# If Dockerfile or requirements changed:
docker-compose up -d --build
```

## First-Time Server Setup

See `archive/ylue-manual-labor.txt` for the full first-time setup guide, or follow these steps:

```bash
# 1. Install Docker
ssh root@YOUR_SERVER_IP
apt update && apt upgrade -y
apt install -y docker.io docker-compose git
systemctl enable docker

# 2. Clone repo
cd /opt
git clone https://github.com/YOUR_USER/haipai-mahjong.git haipai
cd haipai

# 3. Configure
cp nginx.conf.template nginx.conf
# Edit nginx.conf: replace YOUR_DOMAIN with haipai-trainer.com

# 4. Set secret key
echo "SECRET_KEY=$(python3 -c 'import secrets; print(secrets.token_hex(32))')" > .env

# 5. Build and start
docker-compose up -d --build

# 6. Create your account
docker-compose exec app python3 -c "
import db
conn = db.get_db()
db.init_db(conn)
from werkzeug.security import generate_password_hash
db.create_user(conn, 'ylue', generate_password_hash('YOUR_PASSWORD'))
conn.close()
"

# 7. HTTPS (after DNS is set up)
docker-compose run --rm --entrypoint "certbot" certbot certonly \
  --webroot --webroot-path=/var/lib/letsencrypt -d haipai-trainer.com

# Then uncomment the HTTPS block in nginx.conf and restart:
docker-compose restart nginx
```

## Domain migration (2026-08)

`haipai-trainer.com` is canonical. `haipai.ylue.de` is being phased out but is
**not** switched off: its vhost still terminates TLS, still proxies `/api/*`,
and 301s every browser-facing route to the new domain, path and query intact.

Why `/api/*` stays: old bookmarklets (built against `window.location.origin` at
the time the user saved them) and browser-extension installs that have not been
updated still POST there. Most clients turn a 301 on a POST into a GET, which
would silently drop the upload body — so that prefix must keep answering 200
until those clients are gone.

Live config is the host's `/etc/nginx/sites-available/haipai.conf`. The staging
copy is `/opt/haipai/nginx.conf`, which is **gitignored** (per-server paths —
see `nginx.conf.template`), so it does not arrive with a `git pull`: edit it in
place on the server and diff before installing.

Standing up the new domain (run as root on the server):

```bash
# 1. Cert (webroot — the port-80 catch-all already serves the ACME challenge)
certbot certonly --webroot --webroot-path=/var/lib/letsencrypt \
  -d haipai-trainer.com -d www.haipai-trainer.com

# 2. Install the vhost (nginx.conf is server-local, not in git)
cd /opt/haipai
diff -u /etc/nginx/sites-available/haipai.conf nginx.conf   # review first
cp /etc/nginx/sites-available/haipai.conf{,.bak-$(date +%F)}
cp nginx.conf /etc/nginx/sites-available/haipai.conf
nginx -t && systemctl reload nginx

# 3. Verify
curl -sI https://haipai-trainer.com/ | head -1                       # 200
curl -sI https://www.haipai-trainer.com/ | grep -i location           # -> apex
curl -sI https://haipai.ylue.de/ | head -1                            # 301
curl -sI https://haipai.ylue.de/ | grep -i location                   # -> new
curl -s -o /dev/null -w '%{http_code}\n' -X POST \
  -H 'Content-Type: application/json' -d '{}' \
  https://haipai.ylue.de/api/games/upload                             # 401, not 301
```

Also needs doing outside this repo, or logins break on the new host:

- **Discord OAuth**: add `https://haipai-trainer.com/auth/discord/callback` to
  the app's redirect URIs.
- **Google OAuth**: add `https://haipai-trainer.com/auth/google/callback` to the
  authorized redirect URIs (and the origin to the authorized JavaScript
  origins).

Sessions are per-host cookies, so everyone signs in once on the new domain. The
browser extension ships the new default in v2.2 (`extension/README.md`).

## Backups

```bash
# Backup database
docker cp $(docker-compose ps -q app):/app/data/games.db ./backup-$(date +%Y%m%d).db

# Backup mortal analysis files
docker cp $(docker-compose ps -q app):/app/mortal_analysis ./mortal_backup/
```

## Useful Commands

```bash
# View logs
docker-compose logs -f app
docker-compose logs -f nginx

# Renew HTTPS cert manually
docker-compose run --rm --entrypoint "certbot" certbot renew
docker-compose restart nginx
```
