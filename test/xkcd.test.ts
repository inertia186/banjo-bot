import assert from "node:assert/strict";
import test from "node:test";
import { XkcdHttpClient } from "../src/comics/xkcd.js";
import type { Logger } from "../src/logger.js";

const logger: Logger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

test("XkcdHttpClient normalizes malformed optional string fields", async (t) => {
  t.mock.method(globalThis, "fetch", async () => jsonResponse({
    num: 42,
    title: "Compiler Complaint",
    safe_title: { text: "Compiler Complaint" },
    alt: ["It compiled on my machine."],
    img: "https://imgs.xkcd.com/comics/compiler_complaint.png",
  }));

  assert.deepEqual(await new XkcdHttpClient(logger).getComic(42), {
    num: 42,
    title: "Compiler Complaint",
    safeTitle: "Compiler Complaint",
    alt: "",
    imageUrl: "https://imgs.xkcd.com/comics/compiler_complaint.png",
  });
});

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
