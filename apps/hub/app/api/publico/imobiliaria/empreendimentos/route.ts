import { listEmpreendimentosParaImobiliaria } from "@/lib/apolo/credenciamento";
import { erro, json, prepararRota, responder } from "@/lib/publico/cad/rotas";

// Empreendimentos que a imobiliária pode PEDIR para trabalhar.
//
// Restrito ao PORTÃO de imobiliária: master `credenciamento_ativo` E `recepcao_imobiliaria`
// ligados (Apolo > Empreendimentos). O master sozinho não basta: um empreendimento pode receber
// CAD sem estar habilitando imobiliárias novas — e vice-versa (caso Recanto do Vale, Lucas
// 26/08). Nada aqui é dado pessoal: é a vitrine dos empreendimentos abertos para credenciamento.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const preparo = await prepararRota(request, "identificacao");
  if (!preparo.ok) return preparo.response;
  const { adminClient, inicio } = preparo;

  try {
    return responder(
      request,
      inicio,
      json({ empreendimentos: await listEmpreendimentosParaImobiliaria(adminClient) }),
    );
  } catch {
    return responder(request, inicio, erro(undefined, 500));
  }
}
