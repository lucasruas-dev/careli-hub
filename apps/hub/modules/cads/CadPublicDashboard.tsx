"use client";

import { useMemo, useState } from "react";

import { usePersistedState } from "@/hooks/use-persisted-state";

// Dashboard PÚBLICO de CADs (cadastros de prospects, fonte Asana) de UM empreendimento.
// Sem chrome do HUB, sem login — recebe os registros já filtrados do server component.
// As SEÇÕES cruas do Asana são normalizadas em 4 status (Válidas / Em cadastro / Reprovadas /
// Duplicadas) — "Recepção de CAD" e "Em cadastro" contam como Em cadastro (pedido do Lucas).
// Cards clicáveis por status (com %), busca por nome + imobiliária, ranking num POPUP, e
// recepções em duas visões (lista/kanban). Tema claro, marca Careli. Ver mockup validado 6/jul.

export type CadPublicItem = {
  cliente: string;
  imobiliaria: string;
  etapa: string;
  criadoEm: string | null;
};

const GOLD = "#A97C50";
// Fundo premium branco-quente (à la Claude): página quase branca com leve calor; borda um
// pouco mais forte pra os cards seguirem definidos.
const C = {
  page: "#FBFAF5",
  card: "#FFFFFF",
  soft: "#F0EEE7",
  border: "#E9E6DD",
  text: "#1B1A16",
  sub: "#6C6A62",
  muted: "#9C988D",
};

type Status = { key: string; label: string; bg: string; fg: string; order: number };

const STATUS_UNKNOWN = (label: string): Status => ({
  bg: C.soft,
  fg: "#5F5E5A",
  key: "outros:" + label,
  label,
  order: 5,
});

// Status do funil cuja FONTE é o APOLO (não o Asana): Análise de Crédito, Crédito em Revisão,
// Pré-Venda, Credenciado e PIX Compensado. O canonical() do Asana reaproveita os três primeiros
// para rotular as recepções, mas o número dos cards e as listas desses estágios vêm do Apolo.
const STATUS_ANALISE_CREDITO: Status = {
  bg: "#EFE9FA",
  fg: "#5B3FA8",
  key: "analise_credito",
  label: "Análise de Crédito",
  order: 1,
};
const STATUS_CREDITO_REVISAO: Status = {
  bg: "#FCEBEB",
  fg: "#A32D2D",
  key: "credito_revisao",
  label: "Crédito em Revisão",
  order: 2,
};
const STATUS_PREVENDA: Status = {
  bg: "#E6F1FB",
  fg: "#185FA5",
  key: "prevenda",
  label: "Pré-Venda",
  order: 3,
};
const STATUS_CREDENCIADO: Status = {
  bg: "#E0F5F9",
  fg: "#0891B2",
  key: "credenciado",
  label: "Credenciado",
  order: 8,
};
const STATUS_PAGO: Status = {
  bg: "#E3F6EC",
  fg: "#0F9D58",
  key: "pago",
  label: "PIX Compensado",
  order: 9,
};

// status do card -> aparência da coluna, para os estágios cuja fonte é o Apolo. Serve pra saber se
// um card é "do Apolo" (a lista vem de apoloListas, não do `base` do Asana) e pra desenhar a coluna
// única no kanban quando esse card está selecionado.
const APOLO_STATUS: Record<string, Status> = {
  analise_credito: STATUS_ANALISE_CREDITO,
  credenciado: STATUS_CREDENCIADO,
  credito_revisao: STATUS_CREDITO_REVISAO,
  pago: STATUS_PAGO,
  prevenda: STATUS_PREVENDA,
};

function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();
}

// Seção crua do Asana -> ETAPA DO FUNIL. A ORDEM importa e é o que estava errado antes: "Análise
// de Documento" e "Análise de Crédito" caíam no mesmo balde ("Em cadastro"), inflando o card com
// 244 enquanto a seção "Em Cadastro" do Asana tinha ZERO. Agora o mais específico vem primeiro.
//
// Divisão de fontes (Lucas 25/jul): do ASANA só saem Validação, Duplicados e CAD's Incorretas; o
// resto do funil (Análise de Crédito, Crédito em Revisão, Pré-Venda, Credenciado, PIX) vem do
// APOLO. Por isso, no lado Asana, TODA seção que não é Duplicados/Incorretas conta como VALIDAÇÃO
// (é o CAD recebido, aguardando andar na esteira do Apolo) — inclusive as antigas "Análise de
// Crédito", "Crédito Reprovado", "Emissão Pix" e "Em cadastro". Assim Validação + Duplicados +
// Incorretas fecham EXATAMENTE o total "Recebidas", sem os 44 registros órfãos que caíam nos cards
// de crédito (que agora mostram o número do Apolo, não o do Asana).
function canonical(etapa: string): Status {
  const n = normalize(etapa);

  if (n.includes("duplic")) {
    return { bg: "#FAEEDA", fg: "#854F0B", key: "duplicados", label: "Duplicados", order: 6 };
  }
  // Só a seção EXATA "CADs Incorretas" — as "CADs Incorretas Resolvidas" já avançaram e caem no
  // STATUS_UNKNOWN (fora dos cards), como as demais seções resolvidas/avançadas. Pedido do Lucas 25/jul.
  if (n.includes("incorret") && !n.includes("resolv")) {
    return { bg: "#F5EFE3", fg: "#8A6A2F", key: "incorretas", label: "CAD's Incorretas", order: 7 };
  }
  // VALIDAÇÃO = as seções do Asana em que o CAD ainda está sendo PROCESSADO: Recepção de CAD,
  // Análise de Documento, Em Cadastro e Análise de Crédito (esta última no Asana é fila de espera,
  // não quer dizer que o crédito foi analisado — o crédito real é do Apolo). Pedido do Lucas 25/jul.
  if (
    n.includes("recep") ||
    n.includes("document") ||
    n.includes("cadastr") ||
    n.includes("valid") ||
    (n.includes("credito") && n.includes("analise"))
  ) {
    return { bg: "#E1F5EE", fg: "#0F6E56", key: "validacao", label: "Validação", order: 0 };
  }

  // Seções que JÁ avançaram no Asana (Crédito Reprovado, Emissão Pix, Finalizados/Credenciado):
  // não viram card aqui — o funil real desses estágios vem do Apolo. Ficam fora da Validação.
  return STATUS_UNKNOWN(etapa);
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";

  const date = new Date(iso);

  return Number.isNaN(date.getTime())
    ? "—"
    : date.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

type Item = CadPublicItem & { cs: Status };

// Números do funil que vêm do APOLO (a esteira real): Análise de Crédito, Crédito em Revisão,
// Pré-Venda, Credenciado e PIX Compensado. Recebidas/Validação/Duplicados/Incorretas seguem do
// Asana (contados em `counts`, não aqui).
export type CadApoloResumo = {
  analiseCredito: number;
  correcao: number;
  credenciados: number;
  creditoRevisao: number;
  pagos: number;
  prevenda: number;
  validacao: number;
  valorPago: number;
};

export type CadApoloListaItem = {
  cliente: string;
  data: string | null;
  imobiliaria: string | null;
};

export function CadPublicDashboard({
  apolo,
  apoloListas,
  empreendimento,
  records,
  disponivel,
}: {
  apolo?: CadApoloResumo | null;
  apoloListas?: {
    credenciados: CadApoloListaItem[];
    credito: CadApoloListaItem[];
    pagos: CadApoloListaItem[];
    prevenda: CadApoloListaItem[];
    revisao: CadApoloListaItem[];
  } | null;
  empreendimento: string;
  records: CadPublicItem[];
  disponivel: boolean;
}) {
  // Filtros/visão persistidos por empreendimento: reload/volta mantém o recorte.
  const cadScope = empreendimento.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const [status, setStatus] = usePersistedState<string>(
    `cads.${cadScope}.status`,
    "all",
  );
  const [imob, setImob] = usePersistedState<string>(
    `cads.${cadScope}.imob`,
    "all",
  );
  const [q, setQ] = usePersistedState<string>(`cads.${cadScope}.q`, "");
  const [view, setView] = usePersistedState<"lista" | "kanban">(
    `cads.${cadScope}.view`,
    "lista",
  );
  const [rankOpen, setRankOpen] = useState<boolean>(false);

  const items: Item[] = useMemo(
    () => records.map((record) => ({ ...record, cs: canonical(record.etapa) })),
    [records],
  );

  const statuses = useMemo(() => {
    const map = new Map<string, Status>();
    for (const item of items) {
      if (!map.has(item.cs.key)) map.set(item.cs.key, item.cs);
    }

    return [...map.values()].sort((a, b) => a.order - b.order || a.label.localeCompare(b.label));
  }, [items]);

  const imobs = useMemo(
    () => [...new Set(records.map((record) => record.imobiliaria))].sort(),
    [records],
  );

  const base = useMemo(
    () =>
      items.filter(
        (item) =>
          (imob === "all" || item.imobiliaria === imob) &&
          (q === "" || normalize(item.cliente).includes(normalize(q))),
      ),
    [items, imob, q],
  );

  const counts = useMemo(() => {
    const map: Record<string, number> = {};
    for (const item of base) map[item.cs.key] = (map[item.cs.key] ?? 0) + 1;

    return map;
  }, [base]);

  // Itens do FIM DO FUNIL (fonte Apolo). Viram Item como os do Asana, mas ficam FORA do `base` —
  // não entram no total "Recebidas" (que é do Asana) nem nos counts do funil. Só aparecem quando
  // o card deles é clicado. Respeitam os filtros de imobiliária e busca.
  const apoloItems = useMemo(() => {
    const toItem = (lista: CadApoloListaItem[] | undefined, cs: Status): Item[] =>
      (lista ?? []).map((l) => ({
        cliente: l.cliente,
        criadoEm: l.data,
        cs,
        etapa: cs.label,
        imobiliaria: l.imobiliaria?.trim() || "Sem imobiliária",
      }));

    // Chaveado pelo status do card, para o `shown` puxar a lista certa ao clicar. Estágios do meio
    // do funil (crédito/revisão/pré-venda) e do fim (credenciado/pago) — todos do Apolo.
    return {
      analise_credito: toItem(apoloListas?.credito, STATUS_ANALISE_CREDITO),
      credenciado: toItem(apoloListas?.credenciados, STATUS_CREDENCIADO),
      credito_revisao: toItem(apoloListas?.revisao, STATUS_CREDITO_REVISAO),
      pago: toItem(apoloListas?.pagos, STATUS_PAGO),
      prevenda: toItem(apoloListas?.prevenda, STATUS_PREVENDA),
    } as Record<string, Item[]>;
  }, [apoloListas]);

  const filtraApolo = (lista: Item[]) =>
    lista.filter(
      (item) =>
        (imob === "all" || item.imobiliaria === imob) &&
        (q === "" || normalize(item.cliente).includes(normalize(q))),
    );

  const shown = useMemo(() => {
    // Cards cuja fonte é o Apolo (crédito/revisão/pré-venda/credenciado/pago): a lista ao clicar
    // vem do Apolo, pro número do card bater com a lista. Os demais filtram o `base` (Asana).
    const daApolo = apoloItems[status];
    if (daApolo) return filtraApolo(daApolo);
    return base.filter((item) => status === "all" || item.cs.key === status);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base, status, apoloItems, imob, q]);

  const ranking = useMemo(() => {
    const map: Record<string, number> = {};
    for (const item of shown) map[item.imobiliaria] = (map[item.imobiliaria] ?? 0) + 1;

    return Object.entries(map).sort((a, b) => b[1] - a[1]);
  }, [shown]);

  const rankMax = ranking[0]?.[1] ?? 1;
  const filtersActive = status !== "all" || imob !== "all" || q !== "";
  // Coluna única do kanban quando o card selecionado é de um estágio do Apolo (senão, os do Asana).
  const apoloCol = APOLO_STATUS[status];

  const shell = (children: React.ReactNode) => (
    <main
      style={{
        background: C.page,
        color: C.text,
        minHeight: "100vh",
        padding: "28px 20px 64px",
        fontFamily:
          "'Inter', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
      }}
    >
      <div style={{ maxWidth: 980, margin: "0 auto", width: "100%" }}>{children}</div>
    </main>
  );

  const header = (
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "space-between",
        gap: 12,
        flexWrap: "wrap",
        marginBottom: 24,
      }}
    >
      <div>
        <p
          style={{
            margin: 0,
            fontSize: 12.5,
            letterSpacing: 0.4,
            textTransform: "uppercase",
            color: GOLD,
            fontWeight: 600,
          }}
        >
          Careli · Central de CADs
        </p>
        <h1 style={{ margin: "6px 0 0", fontSize: 26, fontWeight: 600 }}>
          {empreendimento}
        </h1>
        <p style={{ margin: "6px 0 0", fontSize: 14, color: C.sub }}>
          Cadastros de prospects recebidos dos corretores
        </p>
      </div>
      <span
        style={{
          background: "#E1F5EE",
          color: "#0F6E56",
          fontSize: 12,
          padding: "5px 12px",
          borderRadius: 999,
          fontWeight: 500,
          whiteSpace: "nowrap",
        }}
      >
        Atualizado agora
      </span>
    </div>
  );

  if (!disponivel) {
    return shell(
      <>
        {header}
        <div
          style={{
            background: C.card,
            border: `1px solid ${C.border}`,
            borderRadius: 14,
            padding: "40px 24px",
            textAlign: "center",
            color: C.sub,
          }}
        >
          Painel indisponível no momento. Tente novamente em instantes.
        </div>
      </>,
    );
  }

  const kpiCard = (
    key: string,
    label: string,
    value: number,
    sub: string,
    dot: string,
    fg: string,
  ) => {
    const active = status === key;

    return (
      <button
        key={key}
        type="button"
        onClick={() => setStatus(key === "all" || status === key ? "all" : key)}
        style={{
          textAlign: "left",
          cursor: "pointer",
          background: C.card,
          border: `1.5px solid ${active ? GOLD : C.border}`,
          borderRadius: 14,
          padding: "14px 16px",
          boxShadow: active ? `0 0 0 1px ${GOLD}` : "none",
        }}
      >
        <div
          style={{
            fontSize: 12.5,
            color: C.sub,
            display: "flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          <span
            style={{ width: 9, height: 9, borderRadius: 3, background: dot, display: "inline-block" }}
          />
          {label}
        </div>
        <div
          style={{
            fontSize: 26,
            fontWeight: 600,
            marginTop: 6,
            color: fg,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {value}
        </div>
        <div style={{ fontSize: 12, color: C.muted, marginTop: 5 }}>{sub}</div>
      </button>
    );
  };

  // Métricas dos cards. Validação vem SÓ do Asana (seções em processamento, contadas em `counts`) —
  // o 'validacao' do Apolo NÃO entra aqui (decisão do Lucas 25/jul). As de crédito/fim usam
  // `apolo?.X ?? 0` para entrarem mesmo fora do guard visual do bloco Apolo.
  const mValidacao = counts.validacao ?? 0;
  const mAnalise = apolo?.analiseCredito ?? 0;
  const mRevisao = apolo?.creditoRevisao ?? 0;
  const mPrevenda = apolo?.prevenda ?? 0;
  const mCredenciado = apolo?.credenciados ?? 0;
  const mDuplicados = counts.duplicados ?? 0;
  const mIncorretas = counts.incorretas ?? 0;
  const mPix = apolo?.pagos ?? 0;
  // Recebidas = total de CADs recebidas do Asana (base filtrada), como era antes. É também o
  // denominador das % "do total".
  const mRecebidas = base.length;

  const pctDoTotal = (valor: number) =>
    `${mRecebidas ? Math.round((valor / mRecebidas) * 100) : 0}%`;
  const pctDe = (valor: number, total: number) =>
    `${total ? Math.round((valor / total) * 100) : 0}%`;
  const moedaBR = (valor: number) =>
    `R$ ${valor.toLocaleString("pt-BR", { maximumFractionDigits: 2, minimumFractionDigits: 2 })}`;

  const inputStyle: React.CSSProperties = {
    height: 38,
    border: `1px solid ${C.border}`,
    borderRadius: 10,
    background: C.card,
    padding: "0 12px",
    fontSize: 13.5,
    color: C.text,
    maxWidth: "100%",
  };

  const rankingRows = (
    <>
      {ranking.length === 0 ? (
        <p style={{ fontSize: 13.5, color: C.muted }}>Nenhum resultado.</p>
      ) : (
        ranking.map(([name, value]) => (
          <div
            key={name}
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(0, 220px) 1fr 34px",
              alignItems: "center",
              gap: 12,
              margin: "10px 0",
              fontSize: 13.5,
            }}
          >
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {name}
            </span>
            <div style={{ height: 20, background: C.soft, borderRadius: 6, overflow: "hidden" }}>
              <div
                style={{
                  height: "100%",
                  width: `${Math.round((value / rankMax) * 100)}%`,
                  background: GOLD,
                  borderRadius: 6,
                }}
              />
            </div>
            <span style={{ textAlign: "right", fontWeight: 600 }}>{value}</span>
          </div>
        ))
      )}
    </>
  );

  return shell(
    <>
      {header}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
          gap: 12,
          marginBottom: 20,
        }}
      >
        {kpiCard("all", "Recebidas", mRecebidas, "total", GOLD, C.text)}

        {/* Validação = ASANA (seções em processamento) + APOLO (etapa 'validacao' da esteira). */}
        {kpiCard(
          "validacao",
          "Validação",
          mValidacao,
          `${pctDoTotal(mValidacao)} do total`,
          "#0F6E56",
          "#0F6E56",
        )}

        {/* FUNIL DE CRÉDITO + FIM — vem do APOLO (é onde a esteira anda). Clicáveis: o número é do
            Apolo e a lista, ao clicar, também (por isso batem). Se o Apolo não responder, o bloco
            inteiro some junto — melhor que mostrar zeros soltos sem Credenciado/PIX. */}
        {apolo ? (
          <>
            {kpiCard(
              "analise_credito",
              "Análise de Crédito",
              mAnalise,
              `${pctDoTotal(mAnalise)} do total`,
              "#5B3FA8",
              "#5B3FA8",
            )}
            {kpiCard(
              "credito_revisao",
              "Crédito em Revisão",
              mRevisao,
              // Régua (Lucas 25/jul): sobre quem PASSOU no crédito = credenciado + em revisão. Mede
              // quanto do que foi analisado ficou preso em revisão em vez de seguir pra credenciado.
              `${pctDe(apolo.creditoRevisao, apolo.credenciados + apolo.creditoRevisao)} do crédito analisado`,
              "#A32D2D",
              "#A32D2D",
            )}
            {kpiCard(
              "prevenda",
              "Pré-Venda",
              mPrevenda,
              `${pctDoTotal(mPrevenda)} do total`,
              "#185FA5",
              "#185FA5",
            )}
            {kpiCard(
              "credenciado",
              "Credenciado",
              mCredenciado,
              `${pctDoTotal(mCredenciado)} do total`,
              STATUS_CREDENCIADO.fg,
              STATUS_CREDENCIADO.fg,
            )}
            {kpiCard(
              "pago",
              "PIX Compensado",
              mPix,
              // % dos que já pagaram SOBRE OS CREDENCIADOS (pedido do Lucas), não sobre o total —
              // é o que mede a conversão da pré-venda. Mais o valor recebido.
              `${pctDe(apolo.pagos, apolo.credenciados)} dos credenciados · ${moedaBR(apolo.valorPago)}`,
              STATUS_PAGO.fg,
              STATUS_PAGO.fg,
            )}
          </>
        ) : null}

        {/* Refugo por último (pedido do Lucas 23/jul): Duplicados e Incorretas DEPOIS do PIX
            Compensado — não fazem parte do fluxo, então fecham a fileira. */}
        {kpiCard(
          "duplicados",
          "Duplicados",
          mDuplicados,
          `${pctDoTotal(mDuplicados)} do total`,
          "#854F0B",
          "#854F0B",
        )}
        {kpiCard(
          "incorretas",
          "CAD's Incorretas",
          mIncorretas,
          `${pctDoTotal(mIncorretas)} do total`,
          "#8A6A2F",
          "#8A6A2F",
        )}
      </div>

      <div
        style={{
          display: "flex",
          gap: 10,
          flexWrap: "wrap",
          alignItems: "center",
          marginBottom: 22,
        }}
      >
        <input
          value={q}
          onChange={(event) => setQ(event.target.value)}
          placeholder="Buscar cliente pelo nome"
          aria-label="Buscar cliente pelo nome"
          style={{ ...inputStyle, flex: 1, minWidth: 180 }}
        />
        <select
          value={imob}
          onChange={(event) => setImob(event.target.value)}
          aria-label="Filtrar por imobiliária"
          style={{ ...inputStyle, maxWidth: 240 }}
        >
          <option value="all">Todas as imobiliárias</option>
          {imobs.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => setRankOpen(true)}
          style={{
            height: 38,
            borderRadius: 10,
            border: `1px solid ${C.border}`,
            background: C.card,
            padding: "0 14px",
            fontSize: 13,
            color: C.text,
            cursor: "pointer",
            fontWeight: 500,
            whiteSpace: "nowrap",
          }}
        >
          Ranking de imobiliárias ›
        </button>
        {filtersActive && (
          <button
            type="button"
            onClick={() => {
              setStatus("all");
              setImob("all");
              setQ("");
            }}
            style={{
              height: 38,
              borderRadius: 10,
              border: `1px solid ${C.border}`,
              background: C.card,
              padding: "0 14px",
              fontSize: 13,
              color: C.sub,
              cursor: "pointer",
            }}
          >
            Limpar filtros
          </button>
        )}
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          flexWrap: "wrap",
          marginBottom: 14,
        }}
      >
        <h2 style={{ fontSize: 16, fontWeight: 600, margin: 0 }}>
          <span style={{ color: GOLD }}>Recepções</span>{" "}
          <span style={{ fontSize: 12.5, color: C.muted, fontWeight: 400 }}>
            · {shown.length} de {records.length}
          </span>
        </h2>
        <div
          style={{
            display: "inline-flex",
            border: `1px solid ${C.border}`,
            borderRadius: 10,
            overflow: "hidden",
          }}
        >
          {(["lista", "kanban"] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => setView(mode)}
              style={{
                height: 34,
                padding: "0 14px",
                border: "none",
                cursor: "pointer",
                fontSize: 13,
                background: view === mode ? C.soft : "transparent",
                color: view === mode ? C.text : C.sub,
                fontWeight: view === mode ? 600 : 400,
                textTransform: "capitalize",
              }}
            >
              {mode}
            </button>
          ))}
        </div>
      </div>

      {view === "lista" ? (
        <div
          style={{
            background: C.card,
            border: `1px solid ${C.border}`,
            borderRadius: 12,
            overflow: "hidden",
          }}
        >
          <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}>
            <colgroup>
              <col style={{ width: 68 }} />
              <col style={{ width: "34%" }} />
              <col />
              <col style={{ width: 130 }} />
            </colgroup>
            <thead>
              <tr>
                {["Data", "Cliente", "Imobiliária", "Status"].map((head) => (
                  <th
                    key={head}
                    style={{
                      textAlign: "left",
                      padding: "10px 12px",
                      fontSize: 12,
                      fontWeight: 500,
                      color: C.muted,
                      borderBottom: `1px solid ${C.border}`,
                    }}
                  >
                    {head}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.length === 0 ? (
                <tr>
                  <td
                    colSpan={4}
                    style={{ padding: "22px", textAlign: "center", color: C.muted, fontSize: 13.5 }}
                  >
                    Nenhuma recepção com esses filtros.
                  </td>
                </tr>
              ) : (
                shown.map((item, index) => (
                  <tr key={`${item.cliente}-${index}`}>
                    <td style={cellStyle(C.sub)}>{formatDate(item.criadoEm)}</td>
                    <td style={cellStyle(C.text)}>{item.cliente}</td>
                    <td style={cellStyle(C.sub)}>{item.imobiliaria}</td>
                    <td style={{ ...cellStyle(C.text), overflow: "visible" }}>
                      <span
                        style={{
                          background: item.cs.bg,
                          color: item.cs.fg,
                          fontSize: 12,
                          padding: "3px 9px",
                          borderRadius: 999,
                          whiteSpace: "nowrap",
                        }}
                      >
                        {item.cs.label}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      ) : (
        <div style={{ display: "flex", gap: 12, overflowX: "auto", paddingBottom: 4 }}>
          {(apoloCol ? [apoloCol] : statuses).map((cs) => {
            const column = shown.filter((item) => item.cs.key === cs.key);

            return (
              <div
                key={cs.key}
                style={{
                  flex: 1,
                  minWidth: 175,
                  background: C.soft,
                  borderRadius: 12,
                  padding: 11,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10 }}>
                  <span
                    style={{
                      background: cs.bg,
                      color: cs.fg,
                      fontSize: 12,
                      padding: "3px 9px",
                      borderRadius: 999,
                    }}
                  >
                    {cs.label}
                  </span>
                  <span style={{ color: C.muted, fontSize: 12 }}>{column.length}</span>
                </div>
                {column.length === 0 ? (
                  <div style={{ fontSize: 12, color: C.muted, padding: "6px 2px" }}>—</div>
                ) : (
                  column.map((item, index) => (
                    <div
                      key={`${item.cliente}-${index}`}
                      style={{
                        background: C.card,
                        border: `1px solid ${C.border}`,
                        borderRadius: 10,
                        padding: "9px 11px",
                        marginBottom: 8,
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
                        {item.cliente}
                      </div>
                      <div
                        style={{
                          fontSize: 12,
                          color: C.sub,
                          marginTop: 3,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {item.imobiliaria}
                      </div>
                      <div style={{ fontSize: 11.5, color: C.muted, marginTop: 5 }}>
                        {formatDate(item.criadoEm)}
                      </div>
                    </div>
                  ))
                )}
              </div>
            );
          })}
        </div>
      )}

      <p style={{ fontSize: 12, color: C.muted, marginTop: 28, textAlign: "center" }}>
        Careli · dados da Central de CADs · atualiza automaticamente
      </p>

      {rankOpen && (
        <div
          onClick={() => setRankOpen(false)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(20,18,14,0.45)",
            zIndex: 50,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 20,
          }}
        >
          <div
            onClick={(event) => event.stopPropagation()}
            style={{
              background: C.card,
              borderRadius: 16,
              border: `1px solid ${C.border}`,
              maxWidth: 540,
              width: "100%",
              maxHeight: "82vh",
              overflow: "auto",
              padding: "22px 24px",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: 4,
              }}
            >
              <h2 style={{ margin: 0, fontSize: 17, fontWeight: 600 }}>
                Ranking de imobiliárias
              </h2>
              <button
                type="button"
                onClick={() => setRankOpen(false)}
                aria-label="Fechar"
                style={{
                  border: "none",
                  background: "transparent",
                  fontSize: 22,
                  lineHeight: 1,
                  color: C.muted,
                  cursor: "pointer",
                  padding: 0,
                }}
              >
                ×
              </button>
            </div>
            <p style={{ margin: "0 0 14px", fontSize: 12.5, color: C.muted }}>
              {ranking.length} imobiliárias · {shown.length} CADs
              {filtersActive ? " (com os filtros aplicados)" : ""}
            </p>
            {rankingRows}
          </div>
        </div>
      )}
    </>,
  );
}

function cellStyle(color: string): React.CSSProperties {
  return {
    textAlign: "left",
    padding: "10px 12px",
    fontSize: 13.5,
    color,
    borderBottom: `1px solid ${C.border}`,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  };
}
