import type { EventsRepo } from "./eventsRepo";
import { apiEventsRepo } from "./apiEventsRepo";
import { mockEventsRepo } from "./mockEventsRepo";
import { appConfig } from "../../config/appConfig";

export const eventsRepo: EventsRepo =
  appConfig.eventsRepoMode === "mock" ? mockEventsRepo : apiEventsRepo;
