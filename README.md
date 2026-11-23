# Haipai - Mahjong Mistake Trainer

Personal Riichi Mahjong game analysis tool. Analyzes Tenhou replays via Mortal AI, stores structured mistake data, and provides a web UI for review and annotation.

## Reviewing an iishanten discard

In a decision card’s **Value** row, draws with matching yaku, dora/aka ranges and maximum value share a row. Rows are sorted by the highest achievable han, with yakuman first. Each draw keeps its own unseen count. Hover or focus a `?` to see what can vary.

Click a draw to see the full hand. The widest tenpai wait is selected initially; click another marked discard to compare its winning tiles and ron/tsumo values without assuming riichi. **Value unavailable** means the hand could not be scored.

The lookahead uses the board as it was at the decision. It counts an improving draw once, even if several discards reach tenpai, and accounts for red fives and the hypothetical discard pool when scoring waits. It does not predict future discards or reconstruct Mortal’s EV.

## Optional editor language servers

OMP's mixed-language configuration is in `.omp/lsp.json`. Install the servers
into a user-writable npm prefix whose `bin` directory is on `PATH`:

```bash
npm install --global typescript@5.9.3 typescript-language-server pyright \
  vscode-langservers-extracted yaml-language-server \
  @elm-tooling/elm-language-server bash-language-server \
  dockerfile-language-server-nodejs
rustup component add rust-analyzer rust-src
```

Elm also needs a compatible **0.19.1** compiler. Debian's ARM64
`elm-compiler` package supplies it; the older npm 0.19.1 installer does not
support ARM64. Python navigation uses the existing `.venv`.

The Elm manifest URI in `.omp/lsp.json` targets this checkout at `/opt/haipai`;
update it if relocating the checkout. Explicit discovery avoids scanning other
worktrees. Rust uses one analysis thread, with automatic checks, build scripts,
and proc-macro expansion disabled to avoid background builds on this host.
After changing installations or configuration, run LSP `reload` with `file: "*"`.

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

# Start the app
docker compose up -d
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
