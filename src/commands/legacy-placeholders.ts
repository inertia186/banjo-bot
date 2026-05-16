import type { Command } from "./types.js";

type LegacyCommand = {
  name: string;
  description: string;
  legacyLine: string;
  aliases?: string[];
};

const legacyCommands: LegacyCommand[] = [
  { name: "register", description: "Associate a Hive account with a Discord user.", legacyLine: "banjo_bot.rb:429" },
  { name: "upvote", description: "Legacy voting command; disabled in the old bot.", legacyLine: "banjo_bot.rb:433" },
  { name: "stats", description: "Legacy bot statistics.", legacyLine: "banjo_bot.rb:437" },
  { name: "rep", description: "Hive reputation lookup.", legacyLine: "banjo_bot.rb:444" },
  { name: "proxy", description: "Hive witness proxy lookup.", legacyLine: "banjo_bot.rb:497" },
  { name: "witness", description: "Hive witness details.", legacyLine: "banjo_bot.rb:531" },
  { name: "consensus", description: "Hive consensus witness view.", legacyLine: "banjo_bot.rb:623" },
  { name: "power", description: "Hive voting power lookup.", legacyLine: "banjo_bot.rb:657" },
  { name: "rewards", description: "Hive rewards lookup.", legacyLine: "banjo_bot.rb:818" },
  { name: "avatar", description: "Hive avatar lookup.", legacyLine: "banjo_bot.rb:1104" },
  {
    name: "wolframalpha",
    aliases: ["wa", "wat", "tr"],
    description: "Wolfram Alpha query.",
    legacyLine: "banjo_bot.rb:1110",
  },
  { name: "mempool", description: "Legacy mempool command.", legacyLine: "banjo_bot.rb:1126" },
  { name: "distribution", aliases: ["dist"], description: "Hive distribution report.", legacyLine: "banjo_bot.rb:1137" },
  { name: "xkcd", description: "XKCD lookup.", legacyLine: "banjo_bot.rb:1162" },
  { name: "latest", description: "Latest Hive post for an account.", legacyLine: "banjo_bot.rb:1290" },
  { name: "first", description: "First Hive post for an account.", legacyLine: "banjo_bot.rb:1374" },
  { name: "age", description: "Hive post age lookup.", legacyLine: "banjo_bot.rb:1401" },
  { name: "mvests", description: "MVESTS lookup.", legacyLine: "banjo_bot.rb:1440" },
  { name: "rewardpool", description: "Reward pool information.", legacyLine: "banjo_bot.rb:1448" },
  { name: "calcreward", description: "Estimate post reward impact.", legacyLine: "banjo_bot.rb:1469" },
  { name: "poll", description: "Poll rendering.", legacyLine: "banjo_bot.rb:1475" },
  { name: "supply", description: "Hive supply lookup.", legacyLine: "banjo_bot.rb:1481" },
  { name: "nodes", description: "Hive node list.", legacyLine: "banjo_bot.rb:1521" },
  { name: "ticker", description: "Hive ticker prices.", legacyLine: "banjo_bot.rb:1578" },
  { name: "price", description: "Token price lookup.", legacyLine: "banjo_bot.rb:1588" },
  { name: "promoted", description: "Promoted post totals.", legacyLine: "banjo_bot.rb:1600" },
  { name: "follows", description: "Follower/following information.", legacyLine: "banjo_bot.rb:1607" },
  { name: "search", description: "Hive content search.", legacyLine: "banjo_bot.rb:1660" },
  { name: "hardfork", description: "Hardfork information.", legacyLine: "banjo_bot.rb:1735" },
  { name: "feed", description: "Witness feed means.", legacyLine: "banjo_bot.rb:1818" },
  { name: "delegate", aliases: ["delegator", "delegatee"], description: "Delegation lookup.", legacyLine: "banjo_bot.rb:1835" },
  { name: "claims", description: "Hive claim report.", legacyLine: "banjo_bot.rb:2026" },
  { name: "play", description: "Voice sound playback.", legacyLine: "banjo_bot.rb:2167" },
  { name: "top", description: "Legacy top report.", legacyLine: "banjo_bot.rb:2189" },
  { name: "community", description: "Hive community lookup.", legacyLine: "banjo_bot.rb:2439" },
  { name: "badges", description: "Hive badge search.", legacyLine: "banjo_bot.rb:2523" },
  { name: "badge", description: "Hive badge lookup.", legacyLine: "banjo_bot.rb:2576" },
  { name: "token", description: "Hive Engine token lookup.", legacyLine: "banjo_bot.rb:2635" },
  { name: "nft", description: "NFT lookup.", legacyLine: "banjo_bot.rb:2659" },
  { name: "tt2x", description: "Top Trending to Exchange report.", legacyLine: "banjo_bot.rb:2778" },
  { name: "richlist", description: "Hive Engine richlist lookup.", legacyLine: "banjo_bot.rb:2951" },
  { name: "staked", description: "Hive Engine staked lookup.", legacyLine: "banjo_bot.rb:2985" },
  { name: "scottags", description: "Related SCOT tags for a token.", legacyLine: "banjo_bot.rb:3185" },
  { name: "bidbots", description: "Bidbot post report.", legacyLine: "banjo_bot.rb:3215" },
  { name: "fear", aliases: ["greed"], description: "Fear and greed report.", legacyLine: "banjo_bot.rb:3468" },
  { name: "approval", aliases: ["approve", "approved"], description: "Witness and proposal approvals.", legacyLine: "banjo_bot.rb:3544" },
  { name: "proposal", description: "DHF proposal lookup.", legacyLine: "banjo_bot.rb:3628" },
  { name: "mod", description: "Moderation embed rendering.", legacyLine: "banjo_bot.rb:3767" },
  { name: "woodwork", description: "Woodwork post report.", legacyLine: "banjo_bot.rb:3905" },
  { name: "investors", description: "Investor report.", legacyLine: "banjo_bot.rb:3964" },
  { name: "predict", aliases: ["prediction"], description: "Prediction lookup.", legacyLine: "banjo_bot.rb:3993" },
  { name: "nftsr", description: "NFT Showroom lookup.", legacyLine: "banjo_bot.rb:4062" },
];

export const legacyPlaceholderCommands: Command[] = legacyCommands.map((legacy) => ({
  name: legacy.name,
  description: `${legacy.description} (not ported yet)`,
  usage: legacy.name,
  category: "legacy",
  execute: ({ config }) =>
    `\`${config.commandPrefix}${legacy.name}\` has not been ported yet. Legacy implementation: ${legacy.legacyLine}.`,
  ...(legacy.aliases ? { aliases: legacy.aliases } : {}),
}));
