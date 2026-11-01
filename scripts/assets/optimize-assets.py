"""Rebuild lossless WOFF2 fonts and resized artwork (optional development tool).

Install fonttools brotli pillow. Generated assets are committed;
deployment does not require Python.
"""
from pathlib import Path
import sys
from fontTools.ttLib import TTFont
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "lib"))
from chronos_tools.paths import ROOT as root  # noqa: E402

output = root / "src/assets"
output.mkdir(parents=True, exist_ok=True)
for source in (root / "assets/source-fonts").glob("*.ttf"):
    font = TTFont(source, recalcTimestamp=False)
    font.flavor = "woff2"
    target = output / (source.stem + ".woff2")
    font.save(target)
    restored = TTFont(target)
    assert font.getGlyphOrder() == restored.getGlyphOrder()
    assert font.getBestCmap() == restored.getBestCmap()
    for table in ("GSUB", "GPOS"):
        assert font.getTableData(table) == restored.getTableData(table)
    print(f"{source.name}: {source.stat().st_size} -> {target.stat().st_size} bytes")
with Image.open(root / "assets/source-images/church-logo.png") as original:
    for size in (192,):
        target = output / f"church-logo-{size}.png"
        artwork = original.convert("RGBA")
        artwork.thumbnail((size, size), Image.Resampling.LANCZOS)
        artwork.save(target, optimize=True)
        print(f"{target.name}: {target.stat().st_size} bytes")
