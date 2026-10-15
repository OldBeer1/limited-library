"""L0 checks only: draft SQL + documents, never an application or real user DB.

Uses Python standard library; all writable databases are in memory or in a
unique TemporaryDirectory. No dependency installation or network access.
"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path
import re
import sqlite3
import tempfile
import threading
import time
import unittest
from uuid import uuid4

ROOT = Path(__file__).resolve().parents[1]
SCHEMA = (ROOT / "docs" / "SCHEMA.sql").read_text(encoding="utf-8")
CAPACITIES = {"tv": 10, "movie": 10, "anime": 10, "documentary": 6, "theatre": 10, "comic": 5}
ORIGINAL_HASH = "af8808464e6b6b4950e8e6baefc9966cc6a2798babc0a2fe2d65f7df58847afd"


def connect(path: str = ":memory:", *, initialize: bool = True) -> sqlite3.Connection:
    db = sqlite3.connect(path, isolation_level=None, timeout=2)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA foreign_keys = ON")
    if initialize:
        db.executescript(SCHEMA)
    return db


def add(db: sqlite3.Connection, category: str = "movie", **changes: object) -> str:
    values: dict[str, object] = {
        "id": str(uuid4()), "title": "Synthetic example", "category_id": category,
        "status": "planned", "date_added": "2026-10-15",
    }
    values.update(changes)
    # Column identifiers come only from the code-owned dictionaries in this file.
    columns = ", ".join(values)
    placeholders = ", ".join("?" for _ in values)
    db.execute(f"INSERT INTO media_items ({columns}) VALUES ({placeholders})", tuple(values.values()))
    return str(values["id"])


def archive(db: sqlite3.Connection, item_id: str) -> None:
    db.execute("""UPDATE media_items SET archived_from_status=status,
                  status='archived', version=version+1 WHERE id=?""", (item_id,))


def summary(db: sqlite3.Connection, category: str = "movie") -> sqlite3.Row:
    return db.execute("SELECT * FROM v_category_summary WHERE category_id=?", (category,)).fetchone()


class SchemaChecks(unittest.TestCase):
    def setUp(self) -> None:
        self.db = connect()
        self.addCleanup(self.db.close)

    def fill(self, category: str = "movie", count: int | None = None) -> list[str]:
        return [add(self.db, category) for _ in range(CAPACITIES[category] if count is None else count)]

    def test_default_categories_and_empty_counts(self) -> None:
        rows = self.db.execute("SELECT * FROM categories ORDER BY sort_order").fetchall()
        self.assertEqual({r["id"]: r["capacity"] for r in rows}, CAPACITIES)
        self.assertEqual([r["sort_order"] for r in rows], list(range(1, 7)))
        self.assertEqual(sum(r["capacity"] for r in rows), 51)
        self.assertEqual(len(self.db.execute("SELECT * FROM v_category_summary").fetchall()), 6)
        self.assertEqual(summary(self.db)["retained"], 0)
        self.assertEqual(summary(self.db)["remaining"], 10)

    def test_objects_and_integrity(self) -> None:
        tables = {r["name"] for r in self.db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        self.assertEqual(tables, {"categories", "assets", "media_items", "schema_migrations", "mutation_requests"})
        self.assertEqual(self.db.execute("SELECT count(*) FROM sqlite_master WHERE type='trigger'").fetchone()[0], 6)
        self.assertEqual(self.db.execute("SELECT count(*) FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%'").fetchone()[0], 4)
        self.assertEqual(self.db.execute("PRAGMA integrity_check").fetchone()[0], "ok")
        self.assertEqual(self.db.execute("PRAGMA foreign_key_check").fetchall(), [])
        self.assertEqual(self.db.execute("PRAGMA foreign_keys").fetchone()[0], 1)

    def test_nine_to_ten(self) -> None:
        self.fill(count=9)
        add(self.db)
        self.assertEqual((summary(self.db)["retained"], summary(self.db)["remaining"]), (10, 0))

    def test_every_category_blocks_overflow(self) -> None:
        for category in CAPACITIES:
            with self.subTest(category=category):
                self.fill(category)
                with self.assertRaisesRegex(sqlite3.IntegrityError, "CATEGORY_FULL"):
                    add(self.db, category)
                self.assertEqual(summary(self.db, category)["retained"], CAPACITIES[category])

    def test_full_same_category_edit_excludes_self(self) -> None:
        item = self.fill()[0]
        self.db.execute("UPDATE media_items SET title=?, category_id=?, status=? WHERE id=?",
                        ("Edited", "movie", "watching", item))
        self.assertEqual(summary(self.db)["retained"], 10)

    def test_completed_and_dropped_occupy_slots(self) -> None:
        add(self.db, status="completed", has_completed=1)
        add(self.db, status="dropped")
        self.assertEqual(summary(self.db)["retained"], 2)
        self.assertEqual(self.db.execute("SELECT count(*) FROM v_completed_items").fetchone()[0], 1)

    def test_archive_releases_slot_preserves_history(self) -> None:
        item = add(self.db, status="completed", has_completed=1, favorite=1, notes="Synthetic note")
        self.fill(count=9)
        archive(self.db, item)
        add(self.db)
        row = self.db.execute("SELECT * FROM v_completed_items WHERE id=?", (item,)).fetchone()
        self.assertEqual((row["status"], row["archived_from_status"], row["favorite"]), ("archived", "completed", 1))
        self.assertEqual(row["notes"], "Synthetic note")
        self.assertEqual(summary(self.db)["retained"], 10)

    def test_zero_capacity_history_has_no_limit(self) -> None:
        self.db.execute("UPDATE categories SET capacity=0 WHERE id='movie'")
        for _ in range(120):
            add(self.db, status="archived", archived_from_status="completed", has_completed=1)
        self.assertEqual(self.db.execute("SELECT count(*) FROM v_completed_items").fetchone()[0], 120)
        self.assertEqual(summary(self.db)["retained"], 0)
        with self.assertRaisesRegex(sqlite3.IntegrityError, "CATEGORY_FULL"):
            add(self.db)

    def test_history_in_all_six_categories_without_duplicate_copy(self) -> None:
        for category in CAPACITIES:
            add(self.db, category, status="completed", has_completed=1)
            add(self.db, category, status="archived", archived_from_status="completed", has_completed=1)
        rows = self.db.execute("SELECT category_id, count(*) FROM v_completed_items GROUP BY category_id").fetchall()
        self.assertEqual({r[0]: r[1] for r in rows}, {key: 2 for key in CAPACITIES})
        self.assertEqual(self.db.execute("SELECT count(DISTINCT id) FROM v_completed_items").fetchone()[0], 12)
        self.assertEqual(sum(summary(self.db, c)["retained"] for c in CAPACITIES), 6)

    def test_favorite_history_does_not_occupy_slot(self) -> None:
        item = add(self.db, status="archived", archived_from_status="completed", has_completed=1)
        self.db.execute("UPDATE media_items SET favorite=1 WHERE id=?", (item,))
        self.assertEqual(summary(self.db)["retained"], 0)
        self.assertEqual(self.db.execute("SELECT favorite FROM v_completed_items WHERE id=?", (item,)).fetchone()[0], 1)

    def test_unknown_date_and_rewatch_preserve_completion(self) -> None:
        item = add(self.db, status="completed", has_completed=1)
        self.db.execute("UPDATE media_items SET status='watching' WHERE id=?", (item,))
        row = self.db.execute("SELECT * FROM v_completed_items WHERE id=?", (item,)).fetchone()
        self.assertEqual(row["status"], "watching")
        self.assertIsNone(row["date_completed"])
        archive(self.db, item)
        self.assertEqual(self.db.execute("SELECT count(*) FROM v_completed_items").fetchone()[0], 1)

    def test_restore_full_is_rejected(self) -> None:
        self.fill()
        item = add(self.db, status="archived", archived_from_status="completed", has_completed=1)
        with self.assertRaisesRegex(sqlite3.IntegrityError, "CATEGORY_FULL"):
            self.db.execute("UPDATE media_items SET status='completed', archived_from_status=NULL WHERE id=?", (item,))
        self.assertEqual(self.db.execute("SELECT status FROM media_items WHERE id=?", (item,)).fetchone()[0], "archived")

    def test_cross_category_full_is_rejected(self) -> None:
        self.fill()
        item = add(self.db, "tv")
        with self.assertRaisesRegex(sqlite3.IntegrityError, "CATEGORY_FULL"):
            self.db.execute("UPDATE media_items SET category_id='movie' WHERE id=?", (item,))
        self.assertEqual(summary(self.db, "tv")["retained"], 1)
        self.assertEqual(summary(self.db)["retained"], 10)

    def test_cross_category_available_updates_both_counts(self) -> None:
        item = add(self.db, "tv")
        self.db.execute("UPDATE media_items SET category_id='movie' WHERE id=?", (item,))
        self.assertEqual(summary(self.db, "tv")["retained"], 0)
        self.assertEqual(summary(self.db)["retained"], 1)

    def test_capacity_shrink_and_invalid_capacity(self) -> None:
        self.fill(count=9)
        with self.assertRaisesRegex(sqlite3.IntegrityError, "CAPACITY_TOO_SMALL"):
            self.db.execute("UPDATE categories SET capacity=8 WHERE id='movie'")
        self.db.execute("UPDATE categories SET capacity=9 WHERE id='movie'")
        for value in (-1, 1.5, "bad"):
            with self.subTest(value=value), self.assertRaises(sqlite3.IntegrityError):
                self.db.execute("UPDATE categories SET capacity=? WHERE id='comic'", (value,))

    def test_delete_then_failed_insert_rolls_back_whole_transaction(self) -> None:
        old_item = self.fill()[0]
        self.db.execute("BEGIN IMMEDIATE")
        try:
            self.db.execute("DELETE FROM media_items WHERE id=?", (old_item,))
            add(self.db, title=" ")
        except sqlite3.IntegrityError:
            self.db.execute("ROLLBACK")
        else:
            self.fail("Invalid incoming data unexpectedly accepted")
        self.assertIsNotNone(self.db.execute("SELECT id FROM media_items WHERE id=?", (old_item,)).fetchone())
        self.assertEqual(summary(self.db)["retained"], 10)

    def test_archive_then_failed_insert_rolls_back_whole_transaction(self) -> None:
        old_item = self.fill()[0]
        self.db.execute("BEGIN IMMEDIATE")
        try:
            archive(self.db, old_item)
            add(self.db, rating=3.3)
        except sqlite3.IntegrityError:
            self.db.execute("ROLLBACK")
        else:
            self.fail("Invalid rating unexpectedly accepted")
        row = self.db.execute("SELECT status, archived_from_status FROM media_items WHERE id=?", (old_item,)).fetchone()
        self.assertEqual(tuple(row), ("planned", None))
        self.assertEqual(summary(self.db)["retained"], 10)

    def test_successful_restore_replacement(self) -> None:
        candidate = self.fill()[0]
        incoming = add(self.db, status="archived", archived_from_status="completed", has_completed=1)
        self.db.execute("BEGIN IMMEDIATE")
        archive(self.db, candidate)
        self.db.execute("UPDATE media_items SET status='completed', archived_from_status=NULL, version=version+1 WHERE id=?", (incoming,))
        self.db.execute("COMMIT")
        self.assertEqual(summary(self.db)["retained"], 10)
        self.assertEqual(self.db.execute("SELECT status FROM media_items WHERE id=?", (candidate,)).fetchone()[0], "archived")
        self.assertEqual(self.db.execute("SELECT status FROM media_items WHERE id=?", (incoming,)).fetchone()[0], "completed")

    def test_mutation_record_is_transactional_and_unique(self) -> None:
        request_id = str(uuid4())
        arguments = (request_id, "replacement", "a" * 64, json.dumps({"status": 200}))
        insert = "INSERT INTO mutation_requests(request_id, operation, payload_hash, result_json) VALUES (?, ?, ?, ?)"
        self.db.execute("BEGIN IMMEDIATE")
        self.db.execute(insert, arguments)
        self.db.execute("ROLLBACK")
        self.assertEqual(self.db.execute("SELECT count(*) FROM mutation_requests").fetchone()[0], 0)
        self.db.execute(insert, arguments)
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute(insert, arguments)
        # Actual request hashing/replay logic is future service code, not tested here.

    def test_optimistic_update_pattern(self) -> None:
        item = add(self.db)
        update = "UPDATE media_items SET notes=?, version=version+1 WHERE id=? AND version=?"
        self.assertEqual(self.db.execute(update, ("first", item, 1)).rowcount, 1)
        self.assertEqual(self.db.execute(update, ("stale", item, 1)).rowcount, 0)
        self.assertEqual(self.db.execute("SELECT notes FROM media_items WHERE id=?", (item,)).fetchone()[0], "first")

    def test_invalid_completion_and_archive_combinations(self) -> None:
        cases = [
            {"status": "completed"},
            {"status": "archived"},
            {"status": "archived", "archived_from_status": "completed"},
            {"status": "watching", "archived_from_status": "watching"},
            {"date_completed": "2026-10-01"},
            {"has_completed": 2},
        ]
        for changes in cases:
            with self.subTest(changes=changes), self.assertRaises(sqlite3.IntegrityError):
                add(self.db, **changes)

    def test_invalid_fields_and_foreign_keys(self) -> None:
        cases = [{"status": "unknown"}, {"rating": -0.5}, {"rating": 10.5}, {"rating": 2.3},
                 {"favorite": 2}, {"category_id": "game"}, {"cover_asset_id": str(uuid4())},
                 {"title": ""}, {"title": " untrimmed "}, {"original_title": ""}]
        for changes in cases:
            with self.subTest(changes=changes), self.assertRaises(sqlite3.IntegrityError):
                add(self.db, **changes)
        add(self.db, rating=0)
        add(self.db, rating=10)
        add(self.db, rating=7.5)
        add(self.db, rating=None)

    def test_calendar_validation(self) -> None:
        add(self.db, date_added="2024-02-29")
        for date_value in ("2025-02-29", "2026-02-30", "2026-13-01", "2026-00-10", "2026-04-31", "2026-1-01", "0000-01-01", "garbage"):
            for field in ("date_added", "date_completed"):
                with self.subTest(date=date_value, field=field), self.assertRaises(sqlite3.IntegrityError):
                    add(self.db, **{field: date_value, "has_completed": 1})

    def test_asset_constraints_and_referenced_asset_protection(self) -> None:
        insert = "INSERT INTO assets(id, filename, mime, size) VALUES (?, ?, ?, ?)"
        for filename, mime, size in [("../cover.png", "image/png", 1), ("a\\b.png", "image/png", 1),
                                     ("C:cover.png", "image/png", 1), ("x.svg", "image/svg+xml", 1),
                                     ("x.png", "image/png", 5242881)]:
            with self.subTest(filename=filename, mime=mime, size=size), self.assertRaises(sqlite3.IntegrityError):
                self.db.execute(insert, (str(uuid4()), filename, mime, size))
        asset = str(uuid4())
        self.db.execute(insert, (asset, asset + ".png", "image/png", 1))
        add(self.db, cover_asset_id=asset)
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("DELETE FROM assets WHERE id=?", (asset,))
        # The schema does not validate actual image bytes; L4 must decode images.

    def test_fixed_categories_and_item_identity(self) -> None:
        with self.assertRaisesRegex(sqlite3.IntegrityError, "FIXED_CATEGORY"):
            self.db.execute("DELETE FROM categories WHERE id='comic'")
        with self.assertRaisesRegex(sqlite3.IntegrityError, "IMMUTABLE_ID"):
            self.db.execute("UPDATE categories SET id='other' WHERE id='comic'")
        item = add(self.db)
        with self.assertRaisesRegex(sqlite3.IntegrityError, "IMMUTABLE_ID"):
            self.db.execute("UPDATE media_items SET id=? WHERE id=?", (str(uuid4()), item))

    def test_two_independent_connections_compete_for_last_slot(self) -> None:
        with tempfile.TemporaryDirectory(prefix="limited-library-l0-") as temp_dir:
            database_path = str(Path(temp_dir) / "synthetic.sqlite")
            seed = connect(database_path)
            try:
                seed.execute("PRAGMA journal_mode=WAL")
                for _ in range(9):
                    add(seed)
            finally:
                seed.close()
            barrier = threading.Barrier(2)
            results: list[str] = []
            lock = threading.Lock()

            def contender() -> None:
                db = connect(database_path, initialize=False)
                outcome = "unexpected"
                try:
                    barrier.wait(timeout=5)
                    db.execute("BEGIN IMMEDIATE")
                    time.sleep(0.05)
                    add(db)
                    db.execute("COMMIT")
                    outcome = "committed"
                except sqlite3.IntegrityError as error:
                    outcome = str(error)
                except Exception as error:
                    outcome = type(error).__name__ + ": " + str(error)
                finally:
                    if db.in_transaction:
                        db.execute("ROLLBACK")
                    db.close()
                    with lock:
                        results.append(outcome)

            threads = [threading.Thread(target=contender) for _ in range(2)]
            for thread in threads:
                thread.start()
            for thread in threads:
                thread.join(timeout=10)
                self.assertFalse(thread.is_alive(), "Contender did not finish")
            self.assertCountEqual(results, ["committed", "CATEGORY_FULL"])
            verify = connect(database_path, initialize=False)
            try:
                self.assertEqual(summary(verify)["retained"], 10)
                self.assertEqual(verify.execute("PRAGMA integrity_check").fetchone()[0], "ok")
            finally:
                verify.close()


class DocumentChecks(unittest.TestCase):
    def test_original_task_is_preserved(self) -> None:
        task_file = ROOT / "01-Limited-Library-Codex任务书.md"
        self.assertEqual(hashlib.sha256(task_file.read_bytes()).hexdigest(), ORIGINAL_HASH)

    def test_required_documents_and_scope_labels(self) -> None:
        for relative in ("README.md", "docs/PLAN.md", "docs/VALIDATION.md"):
            content = (ROOT / relative).read_text(encoding="utf-8")
            with self.subTest(file=relative):
                self.assertIn("L0", content)
                self.assertIn("未", content)
                self.assertIn("已看", content)
                fences = re.findall(r"^\s*```", content, flags=re.MULTILINE)
                self.assertEqual(len(fences) % 2, 0, "Unclosed Markdown code fence")
                for target in re.findall(r"\]\(([^)]+)\)", content):
                    if re.match(r"^[a-zA-Z][a-zA-Z0-9+.-]*:", target) or target.startswith("#"):
                        continue
                    path_part = target.split("#", 1)[0]
                    if path_part:
                        self.assertTrue(((ROOT / relative).parent / path_part).is_file(), target)

    def test_readme_and_plan_cover_categories_and_history_fields(self) -> None:
        readme = (ROOT / "README.md").read_text(encoding="utf-8")
        plan = (ROOT / "docs" / "PLAN.md").read_text(encoding="utf-8")
        for category, capacity in CAPACITIES.items():
            self.assertRegex(readme, rf"\| {category} \| {capacity} \|")
            self.assertRegex(plan, rf"\| {category} \| {capacity} \|")
        for field in ("has_completed", "archived_from_status", "mutation_requests", "BEGIN IMMEDIATE", "ROLLBACK"):
            self.assertIn(field, plan)
        db = connect()
        try:
            columns = {r["name"] for r in db.execute("PRAGMA table_info(media_items)")}
            self.assertTrue({"has_completed", "archived_from_status", "favorite", "date_completed", "version"} <= columns)
        finally:
            db.close()


if __name__ == "__main__":
    print(f"L0 design checks | Python SQLite {sqlite3.sqlite_version} | synthetic data only", flush=True)
    unittest.main(verbosity=2)
