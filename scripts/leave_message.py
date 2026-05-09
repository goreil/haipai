#!/usr/bin/env python3
"""Insert a mailbox message (feature announcement or thank-you).

Designed to run from the repo root or via ``docker exec`` inside the prod
container. Picks the same DB the running app uses (DB_PATH > /app/data/games.db
> ./games.db).

Examples
--------
    # Broadcast a feature announcement to everyone:
    .venv/bin/python scripts/leave_message.py \\
        --type feature --broadcast \\
        --title "Mailbox is here" --body-file /tmp/mailbox.html

    # Thanks targeted at a single user, quoting their category report:
    docker exec -i haipai-app-1 python3 /app/scripts/leave_message.py \\
        --type thanks --to Ikuto --report 7414 --quote-report \\
        --title "Re: yakuhai discard categorization" \\
        --body-stdin <<'EOF'
    <p>Fixed in commit <code>102da0d</code> — the categorizer no longer
    flags discarding a yakuhai pair when Mortal had already done so.</p>
    EOF

    # Preview without inserting:
    .venv/bin/python scripts/leave_message.py --type feature --broadcast \\
        --title "Test" --body "<p>hi</p>" --dry-run
"""

import argparse
import os
import sqlite3
import sys


def pick_db():
    if os.environ.get("DB_PATH"):
        return os.environ["DB_PATH"]
    for p in ("/app/data/games.db", "games.db"):
        if os.path.exists(p):
            return os.path.abspath(p)
    sys.exit("error: no DB found — set DB_PATH or run from repo root")


def resolve_user(conn, username):
    row = conn.execute(
        "SELECT id, username FROM users WHERE username = ?",
        (username,),
    ).fetchone()
    if row:
        return row["id"], row["username"]
    # Case-insensitive fallback so 'ikuto' finds 'Ikuto'.
    matches = conn.execute(
        "SELECT id, username FROM users WHERE LOWER(username) = LOWER(?)",
        (username,),
    ).fetchall()
    if len(matches) == 1:
        return matches[0]["id"], matches[0]["username"]
    if len(matches) > 1:
        names = ", ".join(m["username"] for m in matches)
        sys.exit(f"error: ambiguous username {username!r} — matches: {names}")
    sys.exit(f"error: user {username!r} not found")


def resolve_category_report(conn, mistake_id, user_id):
    """Look up the (mistake_id, user_id) row in category_reports.

    Returns the row joined with the mistake so the body can reference
    the mistake's category / severity / ev_loss if useful.
    """
    row = conn.execute(
        """SELECT cr.id AS report_id, cr.mistake_id, cr.user_id, cr.kind,
                  cr.suggested_category, cr.reason, cr.created_at,
                  m.category, m.severity, m.ev_loss, m.game_id
             FROM category_reports cr
             JOIN mistakes m ON cr.mistake_id = m.id
            WHERE cr.mistake_id = ? AND cr.user_id = ?""",
        (mistake_id, user_id),
    ).fetchone()
    if not row:
        sys.exit(
            f"error: no category report from user {user_id} on mistake {mistake_id}"
        )
    return dict(row)


def read_body(args):
    sources = [bool(args.body), bool(args.body_file), bool(args.body_stdin)]
    if sum(sources) != 1:
        sys.exit("error: exactly one of --body / --body-file / --body-stdin required")
    if args.body:
        return args.body
    if args.body_file:
        with open(args.body_file, "r", encoding="utf-8") as f:
            return f.read()
    return sys.stdin.read()


def quote_report_block(report_row):
    """Render a category_reports row as a blockquote.

    Falls back to a short label noting the report kind and the
    mistake's category when the user didn't supply a reason.
    """
    import html as _html
    raw = (report_row.get("reason") or "").strip()
    if not raw:
        kind = report_row["kind"]
        cat = report_row.get("category") or "?"
        raw = f"({kind} report on a {cat} mistake — no comment)"
    text = _html.escape(raw).replace("\n", "<br>")
    when = (report_row.get("created_at") or "")[:10]
    mistake_id = report_row["mistake_id"]
    attr = f"— your report on mistake #{mistake_id}{', ' + when if when else ''}"
    return (
        '<blockquote>'
        f'{text}'
        f'<span class="quote-attr">{_html.escape(attr)}</span>'
        '</blockquote>\n'
    )


def confirm(prompt):
    if not sys.stdin.isatty():
        return True
    ans = input(f"{prompt} [y/N] ").strip().lower()
    return ans in ("y", "yes")


def main():
    ap = argparse.ArgumentParser(
        description="Insert a mailbox message.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    ap.add_argument("--type", choices=("feature", "thanks"), required=True)
    ap.add_argument("--title", required=True)

    body_grp = ap.add_argument_group("body (one required)")
    body_grp.add_argument("--body", help="message body as HTML string")
    body_grp.add_argument("--body-file", help="path to a file containing the HTML body")
    body_grp.add_argument("--body-stdin", action="store_true",
                          help="read the HTML body from stdin")

    aud = ap.add_mutually_exclusive_group(required=True)
    aud.add_argument("--to", metavar="USERNAME",
                     help="recipient username (case-insensitive fallback)")
    aud.add_argument("--broadcast", action="store_true",
                     help="visible to every user")

    ap.add_argument("--report", type=int, metavar="MISTAKE_ID",
                    help="reference the recipient's category_reports row for "
                         "this mistake (requires --to)")
    ap.add_argument("--quote-report", action="store_true",
                    help="prepend a blockquote of the category report's reason "
                         "to the body (requires --report)")
    ap.add_argument("--dry-run", action="store_true",
                    help="show what would be inserted, don't write")
    ap.add_argument("--yes", "-y", action="store_true",
                    help="skip confirmation prompt")

    args = ap.parse_args()

    if args.report and not args.to:
        ap.error("--report requires --to (looks up the recipient's report)")
    if args.quote_report and not args.report:
        ap.error("--quote-report requires --report")
    if args.type == "thanks" and args.broadcast:
        print("warning: broadcasting a 'thanks' to every user is unusual.",
              file=sys.stderr)

    body = read_body(args).strip()
    if not body:
        sys.exit("error: body is empty")
    if not args.title.strip():
        sys.exit("error: title is empty")

    db_path = pick_db()
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys=ON")

    audience_id = None
    audience_label = "BROADCAST (all users)"
    if args.to:
        audience_id, canonical = resolve_user(conn, args.to)
        audience_label = f"{canonical} (id {audience_id})"

    report_row = None
    if args.report:
        report_row = resolve_category_report(conn, args.report, audience_id)
        if args.quote_report:
            body = quote_report_block(report_row) + body

    print(f"db:       {db_path}")
    print(f"type:     {args.type}")
    print(f"audience: {audience_label}")
    print(f"title:    {args.title}")
    if report_row:
        snippet = (report_row.get("reason") or "(no reason)")[:80].replace("\n", " ")
        print(f"report:   row #{report_row['report_id']} on mistake "
              f"#{report_row['mistake_id']} ({report_row['kind']}, "
              f"category {report_row.get('category')}): {snippet!r}")
    print(f"body:     {len(body)} chars")
    print("---")
    print(body[:600] + ("…" if len(body) > 600 else ""))
    print("---")

    if args.dry_run:
        print("dry-run: nothing inserted.")
        return

    if not args.yes and not confirm("insert this message?"):
        print("aborted.")
        return

    cur = conn.execute(
        """INSERT INTO messages (type, title, body, audience_user_id)
           VALUES (?, ?, ?, ?)""",
        (args.type, args.title, body, audience_id),
    )
    conn.commit()
    print(f"inserted message id {cur.lastrowid}")


if __name__ == "__main__":
    main()
