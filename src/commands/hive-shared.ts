import type { AppConfig } from "../config.js";
import { HiveRpcClient, type HiveApi, type HivePost } from "../hive/api.js";
import { HafSqlClient } from "../hafsql/api.js";
import { HiveSqlClient, type HiveSqlApi } from "../hivesql/api.js";
import type { Logger } from "../logger.js";
import { truncateEmbedText } from "./embeds.js";
import type { CommandContext } from "./types.js";

export const HIVE_TOKEN_ICON_URL = "https://assets.coingecko.com/coins/images/10840/standard/logo_transparent_4x.png";

export function hiveApi(context: CommandContext): HiveApi {
  return context.services?.hive ?? new HiveRpcClient(context.config, context.logger);
}

export function hiveSqlApi(context: CommandContext): HiveSqlApi | null {
  if (context.services?.hiveSql) return context.services.hiveSql;
  return configuredHistoryApi(context.config, context.logger);
}

export function configuredHistoryApi(config: AppConfig, logger: Logger): HiveSqlApi | null {
  if (config.hiveSql.provider === "hafsql") {
    if (!config.hafSql.enabled) return null;
    return new HafSqlClient(config, logger);
  }
  if (!config.hiveSql.enabled) return null;
  return new HiveSqlClient(config, logger);
}

export function historyProviderName(hiveSql: HiveSqlApi): string {
  return hiveSql.providerName ?? "HiveSQL";
}

export function configuredHistoryProviderName(context: CommandContext): string {
  return context.config.hiveSql.provider === "hafsql" ? "HafSQL" : "HiveSQL";
}

export function unsupportedHafSqlLookup(hiveSql: HiveSqlApi, lookup: string): string | null {
  return historyProviderName(hiveSql) === "HafSQL"
    ? `HafSQL ${lookup} is not implemented yet; switch HIVE_HISTORY_PROVIDER to hivesql for this command.`
    : null;
}

export function requireAccountName(args: string[]): string {
  const accountName = args[0]?.replace(/^@/, "").toLowerCase();
  if (!accountName) {
    throw new UserFacingCommandError("Please provide a Hive account name.");
  }
  return accountName;
}

export function unique(values: string[]): string[] {
  return [...new Set(values)];
}

export function pluralize(count: number, singular: string): string {
  return `${count} ${singular}${count === 1 ? "" : "s"}`;
}

export function parsePossiblyDoubleJson(value: string | null): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    if (typeof parsed === "string") return parsePossiblyDoubleJson(parsed);
    return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

export function normalizeMetadataUrl(value: string): string {
  return /^https?:\/\//i.test(value) ? value : `https://${value}`;
}

export function proposalPostPreview(post: HivePost | null): { description?: string; image?: string } {
  if (!post) return {};

  const metadata = parsePossiblyDoubleJson(post.json_metadata ?? null);
  const description = readMetadataDescription(metadata) ?? postBodyExcerpt(post.body);
  const image = readMetadataImage(metadata);

  return {
    ...(description ? { description: truncateEmbedText(description, 600) } : {}),
    ...(image ? { image } : {}),
  };
}

function readMetadataDescription(metadata: Record<string, unknown>): string | null {
  const description = metadata.description;
  return typeof description === "string" && description.trim() ? description.trim() : null;
}

function readMetadataImage(metadata: Record<string, unknown>): string | null {
  const image = metadata.image;
  if (typeof image === "string" && image.trim()) return normalizeMetadataUrl(image.trim());
  if (Array.isArray(image)) {
    const first = image.find((value) => typeof value === "string" && value.trim());
    return typeof first === "string" ? normalizeMetadataUrl(first.trim()) : null;
  }

  return null;
}

function postBodyExcerpt(body: string | undefined): string | null {
  if (!body) return null;
  const text = body
    .replace(/!\[[^\]]*]\([^)]*\)/g, "")
    .replace(/\[[^\]]+]\(([^)]+)\)/g, "$1")
    .replace(/[#>*_`~]/g, "")
    .replace(/\s+/g, " ")
    .trim();

  return text || null;
}

export function parseHiveDate(value: string): Date {
  return new Date(value.endsWith("Z") ? value : `${value}Z`);
}

export function truncateText(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 3)}...`;
}

export function unknownAccount(accountName: string): string {
  return `Could not find Hive account **${accountName}**.`;
}

export function formatRelativeAge(date: Date, now = new Date()): string {
  const seconds = Math.max(0, Math.floor((now.getTime() - date.getTime()) / 1000));
  return formatDuration(seconds);
}

export function formatRelativeTime(date: Date, now = new Date()): string {
  const seconds = Math.floor((date.getTime() - now.getTime()) / 1000);
  const suffix = seconds >= 0 ? "from now" : "ago";
  return `${formatDuration(Math.abs(seconds))} ${suffix}`;
}

export function formatDuration(seconds: number): string {
  const units = [
    ["year", 365 * 24 * 60 * 60],
    ["month", 30 * 24 * 60 * 60],
    ["day", 24 * 60 * 60],
    ["hour", 60 * 60],
    ["minute", 60],
  ] as const;

  for (const [name, unitSeconds] of units) {
    const value = Math.floor(seconds / unitSeconds);
    if (value >= 1) return `${value} ${name}${value === 1 ? "" : "s"}`;
  }

  return "less than a minute";
}

export function formatUtc(date: Date): string {
  return date.toISOString().replace("T", " ").slice(0, 16);
}

export function calculateHivePerMvest(totalFund: string, totalShares: string): number | null {
  const totalVestingFundHive = parseAsset(totalFund);
  const totalVestingSharesMvest = parseAsset(totalShares) / 1_000_000;
  if (totalVestingFundHive <= 0 || totalVestingSharesMvest <= 0) return null;

  return totalVestingFundHive / totalVestingSharesMvest;
}

export function parseAsset(value: string | undefined): number {
  if (!value) return 0;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function parseHiveAssetAmount(value: string | { amount: string; precision: number } | undefined): number {
  if (!value) return 0;
  if (typeof value === "string") return parseAsset(value);

  const amount = Number.parseFloat(value.amount);
  if (!Number.isFinite(amount)) return 0;

  return amount / 10 ** value.precision;
}

export function formatNumber(value: number, digits: number): string {
  return value.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export function formatInteger(value: number): string {
  return value.toLocaleString("en-US", {
    maximumFractionDigits: 0,
  });
}

export class UserFacingCommandError extends Error {}
