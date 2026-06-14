import type { Message, MessageReplyOptions } from "discord.js";
import type { AppConfig } from "../config.js";
import type { XkcdApi } from "../comics/xkcd.js";
import type { HiveApi } from "../hive/api.js";
import type { HiveEngineApi } from "../hive-engine/api.js";
import type { ScotApi } from "../hive-engine/scot.js";
import type { HiveNodeDirectory } from "../hive/nodes.js";
import type { HiveSqlApi } from "../hivesql/api.js";
import type { Logger } from "../logger.js";
import type { HivePostSummarizer } from "../llm/post-summary.js";
import type { MarketApi } from "../market/api.js";
import type { GiphyApi } from "../media/giphy.js";
import type { SplinterlandsApi } from "../splinterlands/api.js";

export type CommandContext = {
  message: Message;
  config: AppConfig;
  logger: Logger;
  commandName: string;
  services?: {
    hive?: HiveApi;
    hiveEngine?: HiveEngineApi;
    scot?: ScotApi;
    hiveNodes?: HiveNodeDirectory;
    hiveSql?: HiveSqlApi;
    market?: MarketApi;
    giphy?: GiphyApi;
    xkcd?: XkcdApi;
    splinterlands?: SplinterlandsApi;
    hivePostSummarizer?: HivePostSummarizer;
  };
};

export type Command = {
  name: string;
  aliases?: string[];
  description: string;
  usage?: string;
  category: "core" | "links" | "snarks" | "hive" | "legacy";
  execute(context: CommandContext, args: string[]): Promise<CommandResponse> | CommandResponse;
};

export type CommandReplyOptions = MessageReplyOptions & {
  afterSend?: (reply: Message) => Promise<void> | void;
};

export type CommandResponse = string | CommandReplyOptions | void;
