import type { Command } from "./types.js";

export const coreCommands: Command[] = [
  {
    name: "ping",
    description: "Check whether Banjo is awake.",
    usage: "ping",
    category: "core",
    execute: () => "Pong.",
  },
  {
    name: "about",
    description: "Show Banjo project information.",
    usage: "about",
    category: "core",
    execute: () =>
      [
        "Banjo is being reimplemented in TypeScript with Discord.js.",
        "The migration notes track parity with the legacy Ruby bot.",
      ].join("\n"),
  },
  {
    name: "help",
    description: "List available commands.",
    usage: "help [command]",
    category: "core",
    execute: ({ message, config }, args) => {
      const registry = message.client.commands;
      const prefix = config.commandPrefix;
      const selectedName = args[0]?.toLowerCase();

      if (selectedName) {
        const command = registry.get(selectedName);
        if (!command) return `Cannot find help for: ${selectedName}`;

        return [
          `**${prefix}${command.usage ?? command.name}**`,
          command.description,
          command.aliases?.length ? `Aliases: ${command.aliases.join(", ")}` : null,
        ]
          .filter(Boolean)
          .join("\n");
      }

      const visibleCommands = [...new Map([...registry.values()].map((command) => [command.name, command])).values()];
      const byCategory = visibleCommands.reduce<Record<string, string[]>>((memo, command) => {
        const categoryCommands = (memo[command.category] ??= []);
        categoryCommands.push(`\`${prefix}${command.name}\` - ${command.description}`);
        return memo;
      }, {});

      return Object.entries(byCategory)
        .map(([category, lines]) => `**${category}**\n${lines.sort().join("\n")}`)
        .join("\n\n");
    },
  },
];
