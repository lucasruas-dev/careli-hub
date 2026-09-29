// A CAD DO TITULAR ESTÁ APROVADA? — a barra do CONTRATO, uma só para todas as portas.
//
// Lucas (26/09/2026): *"faz uma barra, para enviar para contrato precisa da cad validada"*.
//
// ⚠️ A TRAVA NÃO SUMIU, ELA SE DESLOCOU — e é isso que este arquivo existe para dizer. Minutos
// antes, no mesmo dia, o Lucas afrouxou a PROPOSTA: *"pode deixar os coordenadores emitirem proposta
// sem a cad esta credenciada. ela pode estar em validacao ou em qualquer outro estagio"*. A proposta
// nasce com a CAD em andamento; o CONTRATO só sai com a CAD aprovada. São duas perguntas diferentes
// na mesma régua, e é por isso que `credenciadoParaVender` tem DOIS campos de resposta:
//   • `podeGerarProposta` → "pode montar a proposta financeira" (afrouxado pelo modo do coordenador);
//   • `credenciado`       → "a CAD está aprovada" (a verdade sobre a etapa real).
// ⚠️ ESTA BARRA LÊ `credenciado`, NUNCA `podeGerarProposta`. Ler o segundo aqui faria a barra nascer
// já aberta para exatamente as pessoas que ela existe para deter: as que o afrouxamento da proposta
// deixou passar. E o MODO fica no default APERTADO, sem `cadEmAndamentoLibera`.
//
// ⚠️ "CAD VALIDADA" É A ETAPA `credenciado`, E NÃO A ETAPA `validacao`. Conferido no código antes de
// escrever uma linha: `ETAPA_QUE_LIBERA = "credenciado"` (`cliente-credenciado.ts:43`) e o rótulo de
// `validacao` é "em validação de cadastro" (`cliente-credenciado.ts:~197`) — ou seja, `validacao`
// quer dizer "EM validação", que é justamente a etapa que o Lucas acabou de liberar para a proposta.
// Nada no código contradiz essa leitura.
//
// ⚠️ O ESCOPO SAI DA UNIDADE, NÃO DE `hercules_propostas.empreendimento_id` — e isto é MEDIDO, não
// preferência. Em 26/09/2026 (produção `bxgukywoxgivlrhjkwjx`, só SELECT):
//   select p.etapa, count(*),
//          count(*) filter (where p.empreendimento_id is null) as sem_emp,
//          count(*) filter (where p.unidade_id is null) as sem_unidade,
//          count(*) filter (where u.enterprise_id is null) as sem_ent
//     from hercules_propostas p left join hercules_unidades u on u.id = p.unidade_id
//    where p.workspace_id='careli' and p.aberta
//      and p.etapa in ('proposta','contrato','assinatura','faturado') group by 1;
//     → assinatura 422 (26 sem_emp), contrato 23 (5 sem_emp), faturado 2037 (2 sem_emp),
//       proposta 7 (0 sem_emp) — e **0 sem_unidade e 0 sem_ent em TODAS as etapas**.
// Ou seja: 33 propostas vivas não têm `empreendimento_id`, e 100% delas têm unidade com
// `enterprise_id`. Pendurar a barra na coluna da proposta transformaria essas 33 em 503 na cara do
// operador (escopo vazio é `FalhaAoLerCredenciamento`, por decisão de `cliente-credenciado.ts`);
// pendurada na unidade, elas recebem a resposta de verdade.
//
// ⚠️ E O ESCOPO É EXPANDIDO (FAMÍLIA + GRUPO), o que é a maior armadilha deste lote. A CAD mora no
// PAI ou no GRUPO do catálogo; a venda mora no FILHO. Medido em 26/09/2026: dos 13 cards de contrato
// vivos da Têmis, só 4 casam pelo `enterprise_id` exato — comparar id com id barraria 9 clientes
// CREDENCIADOS, e isso é pior que não ter barra nenhuma. `escopoDeQuemVende` é a mesma expansão que
// a rota `/venda` já usa (`familiaDoEmpreendimento` + `comIdsDoGrupo`).
//
// ⚠️ AQUI O GRUPO NÃO DEPENDE DA SESSÃO, e é de propósito. `escopoDaEsteiraDoPortal` reduz o escopo
// pela sessão porque lá a pergunta é "este portal pode LER pessoas de glebas alheias". Aqui a
// pergunta é "esta CAD está aprovada", a unidade já foi conferida contra a sessão por quem chama, e
// duas das quatro portas (a Têmis e o envio) não têm sessão de portal nenhuma. Reduzir o escopo aqui
// só produziria recusa falsa — o erro caro.
//
// ⚠️ ERRO DE LEITURA É 503, NUNCA RECUSA (o mesmo fail-closed de `cliente-credenciado.ts`). Um blip
// de rede que virasse "a CAD deste cliente não está aprovada" mandaria o coordenador discutir com a
// coordenação um problema que é nosso, e acusaria o cliente de algo que ninguém mediu.
//
// ⚠️ ONDE ELA ALCANÇA, DITO COMO O CÓDIGO FAZ E NÃO COMO SERIA BONITO. A versão anterior deste
// cabeçalho dizia "vale para a TRANSIÇÃO, nunca para o passado", e isso era FALSO em duas das quatro
// portas:
//   • `app/api/incorporador/venda/contrato/route.ts` e `marcarAtividade` agem só na PASSAGEM (de
//     `proposta` para `contrato`, e no avanço do estágio do card) — ali a frase valia;
//   • `gerarContratoDaProposta` e `prepararEnvio` são chamadas TAMBÉM sobre venda que já está em
//     `contrato` ou em `assinatura`: a v2 do contrato depois de um retorno para correção, e o
//     reenvio do envelope cujo passo notificar falhou passam pelas duas, e a barra os alcança.
// Medido em 26/09/2026 (`bxgukywoxgivlrhjkwjx`, só SELECT): existem 13 propostas com contrato vivo em
// `hercules_documentos` e 13 de 13 têm a CAD `credenciado` no escopo expandido, então ninguém é
// alcançado hoje. ⚠️ PERGUNTA ABERTA PARA O LUCAS, relatada e não decidida aqui: o REENVIO de um
// contrato já emitido deve ser alcançado pela barra? Se a resposta for não, o recorte é "não barrar
// quando já existe contrato vigente ou envelope anterior desta proposta", e ele entra nessas duas.
//
// ⚠️ E ELA NUNCA ENTRA NO REFLEXO que apenas registra o que já aconteceu (`refletirCardNaVenda`,
// `concluirAssinaturaDoCard`): ali o fato é passado, e regra nova não alcança o passado sem decisão
// explícita do Lucas.
//
// ⚠️ E ELA NÃO ALCANÇA O CARD QUE DESFAZ A VENDA. `cancelamento`, `cancelamento_correcao`, `cessao` e
// `distrato` nascem com o `propostaId` da própria venda (`lib/temis/cancelar-contrato-servico.ts:685`)
// e o painel "Quem assina" é servido para os quatro tipos que assinam
// (`modules/temis/blocks/trabalho/tela-de-trabalho.tsx:2203` com `EXIGE_ASSINATURA`,
// `lib/temis/trabalhos.ts:145`). Sem recorte de tipo, uma CAD em revisão travaria o DISTRATO daquela
// venda, e com a frase mandando "pedir o credenciamento" sobre um documento que ENCERRA a venda — o
// oposto do pedido do Lucas, que barrou a venda nascer e não a venda ser desfeita. Quem faz o recorte
// é `oAtoEDaCompraEVenda`, e ele vale nas três portas que enxergam o card.

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  catalogoDeEmpreendimentos,
  GRUPOS_DO_CATALOGO,
} from "@/lib/apolo/catalogo-empreendimentos";
import { ESTAGIOS_ENCERRADOS, type TipoDeTrabalho } from "@/lib/temis/trabalhos";

import { carregarCadastroDeEmpreendimentos } from "./cadastro";
import { credenciadoParaVender, FalhaAoLerCredenciamento } from "./cliente-credenciado";
import { escopoDeQuemVende } from "./quem-pode-vender";

// Só o `from` é usado — a mesma porta estreita de `cliente-credenciado.ts`, e é ela que permite
// testar com um cliente falso e conviver com o admin client do Apolo e com um SupabaseClient cru.
type ClienteDeLeitura = Pick<SupabaseClient, "from">;

/**
 * O COMPRADOR DA CARTEIRA PASSA PELA BARRA DO CONTRATO? SIM — e está escrito como booleano para que
 * invertê-lo seja UMA LINHA, com um teste dizendo o que muda.
 *
 * ⚠️ ISTO É A PERGUNTA QUE A JUNÇÃO DE 26/09/2026 OBRIGOU A RESPONDER, e ela não foi decidida por
 * mim: foi implementada na leitura mais coerente com as DUAS frases do Lucas do mesmo dia, e vai ao
 * Lucas como pergunta. As duas frases são:
 *   • *"tem um cliente que é comprador, mas não está dando para ele comprar mais uma unidade [...]
 *     temos que aproveitar esses cadastros de comprador"* — a porta da carteira;
 *   • *"faz uma barra, para enviar para contrato precisa da cad validada"* — esta barra.
 *
 * ⚠️ A LEITURA QUE FICOU VALENDO: a carteira SUBSTITUI a CAD, ela não a dispensa. É o que
 * `cliente-credenciado.ts` declara no topo (*"a prova que SUBSTITUI a CAD quando ela não existe"*), e
 * o próprio sistema já age assim: a CAD do comprador da carteira NASCE na etapa `credenciado` na
 * gravação da proposta (`cad-do-comprador.ts:114`, com `origem = 'comprador_da_carteira'`). Logo,
 * quando esta barra roda — dias depois, sobre uma proposta já gravada — ela encontra uma CAD
 * credenciada de verdade na esteira. Recusar aqui daria dois vereditos diferentes para o mesmo fato,
 * e o segundo seria impossível de explicar ao coordenador.
 *
 * ⚠️ O QUE ISSO ALCANÇA, MEDIDO (`bxgukywoxgivlrhjkwjx`, só SELECT, 26/09/2026) — e o número grande
 * é de gente que PODE vir, não de gente barrada hoje:
 *   • 1.476 pessoas têm contrato `faturado` ativo numa família e NENHUMA CAD nessa família (1.509
 *     pares pessoa×família). São elas que a porta alcança de agora em diante.
 *
 * ⚠️ E SÃO OITO AS PROPOSTAS VIVAS QUE ESTA DECISÃO JÁ ALCANÇA — a versão anterior deste comentário
 * dizia ZERO, e isso era FALSO. Medido por mim (`bxgukywoxgivlrhjkwjx`, só SELECT, 26/09/2026), com
 * a família por `coalesce(pai_id, id)` em `hercules_empreendimentos`, o faturado ativo por
 * `etapa='faturado' and cancelada_em is null and cancelamento_pedido_em is null`, e a pessoa por
 * `cliente_documento` OU por item de `compradores` (`documento`/`cpf`):
 *   → 8 propostas em `assinatura`, todas do empreendimento 30 (Lagoa dos Anjos, código LAG1), todas
 *     do CNPJ 30.098.403/0001-86 (PREMOLL CONSTRUCOES E ENGENHARIA LTDA), unidades ADTC0704, 0705,
 *     0706, 0707, 0801, 0802, 0803 e 0813. Todas com ZERO CAD no escopo e todas com faturado ativo
 *     na MESMA família: a unidade irmã ADTC0410, da carga do C2X.
 *
 * ⚠️ E ELAS CONTINUAM BARRADAS HOJE, MAS NÃO PELO MOTIVO QUE ALGUÉM SUPORIA LENDO ISTO: a entidade
 * do CNPJ da PREMOLL NÃO EXISTE no Apolo (medido: 0 por `apolo_entities.document_hash` e 0 por
 * `apolo_entity_identifiers.value_hash`, com
 * `encode(digest('apolo-identifier:cnpj:30098403000186','sha256'),'hex')`), então
 * `credenciadoParaVender` para antes, em *"Este CNPJ não tem cadastro no Apolo"*, e a carteira nem é
 * lida. A margem de segurança é UM SYNC DE CNPJ DE DISTÂNCIA, e `compra-ativa.ts:45` registra essa
 * ficha faltando como gap conhecido: dos 68 faturados ativos de CNPJ, 63 têm a entidade sem
 * identificador `cnpj`.
 *
 * ⚠️ LOGO, ESTE É O GATILHO, ESCRITO PARA NINGUÉM SER PEGO DE SURPRESA: no dia em que a ficha da
 * PREMOLL ganhar o CNPJ, estas 8 propostas de PJ em `assinatura` PASSAM A SER LIBERADAS pela barra
 * sem novo deploy e sem ninguém ter decidido de novo. É por isso que a pergunta vai ao Lucas com
 * este recorte: ele não está decidindo só sobre o futuro, está decidindo sobre 8 contratos de PJ da
 * carga do C2X que já estão em assinatura.
 *
 * ⚠️ E AS DUAS PROPOSTAS EM ETAPA `proposta` QUE ESTA BARRA PEGA HOJE NÃO ENTRAM PELA CARTEIRA
 * (medido, mesmo dia): CDJ7 CDJ0403 (ADALBERTO ANDRADE VILARINO, empreendimento 22) e MDB1 MDB1306
 * (JUSSARA SILVA DE ALVARENGA DUARTE, empreendimento 21) têm 0 CAD no escopo e 0 faturado ativo na
 * família. Para elas a barra continua sendo a resposta, com ou sem carteira.
 *
 * ⚠️ `false` AQUI BARRARIA OS DOIS CASOS, e não só um: tanto quem passou pelo contrato lido agora
 * quanto quem já tem a CAD nascida da carteira, porque `origem` vale `comprador_da_carteira` nos dois
 * (`cliente-credenciado.ts`). É de propósito: se a carteira não serve para o contrato, a CAD que ela
 * abriu também não serve — ela não passou pela análise da coordenação.
 *
 * ⚠️ E O TIPO É `boolean` DE PROPÓSITO, não o literal que o TypeScript inferiria. Sem a anotação o
 * compilador estreita para `true`, o ramo da recusa em `recusaPelaCarteira` fica PROVADAMENTE
 * inalcançável e nenhum teste consegue exercitá-lo: a "uma linha" prometida ao Lucas seria uma linha
 * mais um caminho que nunca rodou. Com `boolean`, `recusaPelaCarteira` é pura e os dois valores são
 * testados (`juncao-carteira-e-cad-em-andamento.test.ts`).
 */
export const A_CARTEIRA_VALE_PARA_O_CONTRATO: boolean = true;

/** A frase da recusa quando `A_CARTEIRA_VALE_PARA_O_CONTRATO` for desligado. */
const FRASE_DA_CARTEIRA_RECUSADA =
  "Este cliente entrou na proposta como comprador da carteira (contrato ativo neste empreendimento), e não por uma CAD analisada pela coordenação.";

/** O que fazer quando a CAD não está aprovada — a frase e o código HTTP, juntos. */
export type RecusaDaCadParaContrato = {
  erro: string;
  /** A etapa real da CAD, quando existe. Para o log e para a tela; `null` = não há CAD no escopo. */
  etapa: null | string;
  /** 409 = a resposta é "não". 503 = não deu para perguntar (fail-closed). */
  status: 409 | 503;
};

/**
 * QUAL ATO FOI BARRADO — o contexto que a última oração da frase precisa.
 *
 * ⚠️ UMA FRASE SÓ DAVA A INSTRUÇÃO ERRADA EM TRÊS DAS QUATRO PORTAS, e isso é defeito medido, não
 * preferência de estilo. A frase terminava sempre com *"envie para contrato depois"*, que foi escrita
 * para a porta 1 (`app/api/incorporador/venda/contrato/route.ts`), onde a venda ainda está em
 * `proposta`. Nas outras três a venda JÁ ESTÁ em `contrato` e o card já existe na Têmis: a
 * administrativa que abre a tela de assinatura de uma venda em `contrato` lia "envie para contrato
 * depois" — um botão que não se aplica, para um estado que não é o atual, num ato que não é dela.
 *
 * ⚠️ O MIOLO CONTINUA UM SÓ (a etapa real e "o contrato só sai depois que a CAD for aprovada"). O que
 * muda é a ÚLTIMA ORAÇÃO, porque é ela que diz o que fazer, e a régua da casa é que a frase diga as
 * duas coisas.
 */
export type AtoBarradoPelaCad =
  | "enviar_para_contrato"
  | "gerar_contrato"
  | "mandar_para_assinatura"
  | "marcar_atividade";

/** O que fazer DEPOIS que a CAD for aprovada, em cada porta. */
const O_QUE_FAZER_DEPOIS: Record<AtoBarradoPelaCad, string> = {
  enviar_para_contrato: "envie para contrato depois",
  gerar_contrato: "gere o contrato depois",
  mandar_para_assinatura: "mande para assinatura depois",
  marcar_atividade: "marque a atividade depois",
};

/** O que acabou de ser barrado, para a frase do titular sem documento. */
const O_QUE_FOI_BARRADO: Record<AtoBarradoPelaCad, string> = {
  enviar_para_contrato: "enviar para contrato",
  gerar_contrato: "gerar o contrato",
  mandar_para_assinatura: "mandar para assinatura",
  marcar_atividade: "marcar a atividade",
};

/**
 * A frase da recusa.
 *
 * ⚠️ DIZ A ETAPA REAL E O QUE FAZER, e nunca só "não permitido" — a língua da casa. Quem lê é o
 * coordenador que acabou de montar a proposta com a CAD em andamento: ele precisa saber a quem
 * cobrar, não descobrir que existe uma parede.
 *
 * ⚠️ A CAD INDEFERIDA TEM RAMO PRÓPRIO, e é o único ramo que não podia ficar de fora. `indeferido` é
 * a DECISÃO FINAL de reprovar o cliente — é o que `LIBERA_COM_CAD_EM_ANDAMENTO_INTERNO` diz ao ser a
 * única etapa `false` (`cliente-credenciado.ts:73`, com a razão escrita em `:58` a `:62`). Mandar
 * *"peça o credenciamento à coordenação"* nesse caso é convidar o coordenador a abrir chamado e
 * insistir num cliente que a casa já reprovou, cobrando da coordenação uma decisão que ela acabou de
 * tomar. ⚠️ QUAL DAS DUAS SAÍDAS VALE É DECISÃO DO LUCAS (cancelar a venda ou reabrir o cadastro), e
 * por isso a frase apresenta as duas e manda levar o caso — ela não escolhe por ele. Medido em
 * 26/09/2026 (`bxgukywoxgivlrhjkwjx`, só SELECT): `select etapa, count(*) from apolo_esteira group by
 * 1` não devolve NENHUMA linha `indeferido`, então não há vítima hoje; a recusa existe para o dia em
 * que houver.
 */
function fraseDaRecusa(
  motivo: null | string,
  ato: AtoBarradoPelaCad,
  etapa: null | string,
): string {
  const oQueHa = motivo ?? "A CAD deste cliente ainda não está credenciada neste empreendimento.";
  if (etapa === "indeferido") {
    return `${oQueHa} A coordenação REPROVOU este cadastro, então não há credenciamento a pedir: ou a venda é cancelada, ou a coordenação reabre a CAD. Leve o caso à coordenação antes de qualquer coisa.`;
  }
  return `${oQueHa} O contrato só sai depois que a CAD for aprovada (etapa Credenciado). A proposta continua de pé: peça o credenciamento à coordenação e ${O_QUE_FAZER_DEPOIS[ato]}.`;
}

/** A frase do 503. Nunca acusa o cliente: diz que NÓS não conseguimos perguntar. */
const FRASE_DO_503 =
  "Não foi possível conferir agora se a CAD do titular está aprovada. Nada foi movido; tente de novo em instantes.";

/**
 * QUEM foi barrado, quando não é o titular.
 *
 * ⚠️ A BARRA PASSOU A OLHAR TODOS OS COMPRADORES, E SEM ISSO A FRASE MENTIRIA. Se a recusa vier do
 * cônjuge, dizer *"a CAD deste cliente"* manda a administrativa conferir a pessoa errada: ela abre a
 * ficha do titular, vê `credenciado`, e conclui que o sistema está com defeito.
 */
export type QuemFoiBarrado = { nome: null | string; papel: "co" | "titular" };

/** A recusa, com o nome de quem a causou na frente, quando não foi o titular. */
function comNome(
  recusa: RecusaDaCadParaContrato,
  quem: QuemFoiBarrado | undefined,
): RecusaDaCadParaContrato {
  if (!quem || quem.papel === "titular" || recusa.status === 503) return recusa;
  const dito = String(quem.nome ?? "").trim() || "o segundo comprador desta proposta";
  return { ...recusa, erro: `${dito} (co-comprador): ${recusa.erro}` };
}

/**
 * O comprador da carteira é recusado por esta barra? Pura, e é pura DE PROPÓSITO.
 *
 * ⚠️ ELA EXISTE PARA O RAMO DA RECUSA PODER SER TESTADO SEM O BANCO E SEM TROCAR A CONSTANTE. Com a
 * decisão lida direto de `A_CARTEIRA_VALE_PARA_O_CONTRATO` dentro da função assíncrona, o único teste
 * possível era `expect(A_CARTEIRA_VALE_PARA_O_CONTRATO).toBe(true)`, que CONGELA o valor em vez de
 * provar o comportamento: inverter a constante deixava a suíte vermelha nesse ponto e ligava, em
 * produção, um caminho que nunca havia rodado. Aqui o `vale` é PARÂMETRO, e os dois valores são
 * exercitados nos quatro atos (`juncao-carteira-e-cad-em-andamento.test.ts`).
 *
 * ⚠️ E ELA ALCANÇA OS DOIS CASOS DA CARTEIRA, como o comentário da constante promete: quem passou
 * pelo contrato lido agora (`etapa: null`) e quem já tem a CAD que a carteira abriu e está
 * `credenciado` — nos dois `origem` vale `comprador_da_carteira` (`cliente-credenciado.ts`).
 */
export function recusaPelaCarteira(
  veredito: { etapa: null | string; origem: null | string },
  ato: AtoBarradoPelaCad,
  vale: boolean,
): null | RecusaDaCadParaContrato {
  if (vale) return null;
  if (veredito.origem !== "comprador_da_carteira") return null;
  return {
    erro: `${FRASE_DA_CARTEIRA_RECUSADA} Leve o caso à coordenação para credenciar a CAD e ${O_QUE_FAZER_DEPOIS[ato]}.`,
    etapa: veredito.etapa,
    status: 409,
  };
}

/**
 * A CAD do titular está aprovada para este documento seguir para contrato?
 *
 * Devolve `null` quando pode seguir, e a recusa quando não pode. NÃO lança: a falha de leitura sai
 * como `status: 503`, para quem chama não precisar saber a diferença entre as duas.
 *
 * `enterpriseId` é o id do C2X da UNIDADE (cru) — a expansão de família e grupo é feita aqui dentro.
 *
 * ⚠️ A BARRA É INDEPENDENTE NO PORTAL COMERCIAL E NÃO É INDEPENDENTE NO PORTAL QUE CONFECCIONA, e
 * isto está escrito porque muda o que ela SIGNIFICA. Conferido em 26/09/2026:
 * `app/api/incorporador/board/[id]/etapa/route.ts:91` calcula `operaSozinho =
 * portalConfeccionaContrato(...)` e `:110`/`:116` liberam as ETAPAS DE DECISÃO da esteira —
 * `credenciado` entre elas — só para esse portal, sob `autorizarPortalQueOperaSozinho` mais
 * `conferirEtapaDeDecisao` (`:155`, que exige crédito aprovado e, com pré-venda ligada, PIX gerado). O
 * MESMO portal é o que confecciona e envia o contrato pelas rotas espelho. Efeito: a coordenadora do
 * comercial (a Gurgel) recebe 403 nessas etapas e é de fato PRESA pela barra; o `cecilio-rocha`
 * credencia o próprio cliente e emite no minuto seguinte, e a barra responde "sim" porque a esteira
 * foi escrita pela mesma equipe que pediu o contrato. Nenhuma trava é burlada: a barra simplesmente
 * não é independente ali. A exceção é decisão do Lucas de 16/09/2026. ⚠️ PERGUNTA ABERTA, levada a ele
 * e não decidida aqui: o credenciamento feito pela própria Cecílio continua valendo como aprovação
 * para o contrato dela?
 */
export async function recusaDaCadParaContrato(
  admin: ClienteDeLeitura,
  alvo: {
    documento: null | string;
    enterpriseId: null | string;
    /**
     * Quem está sendo conferido, quando NÃO é o titular — ver `QuemFoiBarrado`.
     *
     * ⚠️ AUSENTE QUER DIZER TITULAR, e é o comportamento de sempre: a frase sai exatamente como
     * saía antes desta junção para quem chama com um documento só.
     */
    quem?: QuemFoiBarrado;
  },
  ato: AtoBarradoPelaCad = "enviar_para_contrato",
): Promise<null | RecusaDaCadParaContrato> {
  const documento = String(alvo.documento ?? "").trim();
  const c2xId = String(alvo.enterpriseId ?? "").trim();

  // ⚠️ SEM EMPREENDIMENTO A PERGUNTA NÃO TEM RESPOSTA, e isso é 503 e não recusa — pela mesma razão
  // que `credenciadoParaVender` lança com escopo vazio: é bug de quem chama, não culpa do cliente.
  if (!c2xId) {
    console.error("[cad-para-contrato] unidade sem enterprise_id; não dá para conferir a CAD");
    return { erro: FRASE_DO_503, etapa: null, status: 503 };
  }

  // ⚠️ SEM DOCUMENTO, RECUSA — e esta é a única recusa que não vem da esteira. Uma proposta sem
  // documento do titular não tem pessoa para conferir, e deixá-la passar seria abrir a porta
  // justamente para a linha quebrada. É 409 (há o que consertar), não 503 (não é falha nossa).
  if (!documento) {
    return comNome(
      {
        erro: `Esta proposta está sem o CPF ou o CNPJ do titular, e sem ele não há CAD para conferir. Corrija o cliente da proposta antes de ${O_QUE_FOI_BARRADO[ato]}.`,
        etapa: null,
        status: 409,
      },
      alvo.quem,
    );
  }

  let escopo: string[];
  try {
    const [cadastro, catalogo] = await Promise.all([
      carregarCadastroDeEmpreendimentos(),
      catalogoDeEmpreendimentos(Date.now()),
    ]);
    // ⚠️ O GRUPO NÃO DEPENDE DO C2X ESTAR NO AR, E NÃO PRECISAVA DEPENDER. `catalogoDeEmpreendimentos`
    // NUNCA lança: devolve `cache?.valor ?? []` quando o pool do C2X não abre
    // (`lib/apolo/catalogo-empreendimentos.ts:93`) e quando a query falha (`:113`). Numa instância de
    // cache frio, o catálogo vazio fazia `escopoDeQuemVende` sobrar só com a FAMÍLIA, e a CAD que mora
    // no grupo era recusada por engano. O mapa de grupo, porém, é CONSTANTE DE CÓDIGO
    // (`ENTERPRISE_GROUPS`, `lib/guardian/c2x-analytics.ts:197`) e não dado do legado: `GRUPOS_DO_CATALOGO`
    // o entrega sem tocar no C2X, com a mesma regra de `agrupar` (`group:` mais o display) e os mesmos
    // `stageIds`. O critério de `comIdsDoGrupo` continua o de sempre: o grupo só entra quando a família
    // cobre TODAS as divisões dele.
    //
    // ⚠️ MEDIDO EM 26/09/2026 (`bxgukywoxgivlrhjkwjx`, só SELECT):
    //   select enterprise_id, etapa, count(*) from apolo_esteira where enterprise_id like 'group:%'
    //    group by 1,2;  → 2 linhas, as duas `group:Lagoa Bonita`, as duas `credenciado`.
    // ⚠️ NÃO CONFERIDO AQUI, e relatado pela revisão: que essas duas alcancem a proposta LBF C11 28
    // (Fábio Costa Chaves), já em etapa `contrato`. O elo CPF → CAD é por `value_hash`
    // (`apolo_entity_identifiers`) e não se faz em SQL solto. Conferido é que existem 2 CADs de grupo, e
    // que as duas estão `credenciado`: era 1 credenciado recusado por engano a cada instabilidade do
    // legado.
    escopo = escopoDeQuemVende(
      cadastro,
      catalogo.length > 0 ? catalogo : GRUPOS_DO_CATALOGO,
      c2xId,
    );
  } catch (erro) {
    // ⚠️ O CADASTRO QUE NÃO CARREGA É 503, NÃO É ESCOPO MENOR. Cair para `[c2xId]` aqui seria a
    // armadilha das 9 CADs no pai: a barra recusaria cliente credenciado num dia de PostgREST lento.
    // (`carregarCadastroDeEmpreendimentos` LANÇA em falha de leitura, de propósito — ver o JSDoc dela.)
    console.error("[cad-para-contrato] falha ao montar o escopo do empreendimento", erro);
    return { erro: FRASE_DO_503, etapa: null, status: 503 };
  }

  // ⚠️ E CONTINUA NÃO VIRANDO 503 QUANDO O CATÁLOGO VEM VAZIO, agora sem custo: o catálogo cai junto
  // com o C2X, e transformar isso em 503 CONGELARIA TODO CONTRATO DA CASA a cada instabilidade do
  // legado. Antes essa escolha custava 1 credenciado recusado por engano; com `GRUPOS_DO_CATALOGO` a
  // terceira saída está tomada, e o custo é zero.
  //
  // ⚠️ O QUE AINDA DEPENDE DO CATÁLOGO é o grupo que ele conhece e a constante NÃO: um grupo criado no
  // C2X depois desta lista. `ENTERPRISE_GROUPS` é escrita à mão (PAN-124), então divisão nova entra
  // nela junto com o `pai_id` do cadastro — e até entrar, o escopo dela é a família, como sempre foi.

  try {
    // ⚠️ SEM MODO: o default de `credenciadoParaVender` é o APERTADO, e é ele que queremos. Passar
    // `{ cadEmAndamentoLibera: true }` aqui abriria a barra para quem ela existe para deter.
    //
    // ⚠️ E COM A PORTA DA CARTEIRA LIGADA (o default de `alvo.compradorDaCarteira`), de propósito:
    // ver `A_CARTEIRA_VALE_PARA_O_CONTRATO`. Desligá-la aqui economizaria uma leitura mas faria a
    // barra responder sobre uma pessoa que a proposta já aceitou por outra régua, e `origem` voltaria
    // `null` justamente no caso em que ela é a única explicação.
    //
    // ⚠️ E ISSO CUSTA UMA LEITURA DA FAMÍLIA INTEIRA NA ABERTURA DO PAINEL "QUEM ASSINA", escrito
    // aqui porque o custo é REAL e não estava registrado em lugar nenhum. Esta barra roda dentro de
    // `prepararEnvio` (`lib/assinatura/envio-db.ts:124`), que é chamada TAMBÉM pelo GET de
    // `/assinatura/enviar?proposta=` (`lib/temis/assinatura-servico.ts:114`), com `no-store`: a cada
    // abertura e a cada recarga do painel. Sem CAD no escopo, `credenciadoParaVender` dispara
    // `lerContratosAtivos`, uma leitura paginada de TODOS os faturados da família com o embutido
    // `hercules_unidades!inner` e a coluna `compradores` (jsonb) inteira.
    // ⚠️ MEDIDO POR MIM (`bxgukywoxgivlrhjkwjx`, só SELECT, 26/09/2026), e o caso comum é justamente o
    // caro: 405 das 422 propostas em `assinatura` estão sem CAD no escopo. Faturados lidos por
    // abertura, por família (`etapa='faturado'`, sem cancelamento e sem pedido, agrupado pelo
    // `coalesce(pai_id,id)` do empreendimento da unidade): 473 na família dos empreendimentos 1 e 4,
    // 381 na dos 13/14/15, 265 na dos 7/10, 245 na dos 27/31/32/33, 182 na do 35 (Vale do Ouro). No
    // POST da proposta o mesmo se repete uma vez por co-comprador sem CAD
    // (`app/api/incorporador/venda/proposta/route.ts`, `cadDoCoComprador`).
    // ⚠️ NÃO REDUZIDO AQUI, E A RAZÃO É QUE AS DUAS SAÍDAS ÓBVIAS MUDAM COMPORTAMENTO: filtrar o
    // documento no BANCO perde o co-comprador cuja máscara no jsonb não é uma das duas previstas
    // (`compra-ativa.ts:184`) e a carteira pararia de valer para ele, calada; e desligar a porta no
    // GET faria a tela mostrar um impedimento que o POST não tem, acusando um cliente que passa. O
    // número fica registrado e vai ao Lucas; a casa já tem essa armadilha na memória ("D4Sign custo
    // na carga de tela").
    //
    // ⚠️ QUEM ESTA BARRA PEGA HOJE, MEDIDO POR MIM (`bxgukywoxgivlrhjkwjx`, só SELECT, 26/09/2026),
    // com o escopo montado como acima (família por `hercules_empreendimentos.pai_id`) e a entidade
    // achada pelos DOIS caminhos do hash (`apolo_entities.document_hash` e
    // `apolo_entity_identifiers.value_hash`, `encode(digest('apolo-identifier:cpf:'||doc,'sha256'),'hex')`):
    //   etapa `proposta`   → 7 vivas, 3 SEM CAD `credenciado` no escopo (2 sem CAD nenhuma:
    //                        ADALBERTO ANDRADE VILARINO no 22 e JUSSARA SILVA DE ALVARENGA DUARTE no
    //                        21, as duas herdadas do C2X em novembro de 2025; e 1 com CAD em
    //                        `revisao` no 35, LETICIA DE OLIVEIRA CAMPOS GOMES, que TEM contrato
    //                        faturado ativo na família e mesmo assim não entra pela carteira — quem
    //                        tem CAD é decidido pela CAD).
    //   etapa `assinatura` → 422 vivas, 405 sem CAD `credenciado` no escopo;
    //   etapa `contrato`   → 23 vivas, 13 sem CAD `credenciado` no escopo.
    //   ⚠️ E OITO dessas 418 TÊM contrato faturado ativo na família — a versão anterior desta linha
    //   dizia ZERO, e estava errada. São as 8 de `assinatura` do empreendimento 30, todas do CNPJ da
    //   PREMOLL (unidades ADTC0704/0705/0706/0707/0801/0802/0803/0813), e elas só continuam barradas
    //   porque a entidade do CNPJ não existe no Apolo. O SQL, o motivo e o gatilho estão em
    //   `A_CARTEIRA_VALE_PARA_O_CONTRATO`. ⚠️ NÃO CONFERI se as 418 chegam de fato a esta barra (elas só
    //   chegariam por `gerarContratoDaProposta`/`prepararEnvio`, a v2 e o reenvio) — são vendas da
    //   carga do C2X, e a medição de cima ("13 propostas com contrato vivo em `hercules_documentos`,
    //   13 de 13 credenciadas") olha um conjunto MENOR, o das nativas. O número maior está aqui para
    //   ser levado ao Lucas, não como afirmação de que 418 pessoas estão travadas hoje.
    //   ⚠️ E o escopo que medi não soma os ids `group:` do catálogo; existem 2 linhas `group:%` na
    //   esteira (as duas `group:Lagoa Bonita`, as duas `credenciado`), então o viés é de no máximo 2.
    const veredito = await credenciadoParaVender(admin, {
      documento,
      enterpriseIds: escopo.length > 0 ? escopo : [c2xId],
    });

    // ⚠️ O COMPRADOR DA CARTEIRA PASSA, E O RAMO EXISTE PARA DIZER ISSO EM VOZ ALTA. Sem ele a
    // resposta sairia a mesma (ele chega com `credenciado: true`), e quem lesse este arquivo não
    // saberia que a junção de 26/09/2026 decidiu isso — acharia que a barra nunca viu a pergunta. Ver
    // `A_CARTEIRA_VALE_PARA_O_CONTRATO`, onde a decisão e a medição estão escritas.
    const daCarteira = recusaPelaCarteira(veredito, ato, A_CARTEIRA_VALE_PARA_O_CONTRATO);
    if (daCarteira) return comNome(daCarteira, alvo.quem);

    if (veredito.credenciado) return null;

    return comNome(
      {
        erro: fraseDaRecusa(veredito.motivo, ato, veredito.etapa),
        etapa: veredito.etapa,
        status: 409,
      },
      alvo.quem,
    );
  } catch (erro) {
    if (erro instanceof FalhaAoLerCredenciamento) {
      console.error("[cad-para-contrato] não deu para ler o credenciamento", erro.message);
      return { erro: FRASE_DO_503, etapa: null, status: 503 };
    }
    console.error("[cad-para-contrato] falha inesperada ao conferir a CAD", erro);
    return { erro: FRASE_DO_503, etapa: null, status: 503 };
  }
}

/**
 * A mesma barra, a partir de uma PROPOSTA — a porta que a Têmis e o envio de assinatura usam.
 *
 * ⚠️ O ESCOPO VEM DA UNIDADE DA PROPOSTA, não de `empreendimento_id` (ver a medição no topo).
 *
 * ⚠️ PROPOSTA QUE NÃO EXISTE NÃO É RECUSA, É 503. Elo quebrado é defeito nosso; recusar por causa
 * dele congelaria um card sem ter medido nada, e é a mesma disciplina de `recusaPorVendaDesfeita`
 * (`lib/temis/trabalhos-db.ts`), que deixa passar a venda não encontrada e grita no log.
 */
export async function recusaDaCadDaProposta(
  admin: ClienteDeLeitura,
  propostaId: null | string,
  ato: AtoBarradoPelaCad = "enviar_para_contrato",
): Promise<null | RecusaDaCadParaContrato> {
  const alvo = String(propostaId ?? "").trim();
  // Card sem proposta vinculada (os de seed, e os abertos à mão pela Têmis) não tem titular para
  // conferir: a barra não inventa um.
  if (!alvo) return null;

  const { data, error } = await admin
    .from("hercules_propostas")
    .select("cliente_documento, compradores, unidade_id")
    .eq("workspace_id", "careli")
    .eq("id", alvo)
    .maybeSingle();

  if (error) {
    console.error("[cad-para-contrato] falha ao ler a proposta para conferir a CAD", {
      erro: (error as { message?: string }).message ?? null,
      proposta: alvo,
    });
    return { erro: FRASE_DO_503, etapa: null, status: 503 };
  }

  const proposta = data as null | {
    cliente_documento: null | string;
    compradores?: unknown;
    unidade_id: null | string;
  };
  if (!proposta) {
    console.error("[cad-para-contrato] proposta do card não existe no banco", { proposta: alvo });
    return null;
  }

  const { data: linhaDaUnidade, error: erroDaUnidade } = await admin
    .from("hercules_unidades")
    .select("enterprise_id")
    .eq("workspace_id", "careli")
    .eq("id", String(proposta.unidade_id ?? ""))
    .maybeSingle();

  if (erroDaUnidade) {
    console.error("[cad-para-contrato] falha ao ler a unidade da proposta", {
      erro: (erroDaUnidade as { message?: string }).message ?? null,
      proposta: alvo,
    });
    return { erro: FRASE_DO_503, etapa: null, status: 503 };
  }

  const unidade = linhaDaUnidade as null | { enterprise_id: null | string };
  const enterpriseId = unidade?.enterprise_id ?? null;

  // ⚠️ TODOS OS COMPRADORES, E NÃO SÓ O TITULAR — e sem isto a barra fechava METADE do caminho.
  // Ver `compradoresDaProposta` para a medição e para a frase do Lucas.
  for (const pessoa of compradoresDaProposta(proposta)) {
    const recusa = await recusaDaCadParaContrato(
      admin,
      { documento: pessoa.documento, enterpriseId, quem: pessoa },
      ato,
    );
    if (recusa) return recusa;
  }

  return null;
}

/**
 * Quem responde por esta proposta: o titular e os co-compradores, na ordem em que a barra pergunta.
 *
 * ⚠️ A BARRA SÓ OLHAVA O TITULAR, E A JUNÇÃO DE 26/09/2026 ACABOU DE AFROUXAR O CO-COMPRADOR. Este é
 * o buraco que o merge abriu, e ele é exato: a busca de proponentes passou a receber o MODO DO
 * COORDENADOR (`app/api/incorporador/venda/proponentes/route.ts:256`), então o cônjuge com a CAD em
 * `revisao` virou escolhível (a tela usa `podeGerarProposta`,
 * `modules/incorporador/hercules/ModalDeProposta.tsx:1787`). Antes do merge ele precisava estar
 * `credenciado` para ser escolhido, e por isso a barra não precisava vê-lo. Depois do merge precisa.
 *
 * ⚠️ E QUEM ASSINA SÃO TODOS: `montarSignatarios` percorre `dados.compradores` inteiro
 * (`lib/assinatura/signatarios.ts:71`) e põe cada um no envelope como `comprador`. A frase do Lucas
 * (26/09/2026) — *"faz uma barra, para enviar para contrato precisa da cad validada"* — vale para
 * quem assina, não para quem por acaso está na coluna `cliente_documento`.
 *
 * ⚠️ E ISSO NÃO ALCANÇA O PASSADO, MEDIDO ANTES DE ESCREVER (`bxgukywoxgivlrhjkwjx`, só SELECT,
 * 26/09/2026): existem 28 co-compradores de propostas vivas sem CAD `credenciado` no escopo (27 em
 * `assinatura`, 1 em `proposta`), e 28 de 28 estão em propostas cujo TITULAR já é barrado pela mesma
 * barra. Ou seja: zero vítimas novas hoje. O SQL casa a pessoa por `cliente_documento` ou por item de
 * `compradores` (`documento`/`cpf`), a família por `coalesce(pai_id, id)`, e o credenciamento pelos
 * dois caminhos do hash (`apolo_entities.document_hash` e `apolo_entity_identifiers.value_hash`).
 * Havia 173 CADs em `revisao` no mesmo dia: o caminho é usado.
 *
 * ⚠️ O TITULAR VEM PRIMEIRO, de propósito: quando os dois estão barrados, a frase que a
 * administrativa lê é a do titular, que é a que ela já esperava. E o co-comprador SEM DOCUMENTO
 * LEGÍVEL não entra: a régua de entrada da proposta (`conferirProposta`) já o barraria, e inventar
 * uma segunda recusa aqui transformaria dado torto da carga do C2X em parede calada.
 *
 * ⚠️ DOIS FORMATOS DE `compradores`, os mesmos de `compra-ativa.ts:184`: a carga do C2X grava
 * `documento` e a venda nativa grava `cpf`, com e sem máscara. A comparação é por dígitos, e o
 * documento repetido (titular listado também no array) é lido UMA vez.
 */
function compradoresDaProposta(proposta: {
  cliente_documento: null | string;
  compradores?: unknown;
}): Array<QuemFoiBarrado & { documento: string }> {
  const lista = Array.isArray(proposta.compradores)
    ? (proposta.compradores as Array<null | Record<string, unknown>>)
    : [];
  const digitos = (valor: unknown) => String(valor ?? "").replace(/\D/g, "");
  const saida: Array<QuemFoiBarrado & { documento: string }> = [];
  const vistos = new Set<string>();

  const juntar = (documento: string, nome: null | string, papel: "co" | "titular") => {
    if (!documento || vistos.has(documento)) return;
    vistos.add(documento);
    saida.push({ documento, nome, papel });
  };

  const noArray = lista.find((c) => c?.titular === true) ?? null;
  // ⚠️ O TITULAR ENTRA MESMO SEM DOCUMENTO: é ele que produz a recusa "esta proposta está sem o CPF
  // ou o CNPJ do titular", e sumir com ela deixaria a proposta quebrada passar calada.
  const doTitular = digitos(proposta.cliente_documento) || digitos(noArray?.documento ?? noArray?.cpf);
  vistos.add(doTitular);
  saida.push({
    documento: doTitular,
    nome: String(noArray?.nome ?? "").trim() || null,
    papel: "titular",
  });

  for (const c of lista) {
    if (!c || c.titular === true) continue;
    juntar(
      digitos(c.documento ?? c.cpf),
      String(c.nome ?? "").trim() || null,
      "co",
    );
  }

  return saida;
}

/**
 * Os tipos de card que NÃO são a compra e venda.
 *
 * ⚠️ TODOS OS QUATRO NASCEM COM O `propostaId` DA VENDA (`lib/temis/cancelar-contrato-servico.ts:685`:
 * `propostaId: args.venda.id`), e é isso que os põe na frente desta barra sem serem o alvo dela. Em
 * `lib/temis/trabalhos.ts:164` o caminho deles tem um estágio chamado `contrato` que quer dizer "gerar
 * o TERMO" (`trabalhos.ts:243`), e não "vender".
 */
const TIPOS_QUE_DESFAZEM_A_VENDA: ReadonlySet<string> = new Set<TipoDeTrabalho>([
  "cancelamento",
  "cancelamento_correcao",
  "cessao",
  "distrato",
]);

/**
 * O ato que está sendo barrado é da COMPRA E VENDA, ou é de um card que a DESFAZ?
 *
 * ⚠️ ESTE RECORTE EXISTIA EM UMA DAS QUATRO PORTAS, E A DECISÃO ESTAVA ESCRITA COMO SE VALESSE EM
 * TODAS. Em `marcarAtividade` a guarda é `depois.tipo === "contrato" && ...`
 * (`lib/temis/trabalhos-db.ts:1050`), e a razão escrita ali é exata: *"sem ela, uma CAD em revisão
 * travaria o cancelamento de uma venda"*. Mas `prepararEnvio` (`lib/assinatura/envio-db.ts`) e
 * `gerarContratoDaProposta` (`lib/temis/contrato-servico.ts`) penduravam a barra SÓ no `propostaId`, e
 * o painel "Quem assina" é servido para QUATRO tipos de card, não só o contrato:
 * `modules/temis/blocks/trabalho/tela-de-trabalho.tsx:2203` desenha `OrganizacaoDaAssinatura` sempre
 * que `EXIGE_ASSINATURA[tipo]` (`lib/temis/trabalhos.ts:145`: contrato, cancelamento_correcao, cessao e
 * distrato são `true`), e ela chama `/assinatura/enviar?proposta=` com o MESMO propostaId da venda
 * (`organizacao-da-assinatura.tsx:165` e `:293`). Sem este recorte, o distrato, a cessão e o
 * cancelamento por correção daquela venda recebiam a recusa da CAD — trava retroativa na SAÍDA, que é
 * justamente o que a regra da casa proíbe sem decisão do Lucas, e com a frase mandando "pedir o
 * credenciamento" sobre um documento que encerra a venda. O caso caro é a CAD `indeferido`: é a
 * situação que PRODUZ distrato, e era a que trancava a saída.
 *
 * ⚠️ MEDIDO EM 26/09/2026 (`bxgukywoxgivlrhjkwjx`, só SELECT):
 *   select tipo, estagio, count(*) from temis_trabalhos
 *    where tipo in ('cancelamento','cancelamento_correcao','cessao','distrato') group by 1,2;
 * → 1 card vivo de saída, um `distrato` em `analise` (Quadra D Lote 10, enterprise 38, CLEIBER JOSE
 * FERREIRA), cuja proposta de origem é `c2x` e está em etapa `assinatura`. Ele não era vítima HOJE por
 * acidente de ordem: `contratoVigenteDaProposta` (`envio-db.ts:93`) recusa antes com 409 "ainda não tem
 * contrato gerado", e essa proposta tem 0 documentos de tipo contrato. E as propostas COM contrato
 * gerado são 13, TODAS origem `panteon`:
 *   select p.origem, p.etapa, count(distinct d.proposta_id) from hercules_documentos d
 *     join hercules_propostas p on p.id = d.proposta_id
 *    where d.tipo='contrato' and d.removido_em is null group by 1,2;
 *     → panteon/assinatura 7, panteon/contrato 6. (⚠️ NÃO CONFERIDO AQUI, e relatado pela revisão: que
 *       as 13 tenham o titular `credenciado`. O elo CPF → CAD é por `value_hash` em
 *       `apolo_entity_identifiers`, e não se faz em SQL solto.) Ou seja: sem vítima hoje, com
 * vítima no primeiro dia em que uma venda nativa com contrato gerado tiver a CAD fora de `credenciado`
 * — e a esteira anda POR TELA, ela se mexeu durante a própria medição deste lote (revisão 172 → 173 no
 * mesmo dia).
 *
 * ⚠️ O QUE ESTE RECORTE ABRE, ESCRITO PORQUE NINGUÉM VAI DESCOBRIR SOZINHO: no CANCELAMENTO POR
 * CORREÇÃO o card de `contrato` de origem é indeferido pelo motor
 * (`lib/temis/cancelar-contrato-servico.ts`, "o motor indefere esse mesmo card no passo dele") e o card
 * vivo passa a ser o `cancelamento_correcao`. A v2 da COMPRA E VENDA daquela proposta, gerada nesse
 * estado, NÃO passa mais pela barra. Isso é consequência direta do que o Lucas pediu para não travar —
 * `cancelamento_correcao` está na lista dos que desfazem — e da chave ser a PROPOSTA e não o card. Sair
 * disso exige o tipo do card vir de QUEM CLICOU (a tela o tem: `tela-de-trabalho.tsx:2203` recebe
 * `tipo`), e isso muda a assinatura de `prepararEnvio` e a query string da rota de assinatura: é lote
 * próprio, relatado ao Lucas e não decidido aqui. Medido em 26/09/2026:
 *   select tipo, estagio, count(*) from temis_trabalhos
 *    where tipo in ('cancelamento','cancelamento_correcao','cessao','distrato') group by 1,2;
 *     → cancelamento/faturado 3, cancelamento/indeferido 2, distrato/faturado 7, distrato/analise 1.
 * ZERO cards de `cancelamento_correcao` e ZERO de `cessao`: ninguém está nesse estado hoje.
 *
 * ⚠️ FAIL-CLOSED NA DÚVIDA, E A DÚVIDA TEM DUAS FORMAS. Leitura que falha e proposta SEM card vivo
 * nenhum voltam `true` (a barra vale): sem card, quem está chamando é o Gerar que ainda vai abrir o
 * card da venda, e deixar passar aí abriria exatamente a porta caríssima. Só quando há card vivo e
 * NENHUM deles é de `contrato` é que o ato é de saída.
 */
export async function oAtoEDaCompraEVenda(
  admin: ClienteDeLeitura,
  propostaId: null | string,
): Promise<boolean> {
  const alvo = String(propostaId ?? "").trim();
  if (!alvo) return true;

  const { data, error } = await admin
    .from("temis_trabalhos")
    .select("estagio, tipo")
    .eq("proposta_id", alvo);

  if (error) {
    console.error("[cad-para-contrato] falha ao ler os cards da proposta; a barra continua valendo", {
      erro: (error as { message?: string }).message ?? null,
      proposta: alvo,
    });
    return true;
  }

  const cards = (data ?? []) as Array<{ estagio: null | string; tipo: null | string }>;
  const encerrados: readonly string[] = ESTAGIOS_ENCERRADOS;
  const vivos = cards.filter((c) => !encerrados.includes(String(c.estagio ?? "")));
  if (vivos.length === 0) return true;

  return vivos.some((c) => !TIPOS_QUE_DESFAZEM_A_VENDA.has(String(c.tipo ?? "")));
}

/**
 * A barra COM o recorte do tipo do card — a que as portas da Têmis e do envio usam.
 *
 * Devolve `null` quando o ato não é da compra e venda (o termo de distrato, de cessão ou de
 * cancelamento por correção daquela mesma proposta) e quando a CAD está aprovada.
 */
export async function recusaDaCadDoAtoDoContrato(
  admin: ClienteDeLeitura,
  propostaId: null | string,
  ato: AtoBarradoPelaCad,
): Promise<null | RecusaDaCadParaContrato> {
  if (!(await oAtoEDaCompraEVenda(admin, propostaId))) return null;
  return recusaDaCadDaProposta(admin, propostaId, ato);
}
