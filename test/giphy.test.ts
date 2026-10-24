import assert from "node:assert/strict";
import test from "node:test";
import { testConfig } from "./helpers/config.js";
import type { Logger } from "../src/logger.js";
import { GiphyHttpClient } from "../src/media/giphy.js";

const logger: Logger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

const config = testConfig({
  GIPHY_API_KEY: "test-key",
  GIPHY_REQUEST_TIMEOUT_MS: "1",
});

test("Giphy lookup returns null when the request times out", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_input, init) => {
    assert.ok(init?.signal);
    return new Promise((_resolve, reject) => {
      init.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
    });
  };

  try {
    assert.equal(await new GiphyHttpClient(config, logger).searchGif("debugging"), null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
