#!/usr/bin/env python3
"""Verify a deployed audio release byte for byte, then record it as published.

Reads the local prepared inventory written by scripts/prepare-audio-r2.mjs
(artifacts/r2-audio-inventory.json) and checks every recording on the
deployed host, normally https://audio.chronosbible.com (the R2 bucket):

- three ranges per file (start, middle, suffix): status 206, exact
  Content-Range/Content-Length, audio/mp4, immutable caching, byte equality
  with the staged file whose SHA-256 the inventory records;
- with --full, one complete download per file whose SHA-256 must match;
- one past-the-end range must answer 416.

Only when every file passes and --publish is given is the release merged into
data/audio/publication.json, the verified upload inventory that builds use to
advertise chapters and chronological playlists. Prepared-but-unverified files
are never written there. Existing entries are kept (rollback); a path whose
bytes changed is refused, because media URLs are immutable.

Standard library only. Each range is one R2 read (a Class B operation): about
3 x files requests (or 4 x with --full), far inside the monthly allowance.
"""
import argparse
import hashlib
import http.cookiejar
import json
import os
import sys
import tempfile
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PUBLICATION = ROOT / "data/audio/publication.json"
SAMPLE = 1024
RETRIES = 3


class Failure(Exception):
    pass


def opener(cookie):
    handlers = []
    if cookie:
        jar = http.cookiejar.MozillaCookieJar(str(cookie))
        jar.load(ignore_discard=True, ignore_expires=True)
        handlers.append(urllib.request.HTTPCookieProcessor(jar))
    return urllib.request.build_opener(*handlers)


def fetch(open_url, url, headers, timeout):
    """(status, headers, body); retries only network failures and 5xx."""
    for attempt in range(RETRIES):
        request = urllib.request.Request(url, headers={"User-Agent": "bible150-audio-verify", **headers})
        try:
            with open_url(request, timeout=timeout) as response:
                return response.status, {k.lower(): v for k, v in response.headers.items()}, response.read()
        except urllib.error.HTTPError as error:
            body = error.read()
            if error.code < 500 or attempt == RETRIES - 1:
                return error.code, {k.lower(): v for k, v in error.headers.items()}, body
        except (urllib.error.URLError, TimeoutError, ConnectionError, OSError) as error:
            if attempt == RETRIES - 1:
                raise Failure(f"network error: {error}") from error
        time.sleep(1.5 * (attempt + 1))
    raise Failure("unreachable")


def expect(condition, message):
    if not condition:
        raise Failure(message)


def ranges(size):
    middle = max(0, size // 2 - SAMPLE // 2)
    return [(0, min(SAMPLE, size) - 1), (middle, min(size, middle + SAMPLE) - 1),
            (max(0, size - SAMPLE), size - 1)]


def check_file(src, record, bundle, base, open_url, full, timeout):
    path = bundle / src.lstrip("/")
    expect(path.is_file(), "missing from the staged folder")
    data = path.read_bytes()
    expect(len(data) == record["bytes"], "local size differs from the prepared inventory")
    expect(hashlib.sha256(data).hexdigest() == record["sha256"], "local hash differs from the prepared inventory")
    url = f"{base}{src}?verify=1"
    seen = {}
    for index, (start, end) in enumerate(ranges(len(data))):
        header = f"bytes=-{end - start + 1}" if index == 2 else f"bytes={start}-{end}"
        status, headers, body = fetch(open_url, url, {"Range": header}, timeout)
        expect(status == 206, f"{header}: status {status}")
        expect(headers.get("content-range") == f"bytes {start}-{end}/{len(data)}",
               f"{header}: Content-Range {headers.get('content-range')}")
        expect(headers.get("content-length") in (None, str(end - start + 1)),
               f"{header}: Content-Length {headers.get('content-length')}")
        expect((headers.get("content-type") or "").startswith("audio/mp4"), f"{header}: Content-Type")
        expect("immutable" in (headers.get("cache-control") or ""), f"{header}: Cache-Control")
        expect(body == data[start:end + 1], f"{header}: bytes differ")
        seen[header] = {"cache": headers.get("cf-cache-status")}
    if full:
        status, headers, body = fetch(open_url, url, {}, timeout * 3)
        expect(status == 200, f"full: status {status}")
        expect(hashlib.sha256(body).hexdigest() == record["sha256"], "full: SHA-256 differs")
    return {"src": src, "ok": True, "ranges": seen}


def merge(publication, prepared, host, method, now):
    """The new verified inventory; refuses changed bytes behind an existing path."""
    current = publication or {"version": 1, "releases": [], "files": {}}
    release = prepared["release"]
    if any(r["id"] == release for r in current["releases"]):
        release = f"{release}-{now.strftime('%H%M%S')}"
    files = dict(current["files"])
    for src, record in sorted(prepared["files"].items()):
        old = files.get(src)
        if old and (old["sha256"] != record["sha256"] or old["bytes"] != record["bytes"]):
            raise Failure(f"{src} changed bytes behind an immutable path")
        files[src] = old or {"bytes": record["bytes"], "sha256": record["sha256"], "release": release}
    releases = current["releases"] + [{
        "id": release, "verified": now.isoformat().replace("+00:00", "Z"), "host": host,
        "method": method, "files": len(prepared["files"])}]
    return {"version": 1, "releases": releases, "files": dict(sorted(files.items()))}


def write_json(path, value, indent=2):
    """Atomic write; indent 2 equals Prettier's JSON formatting."""
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile("w", dir=path.parent, delete=False, suffix=".tmp") as handle:
        handle.write(json.dumps(value, indent=indent) + "\n")
    os.replace(handle.name, path)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("base_url", help="Deployed audio origin, for example https://audio.chronosbible.com")
    parser.add_argument("--inventory", type=Path, default=ROOT / "artifacts/r2-audio-inventory.json",
                        help="Prepared inventory from prepare-audio-r2.mjs")
    parser.add_argument("--root", type=Path, help="Staged folder (default: the inventory's output)")
    parser.add_argument("--cookie", type=Path, help="Optional Netscape cookie file for protected previews")
    parser.add_argument("--full", action="store_true", help="Also download each file whole and compare SHA-256")
    parser.add_argument("--only", help="Comma-separated prefixes to check, e.g. /audio/chapters/ (no --publish)")
    parser.add_argument("--workers", type=int, default=6)
    parser.add_argument("--timeout", type=float, default=35)
    parser.add_argument("--max-requests", type=int, default=20000,
                        help="Refuse runs that would exceed this many host requests")
    parser.add_argument("--publish", action="store_true",
                        help="After every file passes, record the release in data/audio/publication.json")
    parser.add_argument("--publication", type=Path, default=PUBLICATION)
    parser.add_argument("--report", type=Path, default=ROOT / "artifacts/audio-host-verification.json")
    args = parser.parse_args(argv)
    if args.only and args.publish:
        parser.error("--publish needs the whole prepared release")
    base = args.base_url.rstrip("/")
    if not base.startswith("https://") and not base.startswith("http://127.0.0.1") and not base.startswith("http://localhost"):
        parser.error("base_url must be https (or a local test server)")
    prepared = json.loads(args.inventory.read_text())
    if prepared.get("kind") != "prepared" or not prepared.get("files"):
        parser.error(f"{args.inventory} is not a prepared inventory")
    bundle = args.root or Path(prepared["output"])
    files = sorted(prepared["files"].items())
    if args.only:
        prefixes = tuple(args.only.split(","))
        files = [(src, record) for src, record in files if src.startswith(prefixes)]
    requests = len(files) * (4 if args.full else 3) + 1
    if requests > args.max_requests:
        parser.error(f"{requests} requests exceed --max-requests {args.max_requests}")
    open_url = opener(args.cookie).open

    first_src, first = files[0]
    status, headers, _ = fetch(open_url, f"{base}{first_src}?verify=1", {"Range": f"bytes={first['bytes']}-"}, args.timeout)
    problems = {}
    if status != 416 or headers.get("content-range") != f"bytes */{first['bytes']}":
        problems[first_src] = f"past-the-end range: status {status}, {headers.get('content-range')}"

    def run(item):
        src, record = item
        try:
            return check_file(src, record, bundle, base, open_url, args.full, args.timeout)
        except Failure as error:
            return {"src": src, "ok": False, "error": str(error)}

    results, started = [], time.monotonic()
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        for result in pool.map(run, files):
            results.append(result)
            if not result["ok"]:
                problems[result["src"]] = result["error"]
            if len(results) % 100 == 0 or len(results) == len(files):
                print(f"Checked {len(results)}/{len(files)} ({len(problems)} problems, "
                      f"{time.monotonic() - started:.0f}s)", flush=True)
    now = datetime.now(timezone.utc)
    report = {"host": base, "release": prepared["release"], "checked": now.isoformat(),
              "method": "full" if args.full else "ranges", "files": len(files), "requests": requests,
              "problems": problems, "results": results}
    write_json(args.report, report, indent=1)
    if problems:
        print(f"FAILED: {len(problems)} file(s), e.g. {next(iter(problems.items()))}. "
              f"Nothing was published. Report: {args.report}", file=sys.stderr)
        return 1
    print(f"Verified {len(files)} recordings of release {prepared['release']} on {base}.")
    if args.publish:
        publication = json.loads(args.publication.read_text()) if args.publication.exists() else None
        try:
            merged = merge(publication, prepared, base, report["method"], now)
        except Failure as error:
            print(f"FAILED: {error}. Nothing was published.", file=sys.stderr)
            return 1
        write_json(args.publication, merged)
        print(f"Recorded {len(prepared['files'])} verified files in {args.publication}.")
    else:
        print("Not recorded (run again with --publish to update the verified inventory).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
