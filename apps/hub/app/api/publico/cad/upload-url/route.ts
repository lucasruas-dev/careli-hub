import { criarUrlDeUploadApoloDocument } from "@/lib/apolo/documentos";
import { anotarContexto } from "@/lib/publico/cad/log-erros";
import { erro, json, lerCorpo, prepararRota, recusar, responder } from "@/lib/publico/cad/rotas";
import {
  donoUploadPreImob,
  donoUploadSessao,
  preSessaoImobDoRequest,
  sessaoDoRequest,
} from "@/lib/publico/cad/sessao";

// Espelho PÚBLICO de /api/apolo/cadastro/upload-url: devolve a permissão de gravar UM arquivo no
// Storage, para o documento GRANDE não precisar caber no corpo do POST (a Vercel corta em ~4,5MB).
//
// A rota NÃO recebe arquivo e NÃO cria nada: só assina um caminho. A autorização é a MESMA do
// resto do portal (token HS256 da antessala, em lib/publico/cad/sessao.ts) e o rate-limit é o
// mesmo `prepararRota` das outras rotas públicas.
//
// Aceita os DOIS tokens porque os dois fluxos usam o mesmo wizard e o mesmo bucket:
//   • x-cad-sessao          → corretor enviando a CAD do cliente
//   • x-cad-pre-sessao-imob → imobiliária no auto-cadastro
// O caminho assinado é amarrado a quem pediu; a rota de salvar recusa caminho de outro dono.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  const sessao = sessaoDoRequest(request);
  const preImob = preSessaoImobDoRequest(request);
  const dono = sessao.ok
    ? donoUploadSessao(sessao.sessao)
    : preImob.ok
      ? donoUploadPreImob(preImob.pre)
      : null;

  if (!dono) {
    return recusar(
      request,
      erro("Sua sessão expirou. Reabra o link e informe o seu CPF de corretor.", 401),
    );
  }

  if (sessao.ok) {
    anotarContexto(request, {
      corretorNome: sessao.sessao.corretorNome,
      empreendimentoId: sessao.sessao.enterpriseId,
      imobiliariaEntityId: sessao.sessao.imobiliariaEntityId,
      imobiliariaNome: sessao.sessao.imobiliariaNome,
    });
  } else if (preImob.ok) {
    anotarContexto(request, { imobiliariaCnpj: preImob.pre.cnpj });
  }

  const preparo = await prepararRota(request, "upload");
  if (!preparo.ok) return preparo.response;
  const { adminClient, inicio } = preparo;

  const body = await lerCorpo<{ fileName?: unknown }>(request);

  try {
    const assinada = await criarUrlDeUploadApoloDocument({
      adminClient,
      dono,
      fileName: typeof body?.fileName === "string" ? body.fileName : "",
    });
    return responder(request, inicio, json(assinada, 200));
  } catch {
    return responder(request, inicio, erro(undefined, 500));
  }
}
