# Stringcraft 音乐运行扩展 1.0.0

Windows x64 核心应用可以独立完成基础转录、编配和导出。这个扩展增加分轨与本地和弦分析。CPU 和 CUDA 任选其一。CUDA 版使用 PyTorch 的 CUDA 12.4 运行库，需要可用的 NVIDIA 驱动。版本状态与使用的实际设备可以在应用全局设置查看。

1. 完整解压 Stringcraft 核心包。再把扩展 ZIP 解压到另一个目录，双击 Install.cmd，选择 Stringcraft.exe 所在目录。
2. 安装器从官方项目取得固定版本的便携 Python、PyTorch 和解码依赖。需要联网；确认是否同时初始化模型。首次安装完成后，已有模型可以离线使用。
3. 重启弦作，在「全局设置 → 本地模型」确认状态。可选择另一处包含 local-separation 的 runtime_plugins 目录。
4. 更换运行环境时选到新目录，已安装的目录会保留。核心应用升级可以继续选用原目录。

需要补模型时，用扩展的独立 Python 运行 runtime-tools.py models。完整检查点在加载前校验摘要。安装器从上游获取模型、FFmpeg 与 PyTorch 运行库，许可跟随上游下载。详情见 [FFmpeg 许可](https://ffmpeg.org/legal.html)、[PyTorch 版本](https://pytorch.org/get-started/previous-versions/)和 [NVIDIA CUDA 条款](https://docs.nvidia.com/cuda/eula/index.html)。
