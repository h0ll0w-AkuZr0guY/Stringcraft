import { build } from "esbuild";
import { mkdir, writeFile, readFile, cp, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
const defs = JSON.parse(await readFile("plugins/catalog.source.json", "utf8"));
await mkdir("public/plugins", { recursive: true });
const catalog = [];
for (const {
  id,
  name,
  directory: dir,
  version,
  capabilities,
  description,
  license,
} of defs) {
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
  const entry = `plugins/${id}/${version}/${sha256.slice(0, 12)}.mjs`;
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
    version,
    sdk: 2,
    description,
    capabilities,
    runtime: "browser",
    license,
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
