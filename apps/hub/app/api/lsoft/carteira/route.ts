import { NextResponse } from "next/server";

import { authorizeApoloRead } from "@/lib/apolo/auth";
import { lerCarteiraDoLsoft } from "@/lib/lsoft/carteira";
import { filtroDaExportacao } from "@/lib/lsoft/filtro-da-tela";
import { exportarCarteiraDoLsoft } from "@/lib/lsoft/planilha-da-carteira";

// A CARTEIRA DO LSOFT (Garden e Vale do Sol) — lista de clientes com o resumo de cada um.
//
// ⚠️ MESMA PORTA DO APOLO (`authorizeApoloRead`): aqui trafega CPF, RG, filiação e endereço de 237
// pessoas, então quem entra é o mesmo time que já vê o CRM. As tabelas `lsoft_*` são deny-all no
// RLS: quem lê é o servidor com a service role, nunca o navegador direto.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// ⚠️ 60 s DE TETO por causa da exportação para Excel: medido em 29/09/2026, da máquina do Lucas,
// a carteira inteira (475 clientes, 32.660 parcelas) leva ~10 s entre ler e montar o arquivo, e a
// lista sozinha 1,4 s. Sem valor explícito vale o padrão do projeto na Vercel, que não está escrito
// no repositório (sem Fluid, o Pro corta em 15 s); 60 s dá folga sem abrir espaço para laço longo.
export const maxDuration = 60;

export async function GET(request: Request) {
  const auth = await authorizeApoloRead(request);
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);

  // A EXPORTAÇÃO PARA EXCEL (Lucas, 29/09/2026: *"coloca exportação para xlsx por favor nessa
  // tela"*). Mesma rota e mesma porta da lista, com os mesmos `q` e `emp`: quem vê a tela baixa o
  // arquivo dela, e ninguém mais. Os checkboxes da tela chegam como `pendentes=1` e `patrimonio=1`.
  if (url.searchParams.get("formato") === "xlsx") {
    const exportacao = await exportarCarteiraDoLsoft(filtroDaExportacao(url.searchParams));
    if (!exportacao.ok) {
      console.error("[lsoft/carteira] exportação falhou:", exportacao.erro);
      // Tela interna, time da Careli: o motivo vai junto, como a leitura da lista já faz.
      return NextResponse.json({ error: exportacao.erro }, { status: 503 });
    }
    return new NextResponse(exportacao.arquivo, {
      headers: {
        "Cache-Control": "no-store",
        "Content-Disposition": `attachment; filename="${exportacao.nome}"`,
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      },
    });
  }

  const resultado = await lerCarteiraDoLsoft({
    busca: url.searchParams.get("q"),
    empreendimento: url.searchParams.get("emp"),
  });

  if (!resultado.ok) return NextResponse.json({ error: resultado.erro }, { status: 503 });

  return NextResponse.json(
    { data: { clientes: resultado.clientes, resumo: resultado.resumo } },
    { headers: { "Cache-Control": "no-store" } },
  );
}
