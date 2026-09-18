// Recent searches, kept per-viewer in localStorage so the search bar has something to offer the moment it's
// focused. This is a convenience only — losing it (private window, cleared storage) just shows an empty menu,
// so every access is guarded and the caller renders fine without it.
const KEY = 'lumina.recent-searches';
const MAX = 8;

export function getRecentSearches(): string[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((q): q is string => typeof q === 'string').slice(0, MAX);
  } catch {
    return [];
  }
}

export function addRecentSearch(query: string): string[] {
  const q = query.trim();
  if (!q) return getRecentSearches();
  const next = [q, ...getRecentSearches().filter((x) => x.toLowerCase() !== q.toLowerCase())].slice(0, MAX);
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Full or blocked storage: the in-memory list still returns, the menu just won't persist.
  }
  return next;
}

export function clearRecentSearches(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}
