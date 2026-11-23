"""Small commands used by PowerShell packaging without nested shell quoting."""

import sys

if sys.argv[1] == "ffmpeg":
    import imageio_ffmpeg

    print(imageio_ffmpeg.get_ffmpeg_exe())
elif sys.argv[1] == "models":
    import hashlib
    import os
    from pathlib import Path
    import urllib.request
    from demucs.pretrained import get_model

    get_model("htdemucs")
    checkpoint = Path(os.environ["TORCH_HOME"]).parent / "btc/model.pt"
    checkpoint.parent.mkdir(parents=True, exist_ok=True)
    url = "https://raw.githubusercontent.com/jayg996/BTC-ISMIR19/2682317be668032e6e4b269ded36adaa2ad57df0/test/btc_model.pt"
    if not checkpoint.is_file():
        with urllib.request.urlopen(url, timeout=120) as response:
            content = response.read(16 * 1024 * 1024)
        if (
            hashlib.sha256(content).hexdigest()
            != "71c2c5db17e8c43b8a9a9da5db36ef2d667158c07a214eba16344c154c00bf54"
        ):
            raise RuntimeError("BTC checkpoint digest mismatch")
        checkpoint.write_bytes(content)
    if (
        hashlib.sha256(checkpoint.read_bytes()).hexdigest()
        != "71c2c5db17e8c43b8a9a9da5db36ef2d667158c07a214eba16344c154c00bf54"
    ):
        raise RuntimeError("BTC checkpoint digest mismatch")
    import shutil

    shutil.copy2(
        Path(__file__).resolve().parents[1] / "plugins/audio-harmony/btc/LICENSE",
        checkpoint.parent / "LICENSE",
    )
    print("HTDemucs weights included")
    print("Frozen BTC checkpoint and upstream license included; experimental local use")
elif sys.argv[1] == "verify":
    sys.modules["tensorflow"] = None
    import basic_pitch, librosa, torch, torchaudio, demucs, imageio_ffmpeg
    from basic_pitch import FilenameSuffix, build_icassp_2022_model_path
    from basic_pitch.inference import Model

    model = Model(build_icassp_2022_model_path(FilenameSuffix.onnx))
    assert model.model_type == Model.MODEL_TYPES.ONNX
    print("Music environment imports and ONNX model load passed")
