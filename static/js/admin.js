// Admin dashboard: category-reports list + user list with View-as
// impersonation. Impersonate banner rendering also lives here.

var adminState = { users: [], reports: [], reportKind: "", reportSort: "ev", reportScope: "others", reportsLoading: false,
                   reportPageSize: 10, reportPage: 0, reportIds: [], reportStatus: "open",
                   mau: 0, mauTrend: [],
                   makaRanks: { count: 0, undated: 0, since: "" },
                   userSort: { col: "latest_game", dir: "desc" },
                   // Category-shape snapshot panel: history of saved runs, the
                   // last in-browser computed result, and live run status.
                   snapshot: { history: null, result: null, running: false, status: "" } };

async function showAdmin(reportHash = "") {
  state.currentGame = null;
  state.currentGameData = null;
  renderGameList();
  const content = document.getElementById("content");
  let linkedReports;
  try {
    linkedReports = applyAdminReportHash(reportHash);
  } catch (error) {
    content.innerHTML = `<div class="empty-state">Invalid report link: ${escapeHtml(error.message)} <a href="#admin">Open admin</a></div>`;
    return;
  }
  content.innerHTML = '<div class="empty-state">Loading...</div>';

  const [statsRes, reportsRes] = await Promise.all([
    fetch("/api/admin/stats"),
    fetch(adminReportsUrl()),
  ]);
  if (statsRes.status === 403) {
    content.innerHTML = '<div class="empty-state">Admin access required</div>';
    return;
  }
  const stats = await statsRes.json();
  adminState.users = stats.users || [];
  adminState.mau = stats.mau || 0;
  adminState.mauTrend = stats.mau_trend || [];
  adminState.makaRanks = stats.maka_ranks || adminState.makaRanks;
  const reportPayload = reportsRes.ok ? await reportsRes.json() : { reports: [], mortal_data_by_game: {} };
  adminState.reports = reportPayload.reports || [];
  prepAndCategorizeReports(adminState.reports, reportPayload.mortal_data_by_game || {});
  renderAdmin();
  if (linkedReports) document.getElementById("admin-report-controls")?.scrollIntoView({ block: "start" });
  // Snapshot history is cheap; load it lazily after the main render so the
  // dashboard paints immediately, then refresh the panel in place.
  loadSnapshotHistory();
}

async function loadSnapshotHistory() {
  try {
    const res = await fetch("/api/admin/category-snapshots");
    if (!res.ok) return;
    const data = await res.json();
    adminState.snapshot.history = data.snapshots || [];
  } catch (e) {
    adminState.snapshot.history = [];
  }
  renderSnapshotPanel();
}

// Re-fetch reports for the currently selected scope and re-render in place.
// Used when the admin switches between "Other players" and "All reports".
function adminReportsUrl() {
  return `/api/admin/category-reports?scope=${encodeURIComponent(adminState.reportScope)}&status=${encodeURIComponent(adminState.reportStatus)}`;
}

async function adminSetReportStatus(status) {
  adminState.reportStatus = status;
  await reloadAdminReports(adminState.reportScope);
}

async function reloadAdminReports(scope) {
  adminState.reportScope = scope;
  adminState.reportPage = 0;
  adminState.reportsLoading = true;
  renderAdmin();
  const res = await fetch(adminReportsUrl());
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
      r.mistake.skillArea = out.skillArea;
      r.mistake.shape = out.shape;
      r.mistake.wins = out.wins;
      r.mistake.categorize_data = out.categorize_data;
      r.mistake.labels = out.labels;
    }
  }
}

// Apply all filters before sorting and pagination.
function rankedAdminReports(reports, kind, sort, reportIds = []) {
  const ids = new Set(reportIds);
  const ev = r => {
    const value = r.mistake && r.mistake.ev_loss;
    return value != null && Number.isFinite(Number(value)) ? Number(value) : -Infinity;
  };
  return reports.filter(r => (!kind || r.kind === kind) && (!ids.size || ids.has(r.id))).sort((a, b) => {
    if (sort !== "date" && ev(a) !== ev(b)) return ev(a) > ev(b) ? -1 : 1;
    return (b.created_at || "").localeCompare(a.created_at || "") || b.id - a.id;
  });
}

function adminReportPage(reports, pageSize, page) {
  const total = reports.length;
  const size = pageSize === "unlimited" ? Math.max(total, 1) : pageSize;
  const pages = Math.max(1, Math.ceil(total / size));
  page = Math.max(0, Math.min(page, pages - 1));
  const offset = page * size;
  return { reports: reports.slice(offset, offset + size), total, page, pages,
           start: total ? offset + 1 : 0, end: Math.min(offset + size, total) };
}

function adminSetReportPageSize(value) {
  adminState.reportPageSize = value === "unlimited" ? value : [10, 20, 50].includes(Number(value)) ? Number(value) : 10;
  adminState.reportPage = 0;
  renderAdmin();
}

function adminChangeReportPage(direction) {
  if (adminState.reportsLoading) return;
  adminState.reportPage += direction;
  renderAdmin();
  document.getElementById("admin-report-controls")?.scrollIntoView({ block: "start" });
}

function parseAdminReportIds(value) {
  const tokens = value.trim().split(/[\s,;]+/).filter(Boolean);
  if (tokens.some(token => !/^#?\d+$/.test(token)
      || !Number.isSafeInteger(Number(token.replace(/^#/, ""))) || Number(token.replace(/^#/, "")) <= 0)) {
    throw new Error("Enter positive report IDs separated by commas or spaces (for example, 12, 34, 56).");
  }
  return [...new Set(tokens.map(token => Number(token.replace(/^#/, ""))))];
}

// Handoff links show every requested report, regardless of previous UI filters.
// Validate before changing state; an empty/invalid list must not show all reports.
function applyAdminReportHash(hash) {
  if (!hash.startsWith("#admin?")) return false;
  const params = new URLSearchParams(hash.slice("#admin?".length));
  if (!params.has("report_ids")) return false;
  const ids = parseAdminReportIds(params.getAll("report_ids").join(","));
  if (!ids.length) throw new Error("Provide at least one report ID.");
  adminState.reportIds = ids;
  adminState.reportScope = "all";
  adminState.reportStatus = "all";
  adminState.reportKind = "";
  adminState.reportPageSize = "unlimited";
  adminState.reportPage = 0;
  return true;
}

function adminFilterReportIds(form) {
  const input = form.elements.reportIds;
  try {
    adminState.reportIds = parseAdminReportIds(input.value);
  } catch (error) {
    input.setCustomValidity(error.message);
    input.reportValidity();
    return;
  }
  adminState.reportPage = 0;
  renderAdmin();
}

function adminClearReportIds() {
  adminState.reportIds = [];
  adminState.reportPage = 0;
  renderAdmin();
}

function adminSortReports(sort) {
  adminState.reportSort = sort === "date" ? "date" : "ev";
  adminState.reportPage = 0;
  renderAdmin();
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

// Monthly active users: headline count (users who submitted >=1 game in the
// trailing 30 days) plus a 6-calendar-month trend of the same "submitted a
// game" activity. There's no login tracking, so game submission is the only
// activity signal available.
function mauMonthLabel(key) {
  const [y, m] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString(undefined, { month: "short", year: "2-digit" });
}

function renderMauPanel() {
  const trend = adminState.mauTrend || [];
  const maxActive = Math.max(1, ...trend.map(t => t.active_users));
  const rows = trend.map(t => {
    const pct = (t.active_users / maxActive * 100).toFixed(0);
    return `<div class="mau-bar-row">
        <span class="mau-bar-label">${mauMonthLabel(t.month)}</span>
        <div class="mau-bar-track"><div class="mau-bar-fill" style="width:${pct}%"></div></div>
        <span class="mau-bar-value">${t.active_users}</span>
      </div>`;
  }).join("");
  return `<div class="admin-card" style="margin-bottom:16px">
      <div class="admin-card-header"><b>Monthly active users</b> <span class="admin-meta">&middot; submitted &ge;1 game</span></div>
      <div class="mau-headline"><span class="mau-headline-num">${adminState.mau || 0}</span><span class="mau-headline-label">active in the last 30 days</span></div>
      <div class="mau-trend">${rows}</div>
    </div>`;
}

function renderMakaRankPanel(maka) {
  const reviewDate = maka.since ? new Date(maka.since.replace(" ", "T") + "Z")
    .toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : "unknown";
  return `<div class="admin-card admin-maka-panel" style="margin-bottom:16px">
    <div class="admin-card-header"><b>Maka grades awaiting review</b></div>
    <div>${!maka.reviewed && maka.undated ? "At least " : ""}<strong>${maka.count}</strong>
      ${maka.reviewed ? `new or changed grades (${maka.overall} overall, ${maka.hand} hand)` : "overall and hand grades"}</div>
    ${maka.reviewed
      ? `<div class="admin-meta">Last calibration review: ${reviewDate} · ${maka.reviewed_grades} usable grades reviewed.</div>
         <div class="admin-maka-conclusion">${escapeHtml(maka.conclusion)}</div>`
      : `<div class="admin-meta">No calibration review recorded. Counting dated grades since the threshold update on ${reviewDate}.</div>`}
    ${maka.undated ? `<div class="admin-meta">${maka.undated} existing grades have unknown save dates${maka.reviewed ? "; unchanged reviewed grades are excluded from the pending count" : ""}.</div>` : ""}
  </div>`;
}

function renderAdmin() {
  const content = document.getElementById("content");

  const users = adminState.users;
  const totalGames = users.reduce((s, u) => s + u.game_count, 0);

  let html = `<div class="game-header"><h2>Admin Dashboard</h2></div>`;

  html += renderMauPanel();

  html += renderMakaRankPanel(adminState.makaRanks);

  // User stats (with View-as button for impersonation). Sortable by any
  // column — click a header to toggle; default is latest_game desc.
  const selfId = (window._meData && window._meData.id) || null;
  const impersonating = !!(window._meData && window._meData.impersonating);
  const sortedUsers = sortAdminUsers(users, adminState.userSort);
  const sortCols = [
    { key: "username", label: "User" },
    { key: "game_count", label: "Games" },
    { key: "games_last_30d", label: "Games/day (30d)" },
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
        const gamesPerDay = ((u.games_last_30d || 0) / 30).toFixed(2);
        return `<tr><td>${escapeHtml(u.username)}</td><td>${u.game_count}</td><td title="${u.games_last_30d || 0} games in the last 30 days">${gamesPerDay}</td><td>${latest}</td><td>${joined}</td><td>${viewBtn} ${deleteBtn}</td></tr>`;
      }).join("")}
    </table>
  </div>`;

  // Global category-shape snapshot. Rendered into its own container so the
  // compute loop can update it (progress + result) without re-running the
  // whole admin render.
  html += `<div id="category-snapshot-panel">${snapshotPanelHtml()}</div>`;

  // Open feedback and preserved fix history share the same hand cards.
  const reports = adminState.reports || [];
  const reportKind = adminState.reportKind;
  const reportScope = adminState.reportScope;
  const matchingReports = rankedAdminReports(reports, reportKind, adminState.reportSort, adminState.reportIds);
  const page = adminReportPage(matchingReports, adminState.reportPageSize, adminState.reportPage);
  adminState.reportPage = page.page;
  const filteredReports = page.reports;
  const pagination = `<nav class="admin-report-pagination" aria-label="Report pages">
    <button class="btn btn-sm" data-action="adminChangeReportPage" data-direction="-1" ${adminState.reportsLoading || page.page === 0 ? "disabled" : ""}>Previous</button>
    <span>Page ${page.page + 1} of ${page.pages}</span>
    <button class="btn btn-sm" data-action="adminChangeReportPage" data-direction="1" ${adminState.reportsLoading || page.page + 1 >= page.pages ? "disabled" : ""}>Next</button>
  </nav>`;
  const counts = reports.reduce((a, r) => { a[r.kind] = (a[r.kind] || 0) + 1; return a; }, {});
  html += `<div class="game-header" style="margin-top:8px"><h2>Category reports <span class="admin-report-total">${reports.length}</span></h2></div>`;
  html += `<div id="admin-report-controls" class="admin-filters admin-report-controls">
    <label>Report status<select data-change-action="adminSetReportStatus" ${adminState.reportsLoading ? "disabled" : ""}>
      <option value="open" ${adminState.reportStatus === "open" ? "selected" : ""}>Open reports</option>
      <option value="fixed" ${adminState.reportStatus === "fixed" ? "selected" : ""}>Fixed reports</option>
      <option value="all" ${adminState.reportStatus === "all" ? "selected" : ""}>Open and fixed</option>
    </select></label>
    <label>Players<select data-change-action="reloadAdminReports">
      <option value="others" ${reportScope==="others"?"selected":""}>Other player reports</option>
      <option value="all" ${reportScope==="all"?"selected":""}>All reports</option>
    </select></label>
    <label>Report kind<select data-change-action="adminReportKind">
      <option value="">All kinds (${reports.length})</option>
      <option value="complex_gap" ${reportKind==="complex_gap"?"selected":""}>Complex gap (${counts.complex_gap||0})</option>
      <option value="wrong_text" ${reportKind==="wrong_text"?"selected":""}>Wrong text (${counts.wrong_text||0})</option>
      <option value="wrong_category" ${reportKind==="wrong_category"?"selected":""}>Wrong category (${counts.wrong_category||0})</option>
    </select></label>
    <label>Sort by<select data-change-action="adminSortReports">
      <option value="ev" ${adminState.reportSort === "ev" ? "selected" : ""}>EV · highest first</option>
      <option value="date" ${adminState.reportSort === "date" ? "selected" : ""}>Report date · newest first</option>
    </select></label>
    <label>Reports per page<select data-change-action="adminSetReportPageSize">
      ${[10, 20, 50, "unlimited"].map(size => `<option value="${size}" ${adminState.reportPageSize === size ? "selected" : ""}>${size === "unlimited" ? "Unlimited" : size}</option>`).join("")}
    </select></label>
    <form class="admin-report-id-filter" data-submit-action="adminFilterReportIds">
      <label for="admin-report-ids">Filter by report IDs</label>
      <div class="admin-report-id-input">
        <input id="admin-report-ids" name="reportIds" type="text" value="${adminState.reportIds.join(", ")}" placeholder="e.g. 12, 34, 56" aria-describedby="admin-report-id-help">
        <button class="btn btn-sm" type="submit">Apply filter</button>
        <button class="btn btn-sm" type="button" data-action="adminClearReportIds">Clear</button>
      </div>
      <small id="admin-report-id-help">Separate IDs with commas or spaces. Applies within the selected status, players and report kind.</small>
    </form>
    <span class="admin-report-summary" aria-live="polite">${adminState.reportsLoading ? "Loading reports…" : `Showing ${page.total ? `${page.start}–${page.end}` : "0"} of ${page.total} reports`}
      <small>${adminState.reportSort === "date" ? "Newest reports first" : "Highest EV loss first"}${adminState.reportIds.length ? ` · ${adminState.reportIds.length} IDs selected` : ""}</small>
    </span>
    ${pagination}
  </div>`;
  if (adminState.reportsLoading) {
    html += '<div class="empty-state">Loading reports...</div>';
  } else if (!filteredReports.length) {
    html += '<div class="empty-state">No reports match the selected filters.</div>';
  } else {
    for (const r of filteredReports) {
      html += renderReportCard(r);
    }
    if (page.pages > 1) html += pagination;
  }

  content.innerHTML = html;
}

// --- Category-shape snapshot ---------------------------------------------
//
// The mistake categorizer is client-side only (static/js/categorize.js), so
// the only way to tally the global shape distribution is to run it here in the
// browser over every game — the same prep + categorize the games view does.
// "complex" (Mortal wins nothing visible — stats don't explain the play) is
// the headline bucket we want to drive down as the categorizer evolves.

var SNAPSHOT_SHAPE_ORDER = ["obvious", "trade-off", "complex", "n/a"];

function snapshotPct(n, d) { return d ? (n / d * 100).toFixed(1) + "%" : "—"; }

// Re-render just the snapshot panel in place (used during/after a compute run
// so we don't disturb the rest of the admin dashboard).
function renderSnapshotPanel() {
  const el = document.getElementById("category-snapshot-panel");
  if (el) el.innerHTML = snapshotPanelHtml();
}

function snapshotPanelHtml() {
  const s = adminState.snapshot;
  const ver = (typeof haipaiCategorize !== "undefined" && haipaiCategorize.CATEGORIZER_VERSION) || "?";
  let html = `<div class="game-header" style="margin-top:8px"><h2>Category snapshot</h2></div>`;
  html += `<div class="admin-card snapshot-card">`;
  html += `<div class="admin-card-header">
      <b>Mistake shape distribution</b>
      <span class="admin-meta">&middot; categorizer v${ver} &middot; computed live in your browser</span>
    </div>`;
  html += `<p class="snapshot-note">Runs the same prep + categorize the games view uses, over every game across all users, and tallies which "shape" bucket each mistake falls in. <b>Complex</b> = Mortal wins nothing the stats can explain — the bucket we want to shrink. Save a run to track it over time.</p>`;

  if (s.running) {
    html += `<div class="snapshot-status">${escapeHtml(s.status || "Working…")}</div>`;
  } else {
    html += `<div class="snapshot-actions">
        <button class="btn" data-action="computeCategorySnapshot">Compute snapshot</button>
        ${s.result ? `<button class="btn btn-sm" data-action="saveCategorySnapshot">Save this run</button>` : ""}
        ${s.status ? `<span class="snapshot-status-inline">${escapeHtml(s.status)}</span>` : ""}
      </div>`;
  }

  if (s.result) html += renderSnapshotResult(s.result);
  html += renderSnapshotHistory();
  html += `</div>`;
  return html;
}

function renderSnapshotResult(r) {
  const total = r.total_mistakes || 0;
  const totalEv = r.total_ev || 0;
  const complex = r.by_shape.complex || { count: 0, ev: 0 };

  let html = `<div class="snapshot-headline">
      <div class="snapshot-big">
        <span class="snapshot-big-num">${snapshotPct(complex.count, total)}</span>
        <span class="snapshot-big-label">complex</span>
      </div>
      <div class="snapshot-headline-meta">
        ${complex.count.toLocaleString()} of ${total.toLocaleString()} mistakes &middot;
        ${complex.ev.toFixed(0)} EV (${snapshotPct(complex.ev, totalEv)} of all EV loss)<br>
        ${r.game_count.toLocaleString()}${r.total_games ? ` of ${r.total_games.toLocaleString()}` : ""} games analyzed${r.skipped ? ` &middot; ${r.skipped} skipped (prep/load failed)` : ""}
      </div>
    </div>`;

  // Full shape table.
  const shapeKeys = SNAPSHOT_SHAPE_ORDER.filter(k => r.by_shape[k])
    .concat(Object.keys(r.by_shape).filter(k => !SNAPSHOT_SHAPE_ORDER.includes(k)).sort());
  html += `<table class="snapshot-table"><tr>
      <th>Shape</th><th>Mistakes</th><th>%</th><th>EV loss</th><th>% EV</th></tr>`;
  for (const k of shapeKeys) {
    const e = r.by_shape[k];
    html += `<tr class="${k === "complex" ? "snapshot-row-complex" : ""}">
        <td>${escapeHtml(k)}</td>
        <td>${e.count.toLocaleString()}</td>
        <td>${snapshotPct(e.count, total)}</td>
        <td>${e.ev.toFixed(0)}</td>
        <td>${snapshotPct(e.ev, totalEv)}</td>
      </tr>`;
  }
  html += `</table>`;

  // Skill area × shape matrix (counts), sorted by total desc.
  const skills = Object.keys(r.by_skill_shape).sort((a, b) => {
    const sum = o => Object.values(o).reduce((x, y) => x + y, 0);
    return sum(r.by_skill_shape[b]) - sum(r.by_skill_shape[a]);
  });
  if (skills.length) {
    html += `<details class="snapshot-matrix"><summary>Skill area × shape</summary>`;
    html += `<table class="snapshot-table"><tr><th>Skill area</th>${
      shapeKeys.map(k => `<th>${escapeHtml(k)}</th>`).join("")}<th>Total</th></tr>`;
    for (const sk of skills) {
      const row = r.by_skill_shape[sk];
      const cells = shapeKeys.map(k => row[k] || 0);
      const tot = cells.reduce((a, b) => a + b, 0);
      html += `<tr><td>${escapeHtml(sk)}</td>${
        cells.map(c => `<td>${c.toLocaleString()}</td>`).join("")}<td><b>${tot.toLocaleString()}</b></td></tr>`;
    }
    html += `</table></details>`;
  }
  return html;
}

function renderSnapshotHistory() {
  const hist = adminState.snapshot.history;
  if (hist == null) return `<div class="snapshot-history-empty">Loading history…</div>`;
  if (!hist.length) return `<div class="snapshot-history-empty">No saved snapshots yet.</div>`;
  let html = `<details class="snapshot-history" open><summary>Saved snapshots (${hist.length})</summary>`;
  for (const h of hist) {
    const sm = h.summary || {};
    const total = sm.total_mistakes || h.mistake_count || 0;
    const complex = (sm.by_shape && sm.by_shape.complex) || { count: 0 };
    const when = h.created_at ? new Date(h.created_at + "Z").toLocaleString() : "—";
    // Normalize a saved snapshot into the same shape renderSnapshotResult
    // expects, so an expanded history row shows the full breakdown — proving
    // the save kept everything the live run presented.
    const result = {
      by_shape: sm.by_shape || {},
      by_skill_shape: sm.by_skill_shape || {},
      total_mistakes: total,
      total_ev: sm.total_ev || 0,
      game_count: h.game_count || 0,
      total_games: sm.total_games || 0,
      skipped: sm.skipped || 0,
    };
    html += `<details class="snapshot-saved">
        <summary>${escapeHtml(when)} &middot; <b>v${h.categorizer_version}</b> &middot;
          ${(h.game_count || 0).toLocaleString()} games &middot; ${total.toLocaleString()} mistakes &middot;
          <b>${snapshotPct(complex.count, total)} complex</b></summary>
        ${renderSnapshotResult(result)}
      </details>`;
  }
  html += `</details>`;
  return html;
}

// Run prep + categorize over every game (concurrency-limited) and tally the
// shape distribution. Mirrors the trends per-game pipeline but global and
// bucketed by shape. Result is held in adminState until the admin saves it.
async function computeCategorySnapshot() {
  const s = adminState.snapshot;
  if (s.running) return;
  if (typeof haipaiPrep === "undefined" || typeof haipaiCategorize === "undefined"
      || typeof recategorizeGameInPlace === "undefined") {
    s.status = "Categorizer not loaded — reload the page and retry.";
    renderSnapshotPanel();
    return;
  }
  s.running = true;
  s.result = null;
  s.status = "Loading game list…";
  renderSnapshotPanel();

  let ids = [];
  try {
    const res = await fetch("/api/admin/snapshot/game-ids");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    ids = (await res.json()).game_ids || [];
  } catch (e) {
    s.running = false;
    s.status = "Failed to load game list.";
    renderSnapshotPanel();
    return;
  }

  const byShape = {};       // shape -> { count, ev }
  const bySkillShape = {};  // skill -> { shape -> count }
  let totalMistakes = 0, totalEv = 0, analyzed = 0, skipped = 0, done = 0;

  const bump = (shape, skill, ev) => {
    (byShape[shape] = byShape[shape] || { count: 0, ev: 0 });
    byShape[shape].count += 1;
    byShape[shape].ev += ev;
    (bySkillShape[skill] = bySkillShape[skill] || {});
    bySkillShape[skill][shape] = (bySkillShape[skill][shape] || 0) + 1;
    totalMistakes += 1;
    totalEv += ev;
  };

  const updateStatus = () => {
    s.status = `Analyzing ${done}/${ids.length} games… (${totalMistakes.toLocaleString()} mistakes, ${snapshotPct((byShape.complex || {}).count || 0, totalMistakes)} complex)`;
    const el = document.querySelector("#category-snapshot-panel .snapshot-status");
    if (el) el.textContent = s.status; else renderSnapshotPanel();
  };

  const queue = ids.slice();
  async function worker() {
    while (queue.length) {
      const id = queue.shift();
      try {
        const res = await fetch(`/api/admin/snapshot/game/${id}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const payload = await res.json();
        const game = payload.game;
        const md = payload.mortal_data;
        if (game && md) {
          await haipaiPrep.prepGameAsync(game, md);
          recategorizeGameInPlace(game);
          for (const rnd of game.rounds || []) {
            for (const m of rnd.mistakes || []) {
              bump(m.shape || "n/a", m.skillArea || "(none)", m.ev_loss || 0);
            }
          }
          analyzed += 1;
        } else {
          skipped += 1;
        }
      } catch (e) {
        skipped += 1;
        console.warn("Snapshot: skipping game", id, e);
      }
      done += 1;
      if (done % 3 === 0 || done === ids.length) updateStatus();
    }
  }

  const concurrency = Math.min(3, ids.length);
  await Promise.all(Array.from({ length: concurrency }, () => worker()));

  s.result = {
    by_shape: byShape,
    by_skill_shape: bySkillShape,
    total_mistakes: totalMistakes,
    total_ev: totalEv,
    game_count: analyzed,
    total_games: ids.length,
    skipped,
  };
  s.running = false;
  s.status = `Done — ${analyzed.toLocaleString()} games, ${totalMistakes.toLocaleString()} mistakes. Save to keep this run.`;
  renderSnapshotPanel();
}

async function saveCategorySnapshot() {
  const s = adminState.snapshot;
  if (!s.result) return;
  const ver = (typeof haipaiCategorize !== "undefined" && haipaiCategorize.CATEGORIZER_VERSION) || 0;
  const body = {
    categorizer_version: ver,
    game_count: s.result.game_count,
    mistake_count: s.result.total_mistakes,
    summary: {
      by_shape: s.result.by_shape,
      by_skill_shape: s.result.by_skill_shape,
      total_mistakes: s.result.total_mistakes,
      total_ev: s.result.total_ev,
      total_games: s.result.total_games,
      skipped: s.result.skipped,
    },
  };
  const res = await apiPost("/api/admin/category-snapshots", body);
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    alert(data.error || "Failed to save snapshot");
    return;
  }
  s.status = "Saved.";
  await loadSnapshotHistory();  // re-renders the panel
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

// Render one category report: top strip (id / kind / user / resolution) +
// reason quote + the full mistake card the reporter actually saw.
function renderReportCard(r) {
  const date = new Date(r.created_at + "Z").toLocaleString();
  const kindLabel = r.kind === "wrong_category" ? "Wrong category"
    : r.kind === "complex_gap" ? "Complex gap"
    : "Wrong text";
  // The mistake's skill area × shape, as the JS categorizer just computed it —
  // the same code path the reporter saw. Empty if prep / mortal_data wasn't
  // available.
  const aiBadge = r.mistake ? mistakeBadge(r.mistake) : null;
  const catBadge = aiBadge
    ? `<span class="report-orig-cat" title="${escapeHtml(aiBadge.desc || "")}">${escapeHtml(aiBadge.label)}</span>`
    : "";
  let html = `<div class="report-card" id="report-${r.id}">
    <div class="report-strip">
      <span class="report-id">R-${r.id} <span class="hash">&middot; #${r.mistake_id}</span></span>
      <span class="report-kind ${r.kind}">${kindLabel}</span>
      ${catBadge}
      <span class="report-by"><span class="user">@${escapeHtml(r.username)}</span><span class="date">${date}</span></span>
      <span class="report-actions">
        ${r.awarded_coins != null ? `<span class="report-coin-awarded">✓ ${r.awarded_coins.toLocaleString()} coins awarded</span>` : ""}
        ${r.fixed_at ? '<span class="report-fixed-badge">✓ Fixed</span>'
          : `<button class="btn btn-sm" data-action="adminFixReport" data-report-id="${r.id}">${r.awarded_coins != null ? "Mark fixed" : "Fixed · award coins"}</button>`}
      </span>
    </div>`;

  if (r.fixed_at) {
    const fixedDate = new Date(r.fixed_at + "Z").toLocaleString();
    html += `<div class="report-resolution"><strong>Fixed ${escapeHtml(fixedDate)}</strong>
      <span class="admin-meta">${r.fixed_by_username ? `by @${escapeHtml(r.fixed_by_username)}` : ""}</span>
      ${r.fix_note ? `<p>${escapeHtml(r.fix_note)}</p>` : ""}</div>`;
  }

  if (r.reason || r.suggested_category) {
    html += `<div class="report-reason">
      <span class="quote-mark">&ldquo;</span>
      <div class="reason-text">`;
    if (r.reason) html += escapeHtml(r.reason);
    if (r.suggested_category && r.kind === "complex_gap") {
      // complex_gap rides its quick-tags here (comma-joined). Show them as the
      // dimensions the player flagged — these cluster into add-on B's backlog.
      const tags = r.suggested_category.split(",").map(s => s.trim()).filter(Boolean);
      html += `<div class="reason-suggested">Tagged:
        ${tags.map(t => `<span class="to"><code>${escapeHtml(t)}</code></span>`).join(" ")}
      </div>`;
    } else if (r.suggested_category) {
      // Historical only — the wrong_category report kind was retired with the
      // legacy codes (CORE Phase 3). Show the stored code verbatim as a record.
      html += `<div class="reason-suggested">Suggested category (legacy):
        <span class="to"><code>${escapeHtml(r.suggested_category)}</code></span>
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
      : `<div class="report-trainer-empty">No trainer text generated for this mistake (${escapeHtml((aiBadge && aiBadge.label) || "?")}).</div>`;
    html += `<div class="report-mistake-embed">${renderMistakeCard(r.mistake)}${trainerText}</div>`;
  }

  html += `<div class="report-footer">
    <span>game <b>#${r.game_id}</b></span>
    <span>${formatRoundLabel(escapeHtml(r.round_name || ""))} &middot; Turn ${formatTurnNumber(r.turn)}</span>
  </div></div>`;
  return html;
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


async function adminFixReport(reportId, button) {
  const reason = window.prompt("Mark this report completely fixed and award any unpaid coins? Confirm the fix and regression tests are complete. Add an optional fix summary:", "");
  if (reason === null) return;
  button.disabled = true;
  try {
    const res = await apiPost(`/api/admin/category-reports/${reportId}/fix`, { reason });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Could not mark report fixed");
    const report = adminState.reports.find(r => r.id === reportId);
    if (report) Object.assign(report, { fixed_at: data.fixed_at, fixed_by: data.fixed_by,
      fix_note: data.fix_note, awarded_coins: data.amount,
      fixed_by_username: (window._meData?.impersonating?.admin_username || window._meData?.username) });
    if (adminState.reportStatus === "open") {
      adminState.reports = adminState.reports.filter(r => r.id !== reportId);
    }
    if (parseTabHash() === "admin") renderAdmin();
    refreshCoinBalance();
  } catch (error) {
    alert(error.message || "Could not mark report fixed. Please try again.");
  } finally {
    button.disabled = false;
  }
}
