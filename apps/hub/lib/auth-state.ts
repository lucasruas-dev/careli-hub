import {
  createMockAuthState,
  mapAuthUserToHubUserContext,
} from "@repo/auth";

export const mockAuthState = createMockAuthState();

if (!mockAuthState.user) {
  throw new Error("Mock auth state must include an authenticated user.");
}

export const mockHubUserContext = mapAuthUserToHubUserContext(
  mockAuthState.user,
);
