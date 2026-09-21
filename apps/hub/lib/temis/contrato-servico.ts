import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

import { APOLO_DOCS_BUCKET, lerDocumentoDoStorage } from "@/lib/apolo/documentos";
import { foraDoEscopo } from "@/lib/apolo/incorporador/escopo";
import { MENSAGEM_PRODUTO_SO_CONSULTA } from "@/lib/apolo/incorporador/operacao-do-produto";
import { createApoloAdminClient } from "@/lib/apolo/server";
import { moverCardDaTemis } from "@/lib/assinatura/estado-db";

import {
  alcanceDaMinuta,
  alcanceParaEscreverNosEmpreendimentos,
  type UsoDoAlcance,
} from "./alcance-da-estrutura";
import { type AtorDaTemis, idDoAutor, trabalhoNoAlcance } from "./ator";
import { autorizarAlteracaoManualDoContrato, autorizarEmissaoDeContrato } from "./autorizacao";
import { nomeComOrigem, registrarAtoDoPortal } from "./autoria-dos-modelos";
import { montarContratoDaProposta } from "./contrato-da-proposta";
import {
  baseMudou,
  impressaoDaBase,
  contratoFicouVazio,
  sanitizarHtmlDoContrato,
  variaveisAindaEmBranco,
} from "./contrato-editado";
import { descartarEdicao, lerEdicao, salvarEdicao } from "./contrato-editado-db";
import { podeGerarContrato, TIPO_CONTRATO } from "./contrato-guardado";
import {
  abrirContratoGuardado,
  contratosDaProposta,
  guardarContrato,
} from "./contrato-guardado-db";
import { gerarPdfDoHtml } from "./html-para-pdf";
import {
  montarPdfDoContrato,
  type PecaDoContrato,
  recusaPorTetoDaMontagem,
} from "./montar-pdf-do-contrato";
import { ehColunaDoDonoAusente } from "./trabalhos-db";

// O CONTRATO DA PROPOSTA, PARA QUEM ESTIVER OPERANDO — a prévia, a geração, a edição à mão e o PDF.
//
// Decisão do Lucas (16/09/2026) sobre o portal da Cecílio Rocha: a venda feita pelo time dela é
// confeccionada POR ELA, no portal (*"a Cecilio quem vai fazer é o proprio time deles"*), e a da
// Gurgel continua com a Têmis da Careli. A equipe da Cecílio gera o contrato, edita e manda assinar.
//
// ⚠️ UM CÓDIGO SÓ. Até aqui esta lógica morava dentro de `/api/temis/contrato/{previa,gerar,edicao}`
// e `/api/temis/pdf`. Copiar para `/api/incorporador/temis/*` criaria duas verdades sobre o MESMO
// contrato: a primeira correção feita de um lado só (uma trava de variável em branco, a faxina do
// HTML colado) deixaria o portal emitindo um papel que o hub recusaria. As duas rotas chamam as
// funções daqui; o que muda é o ATOR (`ator.ts`) que cada porta monta.
//
// ⚠️ O RECORTE VEM ANTES DE QUALQUER LEITURA OU GRAVAÇÃO, e é feito pelos CARDS DA PROPOSTA
// (`alcanceDaProposta`). O hub passa direto, sem consulta nenhuma: o jurídico da Careli confecciona
// para todos, e o comportamento dele não muda. O portal só alcança a proposta cujos cards são TODOS
// dele e estão no escopo da sessão — a venda da Gurgel (card da Careli, `operado_por` nulo) e a de
// outro incorporador respondem 404, sem dizer por quê.
//
// ⚠️ AS RESPOSTAS SÃO AS DO HUB, BYTE A BYTE (`{ erro }`, `{ data }`, mesmos status). A tela troca só
// a base da URL e a credencial; o formato é o mesmo porque a função é a mesma. A exceção é o 404 de
// fora do escopo, que é o `foraDoEscopo` de todo o portal.
//
// ⚠️ ESCREVER PEDE O PRODUTO OPERADO PELO PORTAL (decisão do Lucas, 16/09/2026: escrita só no que a
// Cecílio opera). Gerar, alterar à mão, descartar a alteração e mandar assinar passam por
// `alcanceDaPropostaParaEscrever`: os cards da proposta no alcance, como sempre, e o produto de cada
// card aceito pela régua de quem opera (`alcanceParaEscreverNosEmpreendimentos`). Um card antigo do
// portal num produto que ele só consulta (o VOC) responde 403 só consulta; a prévia e a leitura do
// que já foi gerado continuam abrindo.

const WORKSPACE = "careli";

/**
 * Até quantos cards uma proposta pode ter para a conferência valer.
 *
 * ⚠️ NÃO É PAGINAÇÃO, É TETO DE SANIDADE. Uma proposta tem hoje um ou dois cards (o contrato e, às
 * vezes, o cancelamento). Chegar ao teto quer dizer que alguma coisa está muito errada, e a resposta
 * fail-closed é "não é seu": decidir o alcance olhando só parte dos cards seria decidir no escuro.
 */
const TETO_DE_CARDS = 100;

// ── O ALCANCE ───────────────────────────────────────────────────────────────

/**
 * `dentro`: pode seguir. `fora`: 404 sem explicação. `indisponivel`: não deu para ler, 503.
 * `so-consulta`: a proposta é do portal, mas o produto é operado por outro; só na escrita, 403.
 *
 * ⚠️ MAIS DE DOIS ESTADOS, E NÃO UM BOOLEANO. Falha de leitura não autoriza, mas também não é "não
 * existe": um 404 com o banco oscilando mandaria o time da Cecílio procurar um contrato que está lá
 * (a mesma régua do 503 de `autorizarTemisDoPortal`).
 */
export type Alcance = "dentro" | "fora" | "indisponivel" | "so-consulta";

/** O erro do Postgres é "o id nem tem formato de uuid"? É alguém mexendo na URL, não defeito. */
function ehIdTorto(erro: unknown): boolean {
  return Boolean(erro) && (erro as { code?: unknown }).code === "22P02";
}

/**
 * A proposta está no alcance deste ator?
 *
 * Hub: sempre, e SEM consultar nada (é o que mantém o hub exatamente como era).
 *
 * Portal: a proposta precisa ter ao menos um card na Têmis, e TODOS os cards dela precisam passar
 * em `trabalhoNoAlcance` (dono igual ao incorporador E empreendimento no escopo da sessão).
 *
 * ⚠️ TODOS, E NÃO "ALGUM". Gerar o contrato e mandar para assinatura MOVEM OS CARDS DA PROPOSTA
 * (`moverCardDaTemis` casa por `proposta_id` e move todo card cujo caminho tem o destino — e todo
 * tipo de trabalho passa por "contrato"). Se a Cecílio pedisse o cancelamento de uma venda cujo
 * contrato é da Careli, "algum card é meu" deixaria o portal empurrar o card da Careli. Proposta
 * com dono misturado fica fora do portal até alguém decidir de quem ela é.
 *
 * ⚠️ SEM FILTRO DE `workspace_id`, DE PROPÓSITO. O conjunto conferido aqui tem de ser o MESMO que
 * `moverCardDaTemis` move (que também lê só por `proposta_id`); um filtro a mais só teria como
 * deixar de fora um card que depois seria movido.
 *
 * ⚠️ SEM A 0172 NINGUÉM DE FORA É DONO DE NADA: a coluna ausente responde `fora`, e o portal recebe
 * 404 em tudo até a migration entrar — como deve.
 */
export async function alcanceDaProposta(
  sb: SupabaseClient,
  ator: AtorDaTemis,
  propostaId: string,
): Promise<Alcance> {
  if (ator.tipo === "hub") return "dentro";
  const lidos = await cardsDaPropostaNoAlcance(sb, ator, propostaId);
  return lidos.ok ? "dentro" : lidos.alcance;
}

/** Os cards da proposta, quando TODOS estão no alcance; senão, o alcance que recusou. */
async function cardsDaPropostaNoAlcance(
  sb: SupabaseClient,
  ator: AtorDaTemis,
  propostaId: string,
): Promise<
  | { alcance: Exclude<Alcance, "dentro">; ok: false }
  | { cards: Array<{ enterprise_id: unknown; operado_por: unknown }>; ok: true }
> {
  const alvo = typeof propostaId === "string" ? propostaId.trim() : "";
  if (!alvo) return { alcance: "fora", ok: false };

  const { data, error } = await sb
    .from("temis_trabalhos")
    .select("enterprise_id, operado_por")
    .eq("proposta_id", alvo)
    .limit(TETO_DE_CARDS);

  if (error) {
    if (ehColunaDoDonoAusente(error) || ehIdTorto(error)) return { alcance: "fora", ok: false };
    console.error("[temis][portal] falha ao conferir os cards da proposta", error);
    return { alcance: "indisponivel", ok: false };
  }

  const cards = (data ?? []) as Array<{ enterprise_id: unknown; operado_por: unknown }>;
  if (cards.length === 0 || cards.length >= TETO_DE_CARDS) return { alcance: "fora", ok: false };

  return cards.every((card) => trabalhoNoAlcance(ator, card))
    ? { cards, ok: true }
    : { alcance: "fora", ok: false };
}

/**
 * A proposta está no alcance deste ator PARA ESCREVER (gerar, alterar à mão, descartar, mandar
 * assinar, consertar signatário)?
 *
 * Hub: sempre, sem consulta. Portal: `alcanceDaProposta` e, depois, o produto de CADA card aceito
 * pela régua de quem opera (decisão do Lucas, 16/09/2026). A venda antiga do portal num produto que
 * ele só consulta (VOC, VOR) é 403 só consulta: o card continua aparecendo, e o contrato não sai.
 */
export async function alcanceDaPropostaParaEscrever(
  sb: SupabaseClient,
  ator: AtorDaTemis,
  propostaId: string,
): Promise<Alcance> {
  if (ator.tipo === "hub") return "dentro";

  const lidos = await cardsDaPropostaNoAlcance(sb, ator, propostaId);
  if (!lidos.ok) return lidos.alcance;

  const escrita = await alcanceParaEscreverNosEmpreendimentos(
    sb,
    ator,
    lidos.cards.map((card) => card.enterprise_id),
  );
  return escrita === "falha" ? "indisponivel" : escrita;
}

/** A proposta pela régua do uso: ler é o alcance de sempre; escrever acrescenta a operação. */
export function alcanceDaPropostaPara(
  uso: UsoDoAlcance,
): (sb: SupabaseClient, ator: AtorDaTemis, propostaId: string) => Promise<Alcance> {
  return uso === "escrever" ? alcanceDaPropostaParaEscrever : alcanceDaProposta;
}

/**
 * O documento guardado (`hercules_documentos`, tipo contrato) está no alcance deste ator?
 *
 * ⚠️ O ID VEM DA URL, E O QUE DECIDE É A PROPOSTA DELE. Lê-se só `proposta_id` — uma coluna, nenhum
 * dado do comprador — e a pergunta vira a de `alcanceDaProposta`. Documento sem proposta não tem
 * card, e não tem dono de fora: fica fora do portal.
 */
export async function alcanceDoDocumento(
  sb: SupabaseClient,
  ator: AtorDaTemis,
  documentoId: string,
): Promise<Alcance> {
  if (ator.tipo === "hub") return "dentro";

  const alvo = typeof documentoId === "string" ? documentoId.trim() : "";
  if (!alvo) return "fora";

  const { data, error } = await sb
    .from("hercules_documentos")
    .select("proposta_id")
    .eq("workspace_id", WORKSPACE)
    .eq("tipo", TIPO_CONTRATO)
    .eq("id", alvo)
    .is("removido_em", null)
    .maybeSingle();

  if (error) {
    if (ehIdTorto(error)) return "fora";
    console.error("[temis][portal] falha ao conferir o documento", error);
    return "indisponivel";
  }

  const propostaId = String((data as null | { proposta_id: null | string })?.proposta_id ?? "");
  if (!propostaId.trim()) return "fora";

  return alcanceDaProposta(sb, ator, propostaId);
}

/**
 * A minuta pedida pelo id (`minutaId` do corpo) está no alcance deste ator?
 *
 * ⚠️ É A SEGUNDA TRAVA, E ELA É DO PORTAL. A primeira mora em `acharMinuta` e vale para todos: a
 * minuta tem de servir ao empreendimento da proposta (ele, o pai ou o consolidado). Esta acrescenta,
 * só para o portal, a régua de alcance das peças do modelo: o time da Cecílio não abre, por id, uma
 * minuta de empreendimento que a sessão dele não tem — inclusive a do consolidado, que vale também
 * para os lotes do Lino (ver a assimetria em `ator.ts`).
 *
 * ⚠️ A RÉGUA É A MESMA DE QUEM EDITA A MINUTA (revisão da onda 3, 16/09/2026): `alcanceDaMinuta`, de
 * `alcance-da-estrutura.ts`. Até aqui esta função tinha a sua própria, só com `enterpriseNoAlcance`,
 * e as duas discordavam no PAI do cadastro: o dono do conjunto (todos os filhos na sessão) editava e
 * publicava pelo portal a minuta gravada no pai (VLO = 35), e a prévia, a geração e a edição do
 * contrato com essa minuta respondiam 404. Uma regra só, e a primeira correção vale para as duas.
 */
export async function alcanceDaMinutaPedida(
  sb: SupabaseClient,
  ator: AtorDaTemis,
  minutaId: string,
): Promise<Alcance> {
  if (ator.tipo === "hub") return "dentro";

  const alvo = typeof minutaId === "string" ? minutaId.trim() : "";
  if (!alvo) return "dentro";

  const alcance = await alcanceDaMinuta(sb, ator, alvo);
  return alcance === "falha" ? "indisponivel" : alcance;
}

/**
 * A resposta de quem ficou de fora, ou `null` para seguir.
 *
 * ⚠️ O "SÓ CONSULTA" SAI COM `erro`, E NÃO `error`: as telas do contrato (prévia, geração, envio)
 * leem `erro`. A frase e o `soConsulta: true` são os da régua de toda escrita do portal.
 */
export function respostaDoAlcance(alcance: Alcance): NextResponse | null {
  if (alcance === "dentro") return null;
  if (alcance === "indisponivel") {
    return NextResponse.json(
      { erro: "Não foi possível conferir o acesso agora." },
      { status: 503 },
    );
  }
  if (alcance === "so-consulta") {
    return NextResponse.json(
      { erro: MENSAGEM_PRODUTO_SO_CONSULTA, soConsulta: true },
      { status: 403 },
    );
  }
  return foraDoEscopo();
}

/**
 * Proposta e, quando veio, a minuta pedida — nessa ordem, parando no primeiro "não".
 *
 * `uso: "escrever"` aplica à PROPOSTA a régua de quem opera o produto. A minuta segue na régua de
 * leitura: ela é a base que se lê para montar o contrato, e a trava da escrita é a da venda.
 */
async function recusaDaPropostaEMinuta(
  sb: SupabaseClient,
  ator: AtorDaTemis,
  pedido: { minutaId: string; propostaId: string },
  uso: UsoDoAlcance,
): Promise<NextResponse | null> {
  const daProposta = respostaDoAlcance(
    await alcanceDaPropostaPara(uso)(sb, ator, pedido.propostaId),
  );
  if (daProposta) return daProposta;
  if (!pedido.minutaId) return null;
  return respostaDoAlcance(await alcanceDaMinutaPedida(sb, ator, pedido.minutaId));
}

// ── O AUTOR ─────────────────────────────────────────────────────────────────

/**
 * O que vai nas colunas de autor (`enviado_por`/`enviado_por_nome`, `editado_por`/`_nome`, `quem`/
 * `quem_nome` da passagem de etapa).
 *
 * Hub: o usuário do hub e o nome dele, como sempre foi.
 *
 * Portal: o `apolo_incorporador_usuarios.id` e o nome da sessão, COM A ORIGEM ESCRITA JUNTO.
 *
 * ⚠️ A ORIGEM VAI NO NOME PORQUE É O ÚNICO LUGAR QUE TODOS OS LEITORES JÁ MOSTRAM. As quatro
 * tabelas guardam o autor em id + nome e nenhuma tem coluna de origem; o id do portal é um uuid de
 * OUTRA tabela, indistinguível do de `hub_users` para quem lê. Sem a origem escrita, a aba
 * Documentos, o registro do envelope e o histórico do card diriam "Maria" — e a Careli, que
 * supervisiona um contrato mandado com a conta de assinatura DELA, não saberia que foi o portal.
 *
 * ⚠️ E O NOME NUNCA VEM DE `hub_users` PARA O PORTAL: vem do ator (a sessão assinada). Sem nome, a
 * linha diz só a origem — não inventa pessoa.
 */
export function autorDoAto(ator: AtorDaTemis): { id: string; nome: null | string } {
  // O texto da origem é UM SÓ na Têmis inteira (`nomeComOrigem`, de `autoria-dos-modelos.ts`): a
  // Careli lê "(portal do incorporador)" igual no contrato, no envelope e na minuta.
  return { id: idDoAutor(ator), nome: nomeComOrigem(ator) };
}

/**
 * Deixa no log o ato feito pelo portal. Do hub não sai nada novo.
 *
 * ⚠️ UMA FUNÇÃO SÓ PARA A TÊMIS INTEIRA (revisão da onda 3, 16/09/2026): mora em
 * `autoria-dos-modelos.ts`, arquivo sem dependência pesada, e é reexportada daqui para quem já a
 * importava deste módulo (a assinatura). O log é a segunda testemunha: o autor já foi gravado na
 * linha, e o log guarda de qual incorporador e com qual usuário do portal.
 */
export { registrarAtoDoPortal };

/**
 * Este ator pode EMITIR (gerar, editar, mandar assinar)?
 *
 * Hub: quem responde é `autorizarEmissaoDeContrato` (admin e leader), a régua de sempre.
 *
 * Portal: sim. Quem chega aqui já passou por `portalConfeccionaContrato` e pelo recorte da
 * proposta; a decisão do Lucas é que a equipe do incorporador gera e manda assinar os contratos
 * que ela confecciona. O portal não tem papel por usuário para recortar mais que isso.
 */
async function atorPodeEmitir(ator: AtorDaTemis, request: Request): Promise<boolean> {
  if (ator.tipo === "portal") return true;
  return (await autorizarEmissaoDeContrato(request)).ok;
}

/**
 * Este ator pode ALTERAR O CONTRATO À MÃO?
 *
 * ⚠️ A TELA PRECISA SABER, SENÃO ELA MENTE. `podeEditar` na Têmis olha só a etapa do card, e
 * quem grava é o servidor: desde 21/09/2026 a edição é nominal (Lucas: *"quem pode editar é a
 * Nivea Careli e Northon Nascimento"*). Sem este campo, cinco pessoas da coordenação abririam o
 * contrato, reescreveriam uma cláusula e só descobririam no fechamento.
 *
 * Portal: sim, como sempre — quem confecciona lá não passa pela régua do hub.
 */
async function atorPodeAlterar(ator: AtorDaTemis, request: Request): Promise<boolean> {
  if (ator.tipo === "portal") return true;
  return (await autorizarAlteracaoManualDoContrato(request)).ok;
}

// ── A PRÉVIA ────────────────────────────────────────────────────────────────

/**
 * POST `{ propostaId, minutaId? }` — o contrato montado, sem gravar nada.
 *
 * Ver o cabeçalho de `app/api/temis/contrato/previa/route.ts` para o porquê da prévia.
 */
export async function previaDoContrato(ator: AtorDaTemis, request: Request): Promise<NextResponse> {
  const corpo = (await request.json().catch(() => ({}))) as {
    minutaId?: unknown;
    propostaId?: unknown;
  };
  const propostaId = typeof corpo.propostaId === "string" ? corpo.propostaId : "";
  if (!propostaId) {
    return NextResponse.json({ erro: "Sem proposta." }, { status: 400 });
  }
  const minutaId = typeof corpo.minutaId === "string" ? corpo.minutaId : "";

  const sb = createApoloAdminClient();
  if (!sb) return NextResponse.json({ erro: "Supabase indisponível." }, { status: 503 });

  // A prévia é leitura: a venda antiga do portal num produto só consulta continua conferível.
  const recusa = await recusaDaPropostaEMinuta(sb, ator, { minutaId, propostaId }, "ler");
  if (recusa) return recusa;

  const montado = await montarContratoDaProposta(sb, { minutaId, propostaId });

  if (!montado.ok) {
    return NextResponse.json({ erro: montado.erro }, { status: montado.status });
  }

  // ⚠️ A EDIÇÃO VIGENTE SÓ APARECE PARA QUEM PODE EMITIR. No hub esta rota autoriza com o papel de
  // LEITURA, porque conferir contrato é de todo mundo — inclusive do comercial no portal da
  // Gurgel. Mas o texto alterado à mão é rascunho do jurídico, ainda não emitido: mostrá-lo lá
  // faria o comercial ler como "o contrato" uma cláusula que ainda está sendo escrita.
  //
  // ⚠️ E É UMA SEGUNDA CHECAGEM, NÃO UMA SEGUNDA TRAVA: quem fecha a edição é a própria rota
  // `contrato/edicao`. Aqui só se decide o que a resposta carrega. No portal quem chega até aqui é
  // quem confecciona a proposta, e por isso vê o próprio rascunho.
  const podeEmitir = await atorPodeEmitir(ator, request);
  const podeAlterar = await atorPodeAlterar(ator, request);
  const edicao = podeEmitir ? await lerEdicao(sb, propostaId) : null;

  // ⚠️ O QUE FALTA É MEDIDO NO TEXTO QUE VAI VIRAR PAPEL. Com uma alteração manual salva, a
  // lista da montagem deixa de valer: quem digitou o CPF por cima do `[cpf_cliente]` preencheu
  // o contrato. Manter a lista velha faria a tela apontar em vermelho um buraco que não existe
  // mais — e, pior, discordar da trava da geração, que já mede o texto final.
  const semValor = edicao
    ? variaveisAindaEmBranco(edicao.html, montado.semValor)
    : montado.semValor;

  return NextResponse.json({
    avisos: montado.avisos,
    // A impressão da base VOLTA COM A PRÉVIA e volta no salvamento: é a foto do contrato que a
    // pessoa realmente tinha na tela quando começou a escrever. Ver `contrato-editado.ts`.
    // ⚠️ O CARIMBO SEGUE QUEM ALTERA, e não quem emite: ele só serve para SALVAR uma edição
    // (é a foto da base sobre a qual se escreveu). Mandar para quem não pode escrever é dar a
    // chave de uma porta que não abre.
    baseImpressao: podeAlterar ? impressaoDaBase(montado.html) : undefined,
    // A tela usa isto para não oferecer o que o servidor vai recusar. Ver `atorPodeAlterar`.
    podeAlterar,
    edicao: edicao
      ? {
          atualizadoEm: edicao.atualizadoEm,
          // ⚠️ A COMPARAÇÃO É FEITA AQUI, e não na tela: o HTML da base tem dezenas de milhares
          // de caracteres e mandar os dois para o navegador comparar dobraria a resposta.
          baseMudou: baseMudou(edicao, montado.html),
          editadoPorNome: edicao.editadoPorNome,
          html: edicao.html,
        }
      : null,
    // ⚠️ AS PEÇAS ANEXAS VÊM PARA A CONFERÊNCIA, E O CAMINHO DO ARQUIVO NÃO. A prévia não abre o
    // bucket (a tela mostra a LISTA: "vão junto — anexo 1, do empreendimento Lagoa Bonita"), e a
    // chave do Storage só serve para mapear o que existe na casa. É a mesma régua de `lerAnexos`.
    anexos: montado.anexos.map(({ storagePath: _caminho, ...peca }) => peca),
    html: montado.html,
    // Os marcadores de montagem que a minuta usou (`capa_contrato`, `anexo_3`). A tela pode dizer
    // que o texto pede uma peça que o cadastro ainda não tem.
    marcadores: montado.marcadores,
    minuta: montado.minuta,
    semValor,
    vezesDoLaco: montado.vezesDoLaco,
  });
}

// ── AS PEÇAS QUE VÃO JUNTO ──────────────────────────────────────────────────

/**
 * Baixa a capa e os anexos do bucket para o montador.
 *
 * ⚠️ ARQUIVO QUE NÃO BAIXA RECUSA A GERAÇÃO, e não vira contrato sem a peça. É a mesma régua de
 * `podeGerarContrato`: um PDF que anuncia em cláusula uma convenção de condomínio que não está
 * dentro dele é pior do que um contrato que não saiu — o primeiro vai a cartório e ninguém percebe.
 *
 * ⚠️ E AS DUAS ORIGENS SÃO O MESMO BUCKET. A capa mora em `temis-capas/` e o anexo em
 * `temis-anexos/`, os dois dentro do `apolo-documents` (ver `gravarAnexo`).
 */
async function baixarPecasDoContrato(
  sb: SupabaseClient,
  montado: {
    anexos: readonly { arquivoBytes: null | number; nome: string; storagePath: string }[];
    minuta: { capaNome: string; capaPath: string };
  },
): Promise<{ anexos: PecaDoContrato[]; capa: null | PecaDoContrato; ok: true } | { erro: string; ok: false }> {
  const capaPath = montado.minuta.capaPath;
  let capa: null | PecaDoContrato = null;

  if (capaPath) {
    const bytes = await lerDocumentoDoStorage(sb, capaPath).catch(() => null);
    if (!bytes) {
      console.error("[temis][contrato] capa não baixou", { bucket: APOLO_DOCS_BUCKET, capaPath });
      return {
        erro: `Não consegui baixar a capa "${montado.minuta.capaNome || "do contrato"}" para montar o PDF. Reenvie a capa na minuta e gere de novo.`,
        ok: false,
      };
    }
    // ⚠️ O TIPO NÃO É MAIS ADIVINHADO PELA EXTENSÃO (21/09/2026). `mimeDoCaminho` só conhecia
    // `.png`, `.jpg` e `.jpeg` e devolvia `application/pdf` para o resto — e `.jfif` é a extensão
    // que o Chrome dá a um JPEG salvo pela área de trabalho. O upload aceitava o arquivo (o
    // navegador declarou `image/jpeg`), a montagem o tratava como PDF, e TODO contrato daquele
    // empreendimento passava a devolver 409 mandando tirar a senha de uma imagem sem senha. Quem
    // decide agora é `formatoDosBytes`, que lê os primeiros bytes do arquivo.
    capa = { bytes, nome: montado.minuta.capaNome || "capa do contrato" };
  }

  const anexos: PecaDoContrato[] = [];
  for (const anexo of montado.anexos) {
    const bytes = await lerDocumentoDoStorage(sb, anexo.storagePath).catch(() => null);
    if (!bytes) {
      console.error("[temis][contrato] anexo não baixou", { path: anexo.storagePath });
      return {
        erro: `Não consegui baixar o anexo "${anexo.nome}" para montar o PDF. Reenvie o arquivo no cadastro de anexos e gere de novo.`,
        ok: false,
      };
    }
    // ⚠️ O ANEXO É SEMPRE PDF por decisão de `anexos.ts` (*"o anexo é página pronta"*); só a CAPA
    // aceita imagem. Quem CONFERE isso é o montador, pelos bytes — e a recusa dele diz o formato.
    anexos.push({ arquivoBytes: anexo.arquivoBytes, bytes, nome: anexo.nome });
  }

  return { anexos, capa, ok: true };
}

// ── A GERAÇÃO ───────────────────────────────────────────────────────────────

/**
 * POST `{ propostaId, minutaId? }` — o contrato vira PDF, vai para a gaveta e o card anda.
 *
 * Ver o cabeçalho de `app/api/temis/contrato/gerar/route.ts` para o porquê de cada peça.
 */
export async function gerarContratoDaProposta(
  ator: AtorDaTemis,
  request: Request,
): Promise<NextResponse> {
  const corpo = (await request.json().catch(() => ({}))) as {
    minutaId?: unknown;
    propostaId?: unknown;
  };
  const propostaId = typeof corpo.propostaId === "string" ? corpo.propostaId : "";
  if (!propostaId) {
    return NextResponse.json({ erro: "Sem proposta." }, { status: 400 });
  }
  const minutaId = typeof corpo.minutaId === "string" ? corpo.minutaId : "";

  const sb = createApoloAdminClient();
  if (!sb) return NextResponse.json({ erro: "Supabase indisponível." }, { status: 503 });

  // ⚠️ NO PORTAL, SÓ A PROPOSTA QUE ELE CONFECCIONA. Antes de montar, antes do Chromium, antes do
  // bucket: a venda da Gurgel está no escopo da Cecílio e é da Careli, e emitir o contrato dela pelo
  // portal criaria uma segunda versão na gaveta da Careli com o nome de alguém de fora. E só no
  // produto que o portal opera: gerar é escrita.
  const recusa = await recusaDaPropostaEMinuta(sb, ator, { minutaId, propostaId }, "escrever");
  if (recusa) return recusa;

  const montado = await montarContratoDaProposta(sb, { minutaId, propostaId });
  if (!montado.ok) {
    return NextResponse.json({ erro: montado.erro }, { status: montado.status });
  }

  // ⚠️ O QUE VIRA PAPEL É O TEXTO ALTERADO À MÃO, QUANDO ELE EXISTE (migration 0152). A regra
  // "o HTML nasce no servidor, da minuta publicada" continua valendo: o texto editado NÃO viaja
  // neste pedido. Ele foi gravado antes, por `contrato/edicao`, numa linha com dono, hora e a
  // impressão da base, e já passou pela faxina do servidor. O que se aceita aqui continua sendo só
  // um id de proposta.
  //
  // ⚠️ E A EDIÇÃO SOBREVIVE À GERAÇÃO. A v2 deste contrato parte do mesmo texto ajustado: apagar
  // a edição ao emitir faria a cláusula negociada desaparecer na primeira vez que alguém
  // corrigisse uma vírgula no cadastro e gerasse de novo.
  const edicao = await lerEdicao(sb, propostaId);
  const html = edicao?.html ?? montado.html;

  // ⚠️ A TRAVA MEDE O PAPEL, NÃO A MONTAGEM. Ver a decisão 1 em `contrato-guardado.ts`: um
  // contrato com `[cpf_cliente]` impresso não vira arquivo — mas quem digitou o CPF por cima do
  // colchete preencheu o contrato, e recusar mesmo assim mandaria a pessoa consertar o cadastro
  // para poder imprimir um papel que já está certo.
  const semValor = edicao
    ? variaveisAindaEmBranco(html, montado.semValor)
    : montado.semValor;
  const veredito = podeGerarContrato(semValor);
  if (!veredito.ok) {
    return NextResponse.json(
      { avisos: montado.avisos, erro: veredito.erro, semValor },
      { status: 409 },
    );
  }

  let corpoDoPdf: Uint8Array;
  try {
    corpoDoPdf = await gerarPdfDoHtml(html);
  } catch (e) {
    // A mensagem real vai para o log: o erro do Chromium cita caminho de binário e flag de linha de
    // comando — infraestrutura, que não ajuda quem está emitindo um contrato e não deve vazar.
    console.error("[temis][contrato] falha ao gerar o PDF", e instanceof Error ? e.message : e);
    return NextResponse.json(
      { erro: "Não foi possível gerar o PDF do contrato. Tente de novo." },
      { status: 502 },
    );
  }

  // ⚠️ CAPA + CORPO + ANEXOS, E A COSTURA ENTRA ANTES DA GAVETA. É o desenho de 07/09/2026
  // (`variaveis.ts`: *"o contrato é uma montagem, não um documento só"*), e montar aqui — e não na
  // hora de baixar — é o que faz o PDF guardado, o que vai assinar e o que o cliente recebe serem o
  // MESMO arquivo. Sem capa e sem anexo o corpo sai intocado, byte a byte: ver `montarPdfDoContrato`.
  let pdf = corpoDoPdf;
  if (montado.minuta.capaPath || montado.anexos.length > 0) {
    // ⚠️ O TETO DECIDE ANTES DO PRIMEIRO DOWNLOAD, com o tamanho que o cadastro já tinha. Ver
    // `recusaPorTetoDaMontagem`: até 21/09/2026 as peças eram TODAS trazidas para a memória da
    // função e só então a soma era comparada — 27MB transferidos para responder o que a coluna
    // `arquivo_bytes` já dizia. A segunda conferência continua dentro do montador, porque esta aqui
    // pode subestimar (linha antiga sem `arquivo_bytes`, capa sem tamanho em canto nenhum).
    const cedo = recusaPorTetoDaMontagem(
      corpoDoPdf.byteLength,
      montado.anexos.map((a) => ({ bytes: a.arquivoBytes, nome: a.nome })),
    );
    if (cedo) {
      return NextResponse.json({ avisos: montado.avisos, erro: cedo }, { status: 409 });
    }

    const pecas = await baixarPecasDoContrato(sb, montado);
    if (!pecas.ok) {
      return NextResponse.json({ avisos: montado.avisos, erro: pecas.erro }, { status: 409 });
    }
    const montagem = await montarPdfDoContrato({
      anexos: pecas.anexos,
      capa: pecas.capa,
      corpo: corpoDoPdf,
    });
    if (!montagem.ok) {
      return NextResponse.json({ avisos: montado.avisos, erro: montagem.erro }, { status: 409 });
    }
    pdf = montagem.pdf;
  }

  // ⚠️ UMA IDENTIDADE SÓ PARA OS DOIS USOS. O autor vai para a gaveta (`guardarContrato`) e para a
  // passagem de etapa logo abaixo; as duas linhas discordarem sobre quem emitiu seria o pior dos
  // dois mundos numa auditoria. Ela sai do ATOR: no hub, o nome que o portão já leu de `hub_users`;
  // no portal, o da sessão, com a origem escrita (ver `autorDoAto`).
  const autor = autorDoAto(ator);

  const guardado = await guardarContrato(sb, {
    // Quem lê a gaveta precisa saber que este PDF não é o texto puro da minuta.
    alteradoAMaoPor: edicao ? (edicao.editadoPorNome ?? "alguém da equipe") : null,
    // ⚠️ AS PEÇAS ANEXAS VÃO PARA O REGISTRO. Com a montagem, o PDF guardado deixou de ser só o
    // corpo, e quem abrir o arquivo daqui a um ano precisa saber o que estava dentro dele.
    anexos: montado.anexos.map((a) => a.nome),
    geradoPor: autor.id,
    geradoPorNome: autor.nome,
    identidade: montado.identidade,
    // ⚠️ DE QUAL MINUTA ESTE PAPEL SAIU, E DE QUE DEGRAU. Sem herança dava para reconstruir (uma
    // minuta por empreendimento); com ela, não: dois contratos do MESMO empreendimento, no mesmo
    // dia, podem sair de minutas de níveis diferentes, e nada no registro os distinguia.
    minuta: montado.minuta,
    pdf,
    propostaId,
  });

  if (!guardado.ok) {
    return NextResponse.json({ erro: guardado.erro }, { status: guardado.status });
  }

  // ⚠️ O CARD ANDA QUANDO O CONTRATO EXISTE, e não quando alguém marca uma caixinha. Lucas
  // (11/09/2026): *"Gerei o contrato e não moveu para contratos, ao gerar tem que mover"*. A coluna
  // "Contrato" quer dizer exatamente "gerado, conferir quem assina antes de mandar".
  //
  // ⚠️ QUEM DECIDE SE PODE MOVER É `moverCardDaTemis`, que pergunta ao caminho do TIPO antes de
  // tocar em qualquer linha. Falha aqui não derruba a geração — o PDF já está guardado, e um card
  // parado é bem menos grave que um contrato perdido.
  await moverCardDaTemis(sb, propostaId, "contrato", autor);

  registrarAtoDoPortal(ator, "gerou o contrato", {
    documentoId: guardado.documentoId,
    propostaId,
    versao: guardado.versao,
  });

  return NextResponse.json({
    data: {
      // ⚠️ AS PEÇAS ANEXAS VOLTAM NOMEADAS. Quem gerou precisa saber o que entrou no papel, e é a
      // única confirmação que a tela de trabalho tem — ela não abre a prévia antes de emitir.
      anexos: montado.anexos.map(({ storagePath: _caminho, ...peca }) => peca),
      avisos: montado.avisos,
      documentoId: guardado.documentoId,
      minuta: montado.minuta,
      nome: guardado.nome,
      protocolo: guardado.protocolo,
      tamanhoBytes: guardado.tamanhoBytes,
      versao: guardado.versao,
    },
  });
}

/**
 * GET `?proposta=` (o que já foi gerado) ou `?documento=&modo=ver` (o link de um deles).
 *
 * ⚠️ NO PORTAL, O DOCUMENTO É CONFERIDO PELA PROPOSTA DELE ANTES DE VIRAR LINK ASSINADO. No hub o
 * recorte continua sendo o `tipo = contrato` de `abrirContratoGuardado` (ver a nota da rota).
 */
export async function contratosGuardados(
  ator: AtorDaTemis,
  request: Request,
): Promise<NextResponse> {
  const sb = createApoloAdminClient();
  if (!sb) return NextResponse.json({ erro: "Supabase indisponível." }, { status: 503 });

  const url = new URL(request.url);
  const documentoId = (url.searchParams.get("documento") ?? "").trim();
  if (documentoId) {
    const recusa = respostaDoAlcance(await alcanceDoDocumento(sb, ator, documentoId));
    if (recusa) return recusa;

    // `?modo=ver` devolve a URL que desenha no iframe; sem ele, a que baixa o arquivo.
    const aberto = await abrirContratoGuardado(
      sb,
      documentoId,
      url.searchParams.get("modo") === "ver" ? "ver" : "baixar",
    );
    if (!aberto.ok) return NextResponse.json({ erro: aberto.erro }, { status: aberto.status });
    return NextResponse.json(
      { data: { nome: aberto.nome, url: aberto.url } },
      // ⚠️ `no-store`: a URL assinada abre o contrato de um comprador sem pedir nada. Guardá-la em
      // proxy ou CDN a poria no caminho de outro.
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  const propostaId = (url.searchParams.get("proposta") ?? "").trim();
  if (!propostaId) {
    return NextResponse.json({ erro: "Informe a proposta ou o documento." }, { status: 400 });
  }

  const recusa = respostaDoAlcance(await alcanceDaProposta(sb, ator, propostaId));
  if (recusa) return recusa;

  return NextResponse.json(
    { data: { contratos: await contratosDaProposta(sb, propostaId) } },
    { headers: { "Cache-Control": "no-store" } },
  );
}

// ── A ALTERAÇÃO À MÃO ───────────────────────────────────────────────────────

/**
 * O teto do que se aceita gravar.
 *
 * ⚠️ O CONTRATO É GRANDE, MAS NÃO INFINITO: 27 páginas de texto dão ~100 KB, e a folga aqui é para
 * as figuras que a minuta traz embutidas como `data:image`. Um corpo maior do que isto é quase
 * sempre uma colagem que trouxe uma página inteira junto — e o custo dela é uma linha de vários
 * megabytes lida em toda abertura do contrato.
 */
const TETO_DA_EDICAO_BYTES = 8 * 1024 * 1024;

/** sha-256 em hexadecimal — o formato que `impressaoDaBase` produz. */
const IMPRESSAO = /^[a-f0-9]{64}$/;

/** PUT `{ propostaId, html, baseImpressao?, minutaId? }` — grava a alteração manual. */
export async function salvarEdicaoDoContrato(
  ator: AtorDaTemis,
  request: Request,
): Promise<NextResponse> {
  const corpo = (await request.json().catch(() => ({}))) as {
    baseImpressao?: unknown;
    html?: unknown;
    minutaId?: unknown;
    propostaId?: unknown;
  };

  const propostaId = typeof corpo.propostaId === "string" ? corpo.propostaId : "";
  const html = typeof corpo.html === "string" ? corpo.html : "";
  if (!propostaId) return NextResponse.json({ erro: "Sem proposta." }, { status: 400 });
  if (contratoFicouVazio(html)) {
    // ⚠️ CONTRATO VAZIO NÃO É EDIÇÃO, É ACIDENTE — um "selecionar tudo + apagar" seguido de salvar.
    // Quem quer voltar ao texto da minuta usa o DELETE, que diz o que faz.
    //
    // ⚠️ E O VAZIO DO NAVEGADOR NÃO É STRING VAZIA: sobra um `<br>`, que passava pelo `trim()`.
    // Ver `contratoFicouVazio`.
    return NextResponse.json(
      { erro: "O contrato ficou vazio. Para voltar ao texto da minuta, use “Descartar alterações”." },
      { status: 400 },
    );
  }
  if (Buffer.byteLength(html, "utf8") > TETO_DA_EDICAO_BYTES) {
    return NextResponse.json(
      { erro: "O texto ficou grande demais para ser salvo. Verifique se algo foi colado por engano." },
      { status: 413 },
    );
  }

  const sb = createApoloAdminClient();
  if (!sb) return NextResponse.json({ erro: "Supabase indisponível." }, { status: 503 });

  const minutaId = typeof corpo.minutaId === "string" ? corpo.minutaId : null;

  // ⚠️ REESCREVER CLÁUSULA É O ATO MAIS GRAVE DESTE ARQUIVO, e no portal ele só vale para a proposta
  // que o incorporador confecciona. A minuta citada no corpo também é conferida: ela vai gravada
  // como "a base desta edição", e um id de outro loteamento ali contaria uma história falsa.
  const recusa = await recusaDaPropostaEMinuta(
    sb,
    ator,
    { minutaId: minutaId ?? "", propostaId },
    "escrever",
  );
  if (recusa) return recusa;

  const limpo = sanitizarHtmlDoContrato(html);

  const baseImpressao =
    typeof corpo.baseImpressao === "string" && IMPRESSAO.test(corpo.baseImpressao)
      ? corpo.baseImpressao
      : "";

  const autor = autorDoAto(ator);

  const gravado = await salvarEdicao(sb, {
    baseImpressao,
    editadoPor: autor.id,
    editadoPorNome: autor.nome,
    html: limpo.html,
    minutaId,
    propostaId,
  });

  if (!gravado.ok) {
    return NextResponse.json({ erro: gravado.erro }, { status: gravado.status });
  }

  registrarAtoDoPortal(ator, "alterou o contrato à mão", { propostaId });

  // ⚠️ A TELA PRECISA SABER O QUE A FAXINA TIROU. Uma colagem que perdeu o rastreador não muda nada
  // para quem escreveu; uma que perdeu uma tabela inteira, muda — e o silêncio faria a pessoa
  // descobrir isso no PDF assinado.
  return NextResponse.json({ data: { removeu: limpo.removeu } });
}

/** DELETE `?proposta=` — joga fora a alteração manual: o contrato volta a ser o texto da minuta. */
export async function descartarEdicaoDoContrato(
  ator: AtorDaTemis,
  request: Request,
): Promise<NextResponse> {
  const propostaId = (new URL(request.url).searchParams.get("proposta") ?? "").trim();
  if (!propostaId) return NextResponse.json({ erro: "Sem proposta." }, { status: 400 });

  const sb = createApoloAdminClient();
  if (!sb) return NextResponse.json({ erro: "Supabase indisponível." }, { status: 503 });

  // Descartar a alteração muda o texto que vira papel: é escrita.
  const recusa = respostaDoAlcance(await alcanceDaPropostaParaEscrever(sb, ator, propostaId));
  if (recusa) return recusa;

  const feito = await descartarEdicao(sb, propostaId);
  if (!feito.ok) return NextResponse.json({ erro: feito.erro }, { status: feito.status });

  registrarAtoDoPortal(ator, "descartou a alteração manual do contrato", { propostaId });

  return NextResponse.json({ data: { descartado: true } });
}

// ── O PDF DO HTML ───────────────────────────────────────────────────────────

/**
 * Teto do HTML aceito.
 *
 * ⚠️ EXISTE PARA PROTEGER A MEMÓRIA DA FUNÇÃO, não para julgar o contrato. A maior minuta que
 * temos (JDG) tem ~87 KB de `conteudo_html`; 4 MB dá folga de ordens de grandeza para imagem em
 * base64 e ainda barra o payload que faria o Chromium estourar a RAM da função e devolver um erro
 * sem explicação.
 */
const TETO_DE_HTML = 4_000_000;

/**
 * POST `{ html, estiloExtra?, nome? }` — devolve o PDF, sem guardar nada.
 *
 * ⚠️ NÃO RECEBE ATOR PORQUE NÃO HÁ O QUE RECORTAR: nenhum id entra, nenhuma linha é lida. O HTML é
 * de quem chama e os bytes voltam para quem chamou. O que protege esta porta é QUEM pode chamá-la
 * (o Chromium é um amplificador de custo), e isso é decidido pela porta antes daqui. Só o hub chama:
 * a porta do portal foi apagada em 16/09/2026 (decisão do Lucas), porque entregava HTML arbitrário,
 * com JavaScript e rede livre, a quem é de fora da Careli, e nenhuma tela a usava.
 */
export async function imprimirHtmlEmPdf(request: Request): Promise<Response> {
  const corpo = (await request.json().catch(() => ({}))) as {
    estiloExtra?: unknown;
    html?: unknown;
    nome?: unknown;
  };

  const html = typeof corpo.html === "string" ? corpo.html : "";
  const estiloExtra =
    typeof corpo.estiloExtra === "string" ? corpo.estiloExtra : undefined;

  if (!html.trim()) {
    return NextResponse.json({ erro: "Sem HTML para imprimir." }, { status: 400 });
  }

  if (html.length > TETO_DE_HTML) {
    return NextResponse.json(
      {
        erro: `O HTML tem ${html.length.toLocaleString("pt-BR")} caracteres e o teto é ${TETO_DE_HTML.toLocaleString("pt-BR")}.`,
      },
      { status: 413 },
    );
  }

  let pdf: Uint8Array;
  try {
    pdf = await gerarPdfDoHtml(html, { estiloExtra });
  } catch (e) {
    // A mensagem real vai para o log, não para a tela: o erro do Chromium costuma citar caminho de
    // binário e flag de linha de comando — informação de infraestrutura que não ajuda quem está
    // tentando imprimir um contrato e não deve vazar para o navegador.
    console.error(
      "[temis][pdf] falha ao gerar o PDF",
      e instanceof Error ? e.message : e,
    );
    return NextResponse.json(
      { erro: "Não foi possível gerar o PDF. Tente de novo." },
      { status: 502 },
    );
  }

  const nome = nomeDoArquivo(corpo.nome);

  return new Response(new Uint8Array(pdf), {
    headers: {
      // ⚠️ `no-store`: contrato tem nome, CPF e valor. Um `Cache-Control` permissivo aqui deixaria
      // o PDF de um comprador guardado em proxy ou CDN no caminho de outro.
      "Cache-Control": "no-store",
      "Content-Disposition": `inline; filename="${nome}"; filename*=UTF-8''${encodeURIComponent(nome)}`,
      "Content-Type": "application/pdf",
    },
    status: 200,
  });
}

/**
 * Nome do arquivo, em ASCII.
 *
 * ⚠️ O CABEÇALHO HTTP NÃO É UTF-8. "Contrato — João.pdf" no `filename` simples faz alguns clientes
 * truncarem o nome ou recusarem a resposta inteira. Aqui o acento é removido (NFD + corte dos
 * diacríticos) para o `filename`, e o `filename*` leva o nome de verdade percent-encoded — mesma
 * dupla usada no extrato do cliente.
 */
function nomeDoArquivo(bruto: unknown): string {
  const base = typeof bruto === "string" && bruto.trim() ? bruto.trim() : "contrato";
  const semAcento = base
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9 ._-]/g, "-")
    .slice(0, 120);
  return semAcento.toLowerCase().endsWith(".pdf") ? semAcento : `${semAcento}.pdf`;
}
