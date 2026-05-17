import { GiphyHttpClient, type GiphyApi } from "../media/giphy.js";
import type { Command } from "./types.js";

const assetPath = (fileName: string) => new URL(`../../assets/images/${fileName}`, import.meta.url).pathname;

const elements = new Set([
  "hydrogen",
  "helium",
  "lithium",
  "beryllium",
  "boron",
  "carbon",
  "nitrogen",
  "oxygen",
  "fluorine",
  "neon",
  "sodium",
  "magnesium",
  "aluminum",
  "aluminium",
  "silicon",
  "phosphorus",
  "sulfur",
  "chlorine",
  "argon",
  "potassium",
  "calcium",
  "scandium",
  "titanium",
  "vanadium",
  "chromium",
  "manganese",
  "iron",
  "cobalt",
  "nickel",
  "copper",
  "zinc",
  "gallium",
  "germanium",
  "arsenic",
  "selenium",
  "bromine",
  "krypton",
  "rubidium",
  "strontium",
  "yttrium",
  "zirconium",
  "niobium",
  "molybdenum",
  "technetium",
  "ruthenium",
  "rhodium",
  "palladium",
  "gold",
  "silver",
  "cadmium",
  "indium",
  "tin",
  "antimony",
  "tellurium",
  "iodine",
  "xenon",
  "cesium",
  "barium",
  "lanthanum",
  "cerium",
  "praseodymium",
  "neodymium",
  "promethium",
  "samarium",
  "europium",
  "gadolinium",
  "terbium",
  "dysprosium",
  "holmium",
  "erbium",
  "thulium",
  "ytterbium",
  "lutetium",
  "hafnium",
  "tantalum",
  "tungsten",
  "rhenium",
  "osmium",
  "iridium",
  "platinum",
  "mercury",
  "thallium",
  "lead",
  "bismuth",
  "polonium",
  "astatine",
  "radon",
  "francium",
  "radium",
  "actinium",
  "thorium",
  "protactinium",
  "uranium",
  "neptunium",
  "plutonium",
  "americium",
  "curium",
  "berkelium",
  "californium",
  "einsteinium",
  "fermium",
  "mendelevium",
  "nobelium",
  "lawrencium",
  "rutherfordium",
  "dubnium",
  "seaborgium",
  "bohrium",
  "hassium",
  "meitnerium",
  "darmstadtium",
  "roentgenium",
  "copernicium",
  "ununtrium",
  "flerovium",
  "ununpentium",
  "livermorium",
  "ununseptium",
  "ununoctium",
]);
const preciousMetalAliases = new Set(["gold", "silver", "platinum", "palladium", "rhodium"]);

export const snarkCommands: Command[] = [
  {
    name: "make",
    description: "A legacy Banjo retort.",
    category: "snarks",
    execute: () => "Make it yourself.",
  },
  {
    name: "sudo",
    description: "A legacy Banjo retort.",
    category: "snarks",
    execute: () => "Ok.",
  },
  {
    name: "donut",
    description: "A legacy Banjo snack.",
    category: "snarks",
    execute: () => "*Yummeh*",
  },
  {
    name: "suicide",
    description: "Show the legacy support hotline response.",
    category: "snarks",
    execute: () => "National Suicide Prevention Lifeline: `1-800-273-8255`",
  },
  {
    name: "roll",
    description: "Roll a fair legacy die.",
    usage: "roll",
    category: "snarks",
    execute: () =>
      "Your random number is: **4** - chosen by fair dice roll, guaranteed to be random, see RFC 1149.5.",
  },
  {
    name: "lmgtfy",
    aliases: ["google"],
    description: "Build a Google search link.",
    usage: "lmgtfy <query>",
    category: "snarks",
    execute: (_context, args) => `https://www.google.com/search?q=${encodeURIComponent(args.join(" "))}`,
  },
  {
    name: "wolframalpha",
    aliases: ["wa", "wat", "tr"],
    description: "Build a Wolfram Alpha query link.",
    usage: "wolframalpha <query>",
    category: "snarks",
    execute: ({ commandName }, args) => {
      if (args.length === 0) return "Query required.  Example: `88 MPH`";

      const query = commandName === "tr"
        ? `translate "${args.join(" ")}" to english`
        : args.join(" ");

      return wolframAlphaUrl(query);
    },
  },
  {
    name: "mempool",
    description: "Show the Bitcoin mempool growth chart.",
    category: "snarks",
    execute: () => [
      "**Bitcoin Mempool Size Growth**",
      "https://www.blockchain.com/charts/mempool-growth",
      "The rate at which the bitcoin mempool is growing in bytes per second.",
    ].join("\n"),
  },
  {
    name: "carousel",
    description: "Report the status of the legacy Bittrex markets carousel.",
    usage: "carousel",
    category: "snarks",
    execute: () => "The legacy Bittrex markets carousel is no longer available.",
  },
  {
    name: "flounce",
    description: "Find a flounce GIF.",
    usage: "flounce",
    category: "snarks",
    execute: async (context) => {
      if (!context.config.giphy.apiKey && !context.services?.giphy) {
        return "Giphy is not configured, so flounce lookup is unavailable.";
      }

      const rnd = Math.floor(Math.random() * 100);
      const url = await giphyApi(context).searchGif(`flounce ${rnd}`);
      return url ?? "No flounce GIF found.";
    },
  },
  {
    name: "alexa",
    description: "Report the status of the legacy Alexa traffic graph.",
    usage: "alexa <domain>",
    category: "snarks",
    execute: (_context, args) => {
      if (args.length === 0) return "Domain required.  Example: `$alexa hive.blog`";

      return "Alexa traffic graphs are no longer available; Amazon retired Alexa Internet.";
    },
  },
  {
    name: "ego",
    description: "Report the status of the legacy ICNDB joke lookup.",
    usage: "ego <name...>",
    category: "snarks",
    execute: (_context, args) => {
      if (args.length === 0) return "Name required.  Example: `$ego banjo`";

      return "The legacy ICNDB joke API is no longer available.";
    },
  },
  {
    name: "say",
    aliases: ["vo"],
    description: "Report the status of the legacy voice synthesis command.",
    usage: "say <voice> <text>",
    category: "snarks",
    execute: () => "The legacy voice synthesis service is no longer available.",
  },
  {
    name: "snark",
    description: "Return the legacy snark fallback text.",
    usage: "snark",
    category: "snarks",
    execute: () => "It will self-correct.",
  },
  {
    name: "gold",
    aliases: ["silver", "platinum", "palladium", "rhodium"],
    description: "Show the legacy Kitco precious metals spot-price image.",
    category: "snarks",
    execute: () => "https://www.kitconet.com/images/sp_en_8.gif",
  },
  {
    name: "ricky!",
    description: "Send the legacy Ricky image.",
    category: "snarks",
    execute: () => ({ files: [assetPath("ricky.gif")] }),
  },
  {
    name: "kappa",
    description: "Send the legacy Kappa image.",
    category: "snarks",
    execute: () => ({ files: [assetPath("kappa.png")] }),
  },
  {
    name: "hydrogen",
    aliases: [...elements].filter((name) => name !== "hydrogen" && !preciousMetalAliases.has(name)),
    description: "Run the legacy element lookup.",
    usage: "<element>",
    category: "snarks",
    execute: ({ commandName }) => wolframAlphaUrl(commandName),
  },
];

function wolframAlphaUrl(query: string): string {
  return `https://www.wolframalpha.com/input/?i=${encodeURIComponent(query)}`;
}

function giphyApi(context: Parameters<Command["execute"]>[0]): GiphyApi {
  return context.services?.giphy ?? new GiphyHttpClient(context.config, context.logger);
}
