# Balance territories on account value

Most territory plans already look past account count. They segment by company size, weight by revenue potential or tier, and keep books to a size a rep can work. What they rarely check is who holds the segment's best accounts. Two books can match on size and tier and still be uneven, with one rep holding several of the segment's top 20 and another holding none. So the question has two halves: who holds the valuable accounts, and are they working them?

This guide walks through a method for answering both, in five steps you can run on any CRM.

**Get the skill:** [`sumble-territory-planning`](..) runs the method in Claude Code, Codex, or Cursor. See what it builds in the [live demo](https://territory-planning-demo.sumble.com/) (fictitious data).

```bash
npx skills add SumbleData/agents --skill sumble-territory-planning
```

## TLDR
- Balanced totals don't guarantee a balanced top. A rep with an average-sized, average-tier book can still hold most of the segment's best accounts.
- **Rank accounts within each segment.** Account scoring can now be precise enough that #8 is meaningfully better than #15, and #15 is meaningfully better than #40. You lose that detail when you bucket accounts into coarse tiers like Tier A, Tier B, and Tier C. The [account scoring guide](../../sumble-account-scoring/articles/02-build-an-account-score-you-can-prospect-from.md) shows how to build a score that precise.
- **Measure each rep's top-account share.** Within a segment, look at each rep's share of the top 100, top 500, and top 1,000 accounts. Aim for similar shares at each cutoff. We saw a segment with 600 ranked accounts where one rep got the top 20 and another got the bottom 20. Same number of accounts, very different shot at quota. The Kolmogorov-Smirnov distance rolls every cutoff into one number per rep.
- **Rebalance untouched accounts first.** You can make books fairer without disrupting active work. It also gives reps a reason to work their accounts and make sure that activity is captured in the CRM.

## Even totals can hide an uneven top

Two reps can match on account count, revenue potential and tier mix and still hold very different books. One has eight of the segment's twenty best accounts, and the other has none. Tiers blur this, because #8 and #40 can both be Tier A. Reps usually sense the gap, but there's rarely a number that shows it.

The difference is in *which* accounts, not how many or how big in total. So measure each rep's share of the segment's best accounts directly.

## Step 1: Score and rank every account

Start with a score for every account in the CRM, owned or not, that says how likely it is to buy from you. Then split accounts into segments, Enterprise and Commercial for most teams, cut by headcount or whatever line your sales motion already uses. Within each segment, rank the accounts from best to worst, 1 = best.

Keep the ranks. Don't collapse them into tiers, because the whole method depends on telling #8 from #40.

Everything after this is only as good as the score. If it mostly tracks company size, the method just tells you who got the biggest companies. To score accounts well, use the [`sumble-account-scoring`](../../sumble-account-scoring) skill. The [account scoring guide](../../sumble-account-scoring/articles/02-build-an-account-score-you-can-prospect-from.md) covers how to build a score calibrated to your own closed-won deals or your best ICP-fit companies.

## Step 2: Measure each rep's share of the best accounts

The Kolmogorov-Smirnov distance answers one question per rep: do they have a fair share of the segment's best accounts?

![Three reps each hold 200 of a segment's 600 Tier A accounts. Rep A's accounts cluster near the top of the ranking and include 46 of the top 50 (KS distance +0.57). Rep B sits in the middle with 4 of the top 50 (−0.14). Rep C's accounts cluster near the bottom, with none of the top 50 (−0.55).](ks-distance-three-reps.svg)

On a tier report these are three identical books, 200 Tier A accounts each. Rank the accounts from best to worst, though, and they're not close. Each box covers the middle half of a rep's accounts, and the green line is the median. Rep A's accounts sit near the top of the list, with 46 of the best 50. Rep B's are spread through the middle. Rep C's sit near the bottom, with none of the best 50. The Kolmogorov-Smirnov distance turns that picture into one number per rep: +0.57 for Rep A, −0.14 for Rep B and −0.55 for Rep C.

How to read it:

- 0 means a fair share of the good accounts. Positive means more, negative means less.
- Under 0.1 is even. Above 0.25 is worth acting on.

### Why the Kolmogorov-Smirnov distance

The obvious alternatives each break in a way that matters for territories.

- **An average score hides the shape of a book.** A rep with five superb accounts and 45 weak ones can average the same as a rep with 50 middling ones. Those are different jobs. The distance reads the whole distribution, so the two books come out different, because they are.
- **A top-100 share depends on the cutoff you picked.** Looking at each rep's share of the top 100, 500 and 1,000 is the right instinct. But a book can look fair at 100 and uneven at 500. The distance checks every cutoff at once and reports the worst one.
- **It's one number you can sort by.** Signed, between −1 and +1, with a rough guide for what's big. Sort twenty reps by it and the outliers end up at the top and bottom.

## Step 3: Check whether the best accounts are being worked

A strong book only pays off if someone works it. For each rep, take their best accounts, as many as a rep can realistically work, and count the share that had a meeting, call, outbound email or Slack post in the last 90 days, or have a meeting booked in the next 28. Every account counts the same. Call it Activity.

Then read the two numbers together. The combination that costs you money is **strong book, low Activity**: the segment's best accounts are parked with someone who isn't touching them. Totals and tier mix won't surface it, and it's often the costliest pattern in a plan.

## Step 4: Rebalance untouched accounts first

Move as few accounts as you can, and start where nobody gets hurt:

1. **Unowned strong accounts.** Give them to reps whose distance is below zero.
2. **Strong accounts nobody has touched in the window.** Move them from reps with a high distance and low Activity to reps with room.
3. **Wrong-segment accounts.** Hand them back to the right segment.

Never move an account someone is working. Stop when each segment's reps sit within about 0.1 of each other, and keep each book to a size a rep can work. Have a person approve every move before anything changes in the CRM.

Two things distort the numbers, so fix them first. Two reps can own CRM records that turn out to be the same company, which [CRM cleaning](../../sumble-crm-cleaning/articles/01-clean-your-crm-against-the-org-graph.md) catches. And a sales leader or founder can sit on accounts nobody works. Count those as unowned.

## Step 5: Revisit allocations frequently

A territory plan is usually rebuilt once a year, and it drifts from there as reps leave and accounts heat up. Re-run steps 1 to 4 each quarter, and whenever a rep joins or leaves. With a live account score, each run turns up the accounts that got stronger, the reps who fell behind on Activity and the new hire who needs a book, as a short list of moves rather than a new plan.

## What it looks like on a book

This repo ships a runnable demo at [`examples/territory-planning/`](../../../examples/territory-planning), built on a fictitious vendor, *Northwind*, with 1,935 accounts and 20 reps (10 Enterprise, 10 Commercial). The data is synthetic, but it's built to show the shapes you'll recognize. Segments are cut by headcount: Enterprise is 1,000 employees and up.

| Rep | Accounts | Customers | Kolmogorov-Smirnov distance, top 50 | Activity, top 50 |
|---|---:|---:|---:|---:|
| Tom Harris | 65 | 2 | +0.64 | 8% |
| James Walker | 44 | 4 | +0.24 | 100% |
| Avery Brooks | 41 | 2 | +0.12 (could be luck) | 54% |
| Hannah Wright | 34 | 3 | −0.08 (could be luck) | 76% |
| Grace Mitchell | 30 | 2 | −0.14 (could be luck) | 0% |
| Emily Clarke | 33 | 1 | −0.15 (could be luck) | 70% |
| Sophie Turner | 37 | 1 | −0.16 (could be luck) | 57% |
| Rachel Evans | 27 | 0 | −0.21 | 59% |
| Marcus Bell | 35 | 5 | −0.23 | 43% |
| Liam Foster | 30 | 2 | −0.24 | 60% |
| *Unallocated* | 27 | — | −0.41 | 0% |

This is the Enterprise segment after steps 1 to 3. Reps are sorted by their Kolmogorov-Smirnov distance on the top 50, and greyed numbers could be luck. On the page, a box in each row shows where that rep's top 50 accounts rank in the segment. Activity is the share of those 50 accounts someone has worked.

- **Tom Harris** holds the biggest Enterprise book and the strongest one (+0.64 on the top 50), and works almost none of it: 8% of their top 50 have been touched. That's strong book, low Activity, and a size or tier check wouldn't flag it.
- **Marcus Bell** is the other end: a normal-sized Enterprise book that's clearly weaker than their peers' (−0.23 on the top 50, p = 0.012).

Step 4 on this data suggests 475 owner changes, mostly owners for unowned accounts, which would take both segments from uneven to balanced if every one were accepted.

## Frequently asked questions

### What does the Kolmogorov-Smirnov distance mean?

It measures whether a rep has their fair share of the segment's best accounts. Rank every account in the segment from best to worst. At each cutoff (the top 100, the top 500, the top 1,000 and so on), compare the share of the rep's book inside it with the share of everyone else's. The distance is the biggest of those gaps, signed, so it runs from −1 to +1. In the diagram above, Rep A's +0.57 comes from the top 237 accounts: 78% of Rep A's book is in there, against 21% of the other two reps' books. That 57-point gap is the biggest at any cutoff. We measure each rep on their best N accounts, where N is the number a rep can work (50 in Enterprise and 150 in Commercial), so empty slots in a thin book count against it. A small book can also look uneven by chance, so treat a reading with a p-value of 0.05 or higher as noise.
