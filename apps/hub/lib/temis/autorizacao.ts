import { NextResponse } from "next/server";

import {
  type ApoloAuthResult,
  authorizeApoloCoordenacao,
  authorizeApoloRead,
} from "@/lib/apolo/auth";
import { createApoloAdminClient } from "@/lib/apolo/server";

// QUEM EMITE CONTRATO — o portão da Têmis, num lugar só.
//
// Lucas, 08/09/2026, com o portal comercial da Gurgel aberto no perfil de coordenador, vendo o
// botão "Gerar e guardar o contrato" no rodapé da prévia: *"estou como coordenador, não pode ter
// esse botão de gerar contrato, isso é somente o time administrativo interno"*. E a régua:
// *"para o perfil da gurgel, comercial, pode tirar. Na Têmis só quem tiver relacionado ao setor de
// contratos e os admin"*.
//
// ⚠️ ESCONDER O BOTÃO NÃO FECHA A PORTA. `/api/temis/contrato/gerar` é uma rota HTTP como outra
// qualquer: quem tem sessão a chama do console do navegador, sem passar pela tela. Tirar o botão
// resolve o que o coordenador VÊ; quem resolve o que ele PODE é esta função.
//
// ⚠️ ESTE ARQUIVO É O PONTO ÚNICO, E É DE PROPÓSITO. A etapa 2 (Lucas, mesma conversa: "só quem
// tiver relacionado ao setor de contratos") troca o recorte por papel do Hub por "tem `temis:manage`
// ou é admin", lido de `hub_permissions` — e a troca é dentro DESTAS duas funções, sem varrer rota
// por rota. `hub_permissions` ficou de fora agora porque foi MEDIDO: `temis` nem está cadastrado
// como recurso, a tabela de concessões está vazia e o único leitor dela é o Ares
// (`financeiro-view`/`financeiro-manage`) — ligar a checagem hoje trancaria a Têmis inteira,
// inclusive para quem tem que emitir.
//
// ⚠️ E HOJE ISTO NÃO TIRA NINGUÉM DE DENTRO — saber disso evita concluir que a trava foi provada em
// produção. Medido em `hub_users` (08/09/2026): dos 7 usuários ATIVOS, 2 são `admin` e 5 são
// `leader`; zero `operator` e zero `viewer`. O recorte da coordenação é a garantia para o dia em que
// existir um operador; o que muda hoje, na tela do Lucas, é o botão sair do portal.
//
// ⚠️ O COORDENADOR DO PORTAL NÃO ENTRA POR AQUI. Ele vem pelo cookie `apolo_inc`
// (`apolo_incorporador_usuarios` — 2 usuários no portal comercial da Gurgel, medido em 08/09/2026),
// que é outra sessão, com escopo por empreendimento assinado no login. Ver a nota de
// `lib/apolo/incorporador/sessao.ts`: a porta do Apolo não é a porta de quem vem de fora.

/**
 * EMITIR: cria o PDF, grava no bucket e abre linha em `hercules_documentos`. Recorte da
 * coordenação (admin + leader) — o `operator`/analista não emite contrato.
 *
 * ⚠️ NÃO É `authorizeApoloWrite`. Escrever no Apolo (importar CAD, mexer na esteira) é trabalho de
 * analista; emitir contrato é ato jurídico com número de versão e nome de quem gerou impresso na
 * gaveta. São dois "escrever" diferentes, e o segundo é mais estreito.
 */
export function autorizarEmissaoDeContrato(request: Request): Promise<ApoloAuthResult> {
  return authorizeApoloCoordenacao(request);
}

/**
 * ABRIR/LISTAR o que já foi emitido. Continua na leitura do Apolo, de propósito.
 *
 * ⚠️ VER UM CONTRATO JÁ GERADO NÃO É GERAR CONTRATO, e é exatamente o que o comercial faz na tela
 * de prévia: conferir. Fechar esta leitura no recorte da emissão apagaria "Abrir o contrato
 * guardado" do rodapé e, na Têmis, faria o botão de emitir mentir — é a lista por proposta que o faz
 * dizer "Gerar a versão 2" em vez de criar a v2 às escondidas.
 *
 * ⚠️ E NÃO ABRE PORTA NOVA: as mesmas linhas de `hercules_documentos` já são lidas com esta mesma
 * régua pela aba Documentos da venda e pela ficha do cliente no Apolo. O recorte que impede um id
 * qualquer de virar link assinado é o `tipo = contrato`, em `abrirContratoGuardado`.
 */
export function autorizarLeituraDeContrato(request: Request): Promise<ApoloAuthResult> {
  return authorizeApoloRead(request);
}

/** A permissão que dá o direito de reescrever cláusula. Catalogada pela migration 0184. */
export const PERMISSAO_ALTERAR_CONTRATO = "temis-contrato-editar";

/**
 * ALTERAR O CONTRATO À MÃO: mais estreito que emitir, e nominal.
 *
 * Lucas, 21/09/2026: *"quem pode editar é a Nivea Careli e Northon Nascimento"*.
 *
 * ⚠️ PAPEL NÃO RECORTA ESSAS DUAS PESSOAS. Medido no mesmo dia: a Nívea é `admin` e o Northon é
 * `leader`. "Só admin" deixaria o Northon — o Analista de Contratos — de fora; "admin + leader"
 * (a régua de emitir) arrasta mais cinco pessoas junto. Por isso a lista é uma PERMISSÃO
 * CONCEDIDA, o mesmo mecanismo que a migration 0164 usou para a Raiane no Setup: entra e sai
 * gente com uma linha no banco, sem deploy e sem mexer em papel nenhum.
 *
 * ⚠️ E É UMA FUNÇÃO NOVA, NÃO UM APERTO EM `autorizarEmissaoDeContrato`. Aquela guarda outras
 * seis portas (gerar o PDF, mandar assinar, trocar signatário, mexer no card, escrever na
 * conversa e o `podeEmitir` que a tela recebe). Estreitá-la fecharia tudo isso para duas
 * pessoas, e ainda esconderia de quem EMITE o texto que o PDF vai imprimir — conferir o
 * contrato alterado continua sendo trabalho da coordenação inteira.
 *
 * ⚠️ O PORTAL DO INCORPORADOR NÃO PASSA POR AQUI, de propósito: lá a sessão vem do cookie
 * `apolo_inc` (`apolo_incorporador_usuarios`), gente que nem existe em `hub_users`. A decisão
 * do Lucas é sobre o time da Careli; quem confecciona no portal segue como estava.
 */
export async function autorizarAlteracaoManualDoContrato(
  request: Request,
): Promise<ApoloAuthResult> {
  return comPermissaoDeContrato(
    request,
    "Alterar o contrato à mão é do time de contratos. Peça a alteração a quem tem esse acesso.",
  );
}

/**
 * CANCELAR O CONTRATO PELA TÊMIS: a MESMA régua de quem altera o contrato à mão.
 *
 * Lucas (23/09/2026): *"coloca por favor um botão de cancelamento de contrato na temis"*.
 *
 * ⚠️ É A RÉGUA NOMINAL, E NÃO A DA COORDENAÇÃO, porque cancelar é pelo menos tão grave quanto
 * editar. Editar reescreve uma cláusula de um contrato que continua vivo; cancelar mata o contrato,
 * cancela o envelope na Clicksign (quem já assinou perde o que assinou), derruba a venda e solta o
 * lote para outra pessoa comprar. Se a casa decidiu que a frase do contrato só duas pessoas mudam
 * (Nívea e Northon, 21/09/2026), a morte dele não pode ser mais barata — e as sete pessoas da
 * coordenação continuam podendo tudo o que podiam: emitir, mandar assinar, voltar para análise,
 * indeferir e concluir um pedido de cancelamento que nasceu no Hércules.
 *
 * ⚠️ E É A MESMA PERMISSÃO, `temis-contrato-editar`, e não uma segunda concessão. Uma permissão nova
 * exigiria migration e nasceria concedida a ninguém: no dia do deploy o botão não funcionaria para
 * pessoa nenhuma, e quem fosse investigar acharia a tela quebrada. Entra e sai gente das duas
 * capacidades com a mesma linha em `hub_user_permissions`. Se um dia elas tiverem de separar, a
 * troca é DENTRO desta função.
 */
export async function autorizarCancelamentoDoContrato(
  request: Request,
): Promise<ApoloAuthResult> {
  return comPermissaoDeContrato(
    request,
    "Cancelar o contrato é do time de contratos. Peça o cancelamento a quem tem esse acesso.",
  );
}

/** A sessão do hub MAIS a permissão nominal do contrato, com a frase de quem chamou na recusa. */
async function comPermissaoDeContrato(
  request: Request,
  recusaSemPermissao: string,
): Promise<ApoloAuthResult> {
  // Primeiro a sessão: quem não entrou, ou está desativado, para aqui — e sem consultar nada.
  const sessao = await authorizeApoloRead(request);
  if (!sessao.ok) return sessao;

  const sb = createApoloAdminClient();
  if (!sb) return recusa("Não foi possível conferir o acesso agora.", 503);

  // ⚠️ LEITURA PELO ADMIN CLIENT, E NÃO POR POLICY. `hub_user_permissions` tem RLS ligada e ZERO
  // policies desde a 0001 (só o service role lê), e é assim que tem de ficar: uma policy de
  // leitura ali abriria a lista de quem pode o quê para todo mundo. Mesmo padrão do Ares.
  const { data, error } = await sb
    .from("hub_user_permissions")
    .select("permission_id")
    .eq("user_id", sessao.userId)
    .eq("permission_id", PERMISSAO_ALTERAR_CONTRATO)
    .is("revoked_at", null)
    .limit(1)
    .maybeSingle();

  // ⚠️ NÃO CONSEGUIR CONFERIR NÃO É "PODE". Banco fora do ar responde 503; liberar por omissão
  // transformaria uma queda de infraestrutura em permissão de reescrever contrato.
  if (error) {
    console.error("[temis][edicao] falha ao conferir a permissão", error.message);
    return recusa("Não foi possível conferir o acesso agora.", 503);
  }

  if (!data) return recusa(recusaSemPermissao, 403);

  return sessao;
}

/** A recusa desta porta sai com `erro` (e não `error`): é o campo que as telas do contrato leem. */
function recusa(mensagem: string, status: number): ApoloAuthResult {
  return { ok: false, response: NextResponse.json({ erro: mensagem }, { status }) };
}
