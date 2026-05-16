import type { Message } from "discord.js";
import type { AppConfig } from "../config.js";
import type { Logger } from "../logger.js";

export type CommandContext = {
  message: Message;
  config: AppConfig;
  logger: Logger;
  commandName: string;
};

export type Command = {
  name: string;
  aliases?: string[];
  description: string;
  usage?: string;
  category: "core" | "links" | "snarks" | "legacy";
  execute(context: CommandContext, args: string[]): Promise<string | void> | string | void;
};
