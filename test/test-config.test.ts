import assert from "node:assert/strict";
import test from "node:test";
import { testConfig } from "./helpers/config.js";

test("testConfig preserves overrides and isolates mutable defaults", () => {
  const first = testConfig({ CHANNELS: "test-channel", BANJO_OWNER_IDS: "test-owner", LLM_ENABLED: "true" });
  const second = testConfig({ CHANNELS: "test-channel", BANJO_OWNER_IDS: "test-owner" });

  assert.equal(first.llm.enabled, true);
  assert.equal(second.llm.enabled, false);
  first.hive.nodes.push("https://another.test");
  first.channels?.add("another-channel");
  first.hyperion.ownerIds.add("another-owner");
  first.market.requestTimeoutMs = 5;

  assert.deepEqual(second.hive.nodes, ["https://example.test"]);
  assert.deepEqual([...second.channels ?? []], ["test-channel"]);
  assert.deepEqual([...second.hyperion.ownerIds], ["test-owner"]);
  assert.equal(second.market.requestTimeoutMs, 1_000);
});
