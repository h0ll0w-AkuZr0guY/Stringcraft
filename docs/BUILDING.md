# 构建、测试与发布

## 统一检查

Node.js 22+：npm ci、npm run check、npm run build。构建包含独立插件、模型/WASM、文档 HTML 与运行依赖许可。Python 源码审计只扫描本仓库，检查密钥模式与 Markdown 链接。后端另安装 requirements 与 httpx，运行 unittest。

首次测试浏览器执行 npx playwright install chromium，随后 npm run test:e2e；Windows 可用环境变量 PLAYWRIGHT_CHANNEL=msedge。完整合成音频评估执行 npm run quality，输出 artifacts/quality。质量门槛见 QUALITY。

## Pages

Settings → Pages 的 source 选择 GitHub Actions。pages.yml 在 main 通过同样检查后构建并发布 dist。Vite 使用相对 base，模型、WASM、插件、字体与文档都从仓库子路径载入。只部署 dist，不部署服务、Key 或用户文件。

插件编译后使用内容摘要命名 ESM。官方目录指向版本化文件；更新新插件时保留旧文件，以免已安装项目失去相关资源。更改已有逻辑需递增相应插件版本，不能只依靠内容散列掩盖语义版本变化。

## Windows 基础包

Windows、Python 3.11+：先 npm run build，再 python scripts/build-local.py。脚本创建独立 .venv-build 构建环境，PyInstaller 生成目录版 Stringcraft.exe，将工作台与本地 worker 包入，ZIP 输出到 artifacts。基础包不包含 Torch/Demucs。完整解压后双击 exe；本机无需预装 Python/Node。

不要删掉 exe 同目录的 _internal。代码与前端固定版本随基础包发布；音乐环境放在 exe 同目录 runtime_plugins。数据位于系统用户应用目录 Stringcraft/jobs，可用 STRINGCRAFT_DATA 覆盖。

## 独立音乐环境

需要官方 uv CLI。执行 powershell -File scripts/build-environment.ps1 -WithModels。

脚本获取可重定位的 Python 3.11 独立发行版，安装固定 CPU Torch/torchaudio、Basic Pitch、HTDemucs、librosa 与 imageio-ffmpeg，保留安装依赖和许可证元数据。WithModels 预下载 HTDemucs 权重；Basic Pitch ONNX 资源随 Python 包。得到 runtime_plugins/local-separation/python、bin、models 与清单。

用户把环境 ZIP 解压到基础包同级后即可发现，无需覆盖 _internal。如未指定 WithModels，HTDemucs 首次使用需要联网；不要称为完整离线包。普通 venv 不可作为可移植运行环境直接分发。环境可能数百 MB 或更大，首次构建时间取决于网络；模型环境与基础包分别发版。

在未安装依赖的测试环境解压并检查：基础包启动、能力查询、整曲识别、分离、取消进程、网络断开后的模型加载，以及重启后用户项目保留。只有经过实际验证的路径可写入发布说明。

## 发布流程

ci.yml 检查每个 PR。pages.yml 发布主分支网页；release.yml 对明确 v 标签构建 Windows 基础包并创建预览 Release，同时提供环境构建的独立 workflow_dispatch。CI 不读取本地 Key、不调用付费模型。

维护者发布前检查差异、第三方许可、质量报告、版本和下载包。0.1.0 只能标记 preview，真人试弹与真实混音门槛未过前不作为稳定版 Latest。不要覆盖历史附件；新环境包应使用新版本名，提供 SHA-256。
