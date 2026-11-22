"""JSON-lines adapter for independently distributed music models. No API keys."""
from __future__ import annotations
import contextlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile

def emit(value):
    print(json.dumps(value, allow_nan=False), flush=True)

def run(source: Path, mode: str):
    import numpy as np
    import soundfile as sf
    import librosa
    sys.modules['tensorflow'] = None
    from basic_pitch import FilenameSuffix, build_icassp_2022_model_path
    from basic_pitch.inference import Model, predict
    with tempfile.TemporaryDirectory(prefix='stringcraft_') as temp:
        directory = Path(temp)
        decoded = directory / 'input.wav'
        subprocess.run(['ffmpeg', '-nostdin', '-v', 'error', '-i', str(source), '-vn', '-ac', '2', '-ar', '44100', '-t', '1800', str(decoded)], check=True, timeout=180, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        selected = decoded
        if mode != 'transcribe':
            emit({'type': 'progress', 'progress': .15, 'message': '正在分离人声与伴奏（CPU）'})
            # Model weights are installed separately in the portable Torch cache.
            subprocess.run([sys.executable, '-m', 'demucs.separate', '-n', 'htdemucs', '--two-stems', 'vocals', '-d', 'cpu', '-o', str(directory / 'stems'), str(decoded)], check=True, timeout=1500, stdout=sys.stderr, stderr=sys.stderr)
            selected = directory / 'stems' / 'htdemucs' / 'input' / ('vocals.wav' if mode == 'vocals' else 'no_vocals.wav')
        samples, rate = sf.read(selected, dtype='float32', always_2d=True)
        mono = samples.mean(axis=1)
        duration = len(mono) / rate
        bpm, _ = librosa.beat.beat_track(y=mono, sr=rate)
        bpm = float(np.asarray(bpm).reshape(-1)[0]) if np.asarray(bpm).size else 120.
        if not 20 <= bpm <= 300:
            bpm = 120.
        emit({'type': 'progress', 'progress': .6, 'message': '正在分析音高与起音'})
        notes = []
        if mode == 'vocals':
            y = librosa.resample(mono, orig_sr=rate, target_sr=22050)
            f0, voiced, probabilities = librosa.pyin(y, fmin=librosa.note_to_hz('C2'), fmax=librosa.note_to_hz('C7'), sr=22050, frame_length=2048, hop_length=256)
            times = librosa.times_like(f0, sr=22050, hop_length=256)
            current = None
            def flush(end):
                if current and end - current['start'] >= .07:
                    notes.append({'start': current['start'], 'duration': end - current['start'], 'midi': current['midi'], 'score': current['score']})
            for t, freq, voice, confidence in zip(times, f0, voiced, probabilities):
                pitch = int(round(librosa.hz_to_midi(freq))) if voice and np.isfinite(freq) and confidence >= .2 else None
                if pitch != (current['midi'] if current else None):
                    flush(float(t))
                    current = {'start': float(t), 'midi': pitch, 'score': float(confidence)} if pitch is not None else None
            flush(duration)
        else:
            with contextlib.redirect_stdout(sys.stderr):
                _, _, events = predict(str(selected), Model(build_icassp_2022_model_path(FilenameSuffix.onnx)))
            for start, end, midi, amplitude, _ in events:
                start, end = max(0., float(start)), min(duration, float(end))
                if end > start:
                    notes.append({'start': start, 'duration': end - start, 'midi': int(midi), 'score': float(np.clip(amplitude, 0, 1))})
        result = [{'id': f'local-{i}', 'start': n['start'], 'duration': n['duration'], 'pitch': {'midi': n['midi']}, 'score': n['score'], 'velocity': max(.15, n['score']), 'source': 'detected'} for i, n in enumerate(notes)]
        emit({'type': 'result', 'result': {'duration': duration, 'bpm': bpm, 'notes': result, 'method': mode, 'limitSeconds': 1800}})

if __name__ == '__main__':
    try:
        run(Path(sys.argv[1]), sys.argv[2])
    except Exception as exc:
        print(type(exc).__name__ + ': local inference failed', file=sys.stderr)
        raise SystemExit(1)
