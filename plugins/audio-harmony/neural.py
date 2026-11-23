"""Frozen upstream BTC major/minor model. No training or caller-supplied pickle files."""

import hashlib
import os
from pathlib import Path
import numpy as np

SHA256 = "71c2c5db17e8c43b8a9a9da5db36ef2d667158c07a214eba16344c154c00bf54"


def analyze(y, rate, duration, device="cpu"):
    import librosa
    import torch
    from btc.model import BTC_model

    path = Path(os.environ["TORCH_HOME"]).parent / "btc/model.pt"
    if hashlib.sha256(path.read_bytes()).hexdigest() != SHA256:
        raise RuntimeError("BTC checkpoint digest mismatch")
    # Official fixed checkpoint is verified above before legacy pickle deserialization.
    data = torch.load(path, map_location="cpu", weights_only=False)
    config = dict(
        feature_size=144,
        timestep=108,
        num_chords=25,
        input_dropout=0.2,
        layer_dropout=0.2,
        attention_dropout=0.2,
        relu_dropout=0.2,
        num_layers=8,
        num_heads=4,
        hidden_size=128,
        total_key_depth=128,
        total_value_depth=128,
        filter_size=128,
        loss="ce",
        probs_out=False,
    )
    model = BTC_model(config).to(device).eval()
    model.load_state_dict(data["model"])
    audio = librosa.resample(
        np.asarray(y, dtype=np.float32), orig_sr=rate, target_sr=22050
    )
    segments = []
    with torch.inference_mode():
        for offset in range(0, len(audio), 220500):
            part = audio[offset : offset + 220500]
            length = len(part) / 22050
            if len(part) < 4096:
                part = np.pad(part, (0, 4096 - len(part)))
            feature = np.log(
                np.abs(
                    librosa.cqt(
                        part, sr=22050, n_bins=144, bins_per_octave=24, hop_length=2048
                    )
                )
                + 1e-6
            ).T
            count = min(len(feature), 108)
            feature = (feature[:count] - data["mean"]) / data["std"]
            feature = np.pad(feature, ((0, 108 - count), (0, 0)))
            hidden, _ = model.self_attn_layers(
                torch.tensor(feature, dtype=torch.float32, device=device)[None]
            )
            scores = (
                torch.softmax(model.output_layer.output_projection(hidden), dim=-1)[
                    0, :count
                ]
                .cpu()
                .numpy()
            )
            for i, row in enumerate(scores):
                start = offset / 22050 + i * 10 / 108
                end = min(
                    duration,
                    offset / 22050 + length,
                    offset / 22050 + (i + 1) * 10 / 108,
                )
                if start >= end:
                    break
                ranked = np.argsort(row)[::-1]
                best = int(ranked[0])
                margin = float(row[best] - row[ranked[1]])
                none = best == 24
                alternatives = [
                    {
                        "root": int(k) // 2,
                        "quality": "major" if int(k) % 2 == 0 else "minor",
                        "score": float(row[k]),
                    }
                    for k in ranked
                    if k != 24
                ][:3]
                root = None if none else best // 2
                quality = None if none else "major" if best % 2 == 0 else "minor"
                status = (
                    "none" if none else "supported" if margin > 0.3 else "candidate"
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
                        dict(
                            id=f"btc-h-{len(segments)}",
                            start=start,
                            end=end,
                            root=root,
                            quality=quality,
                            status=status,
                            evidence=margin,
                            alternatives=[] if none else alternatives,
                        )
                    )
    if segments:
        segments[-1]["end"] = duration
    return dict(
        version=1,
        method="btc25-frozen-2019",
        duration=duration,
        frameHop=10 / 108,
        segments=segments,
        executions=[
            dict(
                name="BTC chord network",
                version="ISMIR19/25-class",
                device=device,
                provider="PyTorch",
                weightsSha256=SHA256,
            )
        ],
        warnings=["仅输出大小三和弦及无和弦；相对激活差未经正确率校准，候选参与预览。"],
    )
