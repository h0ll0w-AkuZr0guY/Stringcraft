# 公共接口手册

SDK v1 的源码定义位于 `packages/contracts/index.ts`。本文件描述语义，字段以 TypeScript 声明为准。

## 音乐与项目

- `NoteEvent`：唯一 id、非负 start、正 duration、MIDI 0–127、可选 cents、velocity 与 score 0–1，source 区分 detected/demo/manual/generated。role 表示 melody/bass/harmony；locked 是人工保护标记。
- `GuitarNote`：增加 string 1–6、fret 相对变调夹、可选 technique。仅为吉他事件，不要求所有乐器使用。
- `Arrangement<N>`：instrumentId、difficulty、capo、transpose、notes、dropped 与 warnings。默认 N 为 GuitarNote；其他乐器可使用不同演奏事件。
- `MusicProject<N>`：schemaVersion 1、来源、时长、BPM、beatOffset、sourceOffset、候选、旋律、编配、时间及插件版本。存储前校验；旧 schema 不静默改写。
- `validateNotes`：拒绝重复 ID、非法音高、NaN、负时间、零时长和不支持的来源；最多 100000 音符。
- `validateProject`：当前校验吉他项目及弦位音高关系。扩展乐器需注册相应校验器；禁止绕过校验。

## 插件

`PluginManifest` 声明 id、name、version、sdk、capabilities、runtime、license、entry、sha256、size、dependencies。id 使用小写字母与连字符。插件接口为默认导出的 `MusicPlugin` 对象：

| 方法 | 契约 |
| --- | --- |
| extractMelody(notes) | 返回引用稳定 ID 的主旋律；不发明 source=detected 的音符 |
| arrange(notes, options) | 接收 difficulty、capo、transpose、bpm、previous；锁定冲突抛错 |
| transcribe(samples, modelUrl, wasmUrl, progress) | 单声道 22050 Hz Float32Array；异步返回 NoteEvent，进度 0–1 |
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
