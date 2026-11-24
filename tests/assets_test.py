import io, json, tempfile, unittest, wave, zipfile
from pathlib import Path
from backend.assets import AudioAssets
from backend.bundles import export_bundle, import_bundle


class AssetTests(unittest.TestCase):
    def make(self, path):
        with wave.open(str(path), "wb") as w:
            w.setparams((1, 2, 16000, 1600, "NONE", "not compressed"))
            w.writeframes(b"\0\0" * 1600)

    def test_assets_survive_job_removal_and_deduplicate(self):
        with tempfile.TemporaryDirectory() as root:
            source = Path(root) / "source.wav"
            self.make(source)
            assets = AudioAssets(Path(root) / "assets")
            a = assets.register(source)
            b = assets.register(source)
            self.assertEqual(a, b)
            assets.pin("project-one", [a["id"]])
            source.unlink()
            self.assertTrue(assets.path(a["id"]).is_file())
            assets.release("project-one")
            self.assertTrue(assets.path(a["id"]).is_file())

    def test_identifiers_cannot_select_paths(self):
        with tempfile.TemporaryDirectory() as root:
            assets = AudioAssets(root)
            for value in ("../private", "a" * 63, None):
                with self.assertRaises(ValueError):
                    assets.path(value)

    def test_portable_bundle_restores_audio_in_a_fresh_store(self):
        with tempfile.TemporaryDirectory() as root:
            source = Path(root) / "source.wav"
            self.make(source)
            a = AudioAssets(Path(root) / "a")
            ref = {**a.register(source), "offsetSeconds": 0.01}
            p = dict(
                schemaVersion=2,
                notes=[],
                tracks=[dict(id="vocal", role="vocal", notes=[], asset=ref)],
            )
            file = Path(root) / "project.zip"
            export_bundle(p, a, file)
            b = AudioAssets(Path(root) / "b")
            restored = import_bundle(file, b)
            self.assertEqual(restored, p)
            self.assertEqual(b.path(ref["id"]).read_bytes(), source.read_bytes())

    def test_bad_archive_does_not_publish_assets(self):
        with tempfile.TemporaryDirectory() as root:
            file = Path(root) / "bad.zip"
            a = AudioAssets(Path(root) / "assets")
            with zipfile.ZipFile(file, "w") as z:
                z.writestr("../private", "invalid")
                z.writestr("project.json", "{}")
                z.writestr("manifest.json", "{}")
            with self.assertRaises(ValueError):
                import_bundle(file, a)
            self.assertFalse(a.root.exists())

    def test_digest_mismatch_is_rejected_before_any_asset_is_published(self):
        with tempfile.TemporaryDirectory() as root:
            file = Path(root) / "bad.zip"
            a = AudioAssets(Path(root) / "assets")
            identifier = "a" * 64
            p = dict(
                schemaVersion=2, notes=[], tracks=[dict(asset=dict(id=identifier))]
            )
            with zipfile.ZipFile(file, "w") as z:
                z.writestr("project.json", json.dumps(p))
                z.writestr(
                    "manifest.json", json.dumps(dict(version=1, assets=[identifier]))
                )
                z.writestr("audio/" + identifier + ".wav", b"invalid")
            with self.assertRaises(ValueError):
                import_bundle(file, a)
            self.assertFalse(a.root.exists())
