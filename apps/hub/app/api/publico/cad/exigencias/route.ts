import { exigeComprovanteRenda } from "@/lib/apolo/enterprise-settings";
import { anotarContexto } from "@/lib/publico/cad/log-erros";
import { erro, json, prepararRota, recusar, responder } from "@/lib/publico/cad/rotas";
import { sessaoDoRequest } from "@/lib/publico/cad/sessao";

// O que ESTE empreendimento exige a mais no envio da CAD. Hoje só o COMPROVANTE DE RENDA (etapa
// nova do Setup do empreendimento, migration 0095); a forma é uma lista para caber a próxima
// exigência sem virar uma rota por chave.
//
// ⚠️ ISTO É A TELA, NÃO A TRAVA. Quem barra a CAD sem comprovante é /api/publico/cad/salvar, que
// relê a chave do banco pelo empreendimento do TOKEN. Esta rota existe para o corretor VER a
// etapa e anexar o documento antes de chegar ao fim do formulário — se ela mentir (ou cair), o
// pior caso é o envio ser recusado no final com a mensagem do servidor, nunca uma CAD entrar sem
// o documento.
//
// ⚠️ O EMPREENDIMENTO SAI DO TOKEN, e não da query string: com um id no parâmetro, qualquer um
// com o link leria a configuração de qualquer loteamento. Mesma regra do resto do portal.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const sessao = sessaoDoRequest(request);
  if (!sessao.ok) {
    return recusar(
      request,
      erro("Sua sessão expirou. Reabra o link e informe o seu CPF de corretor.", 401),
    );
  }

  anotarContexto(request, {
    corretorNome: sessao.sessao.corretorNome,
    empreendimentoId: sessao.sessao.enterpriseId,
    imobiliariaEntityId: sessao.sessao.imobiliariaEntityId,
    imobiliariaNome: sessao.sessao.imobiliariaNome,
  });

  const preparo = await prepararRota(request, "exigencias");
  if (!preparo.ok) return preparo.response;
  const { adminClient, inicio } = preparo;

  // Sessão ainda sem empreendimento escolhido (a antessala só carimba quando há um só, ou depois
  // da escolha): não há chave a consultar, e a CAD nem pode ser enviada assim.
  if (!sessao.sessao.enterpriseId) {
    return responder(request, inicio, json({ comprovanteRenda: false }));
  }

  try {
    const comprovanteRenda = await exigeComprovanteRenda(
      adminClient,
      sessao.sessao.enterpriseId,
    );
    return responder(request, inicio, json({ comprovanteRenda }));
  } catch {
    return responder(request, inicio, erro(undefined, 500));
  }
}
