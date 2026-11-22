"""Small commands used by PowerShell packaging without nested shell quoting."""
import sys
if sys.argv[1] == 'ffmpeg':
    import imageio_ffmpeg
    print(imageio_ffmpeg.get_ffmpeg_exe())
elif sys.argv[1] == 'models':
    from demucs.pretrained import get_model
    get_model('htdemucs')
    print('HTDemucs weights included')
elif sys.argv[1] == 'verify':
    sys.modules['tensorflow'] = None
    import basic_pitch, librosa, torch, torchaudio, demucs, imageio_ffmpeg
    from basic_pitch import FilenameSuffix, build_icassp_2022_model_path
    from basic_pitch.inference import Model
    model=Model(build_icassp_2022_model_path(FilenameSuffix.onnx))
    assert model.model_type == Model.MODEL_TYPES.ONNX
    print('Music environment imports and ONNX model load passed')
