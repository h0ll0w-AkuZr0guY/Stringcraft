"""Local audio harmony plugin. Frozen separation model; all musical intervals are seconds."""

from pathlib import Path
import contextlib
import hashlib
import json
import sys
import time
import threading
import numpy as np

VERSION = "0.3.0"
DEMUCS_SHA256 = "8726e21a993978c7ba086d3872e7608d7d5bfca646ca4aca459ffda844faa8b4"


def execution_device(torch):
    if torch.cuda.is_available():
        try:
            value = torch.ones(1, device="cuda")
            assert float(value.cpu()[0]) == 1
            return "cuda", []
        except (RuntimeError, AssertionError):
            return "cpu", ["CUDA 实际计算检查失败，本次明确使用 CPU。"]
    return "cpu", []


def harmony_from_audio(other, bass, rate, duration):
    import librosa
    from scipy.ndimage import median_filter, uniform_filter1d

    target = 22050
    other = librosa.resample(
        np.asarray(other, dtype=np.float32), orig_sr=rate, target_sr=target
    )
    bass = librosa.resample(
        np.asarray(bass, dtype=np.float32), orig_sr=rate, target_sr=target
    )
    hop = 2048

    def chroma(y):
        if np.max(np.abs(y), initial=0) < 1e-7:
            return np.zeros((12, int(len(y) / hop) + 1))
        c = np.abs(
            librosa.cqt(
                y,
                sr=target,
                hop_length=hop,
                fmin=librosa.note_to_hz("C1"),
                n_bins=84,
                bins_per_octave=12,
                tuning=0,
            )
        )
        # Reduce persistent spectral coloration without normalizing quiet frames into noise.
        c = c / np.maximum(np.mean(c, axis=1, keepdims=True), 0.02) ** 0.55
        x = c.reshape(7, 12, -1).sum(axis=0)
        return uniform_filter1d(
            median_filter(x, size=(1, 3)), size=9, axis=1, mode="nearest"
        )

    x = chroma(other)
    b = chroma(bass)
    count = min(x.shape[1], b.shape[1])
    x = x[:, :count]
    b = b[:, :count]
    x /= np.maximum(np.linalg.norm(x, axis=0, keepdims=True), 1e-8)
    b /= np.maximum(b.sum(axis=0, keepdims=True), 1e-8)
    labels = [(root, quality) for root in range(12) for quality in ("major", "minor")]
    templates = []
    for root, quality in labels:
        v = np.zeros(12)
        v[root] = 1
        v[(root + (4 if quality == "major" else 3)) % 12] = 0.85
        v[(root + 7) % 12] = 0.8
        templates.append(v / np.linalg.norm(v))
    emissions = np.asarray(templates) @ x
    emissions += np.asarray([b[r] * 0.12 for r, q in labels])
    transitions = np.full((24, 24), -0.13)
    np.fill_diagonal(transitions, 0)
    for i, (r, q) in enumerate(labels):
        for j, (rr, qq) in enumerate(labels):
            if r == rr and q != qq:
                transitions[i, j] = -0.16
    costs = emissions[:, 0].copy()
    back = np.zeros((count, 24), dtype=np.int16)
    for t in range(1, count):
        candidates = costs[:, None] + transitions
        back[t] = np.argmax(candidates, axis=0)
        costs = np.max(candidates, axis=0) + emissions[:, t]
    path = np.zeros(count, dtype=int)
    path[-1] = int(np.argmax(costs))
    for t in range(count - 1, 0, -1):
        path[t - 1] = back[t, path[t]]
    energy = librosa.feature.rms(y=other + bass, frame_length=4096, hop_length=hop)[0][
        :count
    ]
    silent = energy < max(1e-5, float(energy.max(initial=0)) * 0.008)
    segments = []
    for t, k in enumerate(path):
        root, quality = labels[k]
        ranked = np.argsort(emissions[:, t])[::-1]
        margin = max(0.0, float(emissions[k, t] - emissions[ranked[1], t]))
        status = "none" if silent[t] else "supported" if margin > 0.065 else "candidate"
        if status == "none":
            root, quality = None, None
        start = t * hop / target
        end = min(duration, (t + 1) * hop / target)
        if start >= duration:
            break
        alternatives = (
            [
                {
                    "root": labels[int(j)][0],
                    "quality": labels[int(j)][1],
                    "score": float(emissions[j, t]),
                }
                for j in ranked[:3]
            ]
            if root is not None
            else []
        )
        if segments and (segments[-1]["root"], segments[-1]["quality"]) == (
            root,
            quality,
        ):
            segments[-1]["end"] = end
            segments[-1]["evidence"] = min(segments[-1]["evidence"], margin)
            if status == "candidate":
                segments[-1]["status"] = "candidate"
        else:
            segments.append(
                {
                    "id": f"audio-h-{len(segments)}",
                    "start": start,
                    "end": end,
                    "root": root,
                    "quality": quality,
                    "status": status,
                    "evidence": min(1.0, margin),
                    "alternatives": alternatives,
                }
            )
    if segments:
        segments[-1]["end"] = duration
    return {
        "version": 1,
        "method": "audio-cqt-sequence-" + VERSION,
        "duration": duration,
        "frameHop": hop / target,
        "segments": segments,
        "executions": [],
        "warnings": [
            "和弦为模型分离后的音频候选；待确认区间参与预览，不代表已人工核对。"
        ],
    }


def probe(model_root):
    import torch
    import onnxruntime as ort

    sys.modules["tensorflow"] = None
    from basic_pitch import FilenameSuffix, build_icassp_2022_model_path

    path = Path(build_icassp_2022_model_path(FilenameSuffix.onnx))
    ort.InferenceSession(str(path), providers=["CPUExecutionProvider"])
    sys.modules.pop("tensorflow", None)
    weights = list((Path(model_root) / "torch/hub/checkpoints").glob("955717e8*.th"))
    if not weights:
        raise RuntimeError("HTDemucs weights missing")
    if hashlib.sha256(weights[0].read_bytes()).hexdigest() != DEMUCS_SHA256:
        raise RuntimeError("HTDemucs checkpoint corrupt")
    from neural import SHA256

    chord_path = Path(model_root) / "btc/model.pt"
    if hashlib.sha256(chord_path.read_bytes()).hexdigest() != SHA256:
        raise RuntimeError("BTC checkpoint missing or corrupt")
    device, warnings = execution_device(torch)
    return {
        "ready": True,
        "promoted": False,
        "device": device,
        "warnings": warnings,
        "gpu": torch.cuda.get_device_name(0) if device == "cuda" else None,
        "torch": torch.__version__,
        "executions": [
            {
                "name": "HTDemucs",
                "version": "4.0.1/htdemucs",
                "device": device,
                "provider": "PyTorch",
                "weightsSha256": DEMUCS_SHA256,
            },
            {
                "name": "Basic Pitch",
                "version": "0.4.0",
                "device": "cpu",
                "provider": "ONNX Runtime CPU",
                "weightsSha256": hashlib.sha256(path.read_bytes()).hexdigest(),
            },
            {
                "name": "BTC chord network",
                "version": "ISMIR19/25-class",
                "device": device,
                "provider": "PyTorch",
                "weightsSha256": SHA256,
            },
        ],
    }


def run(source, output, emit, offset=0.0, seconds=1800.0):
    import subprocess
    import os
    import soundfile as sf
    import torch
    import librosa
    from demucs.pretrained import get_model
    from demucs.apply import apply_model

    sys.modules["tensorflow"] = None
    from basic_pitch import FilenameSuffix, build_icassp_2022_model_path
    from basic_pitch.inference import Model, predict

    output = Path(output)
    output.mkdir(parents=True, exist_ok=True)
    emit({"type": "progress", "progress": 0.04, "message": "本地解码 · FFmpeg"})
    decoded = output / "decoded.wav"
    subprocess.run(
        [
            "ffmpeg",
            "-nostdin",
            "-v",
            "error",
            "-i",
            str(source),
            "-ss",
            str(offset),
            "-t",
            str(seconds),
            "-ac",
            "2",
            "-ar",
            "44100",
            str(decoded),
            "-y",
        ],
        check=True,
        timeout=180,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    audio, rate = sf.read(decoded, dtype="float32", always_2d=True)
    duration = len(audio) / rate
    notes = []
    emit(
        {
            "type": "progress",
            "progress": 0.12,
            "message": "原始音符 · Basic Pitch / ONNX Runtime CPU",
        }
    )
    model_path = Path(build_icassp_2022_model_path(FilenameSuffix.onnx))
    with contextlib.redirect_stdout(sys.stderr):
        _, _, events = predict(str(decoded), Model(str(model_path)))
    # einops tests module presence to select a backend; a None sentinel fools it.
    sys.modules.pop("tensorflow", None)
    for i, (start, end, midi, amplitude, _) in enumerate(events):
        start = max(0.0, float(start))
        end = min(duration, float(end))
        if end > start:
            notes.append(
                {
                    "id": f"local-{i}",
                    "start": start,
                    "duration": end - start,
                    "pitch": {"midi": int(midi)},
                    "score": float(np.clip(amplitude, 0, 1)),
                    "velocity": float(np.clip(amplitude, 0.15, 1)),
                    "source": "detected",
                }
            )
    emit({"type": "partial", "notes": notes, "duration": duration})
    device, warnings = execution_device(torch)
    stop = threading.Event()

    def heartbeat():
        while not stop.wait(3):
            emit(
                {
                    "type": "progress",
                    "progress": 0.35,
                    "message": f"分离伴奏与低音 · HTDemucs / {device.upper()}，正在计算",
                }
            )

    emit(
        {
            "type": "progress",
            "progress": 0.35,
            "message": f"分离伴奏与低音 · HTDemucs / {device.upper()}",
        }
    )
    thread = threading.Thread(target=heartbeat, daemon=True)
    thread.start()
    torch.manual_seed(0)
    with contextlib.redirect_stdout(sys.stderr):
        model = get_model("htdemucs")
    mix = torch.from_numpy(audio.T.copy())
    ref = mix.mean(0)
    mean = ref.mean()
    std = ref.std().clamp_min(1e-8)
    mix = (mix - mean) / std
    try:
        with torch.inference_mode():
            try:
                stems = (
                    apply_model(
                        model,
                        mix[None],
                        device=device,
                        segment=7.0,
                        shifts=1,
                        overlap=0.25,
                    )[0].cpu()
                    * std
                    + mean
                )
            except (torch.cuda.OutOfMemoryError, RuntimeError) as error:
                if device != "cuda":
                    raise
                warnings.append("GPU 分离失败，已明确降级到 CPU。")
                device = "cpu"
                torch.cuda.empty_cache()
                model = model.cpu()
                emit(
                    {
                        "type": "progress",
                        "progress": 0.35,
                        "message": "GPU 分离失败，正在使用 CPU 重试",
                    }
                )
                stems = (
                    apply_model(
                        model,
                        mix[None],
                        device="cpu",
                        segment=7.0,
                        shifts=1,
                        overlap=0.25,
                    )[0].cpu()
                    * std
                    + mean
                )
    finally:
        stop.set()
        thread.join(timeout=4)
    mapping = {name: stems[i].numpy().T for i, name in enumerate(model.sources)}
    sf.write(output / "bass.wav", mapping["bass"], rate, subtype="PCM_16")
    accompaniment = mapping["other"] + mapping["bass"] + mapping["drums"]
    sf.write(output / "accompaniment.wav", accompaniment, rate, subtype="PCM_16")
    emit(
        {
            "type": "progress",
            "progress": 0.82,
            "message": "和弦时间轴 · 伴奏与低音音频 / CPU",
        }
    )
    cqt = harmony_from_audio(
        mapping["other"].mean(1), mapping["bass"].mean(1), rate, duration
    )
    (output / "cqt-harmony.json").write_text(json.dumps(cqt), encoding="utf-8")
    from neural import analyze

    harmony = analyze(
        (mapping["other"] + mapping["bass"]).mean(1), rate, duration, device
    )
    direct = analyze(audio.mean(1), rate, duration, device)
    weights = next(
        (Path(os.environ["TORCH_HOME"]) / "hub/checkpoints").glob("955717e8*.th")
    )
    executions = [
        {
            "name": "HTDemucs",
            "version": "4.0.1/htdemucs",
            "device": device,
            "provider": "PyTorch",
            "weightsSha256": hashlib.sha256(weights.read_bytes()).hexdigest(),
        },
        {
            "name": "Basic Pitch",
            "version": "0.4.0",
            "device": "cpu",
            "provider": "ONNX Runtime CPU",
            "weightsSha256": hashlib.sha256(model_path.read_bytes()).hexdigest(),
        },
        *harmony["executions"],
    ]
    harmony["executions"] = executions
    harmony["sourceAudioSha256"] = hashlib.sha256(Path(source).read_bytes()).hexdigest()
    (output / "separated-harmony.json").write_text(
        json.dumps(harmony), encoding="utf-8"
    )
    # Direct audio baseline remains available for local A/B, not passed off as separation.
    (output / "direct-harmony.json").write_text(json.dumps(direct), encoding="utf-8")
    decoded.unlink(missing_ok=True)
    return {
        "duration": duration,
        "bpm": 120.0,
        "notes": notes,
        "harmonyAnalysis": harmony,
        "executions": executions,
        "warnings": warnings,
        "method": "accompaniment",
        "limitSeconds": 1800,
        "sourceOffset": offset,
    }


if __name__ == "__main__":
    if sys.argv[1] == "probe":
        print(json.dumps(probe(Path(sys.argv[2]))), flush=True)
