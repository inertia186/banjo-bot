import OpenAI from "openai";
import type { Message } from "discord.js";
import type { AppConfig } from "../config.js";
import type { Logger } from "../logger.js";

type ChatTurn = {
  role: "user" | "assistant";
  content: string;
};

export class LlmChat {
  private readonly client: OpenAI | null;
  private readonly histories = new Map<string, ChatTurn[]>();

  constructor(
    private readonly config: AppConfig,
    private readonly logger: Logger,
  ) {
    this.client =
      config.llm.enabled && config.llm.openAiApiKey
        ? new OpenAI({ apiKey: config.llm.openAiApiKey })
        : null;
  }

  get enabled(): boolean {
    return this.config.llm.enabled && this.client !== null;
  }

  async replyTo(message: Message, prompt: string): Promise<string | null> {
    if (!this.client) return null;

    const historyKey = conversationKey(message);
    const history = this.histories.get(historyKey) ?? [];
    const userName = message.member?.displayName ?? message.author.displayName ?? message.author.username;
    const userTurn = `${userName}: ${prompt}`;

    try {
      const response = await this.client.chat.completions.create({
        model: this.config.llm.model,
        max_tokens: this.config.llm.maxOutputTokens,
        messages: [
          {
            role: "system",
            content: [
              "You are Banjo, a friendly Discord bot for a Hive community.",
              "Reply conversationally and keep answers compact.",
              "You can be playful, but do not pretend to perform moderation, voting, wallet, or admin actions.",
              "When a user asks for a bot command, suggest the relevant $ command instead of inventing behavior.",
            ].join(" "),
          },
          ...history,
          { role: "user", content: userTurn },
        ],
      });

      const content = response.choices[0]?.message.content?.trim();
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

  private remember(historyKey: string, turn: ChatTurn) {
    const maxTurns = this.config.llm.maxHistory * 2;
    const history = [...(this.histories.get(historyKey) ?? []), turn].slice(-maxTurns);
    this.histories.set(historyKey, history);
  }
}

function conversationKey(message: Message): string {
  const channelId = message.channel.id;
  const guildId = message.guild?.id ?? "dm";
  return `${guildId}:${channelId}:${message.author.id}`;
}
