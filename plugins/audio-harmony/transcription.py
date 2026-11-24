"""Analyze a registered separated track; never separate an already separated stem."""

import contextlib
import hashlib
import json
import sys
from pathlib import Path
import numpy as np


def transcribe_track(path, prefix="instrumental"):
    sys.modules["tensorflow"] = None
    from basic_pitch import FilenameSuffix, build_icassp_2022_model_path
    from basic_pitch.inference import Model, predict

    model = Path(build_icassp_2022_model_path(FilenameSuffix.onnx))
    with contextlib.redirect_stdout(sys.stderr):
        _, _, events = predict(str(path), Model(str(model)))
    sys.modules.pop("tensorflow", None)
    notes = []
    for i, (start, end, midi, amplitude, _) in enumerate(events):
        start = max(0.0, float(start))
        end = float(end)
        if end > start:
            notes.append(
                dict(
                    id=f"{prefix}-{i}",
                    start=start,
                    duration=end - start,
                    pitch=dict(midi=int(midi)),
                    score=float(np.clip(amplitude, 0, 1)),
                    velocity=float(np.clip(amplitude, 0.15, 1)),
                    source="detected",
                )
            )
    return notes, dict(
        name="Basic Pitch",
        version="0.4.0",
        device="cpu",
        provider="ONNX Runtime CPU",
        weightsSha256=hashlib.sha256(model.read_bytes()).hexdigest(),
    )


def analyze_saved_track(source, output, vocal, emit, backing=None):
    import soundfile as sf
    from melody import vocal_melody

    audio, rate = sf.read(source, dtype="float32", always_2d=True)
    duration = len(audio) / rate
    emit(
        dict(
            type="progress",
            progress=0.1,
            message="独立人声轨转录 · Basic Pitch / CPU"
            if vocal
            else "独立器乐轨转录 · Basic Pitch / CPU",
        )
    )
    notes, execution = transcribe_track(source, "vocal" if vocal else "instrumental")
    notes = [
        {**n, "duration": min(n["duration"], duration - n["start"])}
        for n in notes
        if n["start"] < duration
    ]
    evidence = []
    phrases = []
    if vocal:
        support = np.zeros_like(audio)
        if backing:
            support, support_rate = sf.read(backing, dtype="float32", always_2d=True)
            if support_rate != rate or len(support) != len(audio):
                raise ValueError("Stem clocks differ")
        evidence = vocal_melody(audio.mean(1), support.mean(1), rate, notes, emit, phrases)
    return dict(
        duration=duration,
        bpm=120.0,
        notes=notes,
        melodyEvidence=evidence,
        **({"phraseEvidence": phrases} if vocal else {}),
        executions=[execution]
        + (
            [
                dict(
                    name="pYIN vocal melody",
                    version="librosa-0.11.0",
                    device="cpu",
                    provider="librosa F0",
                )
            ]
            if vocal
            else []
        ),
        warnings=[],
        method="vocal-track" if vocal else "instrumental-track",
    )
