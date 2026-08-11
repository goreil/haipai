#!/usr/bin/env python3
"""Send a plaintext email via SMTP from the command line.

Standalone on purpose: stdlib only, no imports from the haipai package, so it
can be copied to any host with python3 and used to test SMTP credentials or
send one-off mail.

Credentials come from the environment (MAILBOX_USERNAME / MAILBOX_PASSWORD) or
from --user / --password. The visible From: defaults to MAIL_FROM, then to the
authenticating user.

  scripts/send_mail.py --to you@example.com --subject Hi --body "short test"
  echo "body from stdin" | scripts/send_mail.py --to you@example.com -s Hi
"""

import argparse
import os
import smtplib
import sys
from email.message import EmailMessage


def main():
    p = argparse.ArgumentParser(description="Send a plaintext email via SMTP.")
    p.add_argument("--to", required=True, action="append",
                   help="recipient; repeat for multiple")
    p.add_argument("-s", "--subject", required=True)
    p.add_argument("-b", "--body", help="message body (default: read stdin)")
    p.add_argument("--from", dest="from_addr", default=os.environ.get("MAIL_FROM"),
                   help="visible From: (default: $MAIL_FROM, else the auth user)")
    p.add_argument("--user", default=os.environ.get("MAILBOX_USERNAME"),
                   help="SMTP username (default: $MAILBOX_USERNAME)")
    p.add_argument("--password", default=os.environ.get("MAILBOX_PASSWORD"),
                   help="SMTP password (default: $MAILBOX_PASSWORD)")
    p.add_argument("--server", default=os.environ.get("SMTP_SERVER", "smtp.mailbox.org"))
    p.add_argument("--port", type=int, default=int(os.environ.get("SMTP_PORT", 587)))
    p.add_argument("--ssl", action="store_true",
                   help="connect with implicit TLS (port 465) instead of STARTTLS")
    args = p.parse_args()

    if not args.user or not args.password:
        p.error("no credentials: set MAILBOX_USERNAME/MAILBOX_PASSWORD or pass --user/--password")

    body = args.body
    if body is None:
        if sys.stdin.isatty():
            p.error("no body: pass --body or pipe one on stdin")
        body = sys.stdin.read()

    msg = EmailMessage()
    msg["Subject"] = args.subject
    msg["From"] = args.from_addr or args.user
    msg["To"] = ", ".join(args.to)
    msg.set_content(body)

    try:
        if args.ssl:
            smtp = smtplib.SMTP_SSL(args.server, args.port, timeout=20)
        else:
            smtp = smtplib.SMTP(args.server, args.port, timeout=20)
        with smtp:
            if not args.ssl:
                smtp.starttls()
            smtp.login(args.user, args.password)
            smtp.send_message(msg)
    except Exception as e:
        print(f"send failed: {e}", file=sys.stderr)
        return 1

    print(f"sent to {msg['To']} (from {msg['From']})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
