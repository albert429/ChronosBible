"""Inventory-owned generator output: validate first, delete only unmodified owned files."""
import json
import re
import tempfile
import unittest
from pathlib import Path

from _support import ROOT, load_script
from chronos_tools.fingerprints import digest
from chronos_tools.ownership import OwnershipError, adopt_existing, publish_owned, read_inventory

PATTERN = re.compile(r"^(?:OT|NT)/[A-Za-z0-9][A-Za-z0-9_-]*\.json$")


class Publish(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.base = Path(self.tmp.name) / "readings"

    def publish(self, names, **options):
        return publish_owned(self.base, {n: n.encode() for n in names}, PATTERN, **options)

    def inventory(self):
        return json.loads((self.base / "inventory.json").read_text())

    def test_writes_files_and_a_sorted_inventory(self):
        self.assertEqual(self.publish(["OT/b.json", "NT/a.json"]), {"written": 2, "removed": 0, "kept": 0})
        self.assertEqual(self.inventory(), {"v": 1, "files": {
            "NT/a.json": digest(b"NT/a.json"), "OT/b.json": digest(b"OT/b.json")}})
        self.assertEqual((self.base / "OT/b.json").read_bytes(), b"OT/b.json")

    def test_removes_only_unmodified_obsolete_owned_files(self):
        self.publish(["OT/a.json", "OT/b.json"])
        stranger = self.base / "OT/stranger.json"
        stranger.write_text("not ours")
        (self.base / "notes.txt").write_text("keep")
        self.assertEqual(self.publish(["OT/a.json"])["removed"], 1)
        self.assertFalse((self.base / "OT/b.json").exists())
        self.assertTrue(stranger.exists())
        self.assertTrue((self.base / "notes.txt").exists())
        self.assertEqual(list(self.inventory()["files"]), ["OT/a.json"])

    def test_refuses_to_remove_a_modified_owned_file(self):
        self.publish(["OT/a.json", "OT/b.json"])
        (self.base / "OT/b.json").write_text("edited by hand")
        with self.assertRaisesRegex(OwnershipError, "modified"):
            self.publish(["OT/a.json"])
        self.assertEqual((self.base / "OT/b.json").read_text(), "edited by hand")

    def test_nothing_is_written_when_validation_fails(self):
        self.publish(["OT/a.json", "OT/b.json"])
        (self.base / "OT/b.json").write_text("edited by hand")
        with self.assertRaises(OwnershipError):
            publish_owned(self.base, {"OT/a.json": b"changed", "OT/c.json": b"new"}, PATTERN)
        self.assertEqual((self.base / "OT/a.json").read_bytes(), b"OT/a.json")
        self.assertFalse((self.base / "OT/c.json").exists())

    def test_a_pilot_keeps_everything_it_did_not_rebuild(self):
        self.publish(["OT/a.json", "OT/b.json"])
        self.assertEqual(self.publish(["OT/a.json"], prune=False), {"written": 1, "removed": 0, "kept": 1})
        self.assertTrue((self.base / "OT/b.json").exists())
        self.assertEqual(sorted(self.inventory()["files"]), ["OT/a.json", "OT/b.json"])

    def test_a_missing_obsolete_file_is_not_an_error(self):
        self.publish(["OT/a.json", "OT/b.json"])
        (self.base / "OT/b.json").unlink()
        self.assertEqual(self.publish(["OT/a.json"])["removed"], 0)

    def test_rejects_unsafe_generated_paths(self):
        for path in ("../x.json", "OT/../x.json", "/abs.json", "OT/a.txt", "XX/a.json", "OT/.hidden.json", "inventory.json"):
            with self.assertRaisesRegex(OwnershipError, "unsafe"):
                publish_owned(self.base, {path: b"x"}, PATTERN)
        self.assertFalse(self.base.exists())

    def test_rejects_symlinks(self):
        outside = Path(self.tmp.name) / "outside"
        outside.mkdir()
        self.publish(["OT/a.json"])
        (self.base / "NT").symlink_to(outside, target_is_directory=True)
        with self.assertRaisesRegex(OwnershipError, "symlink"):
            self.publish(["OT/a.json", "NT/b.json"])
        self.assertEqual(list(outside.iterdir()), [])
        (self.base / "NT").unlink()
        (self.base / "OT/link.json").symlink_to(outside)
        with self.assertRaisesRegex(OwnershipError, "symlink"):
            self.publish(["OT/link.json"])

    def test_rejects_a_symlinked_folder_or_inventory(self):
        real = Path(self.tmp.name) / "real"
        real.mkdir()
        self.base.symlink_to(real, target_is_directory=True)
        with self.assertRaisesRegex(OwnershipError, "symlink"):
            self.publish(["OT/a.json"])
        self.base.unlink()
        self.publish(["OT/a.json"])
        (self.base / "inventory.json").rename(self.base / "kept.txt")
        (self.base / "inventory.json").symlink_to(self.base / "kept.txt")
        with self.assertRaisesRegex(OwnershipError, "symlink"):
            self.publish(["OT/a.json"])

    def test_rejects_an_invalid_inventory(self):
        self.base.mkdir()
        for body in ("not json", "[]", '{"v": 2, "files": {}}', '{"v": 1, "files": {"../x.json": "%s"}}' % ("a" * 64),
                     '{"v": 1, "files": {"OT/a.json": "short"}}'):
            (self.base / "inventory.json").write_text(body)
            with self.assertRaises(OwnershipError, msg=body):
                read_inventory(self.base, PATTERN)

    def test_adoption_records_existing_files_once(self):
        (self.base / "OT").mkdir(parents=True)
        (self.base / "OT/a.json").write_text("a")
        (self.base / "OT/readme.txt").write_text("ignored")
        self.assertEqual(adopt_existing(self.base, PATTERN), 1)
        self.assertEqual(self.inventory()["files"], {"OT/a.json": digest(b"a")})
        self.assertEqual(self.publish([])["removed"], 1)


class CommittedReadings(unittest.TestCase):
    """data/audio/readings is owned by build-reading-audio.py through its inventory."""

    folder = ROOT / "data/audio/readings"

    def test_inventory_lists_exactly_the_committed_manifests(self):
        builder = load_script("audio/build-reading-audio.py", "build_reading_audio_owned")
        recorded = read_inventory(self.folder, builder.READING_MANIFEST)
        on_disk = {p.relative_to(self.folder).as_posix() for p in self.folder.rglob("*.json")} - {"inventory.json"}
        self.assertEqual(set(recorded), on_disk)
        for path, checksum in recorded.items():
            self.assertEqual(digest((self.folder / path).read_bytes()), checksum, path)

    def test_catalog_lists_the_same_readings(self):
        catalog = json.loads((ROOT / "data/audio/reading-catalog.json").read_text())["readings"]
        recorded = read_inventory(self.folder, re.compile(r".*"))
        self.assertEqual(sorted(f"{r.split(':')[1]}/{r.split(':')[2]}.json" for r in catalog), sorted(recorded))


if __name__ == "__main__":
    unittest.main()
