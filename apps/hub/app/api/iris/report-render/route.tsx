import { ImageResponse } from "next/og";
import type { NextRequest } from "next/server";

// Renderizador de relatório em IMAGEM (PNG), runtime EDGE (onde o next/og roda; ele traz
// fonte embutida). NÃO acessa banco — recebe os dados prontos (o lado nodejs busca no C2X e
// faz POST aqui). Protegido por IRIS_TTS_DEMO_KEY. GET ?demo=1 renderiza dados fake pra
// verificar o render no preview. Ver [[project-caca-admin-assistant-mode]].
export const runtime = "edge";
export const dynamic = "force-dynamic";

const GOLD = "#A07C3B";
const INK = "#17202f";
const MUTED = "#667085";

type VendasRow = { empreendimento: string; vendidas: number; disponiveis: number };

function vendasReport(rows: VendasRow[], titulo: string) {
  const total = rows.reduce((sum, row) => sum + row.vendidas, 0);
  const max = Math.max(...rows.map((row) => row.vendidas), 1);

  return {
    element: (
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
        <div style={{ fontSize: 30, fontWeight: 700, color: INK }}>{titulo}</div>
        <div style={{ fontSize: 18, color: GOLD, marginTop: 4, marginBottom: 20 }}>
          {`${total} unidades vendidas no total · Careli`}
        </div>
        <div style={{ display: "flex", flexDirection: "column" }}>
          {rows.map((row) => (
            <div
              key={row.empreendimento}
              style={{ display: "flex", alignItems: "center", marginBottom: 10 }}
            >
              <div style={{ display: "flex", width: 250, fontSize: 19, color: INK }}>
                {row.empreendimento}
              </div>
              <div
                style={{
                  display: "flex",
                  width: 380,
                  height: 26,
                  backgroundColor: "#eef1f4",
                  borderRadius: 6,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    width: (380 * row.vendidas) / max,
                    height: 26,
                    backgroundColor: GOLD,
                    borderRadius: 6,
                  }}
                />
              </div>
              <div style={{ display: "flex", width: 90, fontSize: 18, color: INK, marginLeft: 14 }}>
                {String(row.vendidas)}
              </div>
              <div style={{ display: "flex", fontSize: 15, color: MUTED }}>
                {`${row.disponiveis} disp.`}
              </div>
            </div>
          ))}
        </div>
      </div>
    ),
    height: 150 + rows.length * 36,
  };
}

const DEMO_ROWS: VendasRow[] = [
  { disponiveis: 8, empreendimento: "Lavra do Ouro", vendidas: 476 },
  { disponiveis: 5, empreendimento: "Rio de Pedras", vendidas: 381 },
  { disponiveis: 32, empreendimento: "Portal dos Vales", vendidas: 265 },
  { disponiveis: 60, empreendimento: "Lagoa Bonita", vendidas: 234 },
  { disponiveis: 229, empreendimento: "Veredas do Ouro", vendidas: 124 },
];

export async function GET(request: NextRequest) {
  const key = process.env.IRIS_TTS_DEMO_KEY?.trim();
  const url = new URL(request.url);
  const provided = url.searchParams.get("key")?.trim() ?? "";

  if (!key || provided !== key) {
    return new Response("Nao autorizado.", { status: 401 });
  }

  const { element, height } = vendasReport(DEMO_ROWS, "Vendas por empreendimento");

  return new ImageResponse(element, { width: 900, height });
}

export async function POST(request: NextRequest) {
  const secret = process.env.IRIS_TTS_DEMO_KEY?.trim();
  const provided = request.headers.get("x-report-secret")?.trim() ?? "";

  if (!secret || provided !== secret) {
    return new Response("Nao autorizado.", { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as {
    titulo?: string;
    rows?: VendasRow[];
  } | null;

  const rows = Array.isArray(body?.rows) ? body!.rows : [];

  if (rows.length === 0) {
    return new Response("Sem dados.", { status: 400 });
  }

  const { element, height } = vendasReport(
    rows,
    body?.titulo?.trim() || "Vendas por empreendimento",
  );

  return new ImageResponse(element, { width: 900, height });
}
