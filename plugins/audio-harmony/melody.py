"""Monophonic vocal evidence. Kept separate from the original polyphonic notes."""

import numpy as np


def vocal_melody(vocals, other, rate, original_notes, emit=None):
    import librosa
    from scipy.ndimage import median_filter

    sr, hop = 16000, 160
    y = librosa.resample(
        np.asarray(vocals, dtype=np.float32), orig_sr=rate, target_sr=sr
    )
    backing = librosa.resample(
        np.asarray(other, dtype=np.float32), orig_sr=rate, target_sr=sr
    )
    result = []
    # Bounded windows keep pYIN's state matrix independent of song length.
    for offset in range(0, len(y), sr * 10):
        part = y[offset : offset + sr * 10]
        if emit:
            emit(
                {
                    "type": "progress",
                    "progress": 0.74 + 0.07 * offset / max(1, len(y)),
                    "message": f"人声旋律证据 · pYIN CPU · {offset / sr:.0f}/{len(y) / sr:.0f} 秒",
                }
            )
        if len(part) < 1024 or np.max(np.abs(part), initial=0) < 1e-4:
            continue
        support = backing[offset : offset + len(part)]
        if np.sqrt(np.mean(part**2)) < np.sqrt(np.mean(support**2)) * 0.05:
            continue
        f0, voiced, probability = librosa.pyin(
            part, sr=sr, fmin=65.4, fmax=1046.5, frame_length=1024, hop_length=hop
        )
        energy = librosa.feature.rms(y=part, frame_length=1024, hop_length=hop)[0]
        backing_energy = librosa.feature.rms(
            y=support, frame_length=1024, hop_length=hop
        )[0]
        count = min(len(f0), len(energy), len(backing_energy))
        midi = np.rint(librosa.hz_to_midi(np.nan_to_num(f0[:count], nan=440.0))).astype(
            int
        )
        midi = median_filter(midi, size=5, mode="nearest")
        valid = (
            voiced[:count]
            & (probability[:count] >= 0.8)
            & (energy[:count] > max(1e-4, float(energy.max()) * 0.06))
            & (energy[:count] > backing_energy[:count] * 0.12)
        )
        labels = np.where(valid, midi, -1)
        start = 0
        for end in range(1, count + 1):
            if end < count and labels[end] == labels[start]:
                continue
            a, b = (
                offset / sr + start * hop / sr,
                min(len(y) / sr, offset / sr + end * hop / sr),
            )
            pitch = int(labels[start])
            if pitch >= 0 and b - a >= 0.09:
                attacks = sorted(
                    {
                        float(n["start"])
                        for n in original_notes
                        if n["pitch"]["midi"] == pitch
                        and n["score"] >= 0.5
                        and a + 0.12 < n["start"] < b - 0.09
                    }
                )
                edges = (
                    [a]
                    + [
                        t
                        for j, t in enumerate(attacks)
                        if not j or t - attacks[j - 1] > 0.1
                    ]
                    + [b]
                )
                for lo, hi in zip(edges, edges[1:]):
                    result.append(
                        dict(
                            id=f"vocal-{round(lo * 1000)}-{pitch}",
                            start=lo,
                            duration=hi - lo,
                            pitch=dict(midi=pitch),
                            score=float(np.mean(probability[start:end])),
                            velocity=float(
                                np.clip(np.mean(energy[start:end]) * 5, 0.35, 0.8)
                            ),
                            source="detected",
                            role="melody",
                        )
                    )
            start = end
    # Window edges are an implementation detail, never a new musical attack.
    merged = []
    for note in result:
        previous = merged[-1] if merged else None
        boundary = abs(note["start"] / 10 - round(note["start"] / 10)) < 0.006
        attack = any(
            n["pitch"]["midi"] == note["pitch"]["midi"]
            and n["score"] >= 0.5
            and abs(n["start"] - note["start"]) < 0.08
            for n in original_notes
        )
        if (
            previous
            and boundary
            and not attack
            and previous["pitch"] == note["pitch"]
            and abs(previous["start"] + previous["duration"] - note["start"]) < 0.06
        ):
            previous["duration"] = note["start"] + note["duration"] - previous["start"]
        else:
            merged.append(note)
    return merged
