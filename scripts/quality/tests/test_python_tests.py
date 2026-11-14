"""Exercise runner selection in an isolated repository with tiny real suites."""
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from _support import ROOT


class PythonRunner(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.runner = self.root / "scripts/quality/python-tests.py"
        self.runner.parent.mkdir(parents=True)
        shutil.copyfile(ROOT / "scripts/quality/python-tests.py", self.runner)
        for owner, name in [("audio", "first"), ("audio", "second"), ("data", "third")]:
            self.put(owner, name)

    def put(self, owner, name, body="pass"):
        target = self.root / f"scripts/{owner}/tests/test_{name}.py"
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(f"import unittest\nclass Case(unittest.TestCase):\n    def test_{name}(self):\n        print('{name}')\n        {body}\n", encoding="utf-8")

    def run_tests(self, *args):
        return subprocess.run([sys.executable, "-I", str(self.runner), *args],
                              cwd=self.root, capture_output=True, text=True)

    def test_no_selector_preserves_all_owners(self):
        result = self.run_tests()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(set(result.stdout.splitlines()), {"first", "second", "third"})

    def test_owner_selects_only_its_suites(self):
        result = self.run_tests("audio")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(set(result.stdout.splitlines()), {"first", "second"})

    def test_file_selects_only_that_suite(self):
        result = self.run_tests("scripts/audio/tests/test_second.py")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout.splitlines(), ["second"])

    def test_help_does_not_execute_suites(self):
        result = self.run_tests("--help")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("selector", result.stdout)
        self.assertNotIn("Ran ", result.stderr)

    def test_invalid_selection_or_arguments_fail_without_running(self):
        for selector in ["", "missing", "scripts/audio/tests/test_missing.py", "../test_first.py", "--unknown"]:
            with self.subTest(selector=selector):
                result = self.run_tests(selector)
                self.assertEqual(result.returncode, 2)
                self.assertEqual(result.stdout, "")

    def test_empty_selected_suite_fails(self):
        (self.root / "scripts/audio/tests/test_second.py").write_text("", encoding="utf-8")
        result = self.run_tests("scripts/audio/tests/test_second.py")
        self.assertEqual(result.returncode, 2)
        self.assertIn("No Python tests discovered", result.stderr)

    def test_no_suites_discovered_fails(self):
        shutil.rmtree(self.root / "scripts/audio")
        shutil.rmtree(self.root / "scripts/data")
        result = self.run_tests()
        self.assertEqual(result.returncode, 2)
        self.assertIn("No Python tests discovered", result.stderr)

    def test_suite_failure_propagates(self):
        self.put("data", "third", "self.fail('fixture failure')")
        result = self.run_tests("data")
        self.assertEqual(result.returncode, 1)
        self.assertIn("fixture failure", result.stderr)
