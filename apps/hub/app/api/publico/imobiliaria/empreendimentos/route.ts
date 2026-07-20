import { listEmpreendimentosAtivos } from "@/lib/apolo/credenciamento";
import { erro, json, prepararRota, responder } from "@/lib/publico/cad/rotas";

// Empreendimentos que a imobiliária pode PEDIR para trabalhar.
//
// Restrito aos que o Lucas marcou como ATIVOS (`apolo_enterprise_settings.credenciamento_ativo`,
// regra já existente no sistema, ligada em Apolo > Empreendimentos > Cadastro). Nada aqui é
// dado pessoal: é a vitrine dos empreendimentos abertos para credenciamento.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const preparo = await prepararRota(request, "identificacao");
  if (!preparo.ok) return preparo.response;
  const { adminClient, inicio } = preparo;

  try {
    return responder(
      inicio,
      json({ empreendimentos: await listEmpreendimentosAtivos(adminClient) }),
    );
  } catch {
    return responder(inicio, erro(undefined, 500));
  }
}
