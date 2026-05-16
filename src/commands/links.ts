import type { Command } from "./types.js";

const staticLinks: Array<[name: string, description: string, response: string, aliases?: string[]]> = [
  ["banjo", "Show the legacy Banjo introduction.", "https://steemit.com/@inertia/introducing-banjo"],
  ["faq", "Show the Hive FAQ.", "https://hive.blog/faq.html?utm_source=banjo"],
  ["welcome", "Show the Hive welcome page.", "https://hive.blog/welcome?utm_source=banjo"],
  ["whitepaper", "Show the Hive whitepaper.", "https://hive.io/whitepaper.pdf"],
  ["tools", "Show Hive project tools.", "https://hiveprojects.io/"],
  ["github", "Show the Hive Git repository.", "https://gitlab.syncad.com/hive"],
  ["releases", "Show Hive releases.", "https://gitlab.syncad.com/hive/hive/-/releases"],
  ["scam", "Show the legacy scam explainer link.", "https://www.youtube.com/watch?v=ntoJNuzlTSA"],
  [
    "password",
    "Show the legacy password management link.",
    "https://hive.blog/@thedegensloth/how-to-login-to-steemit-correctly-proper-password-management",
  ],
  ["pancake", "Serve pancakes.", "https://www.youtube.com/watch?v=GuKV2Z3eYTY", ["pancakes"]],
  ["popcorn", "Serve popcorn.", "https://media.giphy.com/media/guufsF0Az3Lpu/giphy.gif"],
];

export const linkCommands: Command[] = staticLinks.map(([name, description, response, aliases]) => ({
  name,
  description,
  usage: name,
  category: "links",
  execute: () => response,
  ...(aliases ? { aliases } : {}),
}));
