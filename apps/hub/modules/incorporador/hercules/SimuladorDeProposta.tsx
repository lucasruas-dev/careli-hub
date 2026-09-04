"use client";

import { useEffect, useMemo, useState } from "react";

import { valorDigitado, valorParaOCampo } from "@/lib/apolo/boletos/valor-digitado";
import {
  fraseDeCorrecao,
  INDICES,
  type IndiceCorrecao,
  type PlanoComercial,
  taxaMensal,
} from "@/lib/apolo/planos-comerciais";
import {
  type Composicao,
  composicoesQueFecham,
  ENTRADA_MINIMA_PERCENTUAL,
  entradaMinima,
  type PlanoDaComposicao,
} from "@/lib/hercules/composicoes";
import type { PlanoDaVenda } from "@/lib/hercules/fluxo-de-venda";
import { montarProposta } from "@/lib/hercules/simulacao";

import { T } from "../tema";

// O SIMULADOR DE PROPOSTA DO COMERCIAL.
//
// Desenho fechado com o Lucas (03/09/2026), olhando o simulador do masterplan: *"quero melhorar
// esse simulador, está bem confuso. O que eu gosto: a opção de começar pelo valor da parcela, isso
// ajuda bastante; gosto das parcelas dos planos já definidos, e a ideia é eu poder editar isso
// quando necessário. Estamos com 3 botões (...) acho que lado esquerdo ser esse cockpit, de
// montagem de proposta mesmo, e o lado direito o de visualização, recomendação"*.
//
// ⚠️ OS TRÊS BOTÕES SUMIRAM, e é a mudança que resolve a confusão. "Parto da parcela do cliente",
// "eu escolho as condições" e "proposta livre" pediam que a pessoa declarasse o MODO antes de fazer
// qualquer coisa — e ninguém pensa assim numa mesa de venda. Aqui o modo é consequência: mexeu na
// parcela, a conta resolve pela parcela; mexeu na entrada, no prazo ou no reforço, resolve por eles.
//
// ⚠️ E A LEITURA É UMA SÓ para os dois caminhos: o mesmo cartão grande mostra a composição
// recomendada (quando ele partiu da parcela) ou a conta que ele montou (quando mexeu nas
// condições). Duas caixas de resultado, uma por modo, era a outra metade da confusão.
//
// ⚠️ É SÓ DO COMERCIAL (*"vamos mexer somente para o comercial, se eu gostar posso estender para
// cecilio"*). O masterplan continua exatamente como estava; se este ganhar a preferência, a gente
// leva para lá de uma vez.
//
// ⚠️ E NADA AQUI GRAVA. *"a ideia é ter um local que o usuário possa fazer algumas simulações sem
// ter que vincular a nada e nem gerar proposta"* — o gerador de proposta real vem depois, na venda.

type Cockpit = {
  anuaisQuantidade: number;
  anuaisValor: number;
  entrada: number;
  entradaVezes: number;
  parcela: number;
  parcelas: number;
  valor: number;
};

/** Qual campo mandou por último — é ele que a conta obedece. */
type Comando = "condicoes" | "parcela";

/** O prazo de partida quando o produto não tem plano cadastrado. Editável na tela. */
const PARCELAS_SEM_PLANO = 120;

/** O que o cartão grande da direita mostra, venha de onde vier. */
type Leitura = {
  anuais: { quantidade: number; valor: number };
  composicao: Composicao | null;
  entrada: number;
  financiado: number;
  origem: "composicao" | "montada";
  parcela: number;
  parcelas: number;
  plano: string;
  total: number;
};

/**
 * A entrada que o plano sugere para este lote.
 *
 * ⚠️ ARREDONDA PARA CIMA E NUNCA FICA ABAIXO DO PISO. 10% de R$ 136.521 é R$ 13.652,10; arredondar
 * para baixo dava R$ 13.652 e a própria sugestão do plano nascia dez centavos abaixo do mínimo,
 * com a tela acusando "abaixo do mínimo" no valor que ela mesma tinha preenchido.
 */
function entradaDoPlano(valor: number, percentual: number, minimo: null | number): number {
  return Math.max(entradaMinima(valor, minimo), Math.ceil((valor * percentual) / 100));
}

const dinheiro = (v: number) =>
  `R$ ${Math.round(v).toLocaleString("pt-BR", { maximumFractionDigits: 0 })}`;

const dinheiroExato = (v: number) =>
  `R$ ${v.toLocaleString("pt-BR", { maximumFractionDigits: 2, minimumFractionDigits: 2 })}`;

export function SimuladorDeProposta({
  entradaMinimaPercentual = null,
  planos,
  unidade,
  valorDaUnidade,
}: {
  /**
   * A % minima de entrada DESTE empreendimento, da aba Politica Comercial.
   *
   * Nulo = nao cadastrado, e vale o padrao da casa. E o que permite o Garden vender a 8% enquanto
   * os outros exigem 10%, sem duas versoes da regra.
   */
  entradaMinimaPercentual?: null | number;
  planos: PlanoDaVenda[];
  /** "12 06" — o lote, como a tela escreve. */
  unidade: string;
  valorDaUnidade: number;
}) {
  const [comando, setComando] = useState<Comando>("condicoes");
  const [planoAtivo, setPlanoAtivo] = useState<null | string>(null);
  // ⚠️ SÓ VIRA TETO SE ELE DIGITOU. O campo Entrada nasce preenchido pelo plano — usar esse número
  // como limite cortaria as composições sem ninguém ter pedido, e a lista aparecia vazia sem
  // explicação. Teto é o que o cliente TEM; o valor do plano é só um ponto de partida.
  const [entradaEhTeto, setEntradaEhTeto] = useState(false);
  const [cockpit, setCockpit] = useState<Cockpit>({
    anuaisQuantidade: 0,
    anuaisValor: 0,
    entrada: 0,
    entradaVezes: 1,
    parcela: 0,
    parcelas: 0,
    valor: valorDaUnidade,
  });

  // ── Os planos, já com a taxa mensal resolvida ────────────────────────────
  //
  // ⚠️ `PlanoDaVenda` é o mesmo `PlanoComercial` com as uniões alargadas para string — a rota
  // serializa e JSON não carrega união. `taxaMensal` só lê juros, convenção e periodicidade, e
  // compara com literais: o cast é de tipo, não de valor.
  const planosDaConta: PlanoDaComposicao[] = useMemo(
    () =>
      planos.map((p) => ({
        entradaPercentual: p.entradaPercentual,
        nome: p.nome,
        parcelas: p.parcelas,
        taxaAoMes: taxaMensal(p as unknown as PlanoComercial),
      })),
    [planos],
  );

  const plano = useMemo(
    () => planosDaConta.find((p) => p.nome === planoAtivo) ?? planosDaConta[0] ?? null,
    [planoAtivo, planosDaConta],
  );

  // ⚠️ O PLANO CRU FICA À MÃO. `PlanoDaComposicao` carrega só o que a conta usa; o índice de
  // correção, o sistema de amortização e a convenção de juros são do CADASTRO, e a tela precisa
  // deles para dizer o que o cliente vai assinar.
  const crus = useMemo(() => new Map(planos.map((p) => [p.nome, p])), [planos]);
  const cru = plano ? crus.get(plano.nome) : undefined;

  // ── A TABELA: cada plano aplicado a ESTE lote ────────────────────────────
  //
  // ⚠️ Com a entrada do próprio plano, e não uma qualquer: é a condição que a diretoria aprovou, e
  // é dela que a conversa parte. Clicar carrega tudo no cockpit.
  const tabela = useMemo(
    () =>
      planosDaConta.map((p) => {
        const entrada = entradaDoPlano(cockpit.valor, p.entradaPercentual, entradaMinimaPercentual);
        const montada = montarProposta({
          baloesQuantidade: 0,
          baloesValor: 0,
          entrada,
          parcelas: p.parcelas,
          taxaAoMes: p.taxaAoMes,
          valor: cockpit.valor,
        });
        return { entrada, parcela: montada.parcela, plano: p };
      }),
    [cockpit.valor, entradaMinimaPercentual, planosDaConta],
  );

  function carregarPlano(nome: string) {
    const alvo = tabela.find((t) => t.plano.nome === nome);
    if (!alvo) return;
    setPlanoAtivo(nome);
    setCockpit((a) => ({
      ...a,
      anuaisQuantidade: 0,
      anuaisValor: 0,
      entrada: alvo.entrada,
      parcela: alvo.parcela,
      parcelas: alvo.plano.parcelas,
    }));
    setComando("condicoes");
    setEntradaEhTeto(false);
  }

  // ⚠️ A TELA NUNCA ABRE VAZIA. Sem um ponto de partida, a direita seria um espaço em branco e a
  // primeira ação de todo mundo seria a mesma: clicar no plano mais longo. O simulador já faz isso
  // — abre no maior prazo, que é o que atende mais gente, e o resto se ajusta em cima.
  useEffect(() => {
    const maisLongo = [...planosDaConta].sort((a, b) => b.parcelas - a.parcelas)[0] ?? null;
    const entrada = maisLongo
      ? entradaDoPlano(valorDaUnidade, maisLongo.entradaPercentual, entradaMinimaPercentual)
      : 0;

    setPlanoAtivo(maisLongo?.nome ?? null);
    setComando("condicoes");
    setEntradaEhTeto(false);
    setCockpit({
      anuaisQuantidade: 0,
      anuaisValor: 0,
      entrada,
      entradaVezes: 1,
      parcela: maisLongo
        ? montarProposta({
            baloesQuantidade: 0,
            baloesValor: 0,
            entrada,
            parcelas: maisLongo.parcelas,
            taxaAoMes: maisLongo.taxaAoMes,
            valor: valorDaUnidade,
          }).parcela
        : 0,
      // ⚠️ SEM PLANO, UM PRAZO DE PARTIDA — e não zero. Com zero parcelas não existe conta
      // possível, e a tela abria morta no produto sem plano cadastrado. 120 é ponto de partida
      // editável, não regra da casa: o plano NORMAL do C2X vai de 37 a 200 parcelas, e não existe
      // um número que sirva a todos.
      parcelas: maisLongo?.parcelas ?? PARCELAS_SEM_PLANO,
      valor: valorDaUnidade,
    });
  }, [entradaMinimaPercentual, planosDaConta, unidade, valorDaUnidade]);

  // ── A conta montada à mão, quando o comando veio das condições ───────────
  //
  // ⚠️ SEM PLANO A CONTA CONTINUA, e isso não é detalhe: até 04/09/2026 esta função devolvia
  // `null` quando o produto não tinha plano no C2X, e a coluna da direita ficava EM BRANCO. Foi o
  // que o Lucas viu no empreendimento de teste ("está dando erro, não abriu a simulação") — a tela
  // dizia "a conta sai sem juros e sem correção" e não fazia conta nenhuma. Sem plano, a conta é a
  // simples: divide o saldo pelo prazo, sem juros e sem correção.
  const montada = useMemo(() => {
    const parcelas = cockpit.parcelas > 0 ? cockpit.parcelas : (plano?.parcelas ?? 0);
    if (parcelas <= 0) return null;
    return {
      ...montarProposta({
        baloesQuantidade: cockpit.anuaisQuantidade,
        baloesValor: cockpit.anuaisValor,
        entrada: cockpit.entrada,
        parcelas,
        taxaAoMes: plano?.taxaAoMes ?? 0,
        valor: cockpit.valor,
      }),
      parcelas,
    };
  }, [cockpit, plano]);

  /** O chão da casa para este lote — 10% do valor negociado, e acompanha o valor editado. */
  const minimoDaEntrada = entradaMinima(cockpit.valor, entradaMinimaPercentual);
  const pisoEmPercentual = entradaMinimaPercentual ?? ENTRADA_MINIMA_PERCENTUAL;

  /** Quantos aniversários cabem no prazo — o teto de reforços anuais. */
  const aniversarios = Math.floor((cockpit.parcelas > 0 ? cockpit.parcelas : (plano?.parcelas ?? 0)) / 12);

  /** A parcela sobre a qual a direita conversa: a pedida, ou a que a conta devolveu. */
  const parcelaDeReferencia =
    comando === "parcela" ? cockpit.parcela : Math.round(montada?.parcela ?? 0);

  const composicoes = useMemo(
    () =>
      parcelaDeReferencia > 0
        ? composicoesQueFecham({
            parcelaAlvo: parcelaDeReferencia,
            planos: planosDaConta,
            entradaMinimaPercentual,
            tetoDaEntrada: entradaEhTeto && cockpit.entrada > 0 ? cockpit.entrada : null,
            valor: cockpit.valor,
          })
        : [],
    [
      cockpit.entrada,
      cockpit.valor,
      entradaEhTeto,
      entradaMinimaPercentual,
      parcelaDeReferencia,
      planosDaConta,
    ],
  );

  const principal: Leitura | null = useMemo(() => {
    if (comando === "condicoes" && montada && plano) {
      return {
        anuais: { quantidade: cockpit.anuaisQuantidade, valor: cockpit.anuaisValor },
        composicao: null,
        entrada: cockpit.entrada,
        financiado: montada.financiado,
        origem: "montada",
        parcela: montada.parcela,
        parcelas: montada.parcelas,
        plano: plano.nome,
        total: montada.total,
      };
    }

    const melhor = composicoes[0];
    if (!melhor) return null;
    return {
      anuais: melhor.anuais,
      composicao: melhor,
      entrada: melhor.entrada,
      financiado: Math.max(0, cockpit.valor - melhor.entrada),
      origem: "composicao",
      parcela: melhor.parcela,
      parcelas: melhor.parcelas,
      plano: melhor.plano,
      total: melhor.total,
    };
  }, [comando, composicoes, cockpit, montada, plano]);

  /**
   * As demais: mesma parcela, outro arranjo.
   *
   * ⚠️ FORA A QUE JÁ ESTÁ NO CARTÃO GRANDE, e a comparação é por plano + número de reforços, não
   * por origem: quando ele monta à mão no Normal 180 sem reforço, a varredura acha esse mesmo
   * arranjo (com a entrada arredondada) e ele apareceria de novo logo abaixo de si mesmo.
   */
  const alternativas = composicoes.filter(
    (c) =>
      !principal ||
      c.plano !== principal.plano ||
      c.anuais.quantidade !== principal.anuais.quantidade,
  );

  function usarComposicao(c: Composicao) {
    setCockpit((atual) => ({
      ...atual,
      anuaisQuantidade: c.anuais.quantidade,
      anuaisValor: c.anuais.valor,
      entrada: c.entrada,
      parcela: c.parcela,
      parcelas: c.parcelas,
    }));
    setPlanoAtivo(c.plano);
    setComando("condicoes");
    setEntradaEhTeto(false);
  }

  return (
    <div
      style={{
        // ⚠️ A COR DO TEXTO É DECLARADA AQUI, e não herdada. O modal vive dentro do layout do hub,
        // que tem tema próprio: sem esta linha, os números grandes saíam com a cor do hub sobre o
        // cartão do portal — preto sobre preto no tema escuro.
        color: T.text,
        display: "grid",
        gap: 14,
        gridTemplateColumns: "minmax(270px, 320px) minmax(0, 1fr)",
        height: "100%",
        minHeight: 0,
      }}
    >
      {/* ═══ O COCKPIT ═══════════════════════════════════════════════════ */}
      <div
        style={{
          display: "grid",
          gap: 10,
          gridAutoRows: "min-content",
          minHeight: 0,
          overflow: "auto",
          paddingRight: 4,
        }}
      >
        <Bloco titulo="O lote">
          <CampoEmReais
            aoMudar={(v) => setCockpit((a) => ({ ...a, valor: v }))}
            direita={valorDaUnidade === cockpit.valor ? "valor de tabela" : "editado"}
            rotulo={`Lote ${unidade}`}
            valor={cockpit.valor}
          />
        </Bloco>

        <Bloco
          nota="É como o comprador fala. A tela varre os planos e devolve as composições que fecham nesse valor."
          titulo="Quanto o cliente paga por mês"
        >
          <CampoEmReais
            aoMudar={(v) => {
              setCockpit((a) => ({ ...a, parcela: v }));
              setComando("parcela");
            }}
            destaque={comando === "parcela"}
            rotulo="Parcela"
            valor={cockpit.parcela}
          />
          <Atalhos
            aoEscolher={(v) => {
              setCockpit((a) => ({ ...a, parcela: v }));
              setComando("parcela");
            }}
            valores={[1_500, 2_000, 3_000, 4_000]}
          />
        </Bloco>

        <Bloco
          nota={
            entradaEhTeto
              ? "Digitada: vira o teto da busca — só entram composições que cabem nela."
              : "Veio do plano. Digite o que o cliente tem e ela passa a limitar a busca."
          }
          titulo="Entrada"
        >
          <CampoDeEntrada
            aoMudar={(v) => {
              setCockpit((a) => ({ ...a, entrada: v }));
              setEntradaEhTeto(true);
              if (comando !== "parcela") setComando("condicoes");
            }}
            minimo={minimoDaEntrada}
            minimoEmPercentual={pisoEmPercentual}
            valor={cockpit.entrada}
            valorDoLote={cockpit.valor}
          />
          <div style={{ alignItems: "center", display: "flex", gap: 8, marginTop: 8 }}>
            <Contador
              aoMudar={(n) => setCockpit((a) => ({ ...a, entradaVezes: n }))}
              maximo={12}
              valor={cockpit.entradaVezes}
            />
            <span style={{ color: T.muted, fontSize: 11.5 }}>
              {cockpit.entradaVezes > 1
                ? `vezes de ${dinheiro(cockpit.entrada / cockpit.entradaVezes)}`
                : "à vista"}
            </span>
          </div>
        </Bloco>

        <Bloco nota="Reforços que abatem o saldo e derrubam a mensalidade." titulo="Parcelas anuais">
          <div style={{ alignItems: "center", display: "flex", gap: 8 }}>
            {/* ⚠️ O TETO É O PRAZO: o k-ésimo reforço cai no mês 12k, e um contrato de 24 meses só
                tem dois aniversários. Deixar subir além disso cobraria depois da última parcela. */}
            <Contador
              aoMudar={(n) => {
                setCockpit((a) => ({
                  ...a,
                  anuaisQuantidade: n,
                  anuaisValor: n > 0 && a.anuaisValor === 0 ? 20_000 : a.anuaisValor,
                }));
                setComando("condicoes");
              }}
              maximo={aniversarios}
              minimo={0}
              valor={cockpit.anuaisQuantidade}
            />
            <span style={{ color: T.muted, fontSize: 11.5 }}>
              {cockpit.anuaisQuantidade > 0
                ? "reforços, um por ano"
                : aniversarios > 0
                  ? "sem reforço anual"
                  : "o prazo não chega a um ano"}
            </span>
          </div>
          {cockpit.anuaisQuantidade > 0 ? (
            <div style={{ marginTop: 8 }}>
              <CampoEmReais
                aoMudar={(v) => {
                  setCockpit((a) => ({ ...a, anuaisValor: v }));
                  setComando("condicoes");
                }}
                direita={`total ${dinheiro(cockpit.anuaisQuantidade * cockpit.anuaisValor)}`}
                rotulo="Valor de cada reforço"
                valor={cockpit.anuaisValor}
              />
              <Atalhos
                aoEscolher={(v) => {
                  setCockpit((a) => ({ ...a, anuaisValor: v }));
                  setComando("condicoes");
                }}
                valores={[10_000, 15_000, 20_000, 30_000]}
              />
            </div>
          ) : null}
        </Bloco>

        <Bloco titulo="Prazo, juros e reajuste">
          <label style={{ display: "grid", gap: 3 }}>
            <span style={{ color: T.muted, fontSize: 11, fontWeight: 650 }}>Parcelas</span>
            <input
              onChange={(e) => {
                setCockpit((a) => ({ ...a, parcelas: Number(e.target.value) || 0 }));
                setComando("condicoes");
              }}
              style={campo}
              type="number"
              value={String(cockpit.parcelas || plano?.parcelas || 0)}
            />
          </label>

          {/* ⚠️ O ÍNDICE DE REAJUSTE É PARTE DO PREÇO (Lucas, 03/09/2026: *"faltou o índice de
              reajuste"*). Dois planos com a mesma parcela e a mesma taxa custam diferente se um
              corrige por IPCA e o outro não. A frase sai de `fraseDeCorrecao`, a MESMA que a ficha
              do plano usa, para as duas telas não divergirem. */}
          {cru ? (
            <>
              <div style={{ display: "grid", gap: 4, marginTop: 10 }}>
                <Linha rotulo="Reajuste" valor={INDICES[cru.indiceCorrecao as IndiceCorrecao] ?? "—"} />
                <Linha
                  rotulo="Juros"
                  valor={
                    plano && plano.taxaAoMes > 0
                      ? `${(plano.taxaAoMes * 100).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}% ao mês`
                      : "sem juros"
                  }
                />
              </div>
              <p style={{ color: T.muted, fontSize: 11, margin: "8px 0 0" }}>
                {fraseDeCorrecao(cru as unknown as PlanoComercial)}. A parcela acima é a valor de
                hoje: o índice corrige o contrato ao longo do prazo e não entra nesta conta.
              </p>
            </>
          ) : (
            <p style={{ color: T.muted, fontSize: 11.5, margin: "8px 0 0" }}>
              Nenhum plano cadastrado para este produto: a conta sai sem juros e sem correção,
              e o prazo abaixo é só um ponto de partida — edite à vontade.
            </p>
          )}
        </Bloco>
      </div>

      {/* ═══ A LEITURA ═══════════════════════════════════════════════════ */}
      <div
        style={{
          display: "grid",
          gap: 12,
          gridAutoRows: "min-content",
          minHeight: 0,
          overflow: "auto",
          paddingRight: 4,
        }}
      >
        {/* A TABELA como ponto de partida: um cartão por plano, e clicar carrega no cockpit. */}
        <div>
          <div style={{ ...rotuloDeSecao, marginBottom: 8 }}>
            Tabela do empreendimento, aplicada a este lote
          </div>
          <div
            style={{
              display: "grid",
              gap: 8,
              gridTemplateColumns: "repeat(auto-fit, minmax(148px, 1fr))",
            }}
          >
            {tabela.map((t) => {
              const ativo = plano?.nome === t.plano.nome;
              return (
                <button
                  key={t.plano.nome}
                  onClick={() => carregarPlano(t.plano.nome)}
                  style={{
                    background: ativo ? T.soft : T.card,
                    border: `1px solid ${ativo ? T.gold : T.border}`,
                    borderRadius: 11,
                    cursor: "pointer",
                    font: "inherit",
                    padding: "10px 12px",
                    textAlign: "left",
                  }}
                  type="button"
                >
                  <div style={{ color: T.sub, fontSize: 12, fontWeight: 650 }}>{t.plano.nome}</div>
                  <div
                    style={{
                      color: T.text,
                      fontSize: 17,
                      fontVariantNumeric: "tabular-nums",
                      fontWeight: 650,
                      marginTop: 3,
                    }}
                  >
                    {dinheiro(t.parcela)}
                  </div>
                  <div style={{ color: T.muted, fontSize: 11 }}>
                    {t.plano.parcelas}x · entrada {dinheiro(t.entrada)}
                  </div>
                  <div style={{ color: T.muted, fontSize: 10.5, marginTop: 2 }}>
                    {INDICES[
                      (crus.get(t.plano.nome)?.indiceCorrecao ?? "SEM_CORRECAO") as IndiceCorrecao
                    ] ?? "sem correção"}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* ⚠️ UMA LEITURA SÓ PARA OS DOIS CAMINHOS — ver o cabeçalho do arquivo. */}
        {principal ? (
          <div
            style={{
              background: T.card,
              border: `1px solid ${principal.origem === "composicao" ? T.ok : T.border}`,
              borderRadius: 12,
              padding: 16,
            }}
          >
            <div
              style={{
                alignItems: "center",
                display: "flex",
                gap: 8,
                justifyContent: "space-between",
                marginBottom: 10,
              }}
            >
              <span
                style={{
                  background: principal.origem === "composicao" ? T.okBg : T.soft,
                  borderRadius: 999,
                  color: principal.origem === "composicao" ? T.ok : T.muted,
                  fontSize: 10.5,
                  fontWeight: 700,
                  letterSpacing: ".05em",
                  padding: "3px 9px",
                  textTransform: "uppercase",
                }}
              >
                {principal.origem === "composicao"
                  ? "Recomendada · menor entrada"
                  : "Proposta montada"}
              </span>
              <span style={{ color: T.muted, fontSize: 11.5 }}>Plano {principal.plano}</span>
            </div>

            <div style={{ alignItems: "baseline", display: "flex", gap: 10, marginBottom: 4 }}>
              <b style={{ fontSize: 30, fontVariantNumeric: "tabular-nums", fontWeight: 650 }}>
                {dinheiroExato(principal.parcela)}
              </b>
              <span style={{ color: T.muted, fontSize: 13 }}>
                por mês, {principal.parcelas} vezes
              </span>
            </div>

            {/* ⚠️ EXPLICA A PARCELA MENOR QUE A PEDIDA. Com a entrada ancorada no piso de 10%, a
                parcela cai abaixo do valor que o cliente disse que podia pagar. É notícia boa, mas
                sem esta linha parece conta errada — "pedi 2.000 e a tela devolveu 1.736". */}
            {principal.origem === "composicao" && principal.parcela < parcelaDeReferencia * 0.99 ? (
              <p style={{ color: T.muted, fontSize: 11.5, margin: "0 0 12px" }}>
                Abaixo dos {dinheiro(parcelaDeReferencia)} que ele pode pagar: chegar exatamente
                nesse valor exigiria entrada menor que o mínimo de {pisoEmPercentual}%.
              </p>
            ) : (
              <div style={{ height: 10 }} />
            )}

            <div
              style={{
                display: "grid",
                gap: 12,
                gridTemplateColumns: "repeat(auto-fit, minmax(112px, 1fr))",
              }}
            >
              <Dado
                nota={
                  cockpit.entradaVezes > 1
                    ? `${cockpit.entradaVezes} × ${dinheiro(principal.entrada / cockpit.entradaVezes)}`
                    : `${Math.round((principal.entrada / (cockpit.valor || 1)) * 100)}% do valor`
                }
                rotulo="Entrada"
                valor={dinheiro(principal.entrada)}
              />
              <Dado
                nota={
                  principal.anuais.quantidade > 0
                    ? `total ${dinheiro(principal.anuais.quantidade * principal.anuais.valor)}`
                    : "sem reforço"
                }
                rotulo="Anuais"
                valor={
                  principal.anuais.quantidade > 0
                    ? `${principal.anuais.quantidade} × ${dinheiro(principal.anuais.valor)}`
                    : "—"
                }
              />
              <Dado
                nota="depois da entrada e dos reforços"
                rotulo="A financiar"
                valor={dinheiro(principal.financiado)}
              />
              <Dado
                nota={`+${Math.round((principal.total / (cockpit.valor || 1) - 1) * 100)}% sobre a tabela`}
                rotulo="Total pago"
                valor={dinheiro(principal.total)}
              />
            </div>

            {/* Lucas: *"aqui em vez desse textão, somente um editar"*. A ação é óbvia pelo lugar. */}
            {principal.composicao ? (
              <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 12 }}>
                <button
                  onClick={() => usarComposicao(principal.composicao as Composicao)}
                  style={botaoDiscreto}
                  type="button"
                >
                  Editar
                </button>
              </div>
            ) : null}
          </div>
        ) : (
          <p style={{ color: T.muted, fontSize: 13, margin: 0 }}>
            {cockpit.parcela > 0
              ? "Nenhuma composição fecha com essa parcela: ela pode estar alta demais (pagaria o lote antes do prazo) ou a entrada disponível não cobre nenhum plano."
              : "Diga quanto o cliente paga por mês, ou escolha um plano acima."}
          </p>
        )}

        {/* AS ALTERNATIVAS: mesma parcela, outro arranjo de entrada e reforço. */}
        {alternativas.length > 0 ? (
          <div>
            <div style={{ ...rotuloDeSecao, marginBottom: 8 }}>
              Outras composições com {dinheiro(parcelaDeReferencia)} por mês
            </div>
            <div style={{ display: "grid", gap: 6 }}>
              {alternativas.map((c) => (
                <button
                  key={`${c.plano}-${c.anuais.quantidade}`}
                  onClick={() => usarComposicao(c)}
                  style={{
                    alignItems: "center",
                    background: T.card,
                    border: `1px solid ${T.border}`,
                    borderRadius: 10,
                    cursor: "pointer",
                    display: "flex",
                    flexWrap: "wrap",
                    font: "inherit",
                    gap: 12,
                    justifyContent: "space-between",
                    padding: "9px 12px",
                    textAlign: "left",
                  }}
                  type="button"
                >
                  <span style={{ color: T.text, fontSize: 12.5, fontWeight: 650, minWidth: 84 }}>
                    {c.plano}
                  </span>
                  <span style={{ color: T.sub, fontSize: 12 }}>
                    entrada{" "}
                    <b style={{ fontVariantNumeric: "tabular-nums" }}>{dinheiro(c.entrada)}</b>
                  </span>
                  <span style={{ color: T.sub, fontSize: 12 }}>
                    {c.anuais.quantidade > 0
                      ? `${c.anuais.quantidade} × ${dinheiro(c.anuais.valor)} ao ano`
                      : "sem reforço anual"}
                  </span>
                  <span style={{ color: T.sub, fontSize: 12 }}>{c.parcelas} meses</span>
                  <span style={{ color: T.muted, fontSize: 12 }}>total {dinheiro(c.total)}</span>
                </button>
              ))}
            </div>
          </div>
        ) : null}

        <p style={{ color: T.muted, fontSize: 11.5, margin: 0 }}>
          Simulação livre: nada aqui vincula a unidade nem gera proposta. Conta feita nesta tela, com
          os planos cadastrados do empreendimento.
        </p>
      </div>
    </div>
  );
}

// ── PEÇAS ───────────────────────────────────────────────────────────────────

const campo = {
  background: T.soft,
  border: `1px solid ${T.border}`,
  borderRadius: 8,
  color: T.text,
  font: "inherit",
  fontSize: 13.5,
  fontVariantNumeric: "tabular-nums",
  fontWeight: 600,
  padding: "7px 10px",
  width: "100%",
} as const;

const rotuloDeSecao = {
  color: T.muted,
  fontSize: 10.5,
  fontWeight: 700,
  letterSpacing: ".06em",
  textTransform: "uppercase",
} as const;

const botaoDiscreto = {
  background: T.soft,
  border: `1px solid ${T.border}`,
  borderRadius: 8,
  color: T.sub,
  cursor: "pointer",
  font: "inherit",
  fontSize: 12,
  fontWeight: 650,
  padding: "6px 16px",
} as const;

function Bloco({
  children,
  nota,
  titulo,
}: {
  children: React.ReactNode;
  nota?: string;
  titulo: string;
}) {
  return (
    <section
      style={{
        background: T.card,
        border: `1px solid ${T.border}`,
        borderRadius: 12,
        padding: 12,
      }}
    >
      <div style={{ ...rotuloDeSecao, marginBottom: 8 }}>{titulo}</div>
      {children}
      {nota ? <p style={{ color: T.muted, fontSize: 11, margin: "8px 0 0" }}>{nota}</p> : null}
    </section>
  );
}

function Atalhos({
  aoEscolher,
  valores,
}: {
  aoEscolher: (v: number) => void;
  valores: number[];
}) {
  return (
    // Uma linha só, em grade: em coluna estreita o `flex-wrap` deixava um atalho órfão embaixo.
    <div
      style={{
        display: "grid",
        gap: 5,
        gridTemplateColumns: `repeat(${valores.length}, 1fr)`,
        marginTop: 8,
      }}
    >
      {valores.map((v) => (
        <button
          key={v}
          onClick={() => aoEscolher(v)}
          style={{
            background: T.soft,
            border: `1px solid ${T.border}`,
            borderRadius: 999,
            color: T.sub,
            cursor: "pointer",
            font: "inherit",
            fontSize: 11,
            fontWeight: 600,
            padding: "4px 2px",
          }}
          type="button"
        >
          {dinheiro(v)}
        </button>
      ))}
    </div>
  );
}

/**
 * Campo de dinheiro com cifrão e pontuação.
 *
 * ⚠️ Os dois (Lucas, 03/09/2026): a pontuação porque "145451" obriga a contar casas com o dedo na
 * tela, e o símbolo porque numa grade com prazo e quantidade ele diz de imediato o que é dinheiro.
 */
function CampoEmReais({
  aoMudar,
  destaque,
  direita,
  rotulo,
  valor,
}: {
  aoMudar: (n: number) => void;
  destaque?: boolean;
  direita?: string;
  rotulo: string;
  valor: number;
}) {
  const [texto, setTexto] = useState(valorParaOCampo(valor));

  // ⚠️ SÓ REESCREVE QUANDO O VALOR VEIO DE FORA. Enquanto a pessoa digita, o texto é dela: formatar
  // a cada tecla move o cursor e apaga a vírgula que ela acabou de escrever.
  useEffect(() => {
    setTexto((atual) => ((valorDigitado(atual) ?? 0) === valor ? atual : valorParaOCampo(valor)));
  }, [valor]);

  return (
    <label style={{ display: "grid", gap: 3 }}>
      {/* Rótulo vazio = quem chama já desenhou o seu (é o caso do campo de entrada, que tem o
          alternador R$/% na mesma linha). Um <span> vazio abriria um vão de 11px. */}
      {rotulo || direita ? (
        <span style={{ alignItems: "baseline", display: "flex", justifyContent: "space-between" }}>
          <span style={{ color: T.muted, fontSize: 11, fontWeight: 650 }}>{rotulo}</span>
          {direita ? <span style={{ color: T.muted, fontSize: 10.5 }}>{direita}</span> : null}
        </span>
      ) : null}
      <span style={{ alignItems: "center", display: "flex", position: "relative" }}>
        <span
          style={{
            color: T.muted,
            fontSize: 12,
            fontWeight: 600,
            left: 10,
            pointerEvents: "none",
            position: "absolute",
          }}
        >
          R$
        </span>
        <input
          inputMode="decimal"
          onBlur={() => setTexto(valor > 0 ? valorParaOCampo(valor) : "")}
          onChange={(e) => {
            setTexto(e.target.value);
            aoMudar(valorDigitado(e.target.value) ?? 0);
          }}
          placeholder="0,00"
          style={{
            ...campo,
            border: `1px solid ${destaque ? T.gold : T.border}`,
            padding: "7px 10px 7px 34px",
          }}
          value={texto}
        />
      </span>
    </label>
  );
}

/**
 * A entrada: em reais ou em percentual, e com o piso da casa na cara.
 *
 * ⚠️ OS DOIS MODOS SÃO PEDIDO DELE (Lucas, 03/09/2026: *"libera para gente também colocar %"*). Numa
 * mesa a entrada se fala das duas formas — "vinte por cento" quando a conversa é de política, "trinta
 * mil" quando é do bolso do cliente. Converter na cabeça, com o valor do lote quebrado, é onde o erro
 * entra.
 *
 * ⚠️ E O MÍNIMO APARECE, não bloqueia. Digitar é um caminho, não um resultado: travar no meio da
 * digitação apagaria o número enquanto ele ainda está sendo escrito. A tela avisa e oferece o piso
 * num clique.
 */
function CampoDeEntrada({
  aoMudar,
  minimo,
  minimoEmPercentual,
  valor,
  valorDoLote,
}: {
  aoMudar: (n: number) => void;
  minimo: number;
  /** O mesmo piso, em %, para a tela escrever "minimo de 8%" em vez de repetir a constante. */
  minimoEmPercentual: number;
  valor: number;
  valorDoLote: number;
}) {
  const [modo, setModo] = useState<"pct" | "reais">("reais");
  const abaixo = abaixoDoMinimo(valor, minimo);
  const pct = valorDoLote > 0 ? (valor / valorDoLote) * 100 : 0;

  return (
    <div style={{ display: "grid", gap: 3 }}>
      <div style={{ alignItems: "center", display: "flex", justifyContent: "space-between" }}>
        <span style={{ color: T.muted, fontSize: 11, fontWeight: 650 }}>Valor</span>
        <span style={{ display: "flex", gap: 3 }}>
          {(["reais", "pct"] as const).map((m) => (
            <button
              key={m}
              onClick={() => setModo(m)}
              style={{
                background: modo === m ? T.soft : "transparent",
                border: `1px solid ${modo === m ? T.border : "transparent"}`,
                borderRadius: 6,
                color: modo === m ? T.text : T.muted,
                cursor: "pointer",
                font: "inherit",
                fontSize: 10.5,
                fontWeight: 700,
                lineHeight: 1.4,
                padding: "2px 7px",
              }}
              type="button"
            >
              {m === "reais" ? "R$" : "%"}
            </button>
          ))}
        </span>
      </div>

      {modo === "reais" ? (
        <CampoEmReais aoMudar={aoMudar} rotulo="" valor={valor} />
      ) : (
        <CampoEmPorcento
          aoMudar={(p) => aoMudar(Math.round((valorDoLote * p) / 100))}
          valor={pct}
        />
      )}

      <div style={{ alignItems: "baseline", display: "flex", gap: 8, justifyContent: "space-between" }}>
        <span style={{ color: abaixo ? T.danger : T.muted, fontSize: 10.5 }}>
          {abaixo
            ? `Abaixo do mínimo de ${minimoEmPercentual}% (${dinheiro(minimo)})`
            : valor > 0
              ? `${pct.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}% do valor · mínimo ${dinheiro(minimo)}`
              : `Mínimo de ${minimoEmPercentual}%: ${dinheiro(minimo)}`}
        </span>
        {abaixo ? (
          <button
              onClick={() => aoMudar(minimo)}
            style={{
              background: "transparent",
              border: "none",
              color: T.gold,
              cursor: "pointer",
              font: "inherit",
              fontSize: 10.5,
              fontWeight: 700,
              padding: 0,
              whiteSpace: "nowrap",
            }}
            type="button"
          >
            usar o mínimo
          </button>
        ) : null}
      </div>
    </div>
  );
}

/** O irmão do `CampoEmReais` para percentual: mesmo comportamento, sufixo em vez de prefixo. */
function CampoEmPorcento({ aoMudar, valor }: { aoMudar: (n: number) => void; valor: number }) {
  const escreve = (v: number) =>
    v > 0 ? v.toLocaleString("pt-BR", { maximumFractionDigits: 2 }) : "";
  const [texto, setTexto] = useState(escreve(valor));

  useEffect(() => {
    setTexto((atual) => (lerPorcento(atual) === Math.round(valor * 100) / 100 ? atual : escreve(valor)));
  }, [valor]);

  return (
    <span style={{ alignItems: "center", display: "flex", position: "relative" }}>
      <input
        inputMode="decimal"
        onBlur={() => setTexto(escreve(valor))}
        onChange={(e) => {
          setTexto(e.target.value);
          aoMudar(lerPorcento(e.target.value));
        }}
        placeholder="0"
        style={{ ...campo, paddingRight: 28 }}
        value={texto}
      />
      <span
        style={{
          color: T.muted,
          fontSize: 12,
          fontWeight: 600,
          pointerEvents: "none",
          position: "absolute",
          right: 10,
        }}
      >
        %
      </span>
    </span>
  );
}

/**
 * Está abaixo do piso?
 *
 * ⚠️ A COMPARAÇÃO É EM CENTAVOS INTEIROS. Em ponto flutuante 10% de R$ 178.100 é
 * 17810.000000000002, e `17810 < 17810.000000000002` é verdadeiro: a tela acusava "abaixo do
 * mínimo" para o valor exato do mínimo. O piso é inclusivo — 10% em diante.
 */
function abaixoDoMinimo(valor: number, minimo: number): boolean {
  return valor > 0 && Math.round(valor * 100) < Math.round(minimo * 100);
}

/** "12,5" e "12.5" viram 12,5; o resto vira 0. Percentual não é dinheiro: não tem separador de milhar. */
function lerPorcento(texto: string): number {
  const limpo = texto.replace(/[^\d,.]/g, "").replace(",", ".");
  const n = Number.parseFloat(limpo);
  return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : 0;
}

function Contador({
  aoMudar,
  maximo,
  minimo = 1,
  valor,
}: {
  aoMudar: (n: number) => void;
  maximo: number;
  minimo?: number;
  valor: number;
}) {
  const passo = (d: number) => aoMudar(Math.max(minimo, Math.min(maximo, valor + d)));

  return (
    <span
      style={{
        alignItems: "center",
        background: T.soft,
        border: `1px solid ${T.border}`,
        borderRadius: 8,
        display: "inline-flex",
      }}
    >
      <button aria-label="Diminuir" onClick={() => passo(-1)} style={passoDoContador} type="button">
        −
      </button>
      <span
        style={{
          fontSize: 13,
          fontVariantNumeric: "tabular-nums",
          fontWeight: 650,
          minWidth: 22,
          textAlign: "center",
        }}
      >
        {valor}
      </span>
      <button aria-label="Aumentar" onClick={() => passo(1)} style={passoDoContador} type="button">
        +
      </button>
    </span>
  );
}

const passoDoContador = {
  background: "transparent",
  border: "none",
  color: T.sub,
  cursor: "pointer",
  font: "inherit",
  fontSize: 15,
  fontWeight: 700,
  lineHeight: 1,
  padding: "5px 10px",
} as const;

/** Rótulo à esquerda, valor à direita — para as duas linhas de condição do plano. */
function Linha({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div style={{ display: "flex", gap: 10, justifyContent: "space-between" }}>
      <span style={{ color: T.muted, fontSize: 11.5 }}>{rotulo}</span>
      <b style={{ fontSize: 11.5, fontWeight: 650 }}>{valor}</b>
    </div>
  );
}

function Dado({ nota, rotulo, valor }: { nota: string; rotulo: string; valor: string }) {
  return (
    <div>
      <div style={{ color: T.muted, fontSize: 10.5, fontWeight: 650 }}>{rotulo}</div>
      <div style={{ fontSize: 14, fontVariantNumeric: "tabular-nums", fontWeight: 650 }}>
        {valor}
      </div>
      <div style={{ color: T.muted, fontSize: 10.5 }}>{nota}</div>
    </div>
  );
}
