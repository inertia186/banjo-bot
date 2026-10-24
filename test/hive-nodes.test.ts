import assert from "node:assert/strict";
import test from "node:test";
import { testConfig } from "./helpers/config.js";
import type { Logger } from "../src/logger.js";
import { HiveDeveloperNodeDirectory, parseHiveDeveloperNodes } from "../src/hive/nodes.js";

const config = testConfig({
  HIVE_NODES: "https://configured-one.test https://configured-two.test",
});

test("Hive developer node parser reads the public nodes section", () => {
  const html = `
    <h3>Public Nodes</h3>
    <table>
      <tr><th>URL</th><th>Owner</th></tr>
      <tr><td>api.hive.blog</td><td>@blocktrades</td></tr>
      <tr><td>api.deathwing.me</td><td>@deathwing</td></tr>
    </table>
    <h3>Private Nodes</h3>
    <a href="https://docs.docker.com/">Docker</a>
  `;

  assert.deepEqual(parseHiveDeveloperNodes(html), [
    { url: "https://api.hive.blog", owner: "@blocktrades" },
    { url: "https://api.deathwing.me", owner: "@deathwing" },
  ]);
});

test("Hive developer node directory falls back when successful HTML has no public nodes", async (t) => {
  const warnings: Array<Record<string, unknown> | undefined> = [];
  const logger: Logger = {
    info: () => undefined,
    warn: (_message, meta) => warnings.push(meta),
    error: () => undefined,
  };
  t.mock.method(globalThis, "fetch", async () => new Response("<html><h1>Changed page</h1></html>", { status: 200 }));

  const directory = new HiveDeveloperNodeDirectory(config, logger);

  assert.deepEqual(await directory.getPublicNodes(), [
    { url: "https://configured-one.test" },
    { url: "https://configured-two.test" },
  ]);
  assert.deepEqual(warnings, [{ error: "No public nodes found in directory response." }]);
});
