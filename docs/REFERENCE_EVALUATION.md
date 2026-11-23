# 真实曲谱对照与约束校准

按用户要求，以真实曲谱对照作为持续改进的主要验收，真人试弹可作为补充。目标是改进音乐与演奏动作，不以自动指标声称已经得到真人听感认可。

## 固定任务与指标

| 层 | 输入与参照 | 指标 | 禁止的替代 |
| --- | --- | --- | --- |
| 音频识别 | 同一录音、对齐的音高/起音/时长标注 | 一对一音高与起音 F1、时长误差、重复起音与漏检 | 用已知谱输入的保真度声称音频准确率 |
| 和声 | 同版本的和弦区间与实际输出声音 | 区间覆盖、根音/性质一致、实际发声的和弦内音占比 | 只检查传入的和弦名字与自己相等 |
| 旋律/声部 | 已知谱中的明确声部、独立低音与休止 | 逐音保留、起音/延音误差、声部遗漏 | 把所有候选当主旋律，或用多加音符提高召回 |
| 演奏动作 | 实际弦位、连奏关系和同弦释放 | 四指、跨度、同弦占用、持续手指、右手冲突；技法连接 | 以音符数代表难度，或拟合时放松硬约束 |
| 风格 | 明确是弹唱伴奏、前奏 riff 或独奏指弹的参照 | 每小节动作、和弦大小、留白、声部层次与技法对照 | 要求简化伴奏逐音复制高难指弹谱 |

`compareNotes` 使用最大一对一匹配，额外重复预测降低 precision。时长误差与起音 F1 分开。弦位与参考不同可以仍然可弹，因此弦位一致率只作为软偏好指标，硬动作验证独立报告。

## 第一轮实测

### GuitarSet 真实演奏标注

来源为 [GuitarSet 1.1.0 原始发布](https://zenodo.org/records/3371780)，CC-BY-4.0；作者 Qingyang Xi、Rachel M. Bittner、Johan Pauwels、Xuzhou Ye、Juan P. Bello，ISMIR 2018。标注包含自动与人工步骤，不是所有字段都有独立人工真值。已按原站 [Issue 4](https://github.com/marl/GuitarSet/issues/4) 和 [Issue 5](https://github.com/marl/GuitarSet/issues/5) 排除三份已知问题记录。

冻结任务：独奏标注按 30 ms 起音分组取最高音，得到固定的单线指位任务。该投影没有被当成人工确认的主旋律。演奏者 00–03 为训练，04 为验证，05 为留出测试；180 条独奏、15,996 个投影音符，测试组 30 条、2,159 音符。原始 360 记录的压缩包 MD5 与官方值一致。

预先固定 60 组软偏好参数；训练组筛选前十组，验证组选择，留出组只评价。参数只涉及品位、移动、换弦与开放弦偏好；弦位音高、最高品、跨度、四指和同时动作规则不从此任务学习。

| 留出组指位任务 | 参考弦位一致率 |
| --- | --- |
| 原始软偏好 | 30.43% |
| 校准候选 | 36.13% |

完整聚合统计、输入摘要与参数见 [校准记录](../benchmarks/guitarset-calibration.json)。这不是音频识别准确率，也不是编配质量总分。

### 《晴天》出版谱首 8 小节

来源为 [Steven Law 原站独奏改编谱](https://stevenlawguitar.com/wp-content/uploads/2015/11/e699b4e5a4a9.pdf)。本地对照只使用该版本：前四小节为前奏分解 riff，后四小节为和弦织体；人工按可见六线谱与节奏梁录入，原 PDF 与完整音符不进入仓库。标注仍需第二次独立复核。原谱未确认录音速度，对照中的 120 BPM 仅用于拍到秒的投影；没有与用户原曲录音对齐。

首轮结果：前奏已知谱输入的音高/起音 F1 为 1.0，两个击弦连接保留，硬动作错误 0；日常和弦伴奏实际发声音的和弦内音占比为 1.0，硬动作错误 0。它证明的是已知谱的处理行为，不能证明从混音识别该谱的能力。

校准候选在该前奏的参考弦位一致率从 60.0% 降至 54.29%。因此候选保持 `experimental-manual-only`，默认继续使用原始软偏好。不能因一个数据集的分数提高就全局启用。聚合报告见 [首 8 小节对照](../benchmarks/qingtian-first8.json)。

### 真实录音识别基线

另从官方音频 ZIP 按字节区间取得演奏者 05 的 6 段麦克风录音，覆盖 Singer-Songwriter、Rock、Bossa Nova 的伴奏和独奏。每个完整 WAV 校验 ZIP CRC32 并记录 SHA-256；没有下载完整音频 ZIP，因此不声称核验了整个 ZIP 的 MD5。每段取前 30 秒，用全部多音高标注比较浏览器实际 Basic Pitch 输出，没有把“最高声部投影”当作旋律真值。

固定 50 ms 一对一起音/音高 F1 中位数为 0.8153，范围 0.6293–0.8713；慢速伴奏表现明显较弱。100 ms 只作诊断。该小样本代表纯吉他录音，不能推广成商业歌曲混音准确率。聚合基线与逐录音指标见 [真实录音记录](../benchmarks/guitarset-audio-baseline.json)。后续清理参数必须使用独立训练/验证演奏者选择，保留本组作为固定对照。

《晴天》手工标注另经过 PDF 文本字形的自动复核：按实际 TAB 行和绘制的小节线读取顺序弦品，首 8 小节共 219 个音符全部一致，见 [字形复核](../benchmarks/qingtian-glyph-audit.json)。该复核没有证明节奏、声部或原录音对齐，不能扩大为完整标注审阅。

## 第二轮实测

### 已有谱的声部与技法保真

继续使用同一 Steven Law 版本，增加第 9–16、25–32 小节。后者这里只称“带闷音的段落”，尚未依据原录音确认正式的副歌边界。第 9–16 小节的 105 个弦品字形、第 25–32 小节的 148 个弦品/闷音 X 字形全部通过独立 PDF 文本几何复核；节奏与声部仍是单次视觉标注，不能把字形复核扩大成完整审阅。见 [分段字形复核](../benchmarks/qingtian-section-glyph-audit.json)。

| 已知谱处理 | 第 9–16 小节 | 第 25–32 小节 |
| --- | --- | --- |
| 延音合并后的有音高起音 | 101/101 保留 | 122/122 保留 |
| 明确闷音动作 | 不适用 | 16/16 保留 |
| 标注的击勾弦连接 | 8/8 保留 | 无标注连接 |
| 参考弦品一致率 | 100% | 100% |
| 同弦释放后的发声时长误差 | 0 | 0 |
| 动作硬错误 | 0 | 0 |

这些结果来自已有弦品与声部输入，证明导入后能保留材料；没有证明算法能从录音发现这些声部或自行创作相同编配。弦品一致率也不意味着这一指法唯一或适合每位演奏者。完整聚合见 [主歌对照](../benchmarks/qingtian-verse8.json)和[闷音段对照](../benchmarks/qingtian-chorus8.json)。

同版本消融把已确认的支持声部故意降为未确认检测候选，其他规则不变：两段有音高 F1 分别降至 0.7758、0.5977，独立低音和内声部召回都为 0。这是来源保留层的消融，不能写成相对历史版本的音频识别提升。新规则只优先保留人工或导入材料，仍拒绝把未经核对的检测残留自动堆成和声。

闷音以无固定音高事件保存，与普通休止区分。评估按弦号和起音匹配，不拿兼容六线谱投影中的占位 MIDI 音高计分。短噪声衰减与谱面时值分开保存；试听为噪声近似，MIDI 为侧击音替代。延音线、击勾弦、同音重弹分别处理。

### 固定参考验收集

[验收清单](../benchmarks/qingtian-suite.json)固定三组输入的 SHA-256、用途和门槛；[当前结果](../benchmarks/qingtian-suite-result.json)三组通过。完整商业谱标注仅存在本地，因此该集需准备合法私人输入后运行，普通 CI 使用原创回归短句。清单标记均为 development，这些谱例已经参与规则修正，不能再当作独立留出组。

```powershell
node scripts/evaluate-reference-suite.mjs benchmarks/qingtian-suite.json artifacts/quality/score-suite
```

参考摘要不一致会停止执行，门槛失败返回非零退出码。不得为了通过测试更新参考摘要或降低门槛；标注纠错需单独解释证据，规则更新需补相应最小反例。每轮先固定参照、切分和指标，再用训练与验证组选软参数；硬演奏规则保持不变，最后只评价未参与调参的留出素材。平均提升但个别风格退化超限的候选保持实验状态。

### 用户《晴天》录音诊断

浏览器实际分析前 30 秒，得到 338 个原始候选、102 个旋律候选；初学和弦伴奏 68 个发声事件，导出成功、外部上传为 0。它只是流程检查，不能报告音符准确率。

固定在 60–180 BPM、0–4 秒起点范围搜索，只用已知 riff 前两小节的音高与检测起音选网格，后两小节作同录音延续检查。最佳候选 68.25 BPM、起点 0.78 秒：选网格的前段匹配 17/17，后段 14/18，后段匹配起音平均偏差约 20 ms。工作台原提议为 145 BPM、起点 0，仍标为未确认。见 [录音对齐诊断](../benchmarks/qingtian-recording-alignment.json)。

这项拟合可能同时拟合检测误差，不能充当人工对齐真值；参照改编与原曲也可能不同。当前记录为 `unconfirmed`，不写回产品默认速度。下一轮优先修复节拍候选与首拍估计，再建立独立对齐标注，避免把节拍偏差误算成音高识别或指法问题。

```powershell
node scripts/align-reference.mjs artifacts/reference-corpus/qingtian/first8.json artifacts/private-recording-project.json artifacts/quality/qingtian-recording-alignment.json
```

### 独立波形节拍插件与跨曲目检查

新增无模型依赖的 `rhythm-analysis` 插件，以短时频谱的正向变化检测起音，再用自相关提供周期与拍点相位。方法依据 [Ellis 的节拍跟踪研究](https://www.ee.columbia.edu/~dpwe/pubs/Ellis07-beattrack.pdf)和 [librosa 的节奏分析说明](https://librosa.org/doc/latest/auto_tutorials/01-intro/06-rhythm.html)中的起音/周期思路；本实现只提供固定周期候选，没有声称实现完整动态节拍或小节重音识别。FFT 与信号处理为仓库内实现。

开发集沿用演奏者 00、04 的 12 段录音；另冻结 Funk1-114、Jazz2-187、BN2-131 的伴奏/独奏六段，分别来自演奏者 01、03、02，与开发集曲目不同。音频逐文件校验，名义 BPM 与拍点取原始 JAMS。它们是点击网格参照，不等于独立人工标注的自由演奏首拍。

| 指标（相对 BPM 误差不超过 4%） | 开发 12 段 | 跨曲目留出 6 段 |
| --- | --- | --- |
| 旧音符间隔估计，首选命中 | 4 | 2 |
| 旧估计，前五个含参照速度 | 6 | 4 |
| 波形估计，首选命中 | 6 | 1 |
| 波形估计，前五个含参照速度 | 11 | 6 |
| 交叉提议，首选命中 | 4 | 3 |

候选覆盖改善，最高分周期仍可能落在倍速或三连音层级。交叉提议在一段 Jazz 伴奏中从 170 BPM 改到约 60.45 BPM，参照为 187 BPM，单项误差明显恶化。复核发现仅看命中次数的门槛不够，因此加上单段相对误差增加不能超过 0.03 的审查；没有继续用这批留出结果调参。两组均未通过自动采用门槛，产品只提供试听与人工选用，默认速度仍沿用原流程。逐段名义拍点 F1 与相位误差分开记录在 [开发结果](../benchmarks/timing-development.json)和[留出结果](../benchmarks/timing-heldout.json)，不以速度命中替代拍点准确率。

用户《晴天》前 30 秒的实际浏览器流程给出 68.5116 BPM、拍点相位 0.7779 秒候选，与已知 riff 的独立拟合接近。界面可叠加滴答声后手动采用；仍不自动认定小节首拍或真实音符真值。另新增六段实际 Basic Pitch 运行，识别 F1 见 [跨曲目录音基线](../benchmarks/guitarset-audio-additional.json)。累计真实识别流程覆盖 24 个授权录音。

```powershell
python scripts/prepare-timing-corpus.py artifacts/reference-corpus/guitarset/annotation.zip artifacts/reference-corpus/guitarset/audio-timing-heldout/manifest.json artifacts/reference-corpus/guitarset/timing-heldout.json
$env:STRINGCRAFT_TIMING_CORPUS='artifacts/reference-corpus/guitarset/timing-heldout.json'
$env:STRINGCRAFT_TIMING_NOTES='artifacts/quality/reference-predictions-timing-heldout.json'
$env:STRINGCRAFT_TIMING_LABEL='heldout'
npx playwright test tests/e2e/timing-quality.spec.ts
```

这些资料在本轮审查后已使用，下一轮选择新算法或参数需再准备新的留出曲目。曾尝试在周期附近做脉冲拟合，开发集前五候选覆盖从 11/12 降至 10/12，未进入产品实现；保留失败原因，避免只报告平均改善。

## 基础复现

先将官方 `annotation.zip` 下载到忽略的 artifacts 目录；脚本会核对官方 MD5。普通 CI 不下载大型语料。

```powershell
python scripts/prepare-guitarset.py artifacts/reference-corpus/guitarset/annotation.zip artifacts/reference-corpus/guitarset/prepared.json
node scripts/calibrate-fingering.mjs artifacts/reference-corpus/guitarset/prepared.json artifacts/quality/fingering-calibration.json
node scripts/evaluate-reference.mjs artifacts/reference-corpus/qingtian/first8.json artifacts/quality/qingtian-reference-first8.json
python scripts/fetch-guitarset-audio.py artifacts/reference-corpus/guitarset/annotation.zip artifacts/reference-corpus/guitarset/audio
$env:STRINGCRAFT_REFERENCE_AUDIO='artifacts/reference-corpus/guitarset/audio/manifest.json'
npx playwright test tests/e2e/reference-audio.spec.ts
```

曲谱对照命令需要本地私人参考标注，不在仓库中分发。格式含 source（版本、来源链接、摘要、审阅状态）、MusicalScore、可选参考 GuitarNote[]。多声部例设置 evaluationGoal；缺少 reference 时从核对过的弦品、延音与连奏关系投影。评估输出只含聚合误差与小节统计，仍需检查后再公开。

## 下一轮的条件

### 候选清理校准结果

对演奏者 00（训练）、04（验证）、05（留出）各 6 段真实录音建立冻结的浏览器候选缓存，搜索 76 组筛选参数。指标为每段逐音 F1 的宏平均，训练组选前十组并加入恒等基线，验证组选择且要求每段下降不超过 0.03。原始候选不改写，清理只选择已有 ID。

校准候选在留出组的宏平均 F1 从 0.7888 提升至 0.8359；一段 Rock 和弦伴奏从 0.8396 降到 0.8079，下降 0.0317，未通过预设退化门槛。因此弱音清理插件只作为默认关闭的实验选项，不能宣称获得了全面提升。原候选完整保留，便于关闭后对照。参数、各段结果与摘要见 [清理校准记录](../benchmarks/refinement-calibration.json)。

```powershell
node scripts/calibrate-refinement.mjs artifacts/quality/reference-predictions-development.json artifacts/quality/reference-predictions-heldout.json artifacts/quality/refinement-calibration.json
```

其中 development 来自演奏者 00、04 的实际录音运行，heldout 来自 05。首次看到留出组退化后不再用该组挑选新参数；下一轮模型或规则开发需要新的留出录音与跨曲目验证。

补齐《晴天》主歌、副歌的对应版本段落与其他曲目的留出谱例，分开比较伴奏、riff 与指弹。先固定对齐、允许的移调/变调夹与声部定义，再修改参数。保留失败候选与消融结果；测试集不参与反复挑参。所有新约束必须同时通过原创最小反例和真实参考比较，跨风格退化时保留为实验候选或按验证过的场景使用。
