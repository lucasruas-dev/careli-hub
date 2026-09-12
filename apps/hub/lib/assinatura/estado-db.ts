import type { SupabaseClient } from "@supabase/supabase-js";
import { lerEventoDoWebhook } from "@/lib/assinatura/clicksign/webhook";
import {
  type OrigemDaPassagem,
  registrarPassagemDeEtapa,
} from "@/lib/temis/passagem-de-etapa-db";
import type { EstagioDoTrabalho, TipoDeTrabalho } from "@/lib/temis/trabalhos";

import { estagiosDoTipo } from "@/lib/temis/trabalhos";

import type { EventoDaClicksign } from "./clicksign/webhook";
import { ehTerminal, type EstadoDaAssinatura } from "./tipos";
import { estadoDoEventoClicksign } from "./traduzir";

// O EVENTO DO WEBHOOK VIRA ESTADO — e o card da Têmis anda junto.
//
// ⚠️ SÓ EVENTO CONFERIDO CHEGA AQUI. Quem confere é `conferirAssinaturaDoWebhook`, na rota. Este
// arquivo assume que a assinatura bateu; chamá-lo com um evento não conferido seria o mesmo que não
// ter conferência nenhuma.
//
// ⚠️ ESTADO TERMINAL NÃO REGRIDE, e esta é a proteção que falta na maioria das integrações de
// webhook. Provedor reenvia evento quando não recebe 200, e os reenvios chegam FORA DE ORDEM: um
// `sign` atrasado, entregue depois do `auto_close`, poria um contrato ASSINADO de volta em
// "parcialmente assinado" — e a Têmis mandaria alguém cobrar uma assinatura que já existe. O mesmo
// vale para um `sign` que chega depois de uma recusa.
//
// ⚠️ E `sign` NÃO É CONCLUSÃO. Um `sign` é UMA pessoa; o contrato só fecha em `close` / `auto_close`
// / `document_closed`. Tratar `sign` como fim daria o contrato por concluído no primeiro dos quatro
// compradores. A tradução mora em `traduzir.ts` e é a mesma que a tela usa.

export type AplicacaoDoEvento = {
  aplicado: boolean;
  /** Uma frase para o log: por que aplicou, ou por que não. */
  motivo: string;
  /** O estado que a linha ficou (ou já tinha). */
  estado: null | EstadoDaAssinatura;
};

type LinhaDoEnvelope = {
  estado: string;
  id: string;
  proposta_id: null | string;
};

/**
 * Move o envelope (e o card) conforme o evento.
 *
 * ⚠️ NUNCA LANÇA. Ele roda depois de a rota já ter respondido 200; uma exceção aqui viraria um
 * unhandled rejection no runtime da Vercel, sem ninguém para pegá-la — e sem nada no lugar do
 * estado que deveria ter mudado. Toda falha vira `aplicado: false` com o motivo escrito.
 */
export async function aplicarEventoDaClicksign(
  sb: SupabaseClient,
  evento: EventoDaClicksign,
): Promise<AplicacaoDoEvento> {
  const novo = estadoDoEventoClicksign(evento.evento);
  if (!novo) {
    // Evento de bastidor (`upload`, `add_signer`, as falhas de autenticação do signatário…). Fica
    // registrado e não move o card — ver a nota de `ESTADO_POR_EVENTO`.
    return { aplicado: false, estado: null, motivo: `evento "${evento.evento}" não move o estado` };
  }

  const linha = await acharEnvelope(sb, evento);
  if (!linha) {
    return {
      aplicado: false,
      estado: null,
      motivo: "não achei o envelope no Panteon (documento/envelope desconhecido)",
    };
  }

  const atual = linha.estado as EstadoDaAssinatura;
  if (ehTerminal(atual)) {
    return {
      aplicado: false,
      estado: atual,
      motivo: `a linha já está em "${atual}", que é terminal — evento fora de ordem não regride estado`,
    };
  }

  const agora = new Date().toISOString();
  const { error } = await sb
    .from("temis_envelopes")
    .update({
      atualizado_em: agora,
      estado: novo,
      estado_cru: `clicksign:${evento.evento}`,
      ...(ehTerminal(novo) ? { fechado_em: agora } : {}),
    })
    .eq("id", linha.id);

  if (error) {
    console.error("[clicksign][webhook] falha ao gravar o estado do envelope", error);
    return { aplicado: false, estado: atual, motivo: `falha ao gravar: ${error.message}` };
  }

  // ⚠️ O CARD SÓ ANDA QUANDO O CONTRATO FECHA. Um `sign` isolado deixa o card onde está: ele
  // continua "em assinatura", que é a verdade — falta gente. Mover a cada assinatura faria o board
  // piscar e diria "assinado" com metade das assinaturas.
  if (novo === "assinado" && linha.proposta_id) {
    await concluirAssinaturaDoCard(sb, linha.proposta_id);
  }

  return { aplicado: true, estado: novo, motivo: `${atual} → ${novo}` };
}

/**
 * Acha a linha por qualquer um dos dois ids que o evento possa trazer.
 *
 * ⚠️ O DOCUMENTO VEM PRIMEIRO, e é uma decisão medida: os eventos da Clicksign são de DOCUMENTO
 * (`sign`, `refusal`, `document_closed`), e o id do documento é o que aparece em todos eles. O id do
 * envelope é o que aparece nos de envelope. Procurar só por um deles perderia metade dos eventos —
 * e o formato do corpo entregue ao endpoint NÃO está documentado (a doc da v3 lista os 30 eventos e
 * não mostra um exemplo do payload), então o leitor tenta os dois.
 */
async function acharEnvelope(
  sb: SupabaseClient,
  evento: EventoDaClicksign,
): Promise<LinhaDoEnvelope | null> {
  const tentativas: Array<[string, string]> = [];
  if (evento.documentoId) tentativas.push(["provedor_documento_id", evento.documentoId]);
  if (evento.envelopeId) tentativas.push(["envelope_id", evento.envelopeId]);
  // ⚠️ O `metadata` É A REDE DE SEGURANÇA, e ele é NOSSO: foi o Panteon que o gravou no documento
  // no momento do envio, e a Clicksign o devolve inteiro no webhook (conferido no primeiro evento
  // real, 09/09/2026 — voltaram `proposta_id`, `documento_id`, `unidade`, `comprador` e `teste`).
  //
  // ⚠️ E ELE VEM POR ÚLTIMO DE PROPÓSITO. O id do provedor é mais específico: identifica ESTE
  // envelope. A proposta pode ter mais de um envelope ao longo da vida (um recusado e um reenviado),
  // e aí a busca por proposta pegaria o mais recente — que é o certo quando não há id nenhum, e o
  // errado quando há. Primeiro o preciso, depois o que salva.
  const propostaDoMetadata = String(evento.metadados?.proposta_id ?? "").trim();
  if (propostaDoMetadata) tentativas.push(["proposta_id", propostaDoMetadata]);

  for (const [coluna, valor] of tentativas) {
    const { data, error } = await sb
      .from("temis_envelopes")
      .select("id, estado, proposta_id")
      .eq("provedor", "clicksign")
      .eq(coluna, valor)
      .order("criado_em", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error("[clicksign][webhook] falha ao procurar o envelope", error);
      continue;
    }
    if (data) return data as LinhaDoEnvelope;
  }

  return null;
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
 */
export async function moverCardDaTemis(
  sb: SupabaseClient,
  propostaId: string,
  estagio: EstagioDoTrabalho,
  autor?: null | { id: null | string; nome: null | string },
  operacaoComecouEm?: null | string,
): Promise<void> {
  const alvos = await cardsQueAceitam(sb, propostaId, estagio, operacaoComecouEm ?? null);
  if (alvos.length === 0) return;

  const agora = new Date().toISOString();
  const { error } = await sb
    .from("temis_trabalhos")
    .update({ atualizado_em: agora, estagio, estagio_desde: agora })
    .in(
      "id",
      alvos.map((c) => c.id),
    );

  if (error) {
    console.error("[temis][card] falha ao mover o card da proposta", error);
    return;
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

  const cards = (data ?? []) as CardParaMover[];
  const podem = cards.filter(
    (c) =>
      c.estagio !== "faturado" &&
      c.estagio !== "indeferido" &&
      estagiosDoTipo(c.tipo).includes(destino) &&
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
      cardAndouDepoisDe(c.estagio_desde, operacaoComecouEm)
        ? `[temis][card] card ${c.id} (${c.tipo}) não vai para "${destino}": ele andou durante a operação — está em "${c.estagio}" desde ${c.estagio_desde}, e a operação começou em ${operacaoComecouEm}.`
        : `[temis][card] card ${c.id} (${c.tipo}) não vai para "${destino}": fora do caminho do tipo.`,
    );
  }

  // ⚠️ DEVOLVE O CARD INTEIRO, E NÃO SÓ O ID. Quem chama precisa do estágio de ANTES para gravar a
  // passagem — e ele deixa de existir no banco no instante do `update`.
  return podem;
}

/**
 * O que `moverCardDaTemis` precisa saber de cada card: quem é, de onde sai, de que tipo é e desde
 * quando está onde está.
 */
type CardParaMover = {
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
 * a vendedora não entra. Por isso a data é procurada nos eventos de assinatura, cruzando com o
 * papel congelado em `temis_envelopes.signatarios` — a ordem de assinatura não serve, porque a
 * vendedora pode estar no meio dela.
 */
export async function concluirAssinaturaDoCard(
  sb: SupabaseClient,
  propostaId: string,
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
  // faria o cancelamento "concluir" por causa da assinatura do contrato da venda.
  const card = cards.find((c) => c.estagio === "assinatura");

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
    const inicio = await ultimaAssinaturaDeComprador(sb, propostaId);
    // ⚠️ SEM A DATA DO COMPRADOR, VALE O FECHAMENTO — e é o lado seguro: se a vendedora assinou
    // por último, o fechamento é DEPOIS da última assinatura de comprador, então o prazo termina
    // mais tarde e a casa espera mais para faturar. O contrário (começar antes) encurtaria um
    // prazo que é do cliente.
    remendo.arrependimento_inicio = inicio ?? new Date().toISOString();
  }

  const { error } = await sb
    .from("temis_trabalhos")
    .update(remendo)
    .eq("id", card.id)
    .neq("estagio", "faturado")
    .neq("estagio", "indeferido");

  if (error) {
    console.error("[temis][card] falha ao concluir a assinatura", error);
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
}

/**
 * Quando o ÚLTIMO comprador assinou.
 *
 * `null` quando não dá para saber — envelope sem papéis congelados, ou nenhum evento de assinatura
 * guardado. Quem chama decide o que fazer com a ausência.
 */
async function ultimaAssinaturaDeComprador(
  sb: SupabaseClient,
  propostaId: string,
): Promise<null | string> {
  const { data: envelope } = await sb
    .from("temis_envelopes")
    .select("envelope_id, signatarios")
    .eq("proposta_id", propostaId)
    .order("criado_em", { ascending: false })
    .limit(1)
    .maybeSingle<{ envelope_id: null | string; signatarios: unknown }>();

  // ⚠️ `envelope_id` É O ID DO PROVEDOR, e não a chave da nossa tabela — é por ele que os eventos
  // se ligam (`temis_assinatura_eventos.envelope_id`, text). Nulo = envio que começou e não
  // terminou, e aí não há evento nenhum para procurar.
  if (!envelope?.envelope_id) return null;

  // ⚠️ COMPRADOR É QUEM NÃO É VENDEDORA. O papel vem congelado no envelope no momento do envio, e
  // é a única fonte confiável: a ORDEM de assinatura não diz papel, e a vendedora pode estar no
  // meio dela — que é justamente o caso que faria a conta errar.
  const emailsDeComprador = new Set(
    (Array.isArray(envelope.signatarios) ? envelope.signatarios : [])
      .map((s) => s as { email?: string; papel?: string })
      .filter((s) => String(s.papel ?? "").toLowerCase() !== "vendedora")
      .map((s) => String(s.email ?? "").trim().toLowerCase())
      .filter(Boolean),
  );

  if (emailsDeComprador.size === 0) return null;

  // ⚠️ O E-MAIL NÃO TEM COLUNA: ele vive dentro do `payload` cru. Reusar `lerEventoDoWebhook` aqui
  // é o que garante que a leitura de agora e a do webhook enxerguem o mesmo campo — o formato do
  // corpo da Clicksign não está documentado, e um segundo leitor divergiria no primeiro evento
  // que viesse com a forma inesperada.
  const { data: eventos } = await sb
    .from("temis_assinatura_eventos")
    .select("payload, recebido_em")
    .eq("envelope_id", envelope.envelope_id)
    .eq("assinatura_conferida", true)
    .order("recebido_em", { ascending: false });

  for (const ev of (eventos ?? []) as { payload: unknown; recebido_em: string }[]) {
    if (!ev.payload) continue;
    let email = "";
    try {
      email = String(
        lerEventoDoWebhook(JSON.stringify(ev.payload)).signatarioEmail ?? "",
      )
        .trim()
        .toLowerCase();
    } catch {
      // Payload que não volta a ser JSON não derruba a conta: segue para o próximo evento.
      continue;
    }
    // A lista vem do mais novo para o mais antigo: o primeiro comprador encontrado é o ÚLTIMO
    // que assinou.
    if (email && emailsDeComprador.has(email)) return ev.recebido_em;
  }

  return null;
}

/**
 * Guarda o evento cru — inclusive o que NÃO passou na conferência.
 *
 * ⚠️ O QUE NÃO PASSA É JUSTAMENTE O QUE INTERESSA GUARDAR, por dois motivos opostos: um POST forjado
 * é a informação de segurança mais útil que este endpoint produz, e um evento LEGÍTIMO que não bate
 * é o sinal de que o cabeçalho do HMAC não é o que supomos — o nome dele não está documentado (ver
 * `lib/assinatura/clicksign/webhook.ts`). Descartar os dois deixaria as duas descobertas invisíveis.
 *
 * ⚠️ FALHA AQUI NÃO DERRUBA A RESPOSTA. Provedor reenvia o evento quando não recebe 200, e
 * retentativa em cima de rota que falha vira tempestade.
 */
export async function registrarEventoDeAssinatura(
  sb: SupabaseClient,
  linha: {
    aplicado: boolean;
    assinaturaCabecalho: null | string;
    assinaturaConferida: boolean;
    evento: EventoDaClicksign;
    headers: Record<string, string>;
    payload: unknown;
  },
): Promise<void> {
  const { error } = await sb.from("temis_assinatura_eventos").insert({
    aplicado: linha.aplicado,
    assinatura_cabecalho: linha.assinaturaCabecalho,
    assinatura_conferida: linha.assinaturaConferida,
    envelope_id: linha.evento.envelopeId,
    evento: linha.evento.evento || null,
    headers: linha.headers,
    payload: linha.payload,
    provedor: "clicksign",
    provedor_documento_id: linha.evento.documentoId,
  });

  if (error) console.error("[clicksign][webhook] falha ao registrar o evento", error);
}
