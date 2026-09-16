"use client";

import { useCallback, useState } from "react";
import { ArrowLeft, Plus } from "lucide-react";

import type { ApoloEnterpriseRow } from "@/lib/apolo/empreendimentos";
import type { LinhaDoPainel } from "@/lib/apolo/incorporador/painel-de-produtos";
import type { LinkPublico } from "@/lib/hercules/links-do-empreendimento";
import { ehIdDoPanteon } from "@/lib/hercules/produto-novo";
import { toTitleCase } from "@/lib/format/name-case";
import { LinksTab } from "@/modules/apolo/blocks/empreendimentos/links-tab";
import {
  KpiCard,
  bucketText,
  buckets,
  locationLabel,
} from "@/modules/apolo/blocks/empreendimentos/empreendimentos-view";

import { MOLDURA_TAILWIND } from "../TelaContratos";
import { useTemaDoPortal } from "../tema";
import {
  type AbaDaFicha,
  abasDaFicha,
  destinoDoResumo,
  type ModoDaFicha,
} from "./abas-da-ficha";
import { ArquivosDoProduto } from "./ArquivosDoProduto";
import { BoardDoProduto } from "./BoardDoProduto";
import { JanelaDeCadastroDeUnidades } from "./CadastroDeUnidades";
import { CadastroDoProduto } from "./CadastroDoProduto";
import { ImobiliariasDoProduto } from "./ImobiliariasDoProduto";
import { MinutasDoProduto } from "./MinutasDoProduto";
import { PoliticasDoProduto } from "./PoliticasDoProduto";
import { RelacionamentosDoProduto } from "./RelacionamentosDoProduto";
import { ResumoDoProduto } from "./ResumoDoProduto";
import { UnidadesDoProduto } from "./UnidadesDoProduto";

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
//   • Unidades — a tabela de unidades do Apolo, montada pela porta do portal (03/09/2026: era
//     "Vendas", com pipeline e mapa dentro; virou só a lista, e o cenario comercial passou para a
//     tela Venda, que e onde o coordenador trabalha).
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

// ⚠️ A FICHA TEM QUATRO ABAS, E DUAS SAÍRAM DELA EM 03/09/2026. Pedido do Lucas:
//
//   • *"onde está vendas hoje dentro do produto vamos nomeá-la como unidade e deixar somente a
//     tela de unidade, resumo, pipeline, tudo some fica somente unidades"*. A ficha responde "o
//     que este produto TEM"; o cenário comercial (resumo, pipeline, mapa) vai para a tela Venda,
//     que é onde o coordenador trabalha. Dois lugares mostrando o mesmo pipeline é a mesma
//     pergunta com duas respostas que podem divergir.
//
//   • *"contrato tem que sair daqui, ele já tem a tela dele"*. A aba Contratos do menu mostra o
//     mesmo Board da Têmis com o mesmo recorte — e agora com filtro por empreendimento, que é o
//     que a aba da ficha entregava a mais.
//
// As abas de cada modo, o tipo e o atalho do Resumo moram em `abas-da-ficha.ts`, puros e com
// teste (este arquivo arrasta o BoardView inteiro, e o teste não precisa dele). Os tipos seguem
// exportados daqui para quem já os importava.
//
// ⚠️ ESCRITA SÓ NO PRODUTO QUE O PORTAL OPERA (decisão do Lucas, 16/09/2026). A Cecílio enxerga o VOC
// e o VOR, mas eles seguem da Careli: na ficha deles o board é só leitura, as unidades não editam,
// os arquivos não sobem e as abas/botões de escrita (Minutas, Adicionar unidades) nem aparecem. Quem
// diz é `linha.podeEscrever`, que o painel calcula com a MESMA régua das rotas
// (`operacao-do-produto.ts`); esconder aqui é conveniência, a trava é a rota. No comercial o painel
// devolve `podeEscrever` verdadeiro em tudo, e a Gurgel segue como sempre.
export type { AbaDaFicha, ModoDaFicha } from "./abas-da-ficha";

export function FichaDoProduto({
  linha,
  modo = "comercial",
  onVoltar,
  row,
}: {
  /** A linha do painel (/api/incorporador/produtos/painel): o id e o nome que as abas recebem. */
  linha: LinhaDoPainel;
  /**
   * Quem opera (ver `ModoDaFicha`). Sem a prop, o comercial de sempre: NADA muda para a Gurgel.
   * Quem decide é quem monta a ficha, por `portalOperaVenda` e `ehPortalComercial`.
   */
  modo?: ModoDaFicha;
  onVoltar: () => void;
  /** A mesma linha no formato da tela do Apolo (`linhaParaRow`): cenário, código, cidade. */
  row: ApoloEnterpriseRow;
}) {
  // Abre no Resumo, como a ficha do Apolo.
  const [aba, setAba] = useState<AbaDaFicha>("resumo");
  const incorporador = modo === "incorporador";
  // O portal que opera a própria venda E opera este produto. No comercial é sempre falso de propósito:
  // a Gurgel não cadastra nem edita unidade, não edita minuta e não tem a aba Arquivos.
  const operavel = incorporador && linha.podeEscrever === true;
  // A escrita que pede UM produto real (minuta, unidade nova) vai para `linha.enterpriseId`; o tipo
  // é o do filho quando a linha é um pai com uma etapa só (a unidade nasce no filho).
  const tipoDoAlvo =
    linha.filhos.find((filho) => filho.id === linha.enterpriseId)?.tipoProduto ??
    linha.tipoProduto ??
    "loteamento";
  const adicionaUnidades = operavel && ehIdDoPanteon(linha.enterpriseId);
  // A janela de "Adicionar unidades" e a chave que remonta a tabela para reler depois do cadastro.
  const [cadastroDeUnidadesAberto, setCadastroDeUnidadesAberto] = useState(false);
  const [recargaDasUnidades, setRecargaDasUnidades] = useState(0);

  // A porta do PORTAL. Sem Authorization: o proxy libera /api/incorporador/* pelo cookie
  // `apolo_inc`, e a rota recorta pelo escopo do token — `emp` so REDUZ o que a sessao ja tem.
  // `useCallback` porque a LinksTab a usa como dependencia de efeito.
  const buscarLinks = useCallback(async () => {
    const resposta = await fetch(
      `/api/incorporador/produto/links?emp=${encodeURIComponent(linha.id)}`,
    );
    const corpo = (await resposta.json().catch(() => ({}))) as {
      data?: { doPai: boolean; links: LinkPublico[] };
      error?: string;
    };
    if (!resposta.ok || !corpo.data) {
      throw new Error(corpo.error ?? "Nao consegui carregar os links.");
    }
    return corpo.data;
  }, [linha.id]);
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
        {abasDaFicha(modo, { minutas: operavel && Boolean(linha.enterpriseId) }).map((item) => {
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

      {/* O corpo por aba. Cada aba recebe `linha.id` e resolve o escopo na SUA rota.
          ⚠️ EM UNIDADES A SECTION É FLEX-COL (e segue `overflow-auto`): é o que deixa a tabela
          ocupar a section inteira e rolar por dentro com o thead grudado — o mesmo que o
          EnterpriseDetail faz na aba Unidades, só que sem `overflow-hidden`. Nas outras abas o
          conteúdo rola por fora. */}
      <section
        className={
          // Minutas também: o editor da minuta é `flex-1` e rola por dentro.
          aba === "unidades" || aba === "minutas"
            ? "flex min-h-0 flex-1 flex-col overflow-auto"
            : "min-h-0 flex-1 overflow-auto"
        }
      >
        {aba === "resumo" ? (
          <ResumoDoProduto
            emp={linha.id}
            onIr={(destino) => setAba(destinoDoResumo(modo, destino))}
            row={row}
          />
        ) : null}
        {/* "cadastro" é o board no comercial e os dados do empreendimento no incorporador (ver
            `ABAS_DO_INCORPORADOR` em abas-da-ficha.ts). */}
        {aba === "cadastro" ? (
          incorporador ? (
            <CadastroDoProduto emp={linha.id} row={row} />
          ) : (
            <BoardDoProduto emp={linha.id} somenteLeitura={linha.podeEscrever !== true} />
          )
        ) : null}
        {/* O board só existe no modo "incorporador" (o portal que opera a própria venda, hoje o
            Cecílio): é ele quem faz o crédito dos clientes dele, então o Serasa aparece. No produto
            que ele só consulta (VOC, VOR), o board abre só leitura. */}
        {aba === "board" ? (
          <BoardDoProduto
            emp={linha.id}
            operaSozinho={incorporador}
            somenteLeitura={linha.podeEscrever !== true}
          />
        ) : null}
        {aba === "imobiliarias" ? <ImobiliariasDoProduto emp={linha.id} /> : null}
        {/* A tabela de unidades do Apolo, montada pela porta do portal. É a MESMA peça que morava
            dentro da Vendas — só perdeu as sub-abas em volta. "Adicionar unidades" só no produto
            nascido no Panteon que o portal opera (a unidade do C2X não nasce por aqui). */}
        {aba === "unidades" ? (
          <>
            {adicionaUnidades ? (
              <div className="flex shrink-0 justify-end pb-2">
                <button
                  className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-ink px-3 text-sm font-semibold text-canvas"
                  onClick={() => setCadastroDeUnidadesAberto(true)}
                  type="button"
                >
                  <Plus aria-hidden="true" className="size-4" />
                  Adicionar unidades
                </button>
              </div>
            ) : null}
            <UnidadesDoProduto
              emp={linha.id}
              enterpriseId={linha.enterpriseId ?? null}
              // A `key` remonta a tabela depois do cadastro, para ela reler as unidades novas.
              key={recargaDasUnidades}
              podeEditar={operavel}
              row={row}
            />
            {adicionaUnidades && linha.enterpriseId ? (
              <JanelaDeCadastroDeUnidades
                aberto={cadastroDeUnidadesAberto}
                aoConcluir={() => setRecargaDasUnidades((n) => n + 1)}
                aoFechar={() => setCadastroDeUnidadesAberto(false)}
                emp={linha.enterpriseId}
                nomeDoProduto={toTitleCase(row.name)}
                prefixo={linha.codes[0] ?? row.code}
                tipoProduto={tipoDoAlvo}
              />
            ) : null}
          </>
        ) : null}
        {aba === "relacionamentos" ? (
          <RelacionamentosDoProduto emp={linha.id} row={row} />
        ) : null}
        {aba === "politica" ? <PoliticasDoProduto emp={linha.id} /> : null}
        {/* Os modelos de contrato do produto, pela Têmis do portal. Só no produto que o portal opera
            e com UM enterprise real (a minuta é amarrada ao id, nunca a "pai:<uuid>"). */}
        {aba === "minutas" && operavel && linha.enterpriseId ? (
          <MinutasDoProduto enterpriseId={linha.enterpriseId} nome={toTitleCase(row.name)} />
        ) : null}
        {aba === "links" ? <LinksTab buscar={buscarLinks} /> : null}
        {/* O time do cliente é quem alimenta as fotos e os vídeos do próprio produto, e só do que ele
            opera: no produto só consulta a aba lista e não sobe nada. */}
        {aba === "arquivos" ? (
          <ArquivosDoProduto emp={linha.id} podeEditar={linha.podeEscrever === true} />
        ) : null}
      </section>
    </div>
  );
}
