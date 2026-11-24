"""Content-addressed PCM assets outlive transient inference jobs."""

import hashlib
import json
import re
import shutil
import os
import wave
from pathlib import Path


class AudioAssets:
    def __init__(self, root):
        self.root = Path(root)

    def _id(self, value):
        if not isinstance(value, str) or not re.fullmatch(r"[a-f0-9]{64}", value):
            raise ValueError("Invalid asset identity")
        return value

    def path(self, identifier):
        path = self.root / (self._id(identifier) + ".wav")
        if not path.is_file():
            raise FileNotFoundError("Audio asset unavailable; relink or analyze again")
        return path

    def register(self, source):
        source = Path(source)
        with source.open("rb") as stream:
            digest = hashlib.file_digest(stream, "sha256").hexdigest()
        with wave.open(str(source)) as audio:
            rate = audio.getframerate()
            descriptor = dict(
                id=digest,
                sha256=digest,
                duration=audio.getnframes() / rate,
                sampleRate=rate,
                channels=audio.getnchannels(),
                offsetSeconds=0,
            )
        self.root.mkdir(parents=True, exist_ok=True)
        destination = self.root / (digest + ".wav")
        if not destination.exists():
            # Publish only a complete file. No paths supplied by HTTP callers.
            temporary = self.root / (digest + ".partial")
            try:
                os.link(source, temporary)
            except OSError:
                shutil.copyfile(source, temporary)
            temporary.replace(destination)
        (self.root / (digest + ".json")).write_text(
            json.dumps(descriptor), encoding="utf-8"
        )
        return descriptor

    def pin(self, project, ids):
        if not isinstance(project, str) or not 1 <= len(project) <= 512:
            raise ValueError("Invalid project identity")
        if not isinstance(ids, list) or len(ids) > 64:
            raise ValueError("Invalid references")
        for identifier in ids:
            self.path(identifier)
        project = hashlib.sha256(project.encode("utf-8")).hexdigest()
        refs = self.root / "references"
        refs.mkdir(parents=True, exist_ok=True)
        target = refs / (project + ".json")
        temporary = refs / (project + ".partial")
        temporary.write_text(json.dumps(sorted(set(ids))), encoding="utf-8")
        temporary.replace(target)

    def release(self, project):
        if not isinstance(project, str) or not 1 <= len(project) <= 512:
            raise ValueError("Invalid project identity")
        project = hashlib.sha256(project.encode("utf-8")).hexdigest()
        (self.root / "references" / (project + ".json")).unlink(missing_ok=True)
