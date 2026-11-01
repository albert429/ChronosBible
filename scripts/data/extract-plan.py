"""Extract the reading table, preserving original paragraph and passage order."""

import argparse
import json
from pathlib import Path
import sys
import xml.etree.ElementTree as ET
import zipfile

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "lib"))
from chronos_tools.paths import ROOT  # noqa: E402

NAMESPACES = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}


def extract_rows(source: Path) -> list:
    with zipfile.ZipFile(source) as archive:
        document = ET.fromstring(archive.read("word/document.xml"))

    rows = []
    for row in document.findall(".//w:tr", NAMESPACES):
        cells = []
        for cell in row.findall("w:tc", NAMESPACES):
            paragraphs = []
            for paragraph in cell.findall(".//w:p", NAMESPACES):
                text = "".join(
                    run.text or ""
                    for run in paragraph.findall(".//w:t", NAMESPACES)
                )
                paragraphs.append(text)
            cells.append(paragraphs)
        rows.append(cells)
    return rows


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path, help="Original 150-day Word document")
    args = parser.parse_args()
    rows = extract_rows(args.source)
    (ROOT / "data/source-plan.json").write_text(
        json.dumps(rows, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(f"Extracted {len(rows) - 1} daily entries")


if __name__ == "__main__":
    main()
