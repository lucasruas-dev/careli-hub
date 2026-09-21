import { autorizarAlteracaoManualDoContrato } from "@/lib/temis/autorizacao";
import {
  descartarEdicaoDoContrato,
  salvarEdicaoDoContrato,
} from "@/lib/temis/contrato-servico";
import { atorDoHub } from "@/lib/temis/ator";

// A ALTERAÇÃO MANUAL DO CONTRATO — salvar e descartar.
//
// Lucas (10/09/2026): *"quando eu clicar no abrir contrato, esse contrato tem que me permitir fazer
// alteração manual, salvar, fechar contrato"*.
//
// ⚠️ QUEM EDITA NÃO É MAIS QUEM EMITE (21/09/2026). Lucas: *"quem pode editar é a Nivea Careli
// e Northon Nascimento"*. Reescrever cláusula passou a exigir a permissão nominal
// `temis-contrato-editar` (`autorizarAlteracaoManualDoContrato`), enquanto EMITIR o PDF continua
// com a coordenação inteira. São atos diferentes: um escreve o que o cliente vai assinar, o
// outro imprime o texto que já foi escrito.
//
// ⚠️ O DELETE ENTRA NA MESMA RÉGUA. Descartar apaga a cláusula que a Nívea escreveu — deixar o
// apagar mais largo que o escrever seria a mesma porta, aberta pelo outro lado.
//
// ⚠️ NÃO EXISTE `GET` AQUI, DE PROPÓSITO. A edição vigente volta junto com a prévia
// (`/api/temis/contrato/previa`), porque a tela precisa das duas coisas ao mesmo tempo: o texto que
// vale e a base de hoje para comparar. Uma segunda porta produziria a janela em que a tela mostra o
// texto editado e ainda não sabe que o cadastro mudou — e é justamente nessa janela que alguém
// clica em gerar.
//
// ⚠️ O TEXTO É FAXINADO NO SERVIDOR, ANTES DE ENCOSTAR NO BANCO. O gesto comum não é o ataque: é
// colar um parágrafo de outro contrato, de um e-mail ou de uma página — e junto vêm script,
// rastreador e `onerror=`, que iriam direto para o Chromium que gera o PDF.
//
// ⚠️ ESTA ROTA É SÓ A PORTA DO HUB (16/09/2026). Validar, faxinar e gravar moram em
// `salvarEdicaoDoContrato` e `descartarEdicaoDoContrato` (`lib/temis/contrato-servico.ts`), as
// mesmas funções de `/api/incorporador/temis/contrato/edicao`. O nome de quem alterou vem do portão
// (`ApoloAuthResult.nome`, lido de `hub_users` como antes).

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export async function PUT(request: Request) {
  const autorizacao = await autorizarAlteracaoManualDoContrato(request);
  if (!autorizacao.ok) return autorizacao.response;

  return salvarEdicaoDoContrato(atorDoHub(autorizacao, "coordenacao"), request);
}

/** Joga fora a alteração manual: o contrato volta a ser o texto da minuta. */
export async function DELETE(request: Request) {
  const autorizacao = await autorizarAlteracaoManualDoContrato(request);
  if (!autorizacao.ok) return autorizacao.response;

  return descartarEdicaoDoContrato(atorDoHub(autorizacao, "coordenacao"), request);
}
