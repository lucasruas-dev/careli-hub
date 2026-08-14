// Peças visuais compartilhadas pelas abas do painel do coordenador.
//
// Estilo inline, sem Tailwind, de propósito: esta é uma tela PÚBLICA que roda fora do chrome do
// HUB e precisa ficar igual em qualquer navegador que o coordenador abrir, inclusive no celular
// dele no meio do plantão. A paleta é a mesma do dashboard de CADs que o Lucas já validou.
"use client";

import type React from "react";
import { useMemo, useState } from "react";

export const GOLD = "#A97C50";

export const C = {
  border: "#E9E6DD",
  card: "#FFFFFF",
  muted: "#9C988D",
  page: "#FBFAF5",
  soft: "#F0EEE7",
  sub: "#6C6A62",
  text: "#1B1A16",
};

export const TOM = {
  ambar: { bg: "#F5EFE3", fg: "#8A6A2F" },
  azul: { bg: "#E6F1FB", fg: "#185FA5" },
  ciano: { bg: "#E0F5F9", fg: "#0891B2" },
  cinza: { bg: C.soft, fg: "#5F5E5A" },
  laranja: { bg: "#FAEEDA", fg: "#854F0B" },
  roxo: { bg: "#EFE9FA", fg: "#5B3FA8" },
  verde: { bg: "#E3F6EC", fg: "#0F9D58" },
  verdeEscuro: { bg: "#E1F5EE", fg: "#0F6E56" },
  vermelho: { bg: "#FCEBEB", fg: "#A32D2D" },
} as const;

export type Tom = keyof typeof TOM;

export const moedaBR = (valor: number) =>
  `R$ ${valor.toLocaleString("pt-BR", { maximumFractionDigits: 2, minimumFractionDigits: 2 })}`;

export const numeroBR = (valor: number) => valor.toLocaleString("pt-BR");

export function dataCurta(iso: null | string): string {
  if (!iso) return "—";
  const data = new Date(iso.length <= 10 ? `${iso}T12:00:00` : iso);
  return Number.isNaN(data.getTime())
    ? "—"
    : data.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

export function dataHora(iso: null | string): string {
  if (!iso) return "—";
  const data = new Date(iso);
  return Number.isNaN(data.getTime())
    ? "—"
    : data.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
}

/** Cartão de número. Vira botão quando recebe `onClick` (é assim que a aba CAD filtra). */
export function Kpi({
  ativo,
  label,
  onClick,
  sub,
  tom = "cinza",
  valor,
}: {
  ativo?: boolean;
  label: string;
  onClick?: () => void;
  sub?: string;
  tom?: Tom;
  valor: number | string;
}) {
  const cor = TOM[tom];
  const conteudo = (
    <>
      <div style={{ alignItems: "center", color: C.sub, display: "flex", fontSize: 12.5, gap: 6 }}>
        <span
          style={{
            background: cor.fg,
            borderRadius: 3,
            display: "inline-block",
            height: 9,
            width: 9,
          }}
        />
        {label}
      </div>
      <div
        style={{
          color: cor.fg,
          fontSize: 26,
          fontVariantNumeric: "tabular-nums",
          fontWeight: 600,
          marginTop: 6,
        }}
      >
        {typeof valor === "number" ? numeroBR(valor) : valor}
      </div>
      {sub ? <div style={{ color: C.muted, fontSize: 12, marginTop: 5 }}>{sub}</div> : null}
    </>
  );

  const estilo: React.CSSProperties = {
    background: C.card,
    border: `1.5px solid ${ativo ? GOLD : C.border}`,
    borderRadius: 14,
    boxShadow: ativo ? `0 0 0 1px ${GOLD}` : "none",
    padding: "14px 16px",
    textAlign: "left",
  };

  if (!onClick) return <div style={estilo}>{conteudo}</div>;

  return (
    <button onClick={onClick} style={{ ...estilo, cursor: "pointer" }} type="button">
      {conteudo}
    </button>
  );
}

export function GradeKpis({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        display: "grid",
        gap: 12,
        gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
        marginBottom: 20,
      }}
    >
      {children}
    </div>
  );
}

export function Selo({ children, tom = "cinza" }: { children: React.ReactNode; tom?: Tom }) {
  const cor = TOM[tom];
  return (
    <span
      style={{
        background: cor.bg,
        borderRadius: 999,
        color: cor.fg,
        fontSize: 12,
        padding: "3px 9px",
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </span>
  );
}

/**
 * Ordenação de tabela, do jeito que o coordenador espera: clicou no cabeçalho, ordena; clicou de
 * novo, inverte. Cada campo declara COMO se compara (número ou texto), porque ordenar "R$ 1.000,00"
 * como string põe R$ 900 depois de R$ 1.000 — e uma tabela que mente na ordem é pior que uma sem
 * ordenação nenhuma.
 */
export type Ordenacao = { campo: string; desc: boolean };

export function useOrdenacao<T>(
  itens: T[],
  campos: Record<string, (item: T) => number | string>,
  inicial: Ordenacao,
): { alternar: (campo: string) => void; itens: T[]; ordem: Ordenacao } {
  const [ordem, setOrdem] = useState<Ordenacao>(inicial);

  const ordenados = useMemo(() => {
    const extrai = campos[ordem.campo];
    if (!extrai) return itens;

    return [...itens].sort((primeiro, segundo) => {
      const a = extrai(primeiro);
      const b = extrai(segundo);
      const comparacao =
        typeof a === "number" && typeof b === "number"
          ? a - b
          : String(a).localeCompare(String(b), "pt-BR");
      return ordem.desc ? -comparacao : comparacao;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itens, ordem]);

  const alternar = (campo: string) =>
    setOrdem((atual) =>
      // Trocar de coluna começa CRESCENTE em texto e DECRESCENTE em número/data: ninguém clica em
      // "valor" querendo ver o menor primeiro, nem em "cliente" querendo começar pelo Z.
      atual.campo === campo
        ? { campo, desc: !atual.desc }
        : { campo, desc: typeof campos[campo]?.(itens[0] as T) === "number" },
    );

  return { alternar, itens: ordenados, ordem };
}

export function Tabela({
  colunas,
  children,
  onOrdenar,
  ordem,
  vazio,
}: {
  colunas: { campo?: string; chave: string; largura?: number | string }[];
  children: React.ReactNode;
  onOrdenar?: (campo: string) => void;
  ordem?: Ordenacao;
  vazio?: string;
}) {
  const temLinhas = Array.isArray(children) ? children.length > 0 : Boolean(children);

  return (
    <div
      style={{
        background: C.card,
        border: `1px solid ${C.border}`,
        borderRadius: 12,
        overflowX: "auto",
      }}
    >
      <table style={{ borderCollapse: "collapse", minWidth: 560, tableLayout: "fixed", width: "100%" }}>
        <colgroup>
          {colunas.map((coluna) => (
            <col key={coluna.chave} style={coluna.largura ? { width: coluna.largura } : undefined} />
          ))}
        </colgroup>
        <thead>
          <tr>
            {colunas.map((coluna) => {
              const ordenavel = Boolean(coluna.campo && onOrdenar);
              const ativa = Boolean(coluna.campo && ordem?.campo === coluna.campo);

              return (
                <th
                  key={coluna.chave}
                  onClick={
                    ordenavel && coluna.campo ? () => onOrdenar?.(coluna.campo as string) : undefined
                  }
                  style={{
                    borderBottom: `1px solid ${C.border}`,
                    color: ativa ? GOLD : C.muted,
                    cursor: ordenavel ? "pointer" : "default",
                    fontSize: 12,
                    fontWeight: ativa ? 600 : 500,
                    padding: "10px 12px",
                    textAlign: "left",
                    userSelect: "none",
                    whiteSpace: "nowrap",
                  }}
                  title={ordenavel ? "Ordenar por esta coluna" : undefined}
                >
                  {coluna.chave}
                  {ativa ? (ordem?.desc ? " ↓" : " ↑") : ordenavel ? " ↕" : ""}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {temLinhas ? (
            children
          ) : (
            <tr>
              <td
                colSpan={colunas.length}
                style={{ color: C.muted, fontSize: 13.5, padding: 22, textAlign: "center" }}
              >
                {vazio ?? "Nada por aqui ainda."}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

export function celula(cor: string, extra?: React.CSSProperties): React.CSSProperties {
  return {
    borderBottom: `1px solid ${C.border}`,
    color: cor,
    fontSize: 13.5,
    overflow: "hidden",
    padding: "10px 12px",
    textAlign: "left",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    ...extra,
  };
}

export function TituloSecao({
  acao,
  contagem,
  titulo,
}: {
  acao?: React.ReactNode;
  contagem?: string;
  titulo: string;
}) {
  return (
    <div
      style={{
        alignItems: "center",
        display: "flex",
        flexWrap: "wrap",
        gap: 8,
        justifyContent: "space-between",
        marginBottom: 14,
      }}
    >
      <h2 style={{ fontSize: 16, fontWeight: 600, margin: 0 }}>
        <span style={{ color: GOLD }}>{titulo}</span>
        {contagem ? (
          <span style={{ color: C.muted, fontSize: 12.5, fontWeight: 400 }}> · {contagem}</span>
        ) : null}
      </h2>
      {acao}
    </div>
  );
}

export function Aviso({ children, tom = "ambar" }: { children: React.ReactNode; tom?: Tom }) {
  const cor = TOM[tom];
  return (
    <div
      style={{
        background: cor.bg,
        border: `1px solid ${cor.fg}33`,
        borderRadius: 12,
        color: cor.fg,
        fontSize: 13,
        marginBottom: 18,
        padding: "12px 14px",
      }}
    >
      {children}
    </div>
  );
}

export const inputEstilo: React.CSSProperties = {
  background: C.card,
  border: `1px solid ${C.border}`,
  borderRadius: 10,
  color: C.text,
  fontSize: 13.5,
  height: 38,
  maxWidth: "100%",
  padding: "0 12px",
};
