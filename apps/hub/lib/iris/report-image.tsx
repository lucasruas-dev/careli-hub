import { ImageResponse } from "next/og";

import {
  loadC2xMovimentacaoResumo,
  loadC2xVendasPorEmpreendimento,
  type C2xPeriodo,
} from "@/lib/guardian/c2x-analytics";

// Relatórios em IMAGEM (PNG) para a CACÁ mandar no WhatsApp (modo admin). Usa next/og
// (Satori+resvg, nativo do Vercel). Layout só com flexbox (limitação do Satori). Ver
// [[project-caca-admin-assistant-mode]].

const CARELI_GOLD = "#A07C3B";
const INK = "#17202f";
const MUTED = "#667085";

function toBuffer(response: ImageResponse): Promise<Buffer> {
  return response.arrayBuffer().then((ab) => Buffer.from(ab));
}

// Relatório: vendas (vendidas/disponíveis) por empreendimento, ordenado por vendidas.
export async function renderVendasEmpreendimentoPng(): Promise<Buffer | null> {
  const rows = await loadC2xVendasPorEmpreendimento();

  if (rows.length === 0) {
    return null;
  }

  const total = rows.reduce((sum, row) => sum + row.vendidas, 0);
  const max = Math.max(...rows.map((row) => row.vendidas), 1);
  const height = 150 + rows.length * 46;

  const image = new ImageResponse(
    (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          width: "100%",
          height: "100%",
          backgroundColor: "#ffffff",
          padding: "36px 44px",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
          <div style={{ fontSize: 30, fontWeight: 700, color: INK }}>
            Vendas por empreendimento
          </div>
          <div style={{ fontSize: 18, color: MUTED }}>· Careli</div>
        </div>
        <div style={{ fontSize: 18, color: CARELI_GOLD, marginTop: 4, marginBottom: 18 }}>
          {total} unidades vendidas no total
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {rows.map((row) => (
            <div key={row.empreendimento} style={{ display: "flex", alignItems: "center", gap: 14 }}>
              <div style={{ width: 240, fontSize: 19, color: INK, overflow: "hidden" }}>
                {row.empreendimento}
              </div>
              <div style={{ display: "flex", flex: 1, height: 26, backgroundColor: "#f1f2f4", borderRadius: 6 }}>
                <div
                  style={{
                    display: "flex",
                    width: `${Math.round((row.vendidas / max) * 100)}%`,
                    height: "100%",
                    backgroundColor: CARELI_GOLD,
                    borderRadius: 6,
                  }}
                />
              </div>
              <div style={{ width: 130, fontSize: 18, color: INK, textAlign: "right" }}>
                {row.vendidas} vend.
              </div>
              <div style={{ width: 120, fontSize: 15, color: MUTED, textAlign: "right" }}>
                {row.disponiveis} disp.
              </div>
            </div>
          ))}
        </div>
      </div>
    ),
    { width: 900, height },
  );

  return toBuffer(image);
}

// Relatório: movimentação (propostas/vendas/faturado/cancelamentos) de um período.
export async function renderMovimentacaoPng(
  periodo: C2xPeriodo,
): Promise<Buffer | null> {
  const resumo = await loadC2xMovimentacaoResumo(periodo);

  if (!resumo) {
    return null;
  }

  const cards: { label: string; value: number; color: string }[] = [
    { color: CARELI_GOLD, label: "Propostas", value: resumo.propostas },
    { color: "#2563eb", label: "Vendas", value: resumo.vendas },
    { color: "#059669", label: "Faturado", value: resumo.faturado },
    { color: "#dc2626", label: "Cancelamentos", value: resumo.cancelados + resumo.distratos },
  ];

  const image = new ImageResponse(
    (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          width: "100%",
          height: "100%",
          backgroundColor: "#ffffff",
          padding: "40px 44px",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ fontSize: 30, fontWeight: 700, color: INK }}>
          Movimentação · {resumo.periodoLabel}
        </div>
        <div style={{ fontSize: 18, color: MUTED, marginTop: 4, marginBottom: 26 }}>
          Careli — resumo comercial
        </div>
        <div style={{ display: "flex", gap: 18 }}>
          {cards.map((card) => (
            <div
              key={card.label}
              style={{
                display: "flex",
                flexDirection: "column",
                flex: 1,
                padding: "22px 20px",
                borderRadius: 14,
                backgroundColor: "#f8fafc",
                border: "1px solid #e5e9f0",
              }}
            >
              <div style={{ fontSize: 46, fontWeight: 700, color: card.color }}>
                {card.value}
              </div>
              <div style={{ fontSize: 18, color: MUTED, marginTop: 4 }}>{card.label}</div>
            </div>
          ))}
        </div>
        <div style={{ fontSize: 16, color: MUTED, marginTop: 24 }}>
          Vendas = contrato gerado ({resumo.contratoGerado}) + em assinatura ({resumo.emAssinatura}) + faturado ({resumo.faturado}).
        </div>
      </div>
    ),
    { width: 900, height: 320 },
  );

  return toBuffer(image);
}
