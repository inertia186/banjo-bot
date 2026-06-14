import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import type { Message } from "discord.js";
import type { AppConfig } from "../config.js";
import type { Logger } from "../logger.js";
import type { AmbientContextProvider } from "./hive-context.js";

const MAX_WHITEPAPER_PARAGRAPHS = 4;
const MAX_SOURCE_FILES = 6;
const MAX_SOURCE_LINES = 4;
const MAX_FILE_BYTES = 220_000;
const MAX_CONTEXT_LENGTH = 5_000;
const SOURCE_EXTENSIONS = new Set([".c", ".cc", ".cpp", ".h", ".hpp", ".md", ".txt"]);

export class HiveReferenceContextProvider implements AmbientContextProvider {
  constructor(
    private readonly config: AppConfig,
    private readonly logger: Logger,
  ) {}

  async contextFor(prompt: string, _message?: Message): Promise<string | null> {
    if (!wantsHiveReferenceContext(prompt)) return null;

    const missing: string[] = [];
    if (!this.config.hiveReferences.whitepaperPath) missing.push("whitepaper text path");
    if (!this.config.hiveReferences.sourcePath) missing.push("source path");
    if (missing.length > 0) return unavailableReferenceContext(`Hive reference context is not configured (${missing.join(", ")} missing).`);
    const whitepaperPath = this.config.hiveReferences.whitepaperPath;
    const sourcePath = this.config.hiveReferences.sourcePath;
    if (!whitepaperPath || !sourcePath) return unavailableReferenceContext("Hive reference context is not configured.");

    try {
      const [whitepaper, source] = await Promise.all([
        readFreshWhitepaper(whitepaperPath, this.config.hiveReferences.maxAgeDays, prompt),
        readFreshSource(sourcePath, this.config.hiveReferences.maxAgeDays, prompt),
      ]);

      if (whitepaper.status !== "ok" || source.status !== "ok") {
        const reasons = [
          whitepaper.status === "unavailable" ? whitepaper.reason : null,
          source.status === "unavailable" ? source.reason : null,
        ].filter(Boolean).join(" ");
        return unavailableReferenceContext(reasons);
      }

      return trimContext([
        "Local Hive reference context from configured whitepaper text and source checkout. Use this for protocol/source-backed answers. Do not claim these references are exhaustive.",
        "If the answer is not supported by these excerpts, say the local references do not settle it instead of guessing.",
        whitepaper.context,
        source.context,
      ].filter(Boolean).join("\n\n"));
    } catch (error) {
      this.logger.warn("Unable to load Hive reference context for LLM.", {
        error: error instanceof Error ? error.message : String(error),
      });
      return unavailableReferenceContext("Hive reference context could not be loaded.");
    }
  }
}

export function wantsHiveReferenceContext(prompt: string): boolean {
  const value = prompt.toLowerCase();
  const asksForReference = /\b(?:whitepaper|source code|github|implementation|codebase|where in (?:the )?code|according to|cite|prove|precisely|exactly|protocol side|under the hood|seriali[sz]e|serialization|operation shape|custom_json)\b/.test(value);
  return /\bhive\b/.test(value) && asksForReference;
}

function unavailableReferenceContext(reason: string): string {
  return [
    "Hive reference context unavailable.",
    reason,
    "For protocol/source-backed Hive questions, decline to give a definitive answer from local references and suggest the Hive Developer Portal search URL for the topic, e.g. https://developers.hive.io/search/?q=follow.",
  ].join("\n");
}

async function readFreshWhitepaper(path: string, maxAgeDays: number, prompt: string): Promise<{ status: "ok"; context: string } | { status: "unavailable"; reason: string }> {
  const stats = await stat(path);
  if (isOutdated(stats.mtime, maxAgeDays)) return { status: "unavailable", reason: `Configured whitepaper is older than ${maxAgeDays} days.` };

  const text = await readFile(path, "utf8");
  const terms = searchTerms(prompt);
  const paragraphs = text.split(/\n\s*\n+/)
    .map((paragraph) => paragraph.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .map((paragraph) => ({ paragraph, score: scoreText(paragraph, terms) }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, MAX_WHITEPAPER_PARAGRAPHS)
    .map((entry, index) => `${index + 1}. ${truncate(entry.paragraph, 700)}`);

  return {
    status: "ok",
    context: paragraphs.length > 0
      ? `Whitepaper excerpts:\n${paragraphs.join("\n")}`
      : "Whitepaper excerpts: no relevant local excerpt found.",
  };
}

async function readFreshSource(path: string, maxAgeDays: number, prompt: string): Promise<{ status: "ok"; context: string } | { status: "unavailable"; reason: string }> {
  const files = await listSourceFiles(path);
  if (files.length === 0) return { status: "unavailable", reason: "Configured source path has no readable source files." };

  const newestMtime = new Date(Math.max(...files.map((file) => file.mtime.getTime())));
  if (isOutdated(newestMtime, maxAgeDays)) return { status: "unavailable", reason: `Configured source checkout is older than ${maxAgeDays} days.` };

  const terms = searchTerms(prompt);
  const matches = files
    .map((file) => ({
      path: file.path,
      lines: file.text.split("\n"),
      score: scoreText(file.text, terms),
    }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, MAX_SOURCE_FILES)
    .map((entry) => formatSourceMatch(entry.path, entry.lines, terms));

  return {
    status: "ok",
    context: matches.length > 0
      ? `Source excerpts:\n${matches.join("\n\n")}`
      : "Source excerpts: no relevant local source excerpt found.",
  };
}

async function listSourceFiles(root: string): Promise<Array<{ path: string; text: string; mtime: Date }>> {
  const results: Array<{ path: string; text: string; mtime: Date }> = [];
  const pending = [root];

  while (pending.length > 0 && results.length < 1_000) {
    const current = pending.pop();
    if (!current) break;
    const stats = await stat(current).catch(() => null);
    if (!stats) continue;

    if (stats.isDirectory()) {
      const entries = await readdir(current, { withFileTypes: true }).catch(() => []);
      for (const entry of entries) {
        if (entry.name.startsWith(".") || entry.name === "build" || entry.name === "node_modules") continue;
        pending.push(join(current, entry.name));
      }
      continue;
    }

    if (!stats.isFile() || stats.size > MAX_FILE_BYTES || !SOURCE_EXTENSIONS.has(extension(current))) continue;
    const text = await readFile(current, "utf8").catch(() => "");
    if (text.trim()) results.push({ path: current, text, mtime: stats.mtime });
  }

  return results;
}

function formatSourceMatch(path: string, lines: string[], terms: string[]): string {
  const scored = lines
    .map((line, index) => ({ line, index, score: scoreText(line, terms) }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, MAX_SOURCE_LINES)
    .sort((left, right) => left.index - right.index)
    .map((entry) => `${entry.index + 1}: ${truncate(entry.line.trim(), 220)}`);
  return `${path}\n${scored.join("\n")}`;
}

function searchTerms(prompt: string): string[] {
  return [...new Set(prompt.toLowerCase().replace(/[^a-z0-9_]+/g, " ").split(/\s+/))]
    .filter((term) => term.length >= 4)
    .filter((term) => !["hive", "what", "when", "where", "does", "source", "code", "whitepaper", "exactly"].includes(term))
    .slice(0, 16);
}

function scoreText(text: string, terms: string[]): number {
  const value = text.toLowerCase();
  return terms.reduce((score, term) => score + (value.includes(term) ? 1 : 0), 0);
}

function isOutdated(mtime: Date, maxAgeDays: number): boolean {
  if (maxAgeDays === 0) return false;
  return Date.now() - mtime.getTime() > maxAgeDays * 24 * 60 * 60 * 1000;
}

function extension(path: string): string {
  const match = path.toLowerCase().match(/\.[^.]+$/);
  return match?.[0] ?? "";
}

function truncate(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 3).trimEnd()}...`;
}

function trimContext(value: string): string {
  return value.length <= MAX_CONTEXT_LENGTH ? value : `${value.slice(0, MAX_CONTEXT_LENGTH - 3).trimEnd()}...`;
}
