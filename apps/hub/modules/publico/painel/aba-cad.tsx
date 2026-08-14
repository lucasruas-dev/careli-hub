"use client";

import { useMemo, useState } from "react";

import type { CadDoPainel } from "@/lib/apolo/painel-coordenador";

import {
  C,
  GOLD,
  GradeKpis,
  Kpi,
  Selo,
  Tabela,
  TituloSecao,
  type Tom,
  celula,
  dataCurta,
  inputEstilo,
  moedaBR,
  useOrdenacao,
} from "./ui";

// ABA CAD — o funil de cadastros do empreendimento, fonte APOLO.
//
// É o dashboard que o Lucas já usava em /publico/cads, com uma diferença que muda tudo: antes os
// cards de cima vinham do Asana e os de baixo do Apolo, e as duas metades nunca fechavam entre si
// (o total dizia 860, a esteira tinha 659, e ninguém sabia qual dos dois estava certo). Agora a
// fonte é uma só, então TODO card é fatia do mesmo total e clicar nele abre exatamente as linhas
// que ele conta.
//
// O card "Duplicados" saiu junto com o Asana: era uma seção de lá, e a esteira do Apolo não tem
// esse estágio — a duplicidade hoje é barrada na entrada, por CPF dentro do empreendimento.

type Etapa = {
  chave: string;
  label: string;
  tom: Tom;
};

// Etapas da esteira (lib/apolo/esteira.ts) na ordem em que a CAD anda. `pago` não é etapa: é um
// corte transversal (quem tem `pago_em`), e por isso fica no fim, depois de Credenciado.
const ETAPAS: Etapa[] = [
  { chave: "validacao", label: "Validação", tom: "verdeEscuro" },
  { chave: "credito", label: "Análise de Crédito", tom: "roxo" },
  { chave: "revisao", label: "Crédito em Revisão", tom: "vermelho" },
  { chave: "prevenda", label: "Pré-Venda", tom: "azul" },
  { chave: "credenciado", label: "Credenciado", tom: "ciano" },
  { chave: "correcao", label: "CAD's Incorretas", tom: "ambar" },
  { chave: "indeferido", label: "Indeferido", tom: "laranja" },
];

const ETAPA_POR_CHAVE = new Map(ETAPAS.map((etapa) => [etapa.chave, etapa]));

function normaliza(valor: string): string {
  return valor
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();
}

function rotuloDaEtapa(etapa: null | string): Etapa {
  if (!etapa) return { chave: "sem_etapa", label: "Sem etapa", tom: "cinza" };
  return ETAPA_POR_CHAVE.get(etapa) ?? { chave: etapa, label: etapa, tom: "cinza" };
}

export function AbaCad({ cads }: { cads: CadDoPainel[] }) {
  const [filtro, setFiltro] = useState<string>("todas");
  const [imob, setImob] = useState<string>("todas");
  const [busca, setBusca] = useState<string>("");
  const [visao, setVisao] = useState<"kanban" | "lista">("lista");
  const [rankingAberto, setRankingAberto] = useState<boolean>(false);

  const imobiliarias = useMemo(
    () => [...new Set(cads.map((cad) => cad.imobiliaria ?? "Sem imobiliária"))].sort(),
    [cads],
  );

  // Base = tudo que passa nos filtros de texto. Os cards contam SOBRE ela, então filtrar por
  // imobiliária reescreve o funil inteiro daquela imobiliária — que é como o coordenador usa.
  const base = useMemo(
    () =>
      cads.filter(
        (cad) =>
          (imob === "todas" || (cad.imobiliaria ?? "Sem imobiliária") === imob) &&
          (busca === "" || normaliza(cad.cliente).includes(normaliza(busca))),
      ),
    [cads, imob, busca],
  );

  const contagem = useMemo(() => {
    const mapa: Record<string, number> = {};
    for (const cad of base) {
      const chave = rotuloDaEtapa(cad.etapa).chave;
      mapa[chave] = (mapa[chave] ?? 0) + 1;
    }
    return mapa;
  }, [base]);

  const pagos = useMemo(() => base.filter((cad) => Boolean(cad.pagoEm)), [base]);
  const valorPago = useMemo(() => pagos.reduce((total, cad) => total + cad.valorPago, 0), [pagos]);

  const mostrados = useMemo(() => {
    if (filtro === "todas") return base;
    if (filtro === "pago") return pagos;
    return base.filter((cad) => rotuloDaEtapa(cad.etapa).chave === filtro);
  }, [base, filtro, pagos]);

  // Ordenação da lista. O padrão é a CAD mais recente no topo — é como o coordenador acompanha o
  // que está chegando; ordenar por cliente ou imobiliária fica a um clique no cabeçalho.
  const { alternar, itens, ordem } = useOrdenacao<CadDoPainel>(
    mostrados,
    {
      cliente: (c) => c.cliente,
      data: (c) => c.criadoEm ?? "",
      etapa: (c) => rotuloDaEtapa(c.etapa).label,
      imobiliaria: (c) => c.imobiliaria ?? "",
    },
    { campo: "data", desc: true },
  );

  const ranking = useMemo(() => {
    const mapa: Record<string, number> = {};
    for (const cad of mostrados) {
      const nome = cad.imobiliaria ?? "Sem imobiliária";
      mapa[nome] = (mapa[nome] ?? 0) + 1;
    }
    return Object.entries(mapa).sort((a, b) => b[1] - a[1]);
  }, [mostrados]);

  const rankingMax = ranking[0]?.[1] ?? 1;
  const total = base.length;
  const pct = (valor: number) => `${total ? Math.round((valor / total) * 100) : 0}% do total`;
  const filtrando = filtro !== "todas" || imob !== "todas" || busca !== "";

  // Etapas sem nenhuma CAD ficam fora dos cards: um funil com quatro zeros no meio é mais difícil
  // de ler do que um funil curto. Elas voltam sozinhas quando a primeira CAD chegar.
  const etapasVisiveis = ETAPAS.filter((etapa) => (contagem[etapa.chave] ?? 0) > 0);
  const semEtapa = contagem.sem_etapa ?? 0;

  return (
    <>
      <GradeKpis>
        <Kpi
          ativo={filtro === "todas"}
          label="Recebidas"
          onClick={() => setFiltro("todas")}
          sub="total no Apolo"
          valor={total}
        />
        {etapasVisiveis.map((etapa) => (
          <Kpi
            ativo={filtro === etapa.chave}
            key={etapa.chave}
            label={etapa.label}
            onClick={() => setFiltro(filtro === etapa.chave ? "todas" : etapa.chave)}
            sub={pct(contagem[etapa.chave] ?? 0)}
            tom={etapa.tom}
            valor={contagem[etapa.chave] ?? 0}
          />
        ))}
        <Kpi
          ativo={filtro === "pago"}
          label="PIX Compensado"
          onClick={() => setFiltro(filtro === "pago" ? "todas" : "pago")}
          // % sobre os CREDENCIADOS, não sobre o total: é o que mede a conversão da pré-venda.
          sub={`${
            contagem.credenciado
              ? Math.round((pagos.length / contagem.credenciado) * 100)
              : 0
          }% dos credenciados · ${moedaBR(valorPago)}`}
          tom="verde"
          valor={pagos.length}
        />
        {semEtapa > 0 ? (
          <Kpi
            ativo={filtro === "sem_etapa"}
            label="Sem etapa"
            onClick={() => setFiltro(filtro === "sem_etapa" ? "todas" : "sem_etapa")}
            sub="precisa de triagem"
            valor={semEtapa}
          />
        ) : null}
      </GradeKpis>

      <div
        style={{
          alignItems: "center",
          display: "flex",
          flexWrap: "wrap",
          gap: 10,
          marginBottom: 22,
        }}
      >
        <input
          aria-label="Buscar cliente pelo nome"
          onChange={(evento) => setBusca(evento.target.value)}
          placeholder="Buscar cliente pelo nome"
          style={{ ...inputEstilo, flex: 1, minWidth: 180 }}
          value={busca}
        />
        <select
          aria-label="Filtrar por imobiliária"
          onChange={(evento) => setImob(evento.target.value)}
          style={{ ...inputEstilo, maxWidth: 240 }}
          value={imob}
        >
          <option value="todas">Todas as imobiliárias</option>
          {imobiliarias.map((nome) => (
            <option key={nome} value={nome}>
              {nome}
            </option>
          ))}
        </select>
        <button
          onClick={() => setRankingAberto(true)}
          style={{
            background: C.card,
            border: `1px solid ${C.border}`,
            borderRadius: 10,
            color: C.text,
            cursor: "pointer",
            fontSize: 13,
            fontWeight: 500,
            height: 38,
            padding: "0 14px",
            whiteSpace: "nowrap",
          }}
          type="button"
        >
          Ranking de imobiliárias ›
        </button>
        {filtrando ? (
          <button
            onClick={() => {
              setFiltro("todas");
              setImob("todas");
              setBusca("");
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
        acao={
          <div
            style={{
              border: `1px solid ${C.border}`,
              borderRadius: 10,
              display: "inline-flex",
              overflow: "hidden",
            }}
          >
            {(["lista", "kanban"] as const).map((modo) => (
              <button
                key={modo}
                onClick={() => setVisao(modo)}
                style={{
                  background: visao === modo ? C.soft : "transparent",
                  border: "none",
                  color: visao === modo ? C.text : C.sub,
                  cursor: "pointer",
                  fontSize: 13,
                  fontWeight: visao === modo ? 600 : 400,
                  height: 34,
                  padding: "0 14px",
                  textTransform: "capitalize",
                }}
                type="button"
              >
                {modo}
              </button>
            ))}
          </div>
        }
        contagem={`${mostrados.length} de ${cads.length}`}
        titulo="Cadastros"
      />

      {visao === "lista" ? (
        <Tabela
          colunas={[
            { campo: "data", chave: "Data", largura: 86 },
            { campo: "cliente", chave: "Cliente", largura: "32%" },
            { campo: "imobiliaria", chave: "Imobiliária" },
            { campo: "etapa", chave: "Etapa", largura: 160 },
          ]}
          onOrdenar={alternar}
          ordem={ordem}
          vazio="Nenhuma CAD com esses filtros."
        >
          {itens.map((cad, indice) => {
            const etapa = rotuloDaEtapa(cad.etapa);
            return (
              <tr key={`${cad.cliente}-${indice}`}>
                <td style={celula(C.sub)}>{dataCurta(cad.criadoEm)}</td>
                <td style={celula(C.text)}>{cad.cliente}</td>
                <td style={celula(C.sub)}>{cad.imobiliaria ?? "Sem imobiliária"}</td>
                <td style={celula(C.text, { overflow: "visible" })}>
                  <span style={{ alignItems: "center", display: "flex", gap: 6 }}>
                    <Selo tom={etapa.tom}>{etapa.label}</Selo>
                    {cad.pagoEm ? <Selo tom="verde">PIX</Selo> : null}
                  </span>
                </td>
              </tr>
            );
          })}
        </Tabela>
      ) : (
        <div style={{ display: "flex", gap: 12, overflowX: "auto", paddingBottom: 4 }}>
          {(filtro === "todas" ? etapasVisiveis : etapasVisiveis.filter((e) => e.chave === filtro))
            .map((etapa) => {
              const coluna = mostrados.filter(
                (cad) => rotuloDaEtapa(cad.etapa).chave === etapa.chave,
              );
              return (
                <div
                  key={etapa.chave}
                  style={{
                    background: C.soft,
                    borderRadius: 12,
                    flex: 1,
                    minWidth: 175,
                    padding: 11,
                  }}
                >
                  <div style={{ alignItems: "center", display: "flex", gap: 6, marginBottom: 10 }}>
                    <Selo tom={etapa.tom}>{etapa.label}</Selo>
                    <span style={{ color: C.muted, fontSize: 12 }}>{coluna.length}</span>
                  </div>
                  {coluna.length === 0 ? (
                    <div style={{ color: C.muted, fontSize: 12, padding: "6px 2px" }}>—</div>
                  ) : (
                    coluna.map((cad, indice) => (
                      <div
                        key={`${cad.cliente}-${indice}`}
                        style={{
                          background: C.card,
                          border: `1px solid ${C.border}`,
                          borderRadius: 10,
                          marginBottom: 8,
                          padding: "9px 11px",
                        }}
                      >
                        <div
                          style={{
                            fontSize: 13,
                            fontWeight: 500,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {cad.cliente}
                        </div>
                        <div
                          style={{
                            color: C.sub,
                            fontSize: 12,
                            marginTop: 3,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {cad.imobiliaria ?? "Sem imobiliária"}
                        </div>
                        <div style={{ color: C.muted, fontSize: 11.5, marginTop: 5 }}>
                          {dataCurta(cad.criadoEm)}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              );
            })}
        </div>
      )}

      {rankingAberto ? (
        <div
          onClick={() => setRankingAberto(false)}
          style={{
            alignItems: "center",
            background: "rgba(20,18,14,0.45)",
            display: "flex",
            inset: 0,
            justifyContent: "center",
            padding: 20,
            position: "fixed",
            zIndex: 50,
          }}
        >
          <div
            onClick={(evento) => evento.stopPropagation()}
            style={{
              background: C.card,
              border: `1px solid ${C.border}`,
              borderRadius: 16,
              maxHeight: "82vh",
              maxWidth: 540,
              overflow: "auto",
              padding: "22px 24px",
              width: "100%",
            }}
          >
            <div
              style={{
                alignItems: "center",
                display: "flex",
                justifyContent: "space-between",
                marginBottom: 4,
              }}
            >
              <h2 style={{ fontSize: 17, fontWeight: 600, margin: 0 }}>Ranking de imobiliárias</h2>
              <button
                aria-label="Fechar"
                onClick={() => setRankingAberto(false)}
                style={{
                  background: "transparent",
                  border: "none",
                  color: C.muted,
                  cursor: "pointer",
                  fontSize: 22,
                  lineHeight: 1,
                  padding: 0,
                }}
                type="button"
              >
                ×
              </button>
            </div>
            <p style={{ color: C.muted, fontSize: 12.5, margin: "0 0 14px" }}>
              {ranking.length} imobiliárias · {mostrados.length} CADs
              {filtrando ? " (com os filtros aplicados)" : ""}
            </p>
            {ranking.length === 0 ? (
              <p style={{ color: C.muted, fontSize: 13.5 }}>Nenhum resultado.</p>
            ) : (
              ranking.map(([nome, valor]) => (
                <div
                  key={nome}
                  style={{
                    alignItems: "center",
                    display: "grid",
                    fontSize: 13.5,
                    gap: 12,
                    gridTemplateColumns: "minmax(0, 220px) 1fr 34px",
                    margin: "10px 0",
                  }}
                >
                  <span
                    style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                  >
                    {nome}
                  </span>
                  <div
                    style={{ background: C.soft, borderRadius: 6, height: 20, overflow: "hidden" }}
                  >
                    <div
                      style={{
                        background: GOLD,
                        borderRadius: 6,
                        height: "100%",
                        width: `${Math.round((valor / rankingMax) * 100)}%`,
                      }}
                    />
                  </div>
                  <span style={{ fontWeight: 600, textAlign: "right" }}>{valor}</span>
                </div>
              ))
            )}
          </div>
        </div>
      ) : null}
    </>
  );
}
