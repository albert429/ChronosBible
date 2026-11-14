"""Run every colocated Python suite with common script-loading support."""
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts" / "tests"))
runner = unittest.TextTestRunner(verbosity=1)
failed = False
count = 0
for directory in sorted((ROOT / "scripts").glob("*/tests")):
    if not list(directory.glob("test_*.py")):
        continue
    suite = unittest.TestLoader().discover(str(directory))
    count += suite.countTestCases()
    failed |= not runner.run(suite).wasSuccessful()
if not count:
    raise SystemExit("No Python tests discovered")
raise SystemExit(int(failed))
