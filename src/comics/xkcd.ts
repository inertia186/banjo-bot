import type { Logger } from "../logger.js";

export type XkcdComic = {
  num: number;
  title: string;
  safeTitle: string;
  alt: string;
  imageUrl: string;
};

export type XkcdApi = {
  getComic(num: number | null): Promise<XkcdComic | null>;
};

type XkcdResponse = {
  num?: number;
  title?: string;
  safe_title?: string;
  alt?: string;
  img?: string;
};

export class XkcdHttpClient implements XkcdApi {
  constructor(private readonly logger: Logger) {}

  async getComic(num: number | null): Promise<XkcdComic | null> {
    const url = num === null
      ? "https://xkcd.com/info.0.json"
      : `https://xkcd.com/${num}/info.0.json`;

    try {
      const response = await fetch(url);
      if (response.status === 404) return null;
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const payload = (await response.json()) as XkcdResponse;
      if (
        typeof payload.num !== "number"
        || typeof payload.title !== "string"
        || typeof payload.img !== "string"
      ) {
        return null;
      }

      return {
        num: payload.num,
        title: payload.title,
        safeTitle: payload.safe_title || payload.title,
        alt: payload.alt || "",
        imageUrl: payload.img,
      };
    } catch (error) {
      this.logger.warn("xkcd lookup failed.", {
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }
}
