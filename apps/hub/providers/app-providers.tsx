"use client";

import { AuthProvider } from "@/providers/auth-provider";
import { DatabaseProvider } from "@/providers/database-provider";
import { QueryProvider } from "@/providers/query-provider";
import { RealtimeProvider } from "@/providers/realtime-provider";
import { ThemeProvider } from "@/providers/theme-provider";

export function AppProviders({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <ThemeProvider>
      <QueryProvider>
        <AuthProvider>
          <DatabaseProvider>
            <RealtimeProvider>{children}</RealtimeProvider>
          </DatabaseProvider>
        </AuthProvider>
      </QueryProvider>
    </ThemeProvider>
  );
}
