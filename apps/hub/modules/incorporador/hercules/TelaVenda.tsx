"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Bookmark, FileSignature, FileText, Receipt, Signature } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import type { EtapaDoFluxo, FluxoDeVenda } from "@/lib/hercules/fluxo-de-venda";

import { T, useTemaDoPortal } from "../tema";
import { Pilula } from "./AssinaturasDoProduto";

// A TELA VENDA — onde o coordenador VENDE, e onde ele olha se está vendendo bem.
//
// Pedido do Lucas (03/09/2026): *"vamos criar a tela Venda, que vai ser a tela que vamos fazer o
// processo de reserva, proposta e emissão de contratos"*, com *"a parte indicadores (...) a ideia é
// mostrar o cenário comercial daquele ou daqueles empreendimentos"*, *"um dashboard (painel de
// gestão) rico focado em performance comercial"*, agilidade com *"simulador de proposta"* e *"ter o
// mapa na tela de vendas para que o coordenador possa ver visualmente o que está sendo vendido"*.
//
// ⚠️ OS DADOS SÃO DO PANTEON, NÃO DO C2X. Na mesma conversa: *"quero importar todos os dados do
// c2x, eles tem que existir dentro do panteon (...) e quero que hoje isso seja visto dentro do
// panteon"*. A carga trouxe 4.853 propostas e 12.269 movimentações de etapa
// (`scripts/hercules/importar-fluxo-de-venda.mjs`), e esta tela lê `/api/incorporador/venda` —
// Supabase, não o MySQL do legado. A tela antiga (`TelaVendas`) continua lendo o C2X e serve os
// portais de incorporador; quando eles migrarem, ela sai.
//
// ⚠️ A FAIXA DO FLUXO É A ESPINHA, e fica acima das duas visões. Reserva → Proposta → Contrato →
// Assinatura → Faturamento é o processo, e ele não muda quando o coordenador troca de visão: o que
// muda é o que ele faz com aquilo. Clicar numa etapa recorta a Mesa para ela.
//
// ⚠️ CANCELADO E DISTRATO NÃO SÃO PASSOS. São saídas do caminho, e vivem no quadro de perdas do
// Panorama — a régua está em `lib/hercules/fluxo-de-venda.ts`, com teste.
//
// ⚠️ O QUE AINDA NÃO EXISTE ESTÁ DITO NA TELA, não escondido atrás de um botão morto. Reservar e
// gerar proposta gravando no Panteon dependem da 0125 (reservas), ainda não aplicada.
//
// ⚠️ O ESTOQUE TEM DUAS VISTAS NO MESMO LUGAR: quadrados e mapa (Lucas, 03/09/2026: *"vamos dar a
// opção do usuário de selecionar se ele quer ver essa tela quadrados, ou mapa (...) não é para
// abrir uma tela nova, tem que aparecer aí mesmo"*). O masterplan é o desenho de verdade do
// loteamento; a grade é o quadro por quadra, que funciona em qualquer produto e não depende
// de haver mapa publicado. Antes disso o masterplan abria em tela cheia e tirava o coordenador da
// Mesa — perdia a lista, o painel e o simulador para olhar o mapa.
//
// ⚠️ E COM TODOS OS EMPREENDIMENTOS NÃO HÁ MAPA. Cada produto tem o seu; o consolidado não tem um
// desenho só. Nesse caso a opção nem aparece, em vez de aparecer e não fazer nada.

type Produto = {
  id: string;
  masterplanInterno: null | string;
  masterplanUrl: null | string;
  nome: string;
};

type UnidadeNoMapa = FluxoDeVenda["mapa"][number]["unidades"][number];
type Proposta = FluxoDeVenda["lista"][number];

/**
 * O que o painel da direita está mostrando.
 *
 * ⚠️ SÃO DUAS PORTAS PARA A MESMA COISA. Clicar no lote do mapa parte da UNIDADE (e a proposta,
 * se houver, é achada pelo id); clicar na linha da lista parte da PROPOSTA. Guardar só a proposta
 * deixaria o lote disponível sem nada para mostrar — e foi exatamente o que aconteceu: o Lucas
 * clicou nos lotes e a tela não reagiu.
 */
type Foco =
  | { proposta: Proposta; tipo: "proposta" }
  | { tipo: "unidade"; unidade: UnidadeNoMapa };

const FLUXO: ReadonlyArray<{ cor: string; etapa: EtapaDoFluxo; icone: LucideIcon; rotulo: string }> =
  [
    { cor: "#a07c3b", etapa: "reservado", icone: Bookmark, rotulo: "Reserva" },
    { cor: "#2f5d9e", etapa: "proposta", icone: FileText, rotulo: "Proposta" },
    { cor: "#6b5ea8", etapa: "contrato", icone: FileSignature, rotulo: "Contrato" },
    { cor: "#2f7d59", etapa: "assinatura", icone: Signature, rotulo: "Assinatura" },
    { cor: "#121722", etapa: "faturado", icone: Receipt, rotulo: "Faturamento" },
  ];

const COR_DA_SITUACAO: Record<string, string> = {
  bloqueada: "#e3a49c",
  disponivel: "var(--inc-soft)",
  reservada: "#e8c98a",
  vendida: "#86c3a4",
};

/** Cancelado e distrato não estão na faixa, mas aparecem no painel quando a unidade tem um. */
const ROTULO_TERMINAL: Record<string, string> = {
  cancelado: "Cancelada",
  distrato: "Distratada",
};

const ROTULO_DA_SITUACAO: Record<string, string> = {
  disponivel: "Disponível",
  reservada: "Reservada",
  vendida: "Vendida",
  bloqueada: "Bloqueada",
};

const dinheiro = (v: number) =>
  v >= 1_000_000
    ? `R$ ${(v / 1_000_000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mi`
    : `R$ ${Math.round(v).toLocaleString("pt-BR")}`;

const inteiro = (v: number) => v.toLocaleString("pt-BR");

const dia = (iso: null | string) => {
  if (!iso) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "—";
};

/**
 * As janelas do Panorama.
 *
 * ⚠️ A JANELA VALE PARA O DESEMPENHO, NUNCA PARA A FAIXA DO FLUXO. A faixa é o pipeline VIVO — "3
 * em assinatura" é verdade hoje, venha a proposta de que mês vier; filtrá-la faria a venda parada
 * desde julho desaparecer da tela em setembro, escondendo justamente o que precisa de atenção. A
 * régua está em `lib/hercules/fluxo-de-venda.ts`, com teste.
 */
const JANELAS: ReadonlyArray<{ id: string; meses: null | number; rotulo: string }> = [
  { id: "mes", meses: 1, rotulo: "Este mês" },
  { id: "3m", meses: 3, rotulo: "3 meses" },
  { id: "12m", meses: 12, rotulo: "12 meses" },
  { id: "tudo", meses: null, rotulo: "Tudo" },
];

/** A competência de N meses atrás, no formato AAAA-MM que a rota espera. */
function competenciaDe(mesesAtras: number): string {
  const hoje = new Date();
  const d = new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth() - mesesAtras, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const mesCurto = (mes: string) => {
  const [ano, m] = mes.split("-");
  return `${MESES[Number(m) - 1] ?? m}/${String(ano).slice(2)}`;
};

export function TelaVenda() {
  const [dados, setDados] = useState<FluxoDeVenda | null>(null);
  const [produtos, setProdutos] = useState<Produto[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<null | string>(null);

  const [emp, setEmp] = useState<string>("");
  const [visao, setVisao] = useState<"mesa" | "panorama">("mesa");
  const [etapa, setEtapa] = useState<EtapaDoFluxo>("reservado");
  const [foco, setFoco] = useState<null | Foco>(null);
  const [modoDoEstoque, setModoDoEstoque] = useState<"grade" | "mapa">("grade");
  // Abre em 12 meses: o mês corrente sozinho, no dia 3, mostraria quase nada.
  const [janela, setJanela] = useState<string>("12m");

  const carregar = useCallback(async (alvo: string, qualJanela: string) => {
    setCarregando(true);
    setErro(null);
    try {
      const busca = new URLSearchParams();
      if (alvo) busca.set("emp", alvo);
      const meses = JANELAS.find((j) => j.id === qualJanela)?.meses ?? null;
      if (meses) {
        // `de` é o começo da janela e `ate` é o mês corrente: um intervalo fechado, para o
        // servidor não precisar saber que dia é hoje.
        busca.set("de", competenciaDe(meses - 1));
        busca.set("ate", competenciaDe(0));
      }
      const sufixo = busca.toString() ? `?${busca}` : "";
      const r = await fetch(`/api/incorporador/venda${sufixo}`, { cache: "no-store" });
      const j = (await r.json().catch(() => null)) as null | { data?: FluxoDeVenda; error?: string };
      if (!r.ok || !j?.data) {
        setErro(j?.error ?? "Não foi possível carregar o fluxo de venda.");
        return;
      }
      setDados(j.data);
    } catch {
      setErro("Não foi possível carregar o fluxo de venda.");
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    void carregar(emp, janela);
  }, [carregar, emp, janela]);

  // A lista de produtos serve a duas coisas: o filtro e o botão do masterplan.
  useEffect(() => {
    let vivo = true;
    void (async () => {
      try {
        const r = await fetch("/api/incorporador/produtos", { cache: "no-store" });
        if (!r.ok) return;
        // ⚠️ O PAYLOAD É `{ data: { produtos } }`, e não a lista solta: eu li errado e a tela
        // quebrou com "produtos.filter is not a function" antes de desenhar qualquer coisa.
        const j = (await r.json()) as { data?: { produtos?: Produto[] } };
        if (vivo) setProdutos(j.data?.produtos ?? []);
      } catch {
        // Sem a lista, a tela mostra tudo e não oferece filtro. Ela não depende disso para viver.
      }
    })();
    return () => {
      vivo = false;
    };
  }, []);

  const daEtapa = useMemo(
    () => (dados?.lista ?? []).filter((l) => l.etapa === etapa),
    [dados, etapa],
  );

  // O mapa do PRODUTO ESCOLHIDO, e só dele: no consolidado não existe um masterplan único.
  const mapaDoProduto = useMemo(
    () => (emp ? (produtos.find((p) => p.id === emp && p.masterplanInterno) ?? null) : null),
    [emp, produtos],
  );

  // Trocar para "todos" (ou para um produto sem mapa) volta para a grade: deixar o modo
  // "mapa" aceso sem mapa para mostrar daria um painel vazio sem explicação.
  useEffect(() => {
    if (!mapaDoProduto) setModoDoEstoque("grade");
  }, [mapaDoProduto]);

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
          {/* A janela só muda o Panorama; na Mesa ela ficaria sem efeito e confundiria. */}
          {visao === "panorama" ? (
            <select
              aria-label="Período"
              onChange={(e) => setJanela(e.target.value)}
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
              value={janela}
            >
              {JANELAS.map((j) => (
                <option key={j.id} value={j.id}>
                  {j.rotulo}
                </option>
              ))}
            </select>
          ) : null}

          {produtos.length > 1 ? (
            <select
              aria-label="Empreendimento"
              onChange={(e) => {
                setEmp(e.target.value);
                setFoco(null);
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
              {produtos.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nome}
                </option>
              ))}
            </select>
          ) : null}
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
          const dado = dados?.fluxo.find((f) => f.etapa === passo.etapa);
          const ativo = etapa === passo.etapa;
          const Icone = passo.icone;
          return (
            <button
              key={passo.etapa}
              onClick={() => {
                setEtapa(passo.etapa);
                setFoco(null);
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
                {carregando ? "—" : inteiro(dado?.propostas ?? 0)}
              </div>
              <div
                style={{
                  color: T.muted,
                  fontSize: 11.5,
                  fontVariantNumeric: "tabular-nums",
                  marginTop: 3,
                }}
              >
                {carregando ? "carregando…" : dinheiro(dado?.vgv ?? 0)}
              </div>
            </button>
          );
        })}
      </div>

      {visao === "mesa" ? (
        <Mesa
          aoFocar={setFoco}
          aoTrocarModo={setModoDoEstoque}
          carregando={carregando}
          dados={dados}
          etapa={etapa}
          foco={foco}
          lista={daEtapa}
          mapaDoProduto={mapaDoProduto}
          modo={modoDoEstoque}
        />
      ) : (
        <Panorama dados={dados} />
      )}
    </div>
  );
}

// ── A MESA ──────────────────────────────────────────────────────────────────

function Mesa({
  aoFocar,
  aoTrocarModo,
  carregando,
  dados,
  etapa,
  foco,
  lista,
  mapaDoProduto,
  modo,
}: {
  aoFocar: (f: null | Foco) => void;
  aoTrocarModo: (m: "grade" | "mapa") => void;
  carregando: boolean;
  dados: FluxoDeVenda | null;
  etapa: EtapaDoFluxo;
  foco: null | Foco;
  lista: FluxoDeVenda["lista"];
  mapaDoProduto: null | Produto;
  modo: "grade" | "mapa";
}) {
  // O tema vai para o iframe do masterplan: outro documento não herda variável CSS de ninguém.
  const { efetivo } = useTemaDoPortal();
  const rotulo = FLUXO.find((f) => f.etapa === etapa)?.rotulo ?? "Propostas";
  const estoque = dados?.totais.estoque ?? {};
  // ⚠️ SÓ AS PRIMEIRAS QUADRAS. São 5.528 unidades no escopo inteiro: desenhar todas trava o
  // navegador e ninguém lê. Com um empreendimento escolhido, o mapa dele cabe inteiro.
  const grupos = (dados?.mapa ?? []).slice(0, 30);

  // O que o painel mostra. Vindo do mapa, a proposta é achada pelo id da unidade — a mais recente,
  // porque a lista já chega ordenada por `etapa_desde` decrescente.
  const unidadeEmFoco = foco?.tipo === "unidade" ? foco.unidade : null;
  const propostaEmFoco =
    foco?.tipo === "proposta"
      ? foco.proposta
      : unidadeEmFoco
        ? ((dados?.lista ?? []).find((l) => l.unidadeId === unidadeEmFoco.id) ?? null)
        : null;
  const idEmFoco = unidadeEmFoco?.id ?? propostaEmFoco?.unidadeId ?? null;

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
          direita={
            <div style={{ alignItems: "center", display: "flex", flexWrap: "wrap", gap: 12 }}>
              {modo === "grade"
                ? Object.entries(ROTULO_DA_SITUACAO).map(([chave, nome]) => (
                    <span
                      key={chave}
                      style={{
                        color: T.muted,
                        fontSize: 11.5,
                        fontWeight: 600,
                        whiteSpace: "nowrap",
                      }}
                    >
                      <i
                        style={{
                          background: COR_DA_SITUACAO[chave],
                          borderRadius: 3,
                          display: "inline-block",
                          height: 10,
                          marginRight: 5,
                          width: 10,
                        }}
                      />
                      {nome} {inteiro(estoque[chave] ?? 0)}
                    </span>
                  ))
                : null}

              {/* A escolha da vista. Só aparece com um produto que TEM masterplan. */}
              {mapaDoProduto ? (
                <div style={{ display: "flex", gap: 6 }}>
                  <Pilula
                    ativo={modo === "grade"}
                    onClick={() => aoTrocarModo("grade")}
                    rotulo="Grade"
                  />
                  <Pilula
                    ativo={modo === "mapa"}
                    onClick={() => aoTrocarModo("mapa")}
                    rotulo="Espelho"
                  />
                </div>
              ) : null}
            </div>
          }
          titulo="Estoque"
        >
          {/* ⚠️ O MASTERPLAN VIVE NUM <iframe> e não herda o tema: ele vai na query, como na tela
              cheia antiga. A altura é fixa porque o card está num grid — sem ela o iframe colapsa
              para zero e o mapa "não aparece". */}
          {modo === "mapa" && mapaDoProduto?.masterplanInterno ? (
            <iframe
              src={`/api/incorporador/masterplan?code=${encodeURIComponent(mapaDoProduto.masterplanInterno)}&tema=${efetivo}&so=espelho`}
              style={{
                background: T.soft,
                border: `1px solid ${T.border}`,
                borderRadius: 10,
                display: "block",
                height: "min(72vh, 720px)",
                width: "100%",
              }}
              title={`Espelho · ${mapaDoProduto.nome}`}
            />
          ) : (
            <>
              <div
                style={{
                  display: "grid",
                  gap: 14,
                  gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))",
                }}
              >
            {grupos.map((g) => (
              <div key={g.grupo}>
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
                  {g.grupo}
                </div>
                <div style={{ display: "grid", gap: 3, gridTemplateColumns: "repeat(6, 1fr)" }}>
                  {g.unidades.slice(0, 60).map((u) => (
                    <button
                      key={u.codigo}
                      onClick={() => aoFocar({ tipo: "unidade", unidade: u })}
                      style={{
                        aspectRatio: "1 / 1.25",
                        background: COR_DA_SITUACAO[u.situacao] ?? T.soft,
                        border: 0,
                        borderRadius: 3,
                        color: u.situacao === "disponivel" ? T.muted : "rgb(0 0 0 / .6)",
                        cursor: "pointer",
                        display: "grid",
                        font: "inherit",
                        fontSize: 8.5,
                        fontWeight: 600,
                        outline: idEmFoco === u.id ? `2.5px solid ${T.text}` : undefined,
                        outlineOffset: 1,
                        padding: 0,
                        placeItems: "center",
                      }}
                      title={`${u.codigo} · ${ROTULO_DA_SITUACAO[u.situacao] ?? u.situacao}`}
                      type="button"
                    >
                      {u.lote ?? ""}
                    </button>
                  ))}
                </div>
              </div>
            ))}
              </div>

              {!carregando && grupos.length === 0 ? (
                <p style={{ color: T.muted, fontSize: 13, margin: 0, textAlign: "center" }}>
                  Nenhuma unidade no recorte.
                </p>
              ) : null}
              {(dados?.mapa.length ?? 0) > 30 ? (
                <p style={{ color: T.muted, fontSize: 11.5, margin: "12px 0 0" }}>
                  Mostrando 30 de {inteiro(dados?.mapa.length ?? 0)} quadras. Escolha um
                  empreendimento no alto para ver o estoque inteiro dele.
                </p>
              ) : null}
            </>
          )}
        </Cartao>

        <Cartao titulo={`${rotulo} · ${inteiro(lista.length)}`}>
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
                {lista.slice(0, 150).map((l) => (
                  <tr
                    key={l.id}
                    onClick={() => aoFocar({ proposta: l, tipo: "proposta" })}
                    style={{
                      background: propostaEmFoco?.id === l.id ? T.soft : undefined,
                      cursor: "pointer",
                    }}
                  >
                    <td style={celula}>
                      <b>{l.unidade ?? "—"}</b>
                      <div style={{ color: T.muted, fontSize: 11.5 }}>{l.produto ?? ""}</div>
                    </td>
                    <td style={celula}>{l.cliente ?? "—"}</td>
                    <td style={celula}>{l.imobiliaria ?? "—"}</td>
                    <td style={{ ...celula, color: T.muted }}>{dia(l.desde)}</td>
                    <td
                      style={{ ...celula, fontVariantNumeric: "tabular-nums", textAlign: "right" }}
                    >
                      {l.valor ? dinheiro(l.valor) : "—"}
                    </td>
                  </tr>
                ))}
                {lista.length === 0 ? (
                  <tr>
                    <td colSpan={5} style={{ ...celula, color: T.muted, textAlign: "center" }}>
                      {carregando ? "Carregando…" : "Nenhuma proposta nesta etapa."}
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
          {lista.length > 150 ? (
            <p style={{ color: T.muted, fontSize: 11.5, margin: "12px 0 0" }}>
              Mostrando as 150 mais recentes de {inteiro(lista.length)}.
            </p>
          ) : null}
        </Cartao>
      </div>

      <div style={{ display: "grid", gap: 14 }}>
        <Cartao
          direita={
            unidadeEmFoco ? (
              <span
                style={{
                  background: COR_DA_SITUACAO[unidadeEmFoco.situacao] ?? T.soft,
                  borderRadius: 999,
                  color: "rgb(0 0 0 / .7)",
                  fontSize: 11,
                  fontWeight: 650,
                  padding: "2px 9px",
                }}
              >
                {ROTULO_DA_SITUACAO[unidadeEmFoco.situacao] ?? unidadeEmFoco.situacao}
              </span>
            ) : null
          }
          titulo={unidadeEmFoco?.codigo ?? propostaEmFoco?.unidade ?? "Nada escolhido"}
        >
          {unidadeEmFoco || propostaEmFoco ? (
            <>
              {unidadeEmFoco?.preco ? (
                <Linha rotulo="Valor de tabela" valor={dinheiro(unidadeEmFoco.preco)} />
              ) : null}
              {propostaEmFoco ? (
                <>
                  <Linha rotulo="Produto" valor={propostaEmFoco.produto ?? "—"} />
                  <Linha
                    rotulo="Etapa"
                    valor={
                      FLUXO.find((f) => f.etapa === propostaEmFoco.etapa)?.rotulo ??
                      ROTULO_TERMINAL[propostaEmFoco.etapa] ??
                      propostaEmFoco.etapa
                    }
                  />
                  <Linha rotulo="Desde" valor={dia(propostaEmFoco.desde)} />
                  <Linha
                    rotulo="Valor negociado"
                    valor={propostaEmFoco.valor ? dinheiro(propostaEmFoco.valor) : "—"}
                  />
                  <Linha rotulo="Cliente" valor={propostaEmFoco.cliente ?? "—"} />
                  <Linha rotulo="Imobiliária" valor={propostaEmFoco.imobiliaria ?? "—"} />
                  <Linha rotulo="Plano" valor={propostaEmFoco.plano ?? "—"} />
                </>
              ) : (
                // ⚠️ SEM PROPOSTA NÃO É ERRO: é lote livre, e o simulador abaixo já vem com o preço
                // dele. É o caminho normal de uma venda que vai começar.
                <p style={{ color: T.muted, fontSize: 12.5, margin: "8px 0 0" }}>
                  Nenhuma proposta nesta unidade. O simulador abaixo já está com o valor de tabela.
                </p>
              )}
            </>
          ) : (
            <p style={{ color: T.muted, fontSize: 13, margin: 0 }}>
              Clique num lote do mapa ou numa linha da lista.
            </p>
          )}
          <p style={{ color: T.muted, fontSize: 11.5, margin: "12px 0 0" }}>
            Reservar, gerar proposta e cancelar com motivo entram quando a tabela de reservas subir.
            Hoje esta tela lê o fluxo já importado e não grava.
          </p>
        </Cartao>

        <Simulador
          chave={unidadeEmFoco?.id ?? propostaEmFoco?.id ?? ""}
          valor={propostaEmFoco?.valor || (unidadeEmFoco?.preco ?? 0)}
        />
      </div>
    </div>
  );
}

// ── O SIMULADOR ─────────────────────────────────────────────────────────────
//
// Calcula aqui no navegador: é conta, não integração. O que ele ainda não faz é GRAVAR a proposta —
// e é isso que a frase no rodapé diz, para ninguém achar que emitiu.
function Simulador({ chave, valor }: { chave: string; valor: number }) {
  const [tabela, setTabela] = useState(0);
  const [desconto, setDesconto] = useState(0);
  const [entrada, setEntrada] = useState(0);
  const [parcelas, setParcelas] = useState(180);

  // ⚠️ A PROPOSTA ESCOLHIDA RECOMEÇA A SIMULAÇÃO. Sem depender da `chave`, quem digitasse um
  // desconto e clicasse em outra linha veria o valor novo com o desconto antigo — uma conta errada
  // com cara de certa.
  useEffect(() => {
    setTabela(valor);
    setEntrada(Math.round(valor * 0.1));
    setDesconto(0);
  }, [chave, valor]);

  const final = Math.max(0, tabela * (1 - desconto / 100));
  const financiado = Math.max(0, final - entrada);
  const mensal = parcelas > 0 ? financiado / parcelas : 0;

  const campo = (rotulo: string, v: number, aoMudar: (n: number) => void, sufixo?: string) => (
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

        <div style={{ background: T.soft, borderRadius: 9, padding: "10px 12px" }}>
          <Linha rotulo="Valor final" valor={dinheiro(final)} />
          <Linha rotulo="A financiar" valor={dinheiro(financiado)} />
          <Linha rotulo="Parcela mensal" valor={dinheiro(mensal)} />
        </div>

        <p style={{ color: T.muted, fontSize: 11.5, margin: 0 }}>
          Conta simples, sem correção nem juros: é a ordem de grandeza para responder ao cliente na
          hora. O plano comercial do empreendimento entra junto com a emissão da proposta.
        </p>
      </div>
    </Cartao>
  );
}

// ── O PANORAMA ──────────────────────────────────────────────────────────────

function Panorama({ dados }: { dados: FluxoDeVenda | null }) {
  if (!dados) {
    return (
      <Cartao titulo="Panorama">
        <p style={{ color: T.muted, fontSize: 13, margin: 0 }}>Carregando…</p>
      </Cartao>
    );
  }

  const faturadas = dados.fluxo.find((f) => f.etapa === "faturado")?.propostas ?? 0;
  const emAndamento = dados.fluxo
    .filter((f) => f.etapa !== "faturado")
    .reduce((a, f) => a + f.propostas, 0);
  const perdidas = dados.perdas.canceladas + dados.perdas.distratos;
  const decididas = faturadas + perdidas;
  const conversao = decididas > 0 ? (faturadas / decididas) * 100 : 0;
  const ticket = faturadas > 0 ? dados.totais.vgvFaturado / faturadas : 0;
  const comMotivo = dados.motivos.reduce((a, m) => a + m.n, 0);
  const maiorSerie = Math.max(1, ...dados.serie.map((s) => s.faturadas));
  const maiorFunil = Math.max(1, ...dados.fluxo.map((f) => f.propostas));

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <div
        style={{
          display: "grid",
          gap: 10,
          gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))",
        }}
      >
        <Kpi
          nota={`${inteiro(faturadas)} propostas`}
          rotulo="VGV faturado"
          valor={dinheiro(dados.totais.vgvFaturado)}
        />
        <Kpi nota="das propostas faturadas" rotulo="Ticket médio" valor={dinheiro(ticket)} />
        <Kpi
          nota="propostas vivas, fora do faturamento"
          rotulo="Em andamento"
          valor={inteiro(emAndamento)}
        />
        <Kpi
          nota={`${inteiro(faturadas)} de ${inteiro(decididas)} decididas`}
          rotulo="Conversão"
          valor={`${conversao.toFixed(0)}%`}
        />
        <Kpi
          nota={`${inteiro(dados.perdas.distratos)} distratos`}
          rotulo="Canceladas"
          valor={inteiro(dados.perdas.canceladas)}
        />
        <Kpi
          nota="que saiu do caminho"
          rotulo="VGV perdido"
          valor={dinheiro(dados.perdas.vgvCancelado)}
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
            {/* ⚠️ AS CADs SÃO OUTRA FONTE, e a barra diz isso na cor. CAD é cadastro (Apolo);
                reserva para baixo é venda (o fluxo importado do C2X). Pedido do Lucas: *"quantas
                cads foram geradas, quantas reservas, propostas"* — na mesma escada. Com todos os
                empreendimentos a esteira não recorta, e aí a CAD não aparece. */}
            {dados.cads
              ? [
                  { n: dados.cads.total, nota: `${inteiro(dados.cads.emCorrecao)} em correção`, rotulo: "CADs geradas" },
                  { n: dados.cads.credenciados, nota: `${inteiro(dados.cads.reprovadas)} reprovadas`, rotulo: "Credenciados" },
                ].map((c) => (
                  <div key={c.rotulo} style={{ display: "grid", gap: 4 }}>
                    <div style={{ display: "flex", fontSize: 12.5, justifyContent: "space-between" }}>
                      <span style={{ color: T.sub }}>{c.rotulo}</span>
                      <b style={{ fontVariantNumeric: "tabular-nums" }}>{inteiro(c.n)}</b>
                    </div>
                    <div style={{ background: T.soft, borderRadius: 5, height: 20, overflow: "hidden" }}>
                      <i
                        style={{
                          background: T.muted,
                          display: "block",
                          height: "100%",
                          width: `${Math.max(2, (c.n / Math.max(1, dados.cads!.total)) * 100)}%`,
                        }}
                      />
                    </div>
                    <span style={{ color: T.muted, fontSize: 11 }}>{c.nota}</span>
                  </div>
                ))
              : null}

            {dados.fluxo.map((f) => {
              const passo = FLUXO.find((x) => x.etapa === f.etapa);
              return (
                <div key={f.etapa} style={{ display: "grid", gap: 4 }}>
                  <div style={{ display: "flex", fontSize: 12.5, justifyContent: "space-between" }}>
                    <span style={{ color: T.sub }}>{passo?.rotulo ?? f.etapa}</span>
                    <b style={{ fontVariantNumeric: "tabular-nums" }}>{inteiro(f.propostas)}</b>
                  </div>
                  <div
                    style={{ background: T.soft, borderRadius: 5, height: 20, overflow: "hidden" }}
                  >
                    <i
                      style={{
                        background: passo?.cor ?? T.gold,
                        display: "block",
                        height: "100%",
                        width: `${Math.max(2, (f.propostas / maiorFunil) * 100)}%`,
                      }}
                    />
                  </div>
                  <span style={{ color: T.muted, fontSize: 11 }}>{dinheiro(f.vgv)}</span>
                </div>
              );
            })}
          </div>
          <p style={{ color: T.muted, fontSize: 11.5, margin: "12px 0 0" }}>
            {dados.periodo.de
              ? `Desempenho de ${mesCurto(dados.periodo.de)} a ${mesCurto(dados.periodo.ate ?? dados.periodo.de)}: ${inteiro(dados.periodo.propostasNoPeriodo)} propostas na janela.`
              : `${inteiro(dados.totais.propostas)} propostas no escopo, com o histórico inteiro desde 2023.`}{" "}
            As barras de reserva para baixo são o pipeline de HOJE, que a janela não filtra;{" "}
            {inteiro(perdidas)} saíram do caminho e não aparecem nelas.
          </p>
        </Cartao>

        <Cartao titulo="Quem está vendendo">
          {dados.ranking.length > 0 ? (
            <div style={{ margin: "-16px", overflowX: "auto" }}>
              <table style={{ borderCollapse: "collapse", fontSize: 13, width: "100%" }}>
                <thead>
                  <tr>
                    {["Imobiliária", "Propostas", "Vendidas", "VGV"].map((c, i) => (
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
                  {dados.ranking.slice(0, 10).map((r) => (
                    <tr key={r.imobiliaria}>
                      <td style={celula}>{r.imobiliaria}</td>
                      <td style={{ ...celula, textAlign: "right" }}>{inteiro(r.propostas)}</td>
                      <td style={{ ...celula, textAlign: "right" }}>{inteiro(r.vendidas)}</td>
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
            <p style={{ color: T.muted, fontSize: 13, margin: 0 }}>Sem imobiliária no recorte.</p>
          )}
        </Cartao>
      </div>

      <Cartao titulo="Mês a mês">
        {dados.serie.length > 0 ? (
          <div style={{ alignItems: "flex-end", display: "flex", gap: 8, minHeight: 140 }}>
            {dados.serie.slice(-18).map((s) => (
              <div key={s.mes} style={{ display: "grid", flex: 1, gap: 5, justifyItems: "center" }}>
                <b style={{ fontSize: 11, fontVariantNumeric: "tabular-nums" }}>{s.faturadas}</b>
                <div
                  style={{
                    background: T.gold,
                    borderRadius: "4px 4px 0 0",
                    height: `${Math.max(3, (s.faturadas / maiorSerie) * 100)}px`,
                    width: "100%",
                  }}
                  title={`${s.faturadas} faturadas · ${s.canceladas} canceladas`}
                />
                <div
                  style={{
                    background: T.danger,
                    borderRadius: "0 0 4px 4px",
                    height: `${Math.max(2, (s.canceladas / maiorSerie) * 40)}px`,
                    opacity: 0.55,
                    width: "100%",
                  }}
                />
                <span style={{ color: T.muted, fontSize: 10 }}>{mesCurto(s.mes)}</span>
              </div>
            ))}
          </div>
        ) : (
          <p style={{ color: T.muted, fontSize: 13, margin: 0 }}>Sem série no recorte.</p>
        )}
        <p style={{ color: T.muted, fontSize: 11.5, margin: "12px 0 0" }}>
          Dourado é faturamento; a barra vermelha embaixo é o que caiu no mesmo mês.
        </p>
      </Cartao>

      <Cartao titulo="Cancelamentos por motivo">
        {dados.motivos.length > 0 ? (
          <div style={{ display: "grid", gap: 8 }}>
            {dados.motivos.slice(0, 10).map((m) => (
              <div key={m.motivo} style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: T.sub, fontSize: 12.5 }}>{m.motivo}</span>
                <b style={{ fontSize: 12.5, fontVariantNumeric: "tabular-nums" }}>{m.n}</b>
              </div>
            ))}
          </div>
        ) : null}
        <p style={{ color: T.sub, fontSize: 13, margin: dados.motivos.length > 0 ? "12px 0 0" : 0 }}>
          De {inteiro(perdidas)} propostas que caíram, {inteiro(comMotivo)} têm motivo registrado. O
          legado tinha o campo e ele quase nunca foi preenchido; quando o cancelamento passar a
          acontecer aqui, o motivo vira obrigatório e este quadro deixa de ser um número solto.
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
        style={{ fontSize: 23, fontVariantNumeric: "tabular-nums", fontWeight: 650, marginTop: 6 }}
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
