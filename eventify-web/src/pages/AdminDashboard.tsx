import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import type { Role } from "../auth/authTypes";
import {
  listUsers,
  setUserRole,
  subscribeUsersChanged,
} from "../auth/usersStore";
import {
  listOrganizerEventsAll,
  reviewOrganizerEvent,
  subscribeOrganizerEventsChanged,
  type OrganizerEvent,
} from "../data/events/organizerEventsStore";

function StatusPill({ status }: { status: OrganizerEvent["status"] }) {
  return (
    <span className={`adminStatusPill adminStatus_${status}`}>{status}</span>
  );
}

function RolePill({ role }: { role: Role }) {
  return <span className="adminStatusPill">{role}</span>;
}

export default function AdminDashboard() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";

  const [refreshKey, setRefreshKey] = useState(0);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    if (!isAdmin) return;

    const bump = () => setRefreshKey((k) => k + 1);

    const unsubEvents = subscribeOrganizerEventsChanged(bump);
    const unsubUsers = subscribeUsersChanged(bump);

    return () => {
      unsubEvents();
      unsubUsers();
    };
  }, [isAdmin]);

  void refreshKey;

  const allEvents = isAdmin ? listOrganizerEventsAll() : [];
  const pending = allEvents.filter((e) => e.status === "pending");
  const approved = allEvents.filter((e) => e.status === "approved");
  const rejected = allEvents.filter((e) => e.status === "rejected");

  const users = useMemo(() => (isAdmin ? listUsers() : []), [isAdmin]);

  const userCounts = useMemo(() => {
    const c: Record<Role, number> = { user: 0, organizer: 0, admin: 0 };
    for (const u of users) c[u.role] = (c[u.role] ?? 0) + 1;
    return c;
  }, [users]);

  function findOwner(ownerId: string) {
    return users.find((u) => u.id === ownerId) ?? null;
  }

  function handleSetRole(userId: string, role: Role) {
    try {
      setActionError(null);
      setUserRole(userId, role);
      setRefreshKey((k) => k + 1);
    } catch (e: unknown) {
      setActionError(e instanceof Error ? e.message : String(e));
    }
  }

  function handleReview(eventId: string, next: "approved" | "rejected") {
    if (!user) return;
    try {
      setActionError(null);
      reviewOrganizerEvent(user.id, eventId, next);
      setRefreshKey((k) => k + 1);
    } catch (e: unknown) {
      setActionError(e instanceof Error ? e.message : String(e));
    }
  }

  if (!isAdmin || !user) return null;

  return (
    <div className="adminPage">
      <div className="adminHeaderRow">
        <div>
          <div className="sectionTitle">Admin Dashboard</div>
          <div className="sectionHint">
            Approve / reject organizer events + manage user roles.
          </div>
        </div>

        <div className="adminHeaderActions">
          <Link className="btn btnSecondary" to="/">
            ← Dashboard
          </Link>
          <button
            className="btn btnSecondary"
            type="button"
            onClick={() => setRefreshKey((k) => k + 1)}
          >
            Refresh
          </button>
        </div>
      </div>

      {actionError ? <div className="authError">{actionError}</div> : null}

      {/* Stats */}
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

      {/* Users / Roles */}
      <div className="adminSection">
        <div className="sectionTitle">Users & roles</div>
        <div className="sectionHint">
          When an organizer event is approved, the owner is automatically upgraded to{" "}
          <b>organizer</b>.
        </div>

        <div className="adminStatsGrid">
          <div className="adminStatCard">
            <div className="adminStatLabel">Users</div>
            <div className="adminStatValue">{userCounts.user}</div>
          </div>
          <div className="adminStatCard">
            <div className="adminStatLabel">Organizers</div>
            <div className="adminStatValue">{userCounts.organizer}</div>
          </div>
          <div className="adminStatCard">
            <div className="adminStatLabel">Admins</div>
            <div className="adminStatValue">{userCounts.admin}</div>
          </div>
          <div className="adminStatCard">
            <div className="adminStatLabel">Total accounts</div>
            <div className="adminStatValue">{users.length}</div>
          </div>
        </div>

        <div className="adminOverviewList">
          {users.length === 0 ? (
            <div className="sectionHint">No users found.</div>
          ) : (
            users.map((u) => (
              <div key={u.id} className="adminRow">
                <div className="adminRowLeft">
                  <div className="adminRowTitle">{u.name}</div>
                  <div className="adminRowMeta">
                    {u.email} • Id: {u.id}
                  </div>
                </div>

                <div className="adminEventActions">
                  <RolePill role={u.role} />

                  <button
                    className="btn btnSecondary"
                    type="button"
                    onClick={() => handleSetRole(u.id, "user")}
                    disabled={u.role === "user"}
                  >
                    Set user
                  </button>

                  <button
                    className="btn btnSecondary"
                    type="button"
                    onClick={() => handleSetRole(u.id, "organizer")}
                    disabled={u.role === "organizer"}
                  >
                    Set organizer
                  </button>

                  <button
                    className="btn btnSecondary"
                    type="button"
                    onClick={() => {
                      if (!confirm("Make this account ADMIN?")) return;
                      handleSetRole(u.id, "admin");
                    }}
                    disabled={u.role === "admin"}
                  >
                    Set admin
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Pending review */}
      <div className="adminSection">
        <div className="sectionTitle">Pending review</div>
        <div className="sectionHint">
          Only approved events become visible for everyone.
        </div>

        <div className="adminList">
          {pending.length === 0 ? (
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
                        Owner:{" "}
                        <b>
                          {owner ? `${owner.name} (${owner.email})` : e.ownerId}
                        </b>{" "}
                        {owner ? (
                          <>
                            • Role: <b>{owner.role}</b>
                          </>
                        ) : null}
                      </div>

                      <div className="sectionHint">
                        Approving will publish this event AND auto-upgrade the owner to{" "}
                        <b>organizer</b>.
                      </div>
                    </div>

                    <div className="adminEventActions">
                      <button
                        className="btn btnPrimary"
                        type="button"
                        onClick={() => handleReview(e.id, "approved")}
                      >
                        Approve
                      </button>
                      <button
                        className="btn btnSecondary"
                        type="button"
                        onClick={() => handleReview(e.id, "rejected")}
                      >
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

      {/* All organizer events */}
      <div className="adminSection">
        <div className="sectionTitle">All organizer events</div>
        <div className="sectionHint">Overview for admins.</div>

        <div className="adminOverviewList">
          {allEvents.length === 0 ? (
            <div className="sectionHint">No organizer events yet.</div>
          ) : (
            allEvents.map((e) => {
              const owner = findOwner(e.ownerId);

              return (
                <div key={e.id} className="adminRow">
                  <div className="adminRowLeft">
                    <div className="adminRowTitle">{e.title}</div>
                    <div className="adminRowMeta">
                      {e.city} • {e.dateLabel} • Owner:{" "}
                      {owner ? `${owner.name} (${owner.email})` : e.ownerId}
                    </div>
                  </div>

                  <StatusPill status={e.status} />
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
