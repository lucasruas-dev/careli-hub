"use client";

import { useEffect, useMemo, useState } from "react";

import type { ApoloEnterpriseRow, ApoloEnterpriseTab, ApoloEnterprisesData } from "@/lib/apolo/empreendimentos";
import type { LinhaDoPainel, PainelDeProdutos } from "@/lib/apolo/incorporador/painel-de-produtos";
import { indiceDoPainel, painelParaApolo } from "@/lib/apolo/incorporador/painel-para-apolo";
import { EmpreendimentosScreen } from "@/modules/apolo/blocks/empreendimentos/empreendimentos-view";
import { fonte } from "@/modules/publico/ui/tokens";

import { T, useTemaDoPortal } from "../tema";
import { FichaDoProduto } from "./FichaDoProduto";

// PRODUTOS DO HÉRCULES — a tela de Empreendimentos do Apolo, a MESMA, dentro do portal comercial.
//
// Lucas (02/09/2026): *"produtos é replicar a tela que temos hoje em empreendimento do apolo"*.
// Replicar aqui é reaproveitar, não copiar: a lista (seis KpiCard, a frase "Todos os
// empreendimentos · clique numa linha para filtrar os cards", uma linha por pai com os filhos no
// chevron e o "Ver mais") é o `EmpreendimentosScreen` de
// modules/apolo/blocks/empreendimentos/empreendimentos-view.tsx, montado com os dados do painel
// do portal. O que muda é a FICHA: o "Ver mais" abre a `FichaDoProduto` (Resumo · Cadastro ·
// Imobiliárias · Vendas · Contratos) pela prop `renderDetail`, no lugar da ficha interna do Apolo.
//
// OS DADOS vêm de /api/incorporador/produtos/painel (cookie da sessão do portal; a rota recorta
// pelo escopo do coordenador) no formato `PainelDeProdutos`, e `painelParaApolo` os veste de
// `ApoloEnterprisesData` para a tela. O id de cada linha ("pai:<uuid>" ou o id do C2X) sobe
// intacto para a ficha, que o repassa à Vendas e às rotas novas (?emp=) — todas cruzam com o
// escopo de novo do outro lado (fail-closed).
//
// ⚠️ A TELA DO APOLO FALA TAILWIND, O PORTAL FALA VARIÁVEL CSS. As classes semânticas do hub
// (bg-surface, text-ink, border-line…) resolvem para `var(--color-*)`, que o @theme declara no
// :root apontando para a paleta `--uix-*` do ThemeProvider do HUB — o tema do hub, não o do portal
// (o coordenador nem tem sessão no hub: o <html> dele fica no claro enquanto o portal pode abrir
// escuro). A saída é a da TelaLancamento: redeclarar as `--color-*` (e as `--uix-*`, por
// garantia, como faz a TelaContratos) neste contêiner apontando para os tokens `--inc-*` do
// portal. Propriedade personalizada desce: todo `bg-surface` daqui para dentro vira `--inc-card`.
// E o `data-uix-theme` no mesmo contêiner é o que as variantes `dark:` do Tailwind leem
// (`[data-uix-theme="dark"] *`, globals.css): as cores dos baldes escurecem junto com o portal.
//
// ⚠️ ALTURA: a tela do Apolo é `flex min-h-0 flex-1` e conta com um pai de altura definida para a
// TABELA rolar por dentro (thead sticky). Este contêiner fixa a altura EXATA da área de trabalho
// (viewport menos casca) — sem isso a lista empurraria o <main> inteiro e o cabeçalho da tabela
// nunca grudaria. Desde 02/09/2026 a casca do comercial não deixa o body rolar no desktop (é o
// <main> que rola, ver TEMA_CSS), e a conta abaixo é o que faz a lista/ficha ir até o rodapé
// sem folga e sem barra de rolagem no <main>. Abaixo de 860px a casca vira bloco (menu em
// cima) e a conta muda: altura do conteúdo, como na TelaLancamento.
const CSS_PRODUTOS = `
  .inc-hercules-produtos {
    --color-canvas: var(--inc-page);
    --color-surface: var(--inc-card);
    --color-raised: var(--inc-card);
    --color-subtle: var(--inc-soft);
    --color-inverse: var(--inc-btn-bg);
    --color-ink: var(--inc-text);
    --color-ink-soft: var(--inc-sub);
    --color-ink-muted: var(--inc-muted);
    --color-line: var(--inc-border);
    --color-line-strong: var(--inc-border);
    --color-brand: var(--inc-gold);
    --color-brand-ink: var(--inc-btn-fg);
    --uix-border-strong: var(--inc-border);
    --uix-border-subtle: var(--inc-border);
    --uix-surface-base: var(--inc-card);
    --uix-surface-canvas: var(--inc-page);
    --uix-surface-inverse: var(--inc-btn-bg);
    --uix-surface-raised: var(--inc-card);
    --uix-surface-subtle: var(--inc-soft);
    --uix-text-muted: var(--inc-muted);
    --uix-text-primary: var(--inc-text);
    --uix-text-secondary: var(--inc-sub);
    --uix-color-brand-primary: var(--inc-gold);
    --uix-color-brand-foreground: var(--inc-btn-fg);
    color: var(--inc-text);
    display: flex;
    flex-direction: column;
    /* A CONTA (desktop, casca do comercial em TEMA_CSS — .inc--comercial):
         14px  padding de cima do <main> (.inc-conteudo: 14px 16px 16px)
         48px  o cabeçalho "Produtos" (h1 20px em 26px de linha + 4px de margem + p 13.5px em
               18px de linha — as duas alturas de linha estão CRAVADAS abaixo, em
               .inc-hercules-cabecalho, para a soma não depender do line-height herdado)
         16px  o gap do grid entre o cabeçalho e este contêiner
         16px  padding de baixo do <main>
         29px  o rodapé fino (.inc-rodape: 1px de borda + 6px + 16px de linha + 6px)
        ─────
        123px
       ⚠️ Mudou padding do <main>, rodapé ou cabeçalho: refaça a soma AQUI e na variante da
       ficha abaixo. Como o <main> rola (overflow:auto), 1px a mais aqui vira uma barra de
       rolagem no <main>; 1px a menos vira uma fresta acima do rodapé. */
    height: calc(100dvh - 123px);
    min-height: 480px;
  }
  /* COM A FICHA ABERTA o cabeçalho "Produtos" não renderiza (a ficha tem o próprio, com o
     voltar) e o gap do grid vai junto: sobram só os paddings do <main> e o rodapé —
     14 + 16 + 29 = 59px. Sem esta variante a ficha parava 64px acima do rodapé. */
  .inc-hercules-produtos--ficha { height: calc(100dvh - 59px); }
  .inc-hercules-produtos > * { flex: 1 1 auto; min-height: 0; }
  .inc-hercules-cabecalho h1 { line-height: 26px; }
  .inc-hercules-cabecalho p { line-height: 18px; }
  /* ⚠️ O MESMO BREAKPOINT DA CASCA (TEMA_CSS): abaixo de 860px o menu lateral vira um bloco em
     cima, o body volta a rolar e os 123px deixam de ser a conta certa. No celular a altura é do
     conteúdo. */
  @media (max-width: 860px) {
    .inc-hercules-produtos, .inc-hercules-produtos--ficha { height: auto; min-height: 70dvh; }
  }
`;

export function ProdutosDoHercules() {
  // O tema EFETIVO do portal (já resolvido o "seguir o aparelho") vira o atributo que os `dark:`
  // leem. Ver a nota em CSS_PRODUTOS.
  const { efetivo } = useTemaDoPortal();

  const [painel, setPainel] = useState<PainelDeProdutos | null>(null);
  const [erro, setErro] = useState<null | string>(null);
  const [carregando, setCarregando] = useState(true);
  // A ficha aberta ("Ver mais") e a aba dela. O mesmo par que o ApoloPage guarda para a tela
  // interna; aqui vive na própria tela porque o portal é uma tela só. `tab` é exigida pela
  // EmpreendimentosScreen, mas quem desenha as abas é a FichaDoProduto — a tela do Apolo só
  // consulta `tab` na ficha interna dela, que aqui não renderiza.
  const [detail, setDetail] = useState<ApoloEnterpriseRow | null>(null);
  const [tab, setTab] = useState<ApoloEnterpriseTab>("resumo");

  useEffect(() => {
    let vivo = true;

    (async () => {
      try {
        const resposta = await fetch("/api/incorporador/produtos/painel", { cache: "no-store" });
        const corpo = (await resposta.json().catch(() => null)) as
          | { data?: PainelDeProdutos; error?: string }
          | null;

        if (!vivo) return;

        if (!resposta.ok || !corpo?.data) {
          setErro(corpo?.error ?? "Não foi possível carregar os produtos.");
          return;
        }

        setPainel(corpo.data);
      } catch {
        if (vivo) setErro("Não foi possível carregar os produtos.");
      } finally {
        if (vivo) setCarregando(false);
      }
    })();

    return () => {
      vivo = false;
    };
  }, []);

  // O painel no formato da tela do Apolo, e o índice id → linha (pais E filhos) que resolve o
  // "Ver mais": a row aberta pode ser uma etapa, e a etapa não está em `linhas`, está dentro do
  // pai. Os dois derivam do mesmo painel, então recalculam juntos.
  const data = useMemo<ApoloEnterprisesData | null>(
    () => (painel ? painelParaApolo(painel) : null),
    [painel],
  );
  const porId = useMemo<Map<string, LinhaDoPainel>>(
    () => (painel ? indiceDoPainel(painel) : new Map()),
    [painel],
  );

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <style>{CSS_PRODUTOS}</style>

      {/* ── CABEÇALHO: o mesmo das outras abas do portal (título 20, subtítulo em muted). Some
          com a ficha aberta: a ficha tem o próprio cabeçalho (voltar + nome + código · cidade). */}
      {!detail ? (
        // A classe crava as alturas de linha (CSS_PRODUTOS): o cabeçalho entra na conta da altura.
        <header className="inc-hercules-cabecalho">
          <h1 style={{ color: T.text, fontFamily: fonte, fontSize: 20, fontWeight: 600, margin: "0 0 4px" }}>
            Produtos
          </h1>
          <p style={{ color: T.muted, fontFamily: fonte, fontSize: 13.5, margin: 0 }}>
            Seus empreendimentos: estoque, vendas e o processo de cada um
          </p>
        </header>
      ) : null}

      <div
        // `--ficha` troca a conta de altura: sem o cabeçalho "Produtos" em cima (ver CSS_PRODUTOS).
        className={detail ? "inc-hercules-produtos inc-hercules-produtos--ficha" : "inc-hercules-produtos"}
        data-uix-theme={efetivo === "escuro" ? "dark" : "light"}
        style={{ fontFamily: fonte }}
      >
        {/* `onOpenEntity` é o CRM 360 interno; o portal não tem essa porta e a ficha do Hércules
            não a oferece. Fica um no-op de propósito, para a tela não precisar mudar. */}
        <EmpreendimentosScreen
          data={data}
          detail={detail}
          error={erro}
          loading={carregando}
          onDetailChange={(row) => {
            setDetail(row);
            // Ficha nova abre no Resumo, como no Apolo (o `tab` de lá volta ao padrão ao trocar).
            if (row) setTab("resumo");
          }}
          onOpenEntity={() => {}}
          onTabChange={setTab}
          renderDetail={(row, onBack) => {
            const linha = porId.get(row.id);

            // Não deveria acontecer: toda row veio de uma linha do painel. Se acontecer (painel
            // recarregado com outro recorte enquanto a ficha estava aberta), volta para a lista em
            // vez de abrir uma ficha vazia.
            if (!linha) {
              return (
                <div className="rounded-xl border border-line bg-surface p-8 text-center text-sm font-medium text-ink-muted">
                  Este produto não está mais no seu recorte.{" "}
                  <button
                    className="font-semibold text-[#7A5E2C] underline-offset-2 hover:underline dark:text-[#d9b877]"
                    onClick={onBack}
                    type="button"
                  >
                    Voltar para a lista
                  </button>
                </div>
              );
            }

            // ⚠️ A `key` é o id DE PROPÓSITO: a ficha (e a TelaVendas dentro dela) nasce presa ao
            // produto e não acompanha a prop depois. Trocar de produto sem passar pela lista precisa
            // remontar a ficha; a key garante isso (mesmo desenho da TelaProdutosComercial).
            return <FichaDoProduto key={row.id} linha={linha} onVoltar={onBack} row={row} />;
          }}
          tab={tab}
        />
      </div>
    </div>
  );
}
