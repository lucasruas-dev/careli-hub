"use client";

import { usePathname } from "next/navigation";

import { PortaoDeSenha } from "@/components/auth/portao-de-senha";
import { ehSuperficieDoHub } from "@/lib/rotas/superficie";
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
  // ⚠️ O QUE É DA CASA SÓ MONTA DENTRO DE CASA. Lucas (14/09/2026), com o print do portal da
  // Gurgel: *"ligação do hub não pode aparecer no perfil gurgel, tem que ficar restrito ao hub"*.
  //
  // O layout raiz envolve TODAS as rotas, e os dois provedores do Hermes não tinham gate de rota
  // nenhum — só uma lista de HOSTS antiga (`ops.c2x.*`). Bastava haver sessão do hub no navegador
  // para que a página do parceiro: desenhasse o banner de chamada com NOME e FOTO de quem ligou,
  // oferecesse a ele o botão de ACEITAR uma chamada de vídeo interna, tocasse a campainha em laço,
  // mostrasse o toast da central com nome de cliente e assunto de ticket — e abrisse um canal de
  // realtime do hub a partir de uma tela de terceiro.
  //
  // ⚠️ NÃO É SÓ ESCONDER: o provider inteiro deixa de montar, então o efeito que assina o canal
  // nem chega a existir. Esconder com CSS deixaria a conexão aberta (custo — a casa já teve
  // incidente de fatura por realtime do Hermes) e o dado chegando ao navegador de quem não devia:
  // o filtro por destinatário roda DEPOIS de o payload chegar ao cliente.
  const noHub = ehSuperficieDoHub(usePathname());

  return (
    <ThemeProvider>
      <QueryProvider>
        <AuthProvider>
          <DatabaseProvider>
            <RealtimeProvider>
              {noHub ? <SoDentroDoHub>{children}</SoDentroDoHub> : children}
            </RealtimeProvider>
          </DatabaseProvider>
        </AuthProvider>
      </QueryProvider>
    </ThemeProvider>
  );
}

/**
 * O que o hub desenha por cima de si mesmo — e nunca por cima de uma porta de fora.
 *
 * ⚠️ O PORTÃO DE SENHA ENTRA AQUI, e não lá fora, porque ele é do HUB: pergunta ao servidor do hub
 * se ESTA conta precisa trocar a senha, com o token do hub. O portal tem o portão dele
 * (`PortaoDeSenhaDoPortal`), montado lá dentro, com a sessão dele — são dois sistemas de senha
 * diferentes, e misturá-los faria o portal perguntar do jeito errado.
 */
function SoDentroDoHub({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <HermesNotificationProvider>
      <HermesCallProvider>
        {children}
        {/* ⚠️ DEPOIS DOS FILHOS, E DENTRO DO AuthProvider. Ele precisa do token para perguntar se
            esta conta tem de trocar a senha, e só aparece quando a resposta é sim — na tela de
            login não há token, então ele não monta. Toda falha libera: ver a nota em
            `portao-de-senha.tsx`. */}
        <PortaoDeSenha />
      </HermesCallProvider>
    </HermesNotificationProvider>
  );
}
