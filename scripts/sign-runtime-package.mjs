/** Sign only an already built runtime. The release key stays outside the worktree. */
import { createReadStream } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { createHash, sign } from "node:crypto";

const [archive, keyPath] = process.argv.slice(2);
if (!archive || !keyPath)
  throw new Error("Usage: sign-runtime-package <archive> <private key>");
const hash = createHash("sha256");
for await (const block of createReadStream(archive)) hash.update(block);
const key = await readFile(keyPath);
const signature = sign("sha256", Buffer.from(hash.digest("hex")), {
  key,
  dsaEncoding: "ieee-p1363",
});
await writeFile(archive + ".sig", signature, { flag: "wx" });
