# 音乐知识与可执行约束

知识来源用于限定编配的语境，不能把数值门槛说成教材定律。当前提供流行伴奏、流行指弹、单线练习三种配置。古典四部和声的平行五度禁则不作为这些配置的全局硬限制。识别出的罕见和弦也可能正确，不能据“17 种太多”设数量上限。

## 已接入的规则

`plugins/music-constraints` 保存六张规则卡，每张包含出处、章节或视频时间点、适用范围、正反例、例外、硬/软性质和实际实现位置。`assessMusic` 在编配规划 Worker 中执行，结果保存在 `arrangementDraft.assessment`，可在谱面“编配依据”展开。

| 规则 | 实际作用 | 验证边界 |
| --- | --- | --- |
| 和声节奏 | 提示短和声候选；现有序列拟合兼顾持续时间、局部调性、旋律和功能解决 | 不把和弦更少当准确率更高 |
| 非和弦音 | 保护前后级进支持的弱拍经过音和辅助音，不因短时长直接删去 | 需连续、无休止、候选强度支持；不自动认定所有短音正确 |
| 乐句呼吸 | 保护尾音和显式休止，段落优先于四小节建议 | 自动分句只是编配假设 |
| 扫弦动作 | 小节内运动网格、弦组与动作验证 | 复合拍独立节奏型；不推广到弗拉门戈等其他风格 |
| 指弹声部 | 人声轨旋律、器乐和声与结构低音分工，内声服从持续占弦 | 识别错误仍可能进入编配；不能据可弹性推断听感优秀 |
| 连音准备 | 同弦、前音、连接时间及动作范围检查；延音只激励一次 | 没有实录击勾弦组，当前连音声音仍为近似 |

新增回归包含：短经过音的保留；孤立跳音不误判为经过音；休止隔断；独立轨道编辑；原始材料不变。原有换和弦不重启节奏、延音不重弹、锁定冲突、持续占弦和真实参考谱测试继续保留。

## 书、课程与项目的学习路线

| 来源 | 可核查内容及状态 | 后续约束与评估任务 |
| --- | --- | --- |
| [Open Music Theory 第二版](https://viva.pressbooks.pub/openmusictheory/) | 开放教材目录及章节；关注节奏、流行和声、曲式 | 为乐句、动机、终止和借用和弦建立分别适用的反例；不用一套规则覆盖所有风格 |
| [Music Theory for the 21st-Century Classroom：和声节奏](https://musictheory.pugetsound.edu/mt21c/HarmonicRhythm.html) | 已查阅网页 | 同旋律、多种合理和声节奏比较；保护真实属功能解决 |
| [同教材：非和弦音](https://musictheory.pugetsound.edu/mt21c/NonChordTonesIntroduction.html) | 已查阅网页 | 分别扩展倚音、延留、先现音；每类加入支持与排除条件后再启用 |
| [Joe McMurray 指弹编配第二版试读](https://joemcmurray.com/wp-content/uploads/2023/09/Arranging-for-Fingerstyle-Guitar-2nd-Ed-Watermark-2023.09.05.pdf) | 只有公开 11 页试读及目录，未取得全书 | 按旋律与低音、内声、交替低音、分解组合分层练习，建立有标注的原创短谱 |
| [William Leavitt / Berklee：A Modern Method for Guitar 1](https://www.halleonard.com/product/137387/a-modern-method-for-guitar-volume-1) | 仅出版方资料，未取得付费正文 | 后续取得授权内容再提取把位、读谱与指法练习；当前不据此声称已验证规则 |
| [JustinGuitar 扫弦课程视频](https://www.youtube.com/watch?v=CjM5fyXoV8w) | 已核查说明与章节：02:14 练习、07:19 变化；未逐帧观看 | 连续运动、空挥与重音的原创示范，逐小节试听对照 |
| [JustinGuitar Folk Fingerstyle](https://www.justinguitar.com/modules/folk-fingerstyle) | 课程索引，详细示范待核查 | 交替低音、右手分工、音符持续和旋律突出，不能只统计发音数量 |
| [Berklee Arranging for Songwriters](https://www.youtube.com/watch?v=hDWeq19Kot0) | 课程参考入口，具体内容待细读 | 主旋律与伴奏功能、乐段能量与织体；有例证后才启用自动改写 |
| [hear-score](https://github.com/LiRenTech/hear-score) | 已读 README 及卷帘跟随代码；Apache-2.0 | 借鉴浏览器卷帘、逐音交互和手动浏览暂停跟随；它本身不提供声源分离 |
| [alphaTab](https://docs.alphatab.net/docs/features/interact/reacting-to-beat-and-note-clicks) | 已用现有 1.9.0 类型与实现核查点击及边界查询 | 实际谱面几何映射到稳定音符 ID 和秒时间；不能另开一套播放时钟 |
| [music21](https://github.com/cuthbertLab/music21) | 独立评估工具候选，未接入运行环境 | 独立环境核对时值、声部和分析结果；新版 Python 要求与模型环境不同，不升级现有 Torch 环境来迁就它 |

引用只提供检索与审计依据，不分发教材、视频、付费谱件或私人歌曲。未来加入视频知识前记录实际观看时间段、原创正反例和可测试的推断。

## 迭代与约束学习

1. 先固定参考谱版本、录音范围、节拍对齐与摘要；区分同曲不同编配。
2. 参考谱输入与录音输入分开评估：前者检验编配保真及可弹性，后者另测起音、音高、和弦区间与声部分离。
3. 单独报告旋律骨干保留、低音支撑、休止保留、持续音重复激励、换和弦动作、跨度及密度；不合成一个“音乐质量百分比”。
4. 数值门槛在开发集调整，验证集选择配置，留出曲目只验收；保留逐曲退化。`benchmarks` 与已有 `evaluate-reference-suite.mjs`、`evaluate-musical-arrangement.mjs` 是现成入口。
5. 校订记录可作为后续约束偏好数据，但当前没有在线训练或权重更新。只有在跨曲留出评估通过后才提升算法默认等级。

后续优先级：人声旋律的连续性与重复起音；指弹旋律/低音独立保持；句尾和终止；风格化扫弦音源。不要先堆更多神经网络或扩大插件卡片数量。

## local.5 可试的约束

| 听感问题 | 乐句实验的处理 | 验证材料 |
| --- | --- | --- |
| 经过音触发短促换和弦 | 弱候选结合低音持续和前后和声，保留人工和弦与真实属解决 | GuitarSet 标注与明确的短和声正反例 |
| 同一音节断成多个音或滑成八度 | pYIN 的弱证据短间隙需有声音支持。短八度偏移需要两侧同音，重弹需要 Basic Pitch 起音和能量低谷 | 已知音高、重弹及休止夹具。pYIN 负责基频证据，乐句解码是 Stringcraft 自己的后处理 |
| 扫弦像同时按键 | 3/4 独立处理，短刷使用连续可发声弦组，刷弦速度、强弱和段落收束各自可测 | 拍组、弦序、力度、最长刷弦跨度和同弦截断 |
| 指弹短音黏连，停顿被拉平 | 连接同时受秒间隔、节拍和同弦约束。保留显式休止，勾弦仍通过手型校验 | 导入参考谱、合成连音/休止与试听对照 |

实验切换一次应用这组改动。乐句规则与原始转录分层，可在同一工程比较。试听与量化指标共同确定适用范围。[pYIN 原论文](https://www.eecs.qmul.ac.uk/~simond/pub/2014/MauchDixon-PYIN-ICASSP2014.pdf) · [Basic Pitch 原论文](https://arxiv.org/html/2203.09893v2)
