import type { EventsRepo } from "./eventsRepo";
import { apiEventsRepo } from "./apiEventsRepo";
import { mockEventsRepo } from "./mockEventsRepo";

type RepoMode = "auto" | "api" | "mock";

const modeRaw = (import.meta.env.VITE_EVENTS_REPO_MODE as string | undefined) || "api";
const mode = modeRaw.toLowerCase() as RepoMode;

export const eventsRepo: EventsRepo =
  mode === "mock" ? mockEventsRepo : apiEventsRepo;
