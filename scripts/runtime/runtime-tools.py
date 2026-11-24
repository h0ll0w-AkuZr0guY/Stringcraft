"""Install optional upstream weights with full digests before load."""
from pathlib import Path
import hashlib
import sys
import urllib.request
import shutil

CHECKPOINTS = [
    ("torch/hub/checkpoints/955717e8-8726e21a.th",
     "https://dl.fbaipublicfiles.com/demucs/hybrid_transformer/955717e8-8726e21a.th",
     "8726e21a993978c7ba086d3872e7608d7d5bfca646ca4aca459ffda844faa8b4", 120_000_000),
    ("btc/model.pt",
     "https://raw.githubusercontent.com/jayg996/BTC-ISMIR19/2682317be668032e6e4b269ded36adaa2ad57df0/test/btc_model.pt",
     "71c2c5db17e8c43b8a9a9da5db36ef2d667158c07a214eba16344c154c00bf54", 16_000_000),
]

def digest(path):
    with path.open("rb") as source:
        return hashlib.file_digest(source, "sha256").hexdigest()

def models(root):
    for relative, url, expected, limit in CHECKPOINTS:
        path = root / "models" / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        if path.is_file() and digest(path) == expected:
            continue
        temp = path.with_suffix(".download")
        print(f"Downloading {path.name}", flush=True)
        with urllib.request.urlopen(url, timeout=120) as response, temp.open("wb") as out:
            remaining = limit
            while block := response.read(min(1024 * 1024, remaining + 1)):
                remaining -= len(block)
                if remaining < 0:
                    raise ValueError("Checkpoint exceeds the expected size")
                out.write(block)
        if digest(temp) != expected:
            raise ValueError(f"Checkpoint digest mismatch: {path.name}")
        temp.replace(path)
    shutil.copy2(Path(__file__).with_name("btc-LICENSE.txt"), root / "models/btc/LICENSE")

def verify(device):
    import torch
    import torchaudio
    import librosa
    import soundfile
    import onnxruntime
    sys.modules["tensorflow"] = None
    from basic_pitch import FilenameSuffix, build_icassp_2022_model_path
    file = build_icassp_2022_model_path(FilenameSuffix.onnx)
    onnxruntime.InferenceSession(str(file), providers=["CPUExecutionProvider"])
    if (device == "cu124") != (torch.version.cuda == "12.4"):
        raise RuntimeError("PyTorch runtime flavor does not match this extension")
    print("PyTorch", torch.__version__, "| CUDA available:", torch.cuda.is_available())

if __name__ == "__main__":
    command = sys.argv[1]
    if command == "verify":
        verify(sys.argv[2])
    elif command == "models":
        models(Path(sys.argv[2]).resolve() if len(sys.argv) > 2 else Path(__file__).resolve().parent)
    elif command == "ffmpeg":
        import imageio_ffmpeg
        print(imageio_ffmpeg.get_ffmpeg_exe())
    else:
        raise SystemExit("Unknown runtime command")
