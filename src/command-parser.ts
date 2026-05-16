export type ParsedCommand = {
  name: string;
  args: string[];
};

export function parseCommand(content: string, prefix: string): ParsedCommand | null {
  if (!content.startsWith(prefix)) return null;

  const body = content.slice(prefix.length).trim();
  if (!body) return null;

  const tokens = body.match(/"([^"]*)"|'([^']*)'|\S+/g) ?? [];
  const [name, ...args] = tokens.map((token) => {
    if (
      (token.startsWith('"') && token.endsWith('"')) ||
      (token.startsWith("'") && token.endsWith("'"))
    ) {
      return token.slice(1, -1);
    }

    return token;
  });

  if (!name) return null;

  return {
    name: name.toLowerCase(),
    args,
  };
}
