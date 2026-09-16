import { authorizeApoloRead } from "@/lib/apolo/auth";
import { atorDoHub, listarEmpreendimentosDaTemis } from "@/lib/temis/trabalho-servico";

// OS EMPREENDIMENTOS DA TÊMIS — só os que estão recebendo CAD.
//
// Lucas (07/09/2026): *"na temis, pode deixar somente os empreendimentos que estamos recebendo
// cads"*. Antes disso ele tinha apontado o que faltava: *"o empreendimento teste não aparece para
// gente fazer minuta"* e *"o empreendimento que eu estou falando é o que estamos testando no
// hércules, zz"*.
//
// ⚠️ O ZZ NUNCA ESTEVE FILTRADO — ele não existe no C2X. O "ZZ TESTE" (código TST,
// `enterprise_id` 9001) nasceu em `hercules_empreendimentos` em 04/09/2026, quando o Lucas decidiu
// *"a partir de hoje vamos cadastrar os empreendimentos dentro do panteon"*. A tela lia
// `/api/apolo/empreendimentos`, que consulta o C2X, e lá o TST não tem linha.
//
// ⚠️ ESTA ROTA É SÓ A PORTA DO HUB. A leitura do portão (`apolo_enterprise_settings.recepcao_cad`)
// e o nome bonito vindo do cadastro do Panteon moram em `listarEmpreendimentosDaTemis`
// (`lib/temis/trabalho-servico.ts`), a mesma que `/api/incorporador/temis/empreendimentos` chama com
// o ator do portal — lá recortada aos empreendimentos da sessão. Aqui, sem recorte.
//
// Medido em 07/09/2026: 12 empreendimentos com o portão aberto, entre eles o TST e o Lagoa Bonita.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const autorizacao = await authorizeApoloRead(request);
  if (!autorizacao.ok) return autorizacao.response;

  return listarEmpreendimentosDaTemis(atorDoHub(autorizacao, "leitura"));
}
