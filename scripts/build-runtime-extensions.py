"""Build versioned CPU and CUDA installer archives and SHA-256 files."""
import argparse
import hashlib
import json
import sys
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

parser = argparse.ArgumentParser()
parser.add_argument("--output-root", type=Path)
args = parser.parse_args()
version = "1.0.1"
root = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(root))
from backend.workspace import find_workspace, managed_path

workspace = find_workspace(root)
out = (args.output_root or (workspace / "exports" if workspace else root / "artifacts")).resolve()
if workspace:
    out = managed_path(workspace, out)
out.mkdir(parents=True, exist_ok=True)
files = {
    "Install-MusicRuntime.ps1": root / "scripts/runtime/Install-MusicRuntime.ps1",
    "Install.cmd": root / "scripts/runtime/Install.cmd",
    "runtime-tools.py": root / "scripts/runtime/runtime-tools.py",
    "requirements.txt": root / "plugins/local-separation/requirements.txt",
    "btc-LICENSE.txt": root / "plugins/audio-harmony/btc/LICENSE",
    "NOTICE": root / "NOTICE",
    "LICENSE": root / "LICENSE",
    "安装说明.md": root / "docs/MUSIC_RUNTIME.md",
}
for device in ("cpu", "cu124"):
    name = f"Stringcraft-Music-Runtime-{version}-{device}-windows-x64.zip"
    target = out / name
    with ZipFile(target, "x", compression=ZIP_DEFLATED) as archive:
        for key, source in files.items():
            archive.write(source, key)
        archive.writestr(
            "runtime.json",
            json.dumps(
                {
                    "id": "local-separation",
                    "version": version,
                    "sdk": 1,
                    "minimumCore": "0.2.0",
                    "device": device,
                }
            ),
        )
    with ZipFile(target) as archive:
        assert archive.testzip() is None
    with target.open("rb") as source:
        digest = hashlib.file_digest(source, "sha256").hexdigest()
    (out / (name + ".sha256")).write_text(f"{digest}  {name}\n", encoding="ascii")
    print(target)
