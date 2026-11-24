import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
const root = "dist-pages";
const meta = JSON.parse(await readFile(join(root, "build-info.json"), "utf8"));
if (meta.edition !== "pages") throw new Error("Incorrect Pages output edition");
const files = await readdir(root, { recursive: true });
const privateMarker = [
  "STRINGCRAFT",
  "PRIVATE",
  "PRACTICE",
  "ENGINE",
  "V1",
].join("_");
for (const name of files) {
  if (/(?:practice-full|private-practice|\.plugin\.zip|\.pem)$/i.test(name))
    throw new Error("Unexpected private artifact: " + name);
  if (!/\.(mjs|js|json|html|map)$/.test(name)) continue;
  const text = await readFile(join(root, name), "utf8");
  if (
    text.includes(privateMarker) ||
    text.includes("BEGIN PRIVATE" + " KEY-----")
  )
    throw new Error("Private payload in Pages: " + name);
}
console.log("Pages edition and public practice artifacts verified");
