import type { Command } from "./types.js";

const assetPath = (fileName: string) => new URL(`../../assets/images/${fileName}`, import.meta.url).pathname;

const staticLinks: Array<[name: string, description: string, response: string, aliases?: string[]]> = [
  ["banjo", "Show the legacy Banjo introduction.", "https://hive.blog/@inertia/introducing-banjo"],
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
  ["watch", "Show the legacy watch link.", "https://www.youtube.com/watch?v=VAesMQ6VtK8"],
  ["pancake", "Serve pancakes.", "https://www.youtube.com/watch?v=GuKV2Z3eYTY", ["pancakes"]],
  ["popcorn", "Serve popcorn.", "https://media.giphy.com/media/guufsF0Az3Lpu/giphy.gif"],
];

const staticImageLinks: Array<[name: string, description: string, fileName: string]> = [
  ["bandwagon", "Show the legacy bandwagon image.", "bandwagon.jpg"],
  ["headphones", "Show the legacy headphones image.", "headphones.jpg"],
];

const musicLinks = {
  debugging: [
    "https://www.youtube.com/watch?v=kuVMtOChVcM",
    "https://www.youtube.com/watch?v=D9RhgrwkTFQ",
    "https://www.youtube.com/watch?v=iigKPkLB5IQ",
  ],
  coding: [
    "https://www.youtube.com/watch?v=sMOcqXM_d8o",
    "https://www.youtube.com/watch?v=twqM56f_cVo",
    "https://www.youtube.com/watch?v=ay6cmOf9598",
    "https://www.youtube.com/watch?v=EA68cv1jn88",
    "https://www.youtube.com/watch?v=1uiY7SUYRVE",
    "https://www.youtube.com/watch?v=lZ5o_s13GpA&list=PLxAkyFEMgDjOcJDe7u8Wr6duKGDArn5EC",
  ],
  trading: [
    "https://www.youtube.com/watch?v=zEmMJuamSNc",
    "https://www.youtube.com/watch?v=up7pvPqNkuU",
    "https://www.youtube.com/watch?v=-W57-dSXojA",
    "https://www.youtube.com/watch?v=Mocsc_BsAdI",
    "https://www.youtube.com/watch?v=BQAKRw6mToA",
    "https://www.youtube.com/watch?v=5DKGKs32xjs",
    "https://www.youtube.com/watch?v=yIOyL_PbmlE",
    "https://www.youtube.com/watch?v=Zx1_6F-nCaw",
  ],
  dump: [
    "https://www.youtube.com/watch?v=N_dUmDBfp6k&t=1m51s",
  ],
};

const fallacies = [
  {
    name: "Appeal to Consequences",
    aliases: ["consequence", "outcome"],
    summary: "Rejecting a claim because accepting it would have unpleasant implications.",
  },
  {
    name: "Appeal to Ignorance",
    aliases: ["ignorance", "unknown", "prove"],
    summary: "Treating a lack of evidence against something as evidence that it must be true, or the reverse.",
  },
  {
    name: "Bandwagon Fallacy",
    aliases: ["bandwagon", "popular", "majority", "everyone"],
    summary: "Arguing that something is true or good because many people believe or do it.",
  },
  {
    name: "False Dilemma",
    aliases: ["either", "or", "binary", "choice"],
    summary: "Presenting only two options when more realistic alternatives exist.",
  },
  {
    name: "Ad Hominem",
    aliases: ["motive", "attack", "personal"],
    summary: "Attacking the person instead of answering the argument.",
  },
  {
    name: "Circular Reasoning",
    aliases: ["circular", "begging", "because"],
    summary: "Using the conclusion as one of the reasons offered to prove it.",
  },
  {
    name: "False Analogy",
    aliases: ["analogy", "comparison", "like"],
    summary: "Leaning on a comparison where the relevant similarities do not actually hold.",
  },
  {
    name: "Confirmation Bias",
    aliases: ["confirmation", "bias", "selective"],
    summary: "Favoring evidence that supports an existing belief while discounting contrary evidence.",
  },
  {
    name: "Red Herring",
    aliases: ["distract", "distraction", "irrelevant"],
    summary: "Introducing an irrelevant point that pulls attention away from the real issue.",
  },
  {
    name: "Straw Man",
    aliases: ["straw", "misrepresent", "caricature"],
    summary: "Replacing an opponent's position with a weaker version that is easier to attack.",
  },
];

export const linkCommands: Command[] = [
  ...staticLinks.map(([name, description, response, aliases]) => ({
    name,
    description,
    usage: name,
    category: "links" as const,
    execute: () => response,
    ...(aliases ? { aliases } : {}),
  })),
  ...staticImageLinks.map(([name, description, fileName]) => ({
    name,
    description,
    usage: name,
    category: "links" as const,
    execute: () => ({ files: [assetPath(fileName)] }),
  })),
  {
    name: "music",
    description: "Pick legacy Banjo music.",
    usage: "music [debugging|coding|trading|dump]",
    category: "links",
    execute: (_context, args) => {
      const requested = args[0]?.toLowerCase() as keyof typeof musicLinks | undefined;
      const category = requested && requested in musicLinks ? requested : randomItem(Object.keys(musicLinks) as Array<keyof typeof musicLinks>);
      return randomItem(musicLinks[category]);
    },
  },
  {
    name: "fallacy",
    description: "Look up a concise legacy fallacy note.",
    usage: "fallacy [query]",
    category: "links",
    execute: (_context, args) => {
      const query = args.map((arg) => arg.toLowerCase()).filter(Boolean);
      const fallacy = query.length === 0 ? randomItem(fallacies) : findFallacy(query);
      if (!fallacy) return `Couldn't find a fallacy for: ${query.join(" ")}`;

      return `**${fallacy.name}**\n${fallacy.summary}`;
    },
  },
];

function randomItem<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)] ?? items[0]!;
}

function findFallacy(query: string[]): (typeof fallacies)[number] | null {
  const weighted = fallacies
    .map((fallacy) => ({
      fallacy,
      weight: [fallacy.name.toLowerCase(), ...fallacy.aliases].filter((term) =>
        query.some((word) => term.includes(word) || word.includes(term)),
      ).length,
    }))
    .filter((match) => match.weight > 0);

  weighted.sort((a, b) => b.weight - a.weight);
  return weighted[0]?.fallacy ?? null;
}
