import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { fetchEventSuggestions } from "../data/events/eventsApi";
import { getOrigin, subscribeOriginChanged } from "../data/location/locationStore";
import {
  clearRecentSearches,
  isFuzzyMatch,
  normalizeSearchText,
  readRecentSearches,
  rememberRecentSearch,
} from "../utils/search";

type SuggestionItem = {
  label: string;
  source: "recent" | "catalog";
};

export function useNavSearch() {
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();

  const qFromUrl = searchParams.get("q") ?? "";
  const [query, setQuery] = useState(qFromUrl);
  const [isSearchOpen, setSearchOpen] = useState(false);
  const [recentSearches, setRecentSearches] = useState<string[]>(() => readRecentSearches());
  const [serverSuggestions, setServerSuggestions] = useState<string[]>([]);
  const [origin, setOrigin] = useState(() => getOrigin());
  const suggestionCacheRef = useRef(new Map<string, string[]>());

  useEffect(() => {
    setQuery(qFromUrl);
  }, [qFromUrl]);

  useEffect(() => {
    return subscribeOriginChanged(() => setOrigin(getOrigin()));
  }, []);

  useEffect(() => {
    const q = query.trim();
    const qNorm = normalizeSearchText(q);
    if (qNorm.length < 2) {
      setServerSuggestions([]);
      return;
    }

    const cacheKey = `${origin.lat.toFixed(3)}:${origin.lng.toFixed(3)}:${qNorm}`;
    const cached = suggestionCacheRef.current.get(cacheKey);
    if (cached) {
      setServerSuggestions(cached);
      return;
    }

    const controller = new AbortController();
    const id = window.setTimeout(() => {
      fetchEventSuggestions(
        {
          q,
          lat: origin.lat,
          lng: origin.lng,
          radiusKm: 120,
          limit: 10,
        },
        controller.signal
      )
        .then((next) => {
          suggestionCacheRef.current.set(cacheKey, next);
          setServerSuggestions(next);
        })
        .catch((err: unknown) => {
          if (err instanceof DOMException && err.name === "AbortError") return;
          setServerSuggestions([]);
        });
    }, 350);

    return () => {
      window.clearTimeout(id);
      controller.abort();
    };
  }, [origin.lat, origin.lng, query]);

  const commitQuery = useCallback(
    (nextValue: string, opts?: { persistHistory?: boolean }) => {
      const trimmed = nextValue.trim();
      if (trimmed && opts?.persistHistory) {
        setRecentSearches(rememberRecentSearch(trimmed));
      }

      const next = new URLSearchParams(searchParams);
      if (trimmed) next.set("q", trimmed);
      else next.delete("q");

      const nextSearch = next.toString();
      const searchStr = nextSearch ? `?${nextSearch}` : "";

      if (location.pathname !== "/" && trimmed) {
        navigate({ pathname: "/", search: searchStr }, { replace: true });
        return;
      }

      setSearchParams(next, { replace: true });
    },
    [location.pathname, navigate, searchParams, setSearchParams]
  );

  useEffect(() => {
    if (query.trim() === qFromUrl) return;
    const id = window.setTimeout(() => {
      commitQuery(query, { persistHistory: false });
    }, 300);
    return () => window.clearTimeout(id);
  }, [commitQuery, qFromUrl, query]);

  const searchSuggestions = useMemo<SuggestionItem[]>(() => {
    const qNorm = normalizeSearchText(query);
    if (!qNorm) {
      return recentSearches
        .map((item) => ({ label: item, source: "recent" as const }))
        .slice(0, 8);
    }

    const fromRecent = recentSearches
      .filter((item) => isFuzzyMatch(qNorm, item))
      .map((item) => ({ label: item, source: "recent" as const }));

    const seen = new Set(fromRecent.map((item) => normalizeSearchText(item.label)));
    const fromCatalog = serverSuggestions
      .filter((item) => !seen.has(normalizeSearchText(item)) && isFuzzyMatch(qNorm, item))
      .slice(0, 8)
      .map((item) => ({ label: item, source: "catalog" as const }));

    return [...fromRecent, ...fromCatalog].slice(0, 8);
  }, [query, recentSearches, serverSuggestions]);

  const submitSearch = useCallback(() => {
    commitQuery(query, { persistHistory: true });
    setSearchOpen(false);
  }, [commitQuery, query]);

  const clearQuery = useCallback(() => {
    setQuery("");
    commitQuery("", { persistHistory: false });
    setSearchOpen(false);
  }, [commitQuery]);

  const applySuggestion = useCallback(
    (label: string) => {
      setQuery(label);
      commitQuery(label, { persistHistory: false });
      setSearchOpen(false);
    },
    [commitQuery]
  );

  const clearHistory = useCallback(() => {
    setRecentSearches(clearRecentSearches());
  }, []);

  return {
    query,
    setQuery,
    isSearchOpen,
    setSearchOpen,
    recentSearches,
    searchSuggestions,
    submitSearch,
    clearQuery,
    applySuggestion,
    clearHistory,
  };
}
