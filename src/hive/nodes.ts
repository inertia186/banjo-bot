import type { AppConfig } from "../config.js";
import type { Logger } from "../logger.js";

export type HiveNode = {
  url: string;
  owner?: string;
};

export type HiveNodeDirectory = {
  getPublicNodes(): Promise<HiveNode[]>;
};

export class HiveDeveloperNodeDirectory implements HiveNodeDirectory {
  constructor(
    private readonly config: AppConfig,
    private readonly logger: Logger,
  ) {}

  async getPublicNodes(): Promise<HiveNode[]> {
    try {
      const response = await fetch(this.config.hive.nodesSourceUrl);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const nodes = parseHiveDeveloperNodes(await response.text());
      if (nodes.length === 0) throw new Error("No public nodes found in directory response.");

      return nodes;
    } catch (error) {
      this.logger.warn("Hive node directory lookup failed.", {
        error: error instanceof Error ? error.message : String(error),
      });

      return fallbackNodes(this.config);
    }
  }
}

function fallbackNodes(config: AppConfig): HiveNode[] {
  return config.hive.nodes.map((url) => ({ url }));
}

export function parseHiveDeveloperNodes(html: string): HiveNode[] {
  const section = html.match(/Public Nodes([\s\S]*?)Private Nodes/i)?.[1];
  if (!section) return [];

  const text = section
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, "\n")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
  const nodes: HiveNode[] = [];
  const seen = new Set<string>();
  const tokens = text.split(/\s+/).map((token) => token.trim()).filter(Boolean);

  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    if (!token) continue;

    const joined = token.match(/^([a-z0-9][a-z0-9.-]+\.[a-z]{2,})@([a-z0-9][a-z0-9.-]*)$/i);
    const split = token.match(/^([a-z0-9][a-z0-9.-]+\.[a-z]{2,})$/i);
    const owner = tokens[index + 1]?.match(/^@([a-z0-9][a-z0-9.-]*)$/i);
    const host = (joined?.[1] ?? (split && owner ? split[1] : null))?.toLowerCase();
    if (!host || seen.has(host)) continue;

    const ownerName = joined?.[2] ?? owner?.[1];
    seen.add(host);
    nodes.push({
      url: `https://${host}`,
      ...(ownerName ? { owner: `@${ownerName}` } : {}),
    });
  }

  return nodes;
}
