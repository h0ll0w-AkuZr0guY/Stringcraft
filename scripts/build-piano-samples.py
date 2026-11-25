"""Prepare the licensed, two-layer Salamander piano bank for a desktop build."""

import concurrent.futures
import hashlib
import json
from pathlib import Path
import subprocess
import urllib.request
from urllib.parse import quote

COMMIT = "3382bf9496bba2486f5ab0de55a264d1dfc38404"
SOURCE = f"https://raw.githubusercontent.com/sfzinstruments/SalamanderGrandPiano/{COMMIT}/"
OUTPUT = Path(__file__).resolve().parents[1] / "public/piano-samples"
NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]


def read(path):
    for attempt in range(3):
        try:
            with urllib.request.urlopen(SOURCE + quote(path), timeout=45) as stream:
                return stream.read()
        except OSError:
            if attempt == 2:
                raise


def encode(entry):
    midi, layer = entry
    original = f"Samples/{NAMES[midi % 12]}{midi // 12 - 1}v{layer}.flac"
    name = f"{midi}-{layer}.ogg"
    path = OUTPUT / name
    if not path.is_file():
        source = read(original)
        encoded = subprocess.run(
            ["ffmpeg", "-v", "error", "-i", "pipe:0", "-t", "8", "-af",
             "afade=t=out:st=7.85:d=0.15", "-c:a", "libopus", "-b:a", "88k",
             "-f", "ogg", "pipe:1"],
            input=source, capture_output=True, check=True,
        ).stdout
        if not encoded.startswith(b"OggS"):
            raise ValueError(f"Invalid sample encoding: {original}")
        path.write_bytes(encoded)
    return {"midi": midi, "layer": layer, "file": name,
            "sha256": hashlib.sha256(path.read_bytes()).hexdigest()}


if __name__ == "__main__":
    OUTPUT.mkdir(parents=True, exist_ok=True)
    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
        files = list(pool.map(encode, [(midi, layer)
                                      for midi in range(21, 109, 3)
                                      for layer in (5, 12)]))
    (OUTPUT / "LICENSE.txt").write_bytes(read("LICENSE"))
    (OUTPUT / "manifest.json").write_text(json.dumps({
        "name": "Salamander Grand Piano v3",
        "author": "Alexander Holm",
        "license": "CC-BY-3.0",
        "source": f"https://github.com/sfzinstruments/SalamanderGrandPiano/tree/{COMMIT}",
        "changes": "Two velocity layers, converted to Opus and shortened to eight seconds.",
        "files": files,
    }, indent=2) + "\n", encoding="utf8")
    print(f"Prepared {len(files)} piano samples.")
