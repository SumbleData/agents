# Territory Planning — demo

A public, self-contained demo of the [`sumble-territory-planning`](../../skills/sumble-territory-planning)
skill's app: a **book-strength table per segment** (Kolmogorov-Smirnov distance vs peers on
each rep's top N and on all accounts, each with an Activity share; click a distance to see that rep's accounts ranked), a **Top N**
sidebar, a click-through on each rep to move their idle accounts, and a
**Changes** tab that lists every proposed move with a log of each decision.

Runs on any stock Python 3.10+ — **no pip install, no dependencies.**

```bash
cd examples/territory-planning
python3 app.py          # http://localhost:8002
```

## The data is fictitious

- **Company, reps, and activity are invented.** A made-up vendor (*Northwind*)
  with **10 Enterprise + 10 Commercial** reps (fictitious names) and synthetic
  calendar activity. Nothing here reflects a real sales team or book.
- **Account names are real public companies** (from the
  [`account-scoring`](../account-scoring) demo)
  with **synthetic demo scores** — that dataset is already public in this repo.
- **Deterministic:** everything is hash-seeded (no RNG), so the demo rebuilds
  byte-identically.
- **Books are sized to target.** Every rep is dealt a fixed quota, so all 20
  books land within **±40%** of their segment's target (Enterprise 50, so
  30–70; Commercial 150, so 90–210). `make_demo.py` fails the build if one
  drifts outside that band — otherwise the segment's target book size
  (`default_capacity`) would describe something the data doesn't do.

The seeded numbers tell a story on purpose: one enterprise rep (*Tom Harris*)
holds the segment's biggest and strongest book but works almost none of it
(**Kolmogorov-Smirnov distance +0.66 on their top 50, 12% Activity**, sitting on value); the
foil (*James Walker*) has activity on every account (**100%**); one ramping rep
(*Grace Mitchell*) sits at **0%** with a thin book that reads weak on top N; and the commercial star (*Alex Morgan*) both
captures and activates the most in that segment. So the per-segment tables, the
Kolmogorov-Smirnov distance and Activity columns, the attention flags, and the Calibrate/Moves flows
all have something to show.

## Rebuild from source

The committed app + data are produced by `build.sh` — copy the stdlib app from
the skill template, generate the fictitious inputs, run the real pipeline, and
inject the demo banner:

```bash
bash examples/territory-planning/build.sh
```

`make_demo.py` is the generator (accounts + scores + reps + ownership +
activity); tweak `ENTERPRISE_REPS` / `COMMERCIAL_REPS`, `ENTERPRISE_MIN` (the
segment line), `SEGMENT_CAPACITY`, or the `ENT_QUOTA` / `COM_QUOTA` book sizes
there to reshape the demo. Change a quota and the ±40% guardrail will tell you
if it no longer fits its segment target.
