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
  audience,
  maturity,
  bundle,
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
    audience,
    maturity,
    bundle,
    dependencies: [],
  });
}
catalog.push({
  id: "local-separation",
  name: "本地伴奏增强",
  audience: "user",
  maturity: "experimental",
  bundle: "local",
  version: "0.3.0",
  sdk: 1,
  description:
    "完整环境：HTDemucs GPU 分离、Basic Pitch ONNX、音频和弦分析；以实际探测为准",
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
const modelFiles = (
  await readdir("node_modules/@spotify/basic-pitch/model")
).sort();
const modelHashes = [];
for (const file of modelFiles) {
  const data = await readFile(
    "node_modules/@spotify/basic-pitch/model/" + file,
  );
  modelHashes.push({
    file,
    sha256: createHash("sha256").update(data).digest("hex"),
  });
}
await writeFile(
  "public/models/basic-pitch/provenance.json",
  JSON.stringify({
    package: "@spotify/basic-pitch@1.0.1",
    sha256: createHash("sha256")
      .update(JSON.stringify(modelHashes))
      .digest("hex"),
    files: modelHashes,
  }),
);
await mkdir("public/demo", { recursive: true });
await cp("tests/fixtures/audio/clean-melody.wav", "public/demo/phrase.wav");
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
