"""Fetch the pinned CC0 guitar bank, verify upstream digests, publish manifest last."""

from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
from pathlib import Path
import re
import shutil
import subprocess
import os
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
REVISION = "514c926efecdb3c7812bf00eedf8e5c8d61dd681"
BASE = f"https://raw.githubusercontent.com/facebookincubator/Meta-open-sound/{REVISION}/systems/instruments"
DEST = ROOT / "public/samples"
STRINGS = dict(HighE=1, B=2, G=3, D=4, A=5, LowE=6)
PCS = dict(C=0, Cs=1, D=2, Ds=3, E=4, F=5, Fs=6, G=7, Gs=8, A=9, As=10, B=11)


def fetch(url):
    for attempt in range(3):
        try:
            if os.name == "nt":
                return subprocess.run(
                    [
                        "curl.exe",
                        "--fail",
                        "--silent",
                        "--show-error",
                        "--location",
                        "--connect-timeout",
                        "15",
                        "--max-time",
                        "90",
                        url,
                    ],
                    check=True,
                    capture_output=True,
                    timeout=100,
                ).stdout
            with urllib.request.urlopen(url, timeout=90) as response:
                return response.read(4 * 1024 * 1024)
        except (OSError, subprocess.SubprocessError):
            if attempt == 2:
                raise


def main():
    DEST.mkdir(parents=True, exist_ok=True)
    old = json.loads((DEST / "manifest.json").read_text(encoding="utf-8"))
    old_files = {s["source_file"]: DEST / s["local_file"] for s in old["samples"]}
    samples = []
    for instrument, collection in [
        ("steel", "meta-steel-guitar"),
        ("nylon", "meta-nylon-guitar"),
    ]:
        checksums = fetch(f"{BASE}/{collection}/SHA256SUMS").decode()
        expected = {
            name: sha
            for sha, name in (
                line.split(None, 1) for line in checksums.splitlines() if line.strip()
            )
        }
        manifest = fetch(f"{BASE}/{collection}/manifest.json")
        if hashlib.sha256(manifest).hexdigest() != expected["manifest.json"]:
            raise ValueError("Manifest digest mismatch")
        license_data = fetch(f"{BASE}/{collection}/LICENSE")
        if hashlib.sha256(license_data).hexdigest() != expected["LICENSE"]:
            raise ValueError("License digest mismatch")
        (DEST / f"{collection}-LICENSE").write_bytes(license_data)
        for row in json.loads(manifest)["samples"]:
            filename = Path(row["file"]).with_suffix(".ogg").name
            match = re.fullmatch(
                r"INSGuitar(?:Steel|Nylon)_String(HighE|LowE|A|D|G|B)_Vel0([123])(Finger|Pick)?_([A-G]s?)([0-8])_01\.ogg",
                filename,
            )
            if not match:
                raise ValueError("Unexpected upstream sample filename")
            string, layer, technique, note, octave = match.groups()
            samples.append(
                dict(
                    instrument=instrument,
                    string=STRINGS[string],
                    midi=(int(octave) + 1) * 12 + PCS[note],
                    layer=int(layer),
                    technique="finger" if technique == "Finger" else "pick",
                    source_file=filename,
                    local_file=filename,
                    sha256=expected["ogg/" + filename],
                    url=f"{BASE}/{collection}/ogg/{filename}",
                )
            )

    def download(sample):
        target = DEST / sample["local_file"]
        if not target.is_file():
            previous = old_files.get(sample["source_file"])
            if (
                previous
                and previous.is_file()
                and hashlib.sha256(previous.read_bytes()).hexdigest()
                == sample["sha256"]
            ):
                shutil.copy2(previous, target)
            else:
                target.write_bytes(fetch(sample["url"]))
        if hashlib.sha256(target.read_bytes()).hexdigest() != sample["sha256"]:
            raise ValueError("Sample digest mismatch: " + target.name)
        return {k: v for k, v in sample.items() if k != "url"}

    with ThreadPoolExecutor(max_workers=8) as pool:
        result = []
        for i, sample in enumerate(pool.map(download, samples)):
            result.append(sample)
            if (i + 1) % 100 == 0:
                print(f"Verified {i + 1}/{len(samples)} samples", flush=True)
    data = dict(
        source="Meta Open Sound",
        url="https://github.com/facebookincubator/Meta-open-sound",
        revision=REVISION,
        license="CC0-1.0",
        version=2,
        samples=result,
    )
    (DEST / "manifest.json").write_text(
        json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(
        f"Installed {len(result)} verified samples; no round-robin or dedicated legato samples claimed",
        flush=True,
    )


if __name__ == "__main__":
    main()
