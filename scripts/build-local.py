"""Build a Windows ZIP in a new stage; --environment includes the prepared model runtime."""

from pathlib import Path
import datetime
import json
import shutil
import subprocess
import sys
import argparse
import zipfile

parser = argparse.ArgumentParser()
parser.add_argument("--environment", type=Path)
parser.add_argument(
    "--output-root",
    type=Path,
    help="Stage and ZIP location (for disks with room for the full runtime)",
)
args = parser.parse_args()
ROOT = Path(__file__).resolve().parents[1]
VERSION = json.loads((ROOT / "package.json").read_text())["version"]
stamp = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
output_root = (args.output_root or ROOT / "artifacts").resolve()
output_root.mkdir(parents=True, exist_ok=True)
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
env = ROOT / ".venv-build"
if not env.is_dir():
    subprocess.run([sys.executable, "-m", "venv", str(env)], check=True)
python = env / "Scripts" / "python.exe"
subprocess.run(
    [
        str(python),
        "-m",
        "pip",
        "install",
        "-r",
        str(ROOT / "backend" / "requirements.txt"),
        "pyinstaller==6.19.0",
    ],
    check=True,
)
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
        "-p:RestoreLockedMode=true",
        "-o", str(bundle),
    ],
    check=True,
    cwd=ROOT,
)
shutil.move(str(stage / "StringcraftService"), str(bundle / "service"))
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
            shutil.copy2(notice, bundle / f"{dependency['name']}-{notice.name}")
for name in ("LICENSE", "NOTICE", "README.md"):
    shutil.copy2(ROOT / name, bundle / name)
shutil.copy2(ROOT / "dist" / "build-info.json", bundle / "build-info.json")
shutil.copy2(ROOT / "docs" / "LOCAL_TRIAL.md", bundle / "使用说明.md")
shutil.copytree(ROOT / "docs", bundle / "docs")
shutil.copytree(ROOT / "benchmarks", bundle / "benchmarks")
(bundle / "runtime_plugins").mkdir(exist_ok=True)
if args.environment:
    environment = args.environment.resolve()
    if (
        not environment.is_relative_to(ROOT / "artifacts")
        or not (environment / "python/python.exe").is_file()
    ):
        raise SystemExit(
            "Environment must be a prepared runtime inside project artifacts"
        )
    shutil.copytree(
        environment,
        bundle / "runtime_plugins/local-separation",
        ignore=shutil.ignore_patterns("__pycache__", "*.pyc", "direct_url.json"),
    )
(bundle / "runtime_plugins" / "README.txt").write_text(
    "Extract the local music environment here. The base application does not require it.\n",
    encoding="utf-8",
)
archive = (
    output_root
    / f"Stringcraft-{VERSION}-{'full' if args.environment else 'preview'}-windows-x64.zip"
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
