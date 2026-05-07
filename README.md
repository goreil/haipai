# Haipai - Mahjong Mistake Trainer

Personal Riichi Mahjong game analysis tool. Analyzes Tenhou replays via Mortal AI, stores structured mistake data, and provides a web UI for review and annotation.

## Deployment

### Prerequisites

- Docker + Docker Compose
- Domain with DNS pointing to the server (for HTTPS via certbot)

### First-time setup

```bash
git clone <repo-url> && cd haipai-mahjong
git submodule update --init --recursive

# Create nginx config from template, then edit YOUR_DOMAIN
cp nginx.conf.template nginx.conf
# Edit nginx.conf — replace YOUR_DOMAIN with your actual domain

# Build (Python image — fast)
docker compose build

# Generate invite codes for user registration
docker compose up -d
docker compose exec app python3 -c "
import db
conn = db.get_db()
db.init_db(conn)
codes = db.create_invite_codes(conn, 3)
print('Invite codes:', codes)
conn.close()
"
```

### HTTPS with certbot

```bash
# Get initial certificate (server must be running on port 80 first)
docker compose run --rm --entrypoint "certbot" certbot certonly \
  --webroot --webroot-path=/var/lib/letsencrypt -d YOUR_DOMAIN

# Then edit nginx.conf:
# 1. Uncomment the HTTPS redirect in the port 80 block
# 2. Uncomment the port 443 server block
docker compose exec nginx nginx -s reload
```

### Deploying updates

After `git pull`, the type of restart depends on what changed:

| What changed | What to do |
|---|---|
| Python files (`*.py`) | Nothing — gunicorn `--reload` picks up changes automatically via volume mounts |
| Static files (`static/`) | Nothing — served directly via volume mount, just refresh browser |
| `requirements.txt` | `docker compose build && docker compose up -d` |
| `Dockerfile` | `docker compose build && docker compose up -d` |
| `docker-compose.yml` | `docker compose up -d` (recreates containers with new config) |
| `nginx.conf.template` | `cp nginx.conf.template nginx.conf`, edit domain, `docker compose exec nginx nginx -s reload` |

**TL;DR for most code changes:** just `git pull` and it's live.

If the volume mounts aren't set up yet (first deploy or after a fresh `docker compose build`), run:

```bash
docker compose up -d
```

This recreates the containers with the source-mount volumes and `--reload` flag.

### Environment variables

| Variable | Default | Description |
|---|---|---|
| `SECRET_KEY` | `change-me-in-production` | Flask session secret — set to a random string |
| `DB_PATH` | `/app/data/games.db` | SQLite database path (persisted via `app-data` volume) |

### Architecture

```
Browser -> nginx (port 80/443) -> gunicorn (port 5000) -> Flask app
```

- **nginx**: reverse proxy + TLS termination
- **gunicorn**: Python WSGI server with `--reload` for hot code reloading
- **SQLite**: game data stored in Docker volume `app-data`
- Shanten / ukeire computed in-process by `lib/shanten.py` (wraps the `mahjong` PyPI package, MIT)
- Source files are mounted read-only into the container so `git pull` takes effect immediately
