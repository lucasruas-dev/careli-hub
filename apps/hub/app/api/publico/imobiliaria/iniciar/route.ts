import { consultarImobiliariaCredenciada } from "@/lib/publico/cad/dados";
import { cnpjValido, normalizarCnpj } from "@/lib/publico/cad/regras";
import { erro, json, lerCorpo, prepararRota, responder } from "@/lib/publico/cad/rotas";
import { assinarPreSessaoImob } from "@/lib/publico/cad/sessao";

// ANTESSALA da imobiliária pública: confere o CNPJ e emite a PRÉ-SESSÃO que destrava o wizard.
//
// POR QUE PRECISA EXISTIR: o auto-cadastro público de imobiliária passou a reusar o CadastroFlow
// COMPLETO, que faz OCR do cartão CNPJ + `enrich-company` — DUAS torneiras PAGAS. A regra de
// ouro exige sessão para qualquer torneira paga, então antes de abrir o wizard confirmamos o
// CNPJ aqui (formato + que ele NÃO está já credenciado) e emitimos um token curto que autoriza o
// OCR e amarra o cadastro àquele CNPJ (anti-troca no /cadastro).
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  const preparo = await prepararRota(request, "imobiliaria");
  if (!preparo.ok) return preparo.response;
  const { adminClient, inicio } = preparo;

  const corpo = await lerCorpo<{ cnpj?: string }>(request);
  const cnpj = normalizarCnpj(corpo?.cnpj);
  if (!cnpjValido(cnpj)) {
    return responder(inicio, erro("Confira o CNPJ: parece que faltou um dígito."));
  }

  try {
    // Já credenciada: não abre o cadastro (é para imobiliária NOVA). Resposta cordial, sem criar
    // nada e sem revelar mais do que a pessoa acabou de digitar.
    const existente = await consultarImobiliariaCredenciada(adminClient, cnpj);
    if (existente.credenciada) {
      return responder(inicio, json({ status: "ja-credenciada" }));
    }

    // Emite a pré-sessão amarrada a ESTE CNPJ. O /cadastro rejeita se o cartão CNPJ divergir.
    const pre = assinarPreSessaoImob({ cnpj });
    if (!pre.ok) return responder(inicio, erro(pre.error, 503));

    return responder(inicio, json({ preSessao: pre.token, status: "ok" }));
  } catch {
    return responder(inicio, erro(undefined, 500));
  }
}
