"use client";

import type { CSSProperties } from "react";

import { fonte } from "@/modules/publico/ui/tokens";
import { TemisKanban } from "@/modules/temis/blocks/board/temis-kanban";

import { T, useTemaDoPortal } from "./tema";

// CONTRATOS — o board da Têmis, visto pelo coordenador. Só o que é dele, e só para olhar.
//
// Pedido do Lucas (02/09/2026): o portal comercial (Hércules) ganha a aba Contratos = *"o board da
// Têmis recortado pelo escopo do coordenador, somente leitura por enquanto"*. Quem faz o card andar
// continua sendo a Têmis, na tela interna; aqui o coordenador acompanha em que etapa está o
// contrato do cliente que ele vendeu.
//
// É O MESMO COMPONENTE da tela interna (TemisKanban), de propósito: um board só, duas portas. O que
// muda é a porta — a rota escopada pela sessão do portal (/api/incorporador/contratos), o cookie no
// lugar do Bearer do Apolo (`getApoloAccessToken` LANÇA sem sessão do hub, e o coordenador não tem
// uma) e o checkbox travado.
//
// ⚠️ O KANBAN FALA TAILWIND, O PORTAL FALA VARIÁVEL CSS. As classes do hub (bg-surface, text-ink,
// border-line…) existem aqui — o CSS global (styles/globals.css) é um só e cobre o portal —, mas o
// @theme resolve cada uma para um token `--uix-*` que o ThemeProvider do HUB escreve no <html>: o
// tema do hub, não o do portal. Sem tratar, no portal escuro o board apareceria como um bloco claro.
// A moldura abaixo redefine, no seu próprio escopo, cada `--uix-*` que o @theme consome para o
// `--inc-*` correspondente: o kanban passa a seguir o tema do portal sem uma linha de mudança nele.
//
// E os utilitários `dark:` do hub (chips de tipo bg-emerald-100, faixa de erro bg-red-50, tag de
// atraso) respondem a `[data-uix-theme="dark"]` — a @custom-variant do globals.css casa
// `[data-uix-theme="dark"] *`. Por isso a moldura carrega `data-uix-theme` com o tema EFETIVO do
// portal (mesmo truque da TelaLancamento): no escuro os chips escurecem junto, em vez de ficarem
// verde-claro sobre card escuro.
const MOLDURA_DO_KANBAN = {
  "--uix-border-strong": "var(--inc-border)",
  "--uix-border-subtle": "var(--inc-border)",
  "--uix-surface-base": "var(--inc-card)",
  "--uix-surface-canvas": "var(--inc-page)",
  "--uix-surface-raised": "var(--inc-card)",
  "--uix-surface-subtle": "var(--inc-soft)",
  "--uix-text-muted": "var(--inc-muted)",
  "--uix-text-primary": "var(--inc-text)",
  "--uix-text-secondary": "var(--inc-sub)",
  fontFamily: fonte,
} as CSSProperties;

export function TelaContratos() {
  // O tema efetivo (já resolvido o "seguir o aparelho") vira o atributo que os `dark:` leem.
  const { efetivo } = useTemaDoPortal();

  return (
    <div style={{ display: "grid", gap: 16 }}>
      {/* ── CABEÇALHO: o mesmo das outras abas (título 20, subtítulo em muted) ──── */}
      <header>
        <h1 style={{ color: T.text, fontSize: 20, fontWeight: 600, margin: "0 0 4px" }}>
          Contratos
        </h1>
        <p style={{ color: T.muted, fontSize: 13.5, margin: 0 }}>
          Documentos dos seus empreendimentos na Têmis
        </p>
      </header>

      {/* A moldura é o card do portal; dentro dela o kanban rola na horizontal sozinho (é ele
          quem tem o overflow-x), então a página nunca rola de lado. */}
      <section
        data-uix-theme={efetivo === "escuro" ? "dark" : "light"}
        style={{
          ...MOLDURA_DO_KANBAN,
          background: T.card,
          border: `1px solid ${T.border}`,
          borderRadius: 12,
          padding: 12,
        }}
      >
        {/* `enterpriseId={null}` = tudo o que a sessão autoriza; o recorte é do servidor, não
            daqui. Um seletor de empreendimento pode vir depois, mandando `?empreendimento=`, que a
            rota só aceita DENTRO do que já é dele. */}
        <TemisKanban
          enterpriseId={null}
          rota="/api/incorporador/contratos"
          semToken
          somenteLeitura
        />
      </section>
    </div>
  );
}
