type PublicUser = {
  id: string;
  username: string;
  name: string;
  email: string;
};

type GroupPlanItem = {
  id: string;
  eventKey: string;
  title: string;
  note: string;
  status: "open" | "closed";
  options: string[];
  createdAt: string;
  updatedAt: string;
  creator: PublicUser;
  members: Array<{ role: "creator" | "invited"; user: PublicUser; joinedAt: string }>;
  voteCounts: Record<string, number>;
  myVote: number | null;
};

type GroupPlansPanelProps = {
  isLoggedIn: boolean;
  friendsAll: PublicUser[];
  plans: GroupPlanItem[];
  plansLoading: boolean;
  plansError: string | null;
  planActionMsg: string | null;
  planTitle: string;
  planNote: string;
  planOptionsText: string;
  selectedPlanInviteeIds: string[];
  planCreating: boolean;
  onPlanTitleChange: (value: string) => void;
  onPlanNoteChange: (value: string) => void;
  onPlanOptionsTextChange: (value: string) => void;
  onToggleInvitee: (friendId: string) => void;
  onCreate: () => void;
  onVote: (planId: string, optionIndex: number) => void;
};

export default function GroupPlansPanel({
  isLoggedIn,
  friendsAll,
  plans,
  plansLoading,
  plansError,
  planActionMsg,
  planTitle,
  planNote,
  planOptionsText,
  selectedPlanInviteeIds,
  planCreating,
  onPlanTitleChange,
  onPlanNoteChange,
  onPlanOptionsTextChange,
  onToggleInvitee,
  onCreate,
  onVote,
}: GroupPlansPanelProps) {
  return (
    <div id="event-group-plans">
      <div className="groupPlanDivider" />
      <div className="eventDetailText">
        <b>Group plans</b>
      </div>

      {!isLoggedIn ? (
        <div className="sectionHint">Login to create and vote on plans.</div>
      ) : (
        <>
          <div className="groupPlanForm">
            <input
              className="input"
              placeholder="Plan title (e.g. Friday crew plan)"
              value={planTitle}
              onChange={(e) => onPlanTitleChange(e.target.value)}
            />
            <textarea
              className="input"
              placeholder="Optional note"
              value={planNote}
              onChange={(e) => onPlanNoteChange(e.target.value)}
            />
            <textarea
              className="input"
              placeholder={"Option per line (min 2)\nFriday 19:30\nSaturday 20:00"}
              value={planOptionsText}
              onChange={(e) => onPlanOptionsTextChange(e.target.value)}
            />

            {friendsAll.length > 0 ? (
              <div className="groupPlanFriends">
                {friendsAll.map((f) => (
                  <label key={f.id} className="groupPlanFriendItem">
                    <input
                      type="checkbox"
                      checked={selectedPlanInviteeIds.includes(f.id)}
                      onChange={() => onToggleInvitee(f.id)}
                    />
                    <span>{f.name}</span>
                  </label>
                ))}
              </div>
            ) : null}

            <button
              className="btn btnPrimary"
              type="button"
              onClick={onCreate}
              disabled={planCreating}
            >
              {planCreating ? "Creating…" : "Create group plan"}
            </button>
          </div>

          {plansLoading ? <div className="sectionHint">Loading plans…</div> : null}
          {plansError ? <div className="sectionHint">Plan error: {plansError}</div> : null}
          {planActionMsg ? <div className="sectionHint">{planActionMsg}</div> : null}

          {!plansLoading && plans.length === 0 ? (
            <div className="sectionHint">No group plans yet for this event.</div>
          ) : null}

          <div className="groupPlanList">
            {plans.map((plan) => (
              <div key={plan.id} className="groupPlanCard">
                <div className="groupPlanTitle">{plan.title}</div>
                <div className="groupPlanMeta">
                  by {plan.creator.name} • {plan.members.length} members
                </div>
                {plan.note ? <div className="groupPlanNote">{plan.note}</div> : null}

                <div className="groupPlanOptions">
                  {plan.options.map((option, idx) => {
                    const votes = Number(plan.voteCounts[String(idx)] || 0);
                    const isMine = plan.myVote === idx;
                    return (
                      <button
                        key={`${plan.id}-${idx}`}
                        type="button"
                        className={`groupPlanOptionBtn ${isMine ? "isActive" : ""}`}
                        onClick={() => onVote(plan.id, idx)}
                      >
                        <span>{option}</span>
                        <span>{votes} vote{votes === 1 ? "" : "s"}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
