"""verify-audio-host.py against a local range server: only a fully verified
release is recorded, prepared files are not, and immutable paths stay immutable.

Standard library only: `python3 -I -m unittest discover -s scripts/tests`.
"""
import hashlib
import importlib.util
import io
import json
import re
import tempfile
import threading
import unittest
from contextlib import redirect_stderr, redirect_stdout
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("verify_audio_host", ROOT / "scripts/verify-audio-host.py")
verify = importlib.util.module_from_spec(spec)
spec.loader.exec_module(verify)

DAY = "/audio/days/001-abc.m4a"
CHAPTER = "/audio/chapters/assets/GEN-1-abc.m4a"


class Host(BaseHTTPRequestHandler):
    """R2 host stand-in. `faults` alters chosen responses."""

    files = {}
    faults = set()
    requests = 0

    def log_message(self, *args):
        pass

    def do_GET(self):
        type(self).requests += 1
        path = self.path.split("?")[0]
        data = self.files.get(path)
        if data is None:
            self.send_response(404)
            self.end_headers()
            return
        if "corrupt" in self.faults and path == CHAPTER:
            data = data[:-1] + bytes([data[-1] ^ 1])
        match = re.fullmatch(r"bytes=(\d*)-(\d*)", self.headers.get("Range", ""))
        headers = {"Content-Type": "audio/mp4", "Accept-Ranges": "bytes",
                   "Cache-Control": "public, max-age=31536000" + ("" if "mutable" in self.faults else ", immutable")}
        if not match or "ignore-range" in self.faults:
            self.send_response(200)
            body, headers["Content-Length"] = data, str(len(data))
        else:
            first, last = match.groups()
            start = int(first) if first else max(0, len(data) - int(last))
            end = min(int(last), len(data) - 1) if first and last else len(data) - 1
            if start >= len(data):
                self.send_response(416)
                headers["Content-Range"] = f"bytes */{len(data)}"
                body = b""
            else:
                self.send_response(206)
                headers["Content-Range"] = f"bytes {start}-{end}/{len(data)}"
                body = data[start:end + 1]
            headers["Content-Length"] = str(len(body))
        for key, value in headers.items():
            self.send_header(key, value)
        self.end_headers()
        self.wfile.write(body)


class VerifyAudioHost(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.dir = Path(self.temp.name)
        self.staged = self.dir / "r2-audio"
        files = {DAY: bytes(range(256)) * 20, CHAPTER: bytes(reversed(range(256))) * 9 + b"tail"}
        records = {}
        for src, data in files.items():
            path = self.staged / src.lstrip("/")
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data)
            records[src] = {"bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()}
        self.inventory = self.dir / "inventory.json"
        self.inventory.write_text(json.dumps({"version": 1, "kind": "prepared", "release": "r-test",
                                              "output": str(self.staged), "files": records}))
        self.publication = self.dir / "publication.json"
        Host.files, Host.faults, Host.requests = files, set(), 0
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Host)
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.base = f"http://127.0.0.1:{self.server.server_address[1]}"

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.temp.cleanup()

    def run_verify(self, *extra):
        out, err = io.StringIO(), io.StringIO()
        with redirect_stdout(out), redirect_stderr(err):
            code = verify.main([self.base, "--inventory", str(self.inventory), "--publication", str(self.publication),
                                "--report", str(self.dir / "report.json"), "--workers", "2", "--timeout", "5", *extra])
        return code, out.getvalue() + err.getvalue()

    def test_verified_release_is_recorded_only_with_publish(self):
        code, output = self.run_verify()
        self.assertEqual(code, 0, output)
        self.assertFalse(self.publication.exists(), "prepared/verified without --publish is not published")
        self.assertEqual(Host.requests, 2 * 3 + 1)
        code, output = self.run_verify("--publish", "--full")
        self.assertEqual(code, 0, output)
        published = json.loads(self.publication.read_text())
        self.assertEqual(set(published["files"]), {DAY, CHAPTER})
        self.assertEqual(published["releases"][0]["method"], "full")
        self.assertEqual(published["files"][DAY]["release"], published["releases"][0]["id"])

    def test_any_failure_publishes_nothing(self):
        for fault in ("corrupt", "mutable", "ignore-range"):
            Host.faults = {fault}
            code, output = self.run_verify("--publish")
            self.assertEqual(code, 1, fault)
            self.assertIn("Nothing was published", output)
            self.assertFalse(self.publication.exists(), fault)
            report = json.loads((self.dir / "report.json").read_text())
            self.assertTrue(report["problems"], fault)

    def test_rollback_entries_are_kept_and_changed_bytes_refused(self):
        self.publication.write_text(json.dumps({
            "version": 1,
            "releases": [{"id": "old", "verified": "2026-10-01T00:00:00Z", "host": "x", "method": "ranges", "files": 1}],
            "files": {"/audio/days/002-old.m4a": {"bytes": 5, "sha256": "0" * 64, "release": "old"}}}))
        code, output = self.run_verify("--publish")
        self.assertEqual(code, 0, output)
        published = json.loads(self.publication.read_text())
        self.assertIn("/audio/days/002-old.m4a", published["files"])
        self.assertEqual([r["id"] for r in published["releases"]], ["old", "r-test"])
        # Same path, different bytes: immutable URLs must never change.
        published["files"][DAY]["sha256"] = "f" * 64
        self.publication.write_text(json.dumps(published))
        code, output = self.run_verify("--publish")
        self.assertEqual(code, 1)
        self.assertIn("immutable", output)

    def test_staged_files_must_match_the_prepared_inventory(self):
        (self.staged / DAY.lstrip("/")).write_bytes(b"other")
        code, output = self.run_verify()
        self.assertEqual(code, 1)
        self.assertIn("local", json.loads((self.dir / "report.json").read_text())["problems"][DAY])


if __name__ == "__main__":
    unittest.main()
