"""Run with python -m unittest discover -s tests -p '*_test.py'."""

import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

os.environ["STRINGCRAFT_DATA"] = tempfile.mkdtemp(prefix="stringcraft-test-")
from fastapi.testclient import TestClient
from backend.server import app
from backend import server


class LocalHostTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)
        self.headers = {
            "Authorization": "Bearer "
            + self.client.get("/api/v1/session").json()["token"]
        }

    def test_cross_origin_refused(self):
        self.assertEqual(
            self.client.get(
                "/api/v1/session", headers={"Origin": "https://untrusted.example"}
            ).status_code,
            403,
        )

    def test_unknown_host_refused(self):
        self.assertEqual(
            self.client.get(
                "/api/v1/session", headers={"Host": "untrusted.example"}
            ).status_code,
            403,
        )

    def test_capability_is_truthful(self):
        data = self.client.get("/api/v1/capabilities").json()
        self.assertTrue(data["local"])
        self.assertEqual(data["sdk"], 1)
        self.assertIsInstance(data["appVersion"], str)
        self.assertIsInstance(data["buildSha"], str)

    def test_job_authentication_required(self):
        self.assertEqual(self.client.get("/api/v1/jobs/missing").status_code, 401)

    def test_unknown_job_is_not_redirected(self):
        self.assertEqual(
            self.client.get("/api/v1/jobs/missing", headers=self.headers).status_code,
            404,
        )

    def test_unknown_mode_refused(self):
        self.assertEqual(
            self.client.post(
                "/api/v1/jobs",
                headers=self.headers,
                files={"file": ("test.wav", b"audio")},
                data={"mode": "invalid"},
            ).status_code,
            400,
        )

    def test_invalid_ranges_refused_before_starting_models(self):
        for settings in (
            {"offset": -1},
            {"seconds": 0},
            {"seconds": 1801},
            {"offset": "nan"},
        ):
            response = self.client.post(
                "/api/v1/jobs",
                headers=self.headers,
                files={"file": ("test.wav", b"audio")},
                data={"mode": "accompaniment", **settings},
            )
            self.assertEqual(response.status_code, 400)

    def test_enhancement_requires_verified_engine(self):
        with patch.object(
            server,
            "ENGINE",
            {"status": "error", "ready": False, "message": "model unavailable"},
        ):
            response = self.client.post(
                "/api/v1/jobs",
                headers=self.headers,
                files={"file": ("test.wav", b"audio")},
                data={"mode": "accompaniment"},
            )
            self.assertEqual(response.status_code, 409)
            self.assertIn("model unavailable", response.text)

    def test_assets_require_auth_completed_job_and_whitelist(self):
        with (
            tempfile.TemporaryDirectory() as root,
            patch.object(server, "RUNTIME", Path(root)),
            patch.dict(server.JOBS, {}, clear=True),
        ):
            identifier = "a" * 32
            path = Path(root) / identifier
            path.mkdir()
            (path / "bass.wav").write_bytes(b"RIFF-test")
            (path / "source.audio").write_bytes(b"private")
            server.JOBS[identifier] = {"id": identifier, "status": "running"}
            url = f"/api/v1/jobs/{identifier}/assets/bass.wav"
            self.assertEqual(self.client.get(url).status_code, 401)
            self.assertEqual(
                self.client.get(url, headers=self.headers).status_code, 404
            )
            server.JOBS[identifier]["status"] = "completed"
            self.assertEqual(
                self.client.get(url, headers=self.headers).content, b"RIFF-test"
            )
            self.assertEqual(
                self.client.get(
                    url.replace("bass.wav", "source.audio"), headers=self.headers
                ).status_code,
                404,
            )

    def test_cancellation_is_idempotent_and_keeps_completed_results(self):
        with patch.dict(
            server.JOBS,
            {
                "queued": {"id": "queued", "status": "queued"},
                "done": {"id": "done", "status": "completed", "result": {"notes": []}},
            },
            clear=True,
        ):
            for _ in range(2):
                self.assertEqual(
                    self.client.delete(
                        "/api/v1/jobs/queued", headers=self.headers
                    ).json()["status"],
                    "cancelled",
                )
            done = self.client.delete("/api/v1/jobs/done", headers=self.headers).json()
            self.assertEqual(done["status"], "completed")
            self.assertIn("result", done)


if __name__ == "__main__":
    unittest.main()
