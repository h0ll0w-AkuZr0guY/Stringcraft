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

吉他包内部已按职责拆分：types（乐器动作）、voicing-planner（和弦指型路径）、accompaniment（伴奏型）、fingerstyle（主旋律与低音）、inner-voice（稀疏内声部）、hands（持续手指与右手分配）、validation（硬约束）、performance（编配入口与兼容投影）。算法改动先明确落在哪一层；真实参考比较见 [评估协议](REFERENCE_EVALUATION.md)。

用 InstrumentDefinition 描述音域、可选调弦、谱面和技法；用自己的演奏事件扩展 NoteEvent。实现编配、演奏约束与验证样例。尤克里里可以复用弦乐算法并提供调弦与弦数；钢琴需要双手/声部约束，不能复用六线谱品位限制。当前应用编辑器针对吉他，新乐器需要相应的编辑/谱面适配与注册 UI，这一工作在路线图中明确列出。

## 新增导出器

复用项目事件而非读取屏幕或文本谱。返回 data、MIME、扩展名；建立能由外部标准读取器解析的回归，尤其检查延音、重音、同音重弹和 tempo。不要凭 MIDI 文件头存在就宣称全部格式正确。

## 给其他 AI 的任务示例

“先阅读 AGENTS 和公共接口，为旋律插件增加重复音起音保护。保持 NoteEvent ID 与秒时序，给出被误合并的最小样本，运行相关音乐测试并比较固定样本。无需修改 API provider 或发布流程。”

“新增尤克里里插件，分别描述重入调弦与低 G，先提供约束测试，再新增乐器选择/编辑适配。当前吉他测试必须保留。接口不够时先说明新增字段与旧项目迁移。”

“新增 MusicXML 导出器，只使用 Arrangement 数据。说明节奏量化误差，测试休止、连线、多声部和变调夹，不把四拍子假设写成识别结果。”

## 验证

`npm run check`、`npm run build`、后端 unittest。首次浏览器测试 `npx playwright install chromium` 后运行 `npm run test:e2e`；Windows 可设置 PLAYWRIGHT_CHANNEL=msedge 使用已安装 Edge。质量样本用 `python scripts/generate-fixtures.py` 生成；算法质量与模型质量分开记录，见 QUALITY。
