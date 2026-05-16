import assert from "node:assert/strict";
import test from "node:test";
import { parseCommand } from "../src/command-parser.js";

test("parseCommand ignores messages without the configured prefix", () => {
  assert.equal(parseCommand("help", "$"), null);
});

test("parseCommand ignores an empty command body", () => {
  assert.equal(parseCommand("$   ", "$"), null);
});

test("parseCommand lowercases the command name and preserves args", () => {
  assert.deepEqual(parseCommand("$HeLP Banjo", "$"), {
    name: "help",
    args: ["Banjo"],
  });
});

test("parseCommand keeps quoted arguments together", () => {
  assert.deepEqual(parseCommand('$lmgtfy "hive account" test', "$"), {
    name: "lmgtfy",
    args: ["hive account", "test"],
  });
});

test("parseCommand honors a custom prefix", () => {
  assert.deepEqual(parseCommand("!ping", "!"), {
    name: "ping",
    args: [],
  });
});
