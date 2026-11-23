"""Prepare real annotated fingering sequences; keep downloaded annotations outside Git.

Task is fingering preference calibration on a fixed, explicitly projected upper line,
not melody recognition. Split by performer before selection, never by notes.
"""

import argparse
import hashlib
import json
from pathlib import Path
import zipfile

ARCHIVE_MD5 = "b39b78e63d3446f2e54ddb7a54df9b10"
EXCLUDED = {"04_BN3-154-E_comp", "04_Jazz1-200-B_comp", "02_Funk2-119-G_comp"}
TUNING = [64, 59, 55, 50, 45, 40]


def prepare(archive: Path, output: Path):
    digest = hashlib.md5(archive.read_bytes()).hexdigest()
    if digest != ARCHIVE_MD5:
        raise ValueError("GuitarSet 1.1.0 annotation archive checksum differs")
    tracks = []
    audit = {
        "sourceTracks": 0,
        "excludedKnownErrata": [],
        "retainedNotes": 0,
        "projectedOut": 0,
    }
    with zipfile.ZipFile(archive) as z:
        for name in sorted(z.namelist()):
            if not name.endswith(".jams") or name.startswith("__MACOSX"):
                continue
            data = json.loads(z.read(name))
            track_id = Path(name).stem
            audit["sourceTracks"] += 1
            if track_id in EXCLUDED:
                audit["excludedKnownErrata"].append(track_id)
                continue
            if not track_id.endswith("_solo"):
                continue
            notes = []
            for annotation in data["annotations"]:
                if annotation["namespace"] != "note_midi":
                    continue
                string = 6 - int(annotation["annotation_metadata"]["data_source"])
                for index, note in enumerate(annotation["data"]):
                    midi = round(note["value"])
                    fret = midi - TUNING[string - 1]
                    if not 0 <= fret <= 20 or note["duration"] <= 0:
                        audit["projectedOut"] += 1
                        continue
                    notes.append(
                        {
                            "id": f"s{string}-{index}",
                            "start": note["time"],
                            "duration": note["duration"],
                            "midi": midi,
                            "string": string,
                            "fret": fret,
                        }
                    )
            groups = []
            for note in sorted(notes, key=lambda n: n["start"]):
                if not groups or note["start"] - groups[-1][0]["start"] > 0.03:
                    groups.append([])
                groups[-1].append(note)
            # Freeze this projection before searching any preference weights.
            upper = [max(group, key=lambda n: n["midi"]) for group in groups]
            audit["projectedOut"] += len(notes) - len(upper)
            audit["retainedNotes"] += len(upper)
            player = int(track_id[:2])
            tracks.append(
                {
                    "id": track_id,
                    "player": player,
                    "split": (
                        "train"
                        if player < 4
                        else "validation" if player == 4 else "test"
                    ),
                    "notes": upper,
                }
            )
    result = {
        "version": 1,
        "source": "https://zenodo.org/records/3371780",
        "license": "CC-BY-4.0",
        "attribution": "Qingyang Xi, Rachel M. Bittner, Johan Pauwels, Xuzhou Ye, Juan P. Bello. GuitarSet (ISMIR 2018), version 1.1.0.",
        "archiveMd5": digest,
        "projection": "highest MIDI in 30ms onset groups of annotated solo tracks; not a verified melodic voice",
        "splitContract": "performers 00-03 train, 04 validation, 05 held-out test",
        "errataSource": [
            "https://github.com/marl/GuitarSet/issues/4",
            "https://github.com/marl/GuitarSet/issues/5",
        ],
        "audit": audit,
        "tracks": tracks,
    }
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(
        json.dumps(result, ensure_ascii=False, separators=(",", ":")), encoding="utf-8"
    )
    print(
        json.dumps(
            {
                "tracks": len(tracks),
                "splits": {
                    s: sum(t["split"] == s for t in tracks)
                    for s in ("train", "validation", "test")
                },
                "audit": audit,
            },
            ensure_ascii=False,
        )
    )


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("archive", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    prepare(args.archive, args.output)
