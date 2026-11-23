# 第三方许可

自有代码 Apache-2.0，见根目录 LICENSE。NOTICE 保留主要来源，发布构建的 legal/THIRD_PARTY_NOTICES.txt 收集实际 npm 运行依赖许可。

| 组件 | 来源 | 许可/处理 |
| --- | --- | --- |
| Basic Pitch 与模型 | https://github.com/spotify/basic-pitch-ts | Apache-2.0，保留版权和许可 |
| TensorFlow.js | https://github.com/tensorflow/tfjs | Apache-2.0，WASM 随实际版本分发 |
| alphaTab | https://github.com/CoderLine/alphaTab | MPL-2.0；未修改上游源文件，提供官方源代码入口与许可 |
| React | https://github.com/facebook/react | MIT |
| Lucide | https://github.com/lucide-icons/lucide | ISC |
| 吉他单音采样 | https://github.com/facebookincubator/Meta-open-sound | 乐器采样 CC0-1.0；逐样本映射在 manifest |
| HTDemucs | https://github.com/facebookresearch/demucs | 可选 MIT 模型/代码，随环境保留实际许可 |
| NumPy/SciPy/librosa/音频工具 | 对应 Python 包元数据 | 独立环境保留 dist-info 的 license 文件 |

FFmpeg 并非 Apache-2.0 组件，许可证取决于实际构建。本地环境构建使用 imageio-ffmpeg 的发行二进制，其元数据、许可证和二进制来源随包保留；构建记录固定其版本。不要将本机未知来源 FFmpeg 随意复制进正式发布。

原创合成测试曲由 scripts/generate-fixtures.py 生成，随项目许可提供。仓库不含用户私人歌曲与谱件。贡献者新增媒体需说明来源和再分发授权。接口兼容不代表第三方许可自动兼容。

交互设计研究参考 [hear-score](https://github.com/LiRenTech/hear-score) 与 [Basic Pitch 论文](https://arxiv.org/html/2203.09893v2)。此次核查未找到 hear-score 项目本身的 LICENSE，未复制其源码或资源；卷帘、编辑与导出独立实现。模型直接使用官方 @spotify/basic-pitch 1.0.1 的 Apache-2.0 发行资源，构建生成逐资源 SHA-256 与组合摘要。
