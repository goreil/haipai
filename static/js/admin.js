// Admin dashboard: feedback list + category-reports list + user list with
// View-as impersonation. Impersonate banner rendering also lives here.

var adminState = { items: [], users: [], reports: [], filterStatus: "", filterType: "", reportKind: "" };

async function showAdmin() {
  state.currentGame = null;
  state.currentGameData = null;
  renderGameList();
  const content = document.getElementById("content");
  content.innerHTML = '<div class="empty-state">Loading...</div>';

  const params = new URLSearchParams();
  if (adminState.filterStatus) params.set("status", adminState.filterStatus);
  if (adminState.filterType) params.set("type", adminState.filterType);

  const [fbRes, statsRes, reportsRes] = await Promise.all([
    fetch(`/api/admin/feedback?${params}`),
    fetch("/api/admin/stats"),
    fetch("/api/admin/category-reports"),
  ]);
  if (fbRes.status === 403) {
    content.innerHTML = '<div class="empty-state">Admin access required</div>';
    return;
  }
  adminState.items = await fbRes.json();
  const stats = await statsRes.json();
  adminState.users = stats.users || [];
  adminState.reports = reportsRes.ok ? await reportsRes.json() : [];
  renderAdmin();
}

function renderAdmin() {
  const content = document.getElementById("content");
  const items = adminState.items;

  const statusColors = { "new": "#4fc3f7", "in-progress": "#ffa94d", "resolved": "#66bb6a" };
  const typeColors = { "bug": "#ef5350", "feature": "#a855f7", "general": "#888" };

  const users = adminState.users;
  const totalGames = users.reduce((s, u) => s + u.game_count, 0);

  let html = `<div class="game-header"><h2>Admin Dashboard</h2></div>`;

  // User stats (with View-as button for impersonation)
  const selfId = (window._meData && window._meData.id) || null;
  const impersonating = !!(window._meData && window._meData.impersonating);
  html += `<div class="admin-card" style="margin-bottom:16px">
    <div class="admin-card-header"><b>${users.length} users</b> <span class="admin-meta">&middot; ${totalGames} games total</span></div>
    <table class="admin-users-table">
      <tr><th>User</th><th>Games</th><th>Joined</th><th></th></tr>
      ${users.map(u => {
        const joined = new Date(u.created_at + "Z").toLocaleDateString();
        const canActOn = !impersonating && u.id !== selfId;
        const viewBtn = canActOn
          ? `<button class="btn btn-sm" onclick="adminImpersonate(${u.id})">View as</button>`
          : "";
        const deleteBtn = canActOn
          ? `<button class="btn btn-sm btn-delete" onclick="adminDeleteUser(${u.id})">Delete</button>`
          : "";
        return `<tr><td>${escapeHtml(u.username)}</td><td>${u.game_count}</td><td>${joined}</td><td>${viewBtn} ${deleteBtn}</td></tr>`;
      }).join("")}
    </table>
  </div>`;

  // Category reports
  const reports = adminState.reports || [];
  const reportKind = adminState.reportKind;
  const filteredReports = reportKind ? reports.filter(r => r.kind === reportKind) : reports;
  const counts = reports.reduce((a, r) => { a[r.kind] = (a[r.kind] || 0) + 1; return a; }, {});
  html += `<div class="game-header" style="margin-top:8px"><h2>Category reports (${reports.length})</h2></div>`;
  html += `<div class="admin-filters">
    <select onchange="adminState.reportKind=this.value;renderAdmin()">
      <option value="">All kinds (${reports.length})</option>
      <option value="wrong_category" ${reportKind==="wrong_category"?"selected":""}>wrong_category (${counts.wrong_category||0})</option>
      <option value="wrong_text" ${reportKind==="wrong_text"?"selected":""}>wrong_text (${counts.wrong_text||0})</option>
      <option value="agree" ${reportKind==="agree"?"selected":""}>agree (${counts.agree||0})</option>
    </select>
  </div>`;
  if (!filteredReports.length) {
    html += '<div class="empty-state">No reports</div>';
  } else {
    for (const r of filteredReports) {
      const kindClass = r.kind;
      const date = new Date(r.created_at + "Z").toLocaleString();
      const suggested = r.suggested_category
        ? ` &rarr; <b>${escapeHtml(r.suggested_category)}</b>`
        : "";
      const openBtn = impersonating
        ? ""
        : `<button class="btn btn-sm" onclick="adminOpenAsUser(${r.user_id}, ${r.game_id}, ${r.mistake_id})">Open</button>`;
      html += `<div class="admin-report-card">
        <span class="admin-report-kind ${kindClass}">${r.kind}</span>
        <span class="admin-meta">${escapeHtml(r.username)} &middot; ${date}</span>
        <span>mistake <b>#${r.mistake_id}</b> <code>${escapeHtml(r.category || "?")}</code>${suggested}</span>
        <span class="admin-meta">game ${r.game_id} &middot; turn ${r.turn}</span>
        ${openBtn}
        ${r.reason ? `<div class="admin-report-reason">${escapeHtml(r.reason)}</div>` : ""}
      </div>`;
    }
  }

  html += `<div class="game-header" style="margin-top:8px"><h2>Feedback (${items.length})</h2></div>`;

  html += `<div class="admin-filters">
    <select onchange="adminState.filterStatus=this.value;showAdmin()">
      <option value="">All statuses</option>
      <option value="new" ${adminState.filterStatus==="new"?"selected":""}>New</option>
      <option value="in-progress" ${adminState.filterStatus==="in-progress"?"selected":""}>In Progress</option>
      <option value="resolved" ${adminState.filterStatus==="resolved"?"selected":""}>Resolved</option>
    </select>
    <select onchange="adminState.filterType=this.value;showAdmin()">
      <option value="">All types</option>
      <option value="bug" ${adminState.filterType==="bug"?"selected":""}>Bug</option>
      <option value="feature" ${adminState.filterType==="feature"?"selected":""}>Feature</option>
      <option value="general" ${adminState.filterType==="general"?"selected":""}>General</option>
    </select>
  </div>`;

  if (!items.length) {
    html += '<div class="empty-state">No feedback items</div>';
    content.innerHTML = html;
    return;
  }

  for (const item of items) {
    const sc = statusColors[item.status] || "#888";
    const tc = typeColors[item.type] || "#888";
    const date = new Date(item.created_at + "Z").toLocaleString();

    html += `<div class="admin-card" id="fb-${item.id}">
      <div class="admin-card-header">
        <span class="admin-badge" style="background:${tc}20;color:${tc}">${item.type}</span>
        <span class="admin-badge" style="background:${sc}20;color:${sc}">${item.status}</span>
        <span class="admin-meta">${item.username} &middot; ${date}</span>
        ${item.github_issue_url ? `<a href="${escapeHtml(item.github_issue_url)}" target="_blank" class="admin-gh-link">GitHub</a>` : ""}
      </div>
      <div class="admin-card-body">${escapeHtml(item.message)}</div>
      ${item.admin_note ? `<div class="admin-note-display"><b>Note:</b> ${escapeHtml(item.admin_note)}</div>` : ""}
      <div class="admin-card-actions">
        ${item.status !== "resolved" ? `<button class="btn btn-sm" onclick="adminResolve(${item.id})">Resolve</button>` : ""}
        ${item.status === "resolved" ? `<button class="btn btn-sm" onclick="adminReopen(${item.id})">Reopen</button>` : ""}
        <button class="btn btn-sm" onclick="adminToggleNote(${item.id})">Note</button>
        ${!item.github_issue_url ? `<button class="btn btn-sm" onclick="adminCreateIssue(${item.id})">Create Issue</button>` : ""}
      </div>
      <div class="admin-note-form" id="fb-note-${item.id}" style="display:none">
        <textarea rows="2" placeholder="Admin note..." id="fb-note-text-${item.id}">${escapeHtml(item.admin_note || "")}</textarea>
        <button class="btn btn-sm btn-primary" onclick="adminSaveNote(${item.id})">Save Note</button>
      </div>
    </div>`;
  }

  content.innerHTML = html;
}

async function adminResolve(id) {
  await apiPost(`/api/admin/feedback/${id}`, { status: "resolved" });
  showAdmin();
}

async function adminReopen(id) {
  await apiPost(`/api/admin/feedback/${id}`, { status: "new" });
  showAdmin();
}

function adminToggleNote(id) {
  const el = document.getElementById(`fb-note-${id}`);
  el.style.display = el.style.display === "none" ? "block" : "none";
}

async function adminSaveNote(id) {
  const note = document.getElementById(`fb-note-text-${id}`).value.trim();
  await apiPost(`/api/admin/feedback/${id}`, { admin_note: note });
  showAdmin();
}

async function adminCreateIssue(id) {
  const btn = event.target;
  btn.disabled = true;
  btn.textContent = "Creating...";
  const res = await apiPost(`/api/admin/feedback/${id}/create-issue`, {});
  const data = await res.json();
  if (data.ok) {
    showAdmin();
  } else {
    btn.disabled = false;
    btn.textContent = "Create Issue";
    alert(data.error || "Failed to create issue");
  }
}

async function adminImpersonate(userId) {
  const res = await apiPost(`/api/admin/impersonate/${userId}`, {});
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    alert(data.error || "Failed to start impersonation");
    return;
  }
  // Full reload — resets in-memory state and picks up the new session user.
  window.location.href = "/";
}

async function adminOpenAsUser(userId, gameId, mistakeId) {
  const res = await apiPost(`/api/admin/impersonate/${userId}`, {});
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    alert(data.error || "Failed to start impersonation");
    return;
  }
  // No deep-link support yet — land on home; the sidebar lists the user's
  // games so the admin can click through to game ${gameId}, mistake #${mistakeId}.
  window.location.href = "/";
}

async function adminDeleteUser(userId) {
  const user = (adminState.users || []).find(u => u.id === userId);
  if (!user) {
    alert("User not found in current admin view — refresh and retry.");
    return;
  }
  const username = user.username;
  const typed = window.prompt(
    `GDPR-delete user "${username}"?\n\n` +
    `This permanently removes the account, all games, mistakes, practice ` +
    `history, feedback, and category reports.\n\n` +
    `Type the username to confirm:`
  );
  if (typed === null) return;
  if (typed !== username) {
    alert("Username did not match — nothing was deleted.");
    return;
  }
  const res = await apiDelete(`/api/admin/users/${userId}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    alert(data.error || "Failed to delete user");
    return;
  }
  const d = data.deleted || {};
  alert(
    `Deleted "${data.username}":\n` +
    `  ${d.games || 0} games, ${d.mistakes || 0} mistakes\n` +
    `  ${d.practice_results || 0} practice results\n` +
    `  ${d.feedback || 0} feedback items\n` +
    `  ${d.category_reports || 0} category reports\n` +
    `  ${d.invite_codes || 0} invite codes`
  );
  showAdmin();
}

async function adminStopImpersonate() {
  const res = await apiPost("/api/admin/impersonate/stop", {});
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    alert(data.error || "Failed to stop impersonation");
    return;
  }
  window.location.href = "/";
}

function renderImpersonateBanner(me) {
  const banner = document.getElementById("impersonate-banner");
  const stopMenuBtn = document.getElementById("stop-impersonating-btn");
  const active = !!(me && me.impersonating);
  if (banner) {
    if (active) {
      banner.style.display = "";
      banner.innerHTML = `
        <span>Viewing as <b>${escapeHtml(me.impersonating.viewing_as)}</b>
        (admin: ${escapeHtml(me.impersonating.admin_username)})</span>
        <button class="btn btn-sm" onclick="adminStopImpersonate()">Stop</button>
      `;
    } else {
      banner.style.display = "none";
      banner.innerHTML = "";
    }
  }
  if (stopMenuBtn) stopMenuBtn.style.display = active ? "" : "none";
}
