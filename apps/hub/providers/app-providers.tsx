"use client";

import { PortaoDeSenha } from "@/components/auth/portao-de-senha";
import { AuthProvider } from "@/providers/auth-provider";
import { DatabaseProvider } from "@/providers/database-provider";
import { QueryProvider } from "@/providers/query-provider";
import { HermesCallProvider } from "@/providers/pulsex-call-provider";
import { HermesNotificationProvider } from "@/providers/pulsex-notification-provider";
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
            <RealtimeProvider>
              <HermesNotificationProvider>
                <HermesCallProvider>
                  {children}
                  {/* ⚠️ DEPOIS DOS FILHOS, E DENTRO DO AuthProvider. Ele precisa do token para
                      perguntar se esta conta tem de trocar a senha, e só aparece quando a resposta
                      é sim — em página pública e na tela de login não há token, então ele não
                      monta. Toda falha libera: ver a nota em `portao-de-senha.tsx`. */}
                  <PortaoDeSenha />
                </HermesCallProvider>
              </HermesNotificationProvider>
            </RealtimeProvider>
          </DatabaseProvider>
        </AuthProvider>
      </QueryProvider>
    </ThemeProvider>
  );
}
