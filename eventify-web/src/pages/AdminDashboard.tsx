import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import type { Role } from "../auth/authTypes";
import { useNotifications } from "../components/NotificationProvider";
import {
  apiFetch,
  type AdminUsersResponse,
  type AdminUserDto,
  type AdminDisabledEventsResponse,
  type DisabledEventDto,
} from "../auth/apiClient";

import {
  listOrganizerEventsAll,
  reviewOrganizerEvent,
  subscribeOrganizerEventsChanged,
  type OrganizerEvent,
} from "../data/events/organizerEventsStore";

function StatusPill({ status }: { status: OrganizerEvent["status"] }) {
  return <span className={`adminStatusPill adminStatus_${status}`}>{status}</span>;
}

function RolePill({ role }: { role: Role }) {
  return <span className="adminStatusPill">{role}</span>;
}

function formatDateTime(raw: string | null) {
  if (!raw) return "—";
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return raw;
  return d.toLocaleString();
}

function normalize(s: string) {
  return s.trim().toLowerCase();
}

function roleWeight(r: Role) {
  return r === "admin" ? 3 : r === "organizer" ? 2 : 1;
}

type RoleFilter = "all" | Role;
type ActiveFilter = "all" | "active" | "disabled";
type SortKey = "createdAt" | "lastLogin" | "name" | "email" | "username" | "role";
type SortDir = "asc" | "desc";

export default function AdminDashboard() {
  const { user, token } = useAuth();
  const { notify } = useNotifications();
  const isAdmin = user?.role === "admin";

  const [refreshKey, setRefreshKey] = useState(0);
  const [actionError, setActionError] = useState<string | null>(null);

  const [users, setUsers] = useState<AdminUserDto[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);

  // Organizer events review state
  const [reviewEvents, setReviewEvents] = useState<OrganizerEvent[]>([]);
  const [reviewLoading, setReviewLoading] = useState(false);

  // Disabled (moderated) remote events
  const [disabledEvents, setDisabledEvents] = useState<DisabledEventDto[]>([]);
  const [disabledLoading, setDisabledLoading] = useState(false);
  const [disabledSearch, setDisabledSearch] = useState("");

  // UI state (search/filter/sort)
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<RoleFilter>("all");
  const [activeFilter, setActiveFilter] = useState<ActiveFilter>("all");
  const [sortKey, setSortKey] = useState<SortKey>("createdAt");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  useEffect(() => {
    if (!isAdmin) return;

    const bump = () => setRefreshKey((k) => k + 1);
    const unsub = subscribeOrganizerEventsChanged(bump);

    return () => unsub();
  }, [isAdmin]);

  useEffect(() => {
    if (!isAdmin) return;
    if (!token) return;

    const controller = new AbortController();

    (async () => {
      try {
        setUsersLoading(true);
        setActionError(null);

        const data = await apiFetch<AdminUsersResponse>("/admin/users", {
          token,
          signal: controller.signal,
        });

        if (!data.ok || !data.users) throw new Error("Failed to load users");
        setUsers(data.users);
      } catch (e: unknown) {
        if (e instanceof DOMException && e.name === "AbortError") return;
        setActionError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!controller.signal.aborted) setUsersLoading(false);
      }
    })();

    return () => controller.abort();
  }, [isAdmin, token, refreshKey]);

  useEffect(() => {
    if (!isAdmin) return;

    let cancelled = false;

    (async () => {
      try {
        setReviewLoading(true);
        const items = await listOrganizerEventsAll();
        if (!cancelled) setReviewEvents(items);
      } catch (e: unknown) {
        if (cancelled) return;
        setReviewEvents([]);
        setActionError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setReviewLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isAdmin, refreshKey]);

  useEffect(() => {
    if (!isAdmin) return;
    if (!token) return;

    const controller = new AbortController();

    (async () => {
      try {
        setDisabledLoading(true);
        const data = await apiFetch<AdminDisabledEventsResponse>("/admin/events/disabled", {
          token,
          signal: controller.signal,
        });

        if (!data.ok) throw new Error("Failed to load disabled events");
        setDisabledEvents(Array.isArray(data.items) ? data.items : []);
      } catch (e: unknown) {
        if (e instanceof DOMException && e.name === "AbortError") return;
        setDisabledEvents([]);
        setActionError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!controller.signal.aborted) setDisabledLoading(false);
      }
    })();

    return () => controller.abort();
  }, [isAdmin, token, refreshKey]);


  const safeUsers = useMemo(() => (isAdmin ? users : []), [isAdmin, users]);

  const totalCounts = useMemo(() => {
    const c: Record<Role, number> = { user: 0, organizer: 0, admin: 0 };
    for (const u of safeUsers) c[u.role] = (c[u.role] ?? 0) + 1;
    return c;
  }, [safeUsers]);

  const filteredSortedUsers = useMemo(() => {
    const q = normalize(search);

    let list = safeUsers.slice();

    if (roleFilter !== "all") list = list.filter((u) => u.role === roleFilter);

    if (activeFilter !== "all") {
      list = list.filter((u) => (activeFilter === "active" ? u.isActive : !u.isActive));
    }

    if (q) {
      list = list.filter((u) => {
        const hay = [
          u.name,
          u.email,
          u.username,
          u.id,
          u.role,
          u.isActive ? "active" : "disabled",
        ]
          .join(" ")
          .toLowerCase();
        return hay.includes(q);
      });
    }

    const dirMul = sortDir === "asc" ? 1 : -1;

    function dateValue(raw: string | null) {
      if (!raw) return -1;
      const t = new Date(raw).getTime();
      return Number.isNaN(t) ? -1 : t;
    }

    list.sort((a, b) => {
      let va: string | number = "";
      let vb: string | number = "";

      switch (sortKey) {
        case "createdAt":
          va = dateValue(a.createdAt);
          vb = dateValue(b.createdAt);
          break;
        case "lastLogin":
          va = dateValue(a.lastLogin);
          vb = dateValue(b.lastLogin);
          break;
        case "name":
          va = a.name.toLowerCase();
          vb = b.name.toLowerCase();
          break;
        case "email":
          va = a.email.toLowerCase();
          vb = b.email.toLowerCase();
          break;
        case "username":
          va = a.username.toLowerCase();
          vb = b.username.toLowerCase();
          break;
        case "role":
          va = roleWeight(a.role);
          vb = roleWeight(b.role);
          break;
        default:
          va = a.name.toLowerCase();
          vb = b.name.toLowerCase();
      }

      if (typeof va === "number" && typeof vb === "number") {
        return (va - vb) * dirMul;
      }
      return String(va).localeCompare(String(vb)) * dirMul;
    });

    return list;
  }, [safeUsers, search, roleFilter, activeFilter, sortKey, sortDir]);

  const showingCounts = useMemo(() => {
    const c: Record<Role, number> = { user: 0, organizer: 0, admin: 0 };
    for (const u of filteredSortedUsers) c[u.role] = (c[u.role] ?? 0) + 1;
    return c;
  }, [filteredSortedUsers]);

  const filteredDisabledEvents = useMemo(() => {
    const q = normalize(disabledSearch);
    if (!q) return disabledEvents.slice();

    return disabledEvents.filter((e) => {
      const title = typeof e.snapshot?.title === "string" ? String(e.snapshot.title) : "";
      const hay = [e.eventKey, e.reason || "", title].join(" ").toLowerCase();
      return hay.includes(q);
    });
  }, [disabledEvents, disabledSearch]);


  async function handleSetRole(userId: string, role: Role) {
    if (!token || !user) return;

    if (userId === user.id && role !== "admin") {
      notify("You cannot remove your own admin role.", "error");
      return;
    }

    try {
      setActionError(null);
      await apiFetch("/admin/users/" + encodeURIComponent(userId) + "/role", {
        method: "PATCH",
        token,
        body: { role },
      });
      setRefreshKey((k) => k + 1);
    } catch (e: unknown) {
      setActionError(e instanceof Error ? e.message : String(e));
    }
  }

  async function handleSetActive(userId: string, isActive: boolean) {
    if (!token || !user) return;

    if (userId === user.id && !isActive) {
      notify("You cannot disable your own account.", "error");
      return;
    }

    if (!isActive) {
      const ok = confirm("Disable this account? They will no longer be able to login.");
      if (!ok) return;
    }

    try {
      setActionError(null);
      await apiFetch("/admin/users/" + encodeURIComponent(userId) + "/active", {
        method: "PATCH",
        token,
        body: { isActive },
      });
      setRefreshKey((k) => k + 1);
    } catch (e: unknown) {
      setActionError(e instanceof Error ? e.message : String(e));
    }
  }



  async function handleEnableEvent(eventKey: string) {
    if (!token) return;

    const ok = confirm("Enable this event again? It will show up in the feed.");
    if (!ok) return;

    try {
      setActionError(null);
      await apiFetch("/admin/events/" + encodeURIComponent(eventKey) + "/disabled", {
        method: "PATCH",
        token,
        body: { disabled: false },
      });
      setRefreshKey((k) => k + 1);
    } catch (e: unknown) {
      setActionError(e instanceof Error ? e.message : String(e));
    }
  }
  const allEvents = useMemo(() => (isAdmin ? reviewEvents : []), [isAdmin, reviewEvents]);
  const pending = useMemo(() => allEvents.filter((e) => e.status === "pending"), [allEvents]);
  const approved = useMemo(() => allEvents.filter((e) => e.status === "approved"), [allEvents]);
  const rejected = useMemo(() => allEvents.filter((e) => e.status === "rejected"), [allEvents]);

  function findOwner(ownerId: string) {
    return safeUsers.find((u) => u.id === ownerId) ?? null;
  }

  async function handleReview(e: OrganizerEvent, next: "approved" | "rejected") {
    if (!user) return;

    try {
      setActionError(null);
      await reviewOrganizerEvent(user.id, e.id, next);
      setRefreshKey((k) => k + 1);
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : String(err));
    }
  }

  function resetFilters() {
    setSearch("");
    setRoleFilter("all");
    setActiveFilter("all");
    setSortKey("createdAt");
    setSortDir("desc");
  }

  if (!isAdmin || !user) return null;

  return (
    <div className="adminPage">
      <div className="adminHeaderRow">
        <div>
          <div className="sectionTitle">Admin Dashboard</div>
          <div className="sectionHint">Manage users/roles + review organizer events.</div>
        </div>

        <div className="adminHeaderActions">
          <Link className="btn btnSecondary" to="/">
            ← Dashboard
          </Link>
          <button className="btn btnSecondary" type="button" onClick={() => setRefreshKey((k) => k + 1)}>
            Refresh
          </button>
        </div>
      </div>

      {actionError ? <div className="authError">{actionError}</div> : null}

      <div className="adminSection">
        <div className="sectionTitle">Users & roles</div>
        <div className="sectionHint">
          DB-backed users. Roles are enforced via JWT. Showing <b>{filteredSortedUsers.length}</b> of{" "}
          <b>{safeUsers.length}</b>.
        </div>

        {/* Controls: search on top, filters in a row under it */}
        <div className="adminControls">
          <div className="adminControlsSearch">
            <input
              className="authInput"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name, email, username, id…"
            />
          </div>

          <div className="adminControlsGrid">
            <div className="adminControl">
              <select
                className="authInput"
                value={roleFilter}
                onChange={(e) => setRoleFilter(e.target.value as RoleFilter)}
              >
                <option value="all">All roles</option>
                <option value="user">User</option>
                <option value="organizer">Organizer</option>
                <option value="admin">Admin</option>
              </select>
            </div>

            <div className="adminControl">
              <select
                className="authInput"
                value={activeFilter}
                onChange={(e) => setActiveFilter(e.target.value as ActiveFilter)}
              >
                <option value="all">All statuses</option>
                <option value="active">Active</option>
                <option value="disabled">Disabled</option>
              </select>
            </div>

            <div className="adminControl">
              <select
                className="authInput"
                value={sortKey}
                onChange={(e) => setSortKey(e.target.value as SortKey)}
              >
                <option value="createdAt">Sort: Created</option>
                <option value="lastLogin">Sort: Last login</option>
                <option value="name">Sort: Name</option>
                <option value="email">Sort: Email</option>
                <option value="username">Sort: Username</option>
                <option value="role">Sort: Role</option>
              </select>
            </div>

            <div className="adminControl">
              <select
                className="authInput"
                value={sortDir}
                onChange={(e) => setSortDir(e.target.value as SortDir)}
              >
                <option value="desc">Desc</option>
                <option value="asc">Asc</option>
              </select>
            </div>

            <div className="adminControl adminControlButton">
              <button className="btn btnSecondary" type="button" onClick={resetFilters}>
                Reset
              </button>
            </div>
          </div>
        </div>

        <div className="adminStatsGrid">
          <div className="adminStatCard">
            <div className="adminStatLabel">Showing users</div>
            <div className="adminStatValue">{showingCounts.user}</div>
          </div>
          <div className="adminStatCard">
            <div className="adminStatLabel">Showing organizers</div>
            <div className="adminStatValue">{showingCounts.organizer}</div>
          </div>
          <div className="adminStatCard">
            <div className="adminStatLabel">Showing admins</div>
            <div className="adminStatValue">{showingCounts.admin}</div>
          </div>
          <div className="adminStatCard">
            <div className="adminStatLabel">Total accounts</div>
            <div className="adminStatValue">{safeUsers.length}</div>
          </div>
        </div>

        <div className="adminOverviewList">
          {usersLoading ? (
            <div className="sectionHint">Loading users…</div>
          ) : filteredSortedUsers.length === 0 ? (
            <div className="sectionHint">No users match your filters.</div>
          ) : (
            filteredSortedUsers.map((u) => (
              <div key={u.id} className="adminRow">
                <div className="adminRowLeft">
                  <div className="adminRowTitle">
                    {u.name}{" "}
                    {!u.isActive ? <span className="adminBadgeMuted">disabled</span> : null}{" "}
                    {u.id === user.id ? <span className="adminBadgeMuted">you</span> : null}
                  </div>
                  <div className="adminRowMeta">
                    {u.email} • @{u.username} • id: {u.id}
                  </div>
                  <div className="adminRowMeta">
                    Created: {formatDateTime(u.createdAt)} • Last login: {formatDateTime(u.lastLogin)}
                  </div>
                </div>

                <div className="adminEventActions">
                  <RolePill role={u.role} />

                  <button
                    className="btn btnSecondary"
                    type="button"
                    onClick={() => handleSetRole(u.id, "user")}
                    disabled={u.role === "user" || u.id === user.id}
                    title={u.id === user.id ? "You cannot change your own role" : ""}
                  >
                    Set user
                  </button>

                  <button
                    className="btn btnSecondary"
                    type="button"
                    onClick={() => handleSetRole(u.id, "organizer")}
                    disabled={u.role === "organizer" || u.id === user.id}
                    title={u.id === user.id ? "You cannot change your own role" : ""}
                  >
                    Set organizer
                  </button>

                  <button
                    className="btn btnSecondary"
                    type="button"
                    onClick={() => {
                      if (u.id === user.id) return;
                      if (!confirm("Make this account ADMIN?")) return;
                      handleSetRole(u.id, "admin");
                    }}
                    disabled={u.role === "admin"}
                  >
                    Set admin
                  </button>

                  <button
                    className="btn btnSecondary"
                    type="button"
                    onClick={() => handleSetActive(u.id, !u.isActive)}
                    disabled={u.id === user.id}
                    title={u.id === user.id ? "You cannot disable your own account" : ""}
                  >
                    {u.isActive ? "Disable" : "Enable"}
                  </button>
                </div>
              </div>
            ))
          )}
        </div>

        <div className="sectionHint">
          Totals in DB — Users: <b>{totalCounts.user}</b> • Organizers: <b>{totalCounts.organizer}</b> • Admins:{" "}
          <b>{totalCounts.admin}</b>
        </div>
      </div>

      <div className="adminSection">
        <div className="sectionTitle">Organizer events review</div>
        <div className="sectionHint">Pending items from organizer submissions.</div>

        <div className="adminStatsGrid">
          <div className="adminStatCard">
            <div className="adminStatLabel">Total organizer events</div>
            <div className="adminStatValue">{allEvents.length}</div>
          </div>
          <div className="adminStatCard">
            <div className="adminStatLabel">Pending</div>
            <div className="adminStatValue">{pending.length}</div>
          </div>
          <div className="adminStatCard">
            <div className="adminStatLabel">Approved</div>
            <div className="adminStatValue">{approved.length}</div>
          </div>
          <div className="adminStatCard">
            <div className="adminStatLabel">Rejected</div>
            <div className="adminStatValue">{rejected.length}</div>
          </div>
        </div>

        <div className="adminList">
          {reviewLoading ? (
            <div className="sectionHint">Loading organizer events…</div>
          ) : pending.length === 0 ? (
            <div className="sectionHint">No pending events 🎉</div>
          ) : (
            pending.map((e) => {
              const owner = findOwner(e.ownerId);

              return (
                <div key={e.id} className="adminEventCard">
                  <div className="adminEventTop">
                    <div className="adminEventMain">
                      <div className="adminEventTitleRow">
                        <div className="adminEventTitle">{e.title}</div>
                        <StatusPill status={e.status} />
                      </div>

                      <div className="adminEventMeta">
                        {e.venue} • {e.city} • {e.dateLabel}
                      </div>

                      <div className="adminEventOwner">
                        Owner: <b>{owner ? `${owner.name} (${owner.email})` : e.ownerId}</b>
                        {owner ? (
                          <>
                            {" "}
                            • Role: <b>{owner.role}</b>
                          </>
                        ) : null}
                      </div>

                      <div className="sectionHint">
                        Approving will publish the event and set the owner role to <b>organizer</b>.
                      </div>
                    </div>

                    <div className="adminEventActions">
                      <button className="btn btnPrimary" type="button" onClick={() => handleReview(e, "approved")}>
                        Approve
                      </button>
                      <button className="btn btnSecondary" type="button" onClick={() => handleReview(e, "rejected")}>
                        Reject
                      </button>
                    </div>
                  </div>

                  <div className="adminEventDesc">{e.description}</div>
                </div>
              );
            })
          )}
        </div>
      </div>


      <div className="adminSection">
        <div className="sectionTitle">Disabled events (moderation)</div>
        <div className="sectionHint">
          These are hidden from the public feed. Use this list to re-enable if you disabled the wrong one.
        </div>

        <div className="adminControls">
          <div className="adminControlsSearch">
            <input
              className="authInput"
              value={disabledSearch}
              onChange={(e) => setDisabledSearch(e.target.value)}
              placeholder="Search disabled events (key / reason / title)…"
            />
          </div>
        </div>

        <div className="adminOverviewList">
          {disabledLoading ? (
            <div className="sectionHint">Loading disabled events…</div>
          ) : filteredDisabledEvents.length === 0 ? (
            <div className="sectionHint">No disabled events.</div>
          ) : (
            filteredDisabledEvents.map((e) => {
              const title = typeof e.snapshot?.title === "string" ? String(e.snapshot.title) : "";
              const city = typeof e.snapshot?.city === "string" ? String(e.snapshot.city) : "";
              const startIso = typeof e.snapshot?.startIso === "string" ? String(e.snapshot.startIso) : "";

              return (
                <div key={e.eventKey} className="adminRow">
                  <div className="adminRowLeft">
                    <div className="adminRowTitle">
                      {title ? title : e.eventKey} <span className="adminBadgeMuted">disabled</span>
                    </div>
                    <div className="adminRowMeta">
                      Key: <b>{e.eventKey}</b>
                      {city ? <> • {city}</> : null}
                      {startIso ? <> • {formatDateTime(startIso)}</> : null}
                    </div>
                    {e.reason ? <div className="adminRowMeta">Reason: {e.reason}</div> : null}
                    <div className="adminRowMeta">
                      Disabled: {formatDateTime(e.updatedAt)}
                      {e.disabledBy ? <> • By: {e.disabledBy.name} ({e.disabledBy.email})</> : null}
                    </div>
                  </div>

                  <div className="adminEventActions">
                    <button
                      className="btn btnSecondary"
                      type="button"
                      onClick={() => handleEnableEvent(e.eventKey)}
                    >
                      Enable
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>

        <div className="sectionHint">
          Showing <b>{filteredDisabledEvents.length}</b> disabled events.
        </div>
      </div>
    </div>
  );
}
