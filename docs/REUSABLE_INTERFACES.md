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

- `NoteEvent`：唯一 id、非负 start、正 duration、MIDI 0–127、可选 cents、velocity 与 score 0–1，source 区分 detected/demo/manual/generated。role 表示 melody/bass/harmony；locked 是人工保护标记。
- `GuitarNote`：增加 string 1–6、fret 相对变调夹、可选 technique。仅为吉他事件，不要求所有乐器使用。
- `Arrangement<N>`：instrumentId、difficulty、capo、transpose、notes、dropped 与 warnings。默认 N 为 GuitarNote；其他乐器可使用不同演奏事件。
- `MusicProject<N>`：兼容 schemaVersion 1 与带 score 的 2，含来源、时长、BPM、beatOffset、sourceOffset、候选、旋律、编配、时间及插件版本。存储前校验；旧 schema 不静默改写。
- `validateNotes`：拒绝重复 ID、非法音高、NaN、负时间、零时长和不支持的来源；最多 100000 音符。
- `validateProject`：当前校验吉他项目及弦位音高关系。扩展乐器需注册相应校验器；禁止绕过校验。

## 插件

`PluginManifest` 声明 id、name、version、sdk、capabilities、runtime、license、entry、sha256、size、dependencies。id 使用小写字母与连字符。插件接口为默认导出的 `MusicPlugin` 对象：

| 方法 | 契约 |
| --- | --- |
| extractMelody(notes) | 返回引用稳定 ID 的主旋律；不发明 source=detected 的音符 |
| arrange(notes, options) | 接收 difficulty、capo、transpose、bpm、previous；锁定冲突抛错 |
| transcribe(samples, modelUrl, wasmUrl, progress) | 单声道 22050 Hz Float32Array；异步返回 NoteEvent，进度 0–1 |
| analyzeTiming(samples, sampleRate, noteProposalBpm?) | 返回未确认的 TimingAnalysis；证据分数不作概率，拍点相位不作小节首拍 |
| scheduleAudio(ctx, notes, tone, from, to, speed) | 调度播放，返回 origin 和合成回退计数 |
| renderAudio(notes, duration, tone) | 返回 PCM WAV ArrayBuffer 与回退计数 |
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
