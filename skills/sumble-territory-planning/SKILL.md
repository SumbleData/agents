---
name: sumble-territory-planning
description: "Companion to sumble-account-scoring: plan and rebalance sales territories. Interviews the user about their segments (default Enterprise + Commercial), what decides an account's segment (account score, headcount, revenue, or another CRM field), and whether that line is a hard rule or calibrated from their data. Pulls territory ownership from the CRM and per-rep×account activity (calendar meetings, Gong/Fireflies/Granola calls, Salesforce email) from whatever MCPs are connected. Generates a zero-dependency Python + HTML/JS app at territory_planning/{company}/ with a book-strength table per segment (signed Kolmogorov-Smirnov distances vs peers on each rep's top N accounts and on all accounts, clickable to the rep's ranked accounts, each with an Activity share), an account view, flags for accounts that are unworked / in the wrong segment / strong-but-unallocated / double-allocated / strong-but-idle, and a suggest→accept/reject→export flow that writes an actions.csv of approved owner changes."
---

# Territory Planning

The companion to `sumble-account-scoring`. Scoring answers *which accounts are
strong*; this skill answers *are the right reps on them, and are the books
fair*.

It produces two things:

1. A zero-dependency Python **web app** (stdlib `http.server`) showing book
   balance per segment, per-rep coverage, every account with its flags, and a
   review queue of proposed owner changes you accept or reject.
2. **`territory-plan.json`** — a portable config (segments, the boundary rule,
   the rep roster, the activity window and sources, the balance/move policy)
   plus **`actions.csv`**, the CRM-ready list of approved owner changes.

Follow the stages closely — input (interview) and output should be consistent
between runs, more deterministic than most skills.

## When to use

Trigger on `/sumble-territory-planning`, or on any of: "plan my territories",
"balance my territories", "rebalance the books", "who should own which
accounts", "are my reps' books fair", "which accounts is nobody working",
"split enterprise and commercial".

If the user wants to know which accounts are *good* (not who owns them), that's
`/sumble-account-scoring`. This skill happily consumes that skill's output but
does not replace it.

## Required tools

- **An account-scoring run (preferred), or a Sumble API key.** Account strength
  comes from one of two places, decided at Q1:
  - **Path A — an existing `/sumble-account-scoring` run.** Read `score.csv`
    from `account_scoring/{company}/`. It already carries `org_id`, `score`,
    `account_category`, `employee_count_int`, per-persona headcounts and
    domains. Nothing is fetched, no credits are spent. **Always prefer this** —
    a score tuned to the user's ICP is a far better measure of book value than a
    generic one.
  - **Path B — no scoring run.** `fetch_light.py` resolves the CRM account list
    against `POST https://api.sumble.com/v6/organizations` and pulls
    **`sumble_score`** (Sumble's own account score) plus `employee_count` and
    firmographics. ~6 credits per matched org.

  **Check the API key before prompting — it is usually already set.** Run this
  one simple command and read the result:
  ```bash
  ls ~/.config/sumble/api_key
  ```
  If that file exists (or `SUMBLE_API_KEY` is exported), say so in one line and
  move on. Only when it comes up empty, tell the user their key is at
  **https://sumble.com/account (Account → API key)** and have them run the
  helper, which reads the key **without echoing** and saves it chmod 0600:
  ```bash
  ! python3 {skill_dir}/template/_build/set_api_key.py
  ```
  **Always `python3`, never bare `python`.** No Python at all?
  `! sh {skill_dir}/template/_build/set_api_key.sh` is an identical POSIX-shell
  twin. **Never ask the user to paste a key into chat** — it would be logged.
  Path A needs no key at all unless the boundary metric requires a supplemental
  job-function pull.

- **A CRM / ownership source** — Salesforce, HubSpot, a warehouse, or a CSV.
  Required: without owners there are no territories to plan.

- **Activity sources (optional but the point of the skill)** — Google Calendar,
  Gong, Fireflies, Granola, Salesforce email, Gmail. Whichever MCPs are
  connected.

  **With no activity loaded, everything activity-derived is SUPPRESSED, not
  shown as zero.** Zero events does not mean zero coverage; it means the
  question is unanswerable, and a table of 0% states the opposite. One helper,
  `territory_lib.has_activity()` (mirrored by `hasActivityData()` in the UI), is
  the single source of truth. When it is false:
  - the two **Activity** columns are removed, replaced by a short note saying why
    (KS is unaffected: it reads ICP score and ownership only);
  - the **not-worked** and **strong-but-idle** flags are removed — with no
    events every owned account trivially satisfies "not worked", so the cards
    would indict the entire book;
  - **move suggestions are switched off entirely.** This is the important one.
    The rule that protects an account a rep is actively working is enforced by
    reading `worked`; with no events that rail is silently inert and every
    account looks fair game, so the mover would happily reassign live deals.
    `suggest_moves` no-ops and reports `skipped_no_activity`.

  The plan still does real work without activity — book balance, segment misfit,
  double-allocation, and the unallocated pile are all ownership-structure
  questions. Say plainly which half you are delivering.

- **Sumble MCP** — only for `lookup.py`-adjacent name resolution and, on Path B,
  nothing at all. If it isn't available, install: https://docs.sumble.com/api/mcp.

## Shell-command discipline

This runs unattended AND is shipped to non-technical users — and it may run in
**Claude Code, Codex, Cursor, or any other coding agent**. They all gate shell
commands behind a command-approval / permission system that **interrupts the run
on anything complex** (compound, redirected, `cd`-prefixed, or
substitution-bearing commands). Each interruption stalls the run, in every
agent. Keeping commands trivially simple is the portable way to avoid that
everywhere. Follow these rules exactly:

- **One simple command per shell call.** No `&&` / `;` / `|` chains, no `cd`, no
  output redirection (`>`, `>>`, `2>&1`), no backgrounding (`&`, `nohup`), and no
  command substitution (`$(…)` or backticks).
- **Use absolute paths, never `cd`.** Every `_build/*` script takes its directory
  as an argument, so run e.g.
  `python3 {skill_dir}/template/_build/merge_territory.py --raw {output_root}/_raw`
  from anywhere.
- **Run the pipeline in the foreground.** The scripts stream progress to stdout
  and finish in seconds (minutes only for a Path B fetch). NEVER background a
  step and poll it — every poll is a fresh approval prompt.
- **No inline Python, no heredocs.** Any multi-line Python, JSON shaping, or
  counting → write a `.py` to `{output_root}/_raw/` with your agent's file tool
  and run it as a single `python3 {abs}.py`. Never `python3 -c "…{…}…"`.
- **Inspect with your agent's file tools, not the shell.** Use the native
  file-read / glob / grep tools — never `cat` / `tail` / `head` / `ls` / `wc`.

The only shell this skill needs is `mkdir -p {abs}`, `cp {abs} {abs}`, and
`python3 {abs}/script.py [args]` — each as one standalone command.

**Running a command in the user's own terminal.** The API-key helper and
`app.py` are best run by the user so they're interactive / stay up. In **Claude
Code** prefix with `!`. In **Codex / Cursor** just tell the user to paste the
same command (without the `!`) into a terminal.

## The deliverable is the app, not the analysis

**This skill exists to hand the user a tool they calibrate themselves.** The
interview settles the *shape* — what the segments are, what metric divides them,
who the reps are, where activity comes from. Everything after that is a dial in
the app.

So: **stop interviewing once the shape is settled, and ship.** The boundary
threshold and capacity live in `spec.json`, so a first pass at both is enough;
re-running the pipeline after a change takes seconds. Likewise, when a
result looks wrong (a rep gets no moves, a segment routes nothing), **report it
and hand over the app**; do not spend turns proposing re-runs with different
constants. Explaining which dial fixes it beats running it for them.

Ship as soon as `territory.csv` exists and spot-checks pass. Refinement is what
the app is for.

## Output

```
territory_planning/{company}/
  app.py                  stdlib http.server (copied from template/, unchanged — no deps)
  territory_lib.py        shared helpers + the move engine, stdlib-only
                            (copied from template/_build/ — the app imports it,
                             so the app and the CLI run the SAME four phases)
  territory-plan.json     THE config — segments, boundary rule, rep roster,
                            activity window + sources, balance & move policy
  territory.csv           one row per Sumble org: identity, score, segment,
                            owner, every flag, per-rep activity counts, proposal
  actions.csv             written by the app: approved owner changes for the CRM
  panel-config.json       written by the app: the Segments + Team panel's settings
  static/                 UI: Segments + Team panel, book-strength tables, rep sheet, changes
  README.md
  _raw/                   agent-written inputs + fetch responses + audit
```

### `territory.csv` column schema

One row per Sumble `org_id` — **the org id is the join key, and that is what
makes double allocation detectable.** Two CRM records with different names and
different domains that resolve to the same organisation are two reps working one
company; no amount of name matching would have found it.

**Identity + strength**
- `org_id` (int) — Sumble organization id, primary key
- `name`, `domain`, `sumble_url`
- `crm_account_id` (str) — pipe-joined when several CRM records collapse into one org
- `account_category` (str) — `customer` / `allocated` / `unallocated` /
  `whitespace` / `whitespace_subsidiary`, same vocabulary as account-scoring
- `score` (float) + `score_source` (`custom` = the user's tuned account score,
  `sumble` = Sumble's own `sumble_score`)
- `size_metric` (float) + `size_metric_name` (str) — the value the segment
  boundary is applied to
- `account_segment` (str) — segment key implied by `size_metric`

**Ownership**
- `owner`, `owner_email`, `rep_segment` — the *canonical* owner when several
  reps own records for the same org: whoever has the most activity (ties
  alphabetical)
- `held_by` (str, pipe-joined) — when no active rep owns the account, whose name
  is on it in the CRM: a warehouse owner, a queue, or someone who left. Blank
  otherwise.
- `other_owners` (str, pipe-joined) — the other claimants
- `crm_owners` (str, pipe-joined) — every name on the company's CRM records,
  reps and holders alike. The Team panel re-derives `owner`, `held_by` and the
  allocation flags from it when someone's role changes.
- `metric:<metric>` (float, one column per cutoff option, e.g. `metric:score`,
  `metric:total_employees`, `metric:jf_people:Sales`) — what the Segments panel
  switches `size_metric` to when the user changes the cutoff.

These 0/1 flag columns are the CSV baseline (computed at merge time against the
canonical owner). **The app recomputes the attention flags live against the
`effective owner`** (current owner + the user's accepted/manual allocations), so
moving an account in a rep's view clears/sets its flags and updates the
Overview immediately — the CSV columns are the exported snapshot, the UI is the
working state.

**Flags (0/1, always present)** — CSV columns. The app uses two of them: *Unallocated*
(the pool row on the Overview) and *Idle* (the rep view's default filter).
- `unallocated` — no active rep owns it: nobody, a queue, or someone who has
  left. **A departed rep's name in the owner field is not coverage**, and this is
  the single most common way a book looks covered but isn't. In the app,
  *Unallocated* is this minus customers and whitespace (unowned, or held by a
  warehouse owner); it is the Overview's Unallocated row.
- `double_allocated` — ≥2 active reps own records resolving to the same org
- `segment_misfit` — the account's size segment ≠ its owner's segment
- `worked` — the owner has ≥1 meeting, call, or **outbound** email with the
  account in the window. Inbound email alone is the prospect doing the work, so
  it is counted and displayed but does not clear this flag on its own.
- `strong_idle` — one of the **top `strong_cutoff` accounts by ICP score**
  (global, default 500), owned, and not worked: the strongest accounts nobody is
  working. The cutoff is `strong_cutoff` in `spec.json`. A CSV column only; the
  app doesn't filter on it.
- *Idle* (app-only) — not worked. The default filter when you open a rep.

`whitespace` is a valid `account_category` and is still routed by the mover, but it
is **not** shown in the app — a territory review is about the existing book, not
browsing net-new accounts.

**Activity (per owning rep × this account only — never team-wide)**
- `meetings`, `calls`, `emails_out`, `emails_in` (int)
- `last_activity_date` (ISO date), `activity_sources` (pipe-joined)

**Proposals**
- `proposed_owner`, `proposal_reason`
  (`misfit` / `assign_unallocated` / `assign_whitespace` / `rebalance` / `manual`),
  `proposal_status` (`suggested` / `accepted` / `rejected` / `manual` / blank)

**Optional**
- `pipeline_value` (float) — open pipeline, when the user supplies it

### How balance is measured

Per segment, per rep: **total account score**, not account count. A rep with 40
weak accounts does not have a bigger book than a rep with 15 strong ones, and
counting rows says they do.

The balance index is the **coefficient of variation** of per-rep total score
(population stdev ÷ mean). CV is scale-free, so it reads the same for a 5-account
team and a 5,000-account one; a raw max/min ratio does not. Labels are policy
constants: **≤ 0.15 balanced, ≤ 0.35 uneven, above that imbalanced.**

**Customers are excluded from balance by default** (`balance.include_categories`
= `allocated` + `unallocated`). A rep is not overloaded because they own
renewals, and moving a customer breaks a live relationship. They are still shown
everywhere else.

**A rep can be excluded too** — set `in_balance=0` in `reps.csv`. This is the
**player-coach** case: a sales leader, a founder, or anyone who legitimately owns
accounts but whose book should not be judged for fairness. Their book stays fully
visible (bars, coverage %, per-account rows, activity) but is left out of the CV,
and the mover treats them as neither donor nor recipient — including in the
misfit phase, since a deliberately odd-shaped book is not evidence of a mistake.
Reach for this instead of `is_rep=0` when the accounts really are being worked:
`is_rep=0` would dump the whole book into `unallocated` and route it away.

**A new hire who hasn't started yet** gets a `reps.csv` row with `is_rep=1`
and `in_balance=0`, even though they own nothing in the CRM. They then appear
on the Overview with an empty book (the distances read "—") and in every Owner
dropdown, so the user can hand them accounts by hand. `in_balance=0` keeps the
mover from filling their empty book on its own. Switch it to `1` once they're
ramped and should be judged with the rest.

### How moves are proposed

`suggest_moves.py`, four phases, least disruptive first — **take the free wins
before churning anyone's book:**

1. **Misfit** — an out-of-segment account its owner is not working moves to the
   right segment.
2. **Unallocated** — an account no active rep owns goes to the lightest book in
   its segment.
3. **Whitespace** — same, for net-new accounts from an account-scoring
   whitespace run.
4. **Rebalance** — only now are already-owned accounts moved between reps, most
   overloaded → most underloaded, choosing the account that most nearly halves
   the gap. Stops at CV < 0.10, or once moves reach 15% of the segment's book.

**The hard constraint, everywhere: an account with activity is NEVER proposed
for a move.** A rep who has met, called, or emailed a prospect has context the
balance maths cannot see, and taking it away to even out a spreadsheet is how
territory planning loses deals. Worked misfits are flagged for a human instead,
and the run reports how many it refused to touch. Double-allocated accounts are
also left alone until the duplicate is resolved — they'd otherwise be counted
against two books at once.

Deterministic: same `territory.csv` + same plan → byte-identical proposals. No
RNG; every tie breaks on `org_id`. Re-running after a review session **preserves
the user's decisions** (accepted and manual moves count as already applied,
rejected rows are never re-proposed) — use `--reset` to start over.

---

## Pipeline

Execute these stages in order. Surface progress between stages.

### Stage 1 — Interview

Goal: collect the input required to produce a first territory plan. Follow these
questions closely and do not go off script — a deterministic interview that is
the same between runs.

**The interview sets starting values, not final ones.** The app's left panel
edits the segments, the cutoff metric and each segment's starting value, the
target accounts per rep, and who on the team is a rep versus who only holds
accounts. Say so once, early: *"Whatever we pick now, you can change in the
app's left panel and see the books move."* That keeps the interview short: take
a sensible answer and move on rather than agonising over the exact line.

**Numbering rule:** the interview has **7 main questions**. Start every
interview message with a progress marker — `**Question N of 7**` — so the user
always knows how much remains. When you combine questions into one message,
label it with the range (e.g. `**Questions 5–7 of 7**`).

**Confirmation rule (applies to EVERY confirm step):** when you ask the user to
confirm something — the segment boundary, the rep roster, the activity sources —
the COMPLETE thing being confirmed MUST be rendered in full, as markdown, in the
SAME message as the question. Never ask "confirm the roster?" while the details
live only in an earlier message, in a tool result, or inside multiple-choice
option labels (interactive question widgets truncate labels — they are NOT a
substitute for printing the list). If anything changed since it was last shown,
re-print the whole updated list, not a diff.

---

**1. Company, and where the account strength comes from.**

Ask the company name + URL (prefill if you know it, ask them to confirm), and
where to store the output (default `./tmp/territory_planning/{company}`).

Then **look for an existing account-scoring run** before asking anything:
check `./tmp/account_scoring/{company}/score.csv` with your file tools. Report
what you found in one line, e.g. *"Found your account-scoring run (4,812 scored
accounts) — I'll use that tuned score as account strength."* If it's somewhere
else, ask for the path.

If there is no run, explain the tradeoff in plain language and let them choose:

> Territory balance needs a measure of how valuable each account is. Two options:
> **(a)** Run `/sumble-account-scoring` first — the score is tuned to *your* ICP,
> so "a big book" means what you mean by it. Best answer, takes longer.
> **(b)** Use Sumble's own account score — generic but instant, ~6 credits per
> account.

Record as `spec.score_source`: `{"kind": "custom", "path": "…/score.csv"}` or
`{"kind": "sumble"}`.

---

**2. Segments, how many accounts each rep carries, and what decides them.**

Ask all three in ONE message.

**(a) What segments do you sell in?** Propose **Enterprise + Commercial** as the
default; don't make them invent it. They may rename, add (SMB, Mid-Market,
Strategic), or use a single segment (one team, no split). Store ordered
**smallest → largest** via `order`.

**(b) How many accounts should a rep in each segment carry?** Ask per segment
("Enterprise reps carry 50, Commercial 150"), the way sales leaders state it.
Store it as `segments[].default_capacity`. It does two jobs, so say both: it is
the most the mover fills a book to, and it is the **top N** the
Kolmogorov-Smirnov distance compares: "is this rep's best 50 as strong as each
peer's best 50" is asked of the book the rep is meant to carry. A rep's own
`capacity` in `reps.csv` overrides it for a genuine exception (ramping,
part-time).

Ask with the arithmetic whenever the unallocated pile is large: *"there are N
unallocated accounts and M reps in that segment, so without a target each gets
about N/M new accounts."* Phase 2 of the mover assigns unowned accounts up to the
target, and a book of thousands of unallocated rows with no target produces an
`actions.csv` no rep can act on.

**(c) What decides which segment an account belongs to?**

Offer these options and record the answer as `boundary.metric`:

| Option | `metric` | Where the value comes from |
|---|---|---|
| **Account score**: the best-fit accounts go to the top segment | `score` | The account-scoring `score.csv` (Path A) or `sumble_score` (Path B). Nothing extra to fetch. |
| **Headcount (total employees)** | `total_employees` | Sumble. Already in `score.csv`; Path B fetches it. |
| **Headcount in one job function** (e.g. Engineering, Sales) | `jf_people:{Function}` | Sumble. See the job-function rules in Q3b. |
| **Revenue** | `revenue` | **The CRM, not Sumble** (Sumble has no revenue data). Salesforce `Account.AnnualRevenue`, HubSpot `annualrevenue`. Pull it into a `revenue` column of `ownership.csv` in Q4. |
| **Another numeric CRM field** (a tier score, ARR, seat count) | `crm:{column}` | A column of that name in `ownership.csv`. |
| **A column already in `score.csv`** | `custom:{column}` | That column verbatim. |

The interactive question widget only fits four options, so offer the first four
(score, total employees, job-function headcount, revenue) and let "Other" cover
the CRM field and `score.csv` column cases.

The app's panel can switch the cutoff later to any metric the account table
carries: the account score, total employees and every `<function>_people`
headcount column with data, revenue when `ownership.csv` has it, and anything
listed in `boundary.options` (a list of metric strings in `spec.json`). Pull a
second candidate now if the user is torn (revenue from the CRM, say) so the
panel can compare them; a metric that was never pulled can't be offered.

Say the consequence of each choice in one line when it matters:
- **Score** makes the top segment "the accounts that fit best", not "the
  biggest". That's a real strategy (put the strongest reps on the best-fit
  accounts), but it means a small company with a perfect fit lands in
  Enterprise. Confirm that's what they mean.
- **Revenue** and other CRM fields only exist for accounts the CRM already has.
  Whitespace and accounts with a blank field read 0 and land in the smallest
  segment; `calibrate_split.py` warns when that's more than 20% of accounts.
- **A categorical CRM field** ("the Segment__c picklist decides it") is not
  supported as a boundary. Say so, and offer the numeric field that picklist was
  set from, or a hard line on one of the metrics above.

Record a display label alongside (`boundary.label`, e.g. `"Annual revenue
(USD)"`); `build_plan.py` fills a sensible default when it's blank.

---

**3. Where the line sits.** Skip it for a single segment.

Ask ONE question: *"Do you have a hard-line rule for where {metric} splits
these segments, or should I calibrate one from your data?"*

**3a. They have a hard line.** Ask for it verbatim and capture the threshold(s),
e.g. "Enterprise is 1,000+ employees", "Enterprise is $500M+ revenue",
"Enterprise is a score of 70+". Store each as `{segment, min}`, inclusive.

**3b. Calibrate it.** If they picked a headcount metric in Q2 and aren't sure
which, propose exactly TWO candidates and let them pick:

1. **Total employee count**, the safe default.
2. **Headcount under their ICP job function.** Often the better line, because
   it sizes the *buying centre* rather than the company. Read the key persona
   from the account-scoring config (or ask), then **snap UP to a broad,
   top-level parent job function** and suggest that.

   > **Never suggest a granular child function.** "DevOps Engineer" or "SRE"
   > reads zero at most companies below a few thousand people, so the "boundary"
   > ends up sorting on whether Sumble has data, not on size. A broad parent
   > (`Engineer`, `Sales`, `Marketing`) is dense enough to size anyone. It will
   > sweep in adjacent roles (an electrical engineer lands under `Engineer`);
   > that is the correct trade, because density is what makes the line hold.
   >
   > Worked examples: for **Sumble** (sells to sales teams) suggest **`Sales`**.
   > For **Datadog** (sells to engineering) suggest **`Engineer`**. Not "Account
   > Executive", not "DevOps Engineer".

   Resolve the display name with `lookup.py --titles "{name}"` before using it.
   The endpoint takes the canonical **display name**, and a wrong one 400s with
   a "did you mean" list.

   On Path A, if the scoring run never fetched that function, pull just that one
   metric with `fetch_light.py --from-score … --only-jf "{Name}"`.

For score, revenue and CRM fields there is no candidate to choose; calibrate
the metric they named.

Then run `calibrate_split.py` and present the result. It picks its own method:
**supervised** (two segments and the reps' segments are already known) sweeps
thresholds and picks the one leaving the fewest reps working out-of-segment
accounts, so the reps' actual behaviour defines the line; **k-means**
otherwise (on log(size) for headcount and revenue, on the raw value for a
score). Either way the answer is snapped to a round number: 500 / 1,000 / 2,500
employees, $10M / $25M / $50M revenue, a multiple of 5 on a score.

**Print the whole proposal in the message**: the method and why, the
distribution (p10/median/p90), the proposed line, how many accounts land in each
segment, and any warning. **Always surface a warning if one fires**, and act on
it:
- the density warning (">30% of accounts below the line read zero on this
  metric"): offer the broader function or total employees instead;
- the missing-values warning (>20% of accounts have no value): usually a
  revenue or CRM field that is blank for whitespace and new accounts;
- the empty-segment warning (the line puts no accounts in a segment): the
  metric does not separate how the reps' books are split today. Ask for a hard
  line or offer a different metric.

Then confirm.

---

**4. Where territory ownership lives.**

Inspect the session's MCPs and **surface relevant ones by name** (Salesforce,
HubSpot, Snowflake/BigQuery/Databricks/Postgres, Sheets/Drive); else ask for a
CSV path. Then run the source-confirmation flow — **never assume**:

list tables → hypothesise the source (Salesforce `Account` with
`Owner.Name`/`OwnerId`; HubSpot `companies` with `hubspot_owner_id`; a warehouse
`dim_accounts.account_owner`) → **confirm in one prompt** → sample-read
`LIMIT 10` and verify the join keys (account name, domain/website) → full pull.

Ask these while you're there:
- If the boundary metric is **revenue** or another **CRM field** (Q2), pull it
  into `ownership.csv` as a column named `revenue` (or the `crm:{column}`
  name). Sample it in the `LIMIT 10` read: a field that's blank on most rows is
  a bad boundary, and it's cheaper to find out now.
- Does the source encode **which segment each rep sells** (a role, team, or
  user-type field)? If yes, use it and skip the guessing in Q5.
- Does it mark **customers / closed-won**? Customers are excluded from balance,
  so this materially changes the numbers. Map it to `is_customer` in
  `ownership.csv`.

---

**5. The rep roster.**

Build the roster from the distinct owners in the ownership pull, then run
`calibrate_split.py` (already run in Q3 — reuse its `rep_segment_guesses`) to
guess each rep's segment from the median size of the accounts they own. A rep
with fewer than 3 matched accounts is `unknown` — ask, don't guess.

**Print the FULL roster table in the message** — rep, email, guessed segment,
#accounts, median account size — and flag anyone who looks like **not a real
seller**:

- queues and pools ("Unassigned", "House Accounts", "Inbound Queue")
- integration / system users
- **departed employees** — a name that owns accounts but is inactive in the CRM.
  Ask directly: *"Is anyone on this list no longer with the company?"* Their
  accounts should surface as unallocated, which is exactly what a territory
  review is for.
- **warehouse owners** — a manager, founder or other non-seller whose name sits
  on a pile of accounts nobody is working. **Always ask this one directly, as its
  own question:** *"Does anyone hold accounts as a warehouse rather than working
  them? Their accounts would count as unallocated, up for reallocation."* Name
  the likely candidates from the data: the owners with the most accounts and
  the least activity, and anyone whose title is a leader or founder. In the app
  they show as **Holds accounts**, their accounts sit in the Unallocated row
  with their name in *Held by*, and the Team panel can flip them back.

Set `is_rep=0` for each of those. Loop on the user's corrections until accepted.
**Keep every CRM owner in `reps.csv`**, holders included: the Team panel lists
everyone whose name is on accounts, and a person missing from the roster can
only be added there by name.

**Watch for the player-coach — the third answer people don't know to ask for.**
A sales leader, founder, or CS lead who owns real accounts fits neither
`is_rep=1` (their book is odd-shaped, so it drags the segment CV and invites
pointless move proposals) nor `is_rep=0` (which would dump a genuinely-worked
book into `unallocated`). Set **`in_balance=0`** instead. The tell is a rep whose
median account size is wildly out of line with their stated segment, or who owns
a large book with almost no customers. Offer it explicitly rather than forcing a
binary — and if you spot the mismatch in the data, say so with the numbers before
asking.

**Collect rep emails — they are the join key for all activity.** Take them from
CRM user records where available; otherwise ask; as a last resort propose the
obvious pattern (`first.last@{company-domain}`) and **confirm it explicitly**. A
rep with no email will have every account read "not worked", so `build_plan.py`
warns about it — surface that warning to the user rather than letting the
coverage numbers lie.

---

**6. Activity sources + window.**

Inspect the session's MCPs and offer whichever actually exist, by name:

| Source | MCP | Event kind |
|---|---|---|
| Meetings | Google Calendar | `meeting` |
| Calls | Gong · Fireflies · Granola | `call` |
| Email | Salesforce (EmailMessage / Task) · Gmail | `email_out` / `email_in` |

Let them pick any subset. **Window default: 90 days**, configurable.

State the two things plainly, in the message:
> Activity is counted **between the owning rep and that account only** — not
> across the team. And only **counts and dates** are stored: no subjects, no
> transcripts, no message bodies.

**Activity matching rules (you apply these when writing the event CSVs):**
- Normalise every domain: lowercase, strip scheme, `www.`, path, port, leading `@`.
- **Drop free-mail domains and the seller's own domain.** A rep emailing their
  own colleagues, or their personal Gmail, is not account activity. (The
  canonical list is `territory_lib.FREEMAIL_DOMAINS`; `merge_territory.py`
  enforces it again as a backstop.)
- **Calendar** — an event in-window where the rep is organiser or attendee AND
  ≥1 other attendee's email domain matches an account domain → one `meeting`.
- **Call recorders** — a recorded meeting in-window where the rep is host or
  participant AND a participant domain matches an account → one `call`.
- **Salesforce email** — read BOTH places Salesforce keeps it; most orgs use
  Tasks far more than Enhanced Email.
  - `EmailMessage` (Enhanced Email): the rep is the sumble-side address in From
    (out) or To/Cc (in), not `CreatedBy`, which is often an integration user.
    The account is `RelatedToId`, else the other side's email domain.
  - `Task` with `TaskSubtype = 'Email'` (Gmail/Outlook loggers, Nooks,
    Outreach): usually logged against a **Lead**, so `AccountId` is blank. Get
    the address with `TYPEOF Who WHEN Lead THEN Email WHEN Contact THEN Email
    END` and match its domain to an account. Skip Tasks whose Id is an
    `EmailMessage.ActivityId`: Enhanced Email made them, and they'd count twice.
    Read direction from the subject when the logger marks it (Nooks writes
    `[Nooks] [Email In] - …` / `[Email Out]`); unmarked Tasks are sent mail.
  - One row per email, never one per day: a thread of ten emails is ten.
  - Drop free-mail domains before matching: a lead at gmail.com is a person,
    not the Gmail account.
  - A rep with zero email in Salesforce is not logging it (their mailbox isn't
    connected). Say so with the per-rep counts rather than reporting them idle.
- One row per event. Do not pre-aggregate — `merge_territory.py` does the
  roll-up, so the same event never counts twice.

---

**7. Optional extras.** Ask both in ONE message:

- **(a) Open pipeline value per account.** Often the real reason a book *feels*
  unfair. A CSV of `domain,pipeline_value`, or a sum of open opportunities.
  Shown per rep; not used to propose moves.
- **(b) Whitespace routing depth** — only if the scoring run produced whitespace:
  how many top net-new accounts to route to owners (**default 50**). The rest are
  dropped from the sheet; territory planning is not the place to browse 10,000
  whitespace rows.

---

### Stage 2 — Build the data

Write these into `{output_root}/_raw/` with your file tools:

- **`spec.json`** — everything confirmed above:
  ```json
  {
    "schema_version": 1,
    "company": {"name": "Acme", "url": "acme.com", "folder_slug": "acme"},
    "score_source": {"kind": "custom", "path": "/abs/…/score.csv"},
    "segments": [{"key": "commercial", "label": "Commercial", "order": 1,
                  "default_capacity": 150},
                 {"key": "enterprise", "label": "Enterprise", "order": 2,
                  "default_capacity": 50}],
    "boundary": {"metric": "total_employees", "label": "Total employees",
                 "thresholds": [{"segment": "enterprise", "min": 1000}]},
    "activity": {"window_days": 90, "sources": ["google_calendar", "fireflies"],
                 "company_domain": "acme.com"},
    "whitespace_top_n": 50,
    "strong_cutoff": 500
  }
  ```
  `default_capacity` is the target accounts per rep, and also the top N the
  Kolmogorov-Smirnov distance compares. A single segment needs no thresholds.
  `boundary.options` is optional: extra metric strings (e.g. `["revenue"]`) the
  app's panel should offer as cutoffs. `activity.as_of`
  is optional too: a YYYY-MM-DD end for the window, for replaying an old pull;
  unset means today.
  `activity.attribution` is `owner` (default: only the account owner's own
  events mark it worked) or `anyone` (any colleague's meeting, call, email or
  Slack post counts, so an account a CSM or engineer is working reads as worked).
  Ask the user which they want; pull activity for everyone at the company when
  it is `anyone`.
- **`ownership.csv`** — `crm_account_id,name,domain,owner,owner_email,owner_is_queue,is_customer`,
  plus a `revenue` (or `crm:{column}`) column when that is the boundary metric
- **`reps.csv`** — `name,email,segment,is_rep,capacity,in_balance`
  - `capacity` — blank inherits the segment's `default_capacity`; set it only
    for a genuine exception.
  - `in_balance` — blank/`1` normally; `0` for a **player-coach** whose book
    should be visible but neither measured for fairness nor moved off.
    Also `0` for a new hire with no accounts yet, so only manual moves fill
    their book.
- **`activity/{source}.csv`** — one file per source:
  `source,rep_email,account_domain,kind,ts` (`kind` ∈ `meeting|call|email_out|email_in|message`;
  `message` is a post by someone at the seller in a Slack Connect channel shared with the account)
- **`accounts.csv`** (Path B only) — `crm_account_id,name,domain`
- **`pipeline.csv`** (optional) — `domain,pipeline_value`

Then run each as ONE command with absolute paths — no `cd`, no chaining:

```bash
# Path B only — resolve accounts + pull sumble_score / employee_count
python3 {skill_dir}/template/_build/fetch_light.py --raw {output_root}/_raw
# Path A supplement — only when the boundary needs a job function the scoring run lacks
python3 {skill_dir}/template/_build/fetch_light.py --raw {output_root}/_raw --only-jf "Engineer" --from-score {path}/score.csv
# Boundary proposal (Q3b) — prints JSON, writes nothing
python3 {skill_dir}/template/_build/calibrate_split.py --raw {output_root}/_raw
# After the boundary + roster are confirmed:
python3 {skill_dir}/template/_build/build_plan.py --raw {output_root}/_raw
python3 {skill_dir}/template/_build/merge_territory.py --raw {output_root}/_raw
python3 {skill_dir}/template/_build/suggest_moves.py --dir {output_root}
```

**Surface the merge summary to the user** — allocated / unallocated /
double-allocated / misfit / not-worked / strong-idle counts, the per-segment
CV, and any rep whose KS is significant (no "within noise" tag). That summary IS the finding; don't let it scroll past silently. Call out
these three explicitly if they fire:
- ownership rows that matched no org (unmatched by Sumble, or outside the scored set),
- **no activity events found at all** — the coverage numbers are then meaningless;
  check the rep emails and the activity pull before going further,
- whitespace trimmed to the routing depth.

**Path B credit cost** ≈ 6 credits per matched org; state the estimate before
running a large pull.

---

### Stage 3 — Generate the app

```bash
mkdir -p {output_root}/static
cp {skill_dir}/template/app.py                    {output_root}/app.py
cp {skill_dir}/template/_build/territory_lib.py   {output_root}/territory_lib.py
cp {skill_dir}/template/README.md                 {output_root}/README.md
cp {skill_dir}/template/Dockerfile                {output_root}/Dockerfile
cp {skill_dir}/template/.dockerignore             {output_root}/.dockerignore
cp {skill_dir}/template/static/index.html         {output_root}/static/index.html
cp {skill_dir}/template/static/app.js             {output_root}/static/app.js
cp {skill_dir}/template/static/style.css          {output_root}/static/style.css
cp {skill_dir}/template/static/logo.svg           {output_root}/static/logo.svg
cp {skill_dir}/template/static/favicon.svg        {output_root}/static/favicon.svg
```

`territory_lib.py` sits beside `app.py` as a sibling module (it is stdlib-only),
exactly like `score_sheet.py` in account-scoring. The `Dockerfile` +
`.dockerignore` make the app **fly-deploy-ready** (`/fly-deploy`) with no extra
steps; they're inert for a local run. HTTP Basic Auth is **env-gated** — it
activates only when `BASIC_AUTH_PASS` is set, so `python3 app.py` stays open
locally.

**A deployed app forgets decisions unless it has a volume.** fly.io and Cloud
Run reset the container's disk on every restart and deploy, and fly's
scale-to-zero restarts it after a few idle minutes. When people will make
moves on the deployed app, set `DATA_DIR` to a persistent volume. On fly:
`fly volumes create territory_data --size 1 -a <app>` once, then add
`DATA_DIR = "/data"` to `[env]` and a `[mounts]` section
(`source = "territory_data"`, `destination = "/data"`) to `fly.toml`, and
run one machine (`--ha=false`), since a volume attaches to one. The app
copies the image's plan and sheet onto the volume when the sheet changes
and replays `changes.jsonl` onto it, so refreshed data keeps every decision.

Write `{output_root}/.gitignore` via your file tool:
```
__pycache__/
*.csv
```

Before handing over, spot-check `territory.csv` with your file tools: the header
must match the schema above, and at least one row should carry a non-blank
`owner`. If every row is unallocated, the ownership join failed — fix it before
telling the user the app is ready.

---

### Stage 4 — Run instructions

Print this. Don't try to run the server yourself — let the user start it in a
terminal where it stays up.

```bash
cd ./tmp/territory_planning/{company}
python3 app.py
# open http://localhost:8002 in your browser
```

No `pip install`, no virtualenv — `app.py` is stdlib-only and runs on any
Python 3.10+. Override the port with `python3 app.py 9002` or `PORT=9002`.

Tell them how to work it, in this order:

1. **Overview** — a **rep heatmap** (this is the home page; there is no separate
   Reps tab). There is **one table per segment**: a rep is only ever compared
   with their own segment's peers, so rows never share a scale across
   segments. A **segment filter** at the top (`All segments` by default, plus
   one pill per segment) shows every segment's table or just one.

   Rows are reps, with their **Accounts** (in-segment count) and how many of
   those are **Customers**, then two
   Kolmogorov-Smirnov distances, each followed by its **Activity** column when
   activity is loaded: distance top N, Activity top N, distance all accounts,
   Activity all accounts.
   One row, in italics, is **Unallocated**: the segment's unowned accounts read
   as if they were one more book, against the reps' books. It sorts with the
   reps, so it lands where it ranks.
   It is never a rep's peer, so rep readings don't move. A positive top-N
   distance means the pool's best accounts beat the reps' best, so strong
   accounts are sitting unowned. Clicking the row opens the pool like a rep's
   book (step 3).
   The table sorts by the top-N distance by default. There is deliberately no
   average-rank depth column: an earlier "average segment rank of the top 25"
   column confused RevOps users more than it helped.

   Conditional formatting shades each column within its segment. **Every
   header sorts** (one sort shared by every segment's table): click to sort,
   click again to flip. **Clicking a rep opens their accounts** (step 3).

   The metric columns, each with a plain-language tooltip on the header. Write
   the name out as "Kolmogorov-Smirnov distance" when you talk to the user; the
   user asked for that over "KS".
   - **Kolmogorov-Smirnov distance, top N** (default sort). Does the rep have as
     much good opportunity as their peers? It takes the rep's best N accounts by
     score and each peer's best N, pooled, and measures the widest gap between
     the two cumulative distributions. A rep with fewer than N accounts has
     empty slots scoring 0, so a thin book reads weaker; accounts past N don't
     count, so a pile of weak accounts doesn't help. Every rep in a segment is
     read on the same N slots, so the noise is the same for all of them. N is
     the segment's target accounts per rep (`default_capacity`), set in the
     Segments panel.
   - **Top N scores.** Each rep's best N scores as a small box plot on one
     scale for the segment (box: middle half, whisker: 10th to 90th
     percentile, tick: median, dashed line: the reps' median). The distance
     says how far a book is from its peers; the strip shows where, e.g. a
     strong top end but a thin middle. A book short of N is drawn faded.
   - Above each table, a line counts the reps whose top-N distance is beyond
     chance (p < 0.05), weaker and stronger, so a segment with a real fairness
     problem reads as one at a glance. A segment with no reps says so instead
     of disappearing.
   - **Kolmogorov-Smirnov distance, all accounts.** Is the rep's mix as strong
     as their peers'? The same distance over whole books. It ignores book size,
     so a rep with 30 accounts and one with 300 can both read 0. Small books
     read bigger by chance.

     For both: `0` = even, `+` = stronger, `−` = weaker, `±1` = no overlap.
     Green for positive, amber for negative, deeper further from 0. Readings
     with p ≥ 0.05 are greyed and unshaded. Player-coaches (`in_balance=0`) get
     a reading but are never part of anyone else's peer pool, so a segment
     whose only other rep is a player-coach shows "—". The two columns
     disagreeing is the point: a big book of average accounts reads `+` on top
     N and `−` on all accounts (more opportunity, weaker mix); a small book of
     good accounts reads the other way round.

     **Clicking either distance opens the rep's ranking** in the side panel:
     both readings, their in-segment accounts strongest first with segment rank,
     score and worked status (with a divider where their top N ends), and a
     chart for the clicked reading on in-segment rank: the share of each side in
     the segment's top x, with the widest gap marked. The distance is computed on
     score, but it only sees order, so rank gives the same number; rank just
     reads more naturally ("60% of their top 50 are in the segment's top 200").
     Clicking anywhere else on the row opens the rep's accounts (step 3).

     Rough reading guide for users: under 0.1 is even, 0.1–0.25 is worth a
     look, above 0.25 is a real difference. `merge_territory.py` prints both
     readings and p-values for every rep; quote the significant outliers in the
     merge summary.
   - **Activity, top N** and **Activity, all accounts**. The share of the rep's
     top N in-segment accounts by score (or all of them, if they have fewer),
     and of all their in-segment accounts, with a meeting, call, or outbound
     email in the activity window (`activity.window_days`, default 90). A plain
     count: every account counts the same, with no score weighting. Read each
     next to its distance: a strong top N with low Activity on it is good
     accounts parked with someone who isn't working them.

   Two things make the ranks trustworthy, both learned the hard way:
   - **Rank within a single segment only.** A rep's book mixes segment sizes — a
     marquee account below the size line still lives in Commercial — and a
     Commercial rank of 2 is not comparable to an Enterprise rank of 2. Averaging
     ranks from two universes produces impossible numbers (an average below the
     arithmetic floor of `(N+1)/2`). The matrix ranks each rep's accounts only
     against their own segment, and counts only their **in-segment** accounts.
   - **"Accounts" ≠ total book.** The count column is the rep's in-segment accounts,
     which is often far below what they own — an enterprise rep sitting on a pile
     of commercial-sized accounts (misfits to shed) is exactly what that gap
     reveals.

   (Book-balance itself — the coefficient-of-variation across reps — still drives
   the mover, it's just no longer the Overview's headline.)
2. **Segments and Team** (the left panel) — every interview answer, editable.
   **Segments:** the cutoff metric (any `boundary.options` entry), and per
   segment its name, its starting value and its target accounts per rep; add
   or remove segments. The counts under each segment update as you type.
   Switching the metric moves each line to keep the same share of accounts per
   segment. **Team:** everyone whose name is on accounts in the CRM, with a
   role: a rep in a segment (with a *balanced* box, off for a player-coach) or
   **Holds accounts** (their accounts count as unallocated; a warehouse owner).
   **Apply** re-derives ownership and segments, refreshes the suggestions and
   keeps every accept / reject / manual decision. The app saves the settings to
   `panel-config.json` and re-applies them on start, so re-running the pipeline
   or redeploying keeps them; delete that file to go back to the plan the
   pipeline wrote. With `activity.attribution = "owner"`, re-run the pipeline
   after promoting someone to a rep: activity was counted for the previous
   owner. The strong-account cutoff (`strong_cutoff`) is still set in
   `spec.json`.
3. **A rep's accounts** — there is no Accounts tab: account moves happen
   here. Clicking a rep (or the Unallocated row) on the Overview opens their
   book in a side sheet over the Overview (×, Esc or a click outside closes
   it), with both distances (each opens the chart), a search box and one
   filter row: **Idle** (the default: no meeting, call, email or Slack post in
   the window, so these are the accounts to move first), **Customers** (shown
   when the book has any) and **All**. Customer rows carry a blue left edge
   and a *Customer* tag, so expansion accounts stand out when splitting a
   book. Columns: in-segment rank, account, score, one column per score
   component when the account table has them (below), activity count,
   *Held by* for the pool, and **Owner**, a dropdown on every row. Picking a rep records a manual move;
   the account stays in the list showing its new owner. When the balancer
   suggests a move, that owner sits at the top of the dropdown marked
   "suggested" (picking it accepts), the control is tinted, and a **dismiss**
   link rejects it. The app groups by **effective owner** (current owner +
   accepted/manual moves), so the Overview tables under the sheet update with
   each move.
   **Score components.** Any account-table column named `component:<name>`
   (for example `component:Size`, `component:PLG`) rides through
   `merge_territory.py` into `territory.csv` and shows as a column after
   Score, shaded against the rest of the book and sortable. Use it to show
   why an account scores well, so the user can hand a rep accounts with a
   chosen profile (heavy PLG use, fast growth). The app never computes with
   them. Keep the names short: they are column headers.
4. **Fix the double-allocations first.** Two reps on one company distorts every
   other number.
5. **Changes** — every proposed owner change, whatever its state: suggested,
   approved (accepted or manual) or dismissed, with a filter for each, the time
   of its last decision, and the same Owner dropdown to approve, undo or
   dismiss it. Below it, a **log** of every decision made in the app, newest
   first ("Moved from A to B", "Dismissed suggestion", "Move cleared"). The log
   is `changes.jsonl` next to `territory.csv`, one JSON line per decision;
   `territory.csv` only holds each account's current state. The app replays
   the log on start, so re-running the pipeline keeps every decision; a move
   the CRM has since made is cleared. Delete `changes.jsonl` to start over. `actions.csv` (the
   approved changes) is the hand-off to the CRM. **This app never writes to
   your CRM.**

For anything that looks off: a segment routing nothing usually means capacity
(`default_capacity` in `spec.json`), and a rep with implausible misfits usually
means the boundary (`boundary.thresholds` in `spec.json`). Re-running `suggest_moves.py` from the CLI does the same thing and
refines around decisions already made; `--reset` starts over.

**Close with the privacy note**: activity is counts and dates only, per owning
rep per account — no subjects, no transcripts, no bodies — and nothing leaves
the user's machine.
