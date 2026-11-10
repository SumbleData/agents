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
  repView: null,          // {name, segKey} while one rep's book is open
  repMode: "idle",        // rep view filter: "idle" (default), "customers" or "all"
  components: [],         // optional score-component columns ("component:<name>")
  changesFilter: "all",   // Changes tab: all | approved | suggested | dismissed
  log: [],                // every decision made in the app, oldest first
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
  owners: {},             // CRM owner name -> accounts their name is on
  draft: null,            // the Segments + Team panel's unsaved edits
};

const PAGE_DESCRIPTIONS = {
  overview: "Each rep's book against their segment peers. Click a rep for their chart and accounts, or a distance for the ranked list.",
  changes: "Every proposed owner change, and a log of each decision. Export the approved ones for your CRM.",
};

// Flags read the EFFECTIVE owner (current + your allocations), so they update
// the moment you move an account.
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
    "Top N is the segment's target accounts per rep; all accounts compares whole books. " +
    "Activity is the share of accounts touched in the window. Grey = could be chance.</p>",
  ];

  // Every segment, including one with no reps yet: its accounts still need
  // owners. Pick a valid selection ("all" shows every segment, the default).
  const segs = state.segments;
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
      // An empty book (a new hire) has nothing to compare: blank, not -1.
      if (!book.length) return null;
      const k = ksForRep(book, grp, mode === "top" ? n : null);
      return k.n_peers ? { v: k.ks, muted: k.p >= KS_SIGNIFICANCE } : null;
    },
  });
  // Each rep's top N account scores as a strip on the segment's shared scale:
  // whisker p10-p90, box p25-p75, tick at the median, dashed line at the
  // reps' pooled median. Real accounts only; a book short of N is drawn
  // faded, since the distance counts its empty slots as 0. The distance says
  // how far apart two books are; the strip shows where.
  const distMetric = (n, grp) => {
    const best = (b) => b.book.map((r) => num(r.score)).sort((x, y) => y - x).slice(0, n);
    const all = grp.books.flatMap(best);
    const scale = { lo: all.length ? quantile(all, 0.02) : 0, hi: Math.max(1, ...all) };
    if (scale.hi <= scale.lo) scale.lo = 0;
    const peers = grp.books.filter((b) => !b.rep.pool && b.rep.in_balance !== false).flatMap(best);
    const ref = peers.length ? quantile(peers, 0.5) : null;
    return {
      key: "dist", label: `Top ${fmt(n)} scores`, dist: true,
      help: `Each rep's best ${fmt(n)} account scores, on one scale for the segment. ` +
        "Box: middle half. Whisker: 10th to 90th percentile. Tick: median. " +
        "Dashed line: the reps' median. Faded: fewer than " + fmt(n) +
        " accounts, and the distance counts the missing ones as 0.",
      value: () => null,
      render: (book) => {
        const top = best({ book });
        return distStrip(top, scale, ref, top.length < n ? `${fmt(top.length)} of ${fmt(n)} slots filled` : "");
      },
    };
  };

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
      books: segmentBooks(seg.key),
    };
    const n = topNFor(seg.key);
    const repBooks = grp.books.filter((b) => !b.rep.pool);
    if (!repBooks.length) {
      parts.push(
        `<h3 class="terr-h3">${esc(seg.label)} <span class="terr-sub">no reps · ` +
        `${fmt(grp.size)} accounts</span></h3>` +
        `<p class="seg-verdict seg-verdict-flag">No reps in this segment yet. ` +
        `Give it reps in the Team panel, or its accounts stay unallocated.</p>`);
      continue;
    }
    // How many reps are off their peers by more than chance, on the top N.
    let weaker = 0, stronger = 0;
    for (const b of repBooks) {
      if (!b.book.length || b.rep.in_balance === false) continue;
      const k = ksForRep(b.book, grp, n);
      if (k.n_peers && k.p < KS_SIGNIFICANCE) { if (k.ks < 0) weaker += 1; else stronger += 1; }
    }
    const verdict = weaker || stronger
      ? [weaker && `${fmt(weaker)} weaker than peers`, stronger && `${fmt(stronger)} stronger`]
          .filter(Boolean).join(", ")
      : "no rep differs from peers by more than chance";
    parts.push(
      `<h3 class="terr-h3">${esc(seg.label)} <span class="terr-sub">` +
      `${fmt(repBooks.length)} reps · target ${fmt(n)} per rep · ` +
      `ranked within ${fmt(grp.size)} accounts</span></h3>` +
      `<p class="seg-verdict${weaker || stronger ? " seg-verdict-flag" : ""}">${esc(verdict)}</p>`);
    parts.push(renderMatrix(grp, [
      ksMetric("top", n), distMetric(n, grp), ...(hasAct ? [activityMetric("top", n)] : []),
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
      e.stopPropagation();   // the row click would open the rep's accounts
      showRepRanking(td.dataset.rep, td.dataset.seg, td.dataset.mode);
    };
  });
  $$("#overview-segments tr.rep-row").forEach((tr) => {
    tr.onclick = () => openRep(tr.dataset.rep, tr.dataset.seg);
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

const COMPONENT_PREFIX = "component:";
const isCustomer = (r) => r.account_category === "customer";
const customerCount = (book) => book.filter(isCustomer).length;

/** The Unallocated pool, read like one more book in each segment's table. It
 *  is never anyone's peer (in_balance false), so rep readings don't change. */
const POOL = { name: "Unallocated", in_balance: false, pool: true };
const UNALLOCATED_TEST = (r) =>
  !effectiveOwner(r) && !isWhitespace(r) && r.account_category !== "customer";

function poolBook(segKey) {
  return state.rows
    .filter((r) => r.account_segment === segKey && UNALLOCATED_TEST(r))
    .sort((a, b) => num(b.score) - num(a.score));
}

function bookFor(name, segKey) {
  return name === POOL.name ? poolBook(segKey) : inSegmentBook(name, segKey);
}

/** Every rep's book in a segment, plus the Unallocated pool. */
function segmentBooks(segKey) {
  return state.reps.filter((r) => r.segment === segKey)
    .map((rep) => ({ rep, book: inSegmentBook(rep.name, segKey) }))
    .concat([{ rep: POOL, book: poolBook(segKey) }]);
}

/** Conditional-formatting background for a value relative to the other values IN
 *  ITS COLUMN — a translucent green whose opacity scales with strength
 *  (`rgba(0,166,62, 0.05 + 0.4*t)`). Strongest cell
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

const KS_TOP_N_FALLBACK = 50;

/** The top N a segment's distance compares: its target accounts per rep.
 *  Mirrors territory_lib.ks_top_n_for(). */
function planTopN(seg) {
  return num(seg.default_capacity) || num(seg.ks_top_n) || KS_TOP_N_FALLBACK;
}

function topNFor(segKey) {
  const seg = state.segments.find((x) => x.key === segKey);
  return seg ? planTopN(seg) : KS_TOP_N_FALLBACK;
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
/** Everything the KS chart needs for one rep in one segment. `mode` "top"
 *  compares each book's top N; "all" compares whole books. */
function ksData(repName, segKey, mode = "top") {
  const { ranks, sizes } = segmentRanks();
  const grp = { key: segKey, books: segmentBooks(segKey) };
  const book = grp.books.find((b) => b.rep.name === repName)?.book || bookFor(repName, segKey);
  const topN = topNFor(segKey);
  const kTop = ksForRep(book, grp, topN);
  const kAll = ksForRep(book, grp, null);
  const k = mode === "all" ? kAll : kTop;
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
  return { ranks, sizes, grp, book, topN, kTop, kAll, k, mineR, peerR };
}

function showRepRanking(repName, segKey, mode = "top") {
  const { ranks, sizes, book, topN, kTop, kAll, k, mineR, peerR } = ksData(repName, segKey, mode);
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
      ${k.n_peers ? ksChartHtml(mineR, peerR, k.top_n, repName === POOL.name ? POOL.name : "This rep") : ""}
    </div>
    <div class="detail-section">
      <h3>Accounts, strongest first</h3>
      <p class="eval-diag-sub">Rank out of ${fmt(sizes[segKey] || 0)} (1 = best).</p>
      <table class="detail-table ks-rank-table"><thead><tr>
        <th class="num">#</th><th>Account</th><th class="num">Seg rank</th>
        <th class="num">Score</th>${activity ? `<th class="num">Worked</th>` : ""}
      </tr></thead><tbody>${rowsHtml ||
        `<tr><td colspan="5" class="empty-state">No accounts in this segment.</td></tr>`}</tbody></table>
      <p><a href="#" id="ks-open-accounts">Move ${repName === POOL.name ? "these" : "their"} accounts →</a></p>
    </div>`;
  $$("#detail-body tr.ks-acct").forEach((tr) => { tr.onclick = () => showDetail(tr.dataset.id); });
  $("#ks-open-accounts").onclick = (e) => {
    e.preventDefault();
    $("#detail-panel").classList.add("hidden");
    openRep(repName, segKey);
  };
  if (k.n_peers) wireKsChart($("#detail-body"), mineR, peerR, repName === POOL.name ? POOL.name : "This rep");
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
function ksChartHtml(mine, peers, topN, who = "This rep") {
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
      <span><i class="ks-swatch ks-swatch-rep"></i>${esc(who)}</span>
      <span><i class="ks-swatch ks-swatch-peer"></i>Peers (pooled)</span>
    </div>
    <div class="ks-chart-wrap">
      <svg class="ks-chart" viewBox="0 0 ${w} ${h}" role="img"
        aria-label="Share of accounts in the segment's top x, this rep against peers">
        ${ticks}${xt}
        <text x="${(l + w - r) / 2}" y="${h - 4}" class="ks-axis"
          text-anchor="middle">Segment rank (1 = best)</text>
        <line x1="${X(gx)}" x2="${X(gx)}" y1="${Y(yRep)}" y2="${Y(yPeer)}" class="ks-gap"/>
        <path d="${steps(ps)}" class="ks-line ks-line-peer"/>
        <path d="${steps(ms)}" class="ks-line ks-line-rep"/>
        <text x="${X(gx) + 5}" y="${labelY(yRep, yPeer)}" class="ks-label">${esc(who)} ${fmt(yRep * 100)}%</text>
        <text x="${X(gx) + 5}" y="${labelY(yPeer, yRep)}" class="ks-label">Peers ${fmt(yPeer * 100)}%</text>
        <line class="ks-cross" y1="${t}" y2="${h - b}" x1="-10" x2="-10"/>
        <rect class="ks-hit" x="${l}" y="${t}" width="${w - l - r}" height="${h - t - b}" fill="transparent"/>
      </svg>
      <div class="ks-tip hidden"></div>
    </div>
    <p class="eval-diag-sub">Share of each side in the segment's top x${topN
      ? `; empty slots in a top ${fmt(topN)} never count` : ""}. The dashed line
      is the widest gap: the distance.</p>`;
}

/** Crosshair + tooltip: at the hovered rank, the share of each side in the
 *  segment's top x. */
function wireKsChart(root, mine, peers, who = "This rep") {
  const q = (sel) => root && root.querySelector(sel);
  const svg = q(".ks-chart"), hit = q(".ks-hit"), tip = q(".ks-tip"), cross = q(".ks-cross");
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
      `${esc(who)} ${fmt(shareWithin(ms, x) * 100)}% · Peers ${fmt(shareWithin(ps, x) * 100)}%`;
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
function quantile(values, q) {
  const v = [...values].sort((a, b) => a - b);
  if (!v.length) return 0;
  const i = (v.length - 1) * q, lo = Math.floor(i), hi = Math.ceil(i);
  return v[lo] + (v[hi] - v[lo]) * (i - lo);
}

/** One rep's top-N scores as a small horizontal box plot (inline SVG). */
function distStrip(scores, scale, ref, short) {
  if (!scores.length) return "";
  const W = 132, H = 18;
  const x = (v) => 3 + (W - 6) * Math.min(1, Math.max(0, (v - scale.lo) / (scale.hi - scale.lo)));
  const [p10, p25, p50, p75, p90] = [0.1, 0.25, 0.5, 0.75, 0.9].map((q) => quantile(scores, q));
  const tip = `Median ${fmt(p50, 1)} · middle half ${fmt(p25, 1)}–${fmt(p75, 1)} · ` +
    `10th–90th ${fmt(p10, 1)}–${fmt(p90, 1)}${short ? ` · ${short}` : ""}`;
  return `<svg class="dist-strip${short ? " dist-short" : ""}" width="${W}" height="${H}"
      viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(tip)}"><title>${esc(tip)}</title>` +
    (ref != null ? `<line class="dist-ref" x1="${x(ref)}" x2="${x(ref)}" y1="1" y2="${H - 1}"/>` : "") +
    `<line class="dist-whisker" x1="${x(p10)}" x2="${x(p90)}" y1="${H / 2}" y2="${H / 2}"/>` +
    `<rect class="dist-box" x="${x(p25)}" y="4" width="${Math.max(2, x(p75) - x(p25))}" height="${H - 8}" rx="2"/>` +
    `<line class="dist-median" x1="${x(p50)}" x2="${x(p50)}" y1="2" y2="${H - 2}"/></svg>`;
}

function renderMatrix(grp, metrics, sort) {
  const rows = grp.books.map(({ rep, book }) => {
    const vals = {};
    for (const m of metrics) vals[m.key] = m.value(book, grp);
    return { rep, book, vals };
  });

  const columns = [
    { label: "Rep", key: "rep", text: true },
    { label: "Accounts", key: "inseg",
      help: "Accounts the rep owns in this segment, customers included." },
    { label: "Customers", key: "customers",
      help: "How many of those accounts are customers." },
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
    if (key === "customers") return row.rep.pool ? null : customerCount(row.book);
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
    if (c.dist) return `<th class="dist-th">${esc(c.label)}${info}</th>`;
    return `<th class="sortable ${c.text ? "" : "num"}${active ? " sorted" : ""}" ` +
      `data-key="${esc(c.key)}">${esc(c.label)}${arrow}${info}</th>`;
  }).join("")}</tr>`;

  const body = rows.map(({ rep, book, vals }) => {
    const cells = columns.map((c) => {
      if (c.key === "rep") return `<td>${esc(rep.name)}</td>`;
      if (c.key === "inseg") return `<td class="num">${fmt(book.length)}</td>`;
      if (c.key === "customers") {
        return rep.pool ? `<td class="num matrix-empty">—</td>`
          : `<td class="num">${fmt(customerCount(book))}</td>`;
      }
      if (c.dist) {
        return book.length ? `<td class="dist-cell">${c.render(book)}</td>`
          : `<td class="dist-cell matrix-empty">—</td>`;
      }
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
    return `<tr class="rep-row${rep.pool ? " pool-row" : ""}" data-rep="${esc(rep.name)}"` +
      ` data-seg="${esc(grp.key)}"` +
      `${rep.pool ? ` title="Unowned accounts, compared with the reps' books"` : ""}>${cells}</tr>`;
  }).join("");

  return `<div class="table-wrap"><table class="matrix-table">
    <thead>${head}</thead><tbody>${body}</tbody></table></div>`;
}

/** One book, as listed in the rep view: everything the rep owns or has been
 *  proposed, so an account stays on screen (showing its new owner) after you
 *  move it. The Unallocated pool is its segment's unowned accounts. */
function repBook(v) {
  if (v.name === POOL.name) {
    return state.rows.filter((r) => !r.owner && !isWhitespace(r) &&
      r.account_category !== "customer" && r.account_segment === v.segKey);
  }
  return state.rows.filter((r) => r.owner === v.name || r.proposed_owner === v.name);
}

function repViewRows() {
  const q = state.search.trim().toLowerCase();
  const idle = state.repMode === "idle" && hasActivityData();
  return repBook(state.repView).filter((r) => {
    if (idle && num(r.worked)) return false;
    if (state.repMode === "customers" && !isCustomer(r)) return false;
    if (q && !`${r.name} ${r.domain}`.toLowerCase().includes(q)) return false;
    return true;
  }).sort((a, b) => {
    const k = state.sort.key;
    let av, bv;
    if (k === "name") { av = String(a.name || ""); bv = String(b.name || ""); }
    else if (k === "rank") { av = accountRank(a) ?? Infinity; bv = accountRank(b) ?? Infinity; }
    else { av = num(a[k]); bv = num(b[k]); }
    if (av < bv) return -state.sort.dir;
    if (av > bv) return state.sort.dir;
    return String(a.org_id).localeCompare(String(b.org_id));
  });
}

/** Open one rep's book (or the Unallocated pool) on the Idle filter. */
function openRep(name, segKey) {
  state.repView = { name, segKey };
  state.repMode = hasActivityData() ? "idle" : "all";
  state.search = ""; $("#search-input").value = "";
  state.sort = { key: "score", dir: -1 };
  state.page = 0;
  $("#rep-sheet").classList.remove("hidden");
  $("#rep-sheet-backdrop").classList.remove("hidden");
  $("#rep-sheet").scrollTop = 0;
  renderRep();
}

/** Close the rep's sheet; the Overview under it is already up to date. */
function closeRep() {
  state.repView = null;
  $("#rep-sheet").classList.add("hidden");
  $("#rep-sheet-backdrop").classList.add("hidden");
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

  // Name the segment only when there is more than one to tell apart.
  const multiSeg = new Set(state.reps.map((rep) => rep.segment)).size > 1;
  const repOptions = state.reps.map((rep) => {
    const seg = state.segLabel[rep.segment] || rep.segment;
    return `<option value="${esc(rep.name)}" ${rep.name === eff ? "selected" : ""}>` +
      `${esc(rep.name)}${multiSeg ? ` · ${esc(seg)}` : ""}</option>`;
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

function renderRep() {
  const v = state.repView;
  const isPool = v.name === POOL.name;
  const book = repBook(v);
  const segLabel = state.segLabel[v.segKey] || v.segKey || "";
  $("#rep-title").textContent = isPool ? `Unallocated · ${segLabel}` : v.name;

  // The rep's two readings from the Overview table, each opening the chart.
  const grp = { key: v.segKey, books: segmentBooks(v.segKey) };
  const segBook = grp.books.find((b) => b.rep.name === v.name)?.book || bookFor(v.name, v.segKey);
  const topN = topNFor(v.segKey);
  const signed = (x) => (x.ks > 0 ? "+" : x.ks < 0 ? "−" : "") + Math.abs(x.ks).toFixed(2);
  const kTop = ksForRep(segBook, grp, topN), kAll = ksForRep(segBook, grp, null);
  const reading = (k, mode, label) => k.n_peers
    ? `<a href="#" class="rep-ks" data-mode="${mode}">${label} ${signed(k)}</a>` : "";
  $("#rep-meta").innerHTML = `${fmt(book.length)} accounts` +
    (isPool ? "" : ` · ${esc(segLabel)}`) +
    (kTop.n_peers && segBook.length ? ` · Kolmogorov-Smirnov distance: ${reading(kTop, "top", `top ${fmt(topN)}`)}, ` +
      `${reading(kAll, "all", "all accounts")}` : "");
  $$("#rep-meta .rep-ks").forEach((a) => {
    a.onclick = (e) => { e.preventDefault(); showRepRanking(v.name, v.segKey, a.dataset.mode); };
  });

  // The top-N chart, inline, so opening a rep shows how their book compares.
  const ks = ksData(v.name, v.segKey, "top");
  const ksWho = isPool ? POOL.name : "This rep";
  const ksBox = $("#rep-ks");
  if (ks.k.n_peers && segBook.length) {
    ksBox.innerHTML = `<h3>Top ${fmt(topN)} against peers</h3>` +
      ksChartHtml(ks.mineR, ks.peerR, ks.k.top_n, ksWho);
    wireKsChart(ksBox, ks.mineR, ks.peerR, ksWho);
    ksBox.classList.remove("hidden");
  } else {
    ksBox.innerHTML = "";
    ksBox.classList.add("hidden");
  }

  // Idle (the default) or All.
  const hasAct = hasActivityData();
  const idleN = book.filter((r) => !num(r.worked)).length;
  const custN = customerCount(book);
  const chip = (key, label, n, help) =>
    `<button class="cat-chip ${state.repMode === key ? "active" : ""}" data-mode="${key}"
      title="${esc(help)}">${esc(label)} <span class="cat-count">${fmt(n)}</span></button>`;
  $("#rep-filters").innerHTML = `<div class="filter-row">` +
    (hasAct ? chip("idle", "Idle", idleN,
      `No meeting, call, email or Slack post in the last ${fmt(state.plan.activity?.window_days || 90)} days.`) : "") +
    (custN ? chip("customers", "Customers", custN, "Accounts that are already customers.") : "") +
    chip("all", "All", book.length, "Every account in this book.") + `</div>`;
  $$("#rep-filters [data-mode]").forEach((el) => {
    el.onclick = () => { state.repMode = el.dataset.mode; state.page = 0; render(); };
  });

  const cols = [
    { key: "rank", label: "Rank", num: true, sort: true },
    { key: "name", label: "Account", sort: true },
    { key: "score", label: "Score", num: true, sort: true },
    ...state.components.map((k) => ({
      key: k, label: k.slice(COMPONENT_PREFIX.length), num: true, sort: true, comp: true })),
    { key: "activity", label: "Activity", num: true },
    ...(isPool ? [{ key: "held_by", label: "Held by" }] : []),
    { key: "assign", label: "Owner" },
  ];
  $("#accounts-table thead").innerHTML = `<tr>${cols.map((c) =>
    `<th class="${c.num ? "num" : ""} ${c.sort ? "sortable" : ""} ${c.comp ? "comp-th" : ""}" ` +
    `data-key="${esc(c.key)}"${c.comp ? ` title="Score component: ${esc(c.label)}"` : ""}>` +
    `${esc(c.label)}${state.sort.key === c.key ? (state.sort.dir === -1 ? " ▾" : " ▴") : ""}</th>`
  ).join("")}</tr>`;
  $$("#accounts-table th.sortable").forEach((th) => {
    th.onclick = () => {
      const k = th.dataset.key;
      state.sort = state.sort.key === k
        ? { key: k, dir: -state.sort.dir }
        : { key: k, dir: (k === "name" || k === "rank") ? 1 : -1 };
      render();
    };
  });

  const rows = repViewRows();
  const pages = Math.max(1, Math.ceil(rows.length / state.pageSize));
  state.page = Math.min(state.page, pages - 1);
  const slice = rows.slice(state.page * state.pageSize, (state.page + 1) * state.pageSize);
  // Shade each component against the rest of this book, so a strong PLG or
  // growth account stands out on the page.
  const compBounds = Object.fromEntries(state.components.map((k) => {
    const vs = book.map((r) => num(r[k]));
    return [k, { min: Math.min(...vs), max: Math.max(...vs) }];
  }));

  $("#accounts-table tbody").innerHTML = slice.length ? slice.map((r) => {
    const acts = num(r.meetings) + num(r.calls) + num(r.emails_out) + num(r.messages) + num(r.upcoming_meetings);
    const cust = isCustomer(r);
    const comps = state.components.map((k) => {
      const b = compBounds[k];
      return r[k] === "" || r[k] == null ? `<td class="num comp-td matrix-empty">—</td>`
        : `<td class="num comp-td"${heatStyleAttr(num(r[k]), b.min, b.max, "high")}>${fmt(r[k], 1)}</td>`;
    }).join("");
    return `<tr data-id="${esc(r.org_id)}"${cust ? ` class="customer-row"` : ""}>
      <td class="num">${accountRank(r) ? fmt(accountRank(r)) : "—"}</td>
      <td>${r.sumble_url
        ? `<a href="${esc(r.sumble_url)}" target="_blank" rel="noopener">${esc(r.name)}</a>`
        : esc(r.name)}<span class="cell-sub">${esc(r.domain)}` +
        `${cust ? ` · <span class="customer-tag">Customer</span>` : ""}</span></td>
      <td class="num">${fmt(r.score, 1)}</td>${comps}
      <td class="num" title="${num(r.meetings)} meetings · ${num(r.calls)} calls · ${num(r.emails_out)} emails out · ${num(r.messages)} Slack messages">
        ${acts ? fmt(acts) : `<span class="zero">0</span>`}</td>
      ${isPool ? `<td>${esc((r.held_by || "").split("|").filter(Boolean).join(", ") || "—")}</td>` : ""}
      <td class="assign-cell">${assignCell(r)}</td>
    </tr>`;
  }).join("") : `<tr><td colspan="${cols.length}" class="empty-state">` +
    `${!book.length ? "No accounts yet. Open another rep or the Unallocated row and pick " +
      `${esc(v.name)} in the Owner column.` :
      state.repMode === "idle" ? "No idle accounts." :
      state.repMode === "customers" ? "No customers." : "No accounts."}</td></tr>`;
  $$("#accounts-table tbody tr[data-id]").forEach((tr) => {
    tr.onclick = (e) => { if (!e.target.closest("a")) showDetail(tr.dataset.id); };
  });
  wireAssignControls("#accounts-table");

  $("#page-info").textContent = rows.length
    ? `${fmt(state.page * state.pageSize + 1)}–${fmt(Math.min((state.page + 1) * state.pageSize, rows.length))} of ${fmt(rows.length)}`
    : "";
  $("#page-prev").disabled = state.page <= 0;
  $("#page-next").disabled = state.page >= pages - 1;
}

/** The owner dropdown and its undo/dismiss link, in any table. Clicks stop
 *  here so they don't open the account panel. */
function wireAssignControls(scope) {
  $$(`${scope} .assign-select`).forEach((sel) => {
    sel.onclick = (e) => e.stopPropagation();
    sel.onchange = (e) => {
      e.stopPropagation();
      if (sel.value === "__accept__") decide(sel.dataset.id, "accepted");
      else decide(sel.dataset.id, "manual", sel.value);
    };
  });
  $$(`${scope} .decide-btn`).forEach((btn) => {
    btn.onclick = (e) => { e.stopPropagation(); decide(btn.dataset.id, btn.dataset.status); };
  });
}

function sizeLabel() {
  return state.rows[0]?.size_metric_name || "Size";
}

const STATUS_LABELS = {
  suggested: "Suggested", accepted: "Approved", manual: "Approved", rejected: "Dismissed",
};

/** What one log entry did, in words. */
function logAction(e) {
  const to = e.proposed_owner, from = e.owner || "unassigned";
  if (e.requested === "manual") {
    return e.status === "manual" ? `Moved from ${from} to ${to}` : "Move cleared";
  }
  if (e.requested === "accepted") return `Approved suggestion: ${from} → ${to}`;
  if (e.requested === "rejected") return `Dismissed suggestion: ${from} → ${to}`;
  return e.status === "suggested" ? `Undone, back to suggesting ${to}` : "Undone";
}

function renderChanges() {
  const proposals = state.rows.filter((r) =>
    r.proposed_owner && ["suggested", "accepted", "manual", "rejected"].includes(r.proposal_status));
  const group = (r) => (r.proposal_status === "manual" ? "accepted" : r.proposal_status);
  const counts = { approved: 0, suggested: 0, dismissed: 0 };
  for (const r of proposals) {
    const g = group(r);
    if (g === "accepted") counts.approved++;
    else if (g === "suggested") counts.suggested++;
    else counts.dismissed++;
  }
  $("#changes-summary").innerHTML = `<p><strong>${fmt(counts.approved)}</strong> approved` +
    ` (these go in actions.csv) · <strong>${fmt(counts.suggested)}</strong> awaiting a decision` +
    ` · <strong>${fmt(counts.dismissed)}</strong> dismissed. Nothing is written to your CRM.</p>`;

  const filters = [["all", "All", proposals.length], ["approved", "Approved", counts.approved],
    ["suggested", "Suggested", counts.suggested], ["dismissed", "Dismissed", counts.dismissed]];
  $("#changes-filters").innerHTML = `<div class="filter-row">` + filters.map(([k, label, n]) =>
    `<button class="cat-chip ${state.changesFilter === k ? "active" : ""}" data-k="${k}">` +
    `${label} <span class="cat-count">${fmt(n)}</span></button>`).join("") + `</div>`;
  $$("#changes-filters [data-k]").forEach((el) => {
    el.onclick = () => { state.changesFilter = el.dataset.k; render(); };
  });

  // Most recent decision first; undecided suggestions after, strongest first.
  const lastAt = {};
  for (const e of state.log) lastAt[e.org_id] = e.at;
  const want = { all: null, approved: "accepted", suggested: "suggested", dismissed: "rejected" }[state.changesFilter];
  const shown = proposals.filter((r) => !want || group(r) === want).sort((a, b) =>
    String(lastAt[b.org_id] || "").localeCompare(String(lastAt[a.org_id] || "")) ||
    num(b.score) - num(a.score));
  const when = (iso) => (iso ? new Date(iso).toLocaleString() : "—");

  const cols = ["When", "Account", "From", "To", "Reason", "Status", "Owner"];
  $("#changes-table thead").innerHTML = `<tr>${cols.map((c) => `<th>${c}</th>`).join("")}</tr>`;
  $("#changes-table tbody").innerHTML = shown.length ? shown.map((r) => `<tr data-id="${esc(r.org_id)}">
      <td>${esc(when(lastAt[r.org_id]))}</td>
      <td>${esc(r.name)}<span class="cell-sub">${esc(r.domain)}</span></td>
      <td>${esc(r.owner || "(unassigned)")}</td>
      <td>${esc(r.proposed_owner)}</td>
      <td>${esc(REASON_LABELS[r.proposal_reason] || r.proposal_reason)}</td>
      <td>${esc(STATUS_LABELS[r.proposal_status] || r.proposal_status)}</td>
      <td class="assign-cell">${assignCell(r)}</td>
    </tr>`).join("")
    : `<tr><td colspan="${cols.length}" class="empty-state">No proposed changes yet. ` +
      `Click a rep on the Overview to move their accounts.</td></tr>`;
  $$("#changes-table tbody tr[data-id]").forEach((tr) => { tr.onclick = () => showDetail(tr.dataset.id); });
  wireAssignControls("#changes-table");

  const logCols = ["When", "Account", "What happened"];
  $("#log-table thead").innerHTML = `<tr>${logCols.map((c) => `<th>${c}</th>`).join("")}</tr>`;
  $("#log-table tbody").innerHTML = state.log.length ? [...state.log].reverse().map((e) => `<tr>
      <td>${esc(when(e.at))}</td><td>${esc(e.name)}</td><td>${esc(logAction(e))}</td></tr>`).join("")
    : `<tr><td colspan="3" class="empty-state">No decisions yet.</td></tr>`;
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
    ["Slack messages", r.messages], ["Upcoming meetings (28d)", r.upcoming_meetings],
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
        ${num(r.upcoming_meetings) ? `<tr><td>Next meeting</td><td class="num">${esc(r.next_meeting_date)} (${fmt(r.upcoming_meetings)} booked)</td></tr>` : ""}
        <tr><td>Sources</td><td class="num">${esc((r.activity_sources || "").split("|").join(", ") || "—")}</td></tr>
        </tbody></table>`
        : `<p class="empty-state">No activity in the window.</p>`}
      <p class="eval-diag-sub">${state.plan.activity?.attribution === "anyone"
        ? "Anyone at the company." : "The owner only."}</p>
    </div>
    <div class="detail-section" id="detail-log" data-org="${esc(r.org_id)}">
      <h3>Activity log</h3>
      <p class="eval-diag-sub">Loading…</p>
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
  renderActivityLog(r.org_id);
}

const LOG_KIND_LABELS = {
  meeting: "Meeting", call: "Call", email_out: "Email out", email_in: "Email in", message: "Slack",
};
const LOG_SOURCE_LABELS = {
  google_calendar: "Calendar", upcoming_calendar: "Calendar", fireflies: "Fireflies",
  salesforce_email: "Salesforce", slack: "Slack",
};
let activityLog = null;   // static/activity_log.json, fetched once on first use

async function loadActivityLog() {
  if (activityLog) return activityLog;
  try {
    const res = await fetch("activity_log.json");
    activityLog = res.ok ? await res.json() : { events: {} };
  } catch {
    activityLog = { events: {} };
  }
  return activityLog;
}

/** Every event on the account: upcoming soonest first, then the past newest first. */
async function renderActivityLog(orgId) {
  const log = await loadActivityLog();
  const box = $("#detail-log");
  if (!box || box.dataset.org && box.dataset.org !== String(orgId)) return;
  const events = (log.events || {})[String(orgId)] || [];
  const past = log.past_days || 84, future = log.future_days || 28;
  const head = `<h3>Activity log</h3><p class="eval-diag-sub">Last ${fmt(past)} days and next ` +
    `${fmt(future)} days${log.as_of ? `, as of ${esc(log.as_of)}` : ""}.</p>`;
  if (!events.length) {
    box.innerHTML = head + `<p class="empty-state">Nothing logged in that window.</p>`;
    return;
  }
  const asOf = log.as_of || new Date().toISOString().slice(0, 10);
  const people = state.plan.reps || [];
  const who = (email) => {
    const p = people.find((x) => (x.email || "").toLowerCase() === email);
    return p ? p.name : email.split("@")[0];
  };
  // One row per thing that happened: a meeting four people sat in is one
  // meeting, not four. Emails on the same day add up.
  const grouped = new Map();
  for (const [ts, kind, source, email, domain, n] of events) {
    const src = LOG_SOURCE_LABELS[source] || source;
    const key = `${ts}|${kind}|${src}|${domain}`;
    const g = grouped.get(key) || { ts, kind, src, domain, n: 0, who: new Set() };
    g.n = kind === "meeting" || kind === "call" ? Math.max(g.n, n) : g.n + n;
    g.who.add(who(email));
    grouped.set(key, g);
  }
  const row = (g) =>
    `<tr${g.ts > asOf ? ` class="log-upcoming"` : ""}>
      <td class="num">${esc(g.ts)}</td>
      <td>${esc(LOG_KIND_LABELS[g.kind] || g.kind)}${g.n > 1 ? ` ×${fmt(g.n)}` : ""}
        <span class="cell-sub">${esc(g.src)} · ${esc(g.domain)}</span></td>
      <td>${esc([...g.who].sort().join(", "))}</td>
    </tr>`;
  const all = [...grouped.values()];
  const upcoming = all.filter((g) => g.ts > asOf).sort((a, b) => (a.ts < b.ts ? -1 : 1));
  const done = all.filter((g) => g.ts <= asOf).sort((a, b) => (a.ts < b.ts ? 1 : -1));
  const section = (label, list) => list.length
    ? `<tr class="log-group"><td colspan="3">${label}</td></tr>` + list.map(row).join("") : "";
  box.innerHTML = head + `<div class="log-wrap"><table class="detail-table log-table"><tbody>` +
    section(`Upcoming · ${fmt(upcoming.length)}`, upcoming) +
    section(`Past · ${fmt(done.length)}`, done) +
    `</tbody></table></div>`;
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
  if (out.log_entry) state.log.push(out.log_entry);
  render();
}

/** Show a tab: "overview" or "changes". A rep's book opens as a sheet over
 *  the Overview (openRep), not as a view. */
function showView(view) {
  state.tab = view;
  $$(".tab").forEach((t) => t.classList.toggle("active", t.dataset.tab === view));
  $$(".view").forEach((v) => v.classList.toggle("hidden", v.id !== `view-${view}`));
  $("#tab-description").textContent = PAGE_DESCRIPTIONS[view] || "";
  render();
}

function switchTab(tab) {
  closeRep();
  showView(tab);
}

function render() {
  computeStrongSet();  // refresh the "strong" set for the attention flags
  if (state.tab === "overview") renderOverview();
  else if (state.tab === "changes") renderChanges();
  // The sheet sits over the Overview, which re-renders under it on each move.
  if (state.repView) renderRep();
}

const HOLD = "__hold";

/** The panel's starting point: the plan as it stands. */
function draftFromPlan() {
  const b = state.plan.boundary || {};
  const mins = Object.fromEntries((b.thresholds || []).map((t) => [t.segment, t.min]));
  const roster = {};
  for (const r of state.plan.reps || []) {
    roster[r.name] = { is_rep: !!r.is_rep, segment: r.segment || "", in_balance: r.in_balance !== false };
  }
  for (const name of Object.keys(state.owners)) {
    if (!roster[name]) roster[name] = { is_rep: false, segment: "", in_balance: true };
  }
  return {
    metric: b.metric || "",
    segments: state.segments.map((seg, i) => ({
      key: seg.key, label: seg.label || seg.key,
      min: i === 0 ? null : (mins[seg.key] ?? null),
      target: num(seg.default_capacity) || "",
    })),
    roster,
  };
}

function draftDirty() {
  return JSON.stringify(state.draft) !== JSON.stringify(draftFromPlan());
}

/** Each account's value on a cutoff metric (the sheet carries one column per option). */
function metricValue(r, metric) {
  const col = `metric:${metric}`;
  return col in r ? num(r[col]) : num(r.size_metric);
}

/** Accounts per segment under the draft, for the live counts in the panel. */
function draftCounts() {
  const d = state.draft;
  const ordered = d.segments.map((sg, i) => ({ i, min: i === 0 || sg.min === "" || sg.min == null ? -Infinity : num(sg.min) }))
    .sort((a, b) => a.min - b.min);
  const counts = d.segments.map(() => 0);
  for (const r of state.rows) {
    if (isWhitespace(r)) continue;
    const v = metricValue(r, d.metric);
    let at = ordered[0].i;
    for (const o of ordered) if (v >= o.min) at = o.i;
    counts[at] += 1;
  }
  return counts;
}

/** A round number near v: two significant figures. */
function roundish(v) {
  if (!(v > 0)) return 0;
  const p = Math.pow(10, Math.floor(Math.log10(v)) - 1);
  return Math.round(v / p) * p;
}

/** Switching the metric keeps each segment's share of accounts: each line
 *  moves to the value on the new metric with the same share above it. */
function remapMins(oldMetric, newMetric) {
  const real = state.rows.filter((r) => !isWhitespace(r));
  const oldV = real.map((r) => metricValue(r, oldMetric));
  const newV = real.map((r) => metricValue(r, newMetric));
  for (const sg of state.draft.segments.slice(1)) {
    if (sg.min === "" || sg.min == null) continue;
    const share = oldV.filter((v) => v < num(sg.min)).length / Math.max(1, oldV.length);
    sg.min = roundish(quantile(newV, Math.min(0.999, share)));
  }
}

function renderConfigPanel() {
  const d = state.draft;
  const opts = (state.plan.boundary || {}).options || [];
  const metricLabel = (opts.find((o) => o.metric === d.metric) || {}).label ||
    (state.plan.boundary || {}).label || "the metric";
  const counts = draftCounts();
  const segHtml = d.segments.map((sg, i) => `
    <div class="seg-edit" data-i="${i}">
      <div class="seg-edit-head">
        <input class="terr-input seg-label" value="${esc(sg.label)}" aria-label="Segment name" />
        ${d.segments.length > 1 ? `<button class="btn-link seg-remove" type="button" title="Remove this segment">Remove</button>` : ""}
      </div>
      ${i === 0
        ? (d.segments.length > 1 ? `<p class="seg-floor">Everything below the next segment</p>` : "")
        : `<label class="cal-field"><span>From ${esc(metricLabel)} ≥</span>
            <input type="number" min="0" class="terr-input seg-min" value="${sg.min ?? ""}" /></label>`}
      <label class="cal-field"><span>Target accounts per rep</span>
        <input type="number" min="1" step="1" class="terr-input seg-target" value="${sg.target}" /></label>
      <p class="seg-count">${fmt(counts[i])} accounts</p>
    </div>`).join("");

  const segOrder = Object.fromEntries(d.segments.map((sg, i) => [sg.key, i]));
  const people = Object.entries(d.roster).sort(([an, a], [bn, b]) =>
    (b.is_rep - a.is_rep) || ((segOrder[a.segment] ?? 99) - (segOrder[b.segment] ?? 99)) ||
    ((state.owners[bn] || 0) - (state.owners[an] || 0)) || an.localeCompare(bn));
  const teamHtml = people.map(([name, r]) => {
    const role = r.is_rep ? r.segment : HOLD;
    const options = d.segments.map((sg) =>
      `<option value="${esc(sg.key)}" ${role === sg.key ? "selected" : ""}>${esc(d.segments.length > 1 ? sg.label : "Rep")}</option>`).join("") +
      `<option value="${HOLD}" ${role === HOLD ? "selected" : ""}>Holds accounts</option>`;
    return `<tr data-name="${esc(name)}">
      <td>${esc(name)}<span class="cell-sub">${fmt(state.owners[name] || 0)} accounts in the CRM</span></td>
      <td><select class="team-role" aria-label="Role for ${esc(name)}">${options}</select>
        ${r.is_rep ? `<label class="team-bal" title="Off for a player-coach: they keep their accounts but are never compared or moved off">
          <input type="checkbox" class="team-balance" ${r.in_balance ? "checked" : ""}/> balanced</label>` : ""}</td>
    </tr>`;
  }).join("");

  const dirty = draftDirty();
  $("#config-panel").innerHTML = `
    <div class="panel-header"><h2>Segments</h2></div>
    <p class="panel-sub">What puts an account in a segment, and how many accounts each rep should carry.
      The target is also the top N the distance compares.</p>
    ${opts.length > 1 ? `<label class="cal-field cal-field-wide"><span>Cut by</span>
      <select id="cfg-metric" class="terr-input">${opts.map((o) =>
        `<option value="${esc(o.metric)}" ${o.metric === d.metric ? "selected" : ""}>${esc(o.label)}</option>`).join("")}</select></label>` : ""}
    ${segHtml}
    <button id="seg-add" class="btn-link" type="button">+ Add segment</button>

    <div class="panel-header panel-header-gap"><h2>Team</h2></div>
    <p class="panel-sub">Everyone whose name is on accounts in the CRM. <b>Holds accounts</b> means
      their accounts count as unallocated, for a leader or founder warehousing them.</p>
    <table class="team-table"><tbody>${teamHtml}</tbody></table>

    <div class="calibrate-actions">
      <button id="cfg-apply" class="btn-download" type="button" ${dirty ? "" : "disabled"}>Apply</button>
      <button id="cfg-reset" class="btn-link" type="button" ${dirty ? "" : "disabled"}>Reset</button>
      <span id="cfg-status" class="cfg-status">${dirty ? "Unsaved changes" : ""}</span>
    </div>`;

  const changed = () => renderConfigPanel();
  $$("#config-panel .seg-edit").forEach((el) => {
    const sg = d.segments[Number(el.dataset.i)];
    el.querySelector(".seg-label").oninput = (e) => { sg.label = e.target.value; };
    el.querySelector(".seg-label").onchange = changed;
    const min = el.querySelector(".seg-min");
    if (min) min.onchange = (e) => { sg.min = e.target.value === "" ? null : num(e.target.value); changed(); };
    el.querySelector(".seg-target").onchange = (e) => { sg.target = Math.max(1, Math.floor(num(e.target.value))) || ""; changed(); };
    const rm = el.querySelector(".seg-remove");
    if (rm) rm.onclick = () => {
      const i = Number(el.dataset.i);
      const into = d.segments[i === 0 ? 1 : i - 1].key;
      for (const r of Object.values(d.roster)) if (r.segment === sg.key) r.segment = into;
      d.segments.splice(i, 1);
      d.segments[0].min = null;
      changed();
    };
  });
  $("#seg-add").onclick = () => {
    const last = d.segments[d.segments.length - 1];
    const vals = state.rows.filter((r) => !isWhitespace(r)).map((r) => metricValue(r, d.metric));
    const above = vals.filter((v) => last.min == null || v >= num(last.min));
    d.segments.push({
      key: `new-${d.segments.length}-${Date.now()}`, label: "New segment",
      min: roundish(quantile(above, 0.5)) || 1, target: last.target || "",
    });
    changed();
  };
  const metricSel = $("#cfg-metric");
  if (metricSel) metricSel.onchange = (e) => { remapMins(d.metric, e.target.value); d.metric = e.target.value; changed(); };
  $$("#config-panel .team-table tr").forEach((tr) => {
    const r = d.roster[tr.dataset.name];
    tr.querySelector(".team-role").onchange = (e) => {
      if (e.target.value === HOLD) r.is_rep = false;
      else { r.is_rep = true; r.segment = e.target.value; }
      changed();
    };
    const bal = tr.querySelector(".team-balance");
    if (bal) bal.onchange = (e) => { r.in_balance = e.target.checked; changed(); };
  });
  $("#cfg-reset").onclick = () => { state.draft = draftFromPlan(); renderConfigPanel(); };
  $("#cfg-apply").onclick = applyConfig;
}

async function applyConfig() {
  const d = state.draft;
  $("#cfg-apply").disabled = true;
  $("#cfg-status").textContent = "Applying…";
  const res = await fetch("/api/config", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      metric: d.metric,
      segments: d.segments.map((sg, i) => ({
        key: sg.key, label: sg.label, min: i === 0 ? null : sg.min, target: sg.target || null,
      })),
      roster: Object.entries(d.roster).map(([name, r]) => ({ name, ...r })),
    }),
  });
  if (!res.ok) {
    $("#cfg-status").textContent = `Couldn't apply: ${res.statusText || res.status}`;
    $("#cfg-apply").disabled = false;
    return;
  }
  const out = await res.json();
  loadData(out);
  state.draft = draftFromPlan();
  renderConfigPanel();
  render();
  const moves = (out.report && out.report.moves && out.report.moves.total) || 0;
  $("#cfg-status").textContent = `Applied · ${fmt(moves)} suggested moves`;
}

/** Read a /api/plan or /api/config response into state. */
function loadData(data) {
  state.plan = data.plan;
  state.rows = data.rows;
  state.owners = data.owners || {};
  state.components = Object.keys(data.rows[0] || {}).filter((k) => k.startsWith(COMPONENT_PREFIX));
  state.segments = (data.plan.segments || []).slice().sort((a, b) => (a.order || 0) - (b.order || 0));
  state.segLabel = Object.fromEntries(state.segments.map((x) => [x.key, x.label]));
  state.reps = (data.plan.reps || []).filter((r) => r.is_rep);
  state.repByName = Object.fromEntries(state.reps.map((r) => [r.name, r]));
  state.strongCutoff = num(data.plan.strong_cutoff) || 500;
  const owned = state.rows.filter((r) => r.owner).length;
  $("#row-summary").textContent =
    `${fmt(state.rows.length)} accounts · ${fmt(state.reps.length)} reps · ${fmt(owned)} allocated`;
}

async function init() {
  const res = await fetch("/api/plan");
  const data = await res.json();
  loadData(data);
  state.log = data.log || [];
  state.draft = draftFromPlan();
  renderConfigPanel();

  const company = (data.plan.company || {}).name || "Territory";
  $("#customer-name").textContent = `${company} territory plan`;
  $$(".tab").forEach((t) => { t.onclick = () => switchTab(t.dataset.tab); });
  // The strong-account cutoff is not editable in the app; it comes from the
  // plan's strong_cutoff.
  $("#search-input").oninput = (e) => { state.search = e.target.value; state.page = 0; render(); };
  $("#rep-close").onclick = closeRep;
  $("#rep-sheet-backdrop").onclick = closeRep;
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
      if (!state.repView) return;
      e.preventDefault(); $("#search-input").focus();
    }
    // Esc closes the top layer first: the account panel, then the sheet.
    if (e.key === "Escape") {
      if (!$("#detail-panel").classList.contains("hidden")) $("#detail-panel").classList.add("hidden");
      else if (state.repView) closeRep();
    }
  });

  switchTab("overview");
}

init();
