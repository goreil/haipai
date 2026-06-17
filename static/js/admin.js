// Admin dashboard: category-reports list + user list with View-as
// impersonation. Impersonate banner rendering also lives here.

var adminState = { users: [], reports: [], reportKind: "", reportScope: "others", reportsLoading: false,
                   userSort: { col: "game_count", dir: "desc" } };

async function showAdmin() {
  state.currentGame = null;
  state.currentGameData = null;
  renderGameList();
  const content = document.getElementById("content");
  content.innerHTML = '<div class="empty-state">Loading...</div>';

  const [statsRes, reportsRes] = await Promise.all([
    fetch("/api/admin/stats"),
    fetch(`/api/admin/category-reports?scope=${encodeURIComponent(adminState.reportScope)}`),
  ]);
  if (statsRes.status === 403) {
    content.innerHTML = '<div class="empty-state">Admin access required</div>';
    return;
  }
  const stats = await statsRes.json();
  adminState.users = stats.users || [];
  const reportPayload = reportsRes.ok ? await reportsRes.json() : { reports: [], mortal_data_by_game: {} };
  adminState.reports = reportPayload.reports || [];
  prepAndCategorizeReports(adminState.reports, reportPayload.mortal_data_by_game || {});
  renderAdmin();
}

// Re-fetch reports for the currently selected scope and re-render in place.
// Used when the admin switches between "Other players" and "All reports".
async function reloadAdminReports(scope) {
  adminState.reportScope = scope;
  adminState.reportsLoading = true;
  renderAdmin();
  const res = await fetch(`/api/admin/category-reports?scope=${encodeURIComponent(scope)}`);
  const payload = res.ok ? await res.json() : { reports: [], mortal_data_by_game: {} };
  adminState.reports = payload.reports || [];
  prepAndCategorizeReports(adminState.reports, payload.mortal_data_by_game || {});
  adminState.reportsLoading = false;
  renderAdmin();
}

// Run the same JS prep + categorize the reporter saw in the games view, so
// the embedded mistake card has board context and the AI category is
// available to show on the report strip. Mutates each report's mistake in
// place. Missing mortal_data is silently tolerated (older games / failed
// loads): the card still renders, just without board context, and the
// categorizer falls back to whatever it can derive.
function prepAndCategorizeReports(reports, mortalByGame) {
  if (typeof haipaiPrep === "undefined" || typeof haipaiCategorize === "undefined") return;
  for (const r of reports) {
    const md = mortalByGame[r.game_id];
    if (md && r.mistake && r.round_idx != null && r.mistake_idx != null) {
      haipaiPrep.prepReport(r.mistake, md, r.round_idx, r.mistake_idx);
    }
    if (r.mistake) {
      const out = haipaiCategorize.categorize(r.mistake);
      r.mistake.category = out.category;
      r.mistake.categorize_data = out.categorize_data;
      r.mistake.labels = out.labels;
    }
  }
}

// Return a sorted copy of the user list. Numeric columns (game_count) sort
// numerically; username sorts case-insensitively; date columns sort by their
// raw ISO string (lexicographic == chronological). Null latest_game sorts last
// regardless of direction (users with no games stay at the bottom).
function sortAdminUsers(users, sort) {
  const { col, dir } = sort;
  const mul = dir === "asc" ? 1 : -1;
  return users.slice().sort((a, b) => {
    let av = a[col], bv = b[col];
    if (col === "latest_game") {
      // Keep never-submitted users pinned to the bottom either way.
      if (!av && !bv) return 0;
      if (!av) return 1;
      if (!bv) return -1;
    }
    if (col === "username") { av = (av || "").toLowerCase(); bv = (bv || "").toLowerCase(); }
    if (av < bv) return -1 * mul;
    if (av > bv) return 1 * mul;
    return 0;
  });
}

// Toggle sort on header click: same column flips direction, new column starts
// descending for counts/dates (most-recent / most-games first) and ascending
// for the username.
function adminSortUsers(col) {
  const s = adminState.userSort;
  if (s.col === col) {
    s.dir = s.dir === "asc" ? "desc" : "asc";
  } else {
    s.col = col;
    s.dir = col === "username" ? "asc" : "desc";
  }
  renderAdmin();
}

function renderAdmin() {
  const content = document.getElementById("content");

  const users = adminState.users;
  const totalGames = users.reduce((s, u) => s + u.game_count, 0);

  let html = `<div class="game-header"><h2>Admin Dashboard</h2></div>`;

  // User stats (with View-as button for impersonation). Sortable by any
  // column — click a header to toggle; default is game_count desc.
  const selfId = (window._meData && window._meData.id) || null;
  const impersonating = !!(window._meData && window._meData.impersonating);
  const sortedUsers = sortAdminUsers(users, adminState.userSort);
  const sortCols = [
    { key: "username", label: "User" },
    { key: "game_count", label: "Games" },
    { key: "latest_game", label: "Latest game" },
    { key: "created_at", label: "Joined" },
  ];
  const headerCells = sortCols.map(c => {
    const active = adminState.userSort.col === c.key;
    const arrow = active ? (adminState.userSort.dir === "asc" ? " ▲" : " ▼") : "";
    return `<th class="sortable${active ? " sorted" : ""}" data-action="adminSortUsers" data-col="${c.key}">${c.label}${arrow}</th>`;
  }).join("");
  html += `<div class="admin-card" style="margin-bottom:16px">
    <div class="admin-card-header"><b>${users.length} users</b> <span class="admin-meta">&middot; ${totalGames} games total</span></div>
    <table class="admin-users-table">
      <tr>${headerCells}<th></th></tr>
      ${sortedUsers.map(u => {
        const joined = new Date(u.created_at + "Z").toLocaleDateString();
        const latest = u.latest_game
          ? new Date(u.latest_game + "Z").toLocaleDateString()
          : `<span class="admin-meta">—</span>`;
        const canActOn = !impersonating && u.id !== selfId;
        const viewBtn = canActOn
          ? `<button class="btn btn-sm" data-action="adminImpersonate" data-user-id="${u.id}">View as</button>`
          : "";
        const deleteBtn = canActOn
          ? `<button class="btn btn-sm btn-delete" data-action="adminDeleteUser" data-user-id="${u.id}">Delete</button>`
          : "";
        return `<tr><td>${escapeHtml(u.username)}</td><td>${u.game_count}</td><td>${latest}</td><td>${joined}</td><td>${viewBtn} ${deleteBtn}</td></tr>`;
      }).join("")}
    </table>
  </div>`;

  // Category reports — each report embeds the full mistake card the
  // reporting user saw; the admin's only action is Delete (after fixing
  // the underlying category/copy via a Claude skill).
  const reports = adminState.reports || [];
  const reportKind = adminState.reportKind;
  const reportScope = adminState.reportScope;
  const filteredReports = reportKind ? reports.filter(r => r.kind === reportKind) : reports;
  const counts = reports.reduce((a, r) => { a[r.kind] = (a[r.kind] || 0) + 1; return a; }, {});
  html += `<div class="game-header" style="margin-top:8px"><h2>Category reports (${reports.length})</h2></div>`;
  html += `<div class="admin-filters">
    <select data-change-action="reloadAdminReports">
      <option value="others" ${reportScope==="others"?"selected":""}>Other player reports</option>
      <option value="all" ${reportScope==="all"?"selected":""}>All reports</option>
    </select>
    <select data-change-action="adminReportKind">
      <option value="">All kinds (${reports.length})</option>
      <option value="wrong_category" ${reportKind==="wrong_category"?"selected":""}>wrong_category (${counts.wrong_category||0})</option>
      <option value="wrong_text" ${reportKind==="wrong_text"?"selected":""}>wrong_text (${counts.wrong_text||0})</option>
    </select>
  </div>`;
  if (adminState.reportsLoading) {
    html += '<div class="empty-state">Loading reports...</div>';
  } else if (!filteredReports.length) {
    html += '<div class="empty-state">No reports</div>';
  } else {
    for (const r of filteredReports) {
      html += renderReportCard(r);
    }
  }

  content.innerHTML = html;
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

async function adminDeleteUser(userId) {
  const user = (adminState.users || []).find(u => u.id === userId);
  if (!user) {
    alert("User not found in current admin view — refresh and retry.");
    return;
  }
  const username = user.username;
  const typed = window.prompt(
    `GDPR-delete user "${username}"?\n\n` +
    `This permanently removes the account, all games, mistakes, ` +
    `and category reports.\n\n` +
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
    `  ${d.category_reports || 0} category reports`
  );
  showAdmin();
}

// Render one category report: top strip (id / kind / user / Delete) +
// reason quote + the full mistake card the reporter actually saw.
function renderReportCard(r) {
  const date = new Date(r.created_at + "Z").toLocaleString();
  const kindLabel = r.kind === "wrong_category" ? "Wrong category" : "Wrong text";
  // The mistake's category is what the JS categorizer just computed — the
  // same code path the reporter saw. Falls back to "?" if prep / mortal_data
  // wasn't available.
  const aiCat = (r.mistake && r.mistake.category) || null;
  const catBadge = aiCat
    ? `<span class="report-orig-cat" title="${escapeHtml(catDesc(aiCat))}">${escapeHtml(catLabel(aiCat))}</span>`
    : "";
  let html = `<div class="report-card" id="report-${r.id}">
    <div class="report-strip">
      <span class="report-id">R-${r.id} <span class="hash">&middot; #${r.mistake_id}</span></span>
      <span class="report-kind ${r.kind}">${kindLabel}</span>
      ${catBadge}
      <span class="report-by"><span class="user">@${escapeHtml(r.username)}</span><span class="date">${date}</span></span>
      <span class="report-actions">
        <button class="btn btn-sm btn-delete" data-action="adminDeleteReport" data-report-id="${r.id}">Delete</button>
      </span>
    </div>`;

  if (r.reason || r.suggested_category) {
    html += `<div class="report-reason">
      <span class="quote-mark">&ldquo;</span>
      <div class="reason-text">`;
    if (r.reason) html += escapeHtml(r.reason);
    if (r.suggested_category) {
      const fromCat = aiCat ? escapeHtml(catLabel(aiCat)) : "?";
      html += `<div class="reason-suggested">Suggested:
        <span class="from">${fromCat}</span>
        <span class="arrow">&rarr;</span>
        <span class="to">${escapeHtml(catLabel(r.suggested_category))}</span>
      </div>`;
    }
    html += `</div></div>`;
  }

  if (r.mistake) {
    // Embed the same UI the user sees — no annotate/report controls,
    // no game link (the report-strip already identifies game/turn).
    // Append the generated trainer text exactly as the games view does so
    // wrong_text reports show the actual copy the user is complaining about.
    const explanation = generateExplanation(r.mistake);
    const trainerText = explanation
      ? `<div class="mascot-speech"><img src="/static/mascot.svg" class="mascot-avatar" alt=""><div class="speech-bubble">${explanation}</div></div>`
      : `<div class="report-trainer-empty">No trainer text generated for this mistake (category: <code>${escapeHtml(r.mistake.category || "?")}</code>).</div>`;
    html += `<div class="report-mistake-embed">${renderMistakeCard(r.mistake)}${trainerText}</div>`;
  }

  html += `<div class="report-footer">
    <span>game <b>#${r.game_id}</b></span>
    <span>${formatRoundLabel(escapeHtml(r.round_name || ""))} &middot; Turn ${formatTurnNumber(r.turn)}</span>
  </div></div>`;
  return html;
}

async function adminDeleteReport(reportId) {
  if (!window.confirm("Delete this category report? This cannot be undone.")) return;
  const res = await apiDelete(`/api/admin/category-reports/${reportId}`);
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    alert(data.error || "Failed to delete report");
    return;
  }
  adminState.reports = (adminState.reports || []).filter(x => x.id !== reportId);
  document.getElementById(`report-${reportId}`)?.remove();
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
        <button class="btn btn-sm" data-action="adminStopImpersonate">Stop</button>
      `;
    } else {
      banner.style.display = "none";
      banner.innerHTML = "";
    }
  }
  if (stopMenuBtn) stopMenuBtn.style.display = active ? "" : "none";
}
