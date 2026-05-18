import type { Message } from "discord.js";
import type { AppConfig } from "../config.js";
import { HiveRpcClient, type HiveApi, type HivePost } from "../hive/api.js";
import type { Logger } from "../logger.js";

export type AmbientContextProvider = {
  contextFor(prompt: string, message?: Message): Promise<string | null>;
};

export class HiveAmbientContextProvider implements AmbientContextProvider {
  constructor(
    private readonly config: AppConfig,
    private readonly logger: Logger,
    private readonly hive: HiveApi = new HiveRpcClient(config, logger),
  ) {}

  async contextFor(prompt: string): Promise<string | null> {
    if (!wantsHiveAmbientContext(prompt)) return null;

    try {
      const [globals, ticker, feed, latest, trending] = await Promise.all([
        this.hive.getDynamicGlobalProperties(),
        this.hive.getMarketTicker(),
        this.hive.getFeedHistory(),
        this.hive.getRankedPosts("created", 5),
        this.hive.getRankedPosts("trending", 5),
      ]);

      return [
        "Ambient Hive context for casual conversation. This is not command output.",
        globals.head_block_number ? `Head block: ${globals.head_block_number}.` : null,
        globals.time ? `Chain time: ${globals.time} UTC.` : null,
        ticker.latest ? `Market ticker latest: ${ticker.latest} HBD/HIVE.` : null,
        ticker.percent_change ? `24h ticker change: ${ticker.percent_change}%.` : null,
        feed.current_median_history ? `Median feed: ${feed.current_median_history.base} / ${feed.current_median_history.quote}.` : null,
        formatPosts("Latest posts", latest),
        formatPosts("Trending posts", trending),
      ].filter(Boolean).join("\n");
    } catch (error) {
      this.logger.warn("Unable to load ambient Hive context for LLM.", {
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }
}

export function wantsHiveAmbientContext(prompt: string): boolean {
  const value = prompt.toLowerCase();
  return /\bhive\b/.test(value) && /\b(today|now|new|happening|going on|latest|current|recent|trend|trending|chain|blockchain|market|price)\b/.test(value);
}

function formatPosts(label: string, posts: HivePost[]): string {
  if (posts.length === 0) return `${label}: none returned.`;

  const lines = posts.slice(0, 5).map((post, index) => {
    const title = post.title?.trim() || "(untitled)";
    const ref = `@${post.author}/${post.permlink}`;
    const details = [
      post.created ? `created ${post.created}` : null,
      typeof post.net_votes === "number" ? `${post.net_votes} votes` : null,
      post.pending_payout_value ? `pending ${post.pending_payout_value}` : null,
      post.category ? `tag ${post.category}` : null,
    ].filter(Boolean).join(", ");
    return `${index + 1}. ${title} (${ref}${details ? `, ${details}` : ""})`;
  });

  return `${label}:\n${lines.join("\n")}`;
}
