import type {
  ChronosGoogleCalendarEnvRequirement,
  ChronosGoogleCalendarStatus,
} from "./types";

export const chronosGoogleCalendarEnvRequirements = [
  {
    classification: "identifier",
    name: "GOOGLE_CALENDAR_CLIENT_ID",
    required: true,
  },
  {
    classification: "server_secret",
    name: "GOOGLE_CALENDAR_CLIENT_SECRET",
    required: true,
  },
  {
    classification: "operational",
    name: "GOOGLE_CALENDAR_REDIRECT_URI",
    required: true,
  },
  {
    classification: "operational",
    name: "GOOGLE_CALENDAR_SCOPES",
    required: false,
  },
  {
    classification: "operational",
    name: "GOOGLE_CALENDAR_PRIMARY_CALENDAR_ID",
    required: false,
  },
] as const satisfies ChronosGoogleCalendarEnvRequirement[];

const defaultChronosGoogleCalendarScopes = [
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.readonly",
];

export function getChronosGoogleCalendarStatus(): ChronosGoogleCalendarStatus {
  const missingEnvNames = chronosGoogleCalendarEnvRequirements
    .filter((requirement) => requirement.required)
    .filter((requirement) => !readEnvPresence(requirement.name))
    .map((requirement) => requirement.name);
  const configured = missingEnvNames.length === 0;

  return {
    authorizationPath: "/api/chronos/google-calendar/authorize",
    configured,
    missingEnvNames,
    provider: "google-calendar",
    redirectUriEnvName: "GOOGLE_CALENDAR_REDIRECT_URI",
    requiredEnvNames: chronosGoogleCalendarEnvRequirements
      .filter((requirement) => requirement.required)
      .map((requirement) => requirement.name),
    scopes: getChronosGoogleCalendarScopes(),
    status: configured ? "ready_to_authorize" : "blocked",
  };
}

function getChronosGoogleCalendarScopes() {
  const configuredScopes = process.env.GOOGLE_CALENDAR_SCOPES?.split(/\s+/)
    .map((scope) => scope.trim())
    .filter(Boolean);

  return configuredScopes?.length
    ? configuredScopes
    : defaultChronosGoogleCalendarScopes;
}

function readEnvPresence(name: string) {
  return Boolean(process.env[name]?.trim());
}
