const RECENT_SEARCHES_KEY = "eventify_recent_searches_v1";
const MAX_RECENT_SEARCHES = 8;

export function normalizeSearchText(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function readRecentSearches() {
  try {
    const parsed = JSON.parse(localStorage.getItem(RECENT_SEARCHES_KEY) || "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((v) => typeof v === "string").slice(0, MAX_RECENT_SEARCHES);
  } catch {
    return [];
  }
}

function writeRecentSearches(values: string[]) {
  localStorage.setItem(
    RECENT_SEARCHES_KEY,
    JSON.stringify(values.slice(0, MAX_RECENT_SEARCHES))
  );
}

export function clearRecentSearches() {
  localStorage.removeItem(RECENT_SEARCHES_KEY);
  return [] as string[];
}

export function rememberRecentSearch(term: string) {
  const clean = term.trim();
  if (!clean) return readRecentSearches();
  const deduped = readRecentSearches().filter(
    (item) => normalizeSearchText(item) !== normalizeSearchText(clean)
  );
  deduped.unshift(clean);
  const next = deduped.slice(0, MAX_RECENT_SEARCHES);
  writeRecentSearches(next);
  return next;
}

function levenshtein(a: string, b: string) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const dp: number[] = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    let prev = i - 1;
    dp[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const tmp = dp[j];
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + cost);
      prev = tmp;
    }
  }
  return dp[b.length];
}

export function isFuzzyMatch(query: string, candidate: string) {
  const q = normalizeSearchText(query);
  const c = normalizeSearchText(candidate);
  if (!q || !c) return false;
  if (c.includes(q)) return true;

  const qWords = q.split(" ").filter(Boolean);
  const cWords = c.split(" ").filter(Boolean);

  return qWords.every((qWord) =>
    cWords.some((cWord) => {
      if (cWord.startsWith(qWord)) return true;
      const maxDistance = qWord.length <= 4 ? 1 : 2;
      return levenshtein(qWord, cWord.slice(0, qWord.length)) <= maxDistance;
    })
  );
}
