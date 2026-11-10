"""Tests for the account panel's activity log written by merge_territory.py.

python3 -m unittest discover -s template/tests
"""

from __future__ import annotations

import csv
import datetime as dt
import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "_build"))

import merge_territory as mt  # noqa: E402

COLS = ["source", "rep_email", "account_domain", "kind", "ts"]


def write_events(path: Path, rows: list[list[str]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(COLS)
        w.writerows(rows)


class ActivityLogTest(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.raw = Path(self.tmp.name) / "_raw"
        self.out = Path(self.tmp.name) / "static" / "activity_log.json"
        self.as_of = dt.date(2026, 7, 31)

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def run_log(self, org_by_domain: dict[str, str]) -> dict:
        mt.write_activity_log(self.raw, self.out, org_by_domain, self.as_of)
        return json.loads(self.out.read_text(encoding="utf-8"))

    def test_window_is_84_days_back_and_28_ahead(self):
        write_events(
            self.raw / "activity" / "meetings.csv",
            [
                [
                    "google_calendar",
                    "a@x.com",
                    "acme.com",
                    "meeting",
                    "2026-05-08",
                ],  # day 84
                [
                    "google_calendar",
                    "a@x.com",
                    "acme.com",
                    "meeting",
                    "2026-05-07",
                ],  # day 85
            ],
        )
        write_events(
            self.raw / "upcoming" / "activity" / "meetings.csv",
            [
                [
                    "upcoming_calendar",
                    "a@x.com",
                    "acme.com",
                    "meeting",
                    "2026-08-28",
                ],  # +28
                [
                    "upcoming_calendar",
                    "a@x.com",
                    "acme.com",
                    "meeting",
                    "2026-08-29",
                ],  # +29
            ],
        )
        log = self.run_log({"acme.com": "1"})
        dates = [e[0] for e in log["events"]["1"]]
        self.assertEqual(dates, ["2026-08-28", "2026-05-08"])
        self.assertEqual(log["as_of"], "2026-07-31")

    def test_alternate_domains_land_on_the_same_account(self):
        write_events(
            self.raw / "activity" / "meetings.csv",
            [
                ["google_calendar", "a@x.com", "acme.ai", "meeting", "2026-07-01"],
                ["google_calendar", "a@x.com", "acme.com", "meeting", "2026-07-02"],
            ],
        )
        log = self.run_log({"acme.com": "1", "acme.ai": "1"})
        self.assertEqual(len(log["events"]["1"]), 2)

    def test_repeats_collapse_with_a_count(self):
        row = ["salesforce_email", "a@x.com", "acme.com", "email_out", "2026-07-01"]
        write_events(self.raw / "activity" / "sf_email.csv", [row, row, row])
        log = self.run_log({"acme.com": "1"})
        self.assertEqual(
            log["events"]["1"],
            [["2026-07-01", "email_out", "salesforce_email", "a@x.com", "acme.com", 3]],
        )

    def test_unmatched_domains_are_dropped(self):
        write_events(
            self.raw / "activity" / "meetings.csv",
            [
                ["google_calendar", "a@x.com", "other.com", "meeting", "2026-07-01"],
            ],
        )
        self.assertEqual(self.run_log({"acme.com": "1"})["events"], {})


if __name__ == "__main__":
    unittest.main()
