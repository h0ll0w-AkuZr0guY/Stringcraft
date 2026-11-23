"""Fetch selected official ZIP members with HTTP ranges, CRC and per-file SHA-256.

No whole-archive checksum claim is made when only selected ranges are downloaded.
GuitarSet v1.1.0, Xi et al., ISMIR 2018, CC-BY-4.0.
"""

import argparse
import hashlib
from http.client import IncompleteRead
import io
import json
from pathlib import Path
import urllib.request
import time
import zipfile

URL = "https://zenodo.org/api/records/3371780/files/audio_mono-mic.zip/content"
SIZE = 656927981
DEFAULT_IDS = [
    f"05_{piece}_{style}"
    for piece in ("SS1-68-E", "Rock1-90-C#", "BN1-129-Eb")
    for style in ("comp", "solo")
]


class RemoteZip(io.RawIOBase):
    def __init__(self, cache: Path):
        self.position = 0
        self.cache = cache
        cache.mkdir(parents=True, exist_ok=True)

    def seekable(self):
        return True

    def readable(self):
        return True

    def tell(self):
        return self.position

    def seek(self, offset, whence=0):
        self.position = (
            offset
            if whence == 0
            else self.position + offset if whence == 1 else SIZE + offset
        )
        return self.position

    def read(self, n=-1):
        n = SIZE - self.position if n < 0 else min(n, SIZE - self.position)
        if n > 32 * 1024 * 1024:
            raise ValueError("Unexpected oversized remote ZIP read")
        result = bytearray()
        block = 1024 * 1024
        while n > 0:
            start = self.position // block * block
            end = min(SIZE - 1, start + block - 1)
            path = self.cache / f"{start}-{end}.bin"
            if not path.exists() or path.stat().st_size != end - start + 1:
                request = urllib.request.Request(
                    URL,
                    headers={
                        "Range": f"bytes={start}-{end}",
                        "User-Agent": "Stringcraft reference evaluation",
                    },
                )
                for attempt in range(3):
                    try:
                        with urllib.request.urlopen(request, timeout=45) as response:
                            if (
                                response.status != 206
                                or response.headers.get("Content-Range")
                                != f"bytes {start}-{end}/{SIZE}"
                            ):
                                raise ValueError(
                                    "Server did not honor exact byte range"
                                )
                            data = response.read()
                        if len(data) != end - start + 1:
                            raise ValueError("Truncated range")
                        break
                    except (OSError, ConnectionError, IncompleteRead):
                        if attempt == 2:
                            raise
                        time.sleep(attempt + 1)
                path.write_bytes(data)
                print(f"cached range {start}-{end}", flush=True)
            data = path.read_bytes()
            begin = self.position - start
            count = min(n, len(data) - begin)
            result.extend(data[begin : begin + count])
            self.position += count
            n -= count
        return bytes(result)


def fetch(annotations: Path, output: Path, ids):
    if (
        hashlib.md5(annotations.read_bytes()).hexdigest()
        != "b39b78e63d3446f2e54ddb7a54df9b10"
    ):
        raise ValueError("GuitarSet annotation archive differs from v1.1.0 checksum")
    output.mkdir(parents=True, exist_ok=True)
    rows = []
    with zipfile.ZipFile(RemoteZip(output / "ranges")) as audio, zipfile.ZipFile(
        annotations
    ) as jams:
        for track_id in ids:
            filename = track_id + "_mic.wav"
            if Path(filename).name != filename:
                raise ValueError("Invalid track identifier")
            info = audio.getinfo(filename)
            if info.file_size > 30 * 1024 * 1024:
                raise ValueError("Audio member unexpectedly large")
            path = output / filename
            if not path.exists() or path.stat().st_size != info.file_size:
                path.write_bytes(
                    audio.read(filename)
                )  # zipfile verifies the complete member CRC.
            content = path.read_bytes()
            if zipfile.crc32(content) != info.CRC:
                raise ValueError("Member CRC differs")
            metadata = json.loads(jams.read(track_id + ".jams"))
            notes = []
            for annotation in metadata["annotations"]:
                if annotation["namespace"] != "note_midi":
                    continue
                string = 6 - int(annotation["annotation_metadata"]["data_source"])
                for index, note in enumerate(annotation["data"]):
                    if note["time"] < 0 or note["duration"] <= 0:
                        continue
                    notes.append(
                        {
                            "id": f"{track_id}-s{string}-{index}",
                            "start": note["time"],
                            "duration": note["duration"],
                            "pitch": {"midi": round(note["value"])},
                            "velocity": 0.7,
                            "score": 1,
                            "source": "manual",
                            "referenceString": string,
                        }
                    )
            rows.append(
                {
                    "id": track_id,
                    "path": str(path.resolve()),
                    "duration": metadata["file_metadata"]["duration"],
                    "sha256": hashlib.sha256(content).hexdigest(),
                    "zipCrc32": f"{info.CRC:08x}",
                    "notes": sorted(notes, key=lambda n: n["start"]),
                }
            )
            print(f"verified {track_id}: {len(notes)} reference notes", flush=True)
    manifest = {
        "version": 1,
        "source": "https://zenodo.org/records/3371780",
        "license": "CC-BY-4.0",
        "attribution": "Qingyang Xi, Rachel M. Bittner, Johan Pauwels, Xuzhou Ye, Juan P. Bello. GuitarSet, ISMIR 2018, v1.1.0.",
        "validation": "Selected ZIP members validated by CRC32 and recorded SHA-256; entire audio ZIP not downloaded",
        "task": "Polyphonic audio-note transcription; no verified lead-melody labels",
        "tracks": rows,
    }
    (output / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8"
    )


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("annotations", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--ids", nargs="+", default=DEFAULT_IDS)
    args = parser.parse_args()
    fetch(args.annotations, args.output, args.ids)
