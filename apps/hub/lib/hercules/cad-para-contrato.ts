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
  alvo: { documento: null | string; enterpriseId: null | string },
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
    return {
      erro: `Esta proposta está sem o CPF ou o CNPJ do titular, e sem ele não há CAD para conferir. Corrija o cliente da proposta antes de ${O_QUE_FOI_BARRADO[ato]}.`,
      etapa: null,
      status: 409,
    };
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
    const veredito = await credenciadoParaVender(admin, {
      documento,
      enterpriseIds: escopo.length > 0 ? escopo : [c2xId],
    });

    if (veredito.credenciado) return null;

    return {
      erro: fraseDaRecusa(veredito.motivo, ato, veredito.etapa),
      etapa: veredito.etapa,
      status: 409,
    };
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
    .select("cliente_documento, unidade_id")
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

  const proposta = data as null | { cliente_documento: null | string; unidade_id: null | string };
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

  return recusaDaCadParaContrato(
    admin,
    {
      documento: proposta.cliente_documento,
      enterpriseId: unidade?.enterprise_id ?? null,
    },
    ato,
  );
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
