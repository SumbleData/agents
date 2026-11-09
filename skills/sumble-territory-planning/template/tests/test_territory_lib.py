"""Tests for the segment-boundary metrics and the KS book-quality reading.

Stdlib only, like the rest of the skill:
    python3 -m unittest discover -s template/tests
"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "_build"))

import territory_lib as tl  # noqa: E402


class KsSignedTest(unittest.TestCase):
    def test_identical_books_read_zero(self):
        d, p = tl.ks_signed([1, 2, 3, 4], [1, 2, 3, 4])
        self.assertEqual(d, 0.0)
        self.assertEqual(p, 1.0)

    def test_stronger_book_is_positive(self):
        d, p = tl.ks_signed([50, 60, 70, 80, 90], [10, 20, 30, 40, 45])
        self.assertEqual(d, 1.0)
        self.assertLess(p, 0.05)

    def test_weaker_book_is_negative(self):
        d, _ = tl.ks_signed([10, 20, 30], [40, 50, 60])
        self.assertEqual(d, -1.0)

    def test_ties_step_past_every_equal_value(self):
        # At score 1 the book has 2/3 of its mass, the peers 1/3: weaker by 1/3.
        d, _ = tl.ks_signed([1, 1, 2], [1, 2, 2])
        self.assertAlmostEqual(d, -0.3333, places=4)

    def test_book_size_does_not_matter_only_the_mix(self):
        small, _ = tl.ks_signed([1, 2, 3, 4], [1, 2, 3, 4] * 10)
        big, _ = tl.ks_signed([1, 2, 3, 4] * 25, [1, 2, 3, 4] * 10)
        self.assertEqual(small, 0.0)
        self.assertEqual(big, 0.0)

    def test_empty_side_reads_zero(self):
        self.assertEqual(tl.ks_signed([], [1, 2]), (0.0, 1.0))


class KsPValueTest(unittest.TestCase):
    def test_small_gap_on_small_books_is_noise(self):
        self.assertGreater(tl.ks_pvalue(0.2, 10, 50), 0.05)

    def test_same_gap_on_big_books_is_real(self):
        self.assertLess(tl.ks_pvalue(0.2, 500, 2000), 0.05)


class KsBySegmentTest(unittest.TestCase):
    def setUp(self):
        self.reps = [
            {"name": "A", "segment": "ent", "is_rep": True, "in_balance": True},
            {"name": "B", "segment": "ent", "is_rep": True, "in_balance": True},
            {"name": "Coach", "segment": "ent", "is_rep": True, "in_balance": False},
        ]

    def row(self, owner, score, seg="ent", cat="allocated"):
        return {
            "owner": owner,
            "score": score,
            "account_segment": seg,
            "account_category": cat,
        }

    def test_player_coach_is_read_but_never_a_peer(self):
        rows = [self.row("A", s) for s in (10, 20, 30)]
        rows += [self.row("B", s) for s in (10, 20, 30)]
        rows += [self.row("Coach", s) for s in (90, 95, 99)]
        out = tl.ks_by_segment(rows, self.reps, top_n={"ent": 3})["ent"]
        self.assertEqual(out["A"]["ks"], 0.0)  # the coach's strong book is not in A's peers
        self.assertEqual(out["A"]["n_peers"], 3)
        self.assertEqual(out["Coach"]["ks"], 1.0)

    def test_out_of_segment_and_whitespace_rows_are_ignored(self):
        rows = [
            self.row("A", 10),
            self.row("B", 10),
            self.row("A", 99, seg="com"),
            self.row("A", 99, cat="whitespace"),
        ]
        out = tl.ks_by_segment(rows, self.reps, top_n={"ent": 1})["ent"]
        self.assertEqual(out["A"]["n"], 1)

    def test_accounts_past_top_n_do_not_count(self):
        # A and B share the same best two; A's extra weak accounts sit past N.
        rows = [self.row("A", s) for s in (80, 70, 5, 5, 5)]
        rows += [self.row("B", s) for s in (80, 70)]
        out = tl.ks_by_segment(rows, self.reps, top_n={"ent": 2})["ent"]
        self.assertEqual(out["A"]["ks"], 0.0)
        self.assertEqual(out["A"]["n"], 5)
        self.assertEqual(out["A"]["top_n"], 2)

    def test_a_thin_book_reads_weaker_than_a_full_one_of_the_same_mix(self):
        rows = [self.row("A", s) for s in (60, 60)]
        rows += [self.row("B", s) for s in (60, 60, 60, 60)]
        out = tl.ks_by_segment(rows, self.reps, top_n={"ent": 4})["ent"]
        self.assertEqual(out["A"]["ks"], -0.5)  # two empty slots score 0
        self.assertEqual(out["B"]["ks"], 0.5)

    def test_without_top_n_whole_books_are_compared(self):
        rows = [self.row("A", s) for s in (60, 60)]
        rows += [self.row("B", s) for s in (60, 60, 60, 60)]
        out = tl.ks_by_segment(rows, self.reps)["ent"]
        self.assertEqual(out["A"]["ks"], 0.0)  # same mix, size ignored
        self.assertIsNone(out["A"]["top_n"])


class KsTopNDefaultTest(unittest.TestCase):
    def test_top_n_is_the_target_accounts_per_rep(self):
        self.assertEqual(tl.ks_top_n_for({"key": "mid", "default_capacity": 80}), 80)
        self.assertEqual(
            tl.ks_top_n_for({"key": "ent", "default_capacity": 40, "ks_top_n": 30}), 40
        )
        self.assertEqual(tl.ks_top_n_for({"key": "ent", "ks_top_n": 30}), 30)
        self.assertEqual(tl.ks_top_n_for({"key": "mid"}), tl.KS_TOP_N_FALLBACK)

    def test_top_n_scores_pads_and_truncates(self):
        self.assertEqual(tl.top_n_scores([3, 9, 1], 2), [9, 3])
        self.assertEqual(tl.top_n_scores([3], 3), [3, 0.0, 0.0])


class ActivityAttributionTest(unittest.TestCase):
    def setUp(self):
        self.activity = {
            ("owner@x.com", "acme.com"): {
                "meeting": 0,
                "call": 0,
                "email_out": 0,
                "email_in": 0,
                "message": 0,
                "last_activity_date": "",
                "sources": set(),
            },
            ("csm@x.com", "acme.com"): {
                "meeting": 1,
                "call": 0,
                "email_out": 0,
                "email_in": 0,
                "message": 3,
                "last_activity_date": "2026-11-01",
                "sources": {"slack"},
            },
        }

    def test_owner_attribution_ignores_colleagues(self):
        act = tl.activity_for(self.activity, "owner@x.com", ["acme.com"])
        self.assertEqual(act["outbound_total"], 0)

    def test_anyone_attribution_counts_colleagues_and_slack(self):
        act = tl.activity_for(self.activity, "owner@x.com", ["acme.com"], "anyone")
        self.assertEqual(act["outbound_total"], 4)  # one meeting + three Slack messages
        self.assertEqual(act["last_activity_date"], "2026-11-01")


class BoundaryMetricTest(unittest.TestCase):
    def test_score_metric_reads_the_score_column(self):
        spec = {"boundary": {"metric": "score"}}
        self.assertEqual(tl.resolve_size_column(spec, ["org_id", "score"]), "score")
        self.assertEqual(
            tl.resolve_size_column(spec, ["org_id", "sumble_score"]), "sumble_score"
        )

    def test_revenue_comes_from_ownership_csv(self):
        acct = [
            {"org_id": "1", "url": "acme.com", "name": "Acme"},
            {"org_id": "2", "crm_account_id": "001X", "name": "Beta"},
            {"org_id": "3", "url": "nope.com", "name": "Nope"},
        ]
        ownership = [
            {
                "crm_account_id": "",
                "domain": "https://www.acme.com/",
                "name": "Acme",
                "revenue": "120000000",
            },
            {
                "crm_account_id": "",
                "domain": "acme.com",
                "name": "Acme sub",
                "revenue": "5000000",
            },
            {"crm_account_id": "001X", "domain": "", "name": "Beta", "revenue": "40000000"},
        ]
        col = tl.prepare_boundary_metric(
            {"boundary": {"metric": "revenue"}}, acct, ownership
        )
        self.assertEqual(col, tl.CRM_METRIC_COLUMN)
        self.assertEqual([r[col] for r in acct], [120000000.0, 40000000.0, 0.0])

    def test_revenue_without_the_column_stops(self):
        with self.assertRaises(SystemExit):
            tl.prepare_boundary_metric(
                {"boundary": {"metric": "revenue"}},
                [{"org_id": "1"}],
                [{"domain": "a.com"}],
            )

    def test_snapping_follows_the_metric(self):
        self.assertEqual(tl.snap_to_human(4252), 5000)
        self.assertEqual(tl.snap_to_human(700), 500)
        self.assertEqual(tl.snap_to_human(37_000_000, "revenue"), 50_000_000)
        self.assertEqual(tl.snap_to_human(63.7, "score"), 65)

    def test_metric_labels(self):
        self.assertEqual(tl.metric_label("score"), "Account score")
        self.assertEqual(tl.metric_label("revenue"), "Annual revenue")
        self.assertEqual(tl.metric_label("jf_people:Sales"), "Sales headcount")


class ComponentColumnsTest(unittest.TestCase):
    def test_component_columns_survive_a_save(self):
        rows = [
            {"org_id": "1", "score": 50, "component:Size": "12.5", "component:PLG": "3"}
        ]
        cols = tl.territory_columns(rows)
        self.assertEqual(cols[: len(tl.TERRITORY_COLUMNS)], tl.TERRITORY_COLUMNS)
        self.assertEqual(
            cols[len(tl.TERRITORY_COLUMNS) :], ["component:Size", "component:PLG"]
        )

    def test_no_components_means_the_standard_columns(self):
        self.assertEqual(tl.territory_columns([{"org_id": "1"}]), tl.TERRITORY_COLUMNS)
        self.assertEqual(tl.territory_columns([]), tl.TERRITORY_COLUMNS)


def _plan(reps, segments=None, options=None):
    segments = segments or [{"key": "all", "label": "All", "order": 1, "default_capacity": 2}]
    return {
        "segments": segments,
        "boundary": {"metric": "score", "label": "Account score", "thresholds": [],
                     "options": options or []},
        "reps": reps,
        "strong_cutoff": 10,
    }


def _row(org_id, owners, owner="", score=50.0, category="", **extra):
    row = {
        "org_id": org_id, "name": f"Org {org_id}", "score": score, "size_metric": score,
        "account_category": category or ("allocated" if owner else "unallocated"),
        "owner": owner, "owner_email": "", "crm_owners": "|".join(owners), "worked": 0,
    }
    row.update(extra)
    return row


class RosterTest(unittest.TestCase):
    def test_a_warehouse_owner_holds_accounts_as_unallocated(self):
        plan = _plan([
            {"name": "Ana", "email": "ana@x.com", "segment": "all", "is_rep": True},
            {"name": "Sam", "email": "sam@x.com", "segment": "", "is_rep": False},
        ])
        rows = [_row("1", ["Sam"]), _row("2", ["Ana"], owner="Ana")]
        tl.apply_roster(plan, rows)
        self.assertEqual(rows[0]["owner"], "")
        self.assertEqual(rows[0]["held_by"], "Sam")
        self.assertEqual(rows[0]["unallocated"], 1)
        self.assertEqual(rows[1]["owner"], "Ana")

        # Promote Sam to a rep: his accounts become his book.
        plan["reps"][1].update(is_rep=True, segment="all")
        tl.apply_roster(plan, rows)
        self.assertEqual(rows[0]["owner"], "Sam")
        self.assertEqual(rows[0]["owner_email"], "sam@x.com")
        self.assertEqual(rows[0]["held_by"], "")
        self.assertEqual(rows[0]["account_category"], "allocated")

    def test_the_current_owner_keeps_a_shared_account(self):
        plan = _plan([
            {"name": "Ana", "segment": "all", "is_rep": True},
            {"name": "Bo", "segment": "all", "is_rep": True},
        ])
        rows = [_row("1", ["Ana", "Bo"], owner="Bo")]
        tl.apply_roster(plan, rows)
        self.assertEqual(rows[0]["owner"], "Bo")
        self.assertEqual(rows[0]["double_allocated"], 1)
        self.assertEqual(rows[0]["other_owners"], "Ana")

    def test_customers_stay_customers(self):
        plan = _plan([{"name": "Sam", "segment": "", "is_rep": False}])
        rows = [_row("1", ["Sam"], category="customer")]
        tl.apply_roster(plan, rows)
        self.assertEqual(rows[0]["account_category"], "customer")


class ConfigTest(unittest.TestCase):
    def test_adding_a_segment_splits_on_the_metric_and_sets_targets(self):
        plan = _plan(
            [{"name": "Ana", "segment": "all", "is_rep": True},
             {"name": "Bo", "segment": "all", "is_rep": True}],
            options=[{"metric": "score", "label": "Account score", "column": "score"},
                     {"metric": "total_employees", "label": "Total employees",
                      "column": "employee_count_int"}],
        )
        rows = [
            _row("1", ["Ana"], owner="Ana", score=80, **{"metric:score": 80,
                 "metric:total_employees": 5000}),
            _row("2", ["Bo"], owner="Bo", score=60, **{"metric:score": 60,
                 "metric:total_employees": 200}),
        ]
        tl.apply_config(plan, rows, {
            "metric": "total_employees",
            "segments": [
                {"key": "all", "label": "Commercial", "min": None, "target": 150},
                {"key": "new-1", "label": "Enterprise", "min": 1000, "target": 50},
            ],
            "roster": [{"name": "Ana", "is_rep": True, "segment": "new-1"}],
        })
        self.assertEqual([s["key"] for s in plan["segments"]], ["all", "enterprise"])
        self.assertEqual(plan["boundary"]["metric"], "total_employees")
        self.assertEqual(plan["boundary"]["thresholds"], [{"segment": "enterprise", "min": 1000.0}])
        self.assertEqual(plan["reps"][0]["segment"], "enterprise")
        self.assertEqual(plan["reps"][0]["effective_capacity"], 50)
        self.assertEqual(tl.ks_top_n_for(plan["segments"][1]), 50)
        self.assertEqual(rows[0]["account_segment"], "enterprise")
        self.assertEqual(rows[1]["account_segment"], "all")
        self.assertEqual(rows[1]["segment_misfit"], 0)

    def test_two_segments_cannot_start_at_the_same_value(self):
        plan = _plan([])
        with self.assertRaises(ValueError):
            tl.apply_config(plan, [], {"segments": [
                {"label": "A", "min": None}, {"label": "B", "min": 5}, {"label": "C", "min": 5},
            ]})

    def test_an_unknown_metric_is_refused(self):
        plan = _plan([])
        with self.assertRaises(ValueError):
            tl.apply_config(plan, [], {"metric": "revenue", "segments": [{"label": "A"}]})

    def test_metric_options_skip_empty_columns(self):
        plan = _plan([])
        rows = [{"score": 10, "employee_count_int": 0, "sales_people": 4}]
        opts = tl.metric_options(plan, rows, [], "score")
        self.assertEqual([o["metric"] for o in opts], ["score", "jf_people:Sales"])
        self.assertEqual(opts[1]["column"], "sales_people")


if __name__ == "__main__":
    unittest.main()
