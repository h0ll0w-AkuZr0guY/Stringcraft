import { readFile, writeFile } from "node:fs/promises";
import { sign } from "node:crypto";
import { zipSync } from "fflate";

const [id, output, keyPath] = process.argv.slice(2);
if (!id || !output || !keyPath)
  throw new Error("Usage: build-browser-plugin-package <id> <zip> <key>");
const entries = JSON.parse(
  await readFile("public/plugins/catalog.json", "utf8"),
);
const entry = entries.find(
  (manifest) => manifest.id === id && manifest.runtime === "browser",
);
if (!entry) throw new Error("Build the approved plugin catalog first");
const module = await readFile("public/" + entry.entry);
const manifest = Buffer.from(JSON.stringify(entry));
const signature = sign("sha256", manifest, {
  key: await readFile(keyPath),
  dsaEncoding: "ieee-p1363",
});
await writeFile(
  output,
  zipSync({
    "manifest.json": manifest,
    "manifest.sig": signature,
    "plugin.mjs": module,
  }),
  { flag: "wx" },
);
