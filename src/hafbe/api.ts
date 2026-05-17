import type { AppConfig } from "../config.js";
import type { Logger } from "../logger.js";

export type HafbePost = {
  author: string;
  permlink: string;
  timestamp: string;
  block: number;
};

export type HafbeApi = {
  getFirstPost(account: string, offset: number): Promise<HafbePost | null>;
};

type CommentPermlink = {
  permlink: string;
  block: number;
  timestamp: string;
};

type CommentPermlinkHistory = {
  total_permlinks: number;
  permlinks_result: CommentPermlink[];
};

export class HafbeRestClient implements HafbeApi {
  private readonly pageSize = 100;

  constructor(
    private readonly config: AppConfig,
    private readonly logger: Logger,
  ) {}

  async getFirstPost(account: string, offset: number): Promise<HafbePost | null> {
    const firstPage = await this.getCommentPermlinks(account, 1, this.pageSize);
    const total = firstPage.total_permlinks;
    if (total <= offset) return null;

    const page = Math.ceil((total - offset) / this.pageSize);
    const index = (total - offset - 1) % this.pageSize;
    const history = page === 1 ? firstPage : await this.getCommentPermlinks(account, page, this.pageSize);
    const result = history.permlinks_result[index];

    return result
      ? {
          author: account,
          permlink: result.permlink,
          timestamp: result.timestamp,
          block: result.block,
        }
      : null;
  }

  private async getCommentPermlinks(account: string, page: number, pageSize: number): Promise<CommentPermlinkHistory> {
    if (!this.config.hafbe.baseUrl) {
      throw new Error("HAFBE_BASE_URL is not configured.");
    }

    const url = new URL(`${this.config.hafbe.baseUrl}/accounts/${encodeURIComponent(account)}/comment-permlinks`);
    url.searchParams.set("comment-type", "post");
    url.searchParams.set("page", String(page));
    url.searchParams.set("page-size", String(pageSize));

    const response = await fetch(url, {
      headers: { accept: "application/json" },
    });

    if (response.status === 404) {
      return { total_permlinks: 0, permlinks_result: [] };
    }
    if (!response.ok) {
      const body = await response.text();
      this.logger.warn("HAFBE request failed.", {
        status: response.status,
        body: body.slice(0, 500),
      });
      throw new Error(`HAFBE request failed with HTTP ${response.status}.`);
    }

    return (await response.json()) as CommentPermlinkHistory;
  }
}
