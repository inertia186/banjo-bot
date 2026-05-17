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
    name: "register",
    description: "Account registration is disabled.",
    usage: "register <account>",
    category: "core",
    execute: () => "Registration is currently disabled.",
  },
  {
    name: "upvote",
    description: "Voting is disabled.",
    usage: "upvote [post]",
    category: "core",
    execute: () => "Upvote is currently disabled.",
  },
  {
    name: "verify",
    description: "Cosgrove account verification is unavailable.",
    usage: "verify <account-or-user> [chain]",
    category: "core",
    execute: () => "Account verification is not available.",
  },
  {
    name: "version",
    description: "Show Cosgrove upstream status.",
    usage: "version",
    category: "core",
    execute: () => "Cosgrove version lookup is not available in this Banjo build.",
  },
  {
    name: "slap",
    description: "Cosgrove slap command is unavailable.",
    usage: "slap [target]",
    category: "core",
    execute: () => "Slap command is not available.",
  },
  {
    name: "catfact",
    aliases: ["catfacts"],
    description: "Cosgrove cat fact lookup is unavailable.",
    usage: "catfact",
    category: "core",
    execute: () => "Cat fact lookup is not available.",
  },
  {
    name: "voting",
    description: "Voting statistics are disabled.",
    usage: "voting [minutes] [accounts...]",
    category: "core",
    execute: () => "Sorry, voting stats are currently not available.",
  },
  {
    name: "play",
    description: "Voice sound playback is unavailable.",
    usage: "play [sound]",
    category: "core",
    execute: () => "Voice sound playback is not available.",
  },
  {
    name: "disconnect_voice",
    description: "Voice playback control is unavailable.",
    usage: "disconnect_voice",
    category: "core",
    execute: () => "Voice playback is not available.",
  },
  {
    name: "stats",
    description: "Bot statistics are disabled.",
    usage: "stats",
    category: "core",
    execute: () => "Stats are currently disabled.",
  },
  {
    name: "payout",
    description: "Pending payout summary is unavailable.",
    usage: "payout",
    category: "core",
    execute: () => "Payout summary is not available.",
  },
  {
    name: "flagwars",
    description: "Flagwars report is unavailable.",
    usage: "flagwars",
    category: "core",
    execute: () => "Flagwars report is not available.",
  },
  {
    name: "regex",
    description: "Legacy regex content scan is unavailable.",
    usage: "regex <pattern>",
    category: "core",
    execute: () => "Regex content scan is not available. Use `$search` for indexed keyword search.",
  },
  {
    name: "poll",
    description: "Legacy poll rendering is unavailable.",
    usage: "poll <url-or-@author/permlink>",
    category: "core",
    execute: () => "Poll rendering is not available.",
  },
  {
    name: "mod",
    description: "Legacy moderation report is unavailable.",
    usage: "mod <symbol> [tribe tags] [payout]",
    category: "core",
    execute: () => "Moderation report is not available.",
  },
  {
    name: "woodwork",
    description: "Legacy woodwork report is unavailable.",
    usage: "woodwork [tag...]",
    category: "core",
    execute: () => "Woodwork report is not available.",
  },
  {
    name: "investors",
    description: "Legacy investor report is unavailable.",
    usage: "investors [days]",
    category: "core",
    execute: () => "Investor report is not available.",
  },
  {
    name: "predict",
    aliases: ["prediction"],
    description: "Legacy Dublup prediction lookup is unavailable.",
    usage: "predict [market-id|query]",
    category: "core",
    execute: () => "Prediction lookup is not available. The legacy Dublup API is no longer usable.",
  },
  {
    name: "bidbots",
    description: "Legacy bidbot report is unavailable.",
    usage: "bidbots [tag...]",
    category: "core",
    execute: () => "Bidbot report is not available.",
  },
  {
    name: "birthday",
    description: "Show the birthday age for Hive and a few legacy chains/events.",
    usage: "birthday [hive|steem|golos|banjo|bitcoin|aggrandizement]",
    category: "core",
    execute: (_context, args) => formatBirthday(args[0] ?? "hive"),
  },
  {
    name: "trail",
    description: "Show the status of the legacy Banjo curation trail.",
    usage: "trail",
    category: "core",
    execute: () => "The legacy Streemian curation trail is no longer available.",
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
      const byCategory = visibleCommands.reduce<Record<string, Command[]>>((memo, command) => {
        const categoryCommands = (memo[command.category] ??= []);
        categoryCommands.push(command);
        return memo;
      }, {});

      const sections = Object.entries(byCategory).map(([category, commands]) => {
        const sortedCommands = commands.sort((left, right) => left.name.localeCompare(right.name));

        if (category === "legacy") {
          return [
            "**legacy**",
            `${sortedCommands.length} placeholders are registered. Use \`${prefix}help <command>\` for details.`,
          ].join("\n");
        }

        return [
          `**${category}**`,
          sortedCommands.map((command) => `\`${prefix}${command.name}\``).join(", "),
        ].join("\n");
      });

      return [...sections, `Use \`${prefix}help <command>\` for command details.`].join("\n\n");
    },
  },
];

type BirthdayEntry = {
  name: string;
  birthYear: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

const birthdays: Record<string, BirthdayEntry> = {
  steem: { name: "STEEM", birthYear: 2016, month: 2, day: 24, hour: 17, minute: 0, second: 0 },
  golos: { name: "GOLOS", birthYear: 2016, month: 9, day: 18, hour: 11, minute: 1, second: 48 },
  banjo: { name: "Banjo", birthYear: 2017, month: 0, day: 24, hour: 11, minute: 1, second: 48 },
  bitcoin: { name: "Bitcoin", birthYear: 2009, month: 0, day: 3, hour: 18, minute: 15, second: 5 },
  aggrandizement: { name: "Aggrandizement Day", birthYear: 2018, month: 1, day: 3, hour: 19, minute: 2, second: 36 },
  hive: { name: "HIVE", birthYear: 2020, month: 2, day: 20, hour: 14, minute: 0, second: 0 },
};

function formatBirthday(value: string): string {
  const key = value.toLowerCase();
  const birthday = birthdays[key];
  if (!birthday) return `Not tracking ${value}'s birthday.`;

  const now = new Date();
  const currentYear = now.getUTCFullYear();
  const thisBirthday = new Date(Date.UTC(currentYear, birthday.month, birthday.day, birthday.hour, birthday.minute, birthday.second));
  const age = currentYear - birthday.birthYear;

  if (thisBirthday.getTime() > now.getTime()) {
    return `\`${birthday.name} is ${pluralize(age, "year")} old in ${formatDuration(Math.floor((thisBirthday.getTime() - now.getTime()) / 1000))}\``;
  }

  return `\`${birthday.name} became ${pluralize(age, "year")} old ${formatDuration(Math.floor((now.getTime() - thisBirthday.getTime()) / 1000))} ago\``;
}

function pluralize(count: number, singular: string): string {
  return `${count} ${singular}${count === 1 ? "" : "s"}`;
}

function formatDuration(seconds: number): string {
  const units = [
    ["year", 365 * 24 * 60 * 60],
    ["month", 30 * 24 * 60 * 60],
    ["day", 24 * 60 * 60],
    ["hour", 60 * 60],
    ["minute", 60],
  ] as const;

  for (const [name, unitSeconds] of units) {
    const value = Math.floor(seconds / unitSeconds);
    if (value >= 1) return pluralize(value, name);
  }

  return "less than a minute";
}
