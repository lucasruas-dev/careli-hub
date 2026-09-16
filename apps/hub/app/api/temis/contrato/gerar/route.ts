import {
  autorizarEmissaoDeContrato,
  autorizarLeituraDeContrato,
} from "@/lib/temis/autorizacao";
import { contratosGuardados, gerarContratoDaProposta } from "@/lib/temis/contrato-servico";
import { atorDoHub } from "@/lib/temis/ator";

// O CONTRATO VIRA ARQUIVO — o passo que faltava depois da prévia.
//
// Até 08/09/2026 a cadeia parava aqui: `/api/temis/contrato/previa` montava o contrato preenchido,
// a tela mostrava, e nada ficava. Esta rota fecha o elo: mesmo HTML, PDF, bucket, linha em
// `hercules_documentos` — e o card da Têmis passa a apontar para o papel.
//
// ⚠️ O HTML É O MESMO DA PRÉVIA, E ISSO É O PONTO INTEIRO. As duas rotas chamam
// `montarContratoDaProposta`; nenhuma delas sabe montar contrato sozinha. Se esta rota tivesse a
// própria montagem, aprovar na tela deixaria de dizer alguma coisa sobre o que foi impresso — e a
// divergência apareceria meses depois, num contrato assinado.
//
// ⚠️ E O CONVERSOR TAMBÉM É UM SÓ (`gerarPdfDoHtml`). `/api/temis/pdf` é a porta do NAVEGADOR para
// o mesmo conversor: ela recebe HTML e devolve bytes, sem guardar nada. Guardar por lá exigiria
// aceitar o HTML de quem chama como sendo "o contrato" — quer dizer, deixar o navegador ditar o
// conteúdo do papel que vai a cartório. Aqui o HTML nasce no servidor, da minuta publicada.
//
// ⚠️ `runtime = "nodejs"` E O TETO DE 300s pelo mesmo motivo de `/api/temis/pdf`: o Chromium é um
// processo do sistema operacional, e descompactar o binário na primeira invocação da instância
// custa segundos.
//
// ⚠️ ESTA ROTA PRECISA DAS QUATRO LINHAS DO `next.config.ts` (`outputFileTracingIncludes`), como a
// irmã. Sem elas a função sobe com o código do `@sparticuz/chromium` e SEM o binário, e a única
// evidência é um erro em produção numa rota que funciona perfeitamente na máquina de quem
// desenvolveu — onde o Chrome é o do sistema.
//
// ⚠️ ESTA ROTA É SÓ A PORTA DO HUB (16/09/2026). Montar, imprimir, guardar e mover o card moram em
// `gerarContratoDaProposta` e `contratosGuardados` (`lib/temis/contrato-servico.ts`) — as mesmas
// funções que o portal do incorporador chama por `/api/incorporador/temis/contrato/gerar`. O que
// continua aqui é a régua do hub: quem emite e quem só confere.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * ⚠️ EMITIR CONTRATO NÃO É A MESMA PORTA DE CONFERIR CONTRATO — e até 08/09/2026 era. Esta rota
 * autorizava com `authorizeApoloRead`, o papel mais baixo que existe, justificada assim: "o botão
 * mora na tela onde a prévia já abriu; se a geração exigisse um papel maior, quem consegue conferir
 * não conseguiria gerar". O raciocínio está errado para este caso, e o Lucas apontou por que ao ver
 * o botão no portal comercial da Gurgel: *"estou como coordenador, não pode ter esse botão de gerar
 * contrato, isso é somente o time administrativo interno"*. Conferir e emitir são de gente
 * diferente; que as duas coisas caibam na mesma tela não faz delas o mesmo direito.
 *
 * ⚠️ QUEM DECIDE É `autorizarEmissaoDeContrato`, E É O ÚNICO LUGAR (`lib/temis/autorizacao.ts`) —
 * a etapa 2 troca o recorte por permissão (`temis:manage`) lá dentro, sem voltar aqui.
 *
 * ⚠️ O NOME DE QUEM GEROU VEM DO PORTÃO. Até 16/09/2026 esta rota relia `hub_users.display_name`
 * depois do PDF; o portão do Apolo já lê a mesma coluna para autorizar e devolve o nome junto
 * (`ApoloAuthResult.nome`). Mesma fonte, uma ida ao banco a menos — e o portal, que não tem linha em
 * `hub_users`, passa o nome da sessão pelo mesmo caminho.
 */
export async function POST(request: Request) {
  const autorizacao = await autorizarEmissaoDeContrato(request);
  if (!autorizacao.ok) return autorizacao.response;

  return gerarContratoDaProposta(atorDoHub(autorizacao, "coordenacao"), request);
}

/**
 * O que já foi gerado desta proposta (`?proposta=`), ou o link para abrir um deles (`?documento=`).
 *
 * ⚠️ A LISTA EXISTE PARA A TELA SABER O QUE ELA VAI FAZER ANTES DE FAZER. Sem ela, o botão diz
 * "Gerar contrato" mesmo quando já existe uma versão guardada, e quem clica descobre que criou a v2
 * depois de criada — num documento jurídico, essa é a ordem errada de descobrir.
 *
 * ⚠️ O GET NÃO SOBE PARA O RECORTE DO POST, E A ASSIMETRIA É A DECISÃO. Abrir o contrato que já
 * existe é conferência — é o que o comercial faz na prévia, e é o botão "Abrir o contrato guardado"
 * que continua no rodapé do portal. Fechar esta leitura junto com a emissão apagaria esse botão e
 * faria o botão da Têmis mentir sobre a versão, sem esconder nada: as mesmas linhas de
 * `hercules_documentos` já abrem com esta régua na aba Documentos da venda e na ficha do cliente no
 * Apolo. O que impede um id qualquer de virar link assinado é o `tipo = contrato`, em
 * `abrirContratoGuardado` — e não o papel de quem pede.
 */
export async function GET(request: Request) {
  const autorizacao = await autorizarLeituraDeContrato(request);
  if (!autorizacao.ok) return autorizacao.response;

  return contratosGuardados(atorDoHub(autorizacao, "leitura"), request);
}
