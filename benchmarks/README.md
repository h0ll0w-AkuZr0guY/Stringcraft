# 评估统计

本目录只保存可公开的聚合结果、来源与参数，不包含原始音频或完整曲谱音符。

- `guitarset-audio-baseline.json`：6 段实际麦克风录音的浏览器多音高识别基线。
- `guitarset-calibration.json`：按演奏者隔离的指位软偏好实验；候选没有全局启用。
- `refinement-calibration.json`：18 段录音的训练/验证/留出候选清理实验；单项退化超限，维持默认关闭。
- `qingtian-first8.json`：Steven Law《晴天》改编版本首 8 小节的符号处理与动作对照。
- `qingtian-glyph-audit.json`：首 8 小节弦品标注与原 PDF 可见字形的顺序复核，不评估节奏和录音对齐。

GuitarSet 原始资料采用 CC-BY-4.0：Qingyang Xi、Rachel M. Bittner、Johan Pauwels、Xuzhou Ye、Juan P. Bello，GuitarSet: A Dataset for Guitar Transcription，ISMIR 2018，数据版本 1.1.0，[原始发布](https://zenodo.org/records/3371780)。本项目生成上述统计，不重新分发原始录音及标注。

《晴天》参考谱版权归原权利人，原站链接、版本与摘要记录在报告中；完整谱和本地音符标注不分发。本目录的符号保真度不表示音频识别准确率。复现与验收规则见 [真实曲谱评估](../docs/REFERENCE_EVALUATION.md)。
