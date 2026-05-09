# Haipai Deployment Guide

This documents the full deployment pipeline for haipai.ylue.de.

## Architecture

```
GitHub (push to main)
  -> GitHub Actions (test + deploy)
    -> SSH into Hetzner VPS
      -> git pull + docker-compose restart
```

- **Server**: Hetzner CX22 (2 vCPU, 4 GB RAM), Debian 12
- **Stack**: Docker Compose (Flask/gunicorn + nginx + certbot)
- **Domain**: haipai.ylue.de (A record -> server IP)
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
# Edit nginx.conf: replace YOUR_DOMAIN with haipai.ylue.de

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
  --webroot --webroot-path=/var/lib/letsencrypt -d haipai.ylue.de

# Then uncomment the HTTPS block in nginx.conf and restart:
docker-compose restart nginx
```

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

# Run backfill after code updates
# (logged in via browser console)
fetch('/api/games/backfill-decisions', {method:'POST'}).then(r=>r.json()).then(console.log)
```
