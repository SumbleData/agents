# Balance territories on value, not account counts

Most territory planning deals accounts out until every rep's pile is the same size. The piles can be even and the books still rigged: one rep holding the segment's best accounts, everyone else working filler. The better question has two halves: who holds the valuable accounts, and are they actually working them?

**Skill:** [`sumble-territory-planning`](../SKILL.md). Run it in Claude Code, Codex, or Cursor.

Companion to [`sumble-account-scoring`](../../sumble-account-scoring/articles/01-account-score-should-tell-a-rep-what-to-do.md): scoring answers *which accounts are strong*; this skill answers *are the right reps on them, and are the books fair*.

## TLDR
- An even account count is not a fair book: a rep with an exactly average-sized book can still hold most of the segment's best accounts.
- **Rank accounts within each segment.** Account scoring can now be precise enough that #8 is meaningfully better than #15, and #15 is meaningfully better than #40. You lose that detail when you bucket accounts into coarse tiers like Tier A, Tier B, and Tier C.
- **Measure each rep's top-account share.** Within a segment, look at each rep's share of the top 20, top 50, and top 100 accounts. Aim for similar shares at each cutoff. We saw a segment with 600 ranked accounts where one rep got the top 20 and another got the bottom 20. Same number of accounts, very different shot at quota. If you want one metric across all ranks, the Kolmogorov-Smirnov distance measures the largest gap between a rep's cumulative rank distribution and the segment's overall distribution.
- **Rebalance untouched accounts first.** You can make books fairer without disrupting active work. It also gives reps a reason to work their accounts and make sure that activity is captured in the CRM.

Every sales org redraws territories the same way: count the accounts, divide by the reps, nudge until the piles look even. Maybe you weight by pipeline or named-account tier. The spreadsheet says twenty reps, ~75 accounts each — fair. Then a rep opens their book and finds 75 names they'd never call.

## An even count is not a fair book

Two reps with 75 accounts each can hold completely different books. One has eight of the segment's twenty best accounts; the other has none of them and 75 long-tail names. Count-based balance calls that fair. Everyone on the team knows it isn't — they just can't point at the number that proves it, because the only number they were handed was the count.

Concentration is invisible to a headcount split precisely because it's about *which* accounts, not *how many*. So stop measuring the size of the pile and start measuring its value.

## Two questions, kept apart: KS and Activation

"Is this book fair?" is really two questions, and jamming them into one number is why territory dashboards get ignored. The skill keeps them apart, as two columns a RevOps lead can read without a decoder ring.

**KS: is this rep's book as strong as their peers'?** Line up every account in a rep's book by ICP score, and do the same for every other rep in the segment pooled together. Walk up the score scale and, at each point, compare the share of each book that falls below it. The widest gap is the Kolmogorov-Smirnov distance. 0 means the rep was dealt the same mix of strong and weak accounts as everyone else; +0.3 means their book skews clearly stronger; −0.3, clearly weaker. Under 0.1 is even. Above 0.25 is a real difference.

I like KS here for two reasons. It's blind to book size, so a rep with 30 accounts and a rep with 300 can both read 0, and quantity stays a separate column instead of leaking into the quality number. And it comes with a p-value, so a ramping rep with eight accounts who looks lopsided by luck is greyed out instead of flagged. Click any KS value and the app shows that rep's accounts ranked against the segment, with the two distributions drawn and the gap marked.

**Activation — of the best business a rep already holds, how much are they working.** Same weighting, different question: what share of it has had a meeting, call, or outbound email in the activity window. It's deliberately independent of book size — a rep with 30 accounts and a rep with 300 can both be at 100%.

Splitting them turns a vague "seems off" into a diagnosis. The quadrant that costs you money is **strong book, low Activation**: the segment's best accounts are parked with someone who isn't touching them. No account count will ever surface that. It's the single most expensive thing a book can be doing, and it's the first thing this app shows you.

## Rank within a segment, not globally

A rep's book mixes segment sizes — a marquee account that falls just below your enterprise line still lives in Commercial — and a Commercial rank of 2 is not comparable to an Enterprise rank of 2. Average ranks across both universes and you get numbers no real book could produce.

So the app compares each rep only against peers in their own segment, and when you click into a rep it ranks their accounts against that segment alone. Coverage adds a whole-book column so you can see how far activity falls off past the best accounts.

## The value has to be real

KS and Activation are only as good as the "value" underneath them. If value means headcount, you've rebuilt the size ranking you were trying to escape; if it means gut feel, reps won't trust the reassignment.

This skill takes account strength from a [`sumble-account-scoring`](../../sumble-account-scoring/articles/01-account-score-should-tell-a-rep-what-to-do.md) run — a score calibrated to *your* closed-won deals, where every component links through to the people, teams, and projects behind it. (No scoring run yet? It falls back to Sumble's own account score via the API.) Either way, "the segment's best accounts" means best *for you*, not biggest, and a rep facing a proposed move can click through to why the account is worth taking.

## The flags a balance number hides

Balance is the average; the flags are where the money leaks. The app surfaces five, each a filter on the account list:

- **Strong but idle** — a top account, owned, and nobody's working it. The most expensive kind of neglect.
- **Strong but unallocated** — a top account with no active owner at all.
- **Wrong segment** — the account's size puts it in one segment; its owner sells another.
- **Double-allocated** — two reps own CRM records that resolve to the same company. Fix these first: they distort every other number.
- **Not being worked** — owned, but untouched in the window.

A top-N "strong account" cutoff recomputes the strong-* flags live, so you can tighten the definition of "strong" and watch the neglect list shrink or grow.

## Suggest, review, export — the CRM is never touched

An automated reassignment that's wrong is worse than the imbalance it fixed. So the balancer only *proposes*. It measures how uneven each segment's books are (a coefficient of variation across reps), then suggests the smallest set of owner moves that pulls them into balance — respecting per-rep capacity, handing wrong-segment accounts back, and giving unallocated strong accounts an owner.

The proposals land in a review queue as the app's primary call to action. One dropdown per account does everything: accept the suggestion, pick a different rep, or dismiss it. Because the whole app groups by *effective owner* (current owner plus your accepted moves), the heatmaps and flags update the moment you decide — you see a move help before you commit to it. When you're done, one button writes `actions.csv`: a plain list of approved owner changes keyed by CRM account id, ready for your admin or a follow-up agent run. Nothing is written back automatically.

## What it looks like on a book

The repo ships a runnable demo at [`examples/territory-planning/`](../../../examples/territory-planning) — a fictitious vendor, *Northwind*, with 1,935 accounts and 20 reps (10 Enterprise, 10 Commercial). The data is synthetic, but it's built to show the shapes you'll recognize:

- **Tom Harris** holds the biggest Enterprise book and the strongest one (KS +0.32) — and works almost none of it (4% Activation). The sitting-on-value quadrant, invisible to an account count.
- **Marcus Bell** is the other end: a normal-sized Enterprise book that skews clearly weaker than their peers' (KS −0.30).
- **James Walker** is the foil: a smaller book worked to 100% Activation.
- **Grace Mitchell** is a ramping rep at 0% — a small book by design, so a low number reads as "new," not "failing."
- **Alex Morgan** is the commercial star: the biggest book, the strongest mix (KS +0.29), and works it hardest.

Under the current settings the balancer makes 480 proposals — owners for 445 unallocated accounts, 18 wrong-segment handbacks, 17 rebalance moves — which together would take both segments from uneven (CV ≈ 0.3) to balanced (≈ 0.1) if every one were accepted. Which, of course, they shouldn't be blindly. That's what the review queue is for.

```bash
cd examples/territory-planning
python3 app.py        # http://localhost:8002
```

Stock Python 3.10+, no dependencies.

## Run it on yours

You need a coding agent (**Claude Code**, **OpenAI Codex**, or **Cursor**), your CRM ownership (Salesforce, HubSpot, a warehouse, or a CSV with account, owner, and a size signal), and ideally an existing account-scoring run for the value column. Connect whatever activity sources you have — Google Calendar, Gong, Fireflies, Granola, Salesforce email — and Activation lights up; skip them and you still get balance and segment fit.

```bash
npx skills add SumbleData/agents --skill sumble-territory-planning
```

Start a new agent session and run it (`/sumble-territory-planning` in Claude Code; "use the sumble-territory-planning skill" in Codex or Cursor). The interview sets your segments (Enterprise + Commercial by default), what decides them (account score, headcount, revenue from your CRM, or another CRM field), whether the line is a hard rule or should be calibrated from your data, and your target book size per segment. Then:

```bash
cd territory_planning/<your-company>
python3 app.py        # http://localhost:8002
```

Calibrate the line and the targets, work the suggested-moves queue, export `actions.csv`.

## The part that compounds

A territory plan is usually a once-a-year fire drill that's stale by Q2: someone rebuilds it in a spreadsheet, everyone argues, and the books drift the moment a rep leaves or an account heats up. Keying territories to a live account score changes that. Re-run it, and the accounts that got stronger, the reps who fell behind on coverage, and the new hire who needs a book all show up as fresh moves in the same queue. The plan stops being a project and becomes a habit.

It also sits on the same foundation as the rest of the GTM engine. [`sumble-crm-cleaning`](../../sumble-crm-cleaning/articles/01-clean-your-crm-against-the-org-graph.md) resolves every account to a real organization — and catches the double-allocations before they distort your balance. [`sumble-account-scoring`](../../sumble-account-scoring/articles/01-account-score-should-tell-a-rep-what-to-do.md) tells you which accounts are worth fighting over. This skill puts the right reps on them.
