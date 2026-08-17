import { consultarImobiliariaCredenciada } from "@/lib/publico/cad/dados";
import { anotarContexto } from "@/lib/publico/cad/log-erros";
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

  // "Desde o início, quando informa o CPF, imobiliária" (Lucas). Entra MASCARADO.
  anotarContexto(request, { imobiliariaCnpj: cnpj });

  if (!cnpjValido(cnpj)) {
    return responder(request, inicio, erro("Confira o CNPJ: parece que faltou um dígito."));
  }

  try {
    // ⚠️ JÁ CREDENCIADA NÃO É MAIS BECO SEM SAÍDA.
    //
    // Antes esta resposta encerrava o fluxo: a tela dizia "Imobiliária já credenciada, seus
    // corretores já podem enviar CADs" e a imobiliária que queria trabalhar um empreendimento
    // NOVO não tinha por onde seguir. Foi o que o Lucas viu ao testar a RAIANE IMOBILIARIA no
    // Jardim das Gerais (15/08): o portal externo parou aqui.
    //
    // Regra dele: quem já tem cadastro NÃO passa pela validação — faz o vínculo e recebe a
    // mensagem. Então a antessala emite a pré-sessão do mesmo jeito, e o portal segue para a
    // habilitação em vez do wizard completo.
    const existente = await consultarImobiliariaCredenciada(adminClient, cnpj);
    anotarContexto(request, {
      imobiliariaEntityId: existente.entityId,
      imobiliariaNome: existente.nome,
    });

    if (existente.credenciada) {
      const preHab = assinarPreSessaoImob({ cnpj });
      if (!preHab.ok) return responder(request, inicio, erro(preHab.error, 503));

      return responder(
        request,
        inicio,
        json({
          nome: existente.nome,
          preSessao: preHab.token,
          status: "ja-credenciada",
        }),
      );
    }

    // Emite a pré-sessão amarrada a ESTE CNPJ. O /cadastro rejeita se o cartão CNPJ divergir.
    const pre = assinarPreSessaoImob({ cnpj });
    if (!pre.ok) return responder(request, inicio, erro(pre.error, 503));

    return responder(request, inicio, json({ preSessao: pre.token, status: "ok" }));
  } catch {
    return responder(request, inicio, erro(undefined, 500));
  }
}
