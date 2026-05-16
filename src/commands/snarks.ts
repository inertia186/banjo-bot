import type { Command } from "./types.js";

const elements = new Map<string, string>([
  ["hydrogen", "H"],
  ["helium", "He"],
  ["lithium", "Li"],
  ["carbon", "C"],
  ["nitrogen", "N"],
  ["oxygen", "O"],
  ["gold", "Au"],
  ["silver", "Ag"],
]);

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
    name: "roll",
    description: "Roll a six-sided die.",
    usage: "roll",
    category: "snarks",
    execute: () => String(Math.floor(Math.random() * 6) + 1),
  },
  {
    name: "lmgtfy",
    description: "Build a Let Me Google That For You query.",
    usage: "lmgtfy <query>",
    category: "snarks",
    execute: (_context, args) => `https://lmgtfy.app/?q=${encodeURIComponent(args.join(" "))}`,
  },
  {
    name: "kappa",
    description: "Send the legacy Kappa image.",
    category: "snarks",
    execute: () => "https://raw.githubusercontent.com/inertia186/banjo_bot/master/support/images/kappa.png",
  },
  {
    name: "hydrogen",
    aliases: [...elements.keys()].filter((name) => name !== "hydrogen"),
    description: "Show a chemical element symbol.",
    usage: "<element>",
    category: "snarks",
    execute: ({ commandName }) => {
      return elements.get(commandName) ?? "Element not found.";
    },
  },
];
