export interface CommandItem {
  id: string;
  label: string;
  keywords: string[];
  run: () => void;
}

const commands: CommandItem[] = [];

export function registerCommand(item: CommandItem): void {
  if (commands.some((existing) => existing.id === item.id)) return;
  commands.push(item);
}

export function listCommands(): CommandItem[] {
  return [...commands];
}

/** 按标签与关键词匹配；图鉴搜索只匹配标题与别名（由注册方控制关键词）。 */
export function searchCommands(query: string): CommandItem[] {
  const needle = (query || "").trim().toLowerCase();
  if (!needle) return [...commands];
  return commands.filter((item) => {
    const haystack = [item.label, ...(item.keywords ?? [])].join(" ").toLowerCase();
    return haystack.includes(needle);
  });
}

export function clearCommands(): void {
  commands.length = 0;
}
