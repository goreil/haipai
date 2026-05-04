// Mailbox: feature announcements + thank-yous in the toolbar.
// Fetches /api/mailbox on first dropdown open and caches for the session.
// Mark-as-read interactions hit the server and update local state.

var mailbox = {
  initialized: false,
  loaded: false,
  loading: false,
  messages: [],
  filter: "unread", // "unread" | "read"
};

function mailboxInit() {
  if (mailbox.initialized) return;
  mailbox.initialized = true;

  const wrapper = document.getElementById("mailbox");
  const trigger = document.getElementById("mailbox-trigger");
  const tabs = document.querySelectorAll(".mailbox-tab");
  const markAllBtn = document.getElementById("mailbox-mark-all-read");
  if (!wrapper || !trigger) return;

  wrapper.style.display = "";

  trigger.addEventListener("click", (e) => {
    e.stopPropagation();
    const opening = !wrapper.classList.contains("open");
    wrapper.classList.toggle("open");
    if (opening) {
      mailboxEnsureLoaded().then(() => {
        const hasUnread = mailbox.messages.some((m) => m.unread);
        mailboxSetFilter(hasUnread ? "unread" : "read");
      });
    }
  });

  tabs.forEach((t) =>
    t.addEventListener("click", (e) => {
      e.stopPropagation();
      mailboxSetFilter(t.dataset.filter);
    })
  );

  if (markAllBtn) {
    markAllBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      mailboxMarkAllRead();
    });
  }

  document.addEventListener("click", (e) => {
    if (!wrapper.contains(e.target)) wrapper.classList.remove("open");
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") wrapper.classList.remove("open");
  });

  // Eager fetch so the unread badge shows before the first click.
  mailboxEnsureLoaded();
}

async function mailboxEnsureLoaded() {
  if (mailbox.loaded || mailbox.loading) return;
  mailbox.loading = true;
  try {
    const res = await fetch("/api/mailbox");
    if (!res.ok) throw new Error("fetch failed: " + res.status);
    mailbox.messages = await res.json();
    mailbox.loaded = true;
  } catch (err) {
    console.error("mailbox: failed to load", err);
    mailbox.messages = [];
  } finally {
    mailbox.loading = false;
    mailboxRender();
  }
}

function mailboxSetFilter(f) {
  mailbox.filter = f;
  document.querySelectorAll(".mailbox-tab").forEach((t) =>
    t.classList.toggle("active", t.dataset.filter === f)
  );
  mailboxRender();
}

function mailboxRender() {
  const list = document.getElementById("mailbox-list");
  if (!list) return;

  if (mailbox.loading && !mailbox.loaded) {
    list.innerHTML = '<div class="mailbox-empty">Loading…</div>';
    return;
  }

  const filtered = mailbox.messages.filter((m) =>
    mailbox.filter === "unread" ? m.unread : !m.unread
  );

  if (filtered.length === 0) {
    list.innerHTML = mailboxEmptyState(mailbox.filter);
  } else {
    list.innerHTML = "";
    for (const m of filtered) {
      const el = document.createElement("div");
      el.className = "msg " + (m.unread ? "unread" : "read");
      el.dataset.id = m.id;
      el.innerHTML = `
        <div class="msg-row">
          ${mailboxTagFor(m.type)}
          <span class="msg-date">${mailboxFormatDate(m.created_at)}</span>
        </div>
        <div class="msg-title">${mailboxEscape(m.title)}</div>
        <div class="msg-body">${m.body}</div>
      `;
      el.addEventListener("click", () => mailboxMarkRead(m.id));
      list.appendChild(el);
    }
  }
  mailboxUpdateBadge();
  mailboxUpdateCounts();
}

function mailboxTagFor(type) {
  if (type === "feature")
    return '<span class="msg-meta-tag tag-feature">New feature</span>';
  if (type === "thanks")
    return '<span class="msg-meta-tag tag-thanks">Thanks for the report</span>';
  return "";
}

function mailboxEmptyState(filter) {
  if (filter === "unread") {
    return `<div class="mailbox-empty">
      <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
      <div>You're all caught up.</div>
    </div>`;
  }
  return `<div class="mailbox-empty">No messages here yet.</div>`;
}

function mailboxFormatDate(iso) {
  if (!iso) return "";
  // SQLite CURRENT_TIMESTAMP yields "YYYY-MM-DD HH:MM:SS" in UTC.
  const d = new Date(iso.replace(" ", "T") + "Z");
  if (isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function mailboxEscape(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

function mailboxUpdateBadge() {
  const badge = document.getElementById("mailbox-badge");
  const trigger = document.getElementById("mailbox-trigger");
  const markAllBtn = document.getElementById("mailbox-mark-all-read");
  const unread = mailbox.messages.filter((m) => m.unread).length;
  if (unread > 0) {
    badge.textContent = unread > 99 ? "99+" : unread;
    badge.style.display = "";
    trigger.classList.add("has-unread");
    if (markAllBtn) markAllBtn.disabled = false;
  } else {
    badge.style.display = "none";
    trigger.classList.remove("has-unread");
    if (markAllBtn) markAllBtn.disabled = true;
  }
}

function mailboxUpdateCounts() {
  const u = mailbox.messages.filter((m) => m.unread).length;
  const r = mailbox.messages.length - u;
  const cu = document.getElementById("mailbox-count-unread");
  const cr = document.getElementById("mailbox-count-read");
  if (cu) cu.textContent = u;
  if (cr) cr.textContent = r;
}

async function mailboxMarkRead(id) {
  const m = mailbox.messages.find((x) => String(x.id) === String(id));
  if (!m || !m.unread) return;
  m.unread = false;
  mailboxRender();
  try {
    const res = await apiPost(`/api/mailbox/${encodeURIComponent(id)}/read`, {});
    if (!res.ok) throw new Error("mark-read failed: " + res.status);
  } catch (err) {
    console.error("mailbox: mark-read failed", err);
    m.unread = true;
    mailboxRender();
  }
}

async function mailboxMarkAllRead() {
  const stillUnread = mailbox.messages.filter((m) => m.unread);
  if (stillUnread.length === 0) return;
  for (const m of stillUnread) m.unread = false;
  mailboxRender();
  try {
    const res = await apiPost("/api/mailbox/read-all", {});
    if (!res.ok) throw new Error("mark-all-read failed: " + res.status);
  } catch (err) {
    console.error("mailbox: mark-all-read failed", err);
    for (const m of stillUnread) m.unread = true;
    mailboxRender();
  }
}
