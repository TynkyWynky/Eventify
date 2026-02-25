import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { apiFetch } from "../auth/apiClient";
import { useAuth } from "../auth/AuthContext";
import { getOrigin, subscribeOriginChanged } from "../data/location/locationStore";
import {
  isFavorite as isUserFavorite,
  toggleFavorite as toggleUserFavorite,
  subscribeFavoritesChanged,
} from "../data/events/eventFavoritesStore";

type ChatRole = "user" | "assistant";

type CopilotSuggestion = {
  eventKey: string;
  title: string;
  startIso?: string | null;
  venue?: string | null;
  city?: string | null;
  distanceKm?: number | null;
  reasons?: string[];
  imageUrl?: string | null;
  tags?: string[];
};

type ChatMessage = {
  id: string;
  role: ChatRole;
  text: string;
  suggestions?: CopilotSuggestion[];
};

type CopilotResponse = {
  ok?: boolean;
  answer?: string;
  suggestions?: CopilotSuggestion[];
};

type PublicUser = { id: string; username: string; name: string; email: string };

type EventSocialResponse = {
  ok: boolean;
  eventKey: string;
  goingCount: number;
  myGoing: boolean;
  friendsGoing: PublicUser[];
};

type FriendsResponse = {
  ok: boolean;
  friends: PublicUser[];
};

function uid(prefix = "m") {
  return `${prefix}_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
}

/* =========================
   Per-user chat persistence
   ========================= */
const WIDGET_STORAGE_VERSION = "v2";

function defaultMessages(): ChatMessage[] {
  return [
    {
      id: uid(),
      role: "assistant",
      text:
        "Yo 👋 Beschrijf je avond zoals tegen een vriend:\n" +
        "“Vrijdag Brussel • techno/house • max 25km • niet te duur • 2 vrienden”\n\n" +
        "Ik drop meteen 3–5 matches met waarom + je kan direct Going/Save/Invite.",
    },
  ];
}

function storageKeyFor(userId?: string | number | null) {
  const u = userId ? String(userId) : "anon";
  return `eventify:vibe:${WIDGET_STORAGE_VERSION}:${u}`;
}

function safeJsonParse<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function formatStartIso(startIso?: string | null) {
  if (!startIso) return null;
  const d = new Date(startIso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString(undefined, {
    weekday: "short",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function WaveIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M3 12c3.2 0 3.2-6 6.4-6S12.6 18 15.8 18 18.9 12 21 12"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function MagicIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M5 19 19 5"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
      />
      <path
        d="M7 5l2 2M5 7l2 2M17 15l2 2M15 17l2 2"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
      />
    </svg>
  );
}

async function copyToClipboard(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      return true;
    } catch {
      return false;
    }
  }
}

export default function CopilotWidget() {
  const { user, token } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const storageKey = useMemo(() => storageKeyFor(user?.id), [user?.id]);

  const [isOpen, setIsOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(false);
  const [originLabel, setOriginLabel] = useState(getOrigin().label);

  const [, setFavTick] = useState(0);

  const [friendsAll, setFriendsAll] = useState<PublicUser[]>([]);
  const [friendsAllLoading, setFriendsAllLoading] = useState(false);
  const [friendsAllError, setFriendsAllError] = useState<string | null>(null);

  const [inviteOpen, setInviteOpen] = useState(false);
  const [invitePickId, setInvitePickId] = useState("");
  const [inviteTargets, setInviteTargets] = useState<string[]>([]);

  const [goingBusy, setGoingBusy] = useState<Record<string, boolean>>({});
  const [inviteBusy, setInviteBusy] = useState<Record<string, boolean>>({});
  const [socialByKey, setSocialByKey] = useState<
    Record<string, { myGoing: boolean; goingCount: number; friendsGoingCount: number }>
  >({});

  const [toast, setToast] = useState<string | null>(null);

  const [messages, setMessages] = useState<ChatMessage[]>(() => defaultMessages());

  const wrapRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const toastTimerRef = useRef<number | null>(null);

  function showToast(text: string) {
    setToast(text);
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setToast(null), 2200);
  }

  useEffect(() => {
    return subscribeOriginChanged(() => setOriginLabel(getOrigin().label));
  }, []);

  useEffect(() => {
    return subscribeFavoritesChanged(() => setFavTick((t) => t + 1));
  }, []);

  // Load per-user chat (fix: switching users keeps their own convo)
  useEffect(() => {
    const saved = safeJsonParse<{
      messages?: ChatMessage[];
      inviteTargets?: string[];
      inviteOpen?: boolean;
    }>(window.localStorage.getItem(storageKey));

    if (saved?.messages && Array.isArray(saved.messages) && saved.messages.length > 0) {
      setMessages(saved.messages);
    } else {
      setMessages(defaultMessages());
    }

    setInviteTargets(Array.isArray(saved?.inviteTargets) ? saved!.inviteTargets : []);
    setInviteOpen(Boolean(saved?.inviteOpen));
    setInvitePickId("");
    setDraft("");
    setSocialByKey({});
    setGoingBusy({});
    setInviteBusy({});
  }, [storageKey]);

  // Persist per user
  useEffect(() => {
    const trimmed = messages.slice(-30);
    window.localStorage.setItem(
      storageKey,
      JSON.stringify({
        messages: trimmed,
        inviteTargets,
        inviteOpen,
      })
    );
  }, [storageKey, messages, inviteTargets, inviteOpen]);

  // Load friends (for Invite)
  useEffect(() => {
    if (!token) {
      setFriendsAll([]);
      setFriendsAllError(null);
      setFriendsAllLoading(false);
      setInvitePickId("");
      setInviteTargets([]);
      return;
    }

    const controller = new AbortController();
    setFriendsAllLoading(true);
    setFriendsAllError(null);

    apiFetch<FriendsResponse>("/friends", { token, signal: controller.signal })
      .then((data) => setFriendsAll(Array.isArray(data.friends) ? data.friends : []))
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setFriendsAllError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!controller.signal.aborted) setFriendsAllLoading(false);
      });

    return () => controller.abort();
  }, [token]);

  // Close on outside click
  useEffect(() => {
    if (!isOpen) return;

    function onPointerDown(e: PointerEvent) {
      const target = e.target as Node | null;
      if (!target) return;
      const wrap = wrapRef.current;
      if (wrap && !wrap.contains(target)) setIsOpen(false);
    }

    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [isOpen]);

  // ESC closes
  useEffect(() => {
    if (!isOpen) return;

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setIsOpen(false);
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [isOpen]);

  // Focus composer on open
  useEffect(() => {
    if (!isOpen) return;
    window.setTimeout(() => inputRef.current?.focus(), 0);
  }, [isOpen]);

  const quickPrompts = useMemo(
    () => [
      "Vrijdag Brussel, techno/house, max 25km, niet te duur, 2 vrienden",
      "Dit weekend Gent, indie/rock, max 15km",
      "Zaterdag Antwerpen, house, max 20km, laat beginnen",
    ],
    []
  );

  function requireLogin() {
    navigate("/login", { state: { from: location.pathname + location.search } });
  }

  async function loadSocialFor(eventKeys: string[]) {
    if (!token || eventKeys.length === 0) return;

    const jobs = eventKeys.map(async (k) => {
      try {
        const data = await apiFetch<EventSocialResponse>(`/events/${encodeURIComponent(k)}/social`, {
          token,
        });

        return {
          key: k,
          value: {
            myGoing: Boolean(data.myGoing),
            goingCount: Number(data.goingCount) || 0,
            friendsGoingCount: Array.isArray(data.friendsGoing) ? data.friendsGoing.length : 0,
          },
        };
      } catch {
        return null;
      }
    });

    const results = await Promise.all(jobs);
    const next: Record<string, { myGoing: boolean; goingCount: number; friendsGoingCount: number }> = {};
    for (const r of results) {
      if (!r) continue;
      next[r.key] = r.value;
    }
    setSocialByKey((prev) => ({ ...prev, ...next }));
  }

  function addInviteTarget(friendId: string) {
    if (!friendId) return;
    setInviteTargets((prev) => (prev.includes(friendId) ? prev : [...prev, friendId]));
    setInvitePickId("");
  }

  function removeInviteTarget(friendId: string) {
    setInviteTargets((prev) => prev.filter((x) => x !== friendId));
  }

  function resetChat() {
    window.localStorage.removeItem(storageKey);
    setMessages(defaultMessages());
    setInviteTargets([]);
    setInvitePickId("");
    setDraft("");
    setSocialByKey({});
    setGoingBusy({});
    setInviteBusy({});
    showToast("Nieuwe chat ✨");
  }

  async function sendPrompt(prompt: string) {
    const text = prompt.trim();
    if (!text) return;

    setMessages((prev) => [...prev, { id: uid(), role: "user", text }]);
    setDraft("");
    setLoading(true);

    try {
      const origin = getOrigin();

      const data = await apiFetch<CopilotResponse>("/copilot", {
        method: "POST",
        token,
        body: {
          message: text,
          originLat: origin.lat,
          originLng: origin.lng,
          originLabel: origin.label,
          clientNowIso: new Date().toISOString(),
        },
      });

      const answer =
        (typeof data?.answer === "string" && data.answer.trim()) || "Oké — dit zijn mijn beste matches.";
      const suggestions = Array.isArray(data?.suggestions) ? data.suggestions.slice(0, 5) : [];

      setMessages((prev) => [
        ...prev,
        {
          id: uid(),
          role: "assistant",
          text: answer,
          suggestions: suggestions.length ? suggestions : undefined,
        },
      ]);

      if (suggestions.length) void loadSocialFor(suggestions.map((s) => s.eventKey));
    } catch (e) {
      const msg = (e as Error)?.message || "unknown error";
      setMessages((prev) => [
        ...prev,
        {
          id: uid(),
          role: "assistant",
          text: `Ik kan je matches nog niet laden.\nCheck backend + /copilot.\n\nError: ${msg}`,
        },
      ]);
    } finally {
      setLoading(false);
    }
  }

  async function toggleGoing(s: CopilotSuggestion) {
    if (!user || !token) return requireLogin();

    const k = s.eventKey;
    if (goingBusy[k]) return;

    const current = socialByKey[k]?.myGoing ?? false;
    const nextGoing = !current;

    setGoingBusy((prev) => ({ ...prev, [k]: true }));

    try {
      await apiFetch<{ ok: boolean; going: boolean }>(`/events/${encodeURIComponent(k)}/going`, {
        method: "PUT",
        token,
        body: {
          going: nextGoing,
          event: {
            title: s.title,
            city: s.city || "—",
            startIso: s.startIso || null,
            tags: Array.isArray(s.tags) ? s.tags : [],
          },
        },
      });

      try {
        const data = await apiFetch<EventSocialResponse>(`/events/${encodeURIComponent(k)}/social`, { token });
        setSocialByKey((prev) => ({
          ...prev,
          [k]: {
            myGoing: Boolean(data.myGoing),
            goingCount: Number(data.goingCount) || 0,
            friendsGoingCount: Array.isArray(data.friendsGoing) ? data.friendsGoing.length : 0,
          },
        }));
      } catch {
        setSocialByKey((prev) => ({
          ...prev,
          [k]: {
            myGoing: nextGoing,
            goingCount: prev[k]?.goingCount ?? 0,
            friendsGoingCount: prev[k]?.friendsGoingCount ?? 0,
          },
        }));
      }

      showToast(nextGoing ? "Marked Going ✓" : "Unmarked");
    } finally {
      setGoingBusy((prev) => ({ ...prev, [k]: false }));
    }
  }

  function toggleSave(s: CopilotSuggestion) {
    if (!user) return requireLogin();
    toggleUserFavorite(user.id, s.eventKey);
    showToast(isUserFavorite(user.id, s.eventKey) ? "Saved ★" : "Unsaved");
  }

  async function inviteFriends(s: CopilotSuggestion) {
    if (!user || !token) return requireLogin();

    const k = s.eventKey;
    if (inviteBusy[k]) return;

    if (inviteTargets.length === 0) {
      setInviteOpen(true);
      showToast("Selecteer vrienden om te inviten");
      return;
    }

    setInviteBusy((prev) => ({ ...prev, [k]: true }));

    try {
      await Promise.all(
        inviteTargets.map((inviteeId) =>
          apiFetch<{ ok: boolean; inviteId: string }>(`/events/${encodeURIComponent(k)}/invite`, {
            method: "POST",
            token,
            body: {
              inviteeId,
              event: {
                title: s.title,
                city: s.city || "—",
                startIso: s.startIso || null,
              },
            },
          })
        )
      );

      showToast("Invites sent ✅");
    } catch (err: unknown) {
      showToast(`Invite error`);
      setMessages((prev) => [
        ...prev,
        { id: uid(), role: "assistant", text: `Invite error: ${err instanceof Error ? err.message : String(err)}` },
      ]);
    } finally {
      setInviteBusy((prev) => ({ ...prev, [k]: false }));
    }
  }

  async function copyPitch(s: CopilotSuggestion) {
    const link = `${window.location.origin}/events/${encodeURIComponent(s.eventKey)}`;
    const when = formatStartIso(s.startIso || null);
    const where = [s.city, s.venue].filter(Boolean).join(" — ");
    const text = `Kom mee? "${s.title}"${when ? ` • ${when}` : ""}${where ? ` • ${where}` : ""}\n${link}`;
    const ok = await copyToClipboard(text);
    showToast(ok ? "Copied to clipboard" : "Copy failed");
  }

  return (
    <div className="copilotWrap" ref={wrapRef}>
      {isOpen && (
        <section className="copilotPanel" aria-label="Eventify assistant">
          <header className="aiHeader">
            <div className="aiHeaderLeft">
              <div className="aiBrand">
                <span className="aiBrandIcon">
                  <WaveIcon />
                </span>
                <div className="aiBrandText">
                  <div className="aiBrandName">
                    VibeFinder <span className="aiBadge">AI</span>
                  </div>
                  <div className="aiBrandSub">Origin: {originLabel}</div>
                </div>
              </div>
            </div>

            <div className="aiHeaderRight">
              <button className="aiIconBtn" type="button" onClick={resetChat} title="New chat">
                <MagicIcon />
              </button>
              <button className="aiIconBtn" type="button" onClick={() => setIsOpen(false)} aria-label="Close">
                ✕
              </button>
            </div>
          </header>

          <div className="aiBody">
            <div className="aiQuickRow" aria-label="Quick prompts">
              {quickPrompts.map((p) => (
                <button
                  key={p}
                  className="aiQuickChip"
                  type="button"
                  onClick={() => {
                    setDraft(p);
                    inputRef.current?.focus();
                  }}
                >
                  {p}
                </button>
              ))}
            </div>

            <div className="aiToolbar">
              <button
                className={`aiMiniBtn ${inviteOpen ? "aiMiniBtnActive" : ""}`}
                type="button"
                onClick={() => setInviteOpen((v) => !v)}
                disabled={!user || !token}
                title={!user || !token ? "Login to invite" : "Invite friends"}
              >
                Invite friends
              </button>

              <div className="aiToolbarHint">
                Tip: “vrijdag • stad • vibe • max km • budget”
              </div>
            </div>

            {inviteOpen && (
              <div className="aiInvite">
                {!user || !token ? (
                  <div className="aiInviteHint">Login om vrienden te inviten (SSE).</div>
                ) : friendsAllLoading ? (
                  <div className="aiInviteHint">Friends laden…</div>
                ) : friendsAllError ? (
                  <div className="aiInviteHint">Friends error: {friendsAllError}</div>
                ) : friendsAll.length === 0 ? (
                  <div className="aiInviteHint">Geen vrienden gevonden.</div>
                ) : (
                  <>
                    <div className="aiInviteRow">
                      <select
                        className="aiSelect"
                        value={invitePickId}
                        onChange={(e) => setInvitePickId(e.target.value)}
                      >
                        <option value="">Select friend…</option>
                        {friendsAll
                          .filter((f) => !inviteTargets.includes(f.id))
                          .map((f) => (
                            <option key={f.id} value={f.id}>
                              {f.name}
                              {f.username ? ` (@${f.username})` : ""}
                            </option>
                          ))}
                      </select>

                      <button
                        className="aiBtn aiBtnOutline"
                        type="button"
                        disabled={!invitePickId}
                        onClick={() => addInviteTarget(invitePickId)}
                      >
                        Add
                      </button>
                    </div>

                    <div className="aiPills">
                      {inviteTargets.map((fid) => {
                        const f = friendsAll.find((x) => x.id === fid);
                        return (
                          <button
                            key={fid}
                            type="button"
                            className="aiPill"
                            onClick={() => removeInviteTarget(fid)}
                            title="Remove"
                          >
                            {f?.name || "Friend"} ✕
                          </button>
                        );
                      })}
                    </div>
                  </>
                )}
              </div>
            )}

            <div className="aiMessages" aria-label="Conversation">
              {messages.map((m) => (
                <div key={m.id} className={m.role === "user" ? "aiMsg aiMsgUser" : "aiMsg aiMsgAssistant"}>
                  <div className="aiBubble">
                    {m.text.split("\n").map((line, idx) => (
                      <p key={idx} className="aiLine">
                        {line}
                      </p>
                    ))}

                    {m.suggestions && m.suggestions.length > 0 ? (
                      <div className="aiCards" aria-label="Suggestions">
                        {m.suggestions.map((s) => {
                          const social = socialByKey[s.eventKey];
                          const isGoing = social?.myGoing ?? false;
                          const goingCount = social?.goingCount ?? null;
                          const friendsGoingCount = social?.friendsGoingCount ?? null;
                          const isFav = user ? isUserFavorite(user.id, s.eventKey) : false;

                          const when = formatStartIso(s.startIso || null);
                          const where = [s.venue, s.city].filter(Boolean).join(" — ");
                          const dist = typeof s.distanceKm === "number" ? `${Math.round(s.distanceKm)}km` : null;
                          const eventLink = `/events/${encodeURIComponent(s.eventKey)}`;

                          return (
                            <article key={s.eventKey} className="aiCard">
                              <div className="aiCardTop">
                                <div className="aiCardTitleWrap">
                                  <Link className="aiCardTitle" to={eventLink}>
                                    {s.title}
                                  </Link>
                                  <div className="aiCardMeta">
                                    {when ? when : "TBA"}
                                    {where ? ` • ${where}` : ""}
                                    {dist ? ` • ${dist}` : ""}
                                  </div>
                                </div>

                                <div className="aiStats">
                                  {typeof goingCount === "number" ? <span className="aiStat">{goingCount} going</span> : null}
                                  {typeof friendsGoingCount === "number" && friendsGoingCount > 0 ? (
                                    <span className="aiStat">{friendsGoingCount} friend(s)</span>
                                  ) : null}
                                </div>
                              </div>

                              {Array.isArray(s.reasons) && s.reasons.length ? (
                                <div className="aiReasons">
                                  {s.reasons.slice(0, 4).map((r) => (
                                    <span key={r} className="aiReasonChip">
                                      {r}
                                    </span>
                                  ))}
                                </div>
                              ) : null}

                              <div className="aiActions">
                                <button
                                  className={`aiBtn ${isGoing ? "aiBtnPrimary" : "aiBtnOutline"}`}
                                  type="button"
                                  disabled={Boolean(goingBusy[s.eventKey])}
                                  onClick={() => void toggleGoing(s)}
                                >
                                  {goingBusy[s.eventKey] ? "…" : isGoing ? "Going ✓" : "Going"}
                                </button>

                                <button
                                  className={`aiBtn ${isFav ? "aiBtnPrimary" : "aiBtnOutline"}`}
                                  type="button"
                                  onClick={() => toggleSave(s)}
                                >
                                  {isFav ? "Saved ★" : "Save"}
                                </button>

                                <button
                                  className="aiBtn aiBtnOutline"
                                  type="button"
                                  disabled={!token || Boolean(inviteBusy[s.eventKey])}
                                  onClick={() => void inviteFriends(s)}
                                  title={!token ? "Login to invite" : ""}
                                >
                                  {inviteBusy[s.eventKey] ? "…" : "Invite"}
                                </button>

                                <button className="aiBtn aiBtnGhost" type="button" onClick={() => void copyPitch(s)}>
                                  Copy pitch
                                </button>

                                <Link className="aiBtn aiBtnGhost" to={eventLink}>
                                  Open
                                </Link>
                              </div>
                            </article>
                          );
                        })}
                      </div>
                    ) : null}
                  </div>
                </div>
              ))}

              {loading && (
                <div className="aiMsg aiMsgAssistant">
                  <div className="aiBubble aiBubbleLoading">Searching the vibe…</div>
                </div>
              )}
            </div>
          </div>

          <form
            className="aiComposer"
            onSubmit={(e) => {
              e.preventDefault();
              void sendPrompt(draft);
            }}
          >
            <textarea
              ref={inputRef}
              className="aiInput"
              rows={2}
              placeholder='Typ bv: “Vrijdag Brussel, techno, max 25km, niet te duur, 2 vrienden”'
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void sendPrompt(draft);
                }
              }}
            />

            <button className="aiSend" type="submit" disabled={loading || !draft.trim()}>
              Send
            </button>
          </form>

          {toast ? <div className="aiToast">{toast}</div> : null}
        </section>
      )}

      <button
        className={`copilotFab ${isOpen ? "copilotFabOpen" : ""}`}
        onClick={() => setIsOpen((v) => !v)}
        aria-label={isOpen ? "Close assistant" : "Open assistant"}
        aria-expanded={isOpen}
      >
        <span className="aiFabIcon">
          <WaveIcon />
        </span>
        <span className="aiFabDot" aria-hidden="true" />
      </button>
    </div>
  );
}