import type { AppConfig } from "../config.js";
import type { Logger } from "../logger.js";

export type GiphyApi = {
  searchGif(query: string): Promise<string | null>;
};

type GiphyImage = {
  images?: {
    original?: {
      url?: string;
    };
  };
};

type GiphySearchResponse = {
  data?: GiphyImage[];
};

export class GiphyHttpClient implements GiphyApi {
  constructor(
    private readonly config: AppConfig,
    private readonly logger: Logger,
  ) {}

  async searchGif(query: string): Promise<string | null> {
    if (!this.config.giphy.apiKey) return null;

    const url = new URL("https://api.giphy.com/v1/gifs/search");
    url.searchParams.set("api_key", this.config.giphy.apiKey);
    url.searchParams.set("q", query);
    url.searchParams.set("limit", "25");
    url.searchParams.set("rating", "pg-13");

    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const payload = (await response.json()) as GiphySearchResponse;
      const urls = (payload.data ?? [])
        .map((image) => image.images?.original?.url)
        .filter((value): value is string => typeof value === "string" && value.length > 0);

      if (urls.length === 0) return null;

      return urls[Math.floor(Math.random() * urls.length)] ?? null;
    } catch (error) {
      this.logger.warn("Giphy lookup failed.", {
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }
}
