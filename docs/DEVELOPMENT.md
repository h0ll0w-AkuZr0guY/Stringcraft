# 开发指南

## 启动与调试

Node.js 22+：`npm ci`，`npm run plugins:build`，`npm run docs:build`，`npm run dev`。工作台默认端口 5173。修改插件源码后重新执行插件构建，并在插件中心更新或卸载再安装；已安装版本不会被悄悄覆盖。

Python 3.11+：安装 backend/requirements.txt，先 `npm run build`，再 `python -m backend.server`。默认浏览器会打开同来源工作台。本地调试可设置 `STRINGCRAFT_NEURAL_PYTHON` 指向带音乐依赖的 Python，`STRINGCRAFT_PLUGIN_DIR` 覆盖插件目录，`STRINGCRAFT_DATA` 覆盖数据目录。

不要复用 Manus 原电脑路径；不要把完整虚拟环境直接复制进 Git。重计算使用 Python 3.11 独立可移植环境，框架不依赖 Torch。

## 新增算法插件

1. 阅读 SDK v2 音乐结构接口；旧算法适配可复用 NoteEvent，乐器新增使用 InstrumentPluginV2。
2. 在 plugins 下创建独立目录和类型化默认导出，参考 plugins/template。
3. 在 plugins/catalog.source.json 的目录定义加入 id、入口、能力与描述；构建生成带摘要的独立 ESM 与 catalog。
4. 添加至少一个能体现新行为和失败边界的测试，检查宿主仍可在插件未安装时运行。
5. 官方发布构建后，插件中心即可列出并安装。不能要求修改宿主才能识别新目录项；新能力类型或新交互才需要 SDK/应用适配。

## 新增乐器

纯音频分析能力可参考 `plugins/rhythm-analysis`：接受有界解码数组，在 `invoke` Worker 中运行，返回中立的候选结构。波形数据由调用者复用，不能因转移 ArrayBuffer 破坏后续插件。周期相位与小节首拍分开，任何参考参数的自动采用都要通过逐曲退化审查；候选覆盖提升不能替代默认行为的质量证明。

吉他包内部已按职责拆分：types（乐器动作）、voicing-planner（和弦指型路径）、accompaniment（伴奏型）、fingerstyle（主旋律与低音）、inner-voice（稀疏内声部）、hands（持续手指与右手分配）、validation（硬约束）、performance（编配入口与兼容投影）。算法改动先明确落在哪一层；真实参考比较见 [评估协议](REFERENCE_EVALUATION.md)。

written-voices 负责已确认材料与弦位，reference 负责私人参考的发声投影，evaluation 负责吉他声部/弦品/技法/闷音指标。先区分事件来源再决定保留策略，不能用检测候选筛选规则删除用户导入的内声部。每轮先运行固定摘要验收集，新增真实参考要记录开发或留出用途；已用于修正的谱例不能重新标作留出。

录音和改编谱对齐使用 `packages/music/reference-alignment.ts` 与 `scripts/align-reference.mjs`。先记录搜索配置与输入摘要，再用不重叠的短句选参和后续检查；不得用检查段挑选 BPM 或将宽松时差、忽略八度的诊断改名为准确率。最高新起音也可能属于持续旋律下方的伴奏，声部用途要结合记谱与持音关系核对。

用 InstrumentDefinition 描述音域、可选调弦、谱面和技法；用自己的演奏事件扩展 NoteEvent。实现编配、演奏约束与验证样例。尤克里里可以复用弦乐算法并提供调弦与弦数；钢琴需要双手/声部约束，不能复用六线谱品位限制。默认编辑器已支持中立复音事件；新乐器的演奏谱仍需要相应的编辑/谱面适配与注册 UI。

## 新增导出器

复用项目事件而非读取屏幕或文本谱。返回 data、MIME、扩展名；建立能由外部标准读取器解析的回归，尤其检查延音、重音、同音重弹和 tempo。不要凭 MIDI 文件头存在就宣称全部格式正确。

## 给其他 AI 的任务示例

“先阅读 AGENTS 和公共接口，为旋律插件增加重复音起音保护。保持 NoteEvent ID 与秒时序，给出被误合并的最小样本，运行相关音乐测试并比较固定样本。无需修改 API provider 或发布流程。”

“新增尤克里里插件，分别描述重入调弦与低 G，先提供约束测试，再新增乐器选择/编辑适配。当前吉他测试必须保留。接口不够时先说明新增字段与旧项目迁移。”

“新增 MusicXML 导出器，只使用 Arrangement 数据。说明节奏量化误差，测试休止、连线、多声部和变调夹，不把四拍子假设写成识别结果。”

## 验证

`npm run check`、`npm run build`、后端 unittest。首次浏览器测试 `npx playwright install chromium` 后运行 `npm run test:e2e`；Windows 可设置 PLAYWRIGHT_CHANNEL=msedge 使用已安装 Edge。质量样本用 `python scripts/generate-fixtures.py` 生成；算法质量与模型质量分开记录，见 QUALITY。

## 继续开发音符编辑器

先读 [音符编辑器](NOTE_EDITOR.md)。入口是 src/components/NoteEditor.tsx；主机数据与任务在 useWorkbench，持久化在 packages/storage，音符覆盖层在 packages/music/note-edits。卷帘索引/绘制、通用试听和 MIDI 分别在三个独立插件包，不把乐器手型写进它们。

新增识别器实现可选 chunk 回调，分块状态必须可取消。比较模型前固定音频、标注、阈值、块边界与模型摘要；不可把人工改过的数据当留出集。新增训练适配器应独立保存冻结核、训练头、用户纠错记录与版本，并提供恢复旧模型、显式启动和固定留出比较；当前发行版没有在线训练。

浏览器回归针对生产构建：先 npm run build，再 npm run test:e2e。旧吉他流程以 ?view=guitar 进入，新入口使用 note-editor.spec.ts。私人歌曲不进入 CI 或仓库，公开演示只用原创合成 fixture。

本地试用生成调度集中于 packages/music/generate，应用任务反馈由 GenerationFeedback 展示。新增阶段/失败分支必须保持非空且校验后的提交才成功，并覆盖“旧缓存、停用、空结果、提交校验失败、取消/超时不覆盖原谱”。公开发布改为手动，本地试用不得自行推送或触发发布。

本地音频和声入口为 plugins/audio-harmony/pipeline.py，冻结网络适配在 neural.py，上游兼容源码和许可在 btc/。秒区间契约在 packages/contracts/harmony，投影在 packages/music/harmony。不要在改 BPM 时重做音频识别，不要把 N 自动填成前一个和弦。修改输出语义后递增 backend.server.PIPELINE_VERSION，避免复用旧缓存。重计算与 HTTP 服务使用独立 Python。

改识别算法前先读参考评估中的六段逐项失败和未支持类型；这批已用于开发，下一轮需要新的留出录音。不要只为提高覆盖率而补满所有小节，也不要用模型自身输出生成“真值”。在线训练尚未提供，新增纠错学习要保留原冻结核、明确启动/恢复、模型版本和独立留出指标。

local.3 音乐规划改动先定位 `plugins/arrangement-planner`（中立乐句/和声），再定位 `guitar/melodic-position`、`strumming`（演奏动作）。保持原始、来源校正、派生编配三层，不将吉他弦品塞进中立规划。新失败样本应包括音乐关系与实际动作，不能通过静默删除骨干音或放宽跨度过关。规划插件作为内部依赖安装，不增加用户插件数量。

真实改编比较使用 `scripts/evaluate-musical-arrangement.mjs 私人输入清单.json 报告.json [冻结旧模块.mjs]`。清单每项有 id/path，可选 projectOutput；输出逐目标动作诊断及前后项目。没有和弦标注的独奏参考不评伴奏。首 8 小节混合参考请沿用 `evaluate-reference-suite` 的前奏/伴奏分段协议，整段 dropped 不能作为旋律丢失数。已知谱保真、录音识别和主观听感分别报告。音源 A/B 应固定同一动作，编配 A/B 固定同一音源，并统一响度。

用完整模型 Python 运行 `tests/native_melody_check.py` 可验证原创正弦延音跨窗、独立同音重弹与静音/泄漏；不下载资源。采样更新通过 `scripts/prepare-guitar-bank.py` 获取固定 Meta Open Sound 提交与 SHA-256，完整成功后才替换清单。不要按力度混用尼龙手指/拨片奏法，也不要声称有尚未录制的 round-robin 或真连奏。

## local.4 回归入口

新增 `tests/transport.test.ts`、`tests/multitrack.test.ts`、`tests/assets_test.py`，以及浏览器 `multitrack.spec.ts`（长曲 seek/follow、独立校订、手势和节奏谱点击）。`multitrack-native.spec.ts` 仅在显式设置 STRINGCRAFT_TRACK_JOB、指向实际本地任务 JSON 且服务拥有对应资产时执行；报告目录由 STRINGCRAFT_TRACK_REPORT 指定，私人材料不进普通 CI。Windows 可设 PLAYWRIGHT_CHANNEL=msedge。不同 Playwright 进程需指定不同 --output 目录，避免互相清理产物。

本地 worker 0.4.0 在伴奏分离之后转录，旧 0.3 缓存不复用。无在线训练；音乐知识与下一轮可执行评估见 [MUSIC_KNOWLEDGE](MUSIC_KNOWLEDGE.md)。

## 接手续写

从 [AGENTS.md](../AGENTS.md) 进入，按 [架构](ARCHITECTURE.md) 定位模块，再查 [公共接口](REUSABLE_INTERFACES.md) 和 [构建](BUILDING.md)。文档组织参考 MiaoTask 的分层入口和接口手册，Stringcraft 继续维护自己的稳定性约定。[MiaoTask 开发约定](https://github.com/h0ll0w-AkuZr0guY/MiaoTask/blob/main/AGENTS.md) · [MiaoTask 公共接口](https://github.com/h0ll0w-AkuZr0guY/MiaoTask/blob/main/docs/REUSABLE_INTERFACES.md)

桌面生命周期位于 desktop，组件可以在常规 Vite 流程开发。修改 WebView2 桥、保存时机或打印时，从实际解压后的 Windows 包重测。修改音乐约束时增加独立真值与反例，再从整曲、谱面和试听三个入口验证；取样与阈值记录在质量报告和可执行测试中。
