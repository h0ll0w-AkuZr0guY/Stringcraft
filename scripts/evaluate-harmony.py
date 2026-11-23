"""Fixed-window harmony A/B against GuitarSet's manually verified chord annotations.

Run with the prepared music Python. Audio and predictions stay under artifacts;
the shareable report contains digests and aggregate metrics, never annotations.
No parameter search, best-track selection, or reference-to-prediction alignment.
"""

import argparse
import hashlib
import json
import os
from pathlib import Path
import sys
import zipfile

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "plugins/audio-harmony"))


def normalized(label):
    import mir_eval

    if label == "N":
        return None
    try:
        root, intervals, _ = mir_eval.chord.encode(label)
    except ValueError:
        return "unsupported"
    if intervals[0] and intervals[7] and bool(intervals[3]) != bool(intervals[4]):
        return (int(root), "minor" if intervals[3] else "major")
    return "unsupported"


def compare(annotations, prediction, duration):
    correct = root_correct = covered = scored = silent = false_chord = excluded = 0.0
    for item in annotations:
        start = max(0.0, item["time"])
        end = min(duration, item["time"] + item["duration"])
        if end <= start:
            continue
        expected = normalized(item["value"])
        if expected == "unsupported":
            excluded += end - start
            continue
        if expected is None:
            silent += end - start
        else:
            scored += end - start
        for segment in prediction["segments"]:
            overlap = max(0.0, min(end, segment["end"]) - max(start, segment["start"]))
            if not overlap or segment["root"] is None:
                continue
            if expected is None:
                false_chord += overlap
                continue
            covered += overlap
            if segment["root"] == expected[0]:
                root_correct += overlap
                if segment["quality"] == expected[1]:
                    correct += overlap
    return dict(
        scoredSeconds=scored,
        excludedSeconds=excluded,
        rootAccuracy=root_correct / scored if scored else None,
        majminAccuracy=correct / scored if scored else None,
        coverage=covered / scored if scored else None,
        silenceSeconds=silent,
        falseChordSeconds=false_chord,
    )


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("annotation", type=Path)
    parser.add_argument("report", type=Path)
    parser.add_argument(
        "audio",
        type=Path,
        nargs="+",
        help="Freeze the list before running; no exclusions after seeing results",
    )
    parser.add_argument(
        "--work", type=Path, default=ROOT / "artifacts/harmony-evaluation"
    )
    args = parser.parse_args()
    if (
        hashlib.md5(args.annotation.read_bytes()).hexdigest()
        != "b39b78e63d3446f2e54ddb7a54df9b10"
    ):
        raise ValueError("GuitarSet annotation archive differs")
    if not args.work.resolve().is_relative_to(ROOT / "artifacts"):
        raise ValueError("Private predictions must remain in artifacts")
    from pipeline import run

    rows = []
    with zipfile.ZipFile(args.annotation) as archive:
        names = archive.namelist()
        for audio in args.audio:
            identifier = audio.stem.removesuffix("_mic")
            name = next(
                n
                for n in names
                if n.endswith("/" + identifier + ".jams") or n == identifier + ".jams"
            )
            content = json.loads(archive.read(name))
            annotations = [
                a for a in content["annotations"] if a["namespace"] == "chord"
            ][-1]
            output = args.work / identifier
            print(f"Analyzing {identifier}", flush=True)
            result = run(
                audio,
                output,
                lambda event: print(
                    event.get("message", "original notes ready"), flush=True
                ),
                0,
                30,
            )
            (output / "result.json").write_text(json.dumps(result), encoding="utf-8")
            row = dict(
                id=identifier,
                audioSha256=hashlib.sha256(audio.read_bytes()).hexdigest(),
                annotationSha256=hashlib.sha256(archive.read(name)).hexdigest(),
                annotationSource=annotations["annotation_metadata"].get("data_source"),
                duration=result["duration"],
                executions=result["executions"],
                variants={},
            )
            for variant in ("direct", "separated", "cqt"):
                prediction = json.loads(
                    (output / f"{variant}-harmony.json").read_text(encoding="utf-8")
                )
                row["variants"][variant] = compare(
                    annotations["data"], prediction, result["duration"]
                )
            rows.append(row)
            print(json.dumps(row["variants"]), flush=True)
            args.report.parent.mkdir(parents=True, exist_ok=True)
            args.report.write_text(
                json.dumps(
                    dict(
                        protocol="first-30s-no-alignment-v1",
                        selection="diagnostic; no training or tuning on these outputs",
                        rows=rows,
                    ),
                    indent=2,
                ),
                encoding="utf-8",
            )


if __name__ == "__main__":
    main()
