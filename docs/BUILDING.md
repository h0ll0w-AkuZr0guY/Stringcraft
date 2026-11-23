# 构建、测试与发布

## 统一检查

Node.js 22+：npm ci、npm run check、npm run build。构建包含独立插件、模型/WASM、文档 HTML 与运行依赖许可。Python 源码审计只扫描本仓库，检查密钥模式与 Markdown 链接。后端另安装 requirements 与 httpx，运行 unittest。

首次测试浏览器执行 npx playwright install chromium，先 npm run build，随后 npm run test:e2e（测试生产构建）；Windows 可用环境变量 PLAYWRIGHT_CHANNEL=msedge。完整合成音频评估执行 npm run quality，输出 artifacts/quality。质量门槛见 QUALITY。

## Pages

Settings → Pages 的 source 选择 GitHub Actions。pages.yml 仅允许 workflow_dispatch 手动发布；main 提交不再自动上线。先交付本地包并完成试用，再按用户明确的发布请求部署指定提交。Vite 使用相对 base，模型、WASM、插件、字体与文档都从仓库子路径载入。只部署 dist，不部署服务、Key 或用户文件。

插件编译后使用内容摘要命名 ESM。官方目录指向版本化文件；更新新插件时保留旧文件，以免已安装项目失去相关资源。更改已有逻辑需递增相应插件版本，不能只依靠内容散列掩盖语义版本变化。

## Windows 基础包

Windows、Python 3.11+：先 npm run build，再 python scripts/build-local.py。脚本创建独立 .venv-build 构建环境，PyInstaller 生成目录版 Stringcraft.exe，将工作台与本地 worker 包入，ZIP 输出到 artifacts。基础包不包含 Torch/Demucs。完整解压后双击 exe；本机无需预装 Python/Node。

不要删掉 exe 同目录的 _internal。代码与前端固定版本随基础包发布；音乐环境放在 exe 同目录 runtime_plugins。数据位于系统用户应用目录 Stringcraft/jobs，可用 STRINGCRAFT_DATA 覆盖。

## 独立音乐环境

需要官方 uv CLI。执行 powershell -File scripts/build-environment.ps1 -WithModels。

脚本获取可重定位的 Python 3.11 独立发行版，安装固定 Torch/torchaudio 2.5.1、Basic Pitch、HTDemucs、librosa 与 imageio-ffmpeg，保留安装依赖和许可证元数据。默认 CPU，`-TorchDevice cu124` 安装同时支持 CPU 的 CUDA 12.4 运行库。WithModels 预下载 HTDemucs 和固定提交的 BTC 权重，BTC 加载前强制 SHA-256 校验；Basic Pitch ONNX 资源随 Python 包。得到 runtime_plugins/local-separation/python、bin、models 与清单。权重公开分发前需另行复核 LICENSING，实验包不构成分发许可判断。

用户把环境 ZIP 解压到基础包同级后即可发现，无需覆盖 _internal。如未指定 WithModels，HTDemucs 首次使用需要联网；不要称为完整离线包。普通 venv 不可作为可移植运行环境直接分发。环境可能数百 MB 或更大，首次构建时间取决于网络；模型环境与基础包分别发版。

在未安装依赖的测试环境解压并检查：基础包启动、能力查询、整曲识别、分离、取消进程、网络断开后的模型加载，以及重启后用户项目保留。只有经过实际验证的路径可写入发布说明。

## 发布流程

ci.yml 检查每个 PR。pages.yml 手动发布网页；release.yml 对明确 v 标签构建 Windows 基础包并创建预览 Release，同时提供环境构建的独立 workflow_dispatch。CI 不读取本地 Key、不调用付费模型。

维护者发布前检查差异、第三方许可、质量报告、版本和下载包。0.1.0 只能标记 preview，真人试弹与真实混音门槛未过前不作为稳定版 Latest。不要覆盖历史附件；新环境包应使用新版本名，提供 SHA-256。

真实 Pages 的 BYOK 验证使用显式设置 STRINGCRAFT_PROVIDER_KEY_FILE 后运行 provider.spec.ts，默认跳过且禁止录屏、截图和 trace；普通 CI 永不读取或调用密钥。

## 本地试用包

本轮版本为 0.2.0-local.3，不创建公开标签或 Release。先完成源码提交与 npm run build，再执行 python scripts/build-local.py，输出基础目录包、ZIP 与 .zip.sha256。完整模型包追加 `--environment artifacts/<环境目录>/runtime_plugins/local-separation`，脚本只接受本仓库 artifacts 内的准备环境。空间不足时用 `--output-root <其他磁盘目录>` 指定独立构建和 ZIP 位置；不会删除或覆盖旧包。使用说明随包提供；网页和服务从同一 build-info 识别版本。基础模型/WASM/采样已包含，不携带用户音频或 Key。

先独立解压，再限制 PATH 只含 Windows 系统路径启动 EXE。以 TEST_BASE_URL 指向该进程，执行 scripts/verify-local-trial.mjs；它阻止外网请求，验证真实识别、生成、播放、WAV 非静音、MIDI、保存和重开。STRINGCRAFT_PRIVATE_AUDIO 可显式指定本机授权材料；私人阶段不录视频，结果只写 artifacts。端口相同版本复用、旧版本占用拒绝还需用实际 EXE 验证。

完整包另外执行 scripts/verify-native-trial.mjs。STRINGCRAFT_NATIVE_AUDIO 指定本地授权的短音频，验证实际模型任务、分离试听、缓存、和声对照、68.5/135.7 BPM 的材料不变与导出；默认不调用付费 API。该流程验证可用性，不能替代带真值的质量评估。
