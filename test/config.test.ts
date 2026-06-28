import assert from "node:assert/strict";
import test from "node:test";
import { loadConfig } from "../src/config.js";

test("loadConfig reads Hyperion settings from environment", () => {
  const config = loadConfig({
    DISCORD_TOKEN: "discord-token",
    HYPERION_BASE_URL: "https://hyperion.test/",
    HYPERION_BEARER_TOKEN: "hyp_at_secret",
    HYPERION_DIGEST_LIMIT: "7",
    BANJO_OWNER_IDS: "owner-1, owner-2 owner-3",
  });

  assert.equal(config.hyperion.baseUrl, "https://hyperion.test");
  assert.equal(config.hyperion.bearerToken, "hyp_at_secret");
  assert.equal(config.hyperion.digestLimit, 7);
  assert.deepEqual([...config.hyperion.ownerIds], ["owner-1", "owner-2", "owner-3"]);
});

test("loadConfig defaults Hyperion to public endpoint without credentials", () => {
  const config = loadConfig({ DISCORD_TOKEN: "discord-token" });

  assert.equal(config.hyperion.baseUrl, "https://www.hyperion.zone");
  assert.equal(config.hyperion.bearerToken, null);
  assert.equal(config.hyperion.digestLimit, 10);
  assert.deepEqual([...config.hyperion.ownerIds], []);
});

test("loadConfig rejects malformed numeric environment values", () => {
  const config = loadConfig({
    DISCORD_TOKEN: "discord-token",
    HIVE_RPC_TIMEOUT_MS: "1.5",
    HIVE_REFERENCE_MAX_AGE_DAYS: "30days",
    HAFSQL_MAX_POOL_SIZE: "3abc",
    LLM_MAX_OUTPUT_TOKENS: " 256 ",
  });

  assert.equal(config.hive.requestTimeoutMs, 10_000);
  assert.equal(config.hiveReferences.maxAgeDays, 30);
  assert.equal(config.hafSql.maxPoolSize, 3);
  assert.equal(config.llm.maxOutputTokens, 256);
});
