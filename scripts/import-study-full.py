"""Import canonical full-Bible study from pinned, locally downloaded sources.

The existing NT inputs and legacy daily output remain unchanged. No network is
used here or during ordinary builds. See data/study/CANONICAL.md for sources.
"""

import argparse
from collections import Counter
import difflib
import gzip
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import sys
import zipfile

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location("legacy_study", ROOT / "scripts/import-study.py")
legacy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(legacy)
STEP_COMMIT = "be4191f0082aeedddb0eff0c02c966292b2bd641"
STRONG = re.compile(r"H\d{4}[A-Za-z]*")
REF = re.compile(r"^[1-3]?[A-Z][a-z]{1,2}\.\d+\.\d+$")
# These source blocks contain two Arabic verses. The Hebrew reference suffixes
# explicitly identify the second verse; ordinary Hebrew numbering is NOT used
# as the Arabic verse identity (notably in Psalms).
SPLIT_BLOCKS = {"2KI.4.43": ("4.44", "2KI.4.44"), "PSA.72.19": ("72.20", "PSA.72.20")}
# Reviewed source rows have fewer written word parts than lexical/morph tags.
MISSING_SURFACES = {("1CH.27.12", "#06 - #07"): 1, ("NEH.2.13", "#17"): 1}


def encoded(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), sort_keys=True).encode()


def digest(value):
    return hashlib.sha256(value).hexdigest()


def clean_field(value):
    return value.strip().replace("{", "").replace("}", "")


def hebrew_lexicon(path):
    """Import only STEP lemma/gloss. The Online Bible definition column is excluded."""
    lex = {}
    for line in path.read_text(encoding="utf-8-sig").splitlines():
        c = line.split("\t")
        if len(c) < 8 or not STRONG.fullmatch(c[0].strip()):
            continue
        entry = {"l": c[3].strip(), "g": c[6].strip(), "d": ""}
        for field in c[:3]:
            for key in STRONG.findall(field):
                lex.setdefault(key, entry)
    return lex


def grammar_parts(value):
    result = []
    for word in value.split(";"):
        word = word.strip()
        if not word or word[0] not in "HA":
            raise ValueError(f"Unknown Hebrew/Aramaic grammar: {value!r}")
        result.extend((word[0] + part, "he" if word[0] == "H" else "arc") for part in word[1:].split("/"))
    return result


def parse_ot(path, codes, lex):
    """Preserve source row order and split lexical affixes without Greek filtering."""
    with zipfile.ZipFile(path) as archive:
        names = [n for n in archive.namelist() if n.endswith(".txt")]
        if len(names) != 1:
            raise ValueError("Expected one OT text in archive")
        lines = archive.read(names[0]).decode("utf-8-sig").splitlines()
    result, exceptions, key = {}, [], None
    for line in lines:
        if REF.fullmatch(line):
            code, chapter, verse = line.split(".")
            key = f"{codes[code]}.{int(chapter)}.{int(verse)}"
            if key in result:
                raise ValueError(f"Duplicate OT reference: {key}")
            result[key] = []
            continue
        c = line.split("\t")
        if key is None or len(c) < 2 or c[0] == "Ara W#":
            continue
        c += [""] * max(0, 9 - len(c))
        if not c[0].startswith("#") and not (c[2].strip() and c[3].strip()):
            continue
        positions = [int(p) for p in legacy.POSITION.findall(c[0])]
        if len(positions) == 2 and "-" in c[0]:
            positions = list(range(positions[0], positions[1] + 1))
        if not (c[2].strip() and c[3].strip()):
            result[key].append({"positions": positions, "arabic": c[1], "tokens": [], "source": c[8]})
            continue
        strongs = [clean_field(s).replace("+", "") for s in c[2].split(";")]
        words = [w.strip().rstrip(";") for w in c[3].split()]
        translits = [s.strip() for s in c[6].split(";")]
        morphs = grammar_parts(c[7])
        if len(morphs) != len(strongs):
            # Eight source maqaf/link tokens have no grammatical part. Preserve
            # the source punctuation without fabricating a morphology code.
            for index, strong in enumerate(strongs):
                if strong == "H9014":
                    language = morphs[max(0, min(index - 1, len(morphs) - 1))][1]
                    morphs.insert(index, ("", language))
        glosses = [clean_field(s) for s in c[5].split(";")]
        if not c[5].strip():
            glosses = [lex.get(s, lex.get(s[:5], {})).get("g", "") for s in strongs]
        if not all(STRONG.fullmatch(s) for s in strongs):
            raise ValueError(f"Malformed Strong's at {key}: {c[2]!r}")
        if len({len(strongs), len(translits), len(morphs), len(glosses)}) != 1:
            raise ValueError(f"Mismatched OT fields at {key}: {c}")
        if len(words) != len(strongs):
            missing = len(strongs) - len(words)
            if MISSING_SURFACES.get((key, c[0])) != missing:
                raise ValueError(f"Unreviewed surface mismatch at {key}: {c}")
            exceptions.append({"verse": key, "row": c[0], "reason": "Source omits written surface for final lexical element; do not invent it", "omittedStrongs": strongs[len(words):]})
        lemmas = [clean_field(s) for s in c[4].split(";")]
        for index, strong in enumerate(strongs):
            if strong not in lex and strong[:5] not in lex:
                if strong not in {"H5892I", "H7417I"} or len(lemmas) != len(strongs):
                    raise ValueError(f"Unreviewed missing lexicon tag: {strong}")
                lex[strong] = {"l": lemmas[index], "g": glosses[index], "d": ""}
                exceptions.append({"verse": key, "strong": strong, "reason": "Tag absent from TBESH; lemma and gloss retained verbatim from TTAraSVD"})
        tokens = [[word, trans, strong, morph, gloss, None, None, lang]
                  for word, trans, strong, (morph, lang), gloss in zip(words, translits, strongs, morphs, glosses)]
        target = key
        if key in SPLIT_BLOCKS:
            suffix, other = SPLIT_BLOCKS[key]
            if c[8].startswith(f"({suffix})"):
                target = other
        result.setdefault(target, []).append({"positions": positions, "arabic": c[1], "tokens": tokens, "source": c[8]})
    return result, exceptions


def source_words(rows):
    words = {}
    for row in rows:
        pieces = row["arabic"].split()
        for i, pos in enumerate(row["positions"]):
            word = pieces[i] if i < len(pieces) else ""
            if pos in words and legacy.norm(words[pos]) != legacy.norm(word):
                raise ValueError(f"Inconsistent Arabic source position {pos}")
            words[pos] = word
    return words


def strip_superscription(rows, heading):
    """Remove a verified source title prefix, never treating it as verse text."""
    if not heading:
        return rows, 0
    words = source_words(rows)
    expected = legacy.norm(heading)
    prefix, last = "", None
    for p in sorted(words):
        prefix += legacy.norm(words[p])
        if prefix == expected:
            last = p
            break
        if len(prefix) > len(expected):
            break
    if last is None:
        raise ValueError(f"Unreviewed superscription mismatch: {heading!r}; {list(words.values())[:20]}")
    result, reached_verse, removed = [], False, 0
    for row in rows:
        pos = row["positions"]
        if pos and max(pos) > last:
            reached_verse = True
        if pos and min(pos) <= last < max(pos):
            raise ValueError("Source row straddles a superscription and verse")
        if (pos and max(pos) <= last) or (not pos and not reached_verse):
            removed += len(row["tokens"])
        else:
            result.append(row)
    return result, removed


def align_rows(rows, text):
    """Only exact normalized matching blocks are allowed to claim Arabic spans."""
    source = source_words(rows)
    order = sorted(source)
    a = [legacy.norm(source[p]) for p in order]
    display = text.split(" ")
    b = [legacy.norm(w) for w in display]
    matcher = difflib.SequenceMatcher(None, a, b, autojunk=False)
    mapping = {order[i + offset]: j + offset for i, j, count in matcher.get_matching_blocks() for offset in range(count)}
    output, unaligned = [], 0
    for row in rows:
        positions = row["positions"]
        indexes = [mapping[p] for p in positions if p in mapping]
        valid = bool(positions) and len(indexes) == len(positions) and indexes == list(range(min(indexes), max(indexes) + 1))
        if valid:
            valid = legacy.norm(row["arabic"]) == legacy.norm(" ".join(display[indexes[0]:indexes[-1] + 1]))
        for token in row["tokens"]:
            token = token.copy()
            if valid:
                token[5], token[6] = indexes[0], indexes[-1]
            elif positions:
                unaligned += 1
            output.append(token)
    return output, unaligned


def translation(path, suffix, codes):
    result, bridges = {}, []
    with zipfile.ZipFile(path) as archive:
        for code in codes:
            names = [n for n in archive.namelist() if n.endswith(f"-{code}{suffix}.usfm")]
            if len(names) != 1:
                raise ValueError(f"Expected one {suffix} source for {code}")
            text = archive.read(names[0]).decode("utf-8-sig")
            # NAV Acts15:25–26 has an RTL mark inside the numeric USFM marker.
            # Normalize only markers, not Scripture wording or all bidi marks.
            text = re.sub(r"(\\v\s+)([\d\-\u200e\u200f]+)(?=\s)", lambda m: m[1] + m[2].replace("\u200f", "").replace("\u200e", ""), text)
            chapters, ranges = legacy.usfm.parse(text)
            for chapter, verses in chapters.items():
                for verse, wording in verses.items():
                    key = f"{code}.{chapter}.{verse}"
                    bridge = ranges.get((chapter, verse))
                    result[key] = {"b": bridge, "t": wording} if bridge else wording
                    if bridge:
                        bridges.append(key)
    # The same wording spans two Van Dyck verses; preserve the complete KJV
    # verse and label the displayed canonical range rather than splitting prose.
    if suffix == "eng-kjv":
        for key, second, label in [("1TI.6.21", "1TI.6.22", "21-22"), ("3JN.1.14", "3JN.1.15", "14-15")]:
            value = {"b": label, "t": result[key]}
            result[key] = result[second] = value
            bridges.extend([key, second])
    return result, bridges


def verify_sources(paths, pins, legacy_folder):
    if pins["stepCommit"] != STEP_COMMIT:
        raise ValueError("STEP commit differs from reviewed source pins")
    for name, pin in pins["sources"].items():
        if digest(paths[name].read_bytes()) != pin["sha256"]:
            raise ValueError(f"Source checksum mismatch for {name}; review and update pins explicitly")
    for name, expected in pins["legacyNt"].items():
        if digest((legacy_folder / name).read_bytes()) != expected:
            raise ValueError(f"Legacy NT source checksum mismatch for {name}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("ot", "tbesh", "nav", "kjv"):
        parser.add_argument("--" + name, type=Path, required=True)
    parser.add_argument("--report", type=Path, required=True)
    args = parser.parse_args()
    pins = json.loads((ROOT / "data/study/canonical-sources.json").read_text())
    verify_sources({name: getattr(args, name) for name in pins["sources"]}, pins, ROOT / "data/study")
    source_path = ROOT / "data/bible/source.json.gz"
    bible = json.loads(gzip.decompress(source_path.read_bytes()))
    books = json.loads((ROOT / "data/books.json").read_text())
    codes = [b[0] for b in books]
    lex = hebrew_lexicon(args.tbesh)
    rows, exceptions = parse_ot(args.ot, {b[2]: b[0] for b in books}, lex)
    canonical = {f"{b['usfm']}.{c['chapter']}.{v['number']}": v["text"] for b in bible["books"] for c in b["chapters"] for v in c["verses"]}
    ot_ids = {key for key in canonical if key.split(".")[0] in codes[:39]}
    if set(rows) != ot_ids:
        raise ValueError(f"OT reference coverage mismatch: missing={sorted(ot_ids-set(rows))}, extra={sorted(set(rows)-ot_ids)}")
    headings = {f"{b['usfm']}.{c['chapter']}.1": " ".join(s["text"] for s in c["structure"] if s["kind"] == "superscription") for b in bible["books"][:39] for c in b["chapters"]}
    ot, unmapped, titles = {}, {}, {}
    for key, verse_rows in rows.items():
        verse_rows, removed = strip_superscription(verse_rows, headings.get(key, ""))
        if removed:
            titles[key] = removed
        tokens, count = align_rows(verse_rows, canonical[key])
        if not tokens:
            raise ValueError(f"No original words at {key}")
        ot[key] = tokens
        if count:
            unmapped[key] = count
    used = {t[2] for tokens in ot.values() for t in tokens}
    resolved = {key: lex.get(key, lex.get(key[:5])) for key in sorted(used)}
    missing_lex = [key for key, value in resolved.items() if value is None]
    if missing_lex:
        raise ValueError(f"Missing Hebrew lemma/gloss: {missing_lex}")
    nav, nav_bridges = translation(args.nav, "arbnav", codes)
    kjv, kjv_bridges = translation(args.kjv, "eng-kjv", codes)
    for name, values in [("NAV", nav), ("KJV", kjv)]:
        if set(values) != set(canonical) or any(not (v if isinstance(v, str) else v['t']) for v in values.values()):
            raise ValueError(f"{name} coverage mismatch: missing={sorted(set(canonical)-set(values))}, extra={sorted(set(values)-set(canonical))}")
    translations = {k: {"n": nav[k], "e": kjv[k]} for k in canonical}
    output = {"v": 2, "ot": ot, "translations": translations, "lexicon": resolved}
    raw = encoded(output)
    compressed = gzip.compress(raw, compresslevel=9, mtime=0)
    out = ROOT / "data/study/canonical.json.gz"
    out.write_bytes(compressed)
    paths = {
        "ot": f"https://raw.githubusercontent.com/STEPBible/STEPBible-Data/{STEP_COMMIT}/Tagged-Bibles/Arabic%20Bibles/TTAraSVD%20-%20Translation%20Tags%20for%20Arabic%20SVD%20-%20STEPBible.org%20CC%20BY-SA_OT_4_0_1.txt.zip",
        "tbesh": f"https://raw.githubusercontent.com/STEPBible/STEPBible-Data/{STEP_COMMIT}/Lexicons/TBESH%20-%20Translators%20Brief%20lexicon%20of%20Extended%20Strongs%20for%20Hebrew%20-%20STEPBible.org%20CC%20BY.txt",
        "nav": "https://ebible.org/Scriptures/arbnav_usfm.zip",
        "kjv": "https://ebible.org/Scriptures/eng-kjv_usfm.zip",
    }
    provenance = {"v": 2, "stepCommit": STEP_COMMIT, "sourceSha256": digest(raw), "gzipSha256": digest(compressed), "bibleGzipSha256": digest(source_path.read_bytes()), "sources": {name: {"url": url, "sha256": digest(getattr(args, name).read_bytes())} for name, url in paths.items()}, "legacyNt": pins["legacyNt"]}
    (ROOT / "data/study/canonical-provenance.json").write_bytes(encoded(provenance) + b"\n")
    greek = json.loads((ROOT / "data/study/greek.json").read_text())
    report = {"canonicalVerses": len(canonical), "otVersesWithWords": len(ot), "ntVersesWithWords": len(greek), "missingNtWords": sorted(set(canonical)-ot_ids-set(greek)), "otTokens": sum(map(len, ot.values())), "languages": dict(Counter(t[7] for tokens in ot.values() for t in tokens)), "navVerses": len(nav), "kjvVerses": len(kjv), "navBridges": nav_bridges, "kjvBridges": kjv_bridges, "hebrewLexiconEntries": len(resolved), "omittedSurfaceExceptions": exceptions, "splitSourceBlocks": SPLIT_BLOCKS, "superscriptionTokensExcluded": titles, "unmappedArabicTokensByVerse": unmapped, "normalizedBytes": len(raw), "gzipBytes": len(compressed)}
    report["validatedArabicTokens"] = sum(t[5] is not None for tokens in ot.values() for t in tokens)
    report["tokensWithoutArabicEquivalent"] = report["otTokens"] - report["validatedArabicTokens"] - sum(unmapped.values())
    report["versesWithValidatedArabicSpans"] = sum(any(t[5] is not None for t in tokens) for tokens in ot.values())
    report["sourceExceptions"] = report.pop("omittedSurfaceExceptions")
    report["ntTranslationChanges"] = {}
    for name, field in [("nav", "n"), ("kjv", "e")]:
        old = json.loads((ROOT / "data/study" / (name + ".json")).read_text())
        report["ntTranslationChanges"][name] = {
            "changed": [key for key, text in old.items() if translations[key][field] != text],
            "added": [key for key in canonical if key not in ot_ids and key not in old],
        }
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps({key: value for key, value in report.items() if not isinstance(value, (dict, list))}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
