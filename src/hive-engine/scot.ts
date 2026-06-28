import type { AppConfig } from "../config.js";
import type { Logger } from "../logger.js";

export type ScotApi = {
  getConfig(): Promise<ScotConfigEntry[]>;
  getTrendingDiscussions(symbol: string, limit: number): Promise<ScotDiscussion[]>;
  getAccountHistory(account: string, symbol: string, limit: number): Promise<ScotAccountHistoryEntry[]>;
};

export type ScotConfigEntry = {
  token: string;
  hive_community?: string | null;
  json_metadata_key?: string | null;
  json_metadata_value?: string | null;
};

export type ScotDiscussion = {
  author?: string;
  pending_token?: number;
  precision?: number;
};

export type ScotAccountHistoryEntry = {
  token?: string;
  type?: string;
  timestamp?: string;
  int_amount?: number;
  precision?: number;
};

export class ScotHttpClient implements ScotApi {
  constructor(
    private readonly config: AppConfig,
    private readonly logger: Logger,
  ) {}

  async getConfig(): Promise<ScotConfigEntry[]> {
    const response = await fetch(`${this.config.hiveEngine.scotApiUrl}/config`);
    if (!response.ok) throw new Error(`SCOT API HTTP ${response.status}`);

    const payload = (await response.json()) as unknown;
    return Array.isArray(payload) ? payload.filter(isScotConfigEntry) : [];
  }

  async getTrendingDiscussions(symbol: string, limit: number): Promise<ScotDiscussion[]> {
    const url = new URL(`${this.config.hiveEngine.scotApiUrl}/get_discussions_by_trending`);
    url.searchParams.set("token", symbol);
    url.searchParams.set("limit", String(limit));
    url.searchParams.set("hive", "1");

    const response = await fetch(url);
    if (!response.ok) throw new Error(`SCOT API HTTP ${response.status}`);

    const payload = (await response.json()) as unknown;
    return Array.isArray(payload) ? payload.filter(isScotDiscussion) : [];
  }

  async getAccountHistory(account: string, symbol: string, limit: number): Promise<ScotAccountHistoryEntry[]> {
    const url = new URL(`${this.config.hiveEngine.scotApiUrl}/get_account_history`);
    url.searchParams.set("account", account);
    url.searchParams.set("limit", String(limit));
    url.searchParams.set("token", symbol);
    url.searchParams.set("hive", "1");

    const response = await fetch(url);
    if (!response.ok) throw new Error(`SCOT API HTTP ${response.status}`);

    const payload = (await response.json()) as unknown;
    return Array.isArray(payload) ? payload.filter(isScotAccountHistoryEntry) : [];
  }
}

function isScotConfigEntry(value: unknown): value is ScotConfigEntry {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return typeof record.token === "string";
}

function isScotDiscussion(value: unknown): value is ScotDiscussion {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return hasOptionalString(record, "author")
    && hasOptionalNumber(record, "pending_token")
    && hasOptionalNumber(record, "precision");
}

function isScotAccountHistoryEntry(value: unknown): value is ScotAccountHistoryEntry {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return hasOptionalString(record, "token")
    && hasOptionalString(record, "type")
    && hasOptionalString(record, "timestamp")
    && hasOptionalNumber(record, "int_amount")
    && hasOptionalNumber(record, "precision");
}

function hasOptionalString(record: Record<string, unknown>, key: string): boolean {
  return record[key] === undefined || typeof record[key] === "string";
}

function hasOptionalNumber(record: Record<string, unknown>, key: string): boolean {
  return record[key] === undefined || typeof record[key] === "number";
}
