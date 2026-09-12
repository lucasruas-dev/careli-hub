import type { SupabaseClient } from "@supabase/supabase-js";

import {
  diarioDoEnvelope,
  type FatoDoEnvelope,
  quemAssinou,
  type SignatarioDoEnvelope,
} from "./diario-do-envelope";

// O DIÁRIO DA PROPOSTA — a leitura que a tela e o card usam.
//
// ⚠️ UM PAYLOAD BASTA, E É ISSO QUE TORNA A COISA BARATA. A Clicksign manda o `document.events[]`
// INTEIRO em todo webhook: o payload do evento mais recente contém a história toda, desde o upload.
// Ler os N eventos do envelope e juntar daria exatamente a mesma resposta com N vezes o custo — e a
// casa já teve fatura alta da Vercel por leitura repetida. São DUAS consultas, sempre: o envelope e
// um payload.
//
// ⚠️ E NÃO HÁ POLLING AQUI. Isto é leitura sob demanda, na carga da tela. Quem atualiza o estado é o
// webhook (`estado-db.ts`), que é empurrado pela Clicksign.
//
// ⚠️ NUNCA LANÇA. O diário é enfeite: ele explica por que o contrato está parado. Derrubar a etapa
// do contrato porque a consulta do enfeite falhou seria trocar a tela inteira por uma informação a
// mais. Erro vira `null` e um `console.error`.

/** Como a tela recebe cada pessoa: o que os eventos contaram, mais o papel que NÓS congelamos. */
export type SignatarioDaProposta = SignatarioDoEnvelope & {
  /**
   * `comprador`, `conjuge`, `vendedora`… vindo de `temis_envelopes.signatarios`.
   *
   * ⚠️ ELE NÃO VEM DA CLICKSIGN. A Clicksign só conhece `qualification`; o papel no CONTRATO é
   * nosso, congelado no envio, e é o que a tela mostra ao lado do nome. `null` quando a pessoa
   * apareceu nos eventos e não está na lista congelada (signatário acrescentado por fora).
   */
  papel: null | string;
};

export type EnvelopeDoDiario = {
  atualizadoEm: null | string;
  /**
   * O id do envelope NA CLICKSIGN — o número que se procura na conta deles.
   *
   * ⚠️ NÃO CONFUNDIR COM `id`, QUE É A NOSSA LINHA. É este que a tela escreve ao lado do log: quem
   * lê o painel e precisa abrir a Clicksign procura por ele, e mostrar o uuid da nossa tabela
   * mandaria o operador caçar um número que não existe do lado de lá. `null` = envio que começou e
   * o Panteon não soube como terminou.
   */
  envelopeId: null | string;
  /** O estado no vocabulário da Têmis: `aguardando`, `parcial`, `assinado`… */
  estado: string;
  estadoCru: null | string;
  /** A chave da NOSSA linha em `temis_envelopes`. */
  id: string;
  provedor: string;
  provedorDocumentoId: null | string;
  signatarios: SignatarioDaProposta[];
};

export type DiarioDaProposta = {
  /** Quantos JÁ assinaram — o numerador do "1/5" que o Lucas pediu no card (12/09/2026). */
  assinaram: number;
  /** Do mais recente para o mais antigo. Vem vazio enquanto nenhum webhook chegou. */
  diario: FatoDoEnvelope[];
  envelope: EnvelopeDoDiario;
  /** Quantos signatários o envelope tem — o denominador do "1/5". */
  total: number;
};

type LinhaDoEnvelope = {
  atualizado_em: null | string;
  envelope_id: null | string;
  estado: null | string;
  estado_cru: null | string;
  id: string;
  provedor: null | string;
  provedor_documento_id: null | string;
  signatarios: unknown;
};

/**
 * O diário do envelope MAIS RECENTE desta proposta.
 *
 * Devolve `null` quando não há envelope nenhum, ou quando alguma consulta falhou — os dois casos em
 * que a tela simplesmente não mostra o bloco. Um envelope que existe mas ainda não recebeu webhook
 * volta como objeto, com `diario` vazio e a contagem vinda da lista congelada no envio: é a
 * diferença entre "não temos o que contar ainda" e "não há o que contar".
 */
export async function diarioDaProposta(
  sb: SupabaseClient,
  propostaId: string,
): Promise<DiarioDaProposta | null> {
  if (!propostaId) return null;

  const envelope = await envelopeMaisRecente(sb, propostaId);
  if (!envelope) return null;

  const payload = await payloadMaisRecente(sb, envelope);
  const congelados = signatariosCongelados(envelope.signatarios);

  const doPayload = payload === null ? [] : quemAssinou(payload);
  const signatarios = juntarComOsCongelados(doPayload, congelados);

  return {
    assinaram: signatarios.filter((s) => s.assinouEm !== null).length,
    diario: payload === null ? [] : diarioDoEnvelope(payload),
    envelope: {
      atualizadoEm: envelope.atualizado_em,
      envelopeId: envelope.envelope_id,
      estado: envelope.estado ?? "desconhecido",
      estadoCru: envelope.estado_cru,
      id: envelope.id,
      provedor: envelope.provedor ?? "clicksign",
      provedorDocumentoId: envelope.provedor_documento_id,
      signatarios,
    },
    total: signatarios.length,
  };
}

/**
 * O envelope mais recente da proposta.
 *
 * ⚠️ MAIS RECENTE, E NÃO "O ENVELOPE". Uma proposta pode ter mais de um ao longo da vida — um
 * recusado e um reenviado —, e é a mesma razão pela qual `acharEnvelope` (em `estado-db.ts`) ordena
 * por `criado_em` decrescente. O diário do envelope velho contaria uma história que já não vale.
 */
async function envelopeMaisRecente(
  sb: SupabaseClient,
  propostaId: string,
): Promise<LinhaDoEnvelope | null> {
  const { data, error } = await sb
    .from("temis_envelopes")
    .select(
      "id, provedor, envelope_id, provedor_documento_id, estado, estado_cru, atualizado_em, signatarios",
    )
    .eq("proposta_id", propostaId)
    .order("criado_em", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("[temis][diário] falha ao ler o envelope da proposta", error.message);
    return null;
  }
  return (data as LinhaDoEnvelope | null) ?? null;
}

/**
 * O payload do último webhook deste envelope.
 *
 * ⚠️ O CASAMENTO É POR `provedor_documento_id`, E ISSO FOI MEDIDO, NÃO ESCOLHIDO. Nas sete linhas de
 * `temis_assinatura_eventos` existentes em 12/09/2026 a coluna `envelope_id` está NULA em TODAS:
 * quem grava o evento é a rota do webhook, que só conhece os ids que a Clicksign mandou, e a
 * Clicksign manda `document.key`. Procurar por `envelope_id` primeiro não acharia nada.
 *
 * ⚠️ E O `envelope_id` CONTINUA COMO SEGUNDA TENTATIVA. Ele é o id do ENVELOPE na Clicksign (a v3
 * tem os dois conceitos), e os eventos de envelope o trazem. Hoje não casa com nada; no dia em que
 * casar, casa sem ninguém mexer aqui — e a ordem "primeiro o preciso, depois o que salva" é a mesma
 * de `acharEnvelope`.
 *
 * ⚠️ SEM FILTRAR POR `assinatura_conferida`, DE PROPÓSITO. Aqui não se move contrato nenhum: é
 * narração. Um evento que chegou sem HMAC válido é registrado e não vira estado (`estado-db.ts` é
 * quem decide isso) — mas esconder do diário o fato de ele ter chegado tiraria justamente a pista
 * de quem estivesse investigando por que o contrato não anda.
 */
async function payloadMaisRecente(
  sb: SupabaseClient,
  envelope: LinhaDoEnvelope,
): Promise<unknown> {
  const tentativas: Array<[string, string]> = [];
  if (envelope.provedor_documento_id) {
    tentativas.push(["provedor_documento_id", envelope.provedor_documento_id]);
  }
  if (envelope.envelope_id) tentativas.push(["envelope_id", envelope.envelope_id]);

  for (const [coluna, valor] of tentativas) {
    const { data, error } = await sb
      .from("temis_assinatura_eventos")
      .select("payload")
      .eq(coluna, valor)
      .order("recebido_em", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error("[temis][diário] falha ao ler o payload do envelope", error.message);
      continue;
    }
    const linha = data as null | { payload: unknown };
    if (linha?.payload) return linha.payload;
  }

  return null;
}

type SignatarioCongelado = { email: string; nome: string; papel: null | string };

/** A lista que o envio congelou em `temis_envelopes.signatarios` (`{ nome, email, ordem, papel }`). */
function signatariosCongelados(bruto: unknown): SignatarioCongelado[] {
  if (!Array.isArray(bruto)) return [];
  const saida: SignatarioCongelado[] = [];
  for (const item of bruto) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const pessoa = item as Record<string, unknown>;
    saida.push({
      email: typeof pessoa.email === "string" ? pessoa.email.trim() : "",
      nome: typeof pessoa.nome === "string" ? pessoa.nome.trim() : "",
      papel: typeof pessoa.papel === "string" ? pessoa.papel : null,
    });
  }
  return saida;
}

/**
 * Junta o que os eventos contaram com o que o envio congelou.
 *
 * ⚠️ QUEM NUNCA APARECEU NUM EVENTO PRECISA APARECER NA CONTA. O denominador do "1/5" é quantas
 * pessoas TÊM de assinar — e antes do primeiro webhook nenhuma delas apareceu em evento nenhum. Sem
 * esta junção o card mostraria "0/0" no envelope recém-enviado, que é a hora em que o operador mais
 * olha para ele.
 *
 * ⚠️ O CASAMENTO AQUI É POR E-MAIL, e não por `signer.key`, porque a lista congelada NÃO TEM chave:
 * ela nasce antes de a Clicksign existir para aquele contrato. O e-mail serve porque a CAD já trava
 * e-mail repetido por pessoa (`lib/apolo/email-unico.ts`) — e continua não sendo o nome, que é o
 * campo que se repete e muda de acento.
 */
function juntarComOsCongelados(
  doPayload: SignatarioDoEnvelope[],
  congelados: SignatarioCongelado[],
): SignatarioDaProposta[] {
  const papelPorEmail = new Map<string, null | string>();
  for (const c of congelados) {
    if (c.email) papelPorEmail.set(c.email.toLowerCase(), c.papel);
  }

  const juntos: SignatarioDaProposta[] = doPayload.map((s) => ({
    ...s,
    papel: papelPorEmail.get(s.email.toLowerCase()) ?? null,
  }));

  const jaTem = new Set(juntos.map((s) => s.email.toLowerCase()).filter((e) => e !== ""));
  for (const c of congelados) {
    if (c.email && jaTem.has(c.email.toLowerCase())) continue;
    juntos.push({
      assinouEm: null,
      // Sem `signer.key` — ela só existe depois que a Clicksign responde. O e-mail é a identidade
      // possível aqui, e é o mesmo campo por onde a junção acima procura.
      chave: c.email,
      comecouEm: null,
      convite: "sem_noticia",
      conviteDetalhe: null,
      conviteQuando: null,
      email: c.email,
      nome: c.nome,
      papel: c.papel,
    });
  }

  return juntos;
}
