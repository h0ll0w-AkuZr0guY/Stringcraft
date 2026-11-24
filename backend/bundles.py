"""Portable project/audio archive. Archive member names never become arbitrary paths."""

from pathlib import Path
import hashlib
import json
import re
import tempfile
import zipfile

MAX_EXPANDED = 2 * 1024**3


def asset_ids(project):
    if (
        not isinstance(project, dict)
        or project.get("schemaVersion") not in (1, 2)
        or not isinstance(project.get("notes"), list)
    ):
        raise ValueError("Invalid project")
    tracks = project.get("tracks", [])
    if not isinstance(tracks, list) or len(tracks) > 64:
        raise ValueError("Invalid tracks")
    ids = set()
    for t in tracks:
        if not isinstance(t, dict):
            raise ValueError("Invalid track")
        a = t.get("asset")
        if a is not None:
            if not isinstance(a, dict) or not isinstance(a.get("id"), str):
                raise ValueError("Invalid asset")
            ids.add(a["id"])
    if any(not isinstance(i, str) or not re.fullmatch(r"[a-f0-9]{64}", i) for i in ids):
        raise ValueError("Invalid audio identities")
    return ids


def export_bundle(project, assets, destination):
    ids = asset_ids(project)
    if sum(assets.path(i).stat().st_size for i in ids) > MAX_EXPANDED:
        raise ValueError("Project audio exceeds 2 GB")
    with zipfile.ZipFile(destination, "w", zipfile.ZIP_DEFLATED, compresslevel=1) as z:
        z.writestr("project.json", json.dumps(project, ensure_ascii=False))
        z.writestr("manifest.json", json.dumps({"version": 1, "assets": sorted(ids)}))
        for i in sorted(ids):
            z.write(assets.path(i), "audio/" + i + ".wav")


def import_bundle(source, assets):
    with (
        zipfile.ZipFile(source) as z,
        tempfile.TemporaryDirectory(prefix="stringcraft-import-") as temporary,
    ):
        names = z.namelist()
        if (
            len(names) != len(set(names))
            or len(names) > 66
            or sum(n.file_size for n in z.infolist()) > MAX_EXPANDED
        ):
            raise ValueError("Invalid or oversized project archive")
        if any(
            n not in ("project.json", "manifest.json")
            and not re.fullmatch(r"audio/[a-f0-9]{64}\.wav", n)
            for n in names
        ):
            raise ValueError("Unexpected archive member")
        if (
            z.getinfo("project.json").file_size > 50 * 1024**2
            or z.getinfo("manifest.json").file_size > 16384
        ):
            raise ValueError("Project metadata too large")
        project = json.loads(z.read("project.json"))
        ids = asset_ids(project)
        manifest = json.loads(z.read("manifest.json"))
        if (
            manifest.get("version") != 1
            or set(manifest.get("assets", [])) != ids
            or set(names)
            != {"project.json", "manifest.json", *("audio/" + i + ".wav" for i in ids)}
        ):
            raise ValueError("Archive manifest differs")
        # Validate every member and digest before publishing any asset.
        for i in ids:
            target = Path(temporary) / (i + ".wav")
            with z.open("audio/" + i + ".wav") as a, target.open("wb") as b:
                import shutil

                shutil.copyfileobj(a, b)
            with target.open("rb") as stream:
                if hashlib.file_digest(stream, "sha256").hexdigest() != i:
                    raise ValueError("Audio digest differs")
            import wave

            with wave.open(str(target)) as audio:
                if audio.getframerate() < 8000 or audio.getnchannels() > 8:
                    raise ValueError("Invalid audio format")
        descriptors = {i: assets.register(Path(temporary) / (i + ".wav")) for i in ids}
        for track in project.get("tracks", []):
            if track.get("asset"):
                track["asset"] = {
                    **descriptors[track["asset"]["id"]],
                    "offsetSeconds": track["asset"].get("offsetSeconds", 0),
                }
        return project
