import { XkcdHttpClient, type XkcdApi, type XkcdComic } from "../comics/xkcd.js";
import { banjoEmbed } from "./embeds.js";
import type { Command, CommandContext } from "./types.js";

export const comicCommands: Command[] = [
  {
    name: "dilbert",
    description: "Report the status of the retired Dilbert mirror.",
    usage: "dilbert",
    category: "snarks",
    execute: () => "The legacy Dilbert image mirror is no longer available.",
  },
  {
    name: "xkcd",
    description: "Look up an xkcd comic.",
    usage: "xkcd [number]",
    category: "snarks",
    execute: async (context, args) => {
      const num = readXkcdNumber(args[0]);
      if (typeof num === "string") return num;

      const comic = await xkcdApi(context).getComic(num);
      if (!comic) return `Unknown xkcd: # ${args[0] ?? "latest"}`;

      return formatXkcd(comic);
    },
  },
];

function xkcdApi(context: CommandContext): XkcdApi {
  return context.services?.xkcd ?? new XkcdHttpClient(context.logger);
}

function readXkcdNumber(value: string | undefined): number | null | string {
  if (!value) return null;
  const num = Number.parseInt(value, 10);
  if (!Number.isFinite(num) || num < 1) return "Usage: `$xkcd [number]`";
  return num;
}

function formatXkcd(comic: XkcdComic) {
  const embed = banjoEmbed()
    .setTitle(`xkcd #${comic.num}: ${comic.title}`)
    .setURL(`https://xkcd.com/${comic.num}/`)
    .setImage(comic.imageUrl);

  if (comic.safeTitle !== comic.title) embed.setDescription(comic.safeTitle);

  const embeds = [embed];
  if (comic.alt) {
    embeds.push(banjoEmbed().setDescription(`|| ${comic.alt} ||`));
  }

  return { embeds };
}
