"use client";

import { useMemo, useState } from "react";

// Dashboard PÚBLICO de CADs (cadastros de prospects, fonte Asana) de UM empreendimento.
// Sem chrome do HUB, sem login — recebe os registros já filtrados do server component.
// Cards clicáveis por etapa (com %), busca por nome + imobiliária, ranking em largura cheia,
// recepções em duas visões (lista/kanban). Tema claro, marca Careli. Ver mockup validado 6/jul.

export type CadPublicItem = {
  cliente: string;
  imobiliaria: string;
  etapa: string;
  criadoEm: string | null;
};

const GOLD = "#A97C50";
const C = {
  page: "#F7F6F2",
  card: "#FFFFFF",
  soft: "#F1EFE9",
  border: "#E7E3DA",
  text: "#1B1A16",
  sub: "#6C6A62",
  muted: "#9C988D",
};

type Tone = { bg: string; fg: string };

function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();
}

function toneFor(etapa: string): Tone {
  const n = normalize(etapa);

  if (n.includes("valid")) return { bg: "#E1F5EE", fg: "#0F6E56" };
  if (n.includes("reprov") || n.includes("recus"))
    return { bg: "#FCEBEB", fg: "#A32D2D" };
  if (n.includes("duplic")) return { bg: "#FAEEDA", fg: "#854F0B" };
  if (n.includes("cadastr") || n.includes("andamento") || n.includes("process"))
    return { bg: "#E6F1FB", fg: "#185FA5" };

  return { bg: C.soft, fg: "#5F5E5A" };
}

function orderKey(etapa: string): number {
  const n = normalize(etapa);

  if (n.includes("valid")) return 0;
  if (n.includes("cadastr") || n.includes("andamento")) return 1;
  if (n.includes("reprov") || n.includes("recus")) return 2;
  if (n.includes("duplic")) return 3;

  return 4;
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";

  const date = new Date(iso);

  return Number.isNaN(date.getTime())
    ? "—"
    : date.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

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

  const etapas = useMemo(() => {
    const seen = new Map<string, number>();
    for (const record of records) {
      seen.set(record.etapa, (seen.get(record.etapa) ?? 0) + 1);
    }

    return [...seen.keys()].sort(
      (a, b) => orderKey(a) - orderKey(b) || (seen.get(b) ?? 0) - (seen.get(a) ?? 0),
    );
  }, [records]);

  const imobs = useMemo(
    () => [...new Set(records.map((record) => record.imobiliaria))].sort(),
    [records],
  );

  const base = useMemo(
    () =>
      records.filter(
        (record) =>
          (imob === "all" || record.imobiliaria === imob) &&
          (q === "" || normalize(record.cliente).includes(normalize(q))),
      ),
    [records, imob, q],
  );

  const counts = useMemo(() => {
    const map: Record<string, number> = {};
    for (const record of base) {
      map[record.etapa] = (map[record.etapa] ?? 0) + 1;
    }

    return map;
  }, [base]);

  const shown = useMemo(
    () => base.filter((record) => status === "all" || record.etapa === status),
    [base, status],
  );

  const ranking = useMemo(() => {
    const map: Record<string, number> = {};
    for (const record of shown) {
      map[record.imobiliaria] = (map[record.imobiliaria] ?? 0) + 1;
    }

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
      <div style={{ maxWidth: 1080, margin: "0 auto" }}>{children}</div>
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
    tone: Tone | null,
  ) => {
    const active = status === key;

    return (
      <button
        key={key}
        type="button"
        onClick={() =>
          setStatus(key === "all" || status === key ? "all" : key)
        }
        style={{
          textAlign: "left",
          cursor: "pointer",
          background: C.card,
          border: `1.5px solid ${active ? GOLD : C.border}`,
          borderRadius: 14,
          padding: "14px 16px",
          transition: "border-color .12s",
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
            style={{
              width: 9,
              height: 9,
              borderRadius: 3,
              background: tone ? tone.fg : GOLD,
              display: "inline-block",
            }}
          />
          {label}
        </div>
        <div
          style={{
            fontSize: 26,
            fontWeight: 600,
            marginTop: 6,
            color: tone ? tone.fg : C.text,
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
  };

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
        {kpiCard("all", "Recebidas", base.length, "total", null)}
        {etapas.map((etapa) =>
          kpiCard(
            etapa,
            etapa,
            counts[etapa] ?? 0,
            `${base.length ? Math.round(((counts[etapa] ?? 0) / base.length) * 100) : 0}% do total`,
            toneFor(etapa),
          ),
        )}
      </div>

      <div
        style={{
          display: "flex",
          gap: 10,
          flexWrap: "wrap",
          alignItems: "center",
          marginBottom: 28,
        }}
      >
        <input
          value={q}
          onChange={(event) => setQ(event.target.value)}
          placeholder="Buscar cliente pelo nome"
          aria-label="Buscar cliente pelo nome"
          style={{ ...inputStyle, flex: 1, minWidth: 200 }}
        />
        <select
          value={imob}
          onChange={(event) => setImob(event.target.value)}
          aria-label="Filtrar por imobiliária"
          style={inputStyle}
        >
          <option value="all">Todas as imobiliárias</option>
          {imobs.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
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

      <h2
        style={{
          fontSize: 16,
          fontWeight: 600,
          margin: "0 0 14px",
          display: "flex",
          alignItems: "center",
          gap: 7,
        }}
      >
        <span style={{ color: GOLD }}>Ranking de imobiliárias</span>
      </h2>
      <div style={{ marginBottom: 32 }}>
        {ranking.length === 0 ? (
          <p style={{ fontSize: 13.5, color: C.muted }}>Nenhum resultado.</p>
        ) : (
          ranking.map(([name, value]) => (
            <div
              key={name}
              style={{
                display: "grid",
                gridTemplateColumns: "minmax(120px, 200px) 1fr 34px",
                alignItems: "center",
                gap: 12,
                margin: "10px 0",
                fontSize: 13.5,
              }}
            >
              <span
                style={{
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {name}
              </span>
              <div
                style={{
                  height: 22,
                  background: C.soft,
                  borderRadius: 6,
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    height: "100%",
                    width: `${Math.round((value / rankMax) * 100)}%`,
                    background: GOLD,
                    borderRadius: 6,
                  }}
                />
              </div>
              <span style={{ textAlign: "right", fontWeight: 600 }}>
                {value}
              </span>
            </div>
          ))
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
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              tableLayout: "fixed",
            }}
          >
            <colgroup>
              <col style={{ width: 74 }} />
              <col />
              <col style={{ width: "32%" }} />
              <col style={{ width: 118 }} />
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
                    style={{
                      padding: "22px",
                      textAlign: "center",
                      color: C.muted,
                      fontSize: 13.5,
                    }}
                  >
                    Nenhuma recepção com esses filtros.
                  </td>
                </tr>
              ) : (
                shown.map((record, index) => {
                  const tone = toneFor(record.etapa);

                  return (
                    <tr key={`${record.cliente}-${index}`}>
                      <td style={cellStyle(C.sub)}>{formatDate(record.criadoEm)}</td>
                      <td style={cellStyle(C.text)}>{record.cliente}</td>
                      <td style={cellStyle(C.sub)}>{record.imobiliaria}</td>
                      <td style={{ ...cellStyle(C.text), overflow: "visible" }}>
                        <span
                          style={{
                            background: tone.bg,
                            color: tone.fg,
                            fontSize: 12,
                            padding: "3px 9px",
                            borderRadius: 999,
                            whiteSpace: "nowrap",
                          }}
                        >
                          {record.etapa}
                        </span>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      ) : (
        <div
          style={{
            display: "flex",
            gap: 12,
            overflowX: "auto",
            paddingBottom: 4,
          }}
        >
          {etapas.map((etapa) => {
            const tone = toneFor(etapa);
            const column = shown.filter((record) => record.etapa === etapa);

            return (
              <div
                key={etapa}
                style={{
                  flex: 1,
                  minWidth: 165,
                  background: C.soft,
                  borderRadius: 12,
                  padding: 11,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    marginBottom: 10,
                  }}
                >
                  <span
                    style={{
                      background: tone.bg,
                      color: tone.fg,
                      fontSize: 12,
                      padding: "3px 9px",
                      borderRadius: 999,
                    }}
                  >
                    {etapa}
                  </span>
                  <span style={{ color: C.muted, fontSize: 12 }}>
                    {column.length}
                  </span>
                </div>
                {column.length === 0 ? (
                  <div style={{ fontSize: 12, color: C.muted, padding: "6px 2px" }}>
                    —
                  </div>
                ) : (
                  column.map((record, index) => (
                    <div
                      key={`${record.cliente}-${index}`}
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
                        {record.cliente}
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
                        {record.imobiliaria}
                      </div>
                      <div style={{ fontSize: 11.5, color: C.muted, marginTop: 5 }}>
                        {formatDate(record.criadoEm)}
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
