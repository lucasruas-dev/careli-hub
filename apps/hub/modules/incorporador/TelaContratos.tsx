"use client";

import { type CSSProperties, useRef, useState } from "react";

import { fonte } from "@/modules/publico/ui/tokens";
import { TemisKanban } from "@/modules/temis/blocks/board/temis-kanban";

import {
  AssinaturasDoProduto,
  type CacheDeAssinaturas,
  Pilula,
  ResumoDeContratos,
} from "./hercules/AssinaturasDoProduto";
import { T, useTemaDoPortal } from "./tema";

// CONTRATOS — a tela de contratos do coordenador: Board · Resumo · Assinatura.
//
// Pedido do Lucas (02/09/2026): o portal comercial (Hércules) ganha a aba Contratos = *"o board da
// Têmis recortado pelo escopo do coordenador, somente leitura por enquanto"*. Quem faz o card andar
// continua sendo a Têmis, na tela interna; aqui o coordenador acompanha em que etapa está o
// contrato do cliente que ele vendeu.
//
// AS TRÊS SUB-ABAS (Lucas, 02/09/2026, 21h45, olhando a ficha do Jardim das Gerais): *"já que
// temos uma aba de contratos, podemos levar para essa tela a parte de contratos: podemos ter um
// board (para visualizar a Têmis), podemos ter Resumo, podemos ter Assinatura"*. E, apontando o
// kanban da Têmis dentro da ficha (21h50): *"isso aqui tem que estar na tela de contrato — no
// board"*. Então:
//   • BOARD — o kanban da Têmis de sempre (abre nele: é o que a tela sempre foi);
//   • RESUMO — os totais dos contratos em cards (hercules/AssinaturasDoProduto → ResumoDeContratos);
//   • ASSINATURA — a visão de assinatura que morava na aba Vendas (hercules/AssinaturasDoProduto):
//     taxa por perfil, blocos do painel, a lista por unidade com as barrinhas, o popup do esquema,
//     a fila e o quadro por assinante.
// Os chips são os mesmos das sub-abas da TelaVendas (Resumo · Pipeline · Contratos): a `Pilula`.
//
// O BOARD É O MESMO COMPONENTE da tela interna (TemisKanban), de propósito: um board só, duas
// portas. O que muda é a porta — a rota escopada pela sessão do portal (/api/incorporador/contratos),
// o cookie no lugar do Bearer do Apolo (`getApoloAccessToken` LANÇA sem sessão do hub, e o
// coordenador não tem uma) e o checkbox travado.
//
// DUAS PORTAS DENTRO DO PORTAL, também: a aba Contratos do menu (tudo o que a sessão autoriza) e a
// aba Contratos da FICHA DO PRODUTO (FichaDoProduto, `emp` preenchido), recortada para aquele
// produto — Lucas (02/09/2026): *"produtos é replicar a tela que temos hoje em empreendimento do
// apolo"*, e a ficha de lá tem a aba de contratos. As três sub-abas valem nas duas portas: sem
// `emp` cobrem todos os empreendimentos da sessão; com `emp`, só o produto.
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
// lugares virarem no escuro juntos. (Resumo e Assinatura NÃO precisam dela: são estilo inline com
// os tokens T, e por isso hercules/AssinaturasDoProduto não importa daqui — sem ciclo.)
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

/** As sub-abas da tela, na ordem do pedido: Board · Resumo · Assinatura. */
type SubAba = "assinatura" | "board" | "resumo";

const SUB_ABAS: ReadonlyArray<{ id: SubAba; rotulo: string }> = [
  { id: "board", rotulo: "Board" },
  { id: "resumo", rotulo: "Resumo" },
  { id: "assinatura", rotulo: "Assinatura" },
];

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
  // Abre no Board: é o que a tela sempre foi, e é onde o Lucas apontou o kanban da Têmis.
  const [subAba, setSubAba] = useState<SubAba>("board");
  // UM cache para Resumo e Assinatura: as duas leem o MESMO payload
  // (/api/incorporador/vendas/assinaturas, 2 consultas no C2X mais a conferência das
  // assinaturas), guardado por recorte. Trocar de sub-aba — ou ir ao Board e voltar — não refaz
  // a chamada enquanto a tela viver. Erro não entra no cache: reabrir tenta de novo.
  const cache = useRef<CacheDeAssinaturas>(new Map());

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
            Board da Têmis, resumo e assinatura dos contratos dos seus empreendimentos
          </p>
        </header>
      )}

      {/* ── AS TRÊS SUB-ABAS: os chips das visões da TelaVendas ──────────────── */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {SUB_ABAS.map((item) => (
          <Pilula
            ativo={subAba === item.id}
            key={item.id}
            onClick={() => setSubAba(item.id)}
            rotulo={item.rotulo}
          />
        ))}
      </div>

      {subAba === "board" ? (
        /* A moldura é o card do portal; dentro dela o kanban rola na horizontal sozinho (é ele
           quem tem o overflow-x), então a página nunca rola de lado. */
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
      ) : subAba === "resumo" ? (
        <ResumoDeContratos cache={cache.current} emp={emp} />
      ) : (
        <AssinaturasDoProduto cache={cache.current} emp={emp} />
      )}
    </div>
  );
}
