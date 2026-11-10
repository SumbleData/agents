# Territory Planning — demo

A public, self-contained demo of the [`sumble-territory-planning`](../../skills/sumble-territory-planning)
skill's app: one table per segment with each rep's Kolmogorov-Smirnov distance
against their peers and the share of their book being worked. Click a rep for
their chart and accounts, click an account for its activity log (the last 84
days and meetings booked for the next 28). The **Segments** and **Team** panels
set the segment cut, targets and who counts as a rep, and the **Changes** tab
holds the suggest → accept/reject → export flow.

Runs on any stock Python 3.10+ — **no pip install, no dependencies.**

```bash
cd examples/territory-planning
python3 app.py          # http://localhost:8002
```

## The data is fictitious

- **Company, reps, and activity are invented.** A made-up vendor (*Northwind*)
  with **10 Enterprise + 10 Commercial** reps (fictitious names) and synthetic
  calendar, email and booked-meeting activity. Nothing here reflects a real sales team or book.
- **Account names are real public companies** (from the
  [`account-scoring`](../account-scoring) demo)
  with **synthetic demo scores** — that dataset is already public in this repo.
- **Deterministic:** everything is hash-seeded (no RNG), so the demo rebuilds
  byte-identically.
- **Segments are cut by headcount:** Enterprise is 1,000 employees and up
  (`ENTERPRISE_MIN` in `make_demo.py`).
- **Books are sized to target.** Every rep is dealt a fixed quota, so all 20
  books land within **±40%** of their segment's target (Enterprise 50, so
  30–70; Commercial 150, so 90–210). `make_demo.py` fails the build if one
  drifts outside that band. Otherwise "Target accounts per rep" in the
  Segments panel would be describing something the data doesn't do.

The seeded numbers tell a story on purpose: one enterprise rep (*Tom Harris*)
holds the segment's biggest and strongest book but works almost none of it
(**+0.64 on the top-50 distance, 8% of the top 50 worked**, sitting on value).
The foil (*James Walker*) works their whole book; one ramping rep (*Grace
Mitchell*) sits at **0%**; and the commercial star (*Alex Morgan*) holds the
strongest commercial book and works most of it. So the distance columns, the
activity columns, the idle filter and the suggested moves all have something
to show.

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
