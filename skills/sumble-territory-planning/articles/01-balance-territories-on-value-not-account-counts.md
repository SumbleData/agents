# Balance territories on value, not account counts

Most territory planning deals accounts out until every rep's pile is the same size. The piles can be even and the books still rigged: one rep holding the segment's best accounts, everyone else working filler. The better question has two halves. Who holds the valuable accounts, and are they actually working them?

**Skill:** [`sumble-territory-planning`](../SKILL.md). Run it in Claude Code, Codex, or Cursor.

Companion to [`sumble-account-scoring`](../../sumble-account-scoring/articles/01-account-score-should-tell-a-rep-what-to-do.md). Scoring answers *which accounts are strong*. This skill answers *are the right reps on them, and are the books fair*.

## TLDR
- An even account count is not a fair book. A rep with an exactly average-sized book can still hold most of the segment's best accounts.
- **Rank accounts within each segment.** Account scoring can now be precise enough that #8 is meaningfully better than #15, and #15 is meaningfully better than #40. You lose that detail when you bucket accounts into coarse tiers like Tier A, Tier B, and Tier C.
- **Measure each rep's top-account share.** Within a segment, look at each rep's share of the top 20, top 50, and top 100 accounts. Aim for similar shares at each cutoff. We saw a segment with 600 ranked accounts where one rep got the top 20 and another got the bottom 20. Same number of accounts, very different shot at quota. The Kolmogorov-Smirnov distance rolls every cutoff into one number: it is the gap at whichever cutoff is most lopsided.
- **Rebalance untouched accounts first.** You can make books fairer without disrupting active work. It also gives reps a reason to work their accounts and make sure that activity is captured in the CRM.

Every sales org redraws territories the same way. Count the accounts, divide by the reps, nudge until the piles look even. Maybe you weight by pipeline or named-account tier. The spreadsheet says twenty reps, about 75 accounts each, fair. Then a rep opens their book and finds 75 names they'd never call.

## An even count is not a fair book

Two reps with 75 accounts each can hold completely different books. One has eight of the segment's twenty best accounts. The other has none of them and 75 long-tail names. Count-based balance calls that fair. Everyone on the team knows it isn't, but they can't point at the number that proves it, because the only number they were handed was the count.

Concentration is invisible to a headcount split because it's about *which* accounts, not *how many*. So stop measuring the size of the pile and start measuring its value.

## The metric: Kolmogorov-Smirnov distance

Rank every account in the segment by ICP score, 1 = best. Now take one rep and ask a simple question at every cutoff: what share of their accounts sits in the segment's top 10? The top 20? The top 100? Ask the same of every other rep in the segment, pooled together. Plot both as lines that climb from 0% to 100% as the cutoff loosens.

If the rep was dealt the same mix as their peers, the two lines sit on top of each other. If they were dealt the segment's best accounts, their line climbs faster. The **Kolmogorov-Smirnov distance** is the widest vertical gap between the two lines, signed: positive when the rep's book is stronger, negative when it's weaker. It runs from −1 to +1. Under 0.1 is even. 0.1 to 0.25 is worth a look. Above 0.25 is a real difference.

The app shows it two ways. **Top N** compares each rep's best N accounts, where N is the segment's target book size. **All accounts** compares whole books. Click a rep and you get the chart, both lines drawn and the gap marked, above their accounts.

### Why KS and not something simpler

The obvious alternatives each break in a way that matters for territories.

**An average score hides the shape.** A rep with five superb accounts and 45 dead ones can average the same as a rep with 50 middling ones. Those are different jobs. KS reads the whole distribution, so the two books look different, because they are.

**A top-20 share depends on the cutoff you picked.** The share of the top 20, top 50 and top 100 is the right instinct, and it's what the TLDR recommends looking at. But you have to pick the cutoffs, and a book can look fair at 20 and rigged at 50. KS checks every cutoff at once and reports the worst one. It is literally "the top-x share gap, at the x where the gap is largest."

**Raw scores are fragile; ranks aren't.** KS works on ranks within the segment. Recalibrate the score model so that 70 becomes 85 but the order holds, and the distance doesn't move. One freak account with a score of 99 can't drag a book's number around the way it drags an average.

**Book size stays out of it.** The all-accounts reading compares the mix, so a rep with 30 accounts and a rep with 300 can both read 0. That keeps quantity in its own column instead of leaking into the quality number. The top-N reading handles the opposite problem: it compares each rep's best N, so a giant book can't look strong just by carrying more names, and a book with fewer than N accounts counts its empty slots as empty.

**It knows when a gap is noise.** KS comes with a p-value. A ramping rep with eight accounts can look lopsided by luck alone, and a reading with p ≥ 0.05 is greyed out instead of flagged. Most territory dashboards can't tell a real imbalance from a small sample, so people learn to ignore them.

**It's one number a RevOps lead can read.** Signed, bounded, with a rough guide for what's big. You can sort a table of twenty reps by it and the outliers float to the ends.

It has limits, and I'd rather say so. KS tells you the books differ, not how many accounts to move; that's the balancer's job, below. It is most sensitive in the middle of the ranking and less so at the extreme top, so a rep holding the single best account in the segment won't move the number much on its own. And "within noise" means you can't tell, not that the books are equal.

## Is the rep working it?

Strength is half the question. The other half is activity: of the rep's top N accounts, what share has had a meeting, call, outbound email or Slack post in the window, or has a meeting already on the calendar for the next 28 days? A booked meeting is someone working the account, even if it hasn't happened yet.

Splitting strength from activity turns a vague "seems off" into a diagnosis. The quadrant that costs you money is **strong book, low activity**: the segment's best accounts parked with someone who isn't touching them. No account count will ever surface that.

Activity is only as good as the matching behind it. Calendars, Slack and email often name a company by a different domain than its CRM record: the `.ai` next to the `.com`, the old domain after a rebrand. The skill matches on every domain Sumble knows for the organization, not just the one in the CRM. When we ran it on our own territories, a straight domain match missed months of meetings with a handful of customers and marked them idle. Click any account and the app lists every event behind its number, the last 84 days and the next 28, so a rep can see what was counted and say what wasn't.

## Rank within a segment, not globally

A rep's book mixes segment sizes. A marquee account that falls just below your enterprise line still lives in Commercial, and a Commercial rank of 2 is not comparable to an Enterprise rank of 2. Average ranks across both universes and you get numbers no real book could produce.

So the app compares each rep only against peers in their own segment, and ranks their accounts against that segment alone. What decides the segment is yours to pick: account score, headcount, revenue from your CRM, or another CRM field.

## The value has to be real

The distance is only as good as the "value" underneath it. If value means headcount, you've rebuilt the size ranking you were trying to escape. If it means gut feel, reps won't trust the reassignment.

This skill takes account strength from a [`sumble-account-scoring`](../../sumble-account-scoring/articles/01-account-score-should-tell-a-rep-what-to-do.md) run: a score calibrated to *your* closed-won deals, where every component links through to the people, teams, and projects behind it. (No scoring run yet? It falls back to Sumble's own account score via the API.) Either way, "the segment's best accounts" means best *for you*, not biggest, and a rep facing a proposed move can click through to why the account is worth taking.

## What a balance number hides

Each segment's table has one more row under the reps: **Unallocated**, the segment's unowned accounts read as if they were one more book. It gets a distance like everyone else, which answers a question count-based planning never asks: how much of the segment's value does nobody hold?

Two other things distort every number, so fix them first:

- **Double-allocated**: two reps own CRM records that resolve to the same company.
- **Held, not owned**: a leader or founder sitting on accounts nobody works. The **Team** panel marks them as holding accounts rather than owning a book, so those accounts count as unallocated, with the holder's name kept on each one.

## Suggest, review, export: the CRM is never touched

An automated reassignment that's wrong is worse than the imbalance it fixed. So the balancer only *proposes*. It measures how uneven each segment's books are (a coefficient of variation across reps), then suggests the smallest set of owner moves that pulls them into balance: respecting each segment's target book size, handing wrong-segment accounts back, and giving unallocated strong accounts an owner. It never proposes moving an account someone is working.

The proposals land on the **Changes** tab. Accept one, reject it, or pick a different rep from any account's owner dropdown. The whole app groups by *effective owner* (current owner plus your accepted moves), so the distances update the moment you decide, and you see a move help before you commit to it. When you're done, one button writes `actions.csv`: a plain list of approved owner changes keyed by CRM account id, ready for your admin or a follow-up agent run. Nothing is written back automatically.

## What it looks like on a book

The repo ships a runnable demo at [`examples/territory-planning/`](../../../examples/territory-planning): a fictitious vendor, *Northwind*, with 1,935 accounts and 20 reps (10 Enterprise, 10 Commercial). The data is synthetic, but it's built to show the shapes you'll recognize:

- **Tom Harris** holds the biggest Enterprise book and the strongest one, **+0.66** on the top 50, and works almost none of it: 10% of his top 50 have been touched. The sitting-on-value quadrant, invisible to an account count.
- **Marcus Bell** is the other end: a normal-sized Enterprise book that skews clearly weaker than his peers', **−0.24** on the top 50 (p = 0.009).
- **James Walker** is the foil: a smaller book, all of it worked.
- **Grace Mitchell** shows why the top-N reading exists. Her 28 accounts look stronger than her peers' as a mix (+0.19, within noise), but she has 22 empty slots in a 50-account book, and on the top 50 she reads **−0.17**. She's ramping, and 0% worked reads as "new," not "failing."
- **Alex Morgan** is the commercial star: the biggest book, the strongest top 150 (**+0.62**), and 83% of it worked.
- **Commercial's Unallocated row** reads **−0.32** across all 428 accounts (mostly long tail) but **+0.60** on its best 150. There's a cluster of strong accounts in there that nobody owns. An average would have told you the pool was weak and stopped.

Under the current settings the balancer makes 480 proposals (owners for 445 unallocated accounts, 18 wrong-segment handbacks, 17 rebalance moves), which together would take both segments from uneven (CV ≈ 0.3) to balanced (≈ 0.1) if every one were accepted. Which, of course, they shouldn't be blindly. That's what the review step is for.

```bash
cd examples/territory-planning
python3 app.py        # http://localhost:8002
```

Stock Python 3.10+, no dependencies.

## Run it on yours

You need a coding agent (**Claude Code**, **OpenAI Codex**, or **Cursor**), your CRM ownership (Salesforce, HubSpot, a warehouse, or a CSV with account, owner, and a size signal), and ideally an existing account-scoring run for the value column. Connect whatever activity sources you have (Google Calendar, Gong, Fireflies, Granola, Salesforce email, Slack) and the activity columns light up. Skip them and you still get the distances and segment fit.

```bash
npx skills add SumbleData/agents --skill sumble-territory-planning
```

Start a new agent session and run it (`/sumble-territory-planning` in Claude Code; "use the sumble-territory-planning skill" in Codex or Cursor). The interview sets your segments (Enterprise + Commercial by default), what decides them, whether the line is a hard rule or should be calibrated from your data, and your target book size per segment. Then:

```bash
cd territory_planning/<your-company>
python3 app.py        # http://localhost:8002
```

Tune the cut and the targets in the Segments panel, mark who owns a book in the Team panel, review the Changes tab, export `actions.csv`.

## The part that compounds

A territory plan is usually a once-a-year fire drill that's stale by Q2. Someone rebuilds it in a spreadsheet, everyone argues, and the books drift the moment a rep leaves or an account heats up. Keying territories to a live account score changes that. Re-run it, and the accounts that got stronger, the reps who fell behind on activity, and the new hire who needs a book all show up as fresh moves on the same tab. The plan stops being a project and becomes a habit.

It also sits on the same foundation as the rest of the GTM engine. [`sumble-crm-cleaning`](../../sumble-crm-cleaning/articles/01-clean-your-crm-against-the-org-graph.md) resolves every account to a real organization and catches the double-allocations before they distort your balance. [`sumble-account-scoring`](../../sumble-account-scoring/articles/01-account-score-should-tell-a-rep-what-to-do.md) tells you which accounts are worth fighting over. This skill puts the right reps on them.
