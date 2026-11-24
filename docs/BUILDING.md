# 构建、测试与发布

## 统一检查

Node.js 22+：npm ci、npm run check、npm run build。构建包含独立插件、模型/WASM、文档 HTML 与运行依赖许可。Python 源码审计只扫描本仓库，检查密钥模式与 Markdown 链接。后端另安装 requirements 与 httpx，运行 unittest。

首次测试浏览器执行 npx playwright install chromium，先 npm run build，随后 npm run test:e2e（测试生产构建）；Windows 可用环境变量 PLAYWRIGHT_CHANNEL=msedge。完整合成音频评估执行 npm run quality，输出 artifacts/quality。质量门槛见 QUALITY。

## Pages

Settings → Pages 的 source 选择 GitHub Actions。pages.yml 仅允许 workflow_dispatch 手动发布；main 提交不再自动上线。先交付本地包并完成试用，再按用户明确的发布请求部署指定提交。Vite 使用相对 base，模型、WASM、插件、字体与文档都从仓库子路径载入。只部署 dist，不部署服务、Key 或用户文件。

插件编译后使用内容摘要命名 ESM。官方目录指向版本化文件；更新新插件时保留旧文件，以免已安装项目失去相关资源。更改已有逻辑需递增相应插件版本，不能只依靠内容散列掩盖语义版本变化。

## Windows 基础包

在 Windows 安装 .NET 8 SDK、Node.js 22+、Python 3.11+。先运行 npm run build，再运行 python scripts/build-local.py。脚本用 PyInstaller 冻结私有计算服务，并将 WinForms 宿主按 win-x64 自包含发布。基础包无需预装 .NET、Python 或 Node。宿主使用系统 WebView2 Evergreen Runtime，缺失时按微软文档安装 x64 离线安装程序。[WebView2 分发说明](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/distribution)

请完整解压并双击 Stringcraft.exe。service 子目录与主程序一起交付，模型环境放入 runtime_plugins 或从全局设置选择已有目录。数据默认在 %LOCALAPPDATA%/Stringcraft/Desktop，STRINGCRAFT_DATA 可覆盖。WebView2 SDK 与 .NET 分发文件随包提供许可说明。

## 独立音乐环境

需要官方 uv CLI。执行 powershell -File scripts/build-environment.ps1 -WithModels。

脚本获取可重定位的 Python 3.11 独立发行版，安装固定 Torch/torchaudio 2.5.1、Basic Pitch、HTDemucs、librosa 与 imageio-ffmpeg，保留安装依赖和许可证元数据。默认 CPU，`-TorchDevice cu124` 安装同时支持 CPU 的 CUDA 12.4 运行库。WithModels 预下载 HTDemucs 和固定提交的 BTC 权重，BTC 加载前强制 SHA-256 校验；Basic Pitch ONNX 资源随 Python 包。得到 runtime_plugins/local-separation/python、bin、models 与清单。权重公开分发前需另行复核 LICENSING，实验包不构成分发许可判断。

用户把环境 ZIP 解压到基础包同级后即可发现，保留完整 service 子目录。如未指定 WithModels，HTDemucs 首次使用需要联网；不要称为完整离线包。普通 venv 不可作为可移植运行环境直接分发。环境可能数百 MB 或更大，首次构建时间取决于网络；模型环境与基础包分别发版。

在未安装依赖的测试环境解压并检查：基础包启动、能力查询、整曲识别、分离、取消进程、网络断开后的模型加载，以及重启后用户项目保留。只有经过实际验证的路径可写入发布说明。

## 发布流程

ci.yml 检查每个 PR。pages.yml 手动发布网页；release.yml 对明确 v 标签构建 Windows 基础包并创建预览 Release，同时提供环境构建的独立 workflow_dispatch。CI 不读取本地 Key、不调用付费模型。

维护者发布前检查差异、第三方许可、质量报告、版本和下载包。0.1.0 只能标记 preview，真人试弹与真实混音门槛未过前不作为稳定版 Latest。不要覆盖历史附件；新环境包应使用新版本名，提供 SHA-256。

真实 Pages 的 BYOK 验证使用显式设置 STRINGCRAFT_PROVIDER_KEY_FILE 后运行 provider.spec.ts，默认跳过且禁止录屏、截图和 trace；普通 CI 永不读取或调用密钥。

## 本地试用包

先运行 npm run check 和 npm run build，再运行 python scripts/build-local.py。输出目录、ZIP 和 SHA-256 可用 --output-root 指到其他磁盘。可选 --environment 指向仓库 artifacts 内准备好的 local-separation 环境，单独生成含模型的包。

使用实际解压包验证应用窗口、托盘隐藏与恢复、单实例、保存后退出、模型进程和服务回收。冻结服务可独立作诊断，不能替代桌面端验证。浏览器交互回归通过 npm run test:e2e 运行；真实音频和截图放在本机 QA 目录。测试不需要付费 API。

自动化桌面检查可用测试数据目录启动 EXE。仅为该次启动设置 WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS 为 --remote-debugging-port=19229。再设置 TEST_DESKTOP_CDP 和 STRINGCRAFT_DESKTOP_REPORT，用 node scripts/verify-desktop.mjs 检查窗口上真实的分轨、编配和 WAV。可选 STRINGCRAFT_TRACK_BUNDLE 指定已授权的旧版工程 ZIP，同时检查迁移与整曲谱面定位。

本地候选完成试用后再按明确授权发布。版本和构建摘要从包内 build-info.json 统一提供。
