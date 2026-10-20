import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags, type ButtonInteraction } from "discord.js";
import type { AppConfig } from "../config.js";
import { HiveRpcClient, type HiveApi, type HivePost } from "../hive/api.js";
import { type HiveSqlSearchComment, type HiveSqlSearchOptions, type HiveSqlSearchResult } from "../hivesql/api.js";
import { OpenAiHivePostSummarizer, type HivePostSummarizer } from "../llm/post-summary.js";
import type { Logger } from "../logger.js";
import { asEmbedResponse, banjoEmbed, dataField, truncateEmbedText } from "./embeds.js";
import type { Command } from "./types.js";
import { HIVE_TOKEN_ICON_URL, hiveApi, hiveSqlApi, configuredHistoryProviderName, unsupportedHafSqlLookup, unique, pluralize, proposalPostPreview, formatRelativeAge, formatUtc, formatInteger } from "./hive-shared.js";

export const searchCommand: Command = {
  name: "search",
  description: "Search Hive content; defaults to the last 24 hours.",
  usage: "search <terms...> [tag:name] [!tag:name] [after:YYYY-MM-DD] [before:YYYY-MM-DD]",
  category: "hive",
  execute: async (context, args) => {
    const hiveSql = hiveSqlApi(context);
    if (!hiveSql) return `${configuredHistoryProviderName(context)} is not configured, so content search is unavailable.`;
    const unsupported = unsupportedHafSqlLookup(hiveSql, "content search");
    if (unsupported) return unsupported;

    const parsed = parseSearchArgs(args);
    if (typeof parsed === "string") return parsed;
    if (parsed.keywords.length === 0 && parsed.tags.length === 0) {
      return "Usage: `$search <terms...> [tag:name] [!tag:name] [after:YYYY-MM-DD] [before:YYYY-MM-DD]`";
    }

    const result = await hiveSql.searchComments(parsed);
    return formatSearchResult(parsed, result, hiveApi(context));
  },
};

const searchButtonPrefix = "search";

const searchResultCache = new Map<string, { options: HiveSqlSearchOptions; result: HiveSqlSearchResult; posts: Map<string, HivePost | null>; createdAt: number }>();

const searchSummaryReplies = new Map<string, { delete(): Promise<unknown> }>();

let searchResultCacheCounter = 0;

function parseSearchArgs(args: string[], now = new Date()): HiveSqlSearchOptions | string {
  const keywords: string[] = [];
  const tags: string[] = [];
  const excludedTags: string[] = [];
  let after: Date | null = null;
  let before: Date | null = null;

  for (const arg of args) {
    const value = arg.trim();
    if (!value) continue;

    if (/^!tag:/i.test(value)) {
      const tag = value.slice(value.indexOf(":") + 1).toLowerCase();
      if (tag) excludedTags.push(tag);
      continue;
    }

    if (/^tag:/i.test(value)) {
      const tag = value.slice(value.indexOf(":") + 1).toLowerCase();
      if (tag) tags.push(tag);
      continue;
    }

    if (/^after:/i.test(value)) {
      const parsed = parseSearchDate(value.slice(value.indexOf(":") + 1), false);
      if (!parsed) return `Unable to parse search date: \`${value}\``;
      after = parsed;
      continue;
    }

    if (/^before:/i.test(value)) {
      const parsed = parseSearchDate(value.slice(value.indexOf(":") + 1), true);
      if (!parsed) return `Unable to parse search date: \`${value}\``;
      before = parsed;
      continue;
    }

    keywords.push(value.toLowerCase());
  }

  before ??= now;
  after ??= new Date(before.getTime() - 24 * 60 * 60 * 1000);
  if (after.getTime() > before.getTime()) return "`after:` must be earlier than `before:`.";

  return {
    keywords,
    tags: unique(tags),
    excludedTags: unique(excludedTags),
    after,
    before,
    limit: 81,
  };
}

function parseSearchDate(value: string, endOfDay: boolean): Date | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    const suffix = endOfDay ? "T23:59:59.999Z" : "T00:00:00.000Z";
    const date = new Date(`${trimmed}${suffix}`);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const normalized = trimmed.endsWith("Z") || /[+-]\d{2}:?\d{2}$/.test(trimmed) ? trimmed : `${trimmed}Z`;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

async function formatSearchResult(options: HiveSqlSearchOptions, result: HiveSqlSearchResult, hive: HiveApi) {
  const keywords = options.keywords.join(" ");
  const subject = keywords || options.tags.map((tag) => `tag:${tag}`).join(" ");
  const tags = [
    options.tags.length > 0 ? ` in ${options.tags.join(", ")}` : "",
    options.excludedTags.length > 0 ? ` not in ${options.excludedTags.join(", ")}` : "",
  ].join("");
  const timeframe = searchTimeframe(options);

  if (result.total === 0) return `No authors wrote about \`${subject}\` ${timeframe}${tags}.`;
  if (result.authorCount > 500) return `Too many authors in \`${subject}\` timeframe (${result.authorCount}). Try a more narrow timeframe.`;
  if (result.total > 80) return `Too many results for \`${subject}\` (${result.total})${tags}.`;

  const cacheId = rememberSearchResult(options, result);
  return formatSearchResultPage(cacheId, 0, hive);
}

function rememberSearchResult(options: HiveSqlSearchOptions, result: HiveSqlSearchResult): string {
  const now = Date.now();
  for (const [cacheId, cached] of searchResultCache.entries()) {
    if (now - cached.createdAt > 30 * 60 * 1000) searchResultCache.delete(cacheId);
  }

  const cacheId = (++searchResultCacheCounter).toString(36);
  searchResultCache.set(cacheId, { options, result, posts: new Map(), createdAt: now });
  return cacheId;
}

async function formatSearchResultPage(cacheId: string, selectedIndex: number, hive: HiveApi) {
  const cached = searchResultCache.get(cacheId);
  if (!cached) return asEmbedResponse(banjoEmbed().setTitle("Hive Search Results").setDescription("That search result cache expired."));
  if (cached.result.comments.length === 0) return asEmbedResponse(banjoEmbed().setTitle("Hive Search Results").setDescription("No cached search results."));

  const index = Math.max(0, Math.min(selectedIndex, cached.result.comments.length - 1));
  const post = await hydrateSearchPost(cached, index, hive);
  return {
    embeds: [formatSearchResultEmbed(cached.options, cached.result, index, post)],
    components: renderSearchResultComponents(cacheId, cached.result.comments.length, index),
  };
}

async function hydrateSearchPost(
  cached: { result: HiveSqlSearchResult; posts: Map<string, HivePost | null> },
  selectedIndex: number,
  hive: HiveApi,
): Promise<HivePost | null> {
  const comment = cached.result.comments[selectedIndex];
  if (!comment) return null;

  const key = `${comment.author}/${comment.permlink}`;
  if (cached.posts.has(key)) return cached.posts.get(key) ?? null;

  const post = await hive.getPostCreation(comment.author, comment.permlink);
  cached.posts.set(key, post);
  return post;
}

function formatSearchResultEmbed(options: HiveSqlSearchOptions, result: HiveSqlSearchResult, selectedIndex: number, post: HivePost | null): EmbedBuilder {
  const comment = result.comments[selectedIndex];
  if (!comment) {
    return banjoEmbed()
      .setTitle("Hive Search Results")
      .setDescription("No cached search results.")
      .setFooter({ text: "HiveSQL", iconURL: HIVE_TOKEN_ICON_URL });
  }
  const keywords = options.keywords.join(" ");
  const subject = keywords || options.tags.map((tag) => `tag:${tag}`).join(" ");
  const timeframe = searchTimeframe(options);
  const resultNumber = selectedIndex + 1;
  const postPreview = proposalPostPreview(post);
  const title = post?.title || comment.title || `@${comment.author}/${comment.permlink}`;
  const embed = banjoEmbed()
    .setTitle(truncateEmbedText(title, 256))
    .setURL(searchCommentUrl(comment))
    .setThumbnail(`https://images.hive.blog/u/${encodeURIComponent(comment.author)}/avatar`)
    .setDescription([
      searchCommentLink(comment),
      postPreview.description,
    ].filter(Boolean).join("\n"))
    .setFooter({ text: `${formatInteger(result.total)} results by ${pluralize(result.authorCount, "author")}`, iconURL: HIVE_TOKEN_ICON_URL });

  if (postPreview.image) embed.setImage(postPreview.image);

  embed.addFields([
    dataField("Result", `${resultNumber} / ${formatInteger(result.total)}`),
    dataField("Author", `@${comment.author}`),
    dataField("Created", comment.created ? `${formatRelativeAge(comment.created)} ago (${formatUtc(comment.created)} UTC)` : null),
    dataField("Query", subject),
    dataField("Tags", formatSearchTags(options)),
    dataField("Timeframe", timeframe),
  ].filter((field): field is NonNullable<typeof field> => field !== null));

  return embed;
}

function renderSearchResultComponents(cacheId: string, resultCount: number, selectedIndex: number): Array<ActionRowBuilder<ButtonBuilder>> {
  if (resultCount <= 0) return [];

  const buttons: ButtonBuilder[] = [];
  if (resultCount > 1) {
    buttons.push(
      new ButtonBuilder()
        .setCustomId(searchButtonId(cacheId, selectedIndex - 1))
        .setLabel("Previous")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(selectedIndex === 0),
    );
  }

  buttons.push(
    new ButtonBuilder()
      .setCustomId(searchSummaryButtonId(cacheId, selectedIndex))
      .setLabel("Summarize")
      .setStyle(ButtonStyle.Primary),
  );

  if (resultCount > 1) {
    buttons.push(
      new ButtonBuilder()
        .setCustomId(searchButtonId(cacheId, selectedIndex + 1))
        .setLabel("Next")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(selectedIndex >= resultCount - 1),
    );
  }

  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(...buttons),
  ];
}

function searchButtonId(cacheId: string, selectedIndex: number): string {
  return [searchButtonPrefix, cacheId, Math.max(0, selectedIndex)].join(":");
}

function searchSummaryButtonId(cacheId: string, selectedIndex: number): string {
  return [searchButtonPrefix, "summary", cacheId, Math.max(0, selectedIndex)].join(":");
}

function renderSearchLoadingComponents(): Array<ActionRowBuilder<ButtonBuilder>> {
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`${searchButtonPrefix}:loading`)
        .setLabel("Loading...")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(true),
    ),
  ];
}

export async function handleSearchInteraction(interaction: ButtonInteraction, config: AppConfig, logger: Logger): Promise<boolean> {
  const request = parseSearchButtonId(interaction.customId);
  if (!request) return false;

  const hive = new HiveRpcClient(config, logger);
  if (request.action === "summary") {
    await interaction.deferReply();
    await clearSearchSummaryReply(interaction);

    if (!searchResultCache.has(request.cacheId)) {
      await interaction.editReply({ content: "That search result cache expired. Run the search again." });
      return true;
    }

    const summary = await formatSearchResultSummary(request.cacheId, request.selectedIndex, hive, new OpenAiHivePostSummarizer(config, logger));
    await interaction.editReply(summary);
    await rememberSearchSummaryReply(interaction);
    return true;
  }

  await interaction.deferUpdate();
  await clearSearchSummaryReply(interaction);

  if (!searchResultCache.has(request.cacheId)) {
    await interaction.followUp({ content: "That search result cache expired. Run the search again.", flags: MessageFlags.Ephemeral });
    return true;
  }

  await interaction.message.edit({ components: renderSearchLoadingComponents() }).catch(() => undefined);
  await interaction.message.edit(await formatSearchResultPage(request.cacheId, request.selectedIndex, hive));
  return true;
}

async function rememberSearchSummaryReply(interaction: ButtonInteraction): Promise<void> {
  const reply = await interaction.fetchReply().catch(() => null);
  if (reply && typeof (reply as { delete?: unknown }).delete === "function") {
    searchSummaryReplies.set(interaction.message.id, reply as { delete(): Promise<unknown> });
  }
}

async function clearSearchSummaryReply(interaction: ButtonInteraction): Promise<void> {
  const reply = searchSummaryReplies.get(interaction.message.id);
  if (!reply) return;

  searchSummaryReplies.delete(interaction.message.id);
  await reply.delete().catch(() => undefined);
}

async function formatSearchResultSummary(cacheId: string, selectedIndex: number, hive: HiveApi, summarizer: HivePostSummarizer) {
  const cached = searchResultCache.get(cacheId);
  if (!cached) return { content: "That search result cache expired. Run the search again." };

  const index = Math.max(0, Math.min(selectedIndex, cached.result.comments.length - 1));
  const comment = cached.result.comments[index];
  if (!comment) return { content: "No cached search result to summarize." };

  const post = await hydrateSearchPost(cached, index, hive);
  if (!post) return { content: `Unable to find post @${comment.author}/${comment.permlink} on Hive.` };

  const summary = await summarizer.summarizePost(post);
  if (!summary) return { content: "LLM summarization is not configured." };

  return { content: summary };
}

function parseSearchButtonId(customId: string): { action: "page" | "summary"; cacheId: string; selectedIndex: number } | null {
  const parts = customId.split(":");
  const [prefix] = parts;
  if (prefix !== searchButtonPrefix) return null;

  const action = parts[1] === "summary" ? "summary" : "page";
  const cacheId = action === "summary" ? parts[2] : parts[1];
  const selectedIndexValue = action === "summary" ? parts[3] : parts[2];
  if (!cacheId) return null;

  const selectedIndex = Number.parseInt(selectedIndexValue ?? "", 10);
  if (!Number.isFinite(selectedIndex) || selectedIndex < 0) return null;

  return { action, cacheId, selectedIndex };
}

function formatSearchTags(options: HiveSqlSearchOptions): string | null {
  const tags = [
    options.tags.length > 0 ? `in ${options.tags.join(", ")}` : null,
    options.excludedTags.length > 0 ? `not in ${options.excludedTags.join(", ")}` : null,
  ].filter(Boolean);

  return tags.length > 0 ? tags.join("; ") : null;
}

function searchTimeframe(options: HiveSqlSearchOptions): string {
  const now = Date.now();
  const oneDay = 24 * 60 * 60 * 1000;
  if (Math.abs(options.before.getTime() - now) < 60_000 && Math.abs(options.before.getTime() - options.after.getTime() - oneDay) < 60_000) {
    return "today";
  }

  return `between ${formatUtc(options.after)} UTC and ${formatUtc(options.before)} UTC`;
}

function searchCommentLink(comment: HiveSqlSearchComment): string {
  return `[${comment.author}/${comment.permlink}](${searchCommentUrl(comment)})`;
}

function searchCommentUrl(comment: HiveSqlSearchComment): string {
  return `https://hive.blog/@${comment.author}/${comment.permlink}`;
}
