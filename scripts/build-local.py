"""Build a Windows ZIP in a new stage; --environment includes the prepared model runtime."""

from pathlib import Path
import datetime
import json
import shutil
import subprocess
import sys
import argparse
import zipfile
import tempfile
import os
import importlib.util

parser = argparse.ArgumentParser()
parser.add_argument("--environment", type=Path)
parser.add_argument("--stage-app", action="store_true",
                    help="Build app.next in a managed workspace without creating a distribution archive.")
parser.add_argument(
    "--output-root",
    type=Path,
    help="Stage and ZIP location (for disks with room for the full runtime)",
)
args = parser.parse_args()
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from backend.workspace import find_workspace, managed_path, use_local_temporary_files

workspace = find_workspace(ROOT)
if args.stage_app and not workspace:
    parser.error("--stage-app requires a managed workspace.")
if workspace and args.environment:
    parser.error("Managed builds reuse the shared runtime. Build distributable full bundles from a standalone checkout.")
VERSION = json.loads((ROOT / "package.json").read_text())["version"]
stamp = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
output_root = (args.output_root or (workspace / "exports" if workspace else ROOT / "artifacts")).resolve()
if workspace:
    output_root = managed_path(workspace, output_root)
    temp_root = managed_path(workspace, workspace / ".maintenance" / "tmp")
    use_local_temporary_files(temp_root)
    os.environ["PYINSTALLER_CONFIG_DIR"] = str(temp_root / "pyinstaller")
    if args.stage_app and (workspace / "app.next").exists():
        parser.error("app.next already exists. Complete or remove the earlier staging attempt first.")
    runtime_python = workspace / "runtime/local-separation/python/python.exe"
    if not runtime_python.is_file() or not Path(sys.executable).samefile(runtime_python):
        parser.error("Run this script with the shared runtime Python.")
    if importlib.util.find_spec("PyInstaller") is None or importlib.util.find_spec("fastapi") is None:
        parser.error("Install scripts/requirements-build.txt into the shared runtime first.")
output_root.mkdir(parents=True, exist_ok=True)
if workspace:
    staging = tempfile.TemporaryDirectory(prefix="build-", dir=temp_root)
    stage = Path(staging.name)
else:
    stage = output_root / f"build-{stamp}"
    stage.mkdir(parents=True)
native_source = stage / "native-plugin"
shutil.copytree(
    ROOT / "plugins/audio-harmony",
    native_source,
    ignore=shutil.ignore_patterns("__pycache__", "*.pyc"),
)
if not (ROOT / "dist" / "index.html").is_file():
    raise SystemExit("Run npm run build first")
if workspace:
    python = runtime_python
else:
    env = ROOT / ".venv-build"
    if not env.is_dir():
        subprocess.run([sys.executable, "-m", "venv", str(env)], check=True)
    python = env / "Scripts" / "python.exe"
    subprocess.run([str(python), "-m", "pip", "install", "-r",
                    str(ROOT / "scripts" / "requirements-build.txt")], check=True)
subprocess.run(
    [
        str(python),
        "-m",
        "PyInstaller",
        "--noconfirm",
        "--name",
        "StringcraftService",
        "--onedir",
        "--paths",
        str(ROOT),
        "--distpath",
        str(stage),
        "--workpath",
        str(stage / "work"),
        "--specpath",
        str(stage),
        "--collect-submodules",
        "uvicorn",
        "--add-data",
        f"{ROOT / 'dist'};dist",
        "--add-data",
        f"{ROOT / 'backend' / 'worker.py'};backend",
        "--add-data",
        f"{native_source};plugins/audio-harmony",
        str(ROOT / "backend" / "launcher.py"),
    ],
    check=True,
    cwd=ROOT,
)
bundle = stage / "Stringcraft"
subprocess.run(
    [
        "dotnet", "publish", str(ROOT / "desktop/Stringcraft.Desktop.csproj"),
        "-c", "Release", "-r", "win-x64", "--self-contained", "true",
        f"-p:PublishSingleFile={'false' if workspace else 'true'}",
        f"-p:IncludeNativeLibrariesForSelfExtract={'false' if workspace else 'true'}",
        "-p:EnableSingleFileAnalyzer=false",
        "-p:DebugType=none", "-p:DebugSymbols=false",
        "-p:RestoreLockedMode=true",
        "-o", str(bundle),
    ],
    check=True,
    cwd=ROOT,
)
internal = bundle / "_internal"
internal.mkdir()
shutil.move(str(stage / "StringcraftService"), str(internal / "service"))
if not workspace:
    for item in bundle.iterdir():
        if item.name not in ("Stringcraft.exe", "_internal"):
            shutil.move(str(item), str(internal / item.name))
# The SDK's self-contained publish omits the runtime packs' notice files.
assets = json.loads((ROOT / "desktop/obj/project.assets.json").read_text("utf-8"))
framework = next(iter(assets["project"]["frameworks"].values()))
for dependency in framework["downloadDependencies"]:
    package = dependency["name"].lower()
    if package not in (
        "microsoft.netcore.app.runtime.win-x64",
        "microsoft.windowsdesktop.app.runtime.win-x64",
    ):
        continue
    version = dependency["version"].strip("[]").split(",")[0].strip()
    directory = next(
        Path(folder) / package / version
        for folder in assets["packageFolders"]
        if (Path(folder) / package / version).is_dir()
    )
    for notice in directory.iterdir():
        if notice.name.upper() in {"LICENSE", "LICENSE.TXT", "THIRD-PARTY-NOTICES.TXT"}:
            shutil.copy2(notice, internal / f"{dependency['name']}-{notice.name}")
for name in ("LICENSE", "NOTICE", "README.md"):
    shutil.copy2(ROOT / name, internal / name)
shutil.copy2(ROOT / "dist" / "build-info.json", internal / "build-info.json")
shutil.copy2(ROOT / "docs" / "LOCAL_TRIAL.md", bundle / "使用说明.md")
shutil.copytree(ROOT / "docs", internal / "docs")
shutil.copytree(ROOT / "benchmarks", internal / "benchmarks")
(internal / "runtime_plugins").mkdir(exist_ok=True)
if args.environment:
    environment = args.environment.resolve()
    if (
        not (environment / "python/python.exe").is_file()
        or not (environment / "bin/ffmpeg.exe").is_file()
        or not (environment / "runtime.json").is_file()
    ):
        raise SystemExit(
            "Expected a prepared portable music runtime"
        )
    info = json.loads((environment / "runtime.json").read_text("utf-8"))
    if info.get("device") != "cpu":
        raise SystemExit("Bundle the CPU environment. CUDA is a separate extension.")
    shutil.copytree(
        environment,
        internal / "runtime_plugins/local-separation",
        ignore=shutil.ignore_patterns("__pycache__", "*.pyc", "direct_url.json", "installed-requirements.txt"),
    )
(internal / "runtime_plugins" / "README.txt").write_text(
    "Extract the local music environment here. The base application does not require it.\n",
    encoding="utf-8",
)
if args.stage_app:
    destination = managed_path(workspace, workspace / "app.next")
    bundle.rename(destination)
    print(destination)
    raise SystemExit(0)
archive = (
    output_root
    / f"Stringcraft-{VERSION}{'-full' if args.environment else ''}-windows-x64.zip"
)
with zipfile.ZipFile(
    archive, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=1, allowZip64=True
) as output:
    for path in bundle.rglob("*"):
        if path.is_file():
            output.write(path, path.relative_to(stage))
import hashlib

archive_path = Path(archive)
with archive_path.open("rb") as source:
    digest = hashlib.file_digest(source, "sha256").hexdigest()
archive_path.with_suffix(".zip.sha256").write_text(
    digest + "  " + archive_path.name + "\n", encoding="utf-8"
)
print(archive)
