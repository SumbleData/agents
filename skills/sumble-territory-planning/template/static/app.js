/* Sumble territory planning — client.
 *
 * The server hands over the plan + the sheet once; everything after that is
 * computed here. Balance maths is deliberately client-side: accepting a move
 * has to move the bars in the same frame, or a reviewer can't tell whether the
 * change they just approved actually helped.
 *
 * The balance formula mirrors territory_lib.book_stats() exactly — same
 * included categories, same per-segment p75, same population CV. If you change
 * one, change the other.
 */

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

const state = {
  plan: null,
  rows: [],
  reps: [],
  segments: [],
  segLabel: {},
  repByName: {},
  tab: "overview",
  filters: new Set(["unallocated"]),  // Accounts opens on the reallocation pool
  repFilter: "",
  segmentFilter: "",
  search: "",
  page: 0,
  pageSize: 100,
  sort: { key: "score", dir: -1 },
  strongCutoff: 500,   // an account is "strong" if it's in the top N by ICP score
  strongSet: new Set(), // org_ids of the current top-N (rebuilt each render)
  scoreRank: {},        // org_id -> global rank by ICP score (1 = best)
  overviewSegment: "all", // Overview segment filter: "all" = both, else a key
  overviewSort: {         // per-matrix sort; default the summary metric, desc
    strength: { key: "ks_top", dir: -1 },
  },
  ksTopN: {},             // segment key -> how many of each rep's best accounts
                          // the Kolmogorov-Smirnov distance compares (sidebar)
};

const PAGE_DESCRIPTIONS = {
  overview: "Each rep's book against their segment peers. Click a distance for the rep's ranked accounts, or a rep to open their accounts.",
  accounts: "Reassign any account with the last column.",
  export: "Approved changes for your CRM, or the full sheet.",
};

// Flags read the EFFECTIVE owner (current + your allocations), so they update
// the moment you assign an account on the Accounts tab.
// `needsActivity: true` hides the flag entirely when no activity is loaded.
// With zero events every owned account trivially satisfies "not worked", so
// these cards would report the whole book as neglected when the truth is that
// the question is unanswerable. See hasActivityData().
const FLAGS = [
  { key: "unallocated", label: "Unallocated", test: (r) => !effectiveOwner(r) && !isWhitespace(r) && r.account_category !== "customer", cls: "flag-warn",
    help: "No active rep owns it: unowned, or held by a warehouse owner." },
  { key: "idle", label: "Idle", test: (r) => effectiveOwner(r) && !num(r.worked), cls: "flag-warn", needsActivity: true,
    help: "Owned, with no meeting, call, email or Slack post in the window." },
];

const REASON_LABELS = {
  misfit: "Wrong segment",
  assign_unallocated: "Unallocated — needs an owner",
  assign_whitespace: "Whitespace — new account",
  rebalance: "Rebalance",
  manual: "Manual override",
};

// ---------------------------------------------------------------- helpers

function num(v) { const n = Number(v); return Number.isFinite(n) ? n : 0; }
function isWhitespace(r) {
  return r.account_category === "whitespace" || r.account_category === "whitespace_subsidiary";
}

/** True when ANY row carries a real activity event.
 *
 *  Mirrors territory_lib.has_activity() so the UI and the move engine agree.
 *  When false, every activity-derived surface is REMOVED rather than shown as
 *  zero: the Activity columns, the not-worked and strong-idle flags, and the
 *  whole suggested-moves queue. Zero events means "we cannot tell", and a 0%
 *  Activity column states the opposite.
 *  Memoised — it is read on every render and scans every row. */
let _hasActivity = null;
function hasActivityData() {
  if (_hasActivity === null) {
    _hasActivity = state.rows.some(
      (r) => num(r.meetings) + num(r.calls) + num(r.emails_out) + num(r.emails_in) +
        num(r.messages) > 0
    );
  }
  return _hasActivity;
}

/** Rank all real (non-whitespace) accounts by ICP score, 1 = best, and mark the
 *  top `state.strongCutoff` as "strong". Rebuilt each render so the sidebar
 *  cutoff takes effect live. */
function computeStrongSet() {
  const ranked = state.rows
    .filter((r) => !isWhitespace(r))
    .sort((a, b) => num(b.score) - num(a.score));
  state.scoreRank = {};
  ranked.forEach((r, i) => { state.scoreRank[String(r.org_id)] = i + 1; });
  state.strongSet = new Set(
    ranked.slice(0, state.strongCutoff).map((r) => String(r.org_id)));
}
function isStrong(r) { return state.strongSet.has(String(r.org_id)); }
function accountRank(r) { return state.scoreRank[String(r.org_id)] || null; }
function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function fmt(n, digits = 0) {
  return Number(n || 0).toLocaleString(undefined, {
    minimumFractionDigits: digits, maximumFractionDigits: digits });
}
function isApproved(r) {
  return (r.proposal_status === "accepted" || r.proposal_status === "manual") && r.proposed_owner;
}
/** Who owns the account once the user's accepted / manual allocations are
 *  applied — the PLANNED owner. Everything on the Overview groups by this, so an
 *  allocation on the Accounts tab flows straight through to the book heatmaps.
 *  Mirrors territory_lib.effective_owner(). */
function effectiveOwner(r) {
  return (r.proposal_status === "accepted" || r.proposal_status === "manual")
    ? (r.proposed_owner || r.owner || "") : (r.owner || "");
}
function repSegment(name) { return (state.repByName[name] || {}).segment || ""; }


// ---------------------------------------------------------------- rendering

/** The flags worth showing: activity-derived ones drop out when no activity is
 *  loaded, so they can't report an unanswerable question as a finding. */
function activeFlags() {
  return hasActivityData() ? FLAGS : FLAGS.filter((f) => !f.needsActivity);
}

function flagPills(r) {
  return activeFlags().filter((f) => f.test(r))
    .map((f) => `<span class="flag-pill ${f.cls}">${esc(f.label)}</span>`).join(" ");
}


/** The Overview is one book-strength table per segment (two
 *  Kolmogorov-Smirnov distances + Activity per rep, coloured by column)
 *  followed by the "needs attention" flag cards. */
function renderOverview() {
  const { sizes } = segmentRanks();
  const parts = [
    `<p class="eval-diag-sub" id="matrices-note">` +
    "Kolmogorov-Smirnov distance against segment peers: 0 even, + stronger, − weaker. " +
    "Top N compares each rep's best N accounts; all accounts compares whole books. " +
    "Activity is the share of accounts touched in the window. Grey = could be chance.</p>",
  ];

  // Only segments that actually have reps; pick a valid selection ("all" shows
  // every segment, the default).
  const segs = state.segments.filter((seg) =>
    state.reps.some((r) => r.segment === seg.key));
  let selKey = state.overviewSegment;
  if (selKey !== "all" && !segs.some((s) => s.key === selKey)) selKey = "all";
  state.overviewSegment = selKey;

  if (segs.length > 1) {
    const pill = (key, label, sub) =>
      `<button class="seg-pill ${key === selKey ? "active" : ""}" data-seg="${esc(key)}">` +
      `${esc(label)}${sub ? `<span class="seg-pill-sub">${sub}</span>` : ""}</button>`;
    parts.push(
      `<div class="seg-filter" role="tablist">` +
      pill("all", "All segments", "") +
      segs.map((s) => pill(s.key, s.label, fmt(sizes[s.key] || 0))).join("") +
      `</div>`);
  }

  const windowDays = fmt(state.plan.activity?.window_days || 90);
  // Activity is ENTIRELY activity-derived. With no events loaded it would
  // read 0% for every rep, indistinguishable from a team working nothing, so
  // the column is dropped and a note says why.
  const hasAct = hasActivityData();
  const signed = (v) => (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v).toFixed(2);
  const ksMetric = (mode, n) => ({
    key: mode === "top" ? "ks_top" : "ks_all",
    label: mode === "top" ? `Kolmogorov-Smirnov distance, top ${fmt(n)}`
      : "Kolmogorov-Smirnov distance, all accounts",
    better: "diverging", fmt: signed, cls: "ks-cell", ksMode: mode,
    help: mode === "top"
      ? `The rep's best ${fmt(n)} accounts against each peer's best ${fmt(n)}. ` +
        `Missing accounts count as 0, so a thin book reads weaker. Under 0.1 is even, ` +
        `over 0.25 a real gap. Click for the ranked accounts.`
      : `The rep's whole book against their peers' books. Ignores book size. ` +
        `Click for the ranked accounts.`,
    value: (book, grp) => {
      const k = ksForRep(book, grp, mode === "top" ? n : null);
      return k.n_peers ? { v: k.ks, muted: k.p >= KS_SIGNIFICANCE } : null;
    },
  });
  // Activity: the share of accounts with a meeting, call or email in the
  // window. Read on the rep's top N by score (the accounts that matter most)
  // and on their whole in-segment book.
  const activityMetric = (mode, n) => ({
    key: mode === "top" ? "act_top" : "act_all",
    label: mode === "top" ? `Activity, top ${fmt(n)}` : "Activity, all accounts",
    better: "high", fmt: (v) => `${fmt(v, 0)}%`,
    help: (mode === "top" ? `Share of the rep's top ${fmt(n)} accounts` : "Share of the rep's accounts") +
      ` with a meeting, call, email or Slack post in the last ${windowDays} days.`,
    value: (book) => {
      const slice = mode === "top"
        ? [...book].sort((a, b) => num(b.score) - num(a.score)).slice(0, n) : book;
      return slice.length ? { v: workedPctOf(slice) } : null;
    },
  });

  // One table per segment: a rep is only ever compared with their own
  // segment's peers, so the rows never share a scale across segments.
  const shown = selKey === "all" ? segs : segs.filter((s) => s.key === selKey);
  for (const seg of shown) {
    const grp = {
      key: seg.key, label: seg.label, size: sizes[seg.key] || 0,
      books: state.reps.filter((r) => r.segment === seg.key).map((rep) => ({
        rep, book: inSegmentBook(rep.name, seg.key),
      })),
    };
    const n = state.ksTopN[seg.key] || KS_TOP_N_FALLBACK;
    parts.push(
      `<h3 class="terr-h3">${esc(seg.label)} <span class="terr-sub">` +
      `${fmt(grp.books.length)} reps · ranked within ${fmt(grp.size)} accounts</span></h3>`);
    parts.push(renderMatrix(grp, [
      ksMetric("top", n), ...(hasAct ? [activityMetric("top", n)] : []),
      ksMetric("all", n), ...(hasAct ? [activityMetric("all", n)] : []),
    ], state.overviewSort.strength));
  }
  if (!hasAct && shown.length) {
    parts.push(
      `<div class="terr-note">No activity loaded, so Activity is hidden.</div>`);
  }
  $("#overview-segments").innerHTML = parts.join("");
  $$("#overview-segments .seg-pill").forEach((btn) => {
    btn.onclick = () => { state.overviewSegment = btn.dataset.seg; renderOverview(); };
  });
  $$("#overview-segments th.sortable").forEach((th) => {
    th.onclick = () => {
      const k = th.dataset.key;
      const cur = state.overviewSort.strength;   // shared by every segment's table
      if (cur.key === k) cur.dir = -cur.dir;     // toggle direction
      else state.overviewSort.strength = { key: k, dir: k === "rep" ? 1 : -1 };
      renderOverview();
    };
  });
  $$("#overview-segments td.ks-cell[data-rep]").forEach((td) => {
    td.onclick = (e) => {
      e.stopPropagation();   // the row click would jump to the Accounts tab
      showRepRanking(td.dataset.rep, td.dataset.seg, td.dataset.mode);
    };
  });
  $$("#overview-segments tr.rep-row").forEach((tr) => {
    tr.onclick = () => {
      state.repFilter = tr.dataset.rep; state.filters = new Set();
      state.segmentFilter = ""; state.page = 0;
      switchTab("accounts");
    };
  });

  $("#highlight-cards").innerHTML = activeFlags().map((f) => {
    const n = state.rows.filter(f.test).length;
    return `<button class="highlight-card ${n ? "" : "empty"}" data-flag="${f.key}" title="${esc(f.help)}">
      <span class="hc-count">${fmt(n)}</span>
      <span class="hc-label">${esc(f.label)}</span>
      <span class="hc-help">${esc(f.help)}</span>
    </button>`;
  }).join("");

  $$("#highlight-cards .highlight-card").forEach((el) => {
    el.onclick = () => {
      state.filters = new Set([el.dataset.flag]);
      state.repFilter = ""; state.segmentFilter = ""; state.page = 0;
      switchTab("accounts");
    };
  });
}

const WHITESPACE_CATS = new Set(["whitespace", "whitespace_subsidiary"]);

/** Rank every real (non-whitespace) account within its segment by ICP score,
 *  1 = best. Book strength is then "how many top-ranked accounts do you hold",
 *  which is far more legible than a summed score with no units. */
function segmentRanks() {
  const bySeg = {};
  for (const r of state.rows) {
    if (WHITESPACE_CATS.has(r.account_category)) continue;
    (bySeg[r.account_segment] ||= []).push(r);
  }
  const ranks = {}, sizes = {};
  for (const seg of Object.keys(bySeg)) {
    bySeg[seg].sort((a, b) =>
      num(b.score) - num(a.score) || String(a.org_id).localeCompare(String(b.org_id)));
    bySeg[seg].forEach((r, i) => { ranks[r.org_id] = i + 1; });
    sizes[seg] = bySeg[seg].length;
  }
  return { ranks, sizes };
}

/** A rep's territory within ONE segment: the accounts they own that belong to
 *  that segment, strongest first. Ranking must stay inside a single segment —
 *  a rep's book mixes segment sizes (a big-name account below the line still
 *  sits in Commercial), and averaging ranks drawn from two universes is
 *  meaningless (a Commercial rank of 2 is not comparable to an Enterprise 2). */
function inSegmentBook(repName, segKey) {
  // Group by EFFECTIVE owner so allocations made on the Accounts tab show up
  // here immediately.
  return state.rows
    .filter((r) => effectiveOwner(r) === repName && r.account_segment === segKey &&
      !WHITESPACE_CATS.has(r.account_category))
    .sort((a, b) => num(b.score) - num(a.score));
}

/** Conditional-formatting background for a value relative to the other values IN
 *  ITS COLUMN — a translucent green whose opacity scales with strength, matching
 *  gtm.sumble.com/account-scores (`rgba(0,166,62, 0.05 + 0.4*t)`). Strongest cell
 *  is the deepest green, weakest is nearly clear, so a weak territory reads as a
 *  pale cell. `better` says which end is strong. A column with fewer than two
 *  distinct values can't be compared, so it stays unshaded. Returns a `style="…"`
 *  attribute string (or ""). */
function heatStyleAttr(val, min, max, better) {
  if (val == null || max === min) return "";
  let t = (val - min) / (max - min);       // 0 at min, 1 at max
  if (better === "low") t = 1 - t;         // now t = 1 is strongest
  const alpha = (0.05 + 0.4 * t).toFixed(3);
  return ` style="background: rgba(0, 166, 62, ${alpha})"`;
}

// ------------------------------------------------------------ KS distance

// Mirrors territory_lib.KS_SIGNIFICANCE.
const KS_SIGNIFICANCE = 0.05;

/** Asymptotic two-sample KS p-value. Mirrors territory_lib.ks_pvalue(). */
function ksPValue(d, n, m) {
  if (n <= 0 || m <= 0 || d <= 0) return 1;
  const ne = (n * m) / (n + m);
  const lam = (Math.sqrt(ne) + 0.12 + 0.11 / Math.sqrt(ne)) * d;
  let total = 0;
  for (let k = 1; k <= 100; k++) {
    const term = 2 * (k % 2 ? 1 : -1) * Math.exp(-2 * k * k * lam * lam);
    total += term;
    if (Math.abs(term) < 1e-10) break;
  }
  return Math.max(0, Math.min(1, total));
}

/** Signed KS distance between two score lists. Positive = `book` sits higher
 *  on score than `peers`. Also returns the score where the gap is widest, so
 *  the drill-down chart can mark it. Mirrors territory_lib.ks_signed(). */
function ksSigned(book, peers) {
  if (!book.length || !peers.length) return { ks: 0, p: 1, at: null };
  const a = [...book].sort((x, y) => x - y);
  const b = [...peers].sort((x, y) => x - y);
  const xs = [...new Set([...a, ...b])].sort((x, y) => x - y);
  let i = 0, j = 0, best = 0, bestAbs = 0, at = null;
  for (const x of xs) {
    while (i < a.length && a[i] <= x) i++;
    while (j < b.length && b[j] <= x) j++;
    const gap = j / b.length - i / a.length;
    if (Math.abs(gap) > bestAbs + 1e-12) { best = gap; bestAbs = Math.abs(gap); at = x; }
  }
  return { ks: Math.round(best * 1e4) / 1e4, p: ksPValue(bestAbs, a.length, b.length), at };
}

/** Default top N per segment key; mirrors territory_lib.KS_TOP_N_DEFAULTS. */
const KS_TOP_N_DEFAULTS = { enterprise: 50, commercial: 150 };
const KS_TOP_N_FALLBACK = 50;

/** The plan's top N for a segment: its own ks_top_n, else the per-key default,
 *  else its default_capacity, else the fallback. Mirrors ks_top_n_for(). */
function planTopN(seg) {
  return num(seg.ks_top_n) || KS_TOP_N_DEFAULTS[seg.key] ||
    num(seg.default_capacity) || KS_TOP_N_FALLBACK;
}

/** A rep's best `n` scores, strongest first, padded with empty slots scoring 0
 *  when the book is shorter than `n`. Mirrors territory_lib.top_n_scores(). */
function topNScores(scores, n) {
  const best = [...scores].sort((a, b) => b - a).slice(0, n);
  return best.concat(Array(Math.max(0, n - best.length)).fill(0));
}

/** One rep's reading inside a segment group: their best N accounts against
 *  each peer's best N, pooled. Peers are the OTHER reps in the segment who
 *  count toward balance; a player-coach gets a reading but never sets the
 *  norm. Mirrors territory_lib.ks_by_segment(). */
function ksForRep(book, grp, n) {
  const me = grp.books.find((b) => b.book === book);
  const repName = me ? me.rep.name : "";
  // n = null compares whole books; a number compares each rep's top n.
  const pick = (scores) => (n ? topNScores(scores, n) : scores);
  const peers = grp.books
    .filter((b) => b.rep.name !== repName && b.rep.in_balance !== false)
    .flatMap((b) => pick(b.book.map((r) => num(r.score))));
  const mine = pick(book.map((r) => num(r.score)));
  const res = ksSigned(mine, peers);
  return { ...res, rep: repName, n: book.length, top_n: n || null, n_peers: peers.length, mine, peers };
}

/** Diverging shade for a signed value: green when the book is stronger than
 *  its peers, amber when weaker, deeper the further from 0. */
function divergingStyleAttr(val, maxAbs) {
  if (val == null || !maxAbs) return "";
  const t = Math.min(1, Math.abs(val) / maxAbs);
  const alpha = (0.05 + 0.4 * t).toFixed(3);
  return val >= 0
    ? ` style="background: rgba(0, 166, 62, ${alpha})"`
    : ` style="background: rgba(217, 119, 6, ${alpha})"`;
}

/** The KS drill-down: the rep's in-segment accounts ranked, with a chart of
 *  their score distribution against their peers' so the gap is visible. */
function showRepRanking(repName, segKey, mode = "top") {
  const { ranks, sizes } = segmentRanks();
  const book = inSegmentBook(repName, segKey);
  const grp = {
    key: segKey,
    books: state.reps.filter((r) => r.segment === segKey)
      .map((rep) => ({ rep, book: rep.name === repName ? book : inSegmentBook(rep.name, segKey) })),
  };
  const topN = state.ksTopN[segKey] || KS_TOP_N_FALLBACK;
  const kTop = ksForRep(book, grp, topN);
  const kAll = ksForRep(book, grp, null);
  const k = mode === "all" ? kAll : kTop;   // the column clicked drives the chart
  // The chart works on in-segment rank (1 = best). Same order as score, so the
  // gap it draws is the distance in the table. A top-N slot the rep can't fill
  // gets rank Infinity: it never counts as being in the segment's top x.
  const rankList = (bk) => {
    const best = [...bk].sort((a, c) => num(c.score) - num(a.score));
    const sel = mode === "all" ? best : best.slice(0, topN);
    const rs = sel.map((r) => ranks[r.org_id] || Infinity);
    if (mode === "all") return rs;
    return rs.concat(Array(Math.max(0, topN - rs.length)).fill(Infinity));
  };
  const mineR = rankList(book);
  const peerR = grp.books
    .filter((b) => b.rep.name !== repName && b.rep.in_balance !== false)
    .flatMap((b) => rankList(b.book));
  const segLabel = state.segLabel[segKey] || segKey;
  const signed = (x) => (x.ks > 0 ? "+" : x.ks < 0 ? "−" : "") + Math.abs(x.ks).toFixed(2);
  const pv = (x) => (x.p < 0.001 ? "p < 0.001" : `p = ${x.p.toFixed(3)}`);
  const what = mode === "all" ? "Their mix of accounts" : `Their top ${fmt(topN)}`;
  const verdict = !k.n_peers ? "No peers in this segment to compare against."
    : k.p >= KS_SIGNIFICANCE
      ? `${what}: not clearly different from their peers' — a gap this size could be chance.`
      : k.ks > 0 ? `${what}: stronger than their peers'.`
        : `${what}: weaker than their peers'.`;

  $("#detail-name").textContent = repName;
  $("#detail-meta").innerHTML =
    `${esc(segLabel)} · ${fmt(book.length)} accounts<br>Kolmogorov-Smirnov distance: ` +
    `top ${fmt(topN)} <strong>${signed(kTop)}</strong> (${pv(kTop)}) · ` +
    `all accounts <strong>${signed(kAll)}</strong> (${pv(kAll)})` +
    (book.length < topN ? `<br>${fmt(topN - book.length)} empty slots in their top ${fmt(topN)} count as score 0` : "");

  const activity = hasActivityData();
  const cut = topN < book.length
    ? `<tr class="ks-cut"><td colspan="5">Past their top ${fmt(topN)}: not in the top-${fmt(topN)} distance</td></tr>` : "";
  const rowsHtml = book.map((r, idx) => (idx === topN ? cut : "") +
    `<tr class="ks-acct${idx >= topN ? " ks-past" : ""}" data-id="${esc(r.org_id)}">
      <td class="num">${idx + 1}</td>
      <td>${esc(r.name)}<span class="cell-sub">${esc(r.domain)}</span></td>
      <td class="num">${ranks[r.org_id] ? fmt(ranks[r.org_id]) : "—"}</td>
      <td class="num">${fmt(r.score, 1)}</td>
      ${activity ? `<td class="num">${num(r.worked) ? "✓" : `<span class="zero">—</span>`}</td>` : ""}
    </tr>`).join("");

  $("#detail-body").innerHTML = `
    <div class="detail-section">
      <p>${esc(verdict)}</p>
      ${k.n_peers ? ksChartHtml(mineR, peerR, k.top_n) : ""}
    </div>
    <div class="detail-section">
      <h3>Accounts, strongest first</h3>
      <p class="eval-diag-sub">Rank out of ${fmt(sizes[segKey] || 0)} (1 = best).</p>
      <table class="detail-table ks-rank-table"><thead><tr>
        <th class="num">#</th><th>Account</th><th class="num">Seg rank</th>
        <th class="num">Score</th>${activity ? `<th class="num">Worked</th>` : ""}
      </tr></thead><tbody>${rowsHtml ||
        `<tr><td colspan="5" class="empty-state">No accounts in this segment.</td></tr>`}</tbody></table>
      <p><a href="#" id="ks-open-accounts">Open in the Accounts tab →</a></p>
    </div>`;
  $$("#detail-body tr.ks-acct").forEach((tr) => { tr.onclick = () => showDetail(tr.dataset.id); });
  $("#ks-open-accounts").onclick = (e) => {
    e.preventDefault();
    state.repFilter = repName; state.segmentFilter = segKey;
    state.filters = new Set(); state.page = 0;
    $("#detail-panel").classList.add("hidden");
    switchTab("accounts");
  };
  if (k.n_peers) wireKsChart(mineR, peerR);
  $("#detail-panel").classList.remove("hidden");
}

/** Share of `sortedRanks` at rank `x` or better (1 = best). */
function shareWithin(sortedRanks, x) {
  let lo = 0, hi = sortedRanks.length;           // first index with rank > x
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sortedRanks[mid] <= x) lo = mid + 1; else hi = mid;
  }
  return lo / sortedRanks.length;
}

const KS_CHART = { w: 360, h: 210, l: 38, r: 10, t: 12, b: 34 };

/** x range: rank 1 to the worst real rank on either side. */
function ksRankRange(mine, peers) {
  const real = [...mine, ...peers].filter(Number.isFinite);
  return [1, real.length ? Math.max(...real) : 1];
}

/** Where the two cumulative lines are furthest apart, and how far. */
function rankGap(ms, ps) {
  let best = { x: 1, d: 0 };
  for (const x of new Set([...ms, ...ps].filter(Number.isFinite))) {
    const d = shareWithin(ms, x) - shareWithin(ps, x);
    if (Math.abs(d) > Math.abs(best.d)) best = { x, d };
  }
  return best;
}

/** Two step lines: for each rank x, the share of this rep's accounts (and of
 *  their peers', pooled) in the segment's top x. The widest vertical gap is
 *  the Kolmogorov-Smirnov distance, marked with a dashed rule. */
function ksChartHtml(mine, peers, topN) {
  const { w, h, l, r, t, b } = KS_CHART;
  const [lo, hi] = ksRankRange(mine, peers);
  const span = hi - lo || 1;
  const X = (v) => l + ((v - lo) / span) * (w - l - r);
  const Y = (p) => t + (1 - p) * (h - t - b);
  const ms = [...mine].sort((a, c) => a - c);
  const ps = [...peers].sort((a, c) => a - c);
  const steps = (s) => {
    let d = `M${X(lo).toFixed(1)},${Y(0).toFixed(1)}`;
    for (const x of new Set(s.filter(Number.isFinite))) {
      d += ` H${X(x).toFixed(1)} V${Y(shareWithin(s, x)).toFixed(1)}`;
    }
    return d + ` H${X(hi).toFixed(1)}`;
  };
  const gap = rankGap(ms, ps);
  const gx = gap.x;
  const yRep = shareWithin(ms, gx), yPeer = shareWithin(ps, gx);
  const ticks = [0, 0.5, 1].map((p) =>
    `<line x1="${l}" x2="${w - r}" y1="${Y(p)}" y2="${Y(p)}" class="ks-grid"/>` +
    `<text x="${l - 6}" y="${Y(p) + 4}" class="ks-axis" text-anchor="end">${p * 100}%</text>`).join("");
  const xt = [lo, Math.round((lo + hi) / 2), hi].map((v) =>
    `<text x="${X(v)}" y="${h - b + 16}" class="ks-axis" text-anchor="middle">${fmt(v, 0)}</text>`).join("");
  const labelY = (y, other) => Y(y) + (y >= other ? -6 : 14);
  return `
    <div class="ks-legend">
      <span><i class="ks-swatch ks-swatch-rep"></i>This rep</span>
      <span><i class="ks-swatch ks-swatch-peer"></i>Peers (pooled)</span>
    </div>
    <div class="ks-chart-wrap">
      <svg id="ks-chart" viewBox="0 0 ${w} ${h}" role="img"
        aria-label="Share of accounts in the segment's top x, this rep against peers">
        ${ticks}${xt}
        <text x="${(l + w - r) / 2}" y="${h - 4}" class="ks-axis"
          text-anchor="middle">Segment rank (1 = best)</text>
        <line x1="${X(gx)}" x2="${X(gx)}" y1="${Y(yRep)}" y2="${Y(yPeer)}" class="ks-gap"/>
        <path d="${steps(ps)}" class="ks-line ks-line-peer"/>
        <path d="${steps(ms)}" class="ks-line ks-line-rep"/>
        <text x="${X(gx) + 5}" y="${labelY(yRep, yPeer)}" class="ks-label">This rep ${fmt(yRep * 100)}%</text>
        <text x="${X(gx) + 5}" y="${labelY(yPeer, yRep)}" class="ks-label">Peers ${fmt(yPeer * 100)}%</text>
        <line id="ks-cross" class="ks-cross" y1="${t}" y2="${h - b}" x1="-10" x2="-10"/>
        <rect id="ks-hit" x="${l}" y="${t}" width="${w - l - r}" height="${h - t - b}" fill="transparent"/>
      </svg>
      <div id="ks-tip" class="ks-tip hidden"></div>
    </div>
    <p class="eval-diag-sub">Share of each side in the segment's top x${topN
      ? `; empty slots in a top ${fmt(topN)} never count` : ""}. The dashed line
      is the widest gap: the distance.</p>`;
}

/** Crosshair + tooltip: at the hovered rank, the share of each side in the
 *  segment's top x. */
function wireKsChart(mine, peers) {
  const svg = $("#ks-chart"), hit = $("#ks-hit"), tip = $("#ks-tip"), cross = $("#ks-cross");
  if (!svg || !hit) return;
  const { w, l, r } = KS_CHART;
  const [lo, hi] = ksRankRange(mine, peers);
  const span = hi - lo || 1;
  const ms = [...mine].sort((a, c) => a - c);
  const ps = [...peers].sort((a, c) => a - c);
  hit.onmousemove = (e) => {
    const box = svg.getBoundingClientRect();
    const sx = ((e.clientX - box.left) / box.width) * w;
    const x = Math.max(lo, Math.round(lo + ((sx - l) / (w - l - r)) * span));
    cross.setAttribute("x1", sx); cross.setAttribute("x2", sx);
    tip.innerHTML = `Top <strong>${fmt(x)}</strong><br>` +
      `This rep ${fmt(shareWithin(ms, x) * 100)}% · Peers ${fmt(shareWithin(ps, x) * 100)}%`;
    tip.style.left = `${e.clientX - box.left + 10}px`;
    tip.style.top = `${e.clientY - box.top - 10}px`;
    tip.classList.remove("hidden");
  };
  hit.onmouseleave = () => {
    tip.classList.add("hidden");
    cross.setAttribute("x1", -10); cross.setAttribute("x2", -10);
  };
}

function workedPctOf(slice) {
  if (!slice.length) return null;
  return (100 * slice.filter((r) => num(r.worked)).length) / slice.length;
}

/** One segment's Overview table. `metrics` are the heat columns after Rep and
 *  In-seg: each has `value(book, grp)` → `{v, muted?}` or null, a `fmt`, the
 *  direction that is good (`better`: "high" or "diverging"), and an optional
 *  `ksMode` that makes the cell open the rep's ranking. Colours run per column
 *  within this segment only. `sort` is `{key, dir}`, shared across segments. */
function renderMatrix(grp, metrics, sort) {
  const rows = grp.books.map(({ rep, book }) => {
    const vals = {};
    for (const m of metrics) vals[m.key] = m.value(book, grp);
    return { rep, book, vals };
  });

  const columns = [
    { label: "Rep", key: "rep", text: true },
    { label: "In-seg", key: "inseg" },
    ...metrics,
  ];
  // A sort key can outlive its column (e.g. Activity with no activity
  // loaded); fall back to the first metric rather than sorting on nothing.
  if (!columns.some((c) => c.key === sort.key)) {
    sort.key = metrics[0]?.key || "rep";
    sort.dir = -1;
  }

  const bounds = {};
  for (const m of metrics) {
    const vs = rows.map((r) => r.vals[m.key]?.v).filter((v) => v != null);
    bounds[m.key] = vs.length ? { min: Math.min(...vs), max: Math.max(...vs) } : null;
  }

  // Sort (nulls always last).
  const sortVal = (row, key) => {
    if (key === "rep") return row.rep.name.toLowerCase();
    if (key === "inseg") return row.book.length;
    return row.vals[key]?.v ?? null;
  };
  rows.sort((a, b) => {
    const av = sortVal(a, sort.key), bv = sortVal(b, sort.key);
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    if (av < bv) return -sort.dir;
    if (av > bv) return sort.dir;
    return a.rep.name.localeCompare(b.rep.name);
  });

  const head = `<tr>${columns.map((c) => {
    const active = sort.key === c.key;
    const arrow = active ? (sort.dir === -1 ? " ▾" : " ▴") : "";
    // Intuition lives on an info icon, not a bare header title — more
    // discoverable, and it won't clash with the sort click.
    const info = c.help ? ` <span class="col-info" title="${esc(c.help)}">ⓘ</span>` : "";
    return `<th class="sortable ${c.text ? "" : "num"}${active ? " sorted" : ""}" ` +
      `data-key="${esc(c.key)}">${esc(c.label)}${arrow}${info}</th>`;
  }).join("")}</tr>`;

  const body = rows.map(({ rep, book, vals }) => {
    const cells = columns.map((c) => {
      if (c.key === "rep") return `<td>${esc(rep.name)}</td>`;
      if (c.key === "inseg") return `<td class="num">${fmt(book.length)}</td>`;
      const cell = vals[c.key];
      if (!cell || cell.v == null) return `<td class="num matrix-empty ${c.cls || ""}">—</td>`;
      const v = cell.v, b = bounds[c.key];
      // A diverging column is shaded by distance from 0 in either direction;
      // a reading that could be chance is left unshaded and greyed.
      const bg = cell.muted ? "" : c.better === "diverging"
        ? divergingStyleAttr(v, Math.max(Math.abs(b.min), Math.abs(b.max)))
        : heatStyleAttr(v, b.min, b.max, c.better);
      const extra = cell.muted ? " ks-muted" : "";
      const data = c.ksMode
        ? ` data-rep="${esc(rep.name)}" data-seg="${esc(grp.key)}" data-mode="${c.ksMode}"` : "";
      const tip = cell.muted ? ` title="Could be chance: p ≥ ${KS_SIGNIFICANCE}"` : "";
      return `<td class="num ${c.cls || ""}${extra}"${bg}${data}${tip}>${c.fmt(v)}</td>`;
    }).join("");
    return `<tr class="rep-row" data-rep="${esc(rep.name)}">${cells}</tr>`;
  }).join("");

  return `<div class="table-wrap"><table class="matrix-table">
    <thead>${head}</thead><tbody>${body}</tbody></table></div>`;
}

function filteredRows() {
  const q = state.search.trim().toLowerCase();
  return state.rows.filter((r) => {
    if (state.filters.size) {
      const preds = [...state.filters].map((key) =>
        FLAGS.find((f) => f.key === key)?.test || (() => false));
      if (!preds.some((p) => p(r))) return false;
    }
    if (state.repFilter && r.owner !== state.repFilter && r.proposed_owner !== state.repFilter) return false;
    if (state.segmentFilter && r.account_segment !== state.segmentFilter) return false;
    if (q) {
      const hay = `${r.name} ${r.domain} ${r.owner} ${r.proposed_owner}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  }).sort((a, b) => {
    const k = state.sort.key;
    let av, bv;
    if (k === "name" || k === "owner") { av = String(a[k] || ""); bv = String(b[k] || ""); }
    else if (k === "rank") { av = accountRank(a) ?? Infinity; bv = accountRank(b) ?? Infinity; }
    else { av = num(a[k]); bv = num(b[k]); }
    if (av < bv) return -state.sort.dir;
    if (av > bv) return state.sort.dir;
    return String(a.org_id).localeCompare(String(b.org_id));
  });
}

/** The "Assign to" cell — ONE owner dropdown per row does everything: allocate
 *  to anyone, or take the balancer's suggestion. When a move is suggested, that
 *  owner sits at the top of the menu marked "suggested" (picking it = accept),
 *  the closed control is tinted, and a tiny "dismiss" link rejects it. No
 *  separate accept/reject buttons. Sentinel value `__accept__` = take the
 *  suggestion (preserves its reason); any rep name = a manual move. */
function assignCell(r) {
  const eff = effectiveOwner(r);
  const st = r.proposal_status || "";
  const suggesting = st === "suggested" && r.proposed_owner;

  const repOptions = state.reps.map((rep) => {
    const seg = state.segLabel[rep.segment] || rep.segment;
    return `<option value="${esc(rep.name)}" ${rep.name === eff ? "selected" : ""}>` +
      `${esc(rep.name)} · ${esc(seg)}</option>`;
  }).join("");

  const head = suggesting
    ? `<option value="__accept__">✨ ${esc(r.proposed_owner)} — suggested</option>` +
      `<option disabled>──────────</option>`
    : "";
  const options = head +
    `<option value="" ${!eff ? "selected" : ""}>— unassigned —</option>` + repOptions;

  const cls = "assign-select terr-select" +
    (suggesting ? " has-suggestion" : (isApproved(r) ? " changed" : ""));
  const select = `<select class="${cls}" data-id="${esc(r.org_id)}">${options}</select>`;

  // One tiny inline affordance, contextual to state — never more than a link.
  let note = "";
  if (suggesting) {
    note = `<a class="decide-btn undo-link" data-id="${esc(r.org_id)}"
      data-status="rejected" title="Dismiss this suggestion (won't be re-proposed)">dismiss</a>`;
  } else if (st === "accepted") {
    note = `<a class="decide-btn undo-link" data-id="${esc(r.org_id)}"
      data-status="" title="Revert to the balancer's suggestion">undo</a>`;
  } else if (st === "manual") {
    note = `<a class="decide-btn undo-link" data-id="${esc(r.org_id)}"
      data-status="manual" title="Clear this allocation">undo</a>`;
  } else if (st === "rejected") {
    note = `<span class="cell-sub">dismissed · <a class="decide-btn undo-link"
      data-id="${esc(r.org_id)}" data-status="">undo</a></span>`;
  }
  return `<div class="assign-wrap">${select}${note}</div>`;
}

function renderAccounts() {
  // One single-select row: Unallocated (the default), Idle, All.
  const chip = (key, label, n, help) =>
    `<button class="cat-chip ${(key ? state.filters.has(key) : !state.filters.size) ? "active" : ""}"
      data-flag="${key}" title="${esc(help)}">${esc(label)}
      <span class="cat-count">${fmt(n)}</span></button>`;
  $("#account-filters").innerHTML = `<div class="filter-row">` +
    activeFlags().map((f) => chip(f.key, f.label, state.rows.filter(f.test).length, f.help)).join("") +
    chip("", "All", state.rows.length, "Every account.") + `</div>`;
  $$("#account-filters [data-flag]").forEach((el) => {
    el.onclick = () => {
      state.filters = el.dataset.flag ? new Set([el.dataset.flag]) : new Set();
      state.page = 0;
      render();
    };
  });

  const cols = [
    { key: "rank", label: "Rank", num: true },
    { key: "name", label: "Account" },
    { key: "account_segment", label: "Segment" },
    { key: "size_metric", label: sizeLabel(), num: true },
    { key: "score", label: "Score", num: true },
    { key: "owner", label: "Current owner" },
    { key: "activity", label: "Activity", num: true },
    { key: "flags", label: "Flags" },
    { key: "assign", label: "Assign to" },
  ];
  $("#accounts-table thead").innerHTML = `<tr>${cols.map((c) =>
    `<th class="${c.num ? "num" : ""} ${["flags", "assign", "activity"].includes(c.key) ? "" : "sortable"}"
        data-key="${c.key}">${esc(c.label)}${state.sort.key === c.key
        ? (state.sort.dir === -1 ? " ▾" : " ▴") : ""}</th>`).join("")}</tr>`;
  $$("#accounts-table th.sortable").forEach((th) => {
    th.onclick = () => {
      const k = th.dataset.key;
      state.sort = state.sort.key === k
        ? { key: k, dir: -state.sort.dir }
        : { key: k, dir: (k === "name" || k === "owner" || k === "rank") ? 1 : -1 };
      render();
    };
  });

  const rows = filteredRows();
  const pages = Math.max(1, Math.ceil(rows.length / state.pageSize));
  state.page = Math.min(state.page, pages - 1);
  const slice = rows.slice(state.page * state.pageSize, (state.page + 1) * state.pageSize);

  $("#accounts-table tbody").innerHTML = slice.map((r) => {
    const acts = num(r.meetings) + num(r.calls) + num(r.emails_out) + num(r.messages);
    return `<tr data-id="${esc(r.org_id)}">
      <td class="num">${accountRank(r) ? fmt(accountRank(r)) : "—"}</td>
      <td>${r.sumble_url
        ? `<a href="${esc(r.sumble_url)}" target="_blank" rel="noopener">${esc(r.name)}</a>`
        : esc(r.name)}<span class="cell-sub">${esc(r.domain)}</span></td>
      <td>${esc(state.segLabel[r.account_segment] || r.account_segment || "—")}</td>
      <td class="num">${fmt(r.size_metric)}</td>
      <td class="num">${fmt(r.score, 1)}</td>
      <td>${esc(r.owner || "—")}${num(r.double_allocated)
        ? `<span class="cell-sub">also: ${esc(r.other_owners)}</span>` : ""}${!r.owner && r.held_by
        ? `<span class="cell-sub">held by ${esc(r.held_by.split("|").join(", "))}</span>` : ""}</td>
      <td class="num" title="${num(r.meetings)} meetings · ${num(r.calls)} calls · ${num(r.emails_out)} emails out · ${num(r.messages)} Slack messages">
        ${acts ? fmt(acts) : `<span class="zero">0</span>`}</td>
      <td>${flagPills(r)}</td>
      <td class="assign-cell">${assignCell(r)}</td>
    </tr>`;
  }).join("");
  $$("#accounts-table tbody tr").forEach((tr) => {
    tr.onclick = () => showDetail(tr.dataset.id);
  });
  // The assign dropdown and accept/reject live in the last column; stop the
  // click bubbling up to the row (which would open the detail panel).
  $$("#accounts-table .assign-select").forEach((sel) => {
    sel.onclick = (e) => e.stopPropagation();
    sel.onchange = (e) => {
      e.stopPropagation();
      if (sel.value === "__accept__") decide(sel.dataset.id, "accepted");
      else decide(sel.dataset.id, "manual", sel.value);
    };
  });
  $$("#accounts-table .decide-btn").forEach((btn) => {
    btn.onclick = (e) => { e.stopPropagation(); decide(btn.dataset.id, btn.dataset.status); };
  });

  $("#page-info").textContent = rows.length
    ? `${fmt(state.page * state.pageSize + 1)}–${fmt(Math.min((state.page + 1) * state.pageSize, rows.length))} of ${fmt(rows.length)}`
    : "no matching accounts";
  $("#page-prev").disabled = state.page <= 0;
  $("#page-next").disabled = state.page >= pages - 1;
}

function sizeLabel() {
  return state.rows[0]?.size_metric_name || "Size";
}

function renderExport() {
  const approved = state.rows.filter(isApproved);
  const pending = state.rows.filter((r) => r.proposal_status === "suggested").length;
  $("#export-summary").innerHTML = `
    <p><strong>${fmt(approved.length)}</strong> approved change${approved.length === 1 ? "" : "s"} ready to export.
    ${pending ? `<strong>${fmt(pending)}</strong> proposal${pending === 1 ? " is" : "s are"} still undecided.` : ""}</p>
    <p class="eval-diag-sub">One row per owner change. Nothing is written to your CRM.</p>`;

  const cols = ["Account", "Segment", "From", "To", "Reason", "Score", ""];
  $("#export-table thead").innerHTML = `<tr>${cols.map((c) => `<th>${c}</th>`).join("")}</tr>`;
  $("#export-table tbody").innerHTML = approved.length ? approved.map((r) => `<tr>
      <td>${esc(r.name)}<span class="cell-sub">${esc(r.domain)}</span></td>
      <td>${esc(state.segLabel[r.account_segment] || r.account_segment)}</td>
      <td>${esc(r.owner || "(unassigned)")}</td>
      <td>${esc(r.proposed_owner)}</td>
      <td>${esc(REASON_LABELS[r.proposal_reason] || r.proposal_reason)}</td>
      <td class="num">${fmt(r.score, 1)}</td>
      <td class="num"><button class="dismiss-change btn-link" data-id="${esc(r.org_id)}"
        data-status="${esc(r.proposal_status)}"
        title="Drop this change from the export (reverts the account)">Dismiss</button></td>
    </tr>`).join("")
    : `<tr><td colspan="${cols.length}" class="empty-state">Nothing approved yet — accept a
        suggestion or assign an owner on the Accounts tab.</td></tr>`;

  $$("#export-table .dismiss-change").forEach((btn) => {
    btn.onclick = () => {
      // A manual assignment is cleared (blank owner); an accepted suggestion is
      // rejected so it won't be re-proposed. Either way it leaves the export.
      if (btn.dataset.status === "manual") decide(btn.dataset.id, "manual", "");
      else decide(btn.dataset.id, "rejected");
    };
  });
}

function showDetail(orgId) {
  const r = state.rows.find((x) => String(x.org_id) === String(orgId));
  if (!r) return;
  $("#detail-name").textContent = r.name;
  $("#detail-meta").innerHTML =
    `${esc(r.domain)} · ${esc(state.segLabel[r.account_segment] || "")} ·
     ${esc(sizeLabel())} ${fmt(r.size_metric)} · score ${fmt(r.score, 1)}
     ${r.sumble_url ? ` · <a href="${esc(r.sumble_url)}" target="_blank" rel="noopener">Sumble profile ↗</a>` : ""}`;

  const acts = [
    ["Meetings", r.meetings], ["Calls", r.calls],
    ["Emails out", r.emails_out], ["Emails in", r.emails_in],
    ["Slack messages", r.messages],
  ];
  const total = acts.reduce((a, [, v]) => a + num(v), 0);
  // Reassign from ANY account, not only rows the balancer proposed. Same
  // /api/decide "manual" path as the Moves tab; picking the blank entry (or
  // the current owner) clears the override. All active reps are offered — a
  // deliberate human move may cross segments; the balancer's lanes only
  // constrain the automatic suggestions.
  const ownerOptions = state.reps
    .map((rep) => {
      const seg = state.segLabel[rep.segment] || rep.segment;
      const sel = rep.name === (r.proposed_owner || "") ? "selected" : "";
      return `<option value="${esc(rep.name)}" ${sel}>${esc(rep.name)} (${esc(seg)})</option>`;
    })
    .join("");
  $("#detail-body").innerHTML = `
    <div class="detail-section">
      <h3>Owner</h3>
      <p>${esc(r.owner || "Nobody — this account is unallocated.")}
        ${num(r.double_allocated) ? `<br /><span class="flag-pill flag-bad">Also owned by ${esc(r.other_owners)}</span>` : ""}
        ${r.proposed_owner ? `<br />Proposed: <strong>${esc(r.proposed_owner)}</strong>
          (${esc(REASON_LABELS[r.proposal_reason] || r.proposal_reason)}, ${esc(r.proposal_status)})` : ""}</p>
      <p class="detail-reassign">
        <label for="detail-owner-select">Move to</label>
        <select id="detail-owner-select" class="terr-select">
          <option value="">${r.proposed_owner ? "(clear this move)" : `(keep ${esc(r.owner || "unassigned")})`}</option>
          ${ownerOptions}
        </select>
      </p>
      ${num(r.worked) ? `<p class="eval-diag-sub">⚠ Being worked: the balancer won't move it.</p>` : ""}
    </div>
    <div class="detail-section">
      <h3>Activity · last ${fmt(state.plan.activity?.window_days || 90)} days</h3>
      ${total ? `<table class="detail-table"><tbody>${acts.map(([k, v]) =>
        `<tr><td>${k}</td><td class="num">${fmt(v)}</td></tr>`).join("")}
        <tr><td>Last touch</td><td class="num">${esc(r.last_activity_date || "—")}</td></tr>
        <tr><td>Sources</td><td class="num">${esc((r.activity_sources || "").split("|").join(", ") || "—")}</td></tr>
        </tbody></table>`
        : `<p class="empty-state">No activity in the window.</p>`}
      <p class="eval-diag-sub">${state.plan.activity?.attribution === "anyone"
        ? "Anyone at the company." : "The owner only."}</p>
    </div>
    <div class="detail-section">
      <h3>Flags</h3>
      <p>${flagPills(r) || "<span class='eval-diag-sub'>None.</span>"}</p>
    </div>`;
  const sel = $("#detail-owner-select");
  if (sel) {
    sel.onchange = async () => {
      await decide(r.org_id, "manual", sel.value);
      showDetail(r.org_id); // re-render the panel with the new state
    };
  }
  $("#detail-panel").classList.remove("hidden");
}

// ---------------------------------------------------------------- actions

async function decide(orgId, status, proposedOwner) {
  const row = state.rows.find((r) => String(r.org_id) === String(orgId));
  if (!row) return;
  const body = { org_id: orgId, status };
  if (status === "manual") body.proposed_owner = proposedOwner || "";
  const res = await fetch("/api/decide", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    alert(`Could not save that decision: ${res.status} ${res.statusText}`);
    return;
  }
  const out = await res.json();
  Object.assign(row, out.row);
  render();
}

function switchTab(tab) {
  state.tab = tab;
  $$(".tab").forEach((t) => t.classList.toggle("active", t.dataset.tab === tab));
  $$(".view").forEach((v) => v.classList.toggle("hidden", v.id !== `view-${tab}`));
  $("#tab-description").textContent = PAGE_DESCRIPTIONS[tab] || "";
  render();
}

function render() {
  computeStrongSet();  // refresh the "strong" set for the attention flags
  if (state.tab === "overview") renderOverview();
  else if (state.tab === "accounts") renderAccounts();
  else if (state.tab === "export") renderExport();
}

/** Put the top-N inputs back to the plan's values and rebuild them. */
function resetKsTopN() {
  state.ksTopN = Object.fromEntries(state.segments.map((s) => [s.key, planTopN(s)]));
  const segs = state.segments.filter((s) => state.reps.some((r) => r.segment === s.key));
  $("#ks-topn-fields").innerHTML = segs.map((s) => `<label class="cal-field">
      <span>${esc(s.label)}</span>
      <input type="number" min="1" step="1" class="terr-input" data-seg="${esc(s.key)}"
             value="${state.ksTopN[s.key]}" />
    </label>`).join("");
  $$("#ks-topn-fields input").forEach((el) => {
    el.oninput = () => {
      const n = Math.floor(num(el.value));
      if (n >= 1) { state.ksTopN[el.dataset.seg] = n; render(); }
    };
  });
}

async function init() {
  const res = await fetch("/api/plan");
  const data = await res.json();
  state.plan = data.plan;
  state.rows = data.rows;
  state.segments = (data.plan.segments || []).slice().sort((a, b) => (a.order || 0) - (b.order || 0));
  state.segLabel = Object.fromEntries(state.segments.map((s) => [s.key, s.label]));
  state.reps = (data.plan.reps || []).filter((r) => r.is_rep);
  state.repByName = Object.fromEntries(state.reps.map((r) => [r.name, r]));
  state.strongCutoff = num(data.plan.strong_cutoff) || 500;
  resetKsTopN();

  const company = (data.plan.company || {}).name || "Territory";
  $("#customer-name").textContent = `${company} territory plan`;
  const owned = state.rows.filter((r) => r.owner).length;
  $("#row-summary").textContent =
    `${fmt(state.rows.length)} accounts · ${fmt(state.reps.length)} reps · ${fmt(owned)} allocated`;

  $("#rep-filter").innerHTML = `<option value="">All reps</option>` +
    state.reps.map((r) => `<option value="${esc(r.name)}">${esc(r.name)}</option>`).join("");
  $("#segment-filter").innerHTML = `<option value="">All segments</option>` +
    state.segments.map((s) => `<option value="${esc(s.key)}">${esc(s.label)}</option>`).join("");

  $$(".tab").forEach((t) => { t.onclick = () => switchTab(t.dataset.tab); });
  $("#calibrate-reset-fields").onclick = () => {
    // Put every field back to the plan's saved values: the segment cutoff
    // (rebuilt from the plan) and the top N.
    resetKsTopN();
    render();
  };
  // The strong-account cutoff is not editable in the app; it comes from the
  // plan's strong_cutoff.
  $("#search-input").oninput = (e) => { state.search = e.target.value; state.page = 0; render(); };
  $("#rep-filter").onchange = (e) => { state.repFilter = e.target.value; state.page = 0; render(); };
  $("#segment-filter").onchange = (e) => { state.segmentFilter = e.target.value; state.page = 0; render(); };
  $("#page-prev").onclick = () => { state.page = Math.max(0, state.page - 1); render(); };
  $("#page-next").onclick = () => { state.page += 1; render(); };
  $("#detail-close").onclick = () => $("#detail-panel").classList.add("hidden");
  const dl = (url) => { window.location.href = url; };
  $("#export-actions").onclick = () => dl("/api/export");
  $("#export-actions-2").onclick = () => dl("/api/export");
  $("#export-sheet").onclick = () => dl("/api/territory.csv");
  $("#export-sheet-2").onclick = () => dl("/api/territory.csv");
  document.addEventListener("keydown", (e) => {
    if (e.key === "/" && document.activeElement !== $("#search-input")) {
      if (state.tab !== "accounts") switchTab("accounts");
      e.preventDefault(); $("#search-input").focus();
    }
    if (e.key === "Escape") $("#detail-panel").classList.add("hidden");
  });

  switchTab("overview");
}

init();
