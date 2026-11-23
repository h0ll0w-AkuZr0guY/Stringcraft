/** Actual frozen-launcher port checks. Requires an already running copy of the same EXE. */
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { once } from "node:events";
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
const exe = process.env.STRINGCRAFT_TRIAL_EXE;
if (!exe)
  throw new Error("Set STRINGCRAFT_TRIAL_EXE to the extracted executable");
const port = new URL(process.env.TEST_BASE_URL ?? "http://127.0.0.1:18766/")
  .port;
const run = async (port) => {
  const child = spawn(exe, ["--no-open", "--port", String(port)], {
    windowsHide: true,
    env: {
      ...process.env,
      PATH: `${process.env.SystemRoot}\\System32;${process.env.SystemRoot}`,
    },
  });
  let output = "";
  child.stdout.on("data", (b) => {
    output += b.toString();
  });
  child.stderr.on("data", (b) => {
    output += b.toString();
  });
  const [code] = await once(child, "exit");
  return { code, output };
};
const same = await run(port);
assert.equal(same.code, 0);
assert.match(same.output, /already running/);
const server = createServer((req, res) => {
  res.setHeader("Content-Type", "application/json");
  res.end(
    JSON.stringify({
      local: true,
      appVersion: "old-test-version",
      buildSha: "old",
    }),
  );
});
server.listen(0, "127.0.0.1");
await once(server, "listening");
try {
  const other = await run(server.address().port);
  assert.equal(other.code, 1);
  const report = {
    sameBuildReused: true,
    differentBuildRefused: true,
    executableRanWithoutSystemPythonOrNode: true,
  };
  await writeFile(
    "artifacts/local-trial/launcher-verification.json",
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report));
} finally {
  server.close();
}
