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
// DUAS PORTAS DENTRO DO PORTAL, também: a aba Contratos do menu (tudo o que a sessão autoriza) e a
// aba Contratos da FICHA DO PRODUTO (FichaDoProduto, `emp` preenchido), recortada para aquele
// produto — Lucas (02/09/2026): *"produtos é replicar a tela que temos hoje em empreendimento do
// apolo"*, e a ficha de lá tem a aba de contratos.
//
// ⚠️ O KANBAN FALA TAILWIND, O PORTAL FALA VARIÁVEL CSS. As classes do hub (bg-surface, text-ink,
// border-line…) existem aqui — o CSS global (styles/globals.css) é um só e cobre o portal —, mas o
// @theme declara cada uma no :root como `--color-surface: var(--uix-surface-base)`, apontando para
// a paleta `--uix-*` que o ThemeProvider do HUB escreve no <html>: o tema do hub, não o do portal.
// Sem tratar, no portal escuro o board apareceria como um bloco claro.
//
// ⚠️ REDEFINIR SÓ AS `--uix-*` AQUI EMBAIXO NÃO FAZ NADA. Propriedade personalizada é resolvida no
// elemento onde foi DECLARADA: `--color-surface` é calculada no :root (com o `--uix-*` do :root) e
// os descendentes herdam o valor já substituído. Foi o defeito da primeira versão desta moldura
// (só `--uix-*`): a ficha do produto parecia certa porque o contêiner do ProdutosDoHercules
// redeclarava as `--color-*` por fora, e a aba Contratos do menu ficava na paleta do hub. A
// TelaLancamento documenta o mesmo e por isso redeclara as `--color-*` — é o que vale: as MESMAS
// doze do `@theme` (globals.css), apontando para os tokens `--inc-*` do portal. Funciona porque o
// `@theme` do hub NÃO é `inline`: as classes emitem `var(--color-surface)`, não o valor final. As
// `--uix-*` ficam por garantia, para quem lê o token direto (não o `--color-*`).
//
// E os utilitários `dark:` do hub (chips de tipo bg-emerald-100, faixa de erro bg-red-50, tag de
// atraso) respondem a `[data-uix-theme="dark"]` — a @custom-variant do globals.css casa
// `[data-uix-theme="dark"] *`. Por isso a moldura carrega `data-uix-theme` com o tema EFETIVO do
// portal (mesmo truque da TelaLancamento): no escuro os chips escurecem junto, em vez de ficarem
// verde-claro sobre card escuro.
//
// EXPORTADA porque a ficha do produto (hercules/FichaDoProduto, BoardDoProduto, ResumoDoProduto)
// é a tela do Apolo inteira em Tailwind, e precisa da MESMA moldura — uma só, para os quatro
// lugares virarem no escuro juntos.
export const MOLDURA_TAILWIND = {
  "--color-canvas": "var(--inc-page)",
  "--color-surface": "var(--inc-card)",
  "--color-raised": "var(--inc-card)",
  "--color-subtle": "var(--inc-soft)",
  "--color-inverse": "var(--inc-btn-bg)",
  "--color-ink": "var(--inc-text)",
  "--color-ink-soft": "var(--inc-sub)",
  "--color-ink-muted": "var(--inc-muted)",
  "--color-line": "var(--inc-border)",
  "--color-line-strong": "var(--inc-border)",
  "--color-brand": "var(--inc-gold)",
  "--color-brand-ink": "var(--inc-btn-fg)",
  "--uix-border-strong": "var(--inc-border)",
  "--uix-border-subtle": "var(--inc-border)",
  "--uix-surface-base": "var(--inc-card)",
  "--uix-surface-canvas": "var(--inc-page)",
  "--uix-surface-inverse": "var(--inc-btn-bg)",
  "--uix-surface-raised": "var(--inc-card)",
  "--uix-surface-subtle": "var(--inc-soft)",
  "--uix-text-muted": "var(--inc-muted)",
  "--uix-text-primary": "var(--inc-text)",
  "--uix-text-secondary": "var(--inc-sub)",
  "--uix-color-brand-primary": "var(--inc-gold)",
  "--uix-color-brand-foreground": "var(--inc-btn-fg)",
  fontFamily: fonte,
} as CSSProperties;

export function TelaContratos({
  emp,
}: {
  /**
   * O produto da ficha ("pai:<uuid>" do cadastro ou id do C2X), quando a tela vive DENTRO da
   * FichaDoProduto. Sem ele é a aba do menu: tudo o que a sessão autoriza.
   */
  emp?: string;
} = {}) {
  // O tema efetivo (já resolvido o "seguir o aparelho") vira o atributo que os `dark:` leem.
  const { efetivo } = useTemaDoPortal();

  return (
    <div style={{ display: "grid", gap: 16 }}>
      {/* ── CABEÇALHO: o mesmo das outras abas (título 20, subtítulo em muted) ──── */}
      {/* Dentro da ficha o cabeçalho não entra: a barra de abas de lá já diz "Contratos", e o
          nome do produto está no topo da ficha. */}
      {emp ? null : (
        <header>
          <h1 style={{ color: T.text, fontSize: 20, fontWeight: 600, margin: "0 0 4px" }}>
            Contratos
          </h1>
          <p style={{ color: T.muted, fontSize: 13.5, margin: 0 }}>
            Documentos dos seus empreendimentos na Têmis
          </p>
        </header>
      )}

      {/* A moldura é o card do portal; dentro dela o kanban rola na horizontal sozinho (é ele
          quem tem o overflow-x), então a página nunca rola de lado. */}
      <section
        data-uix-theme={efetivo === "escuro" ? "dark" : "light"}
        style={{
          ...MOLDURA_TAILWIND,
          background: T.card,
          border: `1px solid ${T.border}`,
          borderRadius: 12,
          padding: 12,
        }}
      >
        {/* `enterpriseId={null}` = tudo o que a sessão autoriza; com `emp`, o kanban monta
            sozinho `?empreendimento=<emp>` na rota (é assim que ele já faz na tela interna), e a
            rota só aceita o id DENTRO do que já é da sessão — inclusive "pai:<uuid>", que ela
            expande pelo cadastro. O recorte é do servidor, não daqui. */}
        <TemisKanban
          enterpriseId={emp ?? null}
          rota="/api/incorporador/contratos"
          semToken
          somenteLeitura
        />
      </section>
    </div>
  );
}
