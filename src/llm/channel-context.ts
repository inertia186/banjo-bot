import type { Collection, Message } from "discord.js";
import type { Logger } from "../logger.js";
import type { AmbientContextProvider } from "./hive-context.js";

const MAX_FETCH_PAGES = 3;
const FETCH_PAGE_SIZE = 100;
const HISTORIC_LOOKBACK_YEARS = 10;
const HISTORIC_FETCH_SIZE = 100;
const MAX_CONTEXT_MESSAGES = 12;
const MAX_EXCERPT_LENGTH = 180;
const MAX_CONTEXT_LENGTH = 2_400;
const DISCORD_EPOCH = 1_420_070_400_000n;
const STOP_WORDS = new Set([
  "about",
  "after",
  "again",
  "because",
  "could",
  "does",
  "dont",
  "from",
  "have",
  "into",
  "just",
  "like",
  "people",
  "should",
  "that",
  "their",
  "there",
  "they",
  "thing",
  "this",
  "what",
  "when",
  "where",
  "which",
  "while",
  "with",
  "would",
]);

export class ChannelAmbientContextProvider implements AmbientContextProvider {
  constructor(private readonly logger: Logger) {}

  async contextFor(prompt: string, message?: Message): Promise<string | null> {
    if (!message || !("messages" in message.channel)) return null;

    const terms = searchTerms(prompt);
    if (terms.length === 0) return null;

    try {
      const messages = await fetchContextMessages(message);
      const excerpts = rankMessages(messages, terms, message.author.id, message.client.user?.id ?? null);
      if (excerpts.length === 0) return null;

      return trimContext([
        message.guild
          ? "Current Discord guild-channel context from prior messages in this same channel, including a bounded slice from about 10 years ago when available. This is not command output and may be incomplete."
          : "Current Discord DM context from prior messages in this one-on-one conversation only. This is not command output and may be incomplete.",
        message.guild
          ? "Use it only as local group-chat background; do not claim perfect memory or quote it as fact unless directly relevant."
          : "Use it only as private DM background. Do not talk as if you are observing a group channel, a room, or public chat unless the user explicitly asks about broader Hive.",
        "Do not infer or claim access to other channels. This context is scoped to the current Discord channel or DM.",
        "For old community context, treat Steem/Steemit references as historical ancestor-context for Hive because the community moved; avoid derailing the reply with that distinction unless it matters.",
        ...excerpts.map((entry, index) => `${index + 1}. ${entry}`),
      ].join("\n"));
    } catch (error) {
      this.logger.warn("Unable to load channel context for LLM.", {
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }
}

export class CompositeAmbientContextProvider implements AmbientContextProvider {
  constructor(private readonly providers: AmbientContextProvider[]) {}

  async contextFor(prompt: string, message?: Message): Promise<string | null> {
    const contexts = await Promise.all(this.providers.map((provider) => provider.contextFor(prompt, message)));
    const present = contexts.filter((context): context is string => Boolean(context));
    return present.length > 0 ? present.join("\n\n") : null;
  }
}

async function fetchContextMessages(message: Message): Promise<Message[]> {
  const [recent, historic] = await Promise.all([
    fetchRecentMessages(message),
    fetchHistoricSlice(message),
  ]);
  const byId = new Map<string, Message>();
  for (const found of [...recent, ...historic]) byId.set(found.id, found);
  return [...byId.values()];
}

async function fetchRecentMessages(message: Message): Promise<Message[]> {
  const channel = message.channel;
  if (!("messages" in channel)) return [];

  const found: Message[] = [];
  let before = message.id;

  for (let page = 0; page < MAX_FETCH_PAGES; page += 1) {
    const batch = await channel.messages.fetch({ limit: FETCH_PAGE_SIZE, before });
    const values = collectionValues(batch);
    if (values.length === 0) break;

    found.push(...values);
    before = values.sort((left, right) => compareSnowflakes(left.id, right.id))[0]?.id ?? before;
  }

  return found;
}

async function fetchHistoricSlice(message: Message): Promise<Message[]> {
  const channel = message.channel;
  if (!("messages" in channel)) return [];

  const target = new Date(message.createdTimestamp || Date.now());
  target.setUTCFullYear(target.getUTCFullYear() - HISTORIC_LOOKBACK_YEARS);
  const around = snowflakeFromTimestamp(target.getTime());
  const batch = await channel.messages.fetch({ limit: HISTORIC_FETCH_SIZE, around });
  return collectionValues(batch);
}

function collectionValues(batch: Collection<string, Message> | Map<string, Message>): Message[] {
  return [...batch.values()];
}

function compareSnowflakes(left: string, right: string): number {
  const leftValue = BigInt(left);
  const rightValue = BigInt(right);
  if (leftValue < rightValue) return -1;
  if (leftValue > rightValue) return 1;
  return 0;
}

function snowflakeFromTimestamp(timestamp: number): string {
  const discordTimestamp = BigInt(Math.max(0, timestamp)) - DISCORD_EPOCH;
  return (discordTimestamp << 22n).toString();
}


function rankMessages(messages: Message[], terms: string[], requesterId: string, botUserId: string | null): string[] {
  return messages
    .filter((message) => !message.author.bot || message.author.id === botUserId)
    .map((message) => ({ message, text: messageSearchText(message) }))
    .filter(({ message, text }) => message.author.id !== requesterId || text.trim().length > 0)
    .map(({ message, text }) => ({ message, text, score: scoreMessage(text, terms) }))
    .filter(({ score }) => score > 0)
    .sort((left, right) => right.score - left.score || right.message.createdTimestamp - left.message.createdTimestamp)
    .slice(0, MAX_CONTEXT_MESSAGES)
    .sort((left, right) => left.message.createdTimestamp - right.message.createdTimestamp)
    .map(({ message, text }) => formatMessage(message, text));
}

function scoreMessage(content: string, terms: string[]): number {
  const normalized = normalize(content);
  return terms.reduce((score, term) => score + (normalized.includes(term) ? 1 : 0), 0);
}

function formatMessage(message: Message, text = messageSearchText(message)): string {
  const author = message.member?.displayName ?? message.author.displayName ?? message.author.username;
  const authorLabel = message.author.bot ? `${author} (bot)` : author;
  const excerpt = trimExcerpt(text.replace(/\s+/g, " ").trim());
  const when = message.createdAt ? message.createdAt.toISOString() : new Date(message.createdTimestamp).toISOString();
  return `${when} ${authorLabel}: ${excerpt}`;
}

function messageSearchText(message: Message): string {
  const embedText = (message.embeds ?? []).flatMap((embed) => [
    embed.title,
    embed.description,
    embed.url,
    ...(embed.fields ?? []).flatMap((field) => [field.name, field.value]),
  ]);
  return [message.content, ...embedText]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .join("\n");
}

function searchTerms(prompt: string): string[] {
  return [...new Set(normalize(prompt).split(" "))]
    .filter((term) => term.length >= 4)
    .filter((term) => !STOP_WORDS.has(term))
    .slice(0, 12);
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9_@$]+/g, " ").trim();
}

function trimExcerpt(value: string): string {
  if (value.length <= MAX_EXCERPT_LENGTH) return value;
  return `${value.slice(0, MAX_EXCERPT_LENGTH - 3).trimEnd()}...`;
}

function trimContext(value: string): string {
  if (value.length <= MAX_CONTEXT_LENGTH) return value;
  return `${value.slice(0, MAX_CONTEXT_LENGTH - 3).trimEnd()}...`;
}
