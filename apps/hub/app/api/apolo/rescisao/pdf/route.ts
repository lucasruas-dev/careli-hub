import { authorizeApoloRead } from "@/lib/apolo/auth";
import {
  montarTermoDeRescisaoPdf,
  nomeDoArquivoRescisao,
} from "@/lib/apolo/rescisao-pdf";
import { carregarTermoDeRescisao } from "@/lib/apolo/termo-de-rescisao-server";

// O TERMO DE RESCISÃO DE UM CONTRATO, em PDF timbrado — a "Simulação de Rescisão" (título do papel
// desde 16/09/2026) que o cliente pede para decidir se segue com o contrato.
//
// Molde linha a linha: `app/api/apolo/extrato-cliente/pdf/route.ts`. Mesmo portão, mesmos
// parâmetros de identificação (`c2xId` do cliente, `contrato` da venda) e mesmo jeito de devolver o
// arquivo. O termo nasce ao lado do extrato, no Financeiro, e o operador tem de reconhecer as duas
// chamadas como irmãs.
//
// ⚠️ ESTA ROTA NÃO CALCULA NADA. Ela autoriza, confere o pedido e devolve bytes. Quem busca é
// `carregarTermoDeRescisao` (C2X + Panteon), quem monta os dados é `montarDadosDaRescisao`, quem faz a
// conta é `calcularRescisao` e quem escreve o papel é `montarTermoDeRescisaoPdf`. Uma conta aqui
// dentro seria a segunda versão do número que o cliente assina.
//
// ⚠️ O CONTRATO É OBRIGATÓRIO, E ESTA É A DIFERENÇA PARA O EXTRATO. O extrato aceita "todos os
// contratos" num PDF só; o termo desfaz UM contrato, com uma tabela de valor, uma comissão e uma
// lista de parcelas vencidas. Sem `contrato`, a rota recusa com a frase — não escolhe o primeiro.
//
// ⚠️ `maxDuration = 30`, E NÃO É ENFEITE. Sem ele a função cai no teto padrão da Vercel, e o termo
// faz mais viagens que o extrato (C2X duas vezes, Supabase até quatro). Quando o teto estoura, a
// Vercel devolve uma página de erro em texto, a tela tenta ler JSON e o operador vê "Unexpected
// token" no lugar da frase — o defeito registrado em [[reference_vercel_timeout_vira_erro_de_json]].
//
// ⚠️ A RECUSA DO CONTEÚDO SAI COM O STATUS QUE A LEITURA DEU: 404 (contrato de outro cliente), 422
// (contrato encerrado, unidade sem preço) e 503 (banco fora de alcance). Sempre com `error`, porque
// é SÓ `error` que o painel lê — a frase é o que explica o botão ao operador.
export const dynamic = "force-dynamic";
export const maxDuration = 30;
export const runtime = "nodejs";

export async function GET(request: Request) {
  const authorization = await authorizeApoloRead(request);

  if (!authorization.ok) {
    return authorization.response;
  }

  const params = new URL(request.url).searchParams;
  const c2xId = Number(params.get("c2xId"));
  const contratoParam = (params.get("contrato") ?? "").trim();
  const contratoId = Number(contratoParam);

  if (!Number.isInteger(c2xId) || c2xId <= 0) {
    return json({ error: "Informe um c2xId valido." }, 400);
  }

  if (!contratoParam) {
    return json(
      { error: "Informe o contrato: o termo de rescisão é de um contrato só, não do cliente inteiro." },
      400,
    );
  }

  if (!Number.isInteger(contratoId) || contratoId <= 0) {
    return json({ error: "Informe um contrato valido." }, 400);
  }

  try {
    const resultado = await carregarTermoDeRescisao({ c2xId, contratoId });

    if (!resultado.ok) {
      return json({ error: resultado.error }, resultado.status);
    }

    const bytes = await montarTermoDeRescisaoPdf(resultado.dados);
    const nome = nomeDoArquivoRescisao(resultado.dados);

    return new Response(new Uint8Array(bytes), {
      headers: {
        "Cache-Control": "no-store",
        // `nomeDoArquivoRescisao` já tira os diacríticos (`sanitizarNomeDeArquivo`), então o
        // `filename*` não está salvando acento: é a forma que os navegadores atuais leem, e o
        // `filename` simples fica para quem só entende ela. As duas, como no extrato.
        "Content-Disposition": `attachment; filename="${asciiSeguro(nome)}"; filename*=UTF-8''${encodeURIComponent(nome)}`,
        "Content-Type": "application/pdf",
      },
      status: 200,
    });
  } catch (error) {
    console.error("[apolo][rescisao][pdf] falha ao gerar o termo", error);

    return json({ error: "Nao foi possivel gerar o PDF do termo de rescisao." }, 500);
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
