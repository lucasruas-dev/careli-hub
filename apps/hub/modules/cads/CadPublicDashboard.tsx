"use client";

import { useMemo, useState } from "react";

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
// Fundo premium (cinza-quente à la Claude): página cinza, cards brancos pra "flutuar".
const C = {
  page: "#EDEBE4",
  card: "#FFFFFF",
  soft: "#E6E3DB",
  border: "#E0DDD3",
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

function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();
}

// Seção crua do Asana -> status canônico. Válidas primeiro (cobre "cadastrado/aprovado" antes
// de "cadastro"). "Recepção de CAD" e "Em cadastro" caem juntos em Em cadastro.
function canonical(etapa: string): Status {
  const n = normalize(etapa);

  if (n.includes("valid") || n.includes("cadastrad") || n.includes("aprovad")) {
    return { bg: "#E1F5EE", fg: "#0F6E56", key: "valida", label: "Válidas", order: 0 };
  }
  if (n.includes("reprov") || n.includes("recus") || n.includes("indefer")) {
    return { bg: "#FCEBEB", fg: "#A32D2D", key: "reprovada", label: "Reprovadas", order: 2 };
  }
  if (n.includes("duplic")) {
    return { bg: "#FAEEDA", fg: "#854F0B", key: "duplicada", label: "Duplicadas", order: 3 };
  }
  if (
    n.includes("recep") ||
    n.includes("cadastr") ||
    n.includes("andamento") ||
    n.includes("analise") ||
    n.includes("process")
  ) {
    return { bg: "#E6F1FB", fg: "#185FA5", key: "em_cadastro", label: "Em cadastro", order: 1 };
  }

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

export function CadPublicDashboard({
  empreendimento,
  records,
  disponivel,
}: {
  empreendimento: string;
  records: CadPublicItem[];
  disponivel: boolean;
}) {
  const [status, setStatus] = useState<string>("all");
  const [imob, setImob] = useState<string>("all");
  const [q, setQ] = useState<string>("");
  const [view, setView] = useState<"lista" | "kanban">("lista");
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

  const shown = useMemo(
    () => base.filter((item) => status === "all" || item.cs.key === status),
    [base, status],
  );

  const ranking = useMemo(() => {
    const map: Record<string, number> = {};
    for (const item of shown) map[item.imobiliaria] = (map[item.imobiliaria] ?? 0) + 1;

    return Object.entries(map).sort((a, b) => b[1] - a[1]);
  }, [shown]);

  const rankMax = ranking[0]?.[1] ?? 1;
  const filtersActive = status !== "all" || imob !== "all" || q !== "";

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
        {kpiCard("all", "Recebidas", base.length, "total", GOLD, C.text)}
        {statuses.map((cs) =>
          kpiCard(
            cs.key,
            cs.label,
            counts[cs.key] ?? 0,
            `${base.length ? Math.round(((counts[cs.key] ?? 0) / base.length) * 100) : 0}% do total`,
            cs.fg,
            cs.fg,
          ),
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
          {statuses.map((cs) => {
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
