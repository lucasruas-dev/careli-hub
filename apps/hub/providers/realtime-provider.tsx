"use client";

import {
  createMockRealtimeState,
  type RealtimeState,
} from "@repo/realtime";
import {
  createContext,
  useContext,
  type ReactNode,
} from "react";

type RealtimeContextValue = {
  realtimeState: RealtimeState;
};

const RealtimeContext = createContext<RealtimeContextValue | null>(null);
const mockRealtimeState = createMockRealtimeState();

export function RealtimeProvider({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  return (
    <RealtimeContext.Provider value={{ realtimeState: mockRealtimeState }}>
      {children}
    </RealtimeContext.Provider>
  );
}

export function useRealtime() {
  const context = useContext(RealtimeContext);

  if (!context) {
    throw new Error("useRealtime must be used within RealtimeProvider.");
  }

  return context;
}
