"""Attach official nominal tempo/beat grids to verified, locally held GuitarSet audio."""

import argparse
import hashlib
import json
from pathlib import Path
import zipfile


def prepare(annotations: Path, audio_manifest: Path, output: Path):
    if (
        hashlib.md5(annotations.read_bytes()).hexdigest()
        != "b39b78e63d3446f2e54ddb7a54df9b10"
    ):
        raise ValueError("GuitarSet annotation checksum differs")
    manifest = json.loads(audio_manifest.read_text(encoding="utf-8"))
    with zipfile.ZipFile(annotations) as archive:
        for track in manifest["tracks"]:
            if track["id"] in {
                "04_BN3-154-E_comp",
                "04_Jazz1-200-B_comp",
                "02_Funk2-119-G_comp",
            }:
                raise ValueError("Known GuitarSet errata record cannot be used")
            if (
                hashlib.sha256(Path(track["path"]).read_bytes()).hexdigest()
                != track["sha256"]
            ):
                raise ValueError("Audio checksum differs")
            data = json.loads(archive.read(track["id"] + ".jams"))
            tempo = next(a for a in data["annotations"] if a["namespace"] == "tempo")
            beats = next(
                a for a in data["annotations"] if a["namespace"] == "beat_position"
            )
            track["referenceBpm"] = float(tempo["data"][0]["value"])
            track["beatTimes"] = [float(b["time"]) for b in beats["data"]]
    manifest["task"] = (
        "Nominal tempo and click-grid comparison; not independently annotated human downbeats"
    )
    manifest["annotationMd5"] = hashlib.md5(annotations.read_bytes()).hexdigest()
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8"
    )


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("annotations", type=Path)
    parser.add_argument("audio_manifest", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    prepare(args.annotations, args.audio_manifest, args.output)
