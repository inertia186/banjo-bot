import assert from "node:assert/strict";
import test from "node:test";
import type { Client, Message } from "discord.js";
import { registerCommands } from "../src/commands/index.js";
import type { Command, CommandContext } from "../src/commands/types.js";
import type { AppConfig } from "../src/config.js";
import type { Logger } from "../src/logger.js";

const logger: Logger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

const config: AppConfig = {
  discordToken: "test-token",
  commandPrefix: "$",
  channels: null,
  logLevel: "silent",
  llm: {
    enabled: false,
    provider: "openai",
    model: "test-model",
    maxHistory: 1,
    maxOutputTokens: 1,
    openAiApiKey: null,
  },
};

function registry(): Map<string, Command> {
  const client = {} as Client;
  registerCommands(client);
  return client.commands;
}

function context(commands = registry(), commandName = "test"): CommandContext {
  return {
    config,
    logger,
    commandName,
    message: {
      client: { commands },
    } as unknown as Message,
  };
}

test("registerCommands registers aliases to the same command", () => {
  const commands = registry();

  assert.equal(commands.get("pancakes"), commands.get("pancake"));
  assert.equal(commands.get("silver"), commands.get("hydrogen"));
  assert.equal(commands.get("wa"), commands.get("wolframalpha"));
});

test("help lists each command once despite aliases", async () => {
  const commands = registry();
  const response = await commands.get("help")?.execute(context(commands), []);

  assert.equal(typeof response, "string");
  assert.match(response as string, /\*\*core\*\*/);
  assert.equal((response as string).match(/`\$pancake`/g)?.length, 1);
});

test("help for a selected alias resolves the canonical command", async () => {
  const commands = registry();
  const response = await commands.get("help")?.execute(context(commands), ["pancakes"]);

  assert.equal(typeof response, "string");
  assert.match(response as string, /\*\*\$pancake\*\*/);
  assert.match(response as string, /Aliases: pancakes/);
});

test("ported snarks keep legacy static responses", async () => {
  const commands = registry();

  assert.equal(await commands.get("make")?.execute(context(commands), []), "Make it yourself.");
  assert.equal(await commands.get("sudo")?.execute(context(commands), []), "Ok.");
  assert.equal(await commands.get("donut")?.execute(context(commands), []), "*Yummeh*");
  assert.equal(
    await commands.get("roll")?.execute(context(commands), []),
    "Your random number is: **4** - chosen by fair dice roll, guaranteed to be random, see RFC 1149.5.",
  );
});

test("lmgtfy keeps the legacy unescaped query shape", async () => {
  const commands = registry();

  assert.equal(
    await commands.get("lmgtfy")?.execute(context(commands), ["hive", "account"]),
    "https://lmgtfy.com/?q=hive account",
  );
});

test("element aliases route to the deferred Wolfram Alpha lookup", async () => {
  const commands = registry();
  const response = await commands.get("gold")?.execute(context(commands, "gold"), []);

  assert.equal(
    response,
    "`$gold` is a Wolfram Alpha-backed legacy lookup and has not been ported yet.",
  );
});
