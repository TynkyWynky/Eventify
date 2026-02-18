import type { EventsRepo } from "./eventsRepo";
import { apiEventsRepo } from "./apiEventsRepo";
import { mockEventsRepo } from "./mockEventsRepo";

type RepoMode = "auto" | "api" | "mock";

const modeRaw = (import.meta.env.VITE_EVENTS_REPO_MODE as string | undefined) || "auto";
const mode = modeRaw.toLowerCase() as RepoMode;

const autoRepo: EventsRepo = {
  async list(params, opts) {
    try {
      return await apiEventsRepo.list(params, opts);
    } catch (err) {
      console.warn("Falling back to mock events repo for list():", err);
      return mockEventsRepo.list(params, opts);
    }
  },

  async getById(eventId, opts) {
    try {
      return await apiEventsRepo.getById(eventId, opts);
    } catch (err) {
      console.warn("Falling back to mock events repo for getById():", err);
      return mockEventsRepo.getById(eventId, opts);
    }
  },
};

export const eventsRepo: EventsRepo =
  mode === "api" ? apiEventsRepo : mode === "mock" ? mockEventsRepo : autoRepo;
