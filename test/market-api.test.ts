import assert from "node:assert/strict";
import test from "node:test";
import { testConfig } from "./helpers/config.js";
import type { Logger } from "../src/logger.js";
import { CoinGeckoMarketClient } from "../src/market/api.js";

const logger: Logger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

const config = testConfig({
  MARKET_REQUEST_TIMEOUT_MS: "1",
});

test("market ticker lookup returns null when the request times out", async () => {
  const client = new CoinGeckoMarketClient(config, logger);
  await withNeverResolvingFetch(async () => {
    assert.equal(await client.getHiveTicker(), null);
  });
});

test("market HIVE/HBD price lookup returns null prices when the request times out", async () => {
  const client = new CoinGeckoMarketClient(config, logger);
  await withNeverResolvingFetch(async () => {
    assert.deepEqual(await client.getHiveHbdUsdPrices(), { hive: null, hbd: null });
  });
});

test("fear and greed lookup returns null when the request times out", async () => {
  const client = new CoinGeckoMarketClient(config, logger);
  await withNeverResolvingFetch(async () => {
    assert.equal(await client.getFearGreedIndex(1), null);
  });
});

async function withNeverResolvingFetch(callback: () => Promise<void>) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_input, init) => {
    assert.ok(init?.signal);
    return new Promise((_resolve, reject) => {
      init.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
    });
  };

  try {
    await callback();
  } finally {
    globalThis.fetch = originalFetch;
  }
}
