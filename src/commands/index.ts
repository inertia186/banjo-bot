import type { Client } from "discord.js";
import { comicCommands } from "./comics.js";
import { coreCommands } from "./core.js";
import { hiveCommands } from "./hive.js";
import { linkCommands } from "./links.js";
import { snarkCommands } from "./snarks.js";
import { splinterlandsCommands } from "./splinterlands.js";
import type { Command } from "./types.js";

declare module "discord.js" {
  interface Client {
    commands: Map<string, Command>;
  }
}

export function registerCommands(client: Client) {
  const commands = [...coreCommands, ...linkCommands, ...snarkCommands, ...comicCommands, ...hiveCommands, ...splinterlandsCommands];
  client.commands = new Map<string, Command>();

  for (const command of commands) {
    registerName(client.commands, command.name, command);

    for (const alias of command.aliases ?? []) {
      registerName(client.commands, alias, command);
    }
  }
}

function registerName(registry: Map<string, Command>, name: string, command: Command) {
  const key = name.toLowerCase();

  if (registry.has(key)) {
    throw new Error(`Duplicate command registration: ${key}`);
  }

  registry.set(key, command);
}
