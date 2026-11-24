# 公共接口手册

SDK v2 的音乐结构定义位于 `packages/contracts/score.ts`；SDK v1 兼容入口位于 `packages/contracts/index.ts`。宿主支持 v1、v2 目录项，不自动覆盖用户已安装的版本。字段以 TypeScript 声明为准。

## SDK v2

- `TimingAnalysis`：波形周期候选、拍点相位和相对证据，始终 `status=unconfirmed`。相位位于一个周期内，不能当成小节首拍。`MusicProject.timingAnalysis` 单独保存结果；`validateTiming` 校验范围和有限值。
- `analyzeTiming(samples,sampleRate,noteProposalBpm?)`：节拍插件的纯计算入口，`invoke` 支持在可取消 Worker 中调用。当前波形实现接受 22050 Hz 单声道 Float32Array，最多 60 秒，短于 4 秒只提示；不修改音符或返回已确认拍号。交叉提议用于评估，不在工作台自动采用。

- `NoteRefinerPlugin<Options>` 与 `loadRefiner`：选择现有候选，返回保留的 NoteEvent[] 和省略原因。乐器/模型专用参数留在插件。`MusicProject.refinement` 单独保存处理结果，原始 `notes` 不改写；项目校验拒绝清理结果伪造音高或起音。

- `MusicalScore`：quarter-note beat 单位的速度图与拍号图、原音频网格偏移、独立声部事件、显式休止、和弦来源与证据、人工段落。识别的秒时间仍保存在 `NoteEvent`。
- `ScoreEvent`：稳定 ID、voice、beat、durationBeats、midi、sourceIds。midi=null 默认为休止，unpitched=true 为无固定音高事件；二者不得同时声明固定 MIDI。`tieFrom` 仅可连接同声部相邻同音；`slurFrom` 表示连奏关系，不自动断言原录音用了何种乐器技法。
- `origin/roleOrigin/activation` 保留事件与声部用途的来源、相对激活值；`eventRole` 优先使用显式角色。`extensions` 只允许分命名空间的基础值，解释权属于插件；吉他包读取 `extensions.guitar.string/fret` 保留已核对弦品，可用 `GuitarOptions.positionSource=optimize` 显式重选。确认的支持声部优先保留，未经核对的检测残留不因此成为和声。
- `soundingEvents` 合并延音链为一次起音，保留真正重弹；`beatToSeconds/secondsToBeat` 使用分段速度图。
- `InstrumentPluginV2<Options,Action,Notation>`：`arrangeScore/validatePerformance/notation/soundEvents/editor`。乐器参数、动作和投影由插件定义。通过 `loadInstrument` 获取，不让通用契约导入吉他或钢琴包。
- `plugins/guitar/performance.ts`：和弦指型序列搜索、动作验证、持续手指、弦占用、扫弦方向与时差、击勾弦连接。`GuitarPerformance.grips` 保存参考指型；`GuitarAction` 保存具体动作。
- `plugins/guitar/evaluation.ts` 分别比较有音高事件、闷音弦号/起音、弦品、声部和技法；`referenceSoundEvents` 要求已核对的参考弦品，按下一次同弦动作归一实际发声释放。`dead` 的兼容 GuitarNote.pitch 仅为弦位占位，不进入音高指标；`notationDurationBeats` 可保留长于噪声衰减的谱面时值。
- `plugins/piano`：最小契约验证例，含手别、键位、指法和跨度；尚无完整编配、踏板声音和工作台 UI。
- `harmony-analysis.analyzeHarmony(notes,score)`：保留人工/导入和弦，只提供有证据的估计；`evidence` 为候选评分差，不是正确概率。`tempoCandidates` 返回相对分数，不能当作原曲速度真值。
- `MusicProject.schemaVersion=2` 必须含 `score`。v1 通过 `upgradeProject` 生成新 ID 的副本，保留 `migratedFrom`、来源、锁定编辑，原对象不变。旧项目的 harmony 角色不会迁移成已确认和弦。
- 兼容的 `arrange` 增加 `goal/score/pattern`。伴奏与指弹走 v2 动作层，单线练习暂沿用 v1 单音搜索。`Arrangement.performance` 保留动作，`notes` 是当前吉他编辑器与音源的秒时间投影。
- MusicXML 导入保留独立 voice、休止、tie/slur、速度/拍号图与支持的和弦性质。导出取当前实际编配，量化到十六分网格；跨小节持续写为延音线，击勾弦写为 technical。装饰音、反复展开、复杂记谱仍需核对。
- MusicXML 导入按 chromatic + octave-change 转为实际发声音高，支持按 staff 指定移调；吉他导出写高八度并声明 octave-change=-1。弦品、无音高事件和技法随谱保留，八度重奏目前只保留主音并提示。依据 [MusicXML transpose 定义](https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/transpose/)。

新增乐器请直接实现 v2 泛型接口。不要复制兼容项目中的 capo 或 GuitarNote 到新乐器事件。

## 音乐与项目

- `AudioReference`：独立录音对照元数据，含完整文件 SHA-256、解码时长、对照起点和 `original/reference` 类别。`sourceAudioSha256` 固定标识浏览器分析输入；只有文件摘要匹配才允许标为 original。重新关联不改写识别来源、原始秒时间或谱面。对照起点只调整录音播放，必须覆盖整个项目。
- `readAudioFile`：在文件大小限制与 60 秒超时内解码并计算摘要，支持取消后丢弃迟到结果；返回可复用 AudioBuffer。`audioAssetKey` 将项目 ID 与文件摘要编码成 IndexedDB 键，保留撤销所需旧文件；`removeProject` 清理该项目的全部关联录音与旧格式缓存，不删除其他项目。

- `NoteEvent`：唯一 id、非负 start、正 duration、MIDI 0–127、可选 cents、velocity 与 score 0–1，source 区分 detected/demo/manual/generated。role 表示 melody/bass/harmony；locked 是人工保护标记。
- `GuitarNote`：增加 string 1–6、fret 相对变调夹、可选 technique。仅为吉他事件，不要求所有乐器使用。
- `Arrangement<N>`：instrumentId、difficulty、capo、transpose、notes、dropped 与 warnings。默认 N 为 GuitarNote；其他乐器可使用不同演奏事件。
- `MusicProject<N>`：兼容 schemaVersion 1 与带 score 的 2，含来源、时长、BPM、beatOffset、sourceOffset、候选、旋律、编配、时间及插件版本。存储前校验；旧 schema 不静默改写。
- `validateNotes`：拒绝重复 ID、非法音高、NaN、负时间、零时长和不支持的来源；最多 100000 音符。
- `validateProject`：当前校验吉他项目及弦位音高关系。扩展乐器需注册相应校验器；禁止绕过校验。
- `fitReferenceGrid`：离线参考评估工具，接受拍/音高参照与录音绝对秒起音，在有界速度/偏移/固定移调范围内只按 selectionBeats 排序；checkBeats 必须不重叠且整段被录音覆盖。返回未确认网格与一对一覆盖诊断，后续段和宽松指标均不参与选参，不代表真实音频准确率，不修改项目。

## 插件

`PluginManifest` 声明 id、name、version、sdk、capabilities、runtime、license、entry、sha256、size、dependencies。id 使用小写字母与连字符。插件接口为默认导出的 `MusicPlugin` 对象：

| 方法 | 契约 |
| --- | --- |
| extractMelody(notes) | 返回引用稳定 ID 的主旋律；不发明 source=detected 的音符 |
| arrange(notes, options) | 接收 difficulty、capo、transpose、bpm、previous；锁定冲突抛错 |
| transcribe(samples, modelUrl, wasmUrl, progress, chunk?) | 单声道 22050 Hz Float32Array；异步返回 NoteEvent，进度 0–1；可选回调接收 TranscriptionChunk 全量快照 |
| analyzeTiming(samples, sampleRate, noteProposalBpm?) | 返回未确认的 TimingAnalysis；证据分数不作概率，拍点相位不作小节首拍 |
| scheduleAudio(ctx, notes, tone, from, to, speed) | 调度播放，返回 origin 和合成回退计数 |
| renderAudio(notes, duration, tone, progress?) | 返回 PCM WAV ArrayBuffer 与回退计数；可选回调报告实际处理秒数/总秒数 |
| planArrangement(context, options) | 可选 SDK v2 能力，返回独立 ArrangementDraft，不修改来源结构 |
| exportFile(project, format) | 返回 data/mime/extension；现有 project/txt/midi |
| advise(settings, candidates, summary, signal) | 候选范围内返回变调夹与简短理由，失败抛错 |

插件宿主的 `catalog/installed/install/enable/uninstall/rollback/load` 均异步。load 尊重停用状态，不自动重装用户卸载项。bootstrap 只在首次安装默认插件；Basic Pitch 与建议插件在首次使用时安装。版本升级由插件中心显式更新。

浏览器插件为自包含 ESM；大型模型作为资源分发。新增插件时向 plugins/catalog.source.json 加入入口与独立版本，不将源码 import 到宿主。不可依赖运行时 Node 内置模块。不要在插件导入时执行网络请求或读取 Key。

## 本地 HTTP v1

同来源请求，`/api/v1/session` 返回短期 token，其余作业请求附 `Authorization: Bearer <token>`。API 不回显密钥或原文件名。

| 请求 | 返回/作用 |
| --- | --- |
| GET /api/v1/capabilities | SDK、安装情况、FFmpeg 与上传上限 |
| POST /api/v1/jobs | multipart file + mode，返回 202 Job |
| GET /api/v1/jobs/{id} | 当前状态、进度、结果或结构化错误 |
| DELETE /api/v1/jobs/{id} | 取消 queued/running 作业；已结束作业保持原状态 |

mode 为 transcribe、vocals、instrumental。结果包含 duration、bpm、notes、method 和 limitSeconds。未知作业 404、缺认证 401、跨来源 403、环境未装或已有任务 409、超文件上限 413。当前最多 30 分钟输入解码。

## 通用音符编辑能力（0.2 可选扩展）

`note-view` 能力提供 `noteView.index(notes): NoteSpatialIndex`，查询秒范围与 MIDI 范围；`noteView.paint(ctx, window, visibleNotes, selectedIds)` 只绘制可见事件。不得修改输入或读取项目存储。Window 以秒和音高描述，像素换算由绘制插件负责。

`note-renderer` 提供 `scheduleNotes(ctx, notes, from, to, speed): {origin, stop}` 和 `renderNotes(notes, duration): Promise<ArrayBuffer>`。stop 必须释放定时调度与音频节点；WAV 为 PCM16 单声道。`exporter` 可提供 `exportNotes(notes, bpm): Uint8Array`，不要求 Arrangement。

`TranscriptionChunk` 含 notes、processedSeconds、complete；notes 是截至当前已处理范围的快照，不是增量。同一事件 ID 在跨块延音更新后保持稳定；新起音使用新 ID。调用者负责把快照写入原始层，并保留 noteEditor。无 chunk 回调的旧片段调用继续兼容。

`NoteEditorState` 包含 base、commands、cursor、filter。changes 中 null 表示删除，before 记录编辑时的材料；撤销按 cursor 应用覆盖层，原始结果继续更新。`commitNotes`/`correctedNotes`/`filteredNotes` 是可复用的纯数据操作；导入与持久化必须通过 validateProject。旧 v1/v2 项目可不含这些字段，无需强制迁移。

MusicProject.transcription 保存 jobId、运行状态、processedSeconds、插件版本/代码摘要及可选模型摘要。导入 running 项目标记为 stopped，不能伪装为完整结果。complete 必须覆盖项目完整时长。

## 本地试用生成扩展

MusicPlugin 可选 `recommendCapos(notes, options): {capo,score}[]`，复用 ArrangeOptions；标准吉他 0.2.3 根据目标调用自身候选规则。宿主 invoke 允许 analyzeHarmony 与 recommendCapos，通过同一可取消 Worker 执行，不在 React 主线程搜索指型。旧插件不会自动覆盖，生成前识别版本/摘要差异和停用状态，由用户明确点击“修复所需插件”处理。

runGeneration 返回已校验的新项目、所选变调夹和建议文字，不直接修改传入项目。GenerationError 提供 plugins/structure/upgrade/retry 恢复入口；插件问题区分 missing/disabled/update。界面阶段使用不定进度与耗时，不编造百分比。

本地 GET /api/v1/capabilities 增加 appVersion 与 buildSha，来自包内 dist/build-info.json；原字段兼容。启动器发现端口占用时，只复用版本和构建标识均相同的 Stringcraft 服务，否则提示退出，不静默打开旧程序。

## 秒时间轴与本地和声

HarmonyAnalysis 保存独立 start/end 秒区间、supported/candidate/none、候选和实际 ModelExecution。MusicProject.harmonyAnalysis/localAnalysis 均可选，旧项目兼容；validateHarmony 验证范围、次序、状态。projectHarmony 将其投影为 ChordSymbol，人工/导入和弦覆盖候选。analyzeTimeline 是固定秒窗的基础插件入口，未经过分离时明确注明来源。

本地 jobs 增加 accompaniment 模式、offset/seconds，返回 notes、harmonyAnalysis、executions。任务先回传原始音符，再执行分离/和声；缓存按源摘要、范围和管线版本区分。完成任务的 assets 接口只允许预定义声部与和声 JSON，并使用本机会话认证。capabilities.engine 返回实际探测的 ready/device/models，promoted=false 表示仍为实验。项目不保存认证 token 或绝对路径。

插件目录 audience/maturity/bundle 是可选兼容字段；普通中心只展示 user 项，不将示例当成可用乐器。

## local.3 音乐规划扩展

`ArrangementPlanningContext` 包含来源 score、sourceKind、inputFingerprint 和可选 melodyCandidates/melodyEvidence。候选按秒描述，规划时使用 score 的速度图转拍。`ArrangementPlanningOptions` 包含 goal、difficulty、pattern（strum/arpeggio/auto）。`ArrangementDraft` 保存版本、来源修订、派生 score、互不重叠的 phrases、决策来源 ID 和和弦种类/区间/旋律骨干统计。使用 validateArrangementDraft 校验。插件通过可选 planArrangement 暴露，普通用户列表无需增加内部算法卡片。

MusicProject 可选 arrangementDraft、melodyEvidence；旧项目省略即可，不强制迁移。ChordSymbol.origin 增加 generated，必须和 estimated/manual/imported 区分。ArrangeOptions 可选 phrases 由乐器包解释；固定 strum/arpeggio 调用兼容。GuitarNote.articulation 是吉他投影扩展，包含可选 releaseSeconds/damp/sustainOffset，不得强加给钢琴。

`arrangementRevision(project)` 覆盖来源音符、编辑、精修、来源 score、速度/偏移和人声证据，排除输出与时间戳。生成后保存来源 score 及对应标识；输入改变时派生编配失效。它不是内容完整性摘要，文件来源仍使用 SHA-256。不要用派生 draft.score 覆盖来源 score，也不要将自动编配和声算成识别准确率。

本地 accompaniment 结果可选 melodyEvidence，pipeline 0.3.1 缓存键独立于 local.2。执行记录分别报告 HTDemucs/BTC GPU 或 CPU、Basic Pitch CPU、pYIN CPU，没有新增训练接口。

`packages/music/maintenance` 提供 `workbenchComponentProblems/repairWorkbenchComponents`，按工作台必需的内部模块集合比较安装、启用状态和代码摘要。修复只能由用户明确点击触发，沿用宿主的验证与事务安装；不修改作品，不安装钢琴示例或其他可选算法。分析前检查旧组件并给出修复入口，避免旧插件缺少新方法时在推理结束后才报错。

## local.4 接口增量

`MusicProject.tracks?: ProjectTrack[]` 是兼容扩展：id/name/role/notes，及可选 asset、noteEditor、score、melodyEvidence、harmonyAnalysis、analysisRevision。`AudioAssetRef` 包含 id=sha256、duration/sampleRate/channels/offsetSeconds。`Arrangement.sourceTrackIds` 记录实际来源。没有 tracks 的 v1/v2 项目投影成 legacy，不伪造分离。`projectTracks/editorTrackProject/commitTrackNotes/changeTrackEditor/arrangementTracks` 隔离轨道选择、编辑与编配路由。

`Transport` 提供 subscribe/snapshot、play(driver)、pause、stop、seek、setSpeed、setLoop、dispose。driver(from,to,speed,current,signal) 返回 position()/stop()；current() 判断异步加载是否过期。秒为项目时间；pause 续播，stop 归零；loop 外 seek 清除循环。`scheduleNotes/scheduleAudio` 新增可选 atTime；`prepareAudio` 先加载采样再统一起音。旧参数调用保持兼容。

`ScoreHit` 返回稳定 noteIds 和 startSeconds/endSeconds；`ScoreViewAdapter` 定义 hitTest 与 locate。卷帘采用空间索引、TAB 按小节列几何反算、alphaTab 使用 beat/note bounds，均送交共享 transport。鼠标编辑手势超过阈值不触发试听。

本地 API：GET assets/{sha256}；POST assets/references（projectId/assetIds）；DELETE assets/references/{projectId}；POST jobs/from-asset（assetId/operation=vocal-melody|transcribe/可选 backingAssetId）；POST project-bundles（project）；POST project-bundles/import（file）。全部需要会话认证。ZIP 最多 2 GB 展开、64 条音频，拒绝重复条目、任意路径和摘要不符。asset 不是服务器路径。

`ArrangementDraft.assessment?: MusicAssessment` 记录风格、保护 ID、发现和六张来源规则卡。`music-constraints.assessMusic` 为纯函数；规划器实际保护上下文支持的短经过音及句尾。原始材料、人工校订及持音链继续优先。规则卡的阈值是工程启发式，不能当作教材原文或正确率。
