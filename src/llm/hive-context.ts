import type { Message } from "discord.js";
import type { AppConfig } from "../config.js";
import { HiveRpcClient, type HiveApi, type HivePost } from "../hive/api.js";
import type { HyperionApi, HyperionDigest } from "../hyperion/api.js";
import type { Logger } from "../logger.js";

export type AmbientContextProvider = {
  contextFor(prompt: string, message?: Message): Promise<string | null>;
};

export class HiveAmbientContextProvider implements AmbientContextProvider {
  constructor(
    private readonly config: AppConfig,
    private readonly logger: Logger,
    private readonly hive: HiveApi = new HiveRpcClient(config, logger),
    private readonly hyperion?: HyperionApi,
  ) {}

  async contextFor(prompt: string): Promise<string | null> {
    const postRef = extractHivePostSummaryRef(prompt);
    const accountCandidate = extractHiveAccountLookupCandidate(prompt);
    if (!wantsHiveAmbientContext(prompt) && !postRef && !accountCandidate) return null;

    try {
      if (postRef) {
        const post = await this.hive.getPostCreation(postRef.author, postRef.permlink);
        return [
          "Ambient Hive post context from a direct Hive RPC get_content lookup. This is not a web fetch, URL scrape, command output, or HiveSQL search.",
          post
            ? formatPostContext(post)
            : `Hive post @${postRef.author}/${postRef.permlink}: no post returned by Hive RPC. If the user asked for a summary, decline to summarize it because it is not actually available on Hive.`,
          "Use this only for the referenced Hive post. Do not imply that the pasted URL itself was fetched.",
        ].join("\n");
      }

      if (accountCandidate) {
        const account = await this.hive.getAccount(accountCandidate);
        return [
          "Ambient Hive account context from a direct Hive RPC account lookup. This is not command output, and it is not a HiveSQL/person/content search.",
          account
            ? formatAccountContext(account)
            : `Hive account @${accountCandidate}: no account returned by Hive RPC.`,
          "Use this only as a possible Hive handle match. Do not imply that other platforms or Discord globally were checked.",
        ].join("\n");
      }

      return await this.currentHiveContext();
    } catch (error) {
      this.logger.warn("Unable to load ambient Hive context for LLM.", {
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  private async currentHiveContext(): Promise<string> {
    if (this.hyperion && this.config.hyperion.bearerToken) {
      try {
        const digest = await this.hyperion.getDigest({ limit: this.config.hyperion.digestLimit });
        const context = formatHyperionDigestContext(digest);
        if (context) return context;
      } catch (error) {
        this.logger.warn("Unable to load Hyperion digest for ambient Hive context; falling back to Hive RPC.", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

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
  }
}

export function wantsHiveAmbientContext(prompt: string): boolean {
  const value = prompt.toLowerCase();
  return /\bhive\b/.test(value) && /\b(today|now|new|happening|going on|latest|current|recent|trend|trending|chain|blockchain|market|price)\b/.test(value);
}

function extractHivePostSummaryRef(prompt: string): { author: string; permlink: string } | null {
  if (!/\b(?:summari[sz]e|summary|tldr|tl;dr|explain|what(?:'s| is) this|tell me about)\b/i.test(prompt)) return null;
  return extractHivePostRef(prompt);
}

function extractHivePostRef(value: string): { author: string; permlink: string } | null {
  const rawRef = value.match(/(?:^|[\s`])@([a-z0-9][a-z0-9.-]{1,14}[a-z0-9])\/([a-z0-9][a-z0-9-]{0,255})(?=$|[\s`).,?!>])/i);
  if (rawRef?.[1] && rawRef[2]) return { author: rawRef[1].toLowerCase(), permlink: rawRef[2].toLowerCase() };

  for (const match of value.matchAll(/https?:\/\/[^\s<>)]+/gi)) {
    const ref = extractHivePostRefFromUrl(match[0].replace(/[),.?!]+$/g, ""));
    if (ref) return ref;
  }

  return null;
}

function extractHivePostRefFromUrl(value: string): { author: string; permlink: string } | null {
  try {
    const url = new URL(value);
    const segments = url.pathname.split("/").filter(Boolean);
    const authorIndex = segments.findIndex((segment) => /^@[a-z0-9][a-z0-9.-]{1,14}[a-z0-9]$/i.test(segment));
    const authorSegment = authorIndex >= 0 ? segments[authorIndex] : null;
    const permlink = authorIndex >= 0 ? segments[authorIndex + 1] : null;
    if (!authorSegment || !permlink || !/^[a-z0-9][a-z0-9-]{0,255}$/i.test(permlink)) return null;
    return { author: authorSegment.slice(1).toLowerCase(), permlink: permlink.toLowerCase() };
  } catch {
    return null;
  }
}

function extractHiveAccountLookupCandidate(prompt: string): string | null {
  for (const line of prompt.split(/\n+/)) {
    const candidate = line.match(/\bContext planner Hive RPC account candidate:\s*@?([a-z0-9][a-z0-9.-]{1,14}[a-z0-9])\b/i)?.[1] ??
      line.match(/\b(?:tell me about|who is|what is|look up|lookup|check|about)\s+@?([a-z0-9][a-z0-9.-]{1,14}[a-z0-9])\b/i)?.[1] ??
      line.match(/@([a-z0-9][a-z0-9.-]{1,14}[a-z0-9])\b/i)?.[1];
    const normalized = candidate?.toLowerCase();
    if (normalized && !ACCOUNT_LOOKUP_STOP_WORDS.has(normalized)) return normalized;
  }

  return null;
}

const ACCOUNT_LOOKUP_STOP_WORDS = new Set([
  "discord",
  "handle",
  "hive",
  "search",
  "that",
  "this",
]);

function formatPostContext(post: HivePost): string {
  const details = [
    `Hive post @${post.author}/${post.permlink}: found.`,
    post.title ? `Title: ${post.title}.` : null,
    post.created ? `Created: ${post.created}.` : null,
    typeof post.net_votes === "number" ? `Votes: ${post.net_votes}.` : null,
    post.pending_payout_value ? `Pending payout: ${post.pending_payout_value}.` : null,
    post.body ? `Body excerpt:\n${trimPostBody(post.body)}` : "Body excerpt: none returned.",
  ].filter(Boolean);
  return details.join("\n");
}

function trimPostBody(body: string): string {
  const compact = body
    .replace(/!\[[^\]]*]\([^)]*\)/g, "")
    .replace(/\[[^\]]+]\(([^)]+)\)/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (compact.length <= 1_500) return compact;
  return `${compact.slice(0, 1_497).trimEnd()}...`;
}

function formatAccountContext(account: { name: string; created?: string; posting_json_metadata?: string; json_metadata?: string }): string {
  const metadata = accountMetadata(account);
  const details = [
    `Hive account @${account.name}: found.`,
    account.created ? `Created: ${account.created}.` : null,
    metadata.name ? `Profile name: ${metadata.name}.` : null,
    metadata.about ? `Profile about: ${metadata.about}.` : null,
    metadata.website ? `Profile website: ${metadata.website}.` : null,
  ].filter(Boolean);
  return details.join("\n");
}

function accountMetadata(account: { posting_json_metadata?: string; json_metadata?: string }): Record<string, string> {
  for (const raw of [account.posting_json_metadata, account.json_metadata]) {
    const parsed = parseJsonObject(raw);
    const profile = parseJsonObject(parsed?.profile);
    if (profile) return stringRecord(profile);
  }

  return {};
}

function parseJsonObject(value: unknown): Record<string, unknown> | null {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function stringRecord(value: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string" && entry[1].trim().length > 0),
  );
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

function formatHyperionDigestContext(digest: HyperionDigest): string | null {
  const posts = extractDigestPosts(digest.raw);
  if (!posts) return null;
  if (posts.length === 0) {
    return [
      "Ambient Hive context from Hyperion unread digest for Banjo's authenticated Hive account. This is not command output.",
      "Hyperion digest posts: none returned.",
    ].join("\n");
  }

  const lines = posts.slice(0, 10).map((post, index) => formatHyperionPost(post, index));
  return [
    "Ambient Hive context from Hyperion unread digest for Banjo's authenticated Hive account. This is not command output, not a web scrape, and not a HiveSQL search.",
    "Use it modestly as current curated/unread Hive context.",
    `Hyperion digest posts:\n${lines.join("\n")}`,
  ].join("\n");
}

function extractDigestPosts(payload: Record<string, unknown>): Record<string, unknown>[] | null {
  for (const key of ["posts", "items", "digest", "results"]) {
    const value = payload[key];
    if (Array.isArray(value)) return value.filter(isRecord);
  }

  return null;
}

function formatHyperionPost(post: Record<string, unknown>, index: number): string {
  const author = firstString(post, ["author", "author_name", "account", "account_name"]);
  const permlink = firstString(post, ["permlink", "link"]);
  const title = firstString(post, ["title"]) ?? "(untitled)";
  const category = firstString(post, ["category", "tag"]);
  const created = firstString(post, ["created", "created_at", "createdAt"]);
  const payout = firstString(post, ["pending_payout_value", "pendingPayoutValue", "payout", "payout_value"]);
  const votes = firstNumber(post, ["net_votes", "netVotes", "votes"]);
  const summary = firstString(post, ["summary", "excerpt", "body_preview", "bodyPreview", "description"]);
  const url = firstString(post, ["url", "post_url", "postUrl"]) ?? (author && permlink ? `https://hive.blog/@${author}/${permlink}` : null);
  const voteLink = firstString(post, ["vote_link", "voteLink", "hivesigner_vote_url", "hivesignerVoteUrl"]);
  const tags = extractStringList(post.tags);
  const ref = author && permlink ? `@${author}/${permlink}` : author ? `@${author}` : null;
  const details = [
    ref,
    created ? `created ${created}` : null,
    category ? `tag ${category}` : null,
    tags.length > 0 ? `tags ${tags.slice(0, 4).join(", ")}` : null,
    typeof votes === "number" ? `${votes} votes` : null,
    payout ? `payout ${payout}` : null,
    url ? `url ${url}` : null,
    voteLink ? `vote link ${voteLink}` : null,
  ].filter(Boolean).join(", ");
  const excerpt = summary ? ` - ${trimDigestText(summary)}` : "";
  return `${index + 1}. ${trimDigestText(title)}${details ? ` (${details})` : ""}${excerpt}`;
}

function firstString(record: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim().length > 0) return value.trim();
  }

  return null;
}

function firstNumber(record: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }

  return null;
}

function extractStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim());
}

function trimDigestText(value: string): string {
  const compact = value.replace(/\s+/g, " ").trim();
  if (compact.length <= 240) return compact;
  return `${compact.slice(0, 237).trimEnd()}...`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
