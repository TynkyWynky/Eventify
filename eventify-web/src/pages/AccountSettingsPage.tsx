import { useEffect, useMemo, useState } from "react";
import { useNotifications } from "../components/NotificationProvider";
import { useAuth } from "../auth/AuthContext";
import { apiFetch, type ApiMeResponse } from "../auth/apiClient";

type ProfileForm = {
  displayName: string;
  email: string;
};

type NotificationPrefs = {
  friendActivity: boolean;
  nearbyEvents: boolean;
  marketingEmails: boolean;
};

type StatusTone = "success" | "error" | "info";

const DEFAULT_PREFS: NotificationPrefs = {
  friendActivity: true,
  nearbyEvents: true,
  marketingEmails: false,
};

function validateDisplayName(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "Display name is required.";
  if (trimmed.length < 2) return "Display name must be at least 2 characters.";
  return "";
}

function validateEmail(value: string) {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return "Email is required.";
  if (!/^\S+@\S+\.\S+$/.test(trimmed)) return "Enter a valid email.";
  return "";
}

function normalizeProfileForm(form: ProfileForm) {
  return {
    displayName: form.displayName.trim(),
    email: form.email.trim().toLowerCase(),
  };
}

function prefsStorageKey(userId: string) {
  return `eventify_settings_notifications_${userId}`;
}

function readPrefs(userId: string): NotificationPrefs {
  const raw = localStorage.getItem(prefsStorageKey(userId));
  if (!raw) return DEFAULT_PREFS;
  try {
    const parsed = JSON.parse(raw) as Partial<NotificationPrefs>;
    return {
      friendActivity: Boolean(parsed.friendActivity ?? DEFAULT_PREFS.friendActivity),
      nearbyEvents: Boolean(parsed.nearbyEvents ?? DEFAULT_PREFS.nearbyEvents),
      marketingEmails: Boolean(parsed.marketingEmails ?? DEFAULT_PREFS.marketingEmails),
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

function writePrefs(userId: string, prefs: NotificationPrefs) {
  localStorage.setItem(prefsStorageKey(userId), JSON.stringify(prefs));
}

export default function AccountSettingsPage() {
  const { user, token, setCurrentUser } = useAuth();
  const { notify } = useNotifications();

  const [profileForm, setProfileForm] = useState<ProfileForm>({ displayName: "", email: "" });
  const [savedProfile, setSavedProfile] = useState<ProfileForm>({ displayName: "", email: "" });
  const [profileTouched, setProfileTouched] = useState<{ displayName: boolean; email: boolean }>({
    displayName: false,
    email: false,
  });
  const [profileStatus, setProfileStatus] = useState<{ tone: StatusTone; text: string } | null>(null);
  const [isSavingProfile, setIsSavingProfile] = useState(false);

  const [prefsForm, setPrefsForm] = useState<NotificationPrefs>(DEFAULT_PREFS);
  const [savedPrefs, setSavedPrefs] = useState<NotificationPrefs>(DEFAULT_PREFS);
  const [prefsStatus, setPrefsStatus] = useState<{ tone: StatusTone; text: string } | null>(null);

  useEffect(() => {
    if (!user) return;

    const nextProfile = {
      displayName: user.name || "",
      email: user.email || "",
    };

    setProfileForm(nextProfile);
    setSavedProfile(nextProfile);
    setProfileTouched({ displayName: false, email: false });
    setProfileStatus(null);

    const nextPrefs = readPrefs(user.id);
    setPrefsForm(nextPrefs);
    setSavedPrefs(nextPrefs);
    setPrefsStatus(null);
  }, [user]);

  const displayNameError = useMemo(
    () => validateDisplayName(profileForm.displayName),
    [profileForm.displayName]
  );
  const emailError = useMemo(() => validateEmail(profileForm.email), [profileForm.email]);
  const profileHasErrors = Boolean(displayNameError || emailError);

  const profileDirty = useMemo(() => {
    const current = normalizeProfileForm(profileForm);
    const saved = normalizeProfileForm(savedProfile);
    return current.displayName !== saved.displayName || current.email !== saved.email;
  }, [profileForm, savedProfile]);

  const prefsDirty = useMemo(
    () =>
      prefsForm.friendActivity !== savedPrefs.friendActivity ||
      prefsForm.nearbyEvents !== savedPrefs.nearbyEvents ||
      prefsForm.marketingEmails !== savedPrefs.marketingEmails,
    [prefsForm, savedPrefs]
  );

  async function handleProfileSave() {
    setProfileTouched({ displayName: true, email: true });
    setProfileStatus(null);

    if (!user || !token) {
      setProfileStatus({ tone: "error", text: "You must be logged in to update your profile." });
      return;
    }

    if (profileHasErrors) return;
    if (!profileDirty) return;

    const payload = normalizeProfileForm(profileForm);
    setIsSavingProfile(true);

    try {
      const result = await apiFetch<ApiMeResponse>("/auth/me", {
        method: "PATCH",
        token,
        body: {
          name: payload.displayName,
          email: payload.email,
        },
      });

      if (!result.ok || !result.user) {
        throw new Error("Could not update your profile.");
      }

      setCurrentUser(result.user);
      setSavedProfile({ displayName: result.user.name, email: result.user.email });
      setProfileStatus({ tone: "success", text: "Profile saved." });
      notify("Profile saved.", "success");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not save profile.";
      setProfileStatus({ tone: "error", text: message });
      notify("Could not save profile.", "error");
    } finally {
      setIsSavingProfile(false);
    }
  }

  function handleNotificationsSave() {
    if (!user) {
      setPrefsStatus({ tone: "error", text: "You must be logged in to update settings." });
      return;
    }

    if (!prefsDirty) return;
    writePrefs(user.id, prefsForm);
    setSavedPrefs(prefsForm);
    setPrefsStatus({ tone: "success", text: "Notification preferences saved." });
    notify("Notification preferences saved.", "success");
  }

  return (
    <div className="settingsPage">
      <div className="settingsHeader">
        <div>
          <div className="settingsTitle">Account settings</div>
          <div className="settingsHint">Profile, privacy, notifications…</div>
        </div>
      </div>

      <div className="settingsGrid">
        <section className="settingsCard">
          <div className="settingsCardTitle">Profile</div>
          <div className="settingsCardHint">Name and email</div>

          <div className="settingsForm">
            <label className="authLabel" htmlFor="settings-display-name">
              Display name
            </label>
            <input
              id="settings-display-name"
              className="authInput"
              placeholder="Your name"
              value={profileForm.displayName}
              onChange={(e) =>
                setProfileForm((prev) => ({ ...prev, displayName: e.target.value }))
              }
              onBlur={() => setProfileTouched((prev) => ({ ...prev, displayName: true }))}
              aria-invalid={profileTouched.displayName && Boolean(displayNameError)}
            />
            {profileTouched.displayName && displayNameError ? (
              <div className="settingsFieldError">{displayNameError}</div>
            ) : (
              <div className="settingsFieldHint">This is shown on your profile.</div>
            )}

            <label className="authLabel" htmlFor="settings-email">
              Email
            </label>
            <input
              id="settings-email"
              className="authInput"
              placeholder="you@email.com"
              value={profileForm.email}
              onChange={(e) => setProfileForm((prev) => ({ ...prev, email: e.target.value }))}
              onBlur={() => setProfileTouched((prev) => ({ ...prev, email: true }))}
              aria-invalid={profileTouched.email && Boolean(emailError)}
            />
            {profileTouched.email && emailError ? (
              <div className="settingsFieldError">{emailError}</div>
            ) : (
              <div className="settingsFieldHint">
                We use this email for account and security updates.
              </div>
            )}

            <div className="settingsActionsRow">
              <button
                type="button"
                className="authPrimaryButton"
                onClick={handleProfileSave}
                disabled={!profileDirty || profileHasErrors || isSavingProfile}
              >
                {isSavingProfile ? "Saving..." : "Save profile"}
              </button>
              <button
                type="button"
                className="btnSecondary"
                onClick={() => {
                  setProfileForm(savedProfile);
                  setProfileTouched({ displayName: false, email: false });
                  setProfileStatus({ tone: "info", text: "Changes discarded." });
                }}
                disabled={!profileDirty || isSavingProfile}
              >
                Reset
              </button>
            </div>

            {profileStatus ? (
              <div className={`settingsStatus settingsStatus${profileStatus.tone}`}>
                {profileStatus.text}
              </div>
            ) : null}
          </div>
        </section>

        <section className="settingsCard">
          <div className="settingsCardTitle">Notifications</div>
          <div className="settingsCardHint">Friend activity and recommendations</div>
          <div className="settingsToggles">
            <label className="settingsToggle">
              <input
                type="checkbox"
                checked={prefsForm.friendActivity}
                onChange={(e) =>
                  setPrefsForm((prev) => ({ ...prev, friendActivity: e.target.checked }))
                }
              />
              Friend activity
            </label>
            <label className="settingsToggle">
              <input
                type="checkbox"
                checked={prefsForm.nearbyEvents}
                onChange={(e) =>
                  setPrefsForm((prev) => ({ ...prev, nearbyEvents: e.target.checked }))
                }
              />
              New events near me
            </label>
            <label className="settingsToggle">
              <input
                type="checkbox"
                checked={prefsForm.marketingEmails}
                onChange={(e) =>
                  setPrefsForm((prev) => ({ ...prev, marketingEmails: e.target.checked }))
                }
              />
              Marketing emails
            </label>
          </div>

          <div className="settingsActionsRow">
            <button
              type="button"
              className="authPrimaryButton"
              onClick={handleNotificationsSave}
              disabled={!prefsDirty}
            >
              Save notifications
            </button>
            <button
              type="button"
              className="btnSecondary"
              onClick={() => {
                setPrefsForm(savedPrefs);
                setPrefsStatus({ tone: "info", text: "Changes discarded." });
              }}
              disabled={!prefsDirty}
            >
              Reset
            </button>
          </div>

          {prefsStatus ? (
            <div className={`settingsStatus settingsStatus${prefsStatus.tone}`}>
              {prefsStatus.text}
            </div>
          ) : null}
        </section>
      </div>
    </div>
  );
}
