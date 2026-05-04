---
name: leave-message
description: Compose and insert a Haipai mailbox message — a feature announcement broadcast to every user, or a thank-you targeted at a specific user (optionally quoting their feedback). Triggered when the user says things like "leave a message in the mailbox", "send a feature announcement", "thank Ikuto for #7414", or "tell everyone X just shipped".
---

# Leave a mailbox message

The mailbox feature surfaces two kinds of messages in-app: `feature`
announcements (cyan tag) and `thanks` replies (purple tag). Inserts go through
`scripts/leave_message.py` against the same DB the app reads — production runs
inside the Docker container, so prefer `docker exec` for real messages.

## Where the data lives

- Schema: `messages` + `message_reads` in `db/schema.py`
- DAL: `db/messages.py` (the script imports nothing from here; it talks to
  SQLite directly so it can run inside the container without the venv)
- Frontend: `static/js/mailbox.js` renders the body as HTML

## What to ask the user before inserting

1. **Type** — `feature` (announcement) or `thanks` (reply to feedback).
2. **Audience** — broadcast to everyone, or a single username?
   - For `thanks`, almost always a single user. Warn if they ask to broadcast.
   - For `feature`, almost always broadcast.
3. **Feedback / category-report link** (`thanks` only) — what's the source?
   - **Free-form bug report** → `feedback` table → use `--feedback ID` and
     optionally `--quote-feedback` to auto-quote.
   - **Category-correctness report on a mistake** → `category_reports` table
     → use `--report MISTAKE_ID` (with `--to USERNAME` to disambiguate) and
     optionally `--quote-report`. The mistake id is what users see in the
     URL / on screen, so it's the natural lookup key.
   - Neither → just write the body without a quote.
4. **Title and body** — draft these for the user, then show them before
   inserting. Bodies are HTML; use `<p>`, `<ul>/<li>`, `<blockquote>`,
   `<code>`. Don't use `<script>`, inline `style` is rarely needed.

Always run with `--dry-run` first and show the user the rendered preview.
Only run the live insert after they confirm.

## Running the script

```bash
# Dry-run a broadcast feature announcement (production):
docker exec haipai-app-1 python3 /app/scripts/leave_message.py \
    --type feature --broadcast \
    --title "..." --body-file /tmp/msg.html --dry-run

# Live insert (drop --dry-run, add --yes if running non-interactively):
docker exec -i haipai-app-1 python3 /app/scripts/leave_message.py \
    --type feature --broadcast --yes \
    --title "..." --body-stdin <<'EOF'
<p>...body...</p>
EOF

# Targeted thanks with a feedback-row quote:
docker exec -i haipai-app-1 python3 /app/scripts/leave_message.py \
    --type thanks --to Ikuto --feedback 12 --quote-feedback --yes \
    --title "Re: ..." --body-stdin <<'EOF'
<p>Fixed in commit <code>abc1234</code>...</p>
EOF

# Targeted thanks with a category-report quote (lookup by mistake id):
docker exec -i haipai-app-1 python3 /app/scripts/leave_message.py \
    --type thanks --to Ikuto --report 7414 --quote-report --yes \
    --title "Re: #7414 ..." --body-stdin <<'EOF'
<p>Fixed in commit <code>102da0d</code>...</p>
EOF
```

For local testing against `./games.db`, drop the `docker exec` prefix and use
`.venv/bin/python scripts/leave_message.py ...`.

## Body style guide (matches the design)

- Open with one short `<p>` framing the change.
- Use `<ul>` for short bullet lists ("New: ...", "Fixed: ...").
- Inline code with `<code>` (the stylesheet renders these with a dark chip).
- For `thanks`, prefer `--quote-feedback` over hand-writing the blockquote —
  it pulls the user's exact words and adds the right `quote-attr` line.
- Reference the commit short-sha when announcing a fix; the user finds them
  helpful for cross-referencing.
- Sign-off / "Implemented YYYY-MM-DD" lines render well as a dim trailing
  paragraph: `<p style="color:var(--text-dim);font-size:11.5px;margin-top:10px;">Shipped 2026-05-04</p>`

## Sanity checks the script enforces

- Username lookup is case-insensitive but rejects ambiguous matches.
- `--feedback ID` verifies the row exists and (if `--to` is given) belongs
  to that recipient — guards against quoting the wrong user's message.
- `--type` is checked against the schema's `CHECK` constraint.

## Looking up context before drafting

```bash
# Find a user id / canonical username:
docker exec haipai-app-1 sqlite3 /app/data/games.db \
    "SELECT id, username FROM users WHERE username LIKE '%ikuto%' COLLATE NOCASE"

# Pull the original feedback text to quote:
docker exec haipai-app-1 sqlite3 /app/data/games.db \
    "SELECT id, user_id, type, message, created_at FROM feedback WHERE id = 7414"

# See what's already in the mailbox:
docker exec haipai-app-1 sqlite3 /app/data/games.db \
    "SELECT id, type, audience_user_id, title, created_at FROM messages ORDER BY id DESC LIMIT 10"
```

Avoid duplicate broadcasts — check the recent `messages` rows first if the
user might be re-asking for something already sent.
