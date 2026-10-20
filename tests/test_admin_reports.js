const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ctx = vm.createContext({ URLSearchParams });
vm.runInContext(fs.readFileSync("static/js/admin.js", "utf8"), ctx);
const reports = Array.from({ length: 15 }, (_, i) => ({
  id: i + 1, kind: i % 2 ? "wrong_text" : "complex_gap",
  created_at: `2026-10-${String(15 - i).padStart(2, "0")} 12:00:00`,
  mistake: { ev_loss: i },
}));
test("defaults to the ten highest EV losses without mutating the source", () => {
  assert.equal(ctx.adminState.reportSort, "ev");
  assert.deepEqual(Array.from(ctx.adminReportPage(ctx.rankedAdminReports(reports, "", "ev"), 10, 0).reports, r => r.id),
    [15, 14, 13, 12, 11, 10, 9, 8, 7, 6]);
  assert.equal(reports[0].id, 1);
});
test("date sorting shows the ten newest reports", () => {
  assert.deepEqual(Array.from(ctx.adminReportPage(ctx.rankedAdminReports(reports, "", "date"), 10, 0).reports, r => r.id),
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
});
test("filters before ranking and places missing EV last", () => {
  const result = ctx.rankedAdminReports([...reports, { id: 99, kind: "wrong_text" }], "wrong_text", "ev");
  assert.deepEqual(Array.from(result, r => r.id), [14, 12, 10, 8, 6, 4, 2, 99]);
});
test("equal EV values use newest date then report ID", () => {
  const rows = [1, 2, 3].map(id => ({
    id, created_at: id === 1 ? "2026-01-01" : "2026-02-01", mistake: { ev_loss: 5 },
  }));
  assert.deepEqual(Array.from(ctx.rankedAdminReports(rows, "", "ev"), r => r.id), [3, 2, 1]);
});

test("page sizes and unlimited include every matching report without overlap", () => {
  const rows = Array.from({ length: 57 }, (_, i) => ({ id: i + 1 }));
  for (const size of [10, 20, 50]) {
    const seen = [];
    for (let page = 0; page < Math.ceil(rows.length / size); page++) {
      const result = ctx.adminReportPage(rows, size, page);
      assert.equal(result.start, page * size + 1);
      assert.equal(result.end, Math.min((page + 1) * size, rows.length));
      seen.push(...result.reports);
    }
    assert.deepEqual(seen, rows);
  }
  const all = ctx.adminReportPage(rows, "unlimited", 5);
  assert.equal(all.reports.length, 57);
  assert.equal(all.page, 0);
  assert.equal(all.pages, 1);
});

test("empty results and deletion on the last page clamp pagination", () => {
  const empty = ctx.adminReportPage([], 10, 8);
  assert.equal(empty.page, 0);
  assert.equal(empty.start, 0);
  assert.equal(empty.end, 0);
  assert.equal(empty.pages, 1);
  assert.equal(ctx.adminReportPage(reports.slice(0, 10), 10, 1).page, 0);
  assert.equal(ctx.adminReportPage(reports, 10, -1).page, 0);
});

test("ID filters accept pasted lists, deduplicate IDs, and reject invalid entries", () => {
  assert.deepEqual(Array.from(ctx.parseAdminReportIds(" #12, 34\n12; 56\t78 ")), [12, 34, 56, 78]);
  assert.deepEqual(Array.from(ctx.parseAdminReportIds("  ")), []);
  for (const value of ["1, nope", "-1", "0", "1.5", "1e3", "9007199254740992", "<script>"]) {
    assert.throws(() => ctx.parseAdminReportIds(value), /positive report IDs/);
  }
});

test("ID and kind filters intersect before sorting and pagination", () => {
  const ranked = ctx.rankedAdminReports(reports, "wrong_text", "ev", [2, 4, 15, 999]);
  assert.deepEqual(Array.from(ranked, r => r.id), [4, 2]);
  assert.equal(ctx.adminReportPage(ranked, 10, 4).total, 2);
  assert.equal(ctx.rankedAdminReports(reports, "", "ev", [999]).length, 0);
});

test("changing size, sort, or ID filters resets the page; invalid IDs keep the current filter", () => {
  const context = vm.createContext({});
  vm.runInContext(fs.readFileSync("static/js/admin.js", "utf8"), context);
  context.renderAdmin = () => {};
  context.adminState.reportPage = 3;
  context.adminSetReportPageSize("20");
  assert.equal(context.adminState.reportPageSize, 20);
  assert.equal(context.adminState.reportPage, 0);
  context.adminState.reportPage = 3;
  context.adminSortReports("date");
  assert.equal(context.adminState.reportPage, 0);
  const input = { value: "12, 34", setCustomValidity() {}, reportValidity() {} };
  context.adminState.reportPage = 3;
  context.adminFilterReportIds({ elements: { reportIds: input } });
  assert.equal(context.adminState.reportPage, 0);
  assert.deepEqual(Array.from(context.adminState.reportIds), [12, 34]);
  input.value = "12, bad";
  context.adminFilterReportIds({ elements: { reportIds: input } });
  assert.deepEqual(Array.from(context.adminState.reportIds), [12, 34]);
  context.adminClearReportIds();
  assert.equal(context.adminState.reportIds.length, 0);
});

function reportLinkContext(hash) {
  const context = vm.createContext({
    URLSearchParams,
    window: { location: { hash } },
    document: { addEventListener() {} },
    mgTabRoutes: () => ({}),
    mgSlugPattern: () => "waits",
    closeGameOverview: () => {},
  });
  for (const file of ["admin", "main"]) {
    vm.runInContext(fs.readFileSync(`static/js/${file}.js`, "utf8"), context);
  }
  return context;
}

test("report links route to admin and show all requested IDs beyond 50 on one page", async () => {
  const ids = Array.from({ length: 63 }, (_, i) => i + 1);
  const hash = `#admin?report_ids=${ids.join(",")}`;
  const context = reportLinkContext(hash);
  Object.assign(context.adminState, { reportKind: "wrong_text", reportPageSize: 10, reportPage: 4 });
  let routedHash;
  context.showAdmin = async value => {
    routedHash = value;
    context.applyAdminReportHash(value);
  };
  await context.applyHashRoute();
  assert.equal(routedHash, hash);
  assert.equal(context.adminState.reportScope, "all");
  assert.equal(context.adminState.reportKind, "");
  assert.equal(context.adminState.reportPageSize, "unlimited");
  assert.equal(context.adminState.reportPage, 0);
  const ranked = context.rankedAdminReports(ids.map(id => ({ id })), "", "ev", context.adminState.reportIds);
  const page = context.adminReportPage(ranked, context.adminState.reportPageSize, context.adminState.reportPage);
  assert.equal(page.reports.length, 63);
  assert.equal(page.pages, 1);
});

test("report links decode and deduplicate IDs, and a second link replaces the first", () => {
  const context = reportLinkContext("");
  context.applyAdminReportHash("#admin?report_ids=12%2C%20%2334%0A12&report_ids=56");
  assert.deepEqual(Array.from(context.adminState.reportIds), [12, 34, 56]);
  context.applyAdminReportHash("#admin?report_ids=78");
  assert.deepEqual(Array.from(context.adminState.reportIds), [78]);
});

test("invalid report links do not change filters, and ordinary hashes still work", () => {
  const context = reportLinkContext("");
  context.applyAdminReportHash("#admin?report_ids=12");
  for (const value of ["", ", ;", "12,bad", "0", "-1", "1.5", "9007199254740992"]) {
    assert.throws(() => context.applyAdminReportHash(`#admin?report_ids=${encodeURIComponent(value)}`));
    assert.deepEqual(Array.from(context.adminState.reportIds), [12]);
  }
  for (const hash of ["#admin", "#help", "#trends", "#g12", "#m12"]) {
    context.window.location.hash = hash;
    assert.equal(context.applyAdminReportHash(hash), false);
    assert.equal(context.parseTabHash(), ["#g12", "#m12"].includes(hash) ? null : hash.slice(1));
  }
});
