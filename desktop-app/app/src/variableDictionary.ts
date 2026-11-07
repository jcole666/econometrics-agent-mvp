import type { VariableDictEntry, VariableDictionary } from "./types";

/** 取字典条目；没有则返回 null（调用方自己决定回退文案）。 */
export function entryFor(column: string, dictionary: VariableDictionary | null | undefined): VariableDictEntry | null {
  if (!dictionary?.entries) return null;
  return dictionary.entries[column] ?? null;
}

/**
 * 下游展示统一走这里：有确认中文名用中文名，否则回退原始列名。
 * 原始列名始终出现在 title 里，避免「改了名找不到列」。
 */
export function displayName(column: string, dictionary: VariableDictionary | null | undefined): string {
  const label = entryFor(column, dictionary)?.label?.trim();
  return label || column;
}

export function withUnit(column: string, dictionary: VariableDictionary | null | undefined): string {
  const entry = entryFor(column, dictionary);
  if (!entry) return column;
  const label = entry.label?.trim() || column;
  return entry.unit ? `${label}（${entry.unit}）` : label;
}

export function dictionaryStats(dictionary: VariableDictionary | null | undefined): { confirmed: number; total: number } {
  if (!dictionary?.entries) return { confirmed: 0, total: 0 };
  const entries = Object.values(dictionary.entries);
  return { confirmed: entries.filter((entry) => entry.confirmed).length, total: entries.length };
}

export function hasDictionary(dictionary: VariableDictionary | null | undefined): boolean {
  return Boolean(dictionary && Object.keys(dictionary.entries ?? {}).length > 0);
}
