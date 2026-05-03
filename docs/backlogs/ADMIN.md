# Admin Panel Backlog

Tracks follow-ups for the admin panel (impersonation, reports view, stats).
Primary files: `routes/admin.py`, `static/app.js`, `static/index.html`.

The 2026-04-21 stop-impersonation incident is resolved (logout clears the
stashed key, sticky banner, dropdown stop button, auto-recovery in `/api/me`
and `/api/admin/impersonate/<id>`). Confirmed working in practice 2026-04-21.

## Open

### A-01: Deep-link "Open" button to the mistake (LOW)

The Open button on category-reports impersonates the user and redirects to
`/`; admins then hunt for the game by id. Implement hash-based deeplinks
(`#g=<gameId>&m=<mistakeId>`) and handle them in the game-list/review init
path.

### A-02: Impersonation audit log (LOW)

Persist (admin id, target id, timestamp, duration) for impersonation
sessions. Useful for trust/forensics once more than one admin exists.

### A-03: Misc polish (LOW)

- Admin users table doesn't have search — fine at 15 users, awkward at 100+.
- "Stop impersonating" can wrap on narrow viewports — banner flex layout
  needs a media-query pass.
