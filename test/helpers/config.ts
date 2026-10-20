import { loadConfig } from "../../src/config.js";

export function testConfig(env: NodeJS.ProcessEnv = {}) {
  return loadConfig({
    DISCORD_TOKEN: "test-token",
    LOG_LEVEL: "silent",
    HIVE_NODES: "https://example.test",
    HIVE_NODES_SOURCE_URL: "https://developers.test/hive_full_nodes.html",
    HIVE_RPC_TIMEOUT_MS: "1000",
    HYPERION_BASE_URL: "https://hyperion.test",
    HAFSQL_HOST: "hafsql.test",
    COINGECKO_BASE_URL: "https://coingecko.test",
    MARKET_REQUEST_TIMEOUT_MS: "1000",
    HIVE_ENGINE_CONTRACTS_URL: "https://hive-engine.test/rpc/contracts",
    SCOT_API_URL: "https://scot.test",
    SPLINTERLANDS_API_BASE_URL: "https://splinterlands.test",
    GIPHY_REQUEST_TIMEOUT_MS: "1000",
    LLM_MODEL: "test-model",
    LLM_MAX_HISTORY: "1",
    LLM_MAX_OUTPUT_TOKENS: "1",
    ...env,
  });
}
