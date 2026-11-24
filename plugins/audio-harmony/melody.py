"""Monophonic vocal evidence. Kept separate from the original polyphonic notes."""

import numpy as np


def phrases_from_frames(midi, voiced, probability, energy, backing, notes, offset, duration):
    """Decode ten-millisecond frames with separate evidence for holds and attacks."""
    audible = (energy > max(1e-4, float(energy.max()) * 0.06)) & (energy > backing * 0.15)
    strong = voiced & audible & (probability >= 0.8)
    labels = np.where(voiced & audible & (probability >= 0.56), midi, -1)
    attacks = sorted(
        (n["start"], n["pitch"]["midi"])
        for n in notes
        if n["score"] >= 0.5 and offset - 0.08 <= n["start"] <= offset + len(labels) / 100
    )
    start = 0
    original = labels.copy()
    for end in range(1, len(labels) + 1):
        if end < len(labels) and original[end] == original[start]:
            continue
        left = original[start - 1] if start else -1
        right = original[end] if end < len(labels) else -1
        if (
            end - start <= 6 and left == right and left >= 0
            and (original[start] < 0 or abs(original[start] - left) == 12)
            and audible[start:end].all()
            and not any(offset + start / 100 - 0.025 <= t <= offset + end / 100 + 0.025 for t, _ in attacks)
        ):
            labels[start:end] = left
        start = end

    result = []
    start = 0
    for end in range(1, len(labels) + 1):
        if end < len(labels) and labels[end] == labels[start]:
            continue
        pitch = int(labels[start])
        a, b = offset + start / 100, min(duration, offset + end / 100)
        support = strong[start:end] & (midi[start:end] == pitch)
        if pitch >= 0 and b - a >= 0.09 and support.sum() >= 3:
            edges = [a]
            for time, attack_pitch in attacks:
                if attack_pitch != pitch or time - edges[-1] < 0.10 or b - time < 0.09:
                    continue
                j = round((time - offset) * 100)
                # A detector onset splits an existing note only when a new attack
                # follows a local energy valley. A sustained vowel can retrigger BP.
                valley = energy[max(start, j - 5):j + 1]
                arrival = energy[j:min(end, j + 6)]
                if len(valley) and len(arrival) and float(valley.min()) <= float(arrival.max()) * 0.70:
                    edges.append(time)
            confidence = float(np.mean(probability[start:end][support]))
            for lo, hi in zip(edges, edges[1:] + [b]):
                result.append(dict(
                    id=f"vocal-phrase-{round(lo * 1000)}-{pitch}",
                    start=lo,
                    duration=hi - lo,
                    pitch=dict(midi=pitch),
                    score=confidence,
                    velocity=float(np.clip(np.mean(energy[start:end]) * 5, 0.35, 0.8)),
                    source="detected",
                    role="melody",
                ))
        start = end
    return result


def vocal_melody(vocals, other, rate, original_notes, emit=None, phrase_evidence=None):
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
        if phrase_evidence is not None:
            phrase_evidence.extend(phrases_from_frames(
                midi, voiced[:count], probability[:count], energy[:count],
                backing_energy[:count], original_notes, offset / sr, len(y) / sr,
            ))
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
    if phrase_evidence is not None:
        phrase_evidence[:] = merge_windows(phrase_evidence, original_notes)
    return merge_windows(result, original_notes)


def merge_windows(result, original_notes):
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
