"""Package a verified portable CUDA runtime without changing the source tree."""

import argparse
import hashlib
import json
import sys
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

parser = argparse.ArgumentParser()
parser.add_argument("environment", type=Path)
parser.add_argument("archive", type=Path)
args = parser.parse_args()
source = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(source))
from backend.workspace import find_workspace, managed_path

workspace = find_workspace(source)
env = args.environment.resolve()
if workspace:
    env = managed_path(workspace, env)
    args.archive = managed_path(workspace, args.archive)
info = json.loads((env / "runtime.json").read_text("utf8"))
if info["device"] != "cu124" or not (env / "python/python.exe").is_file():
    raise SystemExit("Expected the verified CUDA 12.4 runtime")
args.archive.parent.mkdir(parents=True, exist_ok=True)
with ZipFile(args.archive, "x", compression=ZIP_DEFLATED, compresslevel=1) as archive:
    for file in sorted(env.rglob("*")):
        if not file.is_file() or file.name in ("installed-requirements.txt", "direct_url.json"):
            continue
        if file.suffix in (".pyc", ".qa-held") or "__pycache__" in file.parts:
            continue
        archive.write(file, Path("local-separation") / file.relative_to(env))
with args.archive.open("rb") as stream:
    digest = hashlib.file_digest(stream, "sha256").hexdigest()
args.archive.with_suffix(".zip.sha256").write_text(f"{digest}  {args.archive.name}\n", encoding="ascii")
print(args.archive)
