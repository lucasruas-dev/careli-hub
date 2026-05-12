"use client";

import {
  createMockDatabaseStatus,
  type DatabaseHealthCheck,
} from "@repo/database";
import {
  createContext,
  useContext,
  type ReactNode,
} from "react";

type DatabaseContextValue = {
  databaseStatus: DatabaseHealthCheck;
};

const DatabaseContext = createContext<DatabaseContextValue | null>(null);
const mockDatabaseStatus = createMockDatabaseStatus("connected");

export function DatabaseProvider({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  return (
    <DatabaseContext.Provider value={{ databaseStatus: mockDatabaseStatus }}>
      {children}
    </DatabaseContext.Provider>
  );
}

export function useDatabase() {
  const context = useContext(DatabaseContext);

  if (!context) {
    throw new Error("useDatabase must be used within DatabaseProvider.");
  }

  return context;
}
