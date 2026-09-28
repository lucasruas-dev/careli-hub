import type { SupabaseClient } from "@supabase/supabase-js";

import type { ReflexoNaVenda } from "@/lib/hercules/reflexo-da-temis";
import {
  motivoDoReflexo,
  refletirCardNaVenda,
  registrarReflexoQueNaoAndou,
} from "@/lib/hercules/reflexo-da-temis-server";
import {
  type OrigemDaPassagem,
  registrarPassagemDeEtapa,
} from "@/lib/temis/passagem-de-etapa-db";
import type { EstagioDoTrabalho, TipoDeTrabalho } from "@/lib/temis/trabalhos";

import { estagiosDoTipo } from "@/lib/temis/trabalhos";

import type { EventoDaClicksign } from "./clicksign/webhook";
import {
  cabecalhosParaGuardar,
  esqueletoDoPayload,
  estadoPropostoPeloEvento,
  fechadoEmDoPayload,
  idComFormaDaClicksign,
  marcasDoPayloadDaClicksign,
  payloadReduzidoDaClicksign,
  TETO_DO_NOME_DO_EVENTO,
} from "./marcas";
import { type ItemDoQuadro, registrarAssinaturas } from "./registro-db";
import type { EstadoDaAssinatura } from "./tipos";

/** Os cards de PEDIDO: nunca andam com o envelope do contrato. */
const TIPOS_DE_PEDIDO = new Set(["cancelamento", "distrato"]);

// O EVENTO DO WEBHOOK VIRA MARCA POR PESSOA E ESTADO — e o card da Têmis anda junto.
//
// ⚠️ SÓ EVENTO CONFERIDO CHEGA AQUI. Quem confere é `conferirAssinaturaDoWebhook`, na rota. Este
// arquivo assume que a assinatura bateu; chamá-lo com um evento não conferido seria o mesmo que não
// ter conferência nenhuma.
//
// ⚠️ DESDE A F1 DA FONTE ÚNICA (28/09/2026) QUEM ESCREVE É A FUNÇÃO DA 0195, NUNCA ESTE ARQUIVO. O
// update direto de antes regredia o estado: 13 `signature_started` gravaram "aguardando" DEPOIS de um
// `sign` em 5 documentos (medido em 28/09). A função trava a linha, move o estado só para a frente,
// deriva "parcial" das marcas e nunca inventa `fechado_em`. Ver `lib/assinatura/registro-db.ts`.
//
// ⚠️ E TODO EVENTO CONFERIDO É APLICADO, não só os que "movem estado" (bug 8.5). O payload traz o
// histórico INTEIRO em `document.events[]`: um `add_signer` que chega depois de um `sign` carrega o
// `sign` junto, e é dele que sai a marca de quem assinou.
//
// ⚠️ E `sign` NÃO É CONCLUSÃO. Um `sign` é UMA pessoa. Quem decide o estado proposto é
// `estadoPropostoPeloEvento` (`marcas.ts`), que só diz "assinado" com a prova de que todos assinaram.

export type AplicacaoDoEvento = {
  aplicado: boolean;
  /**
   * O `envelope_id` (Clicksign) da linha achada, para o registro do evento (bug 8.2: 226 de 226
   * eventos gravados com `envelope_id` nulo até 28/09). `null` = linha não achada.
   */
  envelopeIdDoRegistro: null | string;
  /** Uma frase para o log: por que aplicou, ou por que não. Só ids e estados, nunca e-mail. */
  motivo: string;
  /** O estado que a linha ficou (ou já tinha). */
  estado: null | EstadoDaAssinatura;
};

type LinhaDoEnvelope = {
  envelope_id: null | string;
  estado: string;
  id: string;
  proposta_id: null | string;
  provedor_documento_id: null | string;
};

/**
 * Aplica o evento: marcas por pessoa, estado proposto, documento e conferência, pela função da 0195.
 *
 * ⚠️ NUNCA LANÇA. Ele roda depois de a rota já ter respondido 200; uma exceção aqui viraria um
 * unhandled rejection no runtime da Vercel, sem ninguém para pegá-la — e sem nada no lugar do
 * estado que deveria ter mudado. Toda falha vira `aplicado: false` com o motivo escrito.
 *
 * ⚠️ SEM A 0195 NADA É APLICADO, e isso é o combinado (plano, F1): o evento fica registrado e o
 * histórico inteiro chega de novo no próximo payload. Não há update em TS de reserva. Mas depois
 * do FECHAMENTO não chega outro payload: um contrato que fechasse com a F1 no ar e sem a 0195 não
 * viraria "assinado" sozinho. Por isso a 0195 é aplicada ANTES do deploy (topo de `registro-db.ts`).
 */
export async function aplicarEventoDaClicksign(
  sb: SupabaseClient,
  evento: EventoDaClicksign,
  payload: unknown,
  recebidoEm: string = new Date().toISOString(),
): Promise<AplicacaoDoEvento> {
  try {
    const achado = await acharEnvelope(sb, evento);
    if ("motivo" in achado) {
      return { aplicado: false, envelopeIdDoRegistro: null, estado: null, motivo: achado.motivo };
    }
    const linha = achado.linha;

    const registro = await registrarAssinaturas(sb, linha.id, {
      conferidoEm: recebidoEm,
      // ⚠️ O DOCUMENTO DO EVENTO VAI JUNTO SEMPRE (bug 8.9). Linha sem documento o adota; linha com
      // OUTRO documento recusa, e o evento do documento 1 não pinta o documento 2 do reenvio.
      documento: evento.documentoId,
      estado: estadoPropostoPeloEvento(evento.evento, payload),
      estadoCru: evento.evento ? `clicksign:${evento.evento}` : null,
      fechadoEm: fechadoEmDoPayload(payload),
      marcas: marcasDoPayloadDaClicksign(payload),
    });

    if (!registro) {
      return {
        aplicado: false,
        envelopeIdDoRegistro: linha.envelope_id,
        estado: linha.estado as EstadoDaAssinatura,
        motivo: "a função da 0195 não aplicou (ausente, sem linha ou falhou; ver o log do registro)",
      };
    }

    if (registro.recusa) {
      return {
        aplicado: false,
        envelopeIdDoRegistro: linha.envelope_id,
        estado: registro.estadoAntes,
        motivo:
          registro.recusa === "documento_diferente"
            ? `o evento é de outro documento que não o da linha ${linha.id}: nada aplicado`
            : `o quadro da linha ${linha.id} mudou: nada aplicado`,
      };
    }

    // ⚠️ O CARD SÓ ANDA QUANDO O CONTRATO FECHA, E SÓ NA BORDA. `mudouEstado` é o que impede o
    // reenvio do mesmo webhook de mover o card de novo: a segunda chamada encontra "assinado" e não
    // muda nada. E a data do prazo sai do QUADRO que a função devolveu (bug 8.3), não de uma
    // segunda leitura de eventos que casava por um `envelope_id` sempre vazio.
    if (registro.mudouEstado && registro.estadoDepois === "assinado" && linha.proposta_id) {
      await concluirAssinaturaDoCard(sb, linha.proposta_id, {
        fechadoEm: registro.fechadoEm,
        quadro: registro.signatarios,
      });
    }

    return {
      aplicado: true,
      envelopeIdDoRegistro: linha.envelope_id,
      estado: registro.estadoDepois,
      motivo: `${registro.estadoAntes} → ${registro.estadoDepois} · ${registro.assinaram}/${registro.total} assinaram`,
    };
  } catch (falha) {
    console.error("[clicksign][webhook] falha inesperada ao aplicar o evento", {
      message: falha instanceof Error ? falha.message : String(falha),
    });
    return { aplicado: false, envelopeIdDoRegistro: null, estado: null, motivo: "falha inesperada" };
  }
}

/**
 * Acha a linha por qualquer um dos ids que o evento possa trazer.
 *
 * ⚠️ O DOCUMENTO VEM PRIMEIRO, e é uma decisão medida: os eventos da Clicksign são de DOCUMENTO
 * (`sign`, `refusal`, `document_closed`), e o id do documento é o que aparece em todos eles. O id do
 * envelope é o que aparece nos de envelope.
 *
 * ⚠️ E O `metadata` SÓ ADOTA LINHA SEM DOCUMENTO (bug 8.9). Ele é NOSSO (o Panteon o gravou no
 * documento no envio) e é a rede de segurança do carimbo que falhou; mas a busca por proposta pega
 * o envelope MAIS RECENTE, e depois de um reenvio esse é o documento 2. Aplicar ali as marcas do
 * documento 1 pintaria o contrato novo com as assinaturas do velho. Linha achada pelo metadata que
 * já tem documento não é desta conversa: o evento fica registrado e nada muda.
 */
async function acharEnvelope(
  sb: SupabaseClient,
  evento: EventoDaClicksign,
): Promise<{ linha: LinhaDoEnvelope } | { motivo: string }> {
  const precisas: Array<[string, string]> = [];
  if (evento.documentoId) precisas.push(["provedor_documento_id", evento.documentoId]);
  if (evento.envelopeId) precisas.push(["envelope_id", evento.envelopeId]);

  // ⚠️ E O TERMO DE ACORDO DO HADES ENTRA PELA OUTRA CHAVE. Ele nasce com `proposta_id` NULO de
  // propósito (um acordo não é uma proposta): o elo dele é `temis_envelopes.compromisso_id`, e é
  // ele que viaja no `metadata` do documento desde 20/09/2026.
  const pelaRede: Array<[string, string]> = [];
  const propostaDoMetadata = String(evento.metadados?.proposta_id ?? "").trim();
  if (propostaDoMetadata) pelaRede.push(["proposta_id", propostaDoMetadata]);
  const acordoDoMetadata = String(evento.metadados?.compromisso_id ?? "").trim();
  if (acordoDoMetadata) pelaRede.push(["compromisso_id", acordoDoMetadata]);

  for (const [coluna, valor] of precisas) {
    const linha = await lerUmaLinha(sb, coluna, valor);
    if (linha) return { linha };
  }

  for (const [coluna, valor] of pelaRede) {
    const linha = await lerUmaLinha(sb, coluna, valor);
    if (!linha) continue;
    if (linha.provedor_documento_id) {
      return {
        motivo: `a linha ${linha.id}, achada pelo metadata, já tem outro documento: nada aplicado`,
      };
    }
    return { linha };
  }

  return { motivo: "não achei o envelope no Panteon (documento/envelope desconhecido)" };
}

async function lerUmaLinha(
  sb: SupabaseClient,
  coluna: string,
  valor: string,
): Promise<LinhaDoEnvelope | null> {
  const { data, error } = await sb
    .from("temis_envelopes")
    .select("id, estado, proposta_id, envelope_id, provedor_documento_id")
    .eq("provedor", "clicksign")
    .eq(coluna, valor)
    .order("criado_em", { ascending: false })
    .limit(1)
    .maybeSingle();

  // ⚠️ A COLUNA `compromisso_id` PODE NÃO EXISTIR AINDA (migration 0179): o erro cai aqui como
  // qualquer outra falha de leitura, e as outras tentativas seguem. Log só com `code` e `message`.
  if (error) {
    console.error("[clicksign][webhook] falha ao procurar o envelope", {
      code: error.code ?? null,
      message: error.message ?? null,
    });
    return null;
  }
  return (data as LinhaDoEnvelope | null) ?? null;
}

/**
 * Move o card da Têmis desta proposta.
 *
 * ⚠️ SÓ PARA A FRENTE. `estagio_desde` é de onde os prazos das atividades contam; puxar um card de
 * volta reiniciaria o relógio de um trabalho que já andou, e o board passaria a cobrar prazo de uma
 * etapa vencida há semanas. Como a única transição automática hoje é "assinatura → finalizado", a
 * guarda é simples: não mexe em card já finalizado.
 *
 * ⚠️ E FALHA AQUI NÃO É FALHA DO EVENTO. O estado do envelope — que é o fato — já está gravado. O
 * card é a apresentação daquele fato no board, e um board desatualizado se conserta na próxima
 * leitura; desfazer o estado por causa dele seria trocar o certo pelo cosmético.
 *
 * ⚠️ `autor` É OPCIONAL E DEVE SER PASSADO SEMPRE QUE EXISTIR. Omitir quer dizer "o sistema moveu
 * sozinho" — a promessa que a 0153 faz sobre `quem` nulo. Os dois chamadores de hoje sabem quem
 * clicou (a rota de gerar tem `autorizacao.userId`; o envio tem `pedido.usuarioId`), e sem isto a
 * passagem mais auditável da casa — "quem mandou este contrato para a Clicksign" — nascia anônima,
 * enquanto o ato REVERSÍVEL de devolver para a análise saía assinado.
 *
 * ⚠️ `operacaoComecouEm` É A OUTRA METADE DO COMPARAR-E-TROCAR, e sem ela a proteção da casa só
 * existe num dos dois sentidos. O `.eq("estagio", card.estagio)` de `retorno-para-correcao.ts`
 * protege o sentido card → Análise: quem devolve não atropela um card que andou enquanto a tela
 * estava aberta. ESTA protege o sentido oposto, que é o único que aquele não tem como ver — uma
 * operação LONGA que já estava no ar quando o card foi devolvido e que, ao terminar, empurra o card
 * de volta para a frente.
 *
 * ⚠️ E O CASO É REAL, NÃO TEÓRICO: o POST do envio leva de 40 a 90 segundos (`maxDuration 120`) e a
 * linha do envelope só nasce lá pelo meio, depois de ~10 consultas e do download do PDF. Nessa
 * janela não existe envelope nenhum para a volta conferir: o coordenador dá F5 (ou abre o mesmo card
 * noutra aba), o `enviando` da tela morre, o botão de voltar nasce habilitado, ele devolve o card
 * para Análise — e um minuto depois o envio que já estava no ar move o card para "assinatura", com o
 * contrato VELHO na rua e o Panteon dizendo que está tudo em ordem. Sem as duas metades, a decisão
 * deliberada de devolver o card para correção é desfeita por uma operação que ninguém consegue mais
 * cancelar.
 *
 * ⚠️ E A VENDA ANDA JUNTO (24/09/2026). Lucas: *"preciso garantir que tudo que acontece na temis
 * reflete no hercules, pode corrigir isso, o contrato da vitoria tem que estar em assinatura"*.
 * Medido em produção em 24/09/2026: os 5 envios de 23/09 moveram o card para "assinatura" e deixaram
 * a venda em `contrato` (5 de 5), porque esta função movia SÓ o card. Agora, depois do `update` e da
 * passagem de cada card, `refletirCardNaVenda` leva a venda com o MESMO de/para. Como só os `alvos`
 * (os que passaram por `cardAndouDepoisDe`) andam, a venda só anda se o card andou: o envio de 40 a
 * 90 s não empurra a venda de um card devolvido no meio.
 *
 * ⚠️ DEVOLVE O QUE FEZ, e não mais `void`: os cards movidos e o reflexo de cada um. O envio lê o
 * reflexo para dizer à tela quando a venda não acompanhou (`avisoDoHercules`), sem trocar o `ok`.
 */
export async function moverCardDaTemis(
  sb: SupabaseClient,
  propostaId: string,
  estagio: EstagioDoTrabalho,
  autor?: null | { id: null | string; nome: null | string },
  operacaoComecouEm?: null | string,
): Promise<{ movidos: CardParaMover[]; reflexos: ReflexoNaVenda[] }> {
  const alvos = await cardsQueAceitam(sb, propostaId, estagio, operacaoComecouEm ?? null);
  if (alvos.length === 0) return { movidos: [], reflexos: [] };

  const agora = new Date().toISOString();
  const { error } = await sb
    .from("temis_trabalhos")
    .update({ atualizado_em: agora, estagio, estagio_desde: agora })
    .in(
      "id",
      alvos.map((c) => c.id),
    );

  if (error) {
    // ⚠️ SÓ `code` E `message`: o `details` de uma violação traz "Failing row contains (...)", e a
    // linha de `temis_trabalhos` tem `cliente_cpf` e `cliente_nome`.
    console.error("[temis][card] falha ao mover o card da proposta", {
      code: error.code ?? null,
      message: error.message ?? null,
    });
    return { movidos: [], reflexos: [] };
  }

  // ⚠️ O ESTÁGIO ANTERIOR VEM DE `cardsQueAceitam`, e não de uma segunda consulta. Ela já leu
  // `id, tipo, estagio` de cada card para decidir quem pode andar — e depois do `update` acima o
  // estágio de antes não existe mais em lugar nenhum do banco: uma releitura traria o destino, e o
  // histórico gravaria "contrato → contrato".
  //
  // ⚠️ E FALHA AQUI NÃO DESFAZ NADA. O card já andou, que é o fato; o histórico é a narração dele.
  // `registrarPassagemDeEtapa` é calada por construção — ver a nota daquele arquivo.
  for (const card of alvos) {
    await registrarPassagemDeEtapa(sb, {
      de: card.estagio,
      origem: ORIGEM_POR_DESTINO[estagio],
      para: estagio,
      propostaId,
      quem: autor?.id ?? null,
      quemNome: autor?.nome ?? null,
      trabalhoId: card.id,
      trabalhoTipo: card.tipo,
    });
  }

  // ⚠️ O REFLEXO VEM DEPOIS DO CARD E DA PASSAGEM, E NUNCA OS DESFAZ. Card de tipo que não é
  // contrato (cessão, cancelamento por correção) devolve `nao_se_aplica` sem ler nada; os pedidos
  // nem chegam aqui (`cardsQueAceitam` os tira).
  const reflexos: ReflexoNaVenda[] = [];
  for (const card of alvos) {
    const passo = {
      autorNome: autor?.nome ?? null,
      de: card.estagio,
      motivo: motivoDoReflexo(card.estagio, estagio),
      para: estagio,
      propostaId,
      trabalhoTipo: card.tipo,
    };
    const reflexo = await refletirCardNaVenda(sb, passo);
    registrarReflexoQueNaoAndou(card.id, passo, reflexo);
    reflexos.push(reflexo);
  }

  return { movidos: alvos, reflexos };
}

/**
 * O QUE FEZ O CARD ANDAR, DEDUZIDO DO DESTINO.
 *
 * ⚠️ A ORIGEM NÃO VEM DE QUEM CHAMA PORQUE O DESTINO JÁ A RESPONDE SEM AMBIGUIDADE: só há um
 * caminho que leva o card a cada uma destas etapas. O mapa fica aqui, completo e tipado — destino
 * novo sem origem declarada não compila —, e assim não há duas respostas possíveis para a mesma
 * pergunta espalhadas pelos chamadores.
 *
 * ⚠️ QUEM CLICOU É OUTRA HISTÓRIA, E ESSA VEM DE FORA (o `autor` de `moverCardDaTemis`). A versão
 * anterior desta nota dizia que pedir mais um parâmetro "quebraria os dois chamadores" e usava isso
 * para justificar a passagem anônima; o argumento vale para a ORIGEM, que o destino deduz, e não
 * para o AUTOR, que ninguém deduz — e um parâmetro OPCIONAL não quebra chamador nenhum.
 */
const ORIGEM_POR_DESTINO: Record<EstagioDoTrabalho, OrigemDaPassagem> = {
  // A única forma de um card VOLTAR para a análise é o botão de devolver para correção.
  analise: "retorno_para_correcao",
  assinatura: "envio_assinatura",
  contrato: "contrato_gerado",
  // Estes três não chegam por aqui hoje (`concluirAssinaturaDoCard` e o POST de indeferir declaram
  // a própria origem), mas o mapa é total de propósito: o dia em que chegarem, chegam nomeados.
  faturado: "webhook_assinatura",
  indeferido: "indeferimento",
  prazo_legal: "webhook_assinatura",
};

/**
 * Quais cards desta proposta podem ir para este estágio.
 *
 * ⚠️ UMA PROPOSTA PODE TER MAIS DE UM CARD, e foi assim que o fluxo quebrou. Medido em
 * 10/09/2026: a proposta do Henrique (Q01 L05) tem DOIS trabalhos abertos — a venda, de 06/09, e
 * o pedido de cancelamento dela, de 08/09. Quando o envelope do CONTRATO foi enviado, o update
 * casava só por `proposta_id` e empurrou os DOIS para "Em assinatura" — inclusive o
 * cancelamento, que pela régua da casa nem passa por lá (`EXIGE_ASSINATURA.cancelamento` é
 * `false`). O card ficou num estágio que não existe no caminho dele, e a faixa da tela de
 * trabalho não tinha como marcar etapa nenhuma.
 *
 * ⚠️ A RÉGUA É O CAMINHO DO TIPO, e não uma lista de exceções. `estagiosDoTipo` já é a fonte
 * única do que cada serviço percorre — quem move passa a perguntar a ela. Assim, o dia em que o
 * cancelamento passar a assinar, muda uma linha em `trabalhos.ts` e este arquivo obedece.
 *
 * ⚠️ `faturado` E `indeferido` CONTINUAM DE FORA. `faturado` é o fim; `indeferido` é decisão
 * humana, e um webhook atrasado não pode desfazê-la.
 *
 * ⚠️ E NADA ANDA PARA TRÁS POR AQUI (revisão de 24/09/2026). Os dois chamadores só EMPURRAM o card:
 * o Gerar (`contrato-servico.ts`, sem carimbo) para Contrato e o envio (`envio-db.ts`) para Em
 * assinatura. Antes, uma aba velha que gerasse o contrato com o card em Em assinatura ou no
 * Pré-faturamento devolvia o card para Contrato, e desde o reflexo levava a venda junto de
 * `assinatura` para `contrato`, com o envelope vivo ou já assinado. O único caminho de volta é a
 * volta para correção (`retornarParaAnalise`), que mata o envelope antes de mover. Ficar no mesmo
 * estágio continua permitido (gerar de novo com o card em Contrato).
 */
async function cardsQueAceitam(
  sb: SupabaseClient,
  propostaId: string,
  destino: EstagioDoTrabalho,
  operacaoComecouEm: null | string,
): Promise<CardParaMover[]> {
  const { data, error } = await sb
    .from("temis_trabalhos")
    // ⚠️ `estagio_desde` ENTROU NO SELECT POR CAUSA DA JANELA DO ENVIO. É a única coluna que diz
    // QUANDO o card chegou onde está — e é ela que responde se ele andou por outra mão enquanto
    // esta operação estava no ar.
    .select("id, tipo, estagio, estagio_desde")
    .eq("proposta_id", propostaId);

  if (error) {
    console.error("[temis][card] falha ao ler os cards da proposta", error.message);
    return [];
  }

  // ⚠️ O PEDIDO DE CANCELAMENTO OU DE DISTRATO NÃO ANDA COM O CONTRATO (revisão de 18/09/2026). O
  // envelope desta proposta é o do CONTRATO (só o card de contrato produz envelope). Com o pedido
  // aberto na mesma proposta, "Gerar contrato" e o envio levavam o card do pedido junto para
  // Contrato e Em assinatura, e o webhook de "assinado" podia levá-lo a Concluído com a venda viva.
  // Quem move o card do pedido é a conclusão dele, e só ela.
  const cards = ((data ?? []) as CardParaMover[]).filter((c) => !TIPOS_DE_PEDIDO.has(String(c.tipo)));
  const podem = cards.filter(
    (c) =>
      c.estagio !== "faturado" &&
      c.estagio !== "indeferido" &&
      estagiosDoTipo(c.tipo).includes(destino) &&
      !voltariaNoCaminho(c, destino) &&
      !cardAndouDepoisDe(c.estagio_desde, operacaoComecouEm),
  );

  // ⚠️ O CARD RECUSADO VAI PARA O LOG, e não some calado: "o envelope andou e o card não" é
  // exatamente o tipo de divergência que ninguém descobre olhando o board.
  //
  // ⚠️ E OS DOIS MOTIVOS SAEM SEPARADOS. "Fora do caminho do tipo" é configuração; "andou durante a
  // operação" é uma corrida entre duas pessoas, e quem lê o log precisa saber qual das duas
  // aconteceu — a segunda quer dizer que alguém devolveu este card enquanto o contrato ia para a
  // Clicksign, e é o aviso de que existe envelope na rua sem card em "assinatura".
  for (const c of cards) {
    if (podem.includes(c) || c.estagio === "faturado" || c.estagio === "indeferido") continue;
    console.warn(
      voltariaNoCaminho(c, destino)
        ? `[temis][card] card ${c.id} (${c.tipo}) não vai para "${destino}": está em "${c.estagio}", mais adiante no caminho, e daqui o card só anda para a frente. A volta é pela volta para correção.`
        : cardAndouDepoisDe(c.estagio_desde, operacaoComecouEm)
          ? `[temis][card] card ${c.id} (${c.tipo}) não vai para "${destino}": ele andou durante a operação — está em "${c.estagio}" desde ${c.estagio_desde}, e a operação começou em ${operacaoComecouEm}.`
          : `[temis][card] card ${c.id} (${c.tipo}) não vai para "${destino}": fora do caminho do tipo.`,
    );
  }

  // ⚠️ DEVOLVE O CARD INTEIRO, E NÃO SÓ O ID. Quem chama precisa do estágio de ANTES para gravar a
  // passagem — e ele deixa de existir no banco no instante do `update`.
  return podem;
}

/**
 * O destino fica ANTES do estágio atual no caminho do tipo? (`estagiosDoTipo` é a ordem.)
 *
 * ⚠️ SÓ RECUSA COM PROVA, como `cardAndouDepoisDe`: estágio fora do caminho do tipo (o intruso que
 * `caminhoDoCard` desenha) não tem posição, e o card segue a regra de antes.
 */
function voltariaNoCaminho(card: Pick<CardParaMover, "estagio" | "tipo">, destino: EstagioDoTrabalho): boolean {
  const caminho = estagiosDoTipo(card.tipo);
  const onde = caminho.indexOf(card.estagio as EstagioDoTrabalho);
  const para = caminho.indexOf(destino);
  if (onde < 0 || para < 0) return false;
  return para < onde;
}

/**
 * O que `moverCardDaTemis` precisa saber de cada card: quem é, de onde sai, de que tipo é e desde
 * quando está onde está.
 */
export type CardParaMover = {
  estagio: string;
  estagio_desde: null | string;
  id: string;
  tipo: TipoDeTrabalho;
};

/**
 * O CARD ANDOU DEPOIS QUE ESTA OPERAÇÃO COMEÇOU?
 *
 * ⚠️ SEPARADA E PURA PORQUE É A REGRA, e não o `select`. Ela decide se um envio que já estava no ar
 * pode ou não desfazer uma devolução para a análise — dentro da função que lê o banco só daria para
 * conferi-la com um duplo de Supabase inteiro.
 *
 * ⚠️ SÓ RECUSA COM PROVA. Sem carimbo (o chamador que não passa nada, que é o comportamento de
 * ontem), com `estagio_desde` nulo, ou com qualquer um dos dois ilegível, a resposta é `false` — ou
 * seja, MOVE. O contrário travaria movimentos legítimos por causa de um dado ausente, e o preço
 * disso não é simétrico: card parado é board desatualizado, que a leitura seguinte conserta; card
 * empurrado indevidamente é uma decisão humana desfeita em silêncio.
 *
 * ⚠️ E COMPARA COMO DATA, NUNCA COMO TEXTO. `estagio_desde` chega do PostgREST com o fuso escrito
 * (`…+00:00`) e o nosso carimbo sai de `toISOString()` (`…Z`): em ordem alfabética `+` vem antes de
 * `Z`, e o mesmo instante pareceria mais antigo ou mais novo conforme quem escreveu a string.
 */
export function cardAndouDepoisDe(
  estagioDesde: null | string | undefined,
  operacaoComecouEm: null | string | undefined,
): boolean {
  if (!operacaoComecouEm || !estagioDesde) return false;
  const comeco = Date.parse(operacaoComecouEm);
  const desde = Date.parse(estagioDesde);
  if (Number.isNaN(comeco) || Number.isNaN(desde)) return false;
  return desde > comeco;
}

/**
 * O QUE ACONTECE COM O CARD QUANDO O ENVELOPE FECHA — e isto MUDOU com as cinco etapas.
 *
 * ⚠️ CONTRATO ASSINADO NÃO É CONTRATO PRONTO. Antes o card ia direto para "finalizado"; agora
 * assinar é o fim da etapa 3, e sobram duas condições que ninguém dentro da Clicksign conhece:
 * os 7 dias de arrependimento e a entrada paga. Por isso contrato vai para `prazo_legal`, onde
 * a tela cobra as duas antes de liberar o faturamento.
 *
 * Cessão, distrato e cancelamento seguem para `faturado` (que a tela chama de "Concluído" neles):
 * Lucas (10/09/2026) — *"Caminho próprio, mais curto"*. Não há arrependimento nem entrada.
 *
 * ⚠️ E É AQUI QUE NASCE A CONTAGEM DOS 7 DIAS. Lucas: contam da ÚLTIMA assinatura do COMPRADOR, e
 * a vendedora não entra. Desde a F1 da fonte única (28/09/2026) a data sai do QUADRO que a função
 * da 0195 acabou de devolver (`envelope.quadro`), com o papel congelado no envio — a ordem de
 * assinatura não serve, porque a vendedora pode estar no meio dela. Antes ela era procurada nos
 * eventos por um `envelope_id` que estava nulo em 226 de 226 (bug 8.3), e o prazo começava "agora".
 *
 * `envelope` é opcional só para quem não passa pelo webhook; o webhook passa sempre.
 */
export async function concluirAssinaturaDoCard(
  sb: SupabaseClient,
  propostaId: string,
  envelope?: { fechadoEm: null | string; quadro: readonly ItemDoQuadro[] },
): Promise<void> {
  // ⚠️ AQUI CABIA UM `maybeSingle`, E ELE FALHAVA CALADO. Uma proposta pode ter dois cards (a
  // venda e o cancelamento dela — medido na proposta do Henrique em 10/09/2026), e o PostgREST
  // responde ERRO a um `maybeSingle` que encontra duas linhas: `card` vinha nulo, a função
  // voltava sem fazer nada e o contrato ASSINADO ficava parado em "Em assinatura" para sempre.
  // Falha por silêncio no único ponto em que o board deveria andar sozinho.
  const { data, error: erroDaLeitura } = await sb
    .from("temis_trabalhos")
    .select("id, tipo, estagio")
    .eq("proposta_id", propostaId);

  if (erroDaLeitura) {
    console.error("[temis][card] falha ao ler os cards da proposta", erroDaLeitura.message);
    return;
  }

  const cards = (data ?? []) as { estagio: string; id: string; tipo: TipoDeTrabalho }[];

  // ⚠️ QUEM CONCLUI É QUEM ESTAVA ASSINANDO. Com dois cards na mesma proposta, mover os dois
  // faria o cancelamento "concluir" por causa da assinatura do contrato da venda. E o card de pedido
  // (cancelamento, distrato) nunca: a assinatura é do contrato, e o pedido só se conclui pela ação
  // própria, que desfaz a venda (revisão de 18/09/2026).
  const card = cards.find((c) => c.estagio === "assinatura" && !TIPOS_DE_PEDIDO.has(String(c.tipo)));

  // Sem card não há o que mover — e isso não é erro: o envelope pode ter nascido fora do quadro.
  if (!card) return;

  const destino: EstagioDoTrabalho =
    card.tipo === "contrato" ? "prazo_legal" : "faturado";

  const remendo: Record<string, unknown> = {
    atualizado_em: new Date().toISOString(),
    estagio: destino,
    estagio_desde: new Date().toISOString(),
  };

  if (destino === "prazo_legal") {
    const inicio = envelope
      ? (ultimaAssinaturaDoComprador(envelope.quadro) ?? envelope.fechadoEm)
      : null;
    // ⚠️ SEM A DATA DO COMPRADOR, VALE O FECHAMENTO — e é o lado seguro: se a vendedora assinou
    // por último, o fechamento é DEPOIS da última assinatura de comprador, então o prazo termina
    // mais tarde e a casa espera mais para faturar. O contrário (começar antes) encurtaria um
    // prazo que é do cliente.
    //
    // ⚠️ O "AGORA" DO FIM É O GESTO DE ANTES, E FICA SÓ ATÉ A F2. Ele só é alcançado quando nem o
    // quadro nem o provedor deram data (a função da 0195 não inventa `fechado_em`); na F2,
    // `aplicarEnvelopeNaVenda` passa a não mover o card sem data real (plano, seção 7).
    remendo.arrependimento_inicio = inicio ?? new Date().toISOString();
  }

  const { error } = await sb
    .from("temis_trabalhos")
    .update(remendo)
    .eq("id", card.id)
    .neq("estagio", "faturado")
    .neq("estagio", "indeferido");

  if (error) {
    // ⚠️ SÓ `code` E `message`, pelo mesmo motivo de `moverCardDaTemis` (CPF na linha do card).
    console.error("[temis][card] falha ao concluir a assinatura", {
      code: error.code ?? null,
      message: error.message ?? null,
    });
    return;
  }

  // ⚠️ A ÚNICA PASSAGEM QUE NINGUÉM DA CASA PROVOCA. As outras cinco nascem de um clique nosso;
  // esta nasce do webhook da Clicksign, e é justamente a que some da memória de todo mundo — o
  // contrato "apareceu" em Pré-faturamento numa madrugada. Sem a linha, a única data que resta é
  // `estagio_desde`, que o próximo movimento sobrescreve.
  //
  // O `de` é seguro: o card foi escolhido acima JUSTAMENTE por estar em `assinatura`, e os dois
  // `.neq` não alcançam esse valor.
  await registrarPassagemDeEtapa(sb, {
    de: card.estagio,
    origem: "webhook_assinatura",
    para: destino,
    propostaId,
    trabalhoId: card.id,
    trabalhoTipo: card.tipo,
  });

  // ⚠️ A VENDA NO ASSINADO (24/09/2026). Contrato vai para o Pré-faturamento e a venda FICA em
  // `assinatura`: o Hércules não tem etapa de pré-faturamento (decisão pendente do Lucas, lado
  // conservador). Normalmente é "já estava"; se o reflexo do envio tiver falhado, a venda alcança
  // `assinatura` aqui, e nunca vai além. Cessão e cancelamento por correção vão a `faturado` e o
  // reflexo os ignora pelo tipo. Autor nulo: é o webhook, como a passagem acima.
  const passo = {
    autorNome: null,
    de: card.estagio,
    motivo: motivoDoReflexo(card.estagio, destino),
    para: destino,
    propostaId,
    trabalhoTipo: card.tipo,
  };
  registrarReflexoQueNaoAndou(card.id, passo, await refletirCardNaVenda(sb, passo));
}

/** Os papéis cuja assinatura conta o prazo de arrependimento (é do cliente). */
const PAPEIS_DO_COMPRADOR = new Set(["comprador", "conjuge"]);

/**
 * Quando o ÚLTIMO comprador assinou, lido do QUADRO (a marca `assinado_em` de cada pessoa).
 *
 * ⚠️ COMPRADOR É COMPRADOR OU CÔNJUGE, E NÃO "QUEM NÃO É VENDEDORA" (bug 8.3). A regra antiga
 * contava a coordenadora, o corretor e a testemunha como compradores: se a testemunha assinasse por
 * último, os 7 dias começavam com ela. O papel vem congelado no envio e nunca é nulo na Clicksign
 * (medido em 8 de 8 contratos, 28/09/2026).
 *
 * ⚠️ COMPARA COMO DATA, E DEVOLVE O TEXTO COMO FOI GUARDADO (`-03:00`, de `emBrasilia`). `null`
 * quando nenhum comprador tem marca: quem chama decide (o fechamento é o lado seguro).
 */
export function ultimaAssinaturaDoComprador(quadro: readonly ItemDoQuadro[]): null | string {
  let ultima: null | string = null;
  for (const item of quadro) {
    if (!PAPEIS_DO_COMPRADOR.has(String(item.papel ?? "").toLowerCase())) continue;
    const quando = item.assinado_em;
    if (!quando || Number.isNaN(Date.parse(quando))) continue;
    if (ultima === null || Date.parse(quando) > Date.parse(ultima)) ultima = quando;
  }
  return ultima;
}

/**
 * Guarda o evento — inclusive o que NÃO passou na conferência — no recorte que a casa pode guardar.
 *
 * ⚠️ O QUE NÃO PASSA É JUSTAMENTE O QUE INTERESSA GUARDAR, por dois motivos opostos: um POST forjado
 * é a informação de segurança mais útil que este endpoint produz, e um evento LEGÍTIMO que não bate
 * é o sinal de que o cabeçalho do HMAC não é o que supomos. Mas do não conferido fica só o
 * ESQUELETO (bug 8.8): antes o corpo inteiro ia para a tabela, e qualquer um que soubesse a URL
 * escrevia o que quisesse nela.
 *
 * ⚠️ E O CONFERIDO VAI REDUZIDO (`payloadReduzidoDaClicksign`): sem CPF, nascimento, geolocalização
 * nem IP, que vinham em 201 de 226 eventos. A redução mora AQUI, e não só na rota, para que nenhum
 * chamador consiga gravar o corpo cheio por esquecimento.
 *
 * ⚠️ E NO NÃO CONFERIDO NENHUMA COLUNA LEVA TEXTO LIVRE DO CORPO (revisão da F1). Não era só o
 * `payload`: `evento`, `envelope_id`, `provedor_documento_id` e `headers` também vinham do POST de
 * quem quisesse. O nome do evento é cortado em 80, os ids só ficam se tiverem forma de id da
 * Clicksign (`idComFormaDaClicksign`), e os cabeçalhos passam pela mesma lista do conferido (mais o
 * `x-real-ip`, a pista de quem forjou).
 *
 * ⚠️ OS CABEÇALHOS SÃO RECORTADOS AQUI, NUNCA NA ROTA (`cabecalhosParaGuardar`): a lista do que
 * GUARDAR, e não do que omitir. A de omitir deixava passar os tokens que a Vercel injeta.
 *
 * ⚠️ `envelopeIdDoRegistro` É O `envelope_id` DA NOSSA LINHA (bug 8.2). Os eventos de documento não
 * trazem o id do envelope, e a coluna ficava nula em 226 de 226: todo leitor que casava por ela
 * (o prazo de arrependimento, inclusive) não achava nada.
 *
 * ⚠️ FALHA AQUI NÃO DERRUBA A RESPOSTA. Provedor reenvia o evento quando não recebe 200, e
 * retentativa em cima de rota que falha vira tempestade. O log leva só `code` e `message`.
 */
export async function registrarEventoDeAssinatura(
  sb: SupabaseClient,
  linha: {
    aplicado: boolean;
    assinaturaCabecalho: null | string;
    assinaturaConferida: boolean;
    envelopeIdDoRegistro?: null | string;
    evento: EventoDaClicksign;
    headers: Record<string, string>;
    /** O corpo lido (JSON). Quem decide o recorte é esta função, não quem chama. */
    payload: unknown;
    /** O tamanho do corpo cru, para o esqueleto do não conferido. */
    tamanho?: number;
  },
): Promise<void> {
  const conferido = linha.assinaturaConferida;
  const payload = conferido
    ? payloadReduzidoDaClicksign(linha.payload)
    : esqueletoDoPayload(linha.payload, linha.tamanho ?? 0);

  const { error } = await sb.from("temis_assinatura_eventos").insert({
    aplicado: linha.aplicado,
    assinatura_cabecalho: linha.assinaturaCabecalho,
    assinatura_conferida: conferido,
    envelope_id: conferido
      ? (linha.envelopeIdDoRegistro ?? linha.evento.envelopeId)
      : idComFormaDaClicksign(linha.evento.envelopeId),
    evento: conferido
      ? linha.evento.evento || null
      : linha.evento.evento.slice(0, TETO_DO_NOME_DO_EVENTO) || null,
    headers: cabecalhosParaGuardar(linha.headers, conferido),
    payload,
    provedor: "clicksign",
    provedor_documento_id: conferido
      ? linha.evento.documentoId
      : idComFormaDaClicksign(linha.evento.documentoId),
  });

  if (error) {
    console.error("[clicksign][webhook] falha ao registrar o evento", {
      code: error.code ?? null,
      message: error.message ?? null,
    });
  }
}
