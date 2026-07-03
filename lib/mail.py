"""Transactional email via mailbox.org SMTP.

Auth uses MAILBOX_USERNAME/MAILBOX_PASSWORD (a send-only mailbox.org
account); MAIL_FROM lets the visible From: differ from the auth user
(mailbox.org accepts sending as an alias of the authenticated account).
"""

import os
import smtplib
import sys
from email.message import EmailMessage

SMTP_SERVER = "smtp.mailbox.org"
SMTP_PORT = 587


def send_email(to_addr, subject, body):
    """Send a plaintext email. Returns True on success, False (logging) on failure."""
    username = os.environ.get("MAILBOX_USERNAME")
    password = os.environ.get("MAILBOX_PASSWORD")
    if not username or not password:
        print("MAILBOX_USERNAME/MAILBOX_PASSWORD not set; skipping email send", file=sys.stderr)
        return False

    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = os.environ.get("MAIL_FROM", username)
    msg["To"] = to_addr
    msg.set_content(body)

    try:
        with smtplib.SMTP(SMTP_SERVER, SMTP_PORT, timeout=10) as smtp:
            smtp.starttls()
            smtp.login(username, password)
            smtp.send_message(msg)
        return True
    except Exception as e:
        print(f"Failed to send email to {to_addr}: {e}", file=sys.stderr)
        return False


def send_verification_email(to_addr, username, verify_url):
    """Send the registration email-verification link."""
    subject = "Verify your Haipai account"
    body = (
        f"Hi {username},\n\n"
        "Click the link below to verify your email address and activate your Haipai account:\n\n"
        f"{verify_url}\n\n"
        "This link expires in 24 hours. If you didn't create this account, you can ignore this email.\n"
    )
    return send_email(to_addr, subject, body)
