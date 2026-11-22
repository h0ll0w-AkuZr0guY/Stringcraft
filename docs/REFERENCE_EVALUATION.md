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

## 复现

先将官方 `annotation.zip` 下载到忽略的 artifacts 目录；脚本会核对官方 MD5。普通 CI 不下载大型语料。

```powershell
python scripts/prepare-guitarset.py artifacts/reference-corpus/guitarset/annotation.zip artifacts/reference-corpus/guitarset/prepared.json
node scripts/calibrate-fingering.mjs artifacts/reference-corpus/guitarset/prepared.json artifacts/quality/fingering-calibration.json
node scripts/evaluate-reference.mjs artifacts/reference-corpus/qingtian/first8.json artifacts/quality/qingtian-reference-first8.json
python scripts/fetch-guitarset-audio.py artifacts/reference-corpus/guitarset/annotation.zip artifacts/reference-corpus/guitarset/audio
$env:STRINGCRAFT_REFERENCE_AUDIO='artifacts/reference-corpus/guitarset/audio/manifest.json'
npx playwright test tests/e2e/reference-audio.spec.ts
```

最后一条需要本地私人参考标注，不在仓库中分发。格式含 source（版本、来源链接、摘要、审阅状态）、MusicalScore、参考 GuitarNote[]。评估输出只含聚合误差与小节统计，仍需检查后再公开。

## 下一轮的条件

### 候选清理校准结果

对演奏者 00（训练）、04（验证）、05（留出）各 6 段真实录音建立冻结的浏览器候选缓存，搜索 76 组筛选参数。指标为每段逐音 F1 的宏平均，训练组选前十组并加入恒等基线，验证组选择且要求每段下降不超过 0.03。原始候选不改写，清理只选择已有 ID。

校准候选在留出组的宏平均 F1 从 0.7888 提升至 0.8359；一段 Rock 和弦伴奏从 0.8396 降到 0.8079，下降 0.0317，未通过预设退化门槛。因此弱音清理插件只作为默认关闭的实验选项，不能宣称获得了全面提升。原候选完整保留，便于关闭后对照。参数、各段结果与摘要见 [清理校准记录](../benchmarks/refinement-calibration.json)。

```powershell
node scripts/calibrate-refinement.mjs artifacts/quality/reference-predictions-development.json artifacts/quality/reference-predictions-heldout.json artifacts/quality/refinement-calibration.json
```

其中 development 来自演奏者 00、04 的实际录音运行，heldout 来自 05。首次看到留出组退化后不再用该组挑选新参数；下一轮模型或规则开发需要新的留出录音与跨曲目验证。

补齐《晴天》主歌、副歌的对应版本段落与其他曲目的留出谱例，分开比较伴奏、riff 与指弹。先固定对齐、允许的移调/变调夹与声部定义，再修改参数。保留失败候选与消融结果；测试集不参与反复挑参。所有新约束必须同时通过原创最小反例和真实参考比较，跨风格退化时保留为实验候选或按验证过的场景使用。
