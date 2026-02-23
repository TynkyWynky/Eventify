const RAW_BASE =
  (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim() ||
  "http://localhost:3000";

export const API_BASE_URL = RAW_BASE.replace(/\/+$/, "");

type ApiErrorPayload = { error?: string; message?: string };

export function apiUrl(path: string): string {
  const safePath = path.startsWith("/") ? path : `/${path}`;
  return `${API_BASE_URL}${safePath}`;
}


export function buildSseUrl(
  path: string,
  params?: Record<string, string | number | boolean | null | undefined>
): string {
  const url = new URL(apiUrl(path));
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