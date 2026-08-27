import { authorizeApoloRead } from "@/lib/apolo/auth";
import { loadExtratoDoCliente } from "@/lib/apolo/extrato-cliente-c2x";
import {
  montarExtratoClientePdf,
  nomeDoArquivoExtrato,
} from "@/lib/apolo/extrato-cliente-pdf";

// O extrato do cliente comprador em PDF timbrado. Mesma leitura (read-only) da rota JSON: os
// dois desenham a MESMA apuração, então tela e papel nunca divergem.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const authorization = await authorizeApoloRead(request);

  if (!authorization.ok) {
    return authorization.response;
  }

  const params = new URL(request.url).searchParams;
  const c2xId = Number(params.get("c2xId"));
  const contratoParam = params.get("contrato");
  const contratoId = contratoParam ? Number(contratoParam) : null;

  if (!Number.isInteger(c2xId) || c2xId <= 0) {
    return json({ error: "Informe um c2xId valido." }, 400);
  }

  if (contratoParam && (!Number.isInteger(contratoId) || (contratoId ?? 0) <= 0)) {
    return json({ error: "Informe um contrato valido." }, 400);
  }

  try {
    const result = await loadExtratoDoCliente({ c2xId, contratoId });

    if (!result.ok) {
      return json({ error: result.error }, 503);
    }

    if (!result.data.contratos.length) {
      return json({ error: "Cliente sem contrato com carteira no C2X." }, 404);
    }

    const bytes = await montarExtratoClientePdf(result.data);
    const nome = nomeDoArquivoExtrato(result.data);

    return new Response(new Uint8Array(bytes), {
      headers: {
        "Cache-Control": "no-store",
        // `nomeDoArquivoExtrato` já devolve ASCII (faz NFD e remove os diacríticos), então o
        // `filename*` aqui não está salvando acento nenhum: ele é a forma que os navegadores
        // atuais leem, e o `filename` simples continua para os clientes que só entendem ela.
        "Content-Disposition": `attachment; filename="${asciiSeguro(nome)}"; filename*=UTF-8''${encodeURIComponent(nome)}`,
        "Content-Type": "application/pdf",
      },
      status: 200,
    });
  } catch (error) {
    console.error("[apolo][extrato-cliente][pdf] falha ao gerar o extrato", error);

    return json({ error: "Nao foi possivel gerar o PDF do extrato." }, 500);
  }
}

function json(payload: { error: string }, status: number) {
  return new Response(JSON.stringify(payload), {
    headers: { "Cache-Control": "no-store", "Content-Type": "application/json" },
    status,
  });
}

function asciiSeguro(nome: string): string {
  return nome
    .normalize("NFD")
    .replace(new RegExp("[\\u0300-\\u036f]", "g"), "")
    .replace(/[^\x20-\x7E]/g, "")
    .replace(/"/g, "");
}
