import OpenAI from "openai";
import type { Response, ResponseCreateParamsNonStreaming } from "openai/resources/responses/responses";
import type { AppConfig } from "../config.js";
import type { HivePost } from "../hive/api.js";
import type { Logger } from "../logger.js";

const POST_SUMMARY_BODY_LIMIT = 8_000;
const POST_SUMMARY_REPLY_LIMIT = 1_000;

type OpenAiResponsesClient = {
  responses: {
    create(body: ResponseCreateParamsNonStreaming): Promise<Pick<Response, "output_text">>;
  };
};

export type HivePostSummarizer = {
  summarizePost(post: HivePost): Promise<string | null>;
};

export class OpenAiHivePostSummarizer implements HivePostSummarizer {
  private readonly client: OpenAiResponsesClient | null;

  constructor(
    private readonly config: AppConfig,
    private readonly logger: Logger,
    client?: OpenAiResponsesClient | null,
  ) {
    this.client = client !== undefined ? client :
      config.llm.enabled && config.llm.openAiApiKey
        ? new OpenAI({ apiKey: config.llm.openAiApiKey })
        : null;
  }

  async summarizePost(post: HivePost): Promise<string | null> {
    if (!this.client) return null;

    try {
      const response = await this.client.responses.create({
        model: this.config.llm.model,
        max_output_tokens: Math.max(256, this.config.llm.maxOutputTokens),
        instructions: [
          "Summarize the Hive post for a Discord chat.",
          "Use only the provided post text and metadata.",
          "Be concise, useful, and concrete. Prefer 2-4 short bullets.",
          "Do not claim to have opened a URL or browsed the web.",
        ].join(" "),
        input: [{
          role: "user",
          content: [
            `Post: @${post.author}/${post.permlink}`,
            post.title ? `Title: ${post.title}` : null,
            post.created ? `Created: ${post.created}` : null,
            post.json_metadata ? `JSON metadata: ${post.json_metadata}` : null,
            `Body:\n${trimPostBody(post.body ?? "")}`,
          ].filter(Boolean).join("\n\n"),
        }],
      });

      return trimSummary(response.output_text);
    } catch (error) {
      this.logger.warn("LLM post summary failed.", {
        error: error instanceof Error ? error.message : String(error),
        post: `@${post.author}/${post.permlink}`,
      });
      return null;
    }
  }
}

function trimPostBody(body: string): string {
  const trimmed = body.trim();
  if (trimmed.length <= POST_SUMMARY_BODY_LIMIT) return trimmed;
  return `${trimmed.slice(0, POST_SUMMARY_BODY_LIMIT - 3).trimEnd()}...`;
}

function trimSummary(text: string | null | undefined): string | null {
  const trimmed = text?.trim();
  if (!trimmed) return null;
  if (trimmed.length <= POST_SUMMARY_REPLY_LIMIT) return trimmed;
  return `${trimmed.slice(0, POST_SUMMARY_REPLY_LIMIT - 3).trimEnd()}...`;
}
