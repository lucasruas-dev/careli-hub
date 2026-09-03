"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Bookmark, FileSignature, FileText, Map as MapaIcone, Receipt, Signature } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { TelaMasterplan } from "../TelaMasterplan";
import { T } from "../tema";
import { Pilula } from "./AssinaturasDoProduto";

// A TELA VENDA — onde o coordenador VENDE, e onde ele olha se está vendendo bem.
//
// Pedido do Lucas (03/09/2026): *"vamos criar a tela Venda, que vai ser a tela que vamos fazer o
// processo de reserva, proposta e emissão de contratos"*, com *"a parte indicadores (podemos
// colocar um nome melhor) — a ideia é mostrar o cenário comercial daquele ou daqueles
// empreendimentos"*, *"um dashboard (painel de gestão) rico focado em performance comercial"*, uma
// tela *"que o coordenador possa ter uma agilidade nessas vendas, simulador de proposta"* e *"ter o
// mapa na tela de vendas para que o coordenador possa ver visualmente o que está sendo vendido"*.
//
// ⚠️ A FAIXA DO FLUXO É A ESPINHA, e fica acima das duas visões. Reserva → Proposta → Contrato →
// Assinatura → Faturamento é o processo, e ele não muda quando o coordenador troca de visão: o que
// muda é o que ele faz com aquilo. Clicar numa etapa recorta a Mesa inteira para ela — é o mesmo
// gesto de apontar para a coluna do quadro e dizer "me mostra esses".
//
// ⚠️ OS NÚMEROS SÃO OS DO C2X, pela rota que a tela de Vendas já usava (/api/incorporador/vendas):
// nada aqui inventa um segundo total. O funil de CAD vem da rota do resumo do produto, que é a
// mesma da ficha. Duas fontes porque são dois assuntos — cadastro é do Apolo, unidade é do C2X —,
// e cada número da tela diz de qual dos dois veio.
//
// ⚠️ O QUE AINDA NÃO EXISTE ESTÁ DITO NA TELA, não escondido. Reservar, gerar proposta e cancelar
// com motivo dependem da tabela de reservas do Panteon (migration 0125, ainda não aplicada): até
// lá a Mesa MOSTRA o processo com dado real e o simulador calcula de verdade, mas não grava. Botão
// que não faz nada seria pior do que a frase que explica.

type Etapa = "assinatura" | "contrato" | "disponivel" | "faturado" | "proposta" | "reservado";

type Balde = "bloqueada" | "disponivel" | "negociacao" | "reservado" | "vendido";

type Unidade = {
  balde: Balde;
  bloco: null | string;
  comprador: null | string;
  desde: null | string;
  etapa: Etapa;
  imobiliaria: null | string;
  lote: null | string;
  situacao: string;
  unidade: string;
  valor: number;
};

type EmpreendimentoDaTela = { id: string; masterplan: null | string; nome: string };

type TallyBI = { un: number; vgv: number };

type DadosDaVenda = {
  bi?: null | {
    canceladas: TallyBI;
    cancelamentoPct: number;
    deadlineMedioDias: null | number;
    faturadas: TallyBI;
    propostas: TallyBI;
    ranking: { nome: string; unidades: number; vgv: number }[];
    serieMensal: { canceladas: TallyBI; faturadas: TallyBI; mes: string; propostas: TallyBI }[];
  };
  empreendimentos: EmpreendimentoDaTela[];
  recorte?: null | string[];
  resumo?: {
    perdas: { canceladas: number; distratos: number };
    total: { units: number; vgv: number };
    vendido: { units: number; vgv: number };
    vendidoPct: number;
  };
  unidades?: Unidade[];
};

/** O funil de CADASTRO, da mesma rota que a ficha do produto usa. */
type ProcessoDeCad = {
  cadsCorrecao: number;
  cadsEmAndamento: number;
  corretores: number;
  credenciados: number;
  imobiliariasHabilitadas: number;
};

// ── AS CINCO ETAPAS DO FLUXO ────────────────────────────────────────────────
//
// A ordem é a do processo, e cada uma sabe a cor da sua fase. `disponivel` não entra: estoque não é
// etapa de venda — ele é o que a Mesa oferece, e aparece no mapa.
const FLUXO: ReadonlyArray<{ cor: string; etapa: Etapa; icone: LucideIcon; rotulo: string }> = [
  { cor: "#a07c3b", etapa: "reservado", icone: Bookmark, rotulo: "Reserva" },
  { cor: "#2f5d9e", etapa: "proposta", icone: FileText, rotulo: "Proposta" },
  { cor: "#6b5ea8", etapa: "contrato", icone: FileSignature, rotulo: "Contrato" },
  { cor: "#2f7d59", etapa: "assinatura", icone: Signature, rotulo: "Assinatura" },
  { cor: "#121722", etapa: "faturado", icone: Receipt, rotulo: "Faturamento" },
];

const COR_DO_BALDE: Record<Balde, string> = {
  bloqueada: "#e3a49c",
  disponivel: "var(--inc-soft)",
  negociacao: "#9fc0ea",
  reservado: "#e8c98a",
  vendido: "#86c3a4",
};

const dinheiro = (v: number) =>
  v >= 1_000_000
    ? `R$ ${(v / 1_000_000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mi`
    : `R$ ${Math.round(v).toLocaleString("pt-BR")}`;

const inteiro = (v: number) => v.toLocaleString("pt-BR");

/** "Q07" de "Q07 L12" — o agrupamento do mapa quando a unidade não traz bloco. */
function grupoDaUnidade(u: Unidade): string {
  if (u.bloco) return u.bloco;
  const partes = u.unidade.trim().split(/\s+/);
  return partes.length > 1 ? partes[0]! : "Unidades";
}

export function TelaVenda() {
  const [dados, setDados] = useState<DadosDaVenda | null>(null);
  const [processo, setProcesso] = useState<null | ProcessoDeCad>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<null | string>(null);

  const [emp, setEmp] = useState<string>("");
  const [visao, setVisao] = useState<"mesa" | "panorama">("mesa");
  const [etapa, setEtapa] = useState<Etapa>("reservado");
  const [escolhida, setEscolhida] = useState<null | Unidade>(null);
  const [mapaAberto, setMapaAberto] = useState<null | EmpreendimentoDaTela>(null);

  const carregar = useCallback(async (alvo: string) => {
    setCarregando(true);
    setErro(null);
    const sufixo = alvo ? `?emp=${encodeURIComponent(alvo)}` : "";
    try {
      const r = await fetch(`/api/incorporador/vendas${sufixo}`, { cache: "no-store" });
      const j = (await r.json().catch(() => null)) as null | { data?: DadosDaVenda; error?: string };
      if (!r.ok || !j?.data) {
        setErro(j?.error ?? "Não foi possível carregar as vendas.");
        return;
      }
      setDados(j.data);
    } catch {
      setErro("Não foi possível carregar as vendas.");
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    void carregar(emp);
  }, [carregar, emp]);

  // O funil de CAD é de outra rota (Apolo), e só faz sentido com um produto escolhido: sem `emp`
  // ela responderia pelo escopo inteiro, e o número não casaria com o recorte das unidades.
  useEffect(() => {
    if (!emp) {
      setProcesso(null);
      return;
    }
    let vivo = true;
    void (async () => {
      try {
        const r = await fetch(`/api/incorporador/produto/resumo?emp=${encodeURIComponent(emp)}`, {
          cache: "no-store",
        });
        if (!r.ok) return;
        const j = (await r.json()) as { data?: { processo?: ProcessoDeCad } };
        if (vivo && j.data?.processo) setProcesso(j.data.processo);
      } catch {
        // O funil de cadastro é complemento: sem ele a tela continua inteira.
      }
    })();
    return () => {
      vivo = false;
    };
  }, [emp]);

  const unidades = useMemo(() => dados?.unidades ?? [], [dados]);

  /** Quantidade e VGV por etapa do fluxo — a faixa inteira sai daqui. */
  const porEtapa = useMemo(() => {
    const m = new Map<Etapa, { valor: number; unidades: Unidade[] }>();
    for (const u of unidades) {
      const atual = m.get(u.etapa) ?? { unidades: [], valor: 0 };
      atual.unidades.push(u);
      atual.valor += u.valor || 0;
      m.set(u.etapa, atual);
    }
    return m;
  }, [unidades]);

  const daEtapa = porEtapa.get(etapa)?.unidades ?? [];

  // O mapa: quadras (ou blocos) com as unidades pintadas pela situação.
  const quadras = useMemo(() => {
    const m = new Map<string, Unidade[]>();
    for (const u of unidades) {
      const g = grupoDaUnidade(u);
      const lista = m.get(g);
      if (lista) lista.push(u);
      else m.set(g, [u]);
    }
    return [...m.entries()]
      .sort((a, b) => a[0].localeCompare(b[0], "pt-BR", { numeric: true }))
      .slice(0, 40);
  }, [unidades]);

  const mapasDoRecorte = useMemo(() => {
    const lista = (dados?.empreendimentos ?? []).filter((e) => e.masterplan);
    if (!emp) return lista;
    const recorte = new Set(dados?.recorte ?? []);
    return lista.filter((e) => recorte.size === 0 || recorte.has(e.id));
  }, [dados, emp]);

  if (mapaAberto?.masterplan) {
    return (
      <TelaMasterplan
        code={mapaAberto.masterplan}
        nome={mapaAberto.nome}
        onVoltar={() => setMapaAberto(null)}
      />
    );
  }

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <header
        style={{
          alignItems: "flex-end",
          display: "flex",
          flexWrap: "wrap",
          gap: 12,
          justifyContent: "space-between",
        }}
      >
        <div>
          <h1 style={{ color: T.text, fontSize: 20, fontWeight: 600, margin: "0 0 4px" }}>Venda</h1>
          <p style={{ color: T.muted, fontSize: 13.5, margin: 0 }}>
            Da reserva ao faturamento, com o mapa do lado e o painel de gestão a um clique
          </p>
        </div>

        <div style={{ alignItems: "center", display: "flex", flexWrap: "wrap", gap: 8 }}>
          <Pilula ativo={visao === "mesa"} onClick={() => setVisao("mesa")} rotulo="Mesa" />
          <Pilula
            ativo={visao === "panorama"}
            onClick={() => setVisao("panorama")}
            rotulo="Panorama"
          />
          <select
            aria-label="Empreendimento"
            onChange={(e) => {
              setEmp(e.target.value);
              setEscolhida(null);
            }}
            style={{
              background: T.card,
              border: `1px solid ${T.border}`,
              borderRadius: 999,
              color: T.text,
              cursor: "pointer",
              fontSize: 13,
              fontWeight: 600,
              padding: "7px 12px",
            }}
            value={emp}
          >
            <option value="">Todos os empreendimentos</option>
            {(dados?.empreendimentos ?? []).map((e) => (
              <option key={e.id} value={e.id}>
                {e.nome}
              </option>
            ))}
          </select>
        </div>
      </header>

      {erro ? (
        <p
          style={{
            background: T.dangerBg,
            border: `1px solid ${T.danger}`,
            borderRadius: 10,
            color: T.danger,
            fontSize: 13.5,
            fontWeight: 600,
            margin: 0,
            padding: "10px 13px",
          }}
        >
          {erro}
        </p>
      ) : null}

      {/* ── A FAIXA DO FLUXO ─────────────────────────────────────────────── */}
      <div
        style={{
          display: "grid",
          gap: 8,
          gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
        }}
      >
        {FLUXO.map((passo) => {
          const dado = porEtapa.get(passo.etapa);
          const ativo = etapa === passo.etapa;
          const Icone = passo.icone;
          return (
            <button
              key={passo.etapa}
              onClick={() => {
                setEtapa(passo.etapa);
                setEscolhida(null);
                setVisao("mesa");
              }}
              style={{
                background: T.card,
                border: `1px solid ${T.border}`,
                borderLeft: `4px solid ${passo.cor}`,
                borderRadius: 12,
                color: T.text,
                cursor: "pointer",
                font: "inherit",
                outline: ativo ? `2px solid ${passo.cor}` : "none",
                outlineOffset: 1,
                padding: "12px 13px",
                textAlign: "left",
              }}
              type="button"
            >
              <span
                style={{
                  alignItems: "center",
                  color: T.muted,
                  display: "flex",
                  fontSize: 10.5,
                  fontWeight: 700,
                  gap: 6,
                  letterSpacing: ".07em",
                  textTransform: "uppercase",
                }}
              >
                <Icone aria-hidden="true" size={13} />
                {passo.rotulo}
              </span>
              <div
                style={{
                  fontSize: 25,
                  fontVariantNumeric: "tabular-nums",
                  fontWeight: 650,
                  lineHeight: 1.05,
                  marginTop: 7,
                }}
              >
                {carregando ? "—" : inteiro(dado?.unidades.length ?? 0)}
              </div>
              <div
                style={{
                  color: T.muted,
                  fontSize: 11.5,
                  fontVariantNumeric: "tabular-nums",
                  marginTop: 3,
                }}
              >
                {carregando ? "carregando…" : dinheiro(dado?.valor ?? 0)}
              </div>
            </button>
          );
        })}
      </div>

      {visao === "mesa" ? (
        <Mesa
          aoAbrirMapa={setMapaAberto}
          aoEscolher={setEscolhida}
          carregando={carregando}
          escolhida={escolhida}
          etapa={etapa}
          mapas={mapasDoRecorte}
          quadras={quadras}
          unidades={daEtapa}
        />
      ) : (
        <Panorama
          dados={dados}
          porEtapa={porEtapa}
          processo={processo}
          totalDeUnidades={unidades.length}
        />
      )}
    </div>
  );
}

// ── A MESA ──────────────────────────────────────────────────────────────────

function Mesa({
  aoAbrirMapa,
  aoEscolher,
  carregando,
  escolhida,
  etapa,
  mapas,
  quadras,
  unidades,
}: {
  aoAbrirMapa: (e: EmpreendimentoDaTela) => void;
  aoEscolher: (u: null | Unidade) => void;
  carregando: boolean;
  escolhida: null | Unidade;
  etapa: Etapa;
  mapas: EmpreendimentoDaTela[];
  quadras: [string, Unidade[]][];
  unidades: Unidade[];
}) {
  const rotulo = FLUXO.find((f) => f.etapa === etapa)?.rotulo ?? "Unidades";

  return (
    <div
      style={{
        alignItems: "start",
        display: "grid",
        gap: 14,
        gridTemplateColumns: "minmax(0, 1.35fr) minmax(300px, .65fr)",
      }}
    >
      <div style={{ display: "grid", gap: 14, minWidth: 0 }}>
        <Cartao
          titulo="Mapa do estoque"
          direita={
            <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
              {(
                [
                  ["disponivel", "Disponível"],
                  ["reservado", "Reservado"],
                  ["negociacao", "Em negociação"],
                  ["vendido", "Vendido"],
                  ["bloqueada", "Bloqueado"],
                ] as [Balde, string][]
              ).map(([b, nome]) => (
                <span
                  key={b}
                  style={{ color: T.muted, fontSize: 11.5, fontWeight: 600, whiteSpace: "nowrap" }}
                >
                  <i
                    style={{
                      background: COR_DO_BALDE[b],
                      borderRadius: 3,
                      display: "inline-block",
                      height: 10,
                      marginRight: 5,
                      width: 10,
                    }}
                  />
                  {nome}
                </span>
              ))}
            </div>
          }
        >
          {mapas.length > 0 ? (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
              {mapas.map((m) => (
                <button
                  key={m.id}
                  onClick={() => aoAbrirMapa(m)}
                  style={{
                    alignItems: "center",
                    background: T.soft,
                    border: `1px solid ${T.border}`,
                    borderRadius: 999,
                    color: T.text,
                    cursor: "pointer",
                    display: "inline-flex",
                    font: "inherit",
                    fontSize: 12.5,
                    fontWeight: 600,
                    gap: 6,
                    padding: "6px 12px",
                  }}
                  type="button"
                >
                  <MapaIcone aria-hidden="true" size={13} /> Masterplan · {m.nome}
                </button>
              ))}
            </div>
          ) : null}

          <div
            style={{
              display: "grid",
              gap: 14,
              gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))",
            }}
          >
            {quadras.map(([nome, lista]) => (
              <div key={nome}>
                <div
                  style={{
                    color: T.muted,
                    fontSize: 10.5,
                    fontWeight: 700,
                    letterSpacing: ".06em",
                    marginBottom: 5,
                    textTransform: "uppercase",
                  }}
                >
                  {nome}
                </div>
                <div style={{ display: "grid", gap: 3, gridTemplateColumns: "repeat(6, 1fr)" }}>
                  {lista.slice(0, 60).map((u) => (
                    <button
                      key={`${nome}-${u.unidade}`}
                      onClick={() => aoEscolher(u)}
                      style={{
                        aspectRatio: "1 / 1.25",
                        background: COR_DO_BALDE[u.balde],
                        border: 0,
                        borderRadius: 3,
                        color: u.balde === "disponivel" ? T.muted : "rgb(0 0 0 / .55)",
                        cursor: "pointer",
                        fontSize: 8.5,
                        fontWeight: 600,
                        outline:
                          escolhida?.unidade === u.unidade ? `2.5px solid ${T.text}` : undefined,
                        outlineOffset: 1,
                        padding: 0,
                      }}
                      title={`${u.unidade} · ${u.situacao}`}
                      type="button"
                    >
                      {u.lote ?? ""}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {!carregando && quadras.length === 0 ? (
            <p style={{ color: T.muted, fontSize: 13, margin: 0, padding: "20px 0", textAlign: "center" }}>
              Nenhuma unidade no recorte.
            </p>
          ) : null}
        </Cartao>

        <Cartao titulo={`${rotulo} · ${inteiro(unidades.length)}`}>
          <div style={{ margin: "-16px", overflowX: "auto" }}>
            <table style={{ borderCollapse: "collapse", fontSize: 13, width: "100%" }}>
              <thead>
                <tr>
                  {["Unidade", "Cliente", "Imobiliária", "Desde", "Valor"].map((c, i) => (
                    <th
                      key={c}
                      style={{
                        color: T.muted,
                        fontSize: 10.5,
                        fontWeight: 650,
                        letterSpacing: ".05em",
                        padding: "10px 12px",
                        textAlign: i === 4 ? "right" : "left",
                        textTransform: "uppercase",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {unidades.slice(0, 120).map((u) => (
                  <tr
                    key={u.unidade}
                    onClick={() => aoEscolher(u)}
                    style={{
                      background: escolhida?.unidade === u.unidade ? T.soft : undefined,
                      cursor: "pointer",
                    }}
                  >
                    <td style={celula}>
                      <b>{u.unidade}</b>
                    </td>
                    <td style={celula}>{u.comprador ?? "—"}</td>
                    <td style={celula}>{u.imobiliaria ?? "—"}</td>
                    <td style={{ ...celula, color: T.muted }}>{u.desde ?? "—"}</td>
                    <td style={{ ...celula, fontVariantNumeric: "tabular-nums", textAlign: "right" }}>
                      {u.valor ? dinheiro(u.valor) : "—"}
                    </td>
                  </tr>
                ))}
                {unidades.length === 0 ? (
                  <tr>
                    <td colSpan={5} style={{ ...celula, color: T.muted, textAlign: "center" }}>
                      {carregando ? "Carregando…" : "Nenhuma unidade nesta etapa."}
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
          {unidades.length > 120 ? (
            <p style={{ color: T.muted, fontSize: 11.5, margin: "12px 0 0" }}>
              Mostrando as 120 primeiras de {inteiro(unidades.length)}.
            </p>
          ) : null}
        </Cartao>
      </div>

      <div style={{ display: "grid", gap: 14 }}>
        <Cartao titulo={escolhida ? escolhida.unidade : "Nenhuma unidade escolhida"}>
          {escolhida ? (
            <>
              <Linha rotulo="Situação" valor={escolhida.situacao} />
              <Linha rotulo="Valor" valor={escolhida.valor ? dinheiro(escolhida.valor) : "—"} />
              <Linha rotulo="Cliente" valor={escolhida.comprador ?? "—"} />
              <Linha rotulo="Imobiliária" valor={escolhida.imobiliaria ?? "—"} />
              <Linha rotulo="Desde" valor={escolhida.desde ?? "—"} />
            </>
          ) : (
            <p style={{ color: T.muted, fontSize: 13, margin: 0 }}>
              Clique num lote do mapa ou numa linha da lista para ver a unidade aqui.
            </p>
          )}
          <p style={{ color: T.muted, fontSize: 11.5, margin: "12px 0 0" }}>
            Reservar, gerar proposta e cancelar com motivo entram quando a tabela de reservas do
            Panteon subir. Hoje esta tela lê o C2X e não grava nada.
          </p>
        </Cartao>

        <Simulador chave={escolhida?.unidade ?? ""} valor={escolhida?.valor ?? 0} />
      </div>
    </div>
  );
}

// ── O SIMULADOR ─────────────────────────────────────────────────────────────
//
// Calcula de verdade, aqui no navegador: é conta, não integração. O que ele ainda não faz é GRAVAR
// a proposta — e é isso que a frase no rodapé diz, para ninguém achar que emitiu.
function Simulador({ chave, valor }: { chave: string; valor: number }) {
  const [tabela, setTabela] = useState(0);
  const [desconto, setDesconto] = useState(0);
  const [entrada, setEntrada] = useState(0);
  const [parcelas, setParcelas] = useState(180);

  // ⚠️ A UNIDADE ESCOLHIDA RECOMEÇA A SIMULAÇÃO. Sem depender da `chave`, quem digitasse um
  // desconto e depois clicasse em outro lote veria o valor da unidade nova com o desconto da
  // anterior — uma proposta errada que parece certa. Trocou de unidade, o simulador zera.
  useEffect(() => {
    setTabela(valor);
    setEntrada(Math.round(valor * 0.1));
    setDesconto(0);
  }, [chave, valor]);

  const final = Math.max(0, tabela * (1 - desconto / 100));
  const financiado = Math.max(0, final - entrada);
  const mensal = parcelas > 0 ? financiado / parcelas : 0;

  const campo = (
    rotulo: string,
    v: number,
    aoMudar: (n: number) => void,
    sufixo?: string,
  ) => (
    <label style={{ display: "grid", gap: 3 }}>
      <span style={{ color: T.muted, fontSize: 11, fontWeight: 650 }}>{rotulo}</span>
      <span style={{ alignItems: "center", display: "flex", gap: 6 }}>
        <input
          onChange={(e) => aoMudar(Number(e.target.value) || 0)}
          style={{
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
          }}
          type="number"
          value={String(Math.round(v * 100) / 100)}
        />
        {sufixo ? <span style={{ color: T.muted, fontSize: 12 }}>{sufixo}</span> : null}
      </span>
    </label>
  );

  return (
    <Cartao titulo="Simulador de proposta">
      <div style={{ display: "grid", gap: 10 }}>
        <div style={{ display: "grid", gap: 9, gridTemplateColumns: "1fr 1fr" }}>
          {campo("Valor de tabela", tabela, setTabela)}
          {campo("Desconto", desconto, setDesconto, "%")}
          {campo("Entrada", entrada, setEntrada)}
          {campo("Parcelas", parcelas, setParcelas, "x")}
        </div>

        <div
          style={{
            background: "var(--inc-soft)",
            borderRadius: 9,
            marginTop: 2,
            padding: "10px 12px",
          }}
        >
          <Linha rotulo="Valor final" valor={dinheiro(final)} />
          <Linha rotulo="A financiar" valor={dinheiro(financiado)} />
          <Linha rotulo="Parcela mensal" valor={dinheiro(mensal)} />
        </div>

        <p style={{ color: T.muted, fontSize: 11.5, margin: 0 }}>
          Conta simples, sem correção nem juros: é a ordem de grandeza para responder ao cliente na
          hora. O cálculo do plano comercial (IPCA, juros, tabela do empreendimento) entra junto com
          a emissão da proposta.
        </p>
      </div>
    </Cartao>
  );
}

// ── O PANORAMA ──────────────────────────────────────────────────────────────

function Panorama({
  dados,
  porEtapa,
  processo,
  totalDeUnidades,
}: {
  dados: DadosDaVenda | null;
  porEtapa: Map<Etapa, { unidades: Unidade[]; valor: number }>;
  processo: null | ProcessoDeCad;
  totalDeUnidades: number;
}) {
  const bi = dados?.bi ?? null;
  const resumo = dados?.resumo;

  const contar = (e: Etapa) => porEtapa.get(e)?.unidades.length ?? 0;

  // O funil: cadastro (Apolo) e venda (C2X) na mesma escada, cada trecho dizendo de onde vem.
  const passos: { conversao: null | string; fonte: string; n: number; rotulo: string }[] = [
    ...(processo
      ? [
          {
            conversao: null,
            fonte: "cadastro",
            n: processo.cadsEmAndamento + processo.credenciados,
            rotulo: "CADs no produto",
          },
          {
            conversao: `${processo.cadsCorrecao} em correção`,
            fonte: "cadastro",
            n: processo.credenciados,
            rotulo: "Credenciados",
          },
        ]
      : []),
    { conversao: null, fonte: "venda", n: contar("reservado"), rotulo: "Reservas" },
    { conversao: null, fonte: "venda", n: contar("proposta"), rotulo: "Propostas" },
    { conversao: null, fonte: "venda", n: contar("contrato"), rotulo: "Contratos" },
    { conversao: null, fonte: "venda", n: contar("assinatura"), rotulo: "Em assinatura" },
    { conversao: null, fonte: "venda", n: contar("faturado"), rotulo: "Faturadas" },
  ];
  const maior = Math.max(1, ...passos.map((p) => p.n));

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <div
        style={{
          display: "grid",
          gap: 10,
          gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))",
        }}
      >
        <Kpi rotulo="VGV vendido" valor={dinheiro(resumo?.vendido.vgv ?? 0)} nota={`${inteiro(resumo?.vendido.units ?? 0)} unidades`} />
        <Kpi rotulo="Do estoque" valor={`${Math.round(resumo?.vendidoPct ?? 0)}%`} nota={`${inteiro(resumo?.total.units ?? totalDeUnidades)} unidades no total`} />
        <Kpi
          rotulo="Ticket médio"
          valor={dinheiro(
            (resumo?.vendido.units ?? 0) > 0
              ? (resumo?.vendido.vgv ?? 0) / (resumo?.vendido.units ?? 1)
              : 0,
          )}
          nota="das vendas faturadas"
        />
        <Kpi
          rotulo="Cancelamento"
          valor={bi ? `${Math.round(bi.cancelamentoPct)}%` : "—"}
          nota={bi ? `${inteiro(bi.canceladas.un)} canceladas` : "sem dado no período"}
        />
        <Kpi
          rotulo="Prazo médio"
          valor={bi?.deadlineMedioDias != null ? `${bi.deadlineMedioDias} dias` : "—"}
          nota="da proposta ao faturamento"
        />
        <Kpi
          rotulo="Distratos"
          valor={inteiro(resumo?.perdas.distratos ?? 0)}
          nota={`${inteiro(resumo?.perdas.canceladas ?? 0)} vendas canceladas`}
        />
      </div>

      <div
        style={{
          display: "grid",
          gap: 14,
          gridTemplateColumns: "repeat(auto-fit, minmax(330px, 1fr))",
        }}
      >
        <Cartao titulo="O funil">
          <div style={{ display: "grid", gap: 9 }}>
            {passos.map((p) => (
              <div key={p.rotulo} style={{ display: "grid", gap: 4 }}>
                <div style={{ display: "flex", fontSize: 12.5, justifyContent: "space-between" }}>
                  <span style={{ color: T.sub }}>{p.rotulo}</span>
                  <b style={{ fontVariantNumeric: "tabular-nums" }}>{inteiro(p.n)}</b>
                </div>
                <div style={{ background: T.soft, borderRadius: 5, height: 20, overflow: "hidden" }}>
                  <i
                    style={{
                      background: p.fonte === "cadastro" ? T.muted : T.gold,
                      display: "block",
                      height: "100%",
                      width: `${Math.max(2, (p.n / maior) * 100)}%`,
                    }}
                  />
                </div>
                {p.conversao ? (
                  <span style={{ color: T.muted, fontSize: 11 }}>{p.conversao}</span>
                ) : null}
              </div>
            ))}
          </div>
          <p style={{ color: T.muted, fontSize: 11.5, margin: "12px 0 0" }}>
            {processo
              ? "As duas primeiras barras são do cadastro (Apolo); as outras, das unidades no C2X."
              : "Escolha um empreendimento no alto para ver também as CADs e os credenciados."}
          </p>
        </Cartao>

        <Cartao titulo="Quem está vendendo">
          {bi && bi.ranking.length > 0 ? (
            <div style={{ margin: "-16px", overflowX: "auto" }}>
              <table style={{ borderCollapse: "collapse", fontSize: 13, width: "100%" }}>
                <thead>
                  <tr>
                    {["Imobiliária", "Unidades", "VGV"].map((c, i) => (
                      <th
                        key={c}
                        style={{
                          color: T.muted,
                          fontSize: 10.5,
                          fontWeight: 650,
                          padding: "10px 12px",
                          textAlign: i === 0 ? "left" : "right",
                          textTransform: "uppercase",
                        }}
                      >
                        {c}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {bi.ranking.slice(0, 8).map((r) => (
                    <tr key={r.nome}>
                      <td style={celula}>{r.nome}</td>
                      <td style={{ ...celula, textAlign: "right" }}>{inteiro(r.unidades)}</td>
                      <td
                        style={{
                          ...celula,
                          fontVariantNumeric: "tabular-nums",
                          textAlign: "right",
                        }}
                      >
                        {dinheiro(r.vgv)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p style={{ color: T.muted, fontSize: 13, margin: 0 }}>Sem ranking no período.</p>
          )}
        </Cartao>
      </div>

      <Cartao titulo="Mês a mês">
        {bi && bi.serieMensal.length > 0 ? (
          <div style={{ display: "flex", alignItems: "flex-end", gap: 10, minHeight: 130 }}>
            {bi.serieMensal.slice(-12).map((m) => {
              const teto = Math.max(1, ...bi.serieMensal.map((x) => x.faturadas.un));
              return (
                <div key={m.mes} style={{ display: "grid", flex: 1, gap: 5, justifyItems: "center" }}>
                  <b style={{ fontSize: 11.5, fontVariantNumeric: "tabular-nums" }}>
                    {m.faturadas.un}
                  </b>
                  <div
                    style={{
                      background: T.gold,
                      borderRadius: "4px 4px 0 0",
                      height: `${Math.max(3, (m.faturadas.un / teto) * 100)}px`,
                      width: "100%",
                    }}
                  />
                  <span style={{ color: T.muted, fontSize: 10.5 }}>{m.mes}</span>
                </div>
              );
            })}
          </div>
        ) : (
          <p style={{ color: T.muted, fontSize: 13, margin: 0 }}>Sem série no período.</p>
        )}
      </Cartao>

      <Cartao titulo="Cancelamentos por motivo">
        <p style={{ color: T.sub, fontSize: 13, margin: 0 }}>
          Hoje sabemos <b>quantas</b> foram canceladas ({inteiro(bi?.canceladas.un ?? 0)} propostas e{" "}
          {inteiro(resumo?.perdas.distratos ?? 0)} distratos), mas não <b>por quê</b>: o C2X não
          guarda o motivo. Quando a reserva e a proposta passarem a nascer aqui, o motivo vira campo
          obrigatório do cancelamento e este quadro deixa de ser um número solto.
        </p>
        <p style={{ color: T.muted, fontSize: 11.5, margin: "10px 0 0" }}>
          Preciso da sua lista de motivos: ela vira o que o coordenador escolhe, e mudar depois
          significa reclassificar o que já foi cancelado.
        </p>
      </Cartao>
    </div>
  );
}

// ── PEÇAS ───────────────────────────────────────────────────────────────────

const celula = {
  borderTop: `1px solid ${T.border}`,
  padding: "9px 12px",
} as const;

function Cartao({
  children,
  direita,
  titulo,
}: {
  children: React.ReactNode;
  direita?: React.ReactNode;
  titulo: string;
}) {
  return (
    <section
      style={{
        background: T.card,
        border: `1px solid ${T.border}`,
        borderRadius: 13,
        minWidth: 0,
      }}
    >
      <div
        style={{
          alignItems: "center",
          borderBottom: `1px solid ${T.border}`,
          display: "flex",
          flexWrap: "wrap",
          gap: 10,
          justifyContent: "space-between",
          padding: "13px 16px",
        }}
      >
        <h2 style={{ color: T.text, fontSize: 14, fontWeight: 650, margin: 0 }}>{titulo}</h2>
        {direita}
      </div>
      <div style={{ padding: 16 }}>{children}</div>
    </section>
  );
}

function Kpi({ nota, rotulo, valor }: { nota: string; rotulo: string; valor: string }) {
  return (
    <div
      style={{
        background: T.card,
        border: `1px solid ${T.border}`,
        borderRadius: 12,
        padding: "13px 14px",
      }}
    >
      <span
        style={{
          color: T.muted,
          fontSize: 10.5,
          fontWeight: 650,
          letterSpacing: ".07em",
          textTransform: "uppercase",
        }}
      >
        {rotulo}
      </span>
      <div
        style={{
          fontSize: 23,
          fontVariantNumeric: "tabular-nums",
          fontWeight: 650,
          marginTop: 6,
        }}
      >
        {valor}
      </div>
      <div style={{ color: T.muted, fontSize: 11.5, marginTop: 4 }}>{nota}</div>
    </div>
  );
}

function Linha({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div
      style={{
        borderTop: `1px dashed ${T.border}`,
        display: "flex",
        gap: 10,
        justifyContent: "space-between",
        padding: "6px 0",
      }}
    >
      <span style={{ color: T.sub, fontSize: 12.5 }}>{rotulo}</span>
      <b style={{ fontSize: 12.5, fontVariantNumeric: "tabular-nums", fontWeight: 650 }}>{valor}</b>
    </div>
  );
}
