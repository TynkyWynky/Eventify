function shouldUpgradeHttpBase(baseUrl: string): boolean {
  if (!/^http:\/\//i.test(baseUrl)) return false;
  if (typeof window === "undefined") return false;
  if (window.location.protocol !== "https:") return false;
  return !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/i.test(baseUrl);
}

function shouldAppendApiPath(baseUrl: string): boolean {
  if (!/^[a-z]+:\/\//i.test(baseUrl)) return false;
  try {
    const parsed = new URL(baseUrl);
    return parsed.pathname === "/" || parsed.pathname === "";
  } catch {
    return false;
  }
}

function resolveApiBaseUrl(): string {
  const envBase = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim();
  const fallbackBase = import.meta.env.DEV ? "http://localhost:3000" : "/api";
  if (!envBase) return fallbackBase;

  let resolvedBase = envBase;

  if (!import.meta.env.DEV) {
    const allowCrossOriginApiBase = ["1", "true", "yes", "on"].includes(
      String(import.meta.env.VITE_API_BASE_URL_ALLOW_CROSS_ORIGIN ?? "")
        .trim()
        .toLowerCase()
    );

    // Protect production builds from accidental localhost env values on Vercel.
    try {
      const parsed = new URL(resolvedBase, window.location.origin);
      if (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1") {
        return "/api";
      }
      // Single-project safety: if API host differs from current app host, prefer same-origin /api.
      // This avoids accidental pointing to protected/stale preview deployments after merges.
      if (
        !allowCrossOriginApiBase &&
        /^https?:\/\//i.test(resolvedBase) &&
        parsed.host !== window.location.host
      ) {
        return "/api";
      }
    } catch {
      // Keep non-URL values such as "/api" as-is.
    }
  }

  if (shouldUpgradeHttpBase(resolvedBase)) {
    resolvedBase = resolvedBase.replace(/^http:\/\//i, "https://");
  }

  // Common Vercel misconfig: using https://<backend>.vercel.app without /api.
  if (shouldAppendApiPath(resolvedBase)) {
    resolvedBase = `${resolvedBase.replace(/\/+$/, "")}/api`;
  }

  return resolvedBase;
}

export const API_BASE_URL = resolveApiBaseUrl().replace(/\/+$/, "");

type ApiErrorPayload = { error?: string; message?: string };

export function apiUrl(path: string): string {
  const safePath = path.startsWith("/") ? path : `/${path}`;
  return `${API_BASE_URL}${safePath}`;
}

export function apiOrigin(): string {
  if (/^https?:\/\//i.test(API_BASE_URL)) return API_BASE_URL.replace(/\/+$/, "");
  if (typeof window !== "undefined") return window.location.origin;
  return "http://localhost:3000";
}

export function apiBaseForUrlConstructor(): string {
  if (/^https?:\/\//i.test(API_BASE_URL)) return `${API_BASE_URL.replace(/\/+$/, "")}/`;
  const basePath = API_BASE_URL.startsWith("/") ? API_BASE_URL : `/${API_BASE_URL}`;
  return `${apiOrigin()}${basePath.replace(/\/+$/, "")}/`;
}


export function buildSseUrl(
  path: string,
  params?: Record<string, string | number | boolean | null | undefined>
): string {
  const url = new URL(path.startsWith("/") ? path.slice(1) : path, apiBaseForUrlConstructor());
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v === null || typeof v === "undefined") continue;
      url.searchParams.set(k, String(v));
    }
  }
  return url.toString();
}

async function parseError(res: Response) {
  try {
    const data = (await res.json()) as ApiErrorPayload;
    return data.error || data.message || `Request failed (${res.status})`;
  } catch {
    try {
      const text = await res.text();
      return (text || "").trim() || `Request failed (${res.status})`;
    } catch {
      return `Request failed (${res.status})`;
    }
  }
}

function isAbortError(e: unknown): boolean {
  if (e instanceof DOMException && e.name === "AbortError") return true;

  if (e instanceof Error) {
    return e.message.toLowerCase().includes("aborted");
  }

  if (typeof e === "object" && e !== null && "message" in e) {
    const msg = (e as { message?: unknown }).message;
    if (typeof msg === "string") return msg.toLowerCase().includes("aborted");
  }

  return false;
}

export async function apiFetch<T>(
  path: string,
  opts?: {
    method?: string;
    body?: unknown;
    token?: string | null;
    signal?: AbortSignal;
  }
): Promise<T> {
  const url = apiUrl(path);
  const method = (opts?.method || "GET").toUpperCase();

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (opts?.token) headers.Authorization = `Bearer ${opts.token}`;

  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers,
      body: typeof opts?.body === "undefined" ? undefined : JSON.stringify(opts.body),
      signal: opts?.signal,
    });
  } catch (e) {
    if (isAbortError(e)) throw e;
    throw new Error(`${method} ${url} failed: ${(e as Error)?.message || String(e)}`);
  }

  if (!res.ok) {
    const msg = await parseError(res);
    throw new Error(`${method} ${url} failed (${res.status}): ${msg}`);
  }

  return (await res.json()) as T;
}

export type ApiAuthResponse = {
  ok: boolean;
  token?: string;
  user?: {
    id: string;
    name: string;
    email: string;
    role: "user" | "organizer" | "admin";
  };
};

export type ApiMeResponse = {
  ok: boolean;
  user?: {
    id: string;
    name: string;
    email: string;
    role: "user" | "organizer" | "admin";
  };
};

export type AdminUserDto = {
  id: string;
  username: string;
  name: string;
  email: string;
  role: "user" | "organizer" | "admin";
  isActive: boolean;
  createdAt: string;
  lastLogin: string | null;
};

export type AdminUsersResponse = {
  ok: boolean;
  users?: AdminUserDto[];
};

export type DisabledEventDto = {
  eventKey: string;
  reason: string | null;
  snapshot?: Record<string, unknown>;
  disabledBy: { id: string; username: string; name: string; email: string } | null;
  createdAt: string;
  updatedAt: string;
};

export type AdminDisabledEventsResponse = {
  ok: boolean;
  items?: DisabledEventDto[];
};
