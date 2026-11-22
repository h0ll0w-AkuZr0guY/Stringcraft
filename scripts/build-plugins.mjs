import { build } from "esbuild";
import { mkdir, writeFile, readFile, cp, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
const defs = [
  [
    "guitar-standard",
    "标准吉他",
    "guitar",
    ["instrument"],
    "六弦调弦、分级指弹与指法约束",
  ],
  [
    "melody-tracker",
    "旋律追踪",
    "melody",
    ["melody"],
    "结合起音、时长与音高连续性提取主声部",
  ],
  [
    "standard-exporters",
    "标准导出",
    "exporters",
    ["exporter"],
    "项目、MIDI 和文本六线谱",
  ],
  [
    "basic-pitch",
    "Basic Pitch",
    "basic-pitch",
    ["transcriber"],
    "浏览器神经音符识别，首次需下载模型",
  ],
  [
    "guitar-samples",
    "吉他实录音源",
    "guitar-samples",
    ["renderer"],
    "CC0 钢弦、尼龙采样，缺失音域明确回退合成",
  ],
  [
    "bailian-advisor",
    "百炼编配建议",
    "bailian-advisor",
    ["advisor"],
    "使用自己的 API Key 比较本地已验证的候选",
  ],
];
await mkdir("public/plugins", { recursive: true });
const catalog = [];
for (const [id, name, dir, capabilities, description] of defs) {
  const result = await build({
    entryPoints: [`plugins/${dir}/index.ts`],
    bundle: true,
    format: "esm",
    platform: "browser",
    target: "es2022",
    write: false,
    minify: true,
    legalComments: "eof",
  });
  const data = result.outputFiles[0].contents,
    sha256 = createHash("sha256").update(data).digest("hex");
  const entry = `plugins/${id}/0.1.0/${sha256.slice(0, 12)}.mjs`;
  await mkdir(
    entry
      .replace(/^plugins\//, "public/plugins/")
      .split("/")
      .slice(0, -1)
      .join("/"),
    { recursive: true },
  );
  await writeFile("public/" + entry, data);
  catalog.push({
    id,
    name,
    version: "0.1.0",
    sdk: 1,
    description,
    capabilities,
    runtime: "browser",
    license: "Apache-2.0",
    entry,
    sha256,
    size: data.length,
    dependencies: [],
  });
}
catalog.push({
  id: "local-separation",
  name: "本地分离与增强识别",
  version: "0.1.0",
  sdk: 1,
  description:
    "独立 Python 环境：FFmpeg、HTDemucs、Basic Pitch；从 Releases 下载",
  capabilities: ["separator", "transcriber"],
  runtime: "local",
  license: "MIT / Apache-2.0",
  entry: "",
  sha256: "",
  size: 0,
  dependencies: [],
});
await writeFile(
  "public/plugins/catalog.json",
  JSON.stringify(catalog, null, 2),
);
await mkdir("public/models/basic-pitch", { recursive: true });
await cp(
  "node_modules/@spotify/basic-pitch/model",
  "public/models/basic-pitch",
  { recursive: true },
);
await mkdir("public/wasm", { recursive: true });
for (const file of await readdir(
  "node_modules/@tensorflow/tfjs-backend-wasm/dist",
))
  if (file.endsWith(".wasm"))
    await cp(
      `node_modules/@tensorflow/tfjs-backend-wasm/dist/${file}`,
      `public/wasm/${file}`,
    );
await mkdir("public/font", { recursive: true });
await cp("node_modules/@coderline/alphatab/dist/font", "public/font", {
  recursive: true,
});
console.log(`Built ${defs.length} verified browser plugins and model assets`);
