import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

// ÁREA PRÓPRIA DO EVENTO (/evento): o operador do Prometeu loga com conta própria (nome.sobrenome +
// senha, NÃO é usuário do hub) e cai no seu posto, numa tela limpa, sem o menu do hub.
//
// Este layout é de propósito MÍNIMO: os providers globais (tema/estilos) já vêm do layout raiz
// (AppProviders), então as classes utilitárias e o tema funcionam aqui. NÃO usamos MobileViewport
// (que segura o conteúdo até a sessão do HUB existir) e NÃO há gate de auth do hub — /evento está
// na allowlist de rotas públicas do AuthProvider. A autenticação de verdade é a do operador,
// validada por dentro (cookie assinado por HMAC via /api/prometeu/operador/*).
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Evento",
};

export const viewport: Viewport = {
  initialScale: 1,
  themeColor: "#0b1017",
  viewportFit: "cover",
  width: "device-width",
};

export default function EventoLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  // ⚠️ `panteon-mobile-root` NÃO é decoração: o globals.css do hub tem `html { min-width: 1024px }`
  // (o hub é um dashboard de desktop). Sem neutralizar isso, TODA tela daqui renderiza a 1024px no
  // celular e o conteúdo escapa pra direita, cortado — foi exatamente o que aconteceu com a tela do
  // cliente (/publico/fila). A regra `html:has(.panteon-mobile-root)` zera o min-width. Fica no
  // LAYOUT, e não numa tela só, pra cobrir o login, o carregando e os três postos de uma vez.
  return <div className="panteon-mobile-root">{children}</div>;
}
