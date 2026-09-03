"use client";

import { useState } from "react";
import {
  ArrowLeft,
  ContactRound,
  FileSignature,
  Layers,
  Network,
  TrendingUp,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import type { ApoloEnterpriseRow } from "@/lib/apolo/empreendimentos";
import type { LinhaDoPainel } from "@/lib/apolo/incorporador/painel-de-produtos";
import { toTitleCase } from "@/lib/format/name-case";
import {
  KpiCard,
  bucketText,
  buckets,
  locationLabel,
} from "@/modules/apolo/blocks/empreendimentos/empreendimentos-view";

import { MOLDURA_TAILWIND, TelaContratos } from "../TelaContratos";
import { TelaVendas } from "../TelaVendas";
import { useTemaDoPortal } from "../tema";
import { BoardDoProduto } from "./BoardDoProduto";
import { ImobiliariasDoProduto } from "./ImobiliariasDoProduto";
import { ResumoDoProduto } from "./ResumoDoProduto";

// A FICHA DO PRODUTO NO HÉRCULES — a ficha de Empreendimento do Apolo, vista pelo coordenador.
//
// Pedido do Lucas (02/09/2026): *"produtos é replicar a tela que temos hoje em empreendimento do
// apolo"*. A lista (ProdutosDoHercules) replica a `EmpreendimentosScreen`; o "Ver mais" de cada
// linha abre ESTA ficha, que replica o `EnterpriseDetail` da mesma tela
// (modules/apolo/blocks/empreendimentos/empreendimentos-view.tsx): o cabeçalho com voltar, nome e
// "código · cidade/UF", os seis KpiCard do produto e a barra de abas com ícone + rótulo. As peças
// de tela (KpiCard, os baldes, o rótulo de lugar) vêm IMPORTADAS da view do Apolo, de propósito:
// mudou lá, mudou aqui, sem uma segunda cópia para divergir.
//
// O QUE MUDA SÃO AS ABAS. No Apolo são onze (Resumo, Cadastro, Unidades, Mapa, Vendas, Carteira,
// Relacionamentos, Políticas, Planos, Minutas, Setup); no Hércules são as cinco do processo do
// coordenador, na ordem do Lucas:
//   • Resumo — o ResumoTab do Apolo mais a faixa do processo (contagens) e "Quem vende";
//   • Cadastro — *"deixa cadastro mesmo e traz a mesma visão do apolo, imobiliária e cads"*: o
//     BoardView do Apolo recortado para o produto, com as ações do coordenador;
//   • Imobiliárias — *"deixa imobiliárias separado para a gente visualizar as imobiliárias
//     habilitadas, com os corretores com os clientes"*: a visão processual das CADs;
//   • Vendas — a TelaVendas fixa no produto (pipeline, Unidades e Mapa moram dentro dela);
//   • Contratos — o board da Têmis (somente leitura) recortado para o produto.
//
// ⚠️ O ID QUE SOBE PARA AS ABAS É `linha.id`, o que a rota do painel devolveu: "pai:<uuid>" do
// cadastro do Panteon ou o id do C2X de uma linha simples. Cada rota (vendas, contratos, board,
// produto/*) expande esse id pelo cadastro e cruza com o escopo da sessão do outro lado
// (lib/hercules/expandir-id-do-painel); a ficha só escolhe entre o que já foi autorizado.
//
// ⚠️ TAILWIND DENTRO DO PORTAL. As classes do hub (bg-surface, text-ink, border-line…) resolvem
// para `var(--color-*)`, que o @theme declara no :root sobre a paleta `--uix-*` do ThemeProvider
// do HUB — e o portal não tem esse provedor. A moldura (`MOLDURA_TAILWIND`, a ÚNICA, da
// TelaContratos) redeclara as `--color-*` para os `--inc-*` do portal (redefinir só `--uix-*`
// não muda nada: o `--color-*` é resolvido no :root e desce já substituído), e o `data-uix-theme`
// com o tema EFETIVO faz os utilitários `dark:` acompanharem o escuro do portal. Sem os dois, a
// ficha apareceria como um bloco claro no tema escuro — o mesmo problema que o kanban da Têmis
// teve. Fica AQUI também (e não só no ProdutosDoHercules) para a ficha funcionar montada em
// qualquer lugar.

/** As abas da ficha. O Resumo salta para as outras quatro pelo `onIr`. */
export type AbaDaFicha = "cadastro" | "contratos" | "imobiliarias" | "resumo" | "vendas";

// Ícones na régua do Apolo: Resumo e Cadastro são os MESMOS da ficha interna (Layers e
// ContactRound); Imobiliárias usa o de Relacionamentos (Network), que é o que elas são para o
// produto; Vendas é o TrendingUp de lá; Contratos é o FileSignature da Têmis.
const ABAS: ReadonlyArray<{ icone: LucideIcon; id: AbaDaFicha; rotulo: string }> = [
  { icone: Layers, id: "resumo", rotulo: "Resumo" },
  { icone: ContactRound, id: "cadastro", rotulo: "Cadastro" },
  { icone: Network, id: "imobiliarias", rotulo: "Imobiliárias" },
  { icone: TrendingUp, id: "vendas", rotulo: "Vendas" },
  { icone: FileSignature, id: "contratos", rotulo: "Contratos" },
];

export function FichaDoProduto({
  linha,
  onVoltar,
  row,
}: {
  /** A linha do painel (/api/incorporador/produtos/painel): o id e o nome que as abas recebem. */
  linha: LinhaDoPainel;
  onVoltar: () => void;
  /** A mesma linha no formato da tela do Apolo (`linhaParaRow`): cenário, código, cidade. */
  row: ApoloEnterpriseRow;
}) {
  // Abre no Resumo, como a ficha do Apolo.
  const [aba, setAba] = useState<AbaDaFicha>("resumo");
  // O tema efetivo (já resolvido o "seguir o aparelho") vira o atributo que os `dark:` leem.
  const { efetivo } = useTemaDoPortal();

  return (
    <div
      className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden"
      data-uix-theme={efetivo === "escuro" ? "dark" : "light"}
      style={MOLDURA_TAILWIND}
    >
      {/* ── CABEÇALHO: o mesmo do EnterpriseDetail (voltar · nome · código/cidade) ─────── */}
      <header className="flex shrink-0 items-center gap-3 rounded-xl border border-line bg-surface px-3 py-2.5">
        <button
          aria-label="Voltar para a lista"
          className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-line bg-subtle text-ink-muted transition-colors hover:border-[#A07C3B]/30 hover:text-[#7A5E2C]"
          onClick={onVoltar}
          type="button"
        >
          <ArrowLeft aria-hidden="true" className="size-4" />
        </button>
        <div className="min-w-0 flex-1">
          <h2 className="m-0 truncate text-base font-semibold text-ink">
            {toTitleCase(row.name)}
          </h2>
          {/* Sem o incorporador, que a ficha do Apolo mostra aqui: no Hércules o portal é do
              coordenador e `linhaParaRow` nem preenche o campo. */}
          <p className="m-0 truncate text-xs text-ink-muted">
            {[row.code, locationLabel(row)].filter(Boolean).join(" · ")}
          </p>
        </div>
      </header>

      {/* KPIs do produto aberto — os seis baldes do Apolo, com o cenário desta linha. */}
      <section className="grid shrink-0 gap-2 sm:grid-cols-3 xl:grid-cols-6">
        {buckets.map((bucket) => (
          <KpiCard
            icon={bucket.icon}
            key={bucket.key}
            label={bucket.label}
            tally={row.scenario[bucket.key]}
            tone={bucketText[bucket.key]}
          />
        ))}
      </section>

      {/* A barra de abas: classes idênticas às do EnterpriseDetail, para a ficha ser a mesma. */}
      <nav className="flex shrink-0 flex-wrap gap-1.5 rounded-xl border border-line bg-subtle/70 p-1.5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
        {ABAS.map((item) => {
          const ativa = aba === item.id;

          return (
            <button
              className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-semibold transition-colors ${
                ativa
                  ? "bg-[#A07C3B] text-white shadow-sm dark:bg-[#A07C3B] dark:text-white"
                  : "text-ink-soft hover:bg-surface hover:text-ink"
              }`}
              key={item.id}
              onClick={() => setAba(item.id)}
              type="button"
            >
              <item.icone aria-hidden="true" className="size-4" />
              {item.rotulo}
            </button>
          );
        })}
      </nav>

      {/* O corpo por aba. Cada aba recebe `linha.id` e resolve o escopo na SUA rota. */}
      <section className="min-h-0 flex-1 overflow-auto">
        {aba === "resumo" ? (
          <ResumoDoProduto emp={linha.id} onIr={setAba} row={row} />
        ) : null}
        {aba === "cadastro" ? <BoardDoProduto emp={linha.id} /> : null}
        {aba === "imobiliarias" ? <ImobiliariasDoProduto emp={linha.id} /> : null}
        {/* `onVoltar` vai junto (redundante com a seta do cabeçalho, mas VIVO): com `empFixo` a
            TelaVendas sempre desenha "Voltar para Produtos" acima do nome, e sem o handler o
            botão aparecia e não fazia nada. Pipeline, Unidades e Mapa moram dentro dela. */}
        {aba === "vendas" ? (
          <TelaVendas empFixo={linha.id} nomeFixo={linha.nome} onVoltar={onVoltar} />
        ) : null}
        {aba === "contratos" ? <TelaContratos emp={linha.id} /> : null}
      </section>
    </div>
  );
}
