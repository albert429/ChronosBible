"""Run all colocated Python suites, or select one owner or test file."""
import argparse
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def main(argv=None, root=ROOT):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("selector", nargs="?", help="owner (for example audio), or scripts/<owner>/tests/test_*.py")
    args = parser.parse_args(argv)
    directories = sorted(directory for directory in (root / "scripts").glob("*/tests")
                         if list(directory.glob("test_*.py")))
    selections = [(directory, "test_*.py") for directory in directories]
    if args.selector is not None:
        selections = [(directory, pattern) for directory, pattern in selections
                      if directory.parent.name == args.selector]
        if not selections:
            selections = [(directory, file.name) for directory in directories
                          for file in directory.glob("test_*.py")
                          if file.relative_to(root).as_posix() == args.selector]
        if not selections:
            parser.error(f"No Python tests match {args.selector!r}")
    sys.path.insert(0, str(root / "scripts" / "tests"))
    runner = unittest.TextTestRunner(verbosity=1)
    failed = False
    count = 0
    for directory, pattern in selections:
        suite = unittest.TestLoader().discover(str(directory), pattern=pattern)
        count += suite.countTestCases()
        failed |= not runner.run(suite).wasSuccessful()
    if not count:
        parser.error("No Python tests discovered")
    return int(failed)


if __name__ == "__main__":
    raise SystemExit(main())
