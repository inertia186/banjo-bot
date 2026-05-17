import assert from "node:assert/strict";
import test from "node:test";
import { parseHiveDeveloperNodes } from "../src/hive/nodes.js";

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
