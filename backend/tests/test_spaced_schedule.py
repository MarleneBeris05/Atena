import unittest
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from fastapi import HTTPException

from atena.spaced_schedule import PlanDates, build_sessions, suggest_dates


class SpacedScheduleTest(unittest.TestCase):
    def payload(self, **changes):
        return PlanDates.model_validate({
            "topicId": "redes", "deviceId": "391f94de-0116-490c-a121-4e1f37d0bde1",
            "startDate": "2026-12-01", "examDate": "2027-01-01", "reason": "Examen de redes",
            "timeZone": "America/Mexico_City", "time": "18:00", "minutes": 1,
            **changes,
        })

    def test_exact_example_and_local_clock(self):
        now = datetime(2026, 12, 1, 12, tzinfo=timezone.utc)
        sessions = build_sessions(self.payload(), now)
        self.assertEqual([entry["date"] for entry in sessions],
                         [date(2026, 12, number) for number in (2, 4, 8, 15, 31)])
        for entry in sessions:
            self.assertEqual(entry["time"], "18:00")
            self.assertEqual(entry["startsAt"].hour, 0)
            self.assertEqual(entry["startsAt"].astimezone(ZoneInfo("America/Mexico_City")).hour, 18)

    def test_compression_is_unique_day_after_start_to_eve(self):
        start = date(2026, 12, 29)
        for available in range(1, 30):
            exam = start + timedelta(days=available + 1)
            dates = suggest_dates(start, exam)
            self.assertEqual(len(dates), min(available, 5))
            self.assertEqual(dates, sorted(set(dates)))
            self.assertEqual(dates[0], start + timedelta(days=1))
            self.assertEqual(dates[-1], exam - timedelta(days=1))

    def test_long_schedule_and_no_available_day(self):
        start = date(2026, 12, 1)
        self.assertEqual(suggest_dates(start, start + timedelta(days=33)),
                         [start + timedelta(days=d) for d in (1, 3, 7, 14, 30)])
        self.assertEqual(suggest_dates(start, start + timedelta(days=73)),
                         [start + timedelta(days=d) for d in (1, 3, 7, 14, 30, 44, 58, 72)])
        self.assertEqual(suggest_dates(start, start + timedelta(days=1)), [])
        now = datetime(2026, 12, 1, 12, tzinfo=timezone.utc)
        with self.assertRaises(HTTPException) as error:
            build_sessions(self.payload(examDate="2026-12-02"), now)
        self.assertEqual(error.exception.detail["field"], "examDate")

    def test_manual_today_and_validation(self):
        now = datetime(2026, 12, 1, 23, 54, tzinfo=timezone.utc)
        today = {"date": "2026-12-01", "time": "18:00"}
        entries = build_sessions(self.payload(sessions=[today]), now)
        self.assertEqual(entries[0]["startsAt"], now + timedelta(minutes=6))
        for slots in ([{**today, "time": "17:54"}], [today, {**today, "time": "18:10"}],
                      [{"date": "2027-01-01", "time": "18:00"}]):
            with self.assertRaises(HTTPException):
                build_sessions(self.payload(sessions=slots), now)

    def test_missing_local_time_during_dst(self):
        now = datetime(2026, 3, 1, tzinfo=timezone.utc)
        with self.assertRaises(HTTPException):
            build_sessions(self.payload(startDate="2026-03-07", examDate="2026-03-09",
                                        timeZone="America/New_York", time="02:30"), now)
