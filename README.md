# Haipai - Mahjong Mistake Trainer

Personal Riichi Mahjong game analysis tool. Analyzes Tenhou replays via Mortal AI, stores structured mistake data, and provides a web UI for review and annotation.

## Reviewing an iishanten discard

On a discard card, **Tile acceptance** compares the shared draws and each discard’s extra tiles. **Value** groups improving draws by yaku, total dora (including red fives), and maximum value. Yakuhai counts include both han for a double wind. Rows are sorted by the highest achievable han, with yakuman first. Each draw keeps its own unseen count. Hover or focus a `?` to see what can vary.

Click a draw, then any marked discard to inspect its waits and ron/tsumo scores. **Speed** marks the widest wait by unseen copies. **Value** marks the highest achievable points; equal peaks are broken by average points across legal ron and tsumo outcomes, weighted by unseen copies of each winning tile. **Best** replaces both labels when a discard leads on both measures. Other tenpai discards are marked **Cut**. The draw’s summary uses the widest wait, breaking ties by the same value ranking; inspecting another cut does not change it. **Value unavailable** means the selection or score could not be determined.

Scores include ordinary riichi when the hand is closed (concealed kans are allowed), the player has at least 1,000 points, and at least four live-wall tiles would remain after the next uninterrupted draw. They do not assume ippatsu or ura-dora.

The lookahead uses the board as it was at the decision. It counts an improving draw once, even if several discards reach tenpai, and accounts for red fives and the hypothetical discard pool when scoring waits. It does not predict future discards or reconstruct Mortal’s EV.

For both tenpai and 1-shanten, **Summary** shows mean points, peak points, and each yaku’s share of the scored outcomes. At tenpai, each legal ron and tsumo counts once per unseen winning copy. At 1-shanten, each improving draw contributes its selected discard’s result, weighted by unseen draw copies. A draw with no legal win contributes zero; missing data is not scored as zero. These shares describe the displayed routes, not the probability of winning the hand.

When both picks can be scored, **wait value** determines the scored **Value** advantage. Sum each unseen winning copy’s average legal payout; at 1-shanten, average these sums over improving draws, weighted by their unseen copies. One copy paying 10,000 has wait value 10,000; twelve copies paying 8,000 have wait value 96,000. This index is not a payout or a probability. The headline and trainer use it instead of guessing yaku from tile patterns. In [#m42402](https://haipai-trainer.com/#m42402), the cuts tie on peak points, but discarding 7p keeps more outcomes with iipeikou than discarding 3s.

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
