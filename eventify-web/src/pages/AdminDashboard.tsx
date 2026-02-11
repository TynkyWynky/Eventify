import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
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

export default function AdminDashboard() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";

  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    if (!isAdmin) return;
    return subscribeOrganizerEventsChanged(() =>
      setRefreshKey((k) => k + 1)
    );
  }, [isAdmin]);

  void refreshKey;

  const all = isAdmin ? listOrganizerEventsAll() : [];
  const pending = all.filter((e) => e.status === "pending");
  const approved = all.filter((e) => e.status === "approved");
  const rejected = all.filter((e) => e.status === "rejected");

  if (!isAdmin || !user) return null;

  return (
    <div className="adminPage">
      <div className="adminHeaderRow">
        <div>
          <div className="sectionTitle">Admin Dashboard</div>
          <div className="sectionHint">Approve / reject organizer events.</div>
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

      <div className="adminStatsGrid">
        <div className="adminStatCard">
          <div className="adminStatLabel">Total organizer events</div>
          <div className="adminStatValue">{all.length}</div>
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

      <div className="adminSection">
        <div className="sectionTitle">Pending review</div>
        <div className="sectionHint">
          Only approved events become visible for everyone.
        </div>

        <div className="adminList">
          {pending.length === 0 ? (
            <div className="sectionHint">No pending events 🎉</div>
          ) : (
            pending.map((e) => (
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
                      OwnerId: <b>{e.ownerId}</b>
                    </div>
                  </div>

                  <div className="adminEventActions">
                    <button
                      className="btn btnPrimary"
                      type="button"
                      onClick={() =>
                        reviewOrganizerEvent(user.id, e.id, "approved")
                      }
                    >
                      Approve
                    </button>
                    <button
                      className="btn btnSecondary"
                      type="button"
                      onClick={() =>
                        reviewOrganizerEvent(user.id, e.id, "rejected")
                      }
                    >
                      Reject
                    </button>
                  </div>
                </div>

                <div className="adminEventDesc">{e.description}</div>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="adminSection">
        <div className="sectionTitle">All organizer events</div>
        <div className="sectionHint">Overview for admins.</div>

        <div className="adminOverviewList">
          {all.length === 0 ? (
            <div className="sectionHint">No organizer events yet.</div>
          ) : (
            all.map((e) => (
              <div key={e.id} className="adminRow">
                <div className="adminRowLeft">
                  <div className="adminRowTitle">{e.title}</div>
                  <div className="adminRowMeta">
                    {e.city} • {e.dateLabel} • Owner: {e.ownerId}
                  </div>
                </div>

                <StatusPill status={e.status} />
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
