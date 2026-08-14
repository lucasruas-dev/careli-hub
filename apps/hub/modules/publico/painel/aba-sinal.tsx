"use client";

import { useMemo, useState } from "react";

import type { BoletoDoSinal, ResumoDoSinal } from "@/lib/apolo/painel-sinal";

import {
  Aviso,
  C,
  GradeKpis,
  Kpi,
  Selo,
  Tabela,
  TituloSecao,
  celula,
  dataCurta,
  inputEstilo,
  moedaBR,
  useOrdenacao,
} from "./ui";

// ABA SINAL — o cenário de pagamento da ENTRADA (Ato + Sinal) do empreendimento.
//
// A pergunta do coordenador, na ordem em que ele faz: o que foi gerado, o que o cliente já
// quitou, o que ainda vai vencer, o que venceu e não foi pago. Sem receita líquida, sem comissão
// — isso é conversa de dono, e não é esta tela (ver o comentário em lib/apolo/painel-sinal.ts).
//
// Os cartões contam sobre a BUSCA e o tipo, mas não sobre a situação: clicar em "Atrasado" filtra
// a lista sem reescrever os próprios cartões, senão o painel passaria a dizer "100% atrasado"
// assim que alguém clicasse no cartão vermelho.

const SELO: Record<
  BoletoDoSinal["status"],
  { rotulo: string; tom: "ambar" | "cinza" | "verde" | "vermelho" }
> = {
  a_vencer: { rotulo: "A vencer", tom: "ambar" },
  atrasado: { rotulo: "Atrasado", tom: "vermelho" },
  outro: { rotulo: "Outro", tom: "cinza" },
  quitado: { rotulo: "Quitado", tom: "verde" },
};

function normaliza(valor: string): string {
  return valor
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();
}

/** O que a linha vale hoje: no quitado, o que ENTROU (com juros e multa); nos demais, o devido. */
const valorDaLinha = (boleto: BoletoDoSinal) =>
  boleto.status === "quitado" ? boleto.valorPago || boleto.valor : boleto.valor;

export function AbaSinal({ resumo }: { resumo: ResumoDoSinal }) {
  const { atrasado, aVencer, boletos, clientes, gerado, quitado, semBoleto, unidades, vencendo } =
    resumo;

  const [busca, setBusca] = useState<string>("");
  const [tipo, setTipo] = useState<string>("todos");
  const [situacao, setSituacao] = useState<string>("todas");

  const base = useMemo(
    () =>
      boletos.filter(
        (boleto) =>
          (tipo === "todos" || boleto.tipo === tipo) &&
          (busca === "" ||
            normaliza(boleto.cliente).includes(normaliza(busca)) ||
            normaliza(boleto.unidade).includes(normaliza(busca)))),
    [boletos, busca, tipo],
  );

  const filtrados = useMemo(() => {
    if (situacao === "todas") return base;
    if (situacao === "sem_boleto") return base.filter((boleto) => boleto.semBoleto);
    return base.filter((boleto) => boleto.status === situacao);
  }, [base, situacao]);

  const { alternar, itens, ordem } = useOrdenacao<BoletoDoSinal>(
    filtrados,
    {
      cliente: (b) => b.cliente,
      situacao: (b) => SELO[b.status].rotulo,
      tipo: (b) => b.tipo,
      unidade: (b) => b.unidade,
      valor: (b) => valorDaLinha(b),
      vencimento: (b) => b.vencimento ?? "",
    },
    { campo: "vencimento", desc: false },
  );

  const pctQuitado = gerado.valor ? Math.round((quitado.valor / gerado.valor) * 100) : 0;
  const emAberto = aVencer.valor + atrasado.valor;
  const filtrando = busca !== "" || tipo !== "todos" || situacao !== "todas";
  const somaFiltrada = itens.reduce((total, boleto) => total + valorDaLinha(boleto), 0);

  return (
    <>
      <GradeKpis>
        <Kpi
          ativo={situacao === "todas"}
          label="Gerado"
          onClick={() => setSituacao("todas")}
          sub={`${moedaBR(gerado.valor)} · ${unidades} ${unidades === 1 ? "unidade" : "unidades"}`}
          tom="cinza"
          valor={gerado.n}
        />
        <Kpi
          ativo={situacao === "quitado"}
          label="Quitado"
          onClick={() => setSituacao(situacao === "quitado" ? "todas" : "quitado")}
          sub={`${pctQuitado}% do valor · ${moedaBR(quitado.valor)}`}
          tom="verde"
          valor={quitado.n}
        />
        <Kpi
          ativo={situacao === "a_vencer"}
          label="A vencer"
          onClick={() => setSituacao(situacao === "a_vencer" ? "todas" : "a_vencer")}
          sub={moedaBR(aVencer.valor)}
          tom="ambar"
          valor={aVencer.n}
        />
        <Kpi
          ativo={situacao === "atrasado"}
          label="Atrasado"
          onClick={() => setSituacao(situacao === "atrasado" ? "todas" : "atrasado")}
          sub={moedaBR(atrasado.valor)}
          tom="vermelho"
          valor={atrasado.n}
        />
        <Kpi
          label="Vence em 7 dias"
          sub={`${moedaBR(vencendo.valor)} · para cobrar agora`}
          tom="roxo"
          valor={vencendo.n}
        />
        {semBoleto > 0 ? (
          <Kpi
            ativo={situacao === "sem_boleto"}
            label="Sem boleto"
            onClick={() => setSituacao(situacao === "sem_boleto" ? "todas" : "sem_boleto")}
            sub="cobrança sem link"
            tom="laranja"
            valor={semBoleto}
          />
        ) : null}
      </GradeKpis>

      <p style={{ color: C.sub, fontSize: 13, margin: "-6px 0 18px" }}>
        Entrada (Ato + Sinal) de {clientes} {clientes === 1 ? "cliente" : "clientes"} ·{" "}
        <strong>{moedaBR(emAberto)}</strong> em aberto de {moedaBR(gerado.valor)} gerados.
      </p>

      {semBoleto > 0 ? (
        <Aviso tom="laranja">
          <strong>{semBoleto}</strong>{" "}
          {semBoleto === 1 ? "parcela está" : "parcelas estão"} sem boleto gerado no Asaas: a
          cobrança existe no C2X, mas não há link de pagamento ligado a ela. Se o cliente não
          recebeu por outro caminho, ele não tem como pagar. Clique no cartão para ver só elas.
        </Aviso>
      ) : null}

      <div
        style={{
          alignItems: "center",
          display: "flex",
          flexWrap: "wrap",
          gap: 10,
          marginBottom: 18,
        }}
      >
        <input
          aria-label="Buscar por cliente ou unidade"
          onChange={(evento) => setBusca(evento.target.value)}
          placeholder="Buscar cliente ou unidade (ex.: VOC0104)"
          style={{ ...inputEstilo, flex: 1, minWidth: 200 }}
          value={busca}
        />
        <select
          aria-label="Filtrar por tipo"
          onChange={(evento) => setTipo(evento.target.value)}
          style={{ ...inputEstilo, maxWidth: 160 }}
          value={tipo}
        >
          <option value="todos">Ato e Sinal</option>
          <option value="Ato">Só Ato</option>
          <option value="Sinal">Só Sinal</option>
        </select>
        <select
          aria-label="Filtrar por situação"
          onChange={(evento) => setSituacao(evento.target.value)}
          style={{ ...inputEstilo, maxWidth: 190 }}
          value={situacao}
        >
          <option value="todas">Todas as situações</option>
          <option value="quitado">Quitado</option>
          <option value="a_vencer">A vencer</option>
          <option value="atrasado">Atrasado</option>
          <option value="sem_boleto">Sem boleto</option>
        </select>
        {filtrando ? (
          <button
            onClick={() => {
              setBusca("");
              setTipo("todos");
              setSituacao("todas");
            }}
            style={{
              background: C.card,
              border: `1px solid ${C.border}`,
              borderRadius: 10,
              color: C.sub,
              cursor: "pointer",
              fontSize: 13,
              height: 38,
              padding: "0 14px",
            }}
            type="button"
          >
            Limpar filtros
          </button>
        ) : null}
      </div>

      <TituloSecao
        contagem={`${itens.length} de ${boletos.length} · ${moedaBR(somaFiltrada)}`}
        titulo="Parcelas da entrada"
      />

      <Tabela
        colunas={[
          { campo: "cliente", chave: "Cliente", largura: "26%" },
          { campo: "unidade", chave: "Unidade", largura: 112 },
          { campo: "tipo", chave: "Tipo", largura: 78 },
          { chave: "Parcela", largura: 78 },
          { campo: "vencimento", chave: "Vencimento", largura: 118 },
          { campo: "valor", chave: "Valor", largura: 124 },
          { campo: "situacao", chave: "Situação", largura: 138 },
        ]}
        onOrdenar={alternar}
        ordem={ordem}
        vazio="Nenhuma parcela com esses filtros."
      >
        {itens.map((boleto, indice) => {
          const selo = SELO[boleto.status];
          return (
            <tr key={`${boleto.cliente}-${boleto.unidade}-${indice}`}>
              <td style={celula(C.text)}>{boleto.cliente}</td>
              <td style={celula(C.sub)}>{boleto.unidade}</td>
              <td style={celula(C.sub)}>{boleto.tipo}</td>
              <td style={celula(C.sub)}>{boleto.parcela}</td>
              <td style={celula(C.sub)}>{dataCurta(boleto.vencimento)}</td>
              <td style={celula(C.text, { fontVariantNumeric: "tabular-nums" })}>
                {moedaBR(valorDaLinha(boleto))}
              </td>
              <td style={celula(C.text, { overflow: "visible" })}>
                <span style={{ alignItems: "center", display: "flex", gap: 6 }}>
                  <Selo tom={selo.tom}>{selo.rotulo}</Selo>
                  {boleto.semBoleto ? <Selo tom="laranja">sem boleto</Selo> : null}
                </span>
              </td>
            </tr>
          );
        })}
      </Tabela>
    </>
  );
}
