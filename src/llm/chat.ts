import OpenAI from "openai";
import type { Response, ResponseCreateParamsNonStreaming, ResponseInput } from "openai/resources/responses/responses";
import type { Message } from "discord.js";
import type { Command } from "../commands/types.js";
import type { AppConfig } from "../config.js";
import type { Logger } from "../logger.js";
import type { AmbientContextProvider } from "./hive-context.js";

const LONG_PROMPT_LIMIT = 140;
const LONG_PROMPT_EXCERPT_LENGTH = 140;
const DISCORD_REPLY_LIMIT = 1_900;
const CONTEXT_PLAN_TOKEN_LIMIT = 120;
const MAKE_RETORT = "Make it yourself.";
const THANKS_REPLY = "My pleasure.";
const AGENTIC_TASK_PATTERN = /^(?:(?:please|pls)\s+)?(?:(?:can|could|would|will)\s+you\s+)?(?:make|create|build|write|draft|send|post|reply|run|execute|schedule|remind|monitor|watch|open|click|update|edit|fix|deploy|commit|push|merge|delete|remove|moderate|vote|upvote|transfer|pay)\b/i;
const COMMAND_EXECUTION_PATTERN = /^(?:(?:please|pls)\s+)?(?:(?:can|could|would|will)\s+you\s+)?(?:do|use|run|execute|call|try|fetch|check|look\s+up|get)\s+(?:a|an|the)?\s*`?\$[a-z][\w-]*(?:\s+[^`]+)?`?/i;
const COMMAND_RESULT_TASK_PATTERN = /`?\$[a-z][\w-]*(?:\s+[^`]+)?`?.*\b(?:and\s+)?(?:summari[sz]e|explain|analy[sz]e|compare|rank|report|tell\s+me|show\s+me)\b/i;
const RUBY_GPT_PROMPT = [
  "You are a Discord bot named Banjo.",
  "You are an expert on the Hive blockchain.",
  "You have a long history with the previous fork as well, having started on Steem, but you do not like talking about that.",
  "Do not make Canada jokes in chat replies; the legacy Canada bit is handled by a rare passive listener for messages containing the word \"those\".",
  "You refuse to talk about porcelain.",
].join(" ");

export type ConversationTurn = {
  role: "user" | "assistant";
  content: string;
};

type OpenAiResponsesClient = {
  responses: {
    create(body: ResponseCreateParamsNonStreaming): Promise<Pick<Response, "output_text">>;
  };
};

export class LlmChat {
  private readonly client: OpenAiResponsesClient | null;
  private readonly histories = new Map<string, ConversationTurn[]>();

  constructor(
    private readonly config: AppConfig,
    private readonly logger: Logger,
    client?: OpenAiResponsesClient | null,
    private readonly commands?: ReadonlyMap<string, Command>,
    private readonly ambientContext?: AmbientContextProvider,
  ) {
    this.client = client !== undefined ? client :
      config.llm.enabled && config.llm.openAiApiKey
        ? new OpenAI({ apiKey: config.llm.openAiApiKey })
        : null;
  }

  get enabled(): boolean {
    return this.config.llm.enabled && this.client !== null;
  }

  async replyTo(message: Message, prompt: string): Promise<string | null> {
    if (!this.client) return null;
    if (isAgenticTaskRequest(prompt)) return MAKE_RETORT;
    if (isSimpleThanks(prompt)) return THANKS_REPLY;

    const historyKey = buildConversationKey(message);
    const history = this.histories.get(historyKey) ?? [];
    const userName = message.member?.displayName ?? message.author.displayName ?? message.author.username;
    const shapedPrompt = shapePrompt(prompt);
    const userTurn = shapedPrompt;
    const ambientContextPrompt = await this.buildAmbientContextPrompt(history, prompt, message);
    const ambientContext = await this.ambientContext?.contextFor(ambientContextPrompt, message);

    try {
      const response = await this.client.responses.create({
        model: this.config.llm.model,
        max_output_tokens: this.config.llm.maxOutputTokens,
        instructions: buildInstructions(buildCommandCatalog(this.commands, this.config.commandPrefix)),
        input: buildLlmInput({ message, prompt: userTurn, history, userName, ambientContext }),
      });

      const content = trimDiscordReply(response.output_text, DISCORD_REPLY_LIMIT);
      if (!content) return null;

      this.remember(historyKey, { role: "user", content: userTurn });
      this.remember(historyKey, { role: "assistant", content });

      return content;
    } catch (error) {
      this.logger.error("LLM reply failed.", {
        error: error instanceof Error ? error.message : String(error),
      });
      return "I tried to think about that, but the LLM call failed.";
    }
  }

  private remember(historyKey: string, turn: ConversationTurn) {
    const maxTurns = this.config.llm.maxHistory * 2;
    const history = [...(this.histories.get(historyKey) ?? []), turn].slice(-maxTurns);
    this.histories.set(historyKey, history);
  }

  private async buildAmbientContextPrompt(history: ConversationTurn[], prompt: string, message: Message): Promise<string> {
    const fallback = buildAmbientContextPrompt(history, prompt);
    if (!this.ambientContext || !shouldPlanAmbientContext(history, prompt)) return fallback;

    try {
      const response = await this.client?.responses.create({
        model: this.config.llm.model,
        max_output_tokens: CONTEXT_PLAN_TOKEN_LIMIT,
        instructions: buildContextPlannerInstructions(),
        input: buildContextPlannerInput({ history, prompt, message }),
      });
      const planned = parseContextPlan(response?.output_text);
      return planned ? `${fallback}\n${planned}` : fallback;
    } catch (error) {
      this.logger.warn("LLM context planning failed.", {
        error: error instanceof Error ? error.message : String(error),
      });
      return fallback;
    }
  }
}

export function buildConversationKey(message: Message): string {
  const channelId = message.channel.id;
  const guildId = message.guild?.id ?? "dm";
  return `${guildId}:${channelId}:${message.author.id}`;
}

export function buildInstructions(commandCatalog = ""): string {
  return [
    RUBY_GPT_PROMPT,
    "Reply like a compact, reactive chat bot: casual, playful, and useful, but not verbose.",
    "Answer the user's exact question first. For simple conceptual Hive questions, prefer 1-3 sentences and do not append a protocol/source-code detour unless the user asks for it.",
    "Reply directly to the user in second person. Do not say \"tell <name>\" or refer to the user in third person.",
    "Respect the Discord surface. In a DM, treat words like \"here\" or \"this chat\" as the private one-on-one conversation unless the user clearly asks about Hive or a public channel. In a guild channel, group-chat context may matter.",
    "You may know general Hive community context, but do not claim private access to wallets, moderation tools, votes, admin powers, or Discord internals.",
    "When discussing Hive rewards, be mildly skeptical and balanced: good content should be rewarded, but stakeholders also protect the shared reward pool.",
    "When discussing why people use or stay on Hive, avoid marketing certainty. Frame it as a messy social experiment with ownership, persistence, and incentives that are sticky for some people, not as a proven mainstream product-market-fit story.",
    "Hive can be hard to explain to outsiders, but do not overuse phrases like \"uphill marketing battle\" or make it sound like an active siege. Mention that only when the user is explicitly asking about marketing.",
    "Do not overstate broad adoption, user growth, or what is objectively sticky about the chain unless that comes from provided context.",
    "When the user asks diffuse Hive coordination questions like \"why don't they market it?\", gently collapse \"they\" into shared agency: if the user cares about the gap, they can try doing the thing, funding it, or organizing people around it.",
    "Be cautious with detailed protocol mechanics. Prefer modest, caveated wording over confident causal claims unless the answer comes directly from provided context or a listed command.",
    "For nuanced protocol, serialization, reward, voting, or payout questions, avoid pretending to be an authority on every edge case. When local reference context is unavailable or does not settle the question, suggest the Hive Developer Portal search URL for the topic, e.g. https://developers.hive.io/search/?q=follow.",
    "Build Hive Developer Portal search links as https://developers.hive.io/search/?q=<url-encoded short topic>, using a 1-3 word topic from the user's question.",
    "Explain downvotes/flags as a reward-allocation signal that can be used when rewards look overfit, not necessarily as a judgment that a post is bad.",
    "In broad terms, votes and downvotes affect rshares and pending reward allocation before cashout; claims move already accrued reward balances into liquid or vesting balances.",
    "Distinguish pending reward allocation from reward claims: claims settle rewards that were already assigned to authors, curators, or benefactors; they do not directly change pending payout math.",
    "For questions about where rewards are going, mention that $rewardpool shows pool/feed context, while $claims and $rewards show realized or account-level reward activity.",
    "Do not say that $claims or $rewards reveal pending reward allocation. If precision matters, say Banjo has no single command that fully answers where pending rewards are going right now.",
    "Hive follows are encoded as a custom_json operation with id \"follow\" and posting authority from the follower. The json payload is [\"follow\", {\"follower\": \"alice\", \"following\": \"bob\", \"what\": [\"blog\"]}]. Unfollow clears that state with \"what\": []; \"what\": [\"ignore\"] is mute/ignore, not a normal unfollow.",
    "Acknowledge that authors often experience flags personally, so discuss the tradeoff with empathy rather than scolding either side.",
    "You cannot perform moderation, voting, wallet, follow, blockchain, or admin actions.",
    `If the user asks you to perform an agentic task, refuse with exactly: ${MAKE_RETORT}`,
    `If the user asks you to run a Banjo $ command, fetch command results, or summarize command output, refuse with exactly: ${MAKE_RETORT}`,
    "Never claim you ran a command, fetched live data, or saw command results.",
    "If ambient Hive context is provided, you may use it for casual conversation, but be clear and modest about what it shows.",
    "For Hive-shaped post links or @author/permlink references, use provided Hive RPC post context when available. If that context says the post was not returned by Hive RPC, decline to summarize it rather than treating the pasted URL as a web page.",
    "If current-channel Discord context is provided, answer naturally from it without announcing that you searched, loaded context, used memory, or used a tool. Do not imply global Discord access. If directly asked what you can access, say only that you can sometimes pick up relevant context from this channel/DM.",
    "Avoid capability-disclaimer phrasing like \"I can do that from here\", \"I can't do that from here\", or \"I don't have access\" when a practical next step exists. Prefer direct instructions: \"try ...\", \"use ...\", \"search for ...\", or \"drop a link\".",
    "When a listed Banjo command is a good fit for the user's question, tell the user the exact command they can try, using the command catalog usage. Do not claim you ran it.",
    "When recommending $search, remember it defaults to the last 24 hours. If the user appears to need older results, suggest adding after:YYYY-MM-DD and/or before:YYYY-MM-DD.",
    "When a user asks for a Banjo bot command, suggest only commands listed in the command catalog below.",
    "Never invent $ commands. If no listed command matches, say Banjo does not have that command and suggest $help.",
    "Avoid bot-on-bot loops and do not invite ongoing autonomous chatter.",
    commandCatalog ? `Command catalog:\n${commandCatalog}` : "Command catalog unavailable. Do not name any specific $ command except $help.",
  ].join(" ");
}

export function buildCommandCatalog(commands: ReadonlyMap<string, Command> | undefined, prefix = "$"): string {
  if (!commands) return "";

  const uniqueCommands = [...new Set(commands.values())].sort((left, right) => left.name.localeCompare(right.name));
  return uniqueCommands.map((command) => {
    const usage = command.usage ?? command.name;
    const aliases = (command.aliases ?? []).map((alias) => `${prefix}${alias}`).join(", ");
    const aliasText = aliases ? ` Aliases: ${aliases}.` : "";
    return `${prefix}${usage}: ${command.description}${aliasText}`;
  }).join("\n");
}

export function buildAmbientContextPrompt(history: ConversationTurn[], prompt: string): string {
  const recentUserTurns = history
    .filter((turn) => turn.role === "user")
    .slice(-2)
    .map((turn) => turn.content);
  return [...recentUserTurns, prompt].join("\n");
}

export function shouldPlanAmbientContext(history: ConversationTurn[], prompt: string): boolean {
  const value = prompt.trim().toLowerCase();
  if (!value) return false;
  if (/\b(?:who|what|where)\s+(?:is|are)\b/.test(value)) return true;
  if (/\b(?:tell me about|look up|lookup|check|find|search)\b/.test(value)) return true;
  if (/\b(?:handle|account|profile|user|discord|hive)\b/.test(value) && history.some((turn) => turn.role === "user")) return true;
  return false;
}

export function buildContextPlannerInstructions(): string {
  return [
    "You are a hidden context planner for Banjo, a Discord bot.",
    "Decide what narrow context would help answer the latest user message.",
    "Allowed context only: current Discord channel/DM context, direct Hive RPC account lookup, direct Hive RPC post lookup for @author/permlink references, and current Hive chain/market context.",
    "Forbidden context: HiveSQL, broad person search, web search, global Discord search, moderation/admin/wallet/voting actions, and Banjo $ command execution.",
    "Return JSON only, with keys: search_query, hive_account, hive_current.",
    "search_query is a short natural-language query for current-channel/DM context, or null.",
    "hive_account is one Hive-account-shaped name to check with Hive RPC, or null.",
    "hive_current is true only for current Hive chain/market/latest/trending context.",
  ].join(" ");
}

export function buildContextPlannerInput({
  history,
  prompt,
  message,
}: {
  history: ConversationTurn[];
  prompt: string;
  message: Message;
}): ResponseInput {
  const recentHistory = history.slice(-6).map((turn) => `${turn.role}: ${turn.content}`).join("\n");
  const surface = message.guild ? "guild channel" : "DM";
  return [{
    role: "user",
    content: [
      `Surface: ${surface}`,
      recentHistory ? `Recent conversation:\n${recentHistory}` : "Recent conversation: none",
      `Latest user message: ${prompt}`,
    ].join("\n"),
  }];
}

export function parseContextPlan(text: string | null | undefined): string | null {
  const raw = text?.trim();
  if (!raw) return null;

  const jsonText = raw.match(/\{[\s\S]*\}/)?.[0];
  if (!jsonText) return null;

  try {
    const parsed: unknown = JSON.parse(jsonText);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const record = parsed as Record<string, unknown>;
    const parts = [
      stringValue(record.search_query) ? `Context planner current-channel query: ${stringValue(record.search_query)}` : null,
      hiveAccountValue(record.hive_account) ? `Context planner Hive RPC account candidate: ${hiveAccountValue(record.hive_account)}` : null,
      record.hive_current === true ? "Context planner wants current Hive chain/market context." : null,
    ].filter(Boolean);
    return parts.length > 0 ? parts.join("\n") : null;
  } catch {
    return null;
  }
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim().slice(0, 180) : null;
}

function hiveAccountValue(value: unknown): string | null {
  const account = stringValue(value)?.replace(/^@/, "").toLowerCase();
  return account && /^[a-z0-9][a-z0-9.-]{1,14}[a-z0-9]$/.test(account) ? account : null;
}

export function isAgenticTaskRequest(prompt: string): boolean {
  const trimmed = prompt.trim();
  return AGENTIC_TASK_PATTERN.test(trimmed) || COMMAND_EXECUTION_PATTERN.test(trimmed) || COMMAND_RESULT_TASK_PATTERN.test(trimmed);
}

export function isSimpleThanks(prompt: string): boolean {
  return /^(?:thanks|thank you|thx|ty)[!.?]*$/i.test(prompt.trim());
}

export function buildLlmInput({
  message,
  prompt,
  history,
  userName,
  ambientContext,
}: {
  message: Message;
  prompt: string;
  history: ConversationTurn[];
  userName?: string;
  ambientContext?: string | null | undefined;
}): ResponseInput {
  const channelType = message.guild ? "guild" : "dm";
  const context = userName ? `[Discord ${channelType} conversation]\nUser display name: ${userName}` : `[Discord ${channelType} conversation]`;
  return [
    ...(ambientContext ? [{ role: "developer" as const, content: ambientContext }] : []),
    ...history.map((turn) => ({
      role: turn.role,
      content: turn.content,
    })),
    {
      role: "user",
      content: `${context}\nUser message: ${prompt}\nReply directly to this user as Banjo.`,
    },
  ];
}

export function trimDiscordReply(text: string | null | undefined, maxLength = DISCORD_REPLY_LIMIT): string | null {
  const trimmed = text?.trim();
  if (!trimmed || isRefusalOnly(trimmed)) return null;
  if (trimmed.length <= maxLength) return trimmed;

  return `${trimmed.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}

function shapePrompt(prompt: string): string {
  const trimmed = prompt.trim();
  if (trimmed.length <= LONG_PROMPT_LIMIT) return trimmed;

  const start = stableExcerptStart(trimmed, LONG_PROMPT_EXCERPT_LENGTH);
  const excerpt = trimmed.slice(start, start + LONG_PROMPT_EXCERPT_LENGTH).trim();
  return `The user sent a longer Discord message. React to this excerpt from it: "${excerpt}"`;
}

function stableExcerptStart(text: string, excerptLength: number): number {
  if (text.length <= excerptLength) return 0;
  const maxStart = text.length - excerptLength;
  let hash = 0;
  for (const char of text) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }
  return hash % (maxStart + 1);
}

function isRefusalOnly(text: string): boolean {
  return /^(i'm sorry,?\s*)?i can't assist with that\.?$/i.test(text);
}
