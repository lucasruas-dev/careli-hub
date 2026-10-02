import { emBrasilia } from "./instante";
import type { EstadoDaAssinatura } from "./tipos";

// AS MARCAS DE CADA PESSOA, LIDAS DO PAYLOAD DA CLICKSIGN — o parser único do webhook.
//
// Lucas, 28/09/2026: *"já cansei de falar que informações de venda, contrato, assinatura tem que
// morar em um local e ele alimentar tudo"*. Até aqui QUEM assinou e QUANDO só existia dentro do
// payload cru guardado em `temis_assinatura_eventos` (que também trazia CPF em 201 de 226 eventos),
// e cada tela relia o payload do seu jeito. Daqui sai a MARCA por pessoa que a função da 0195
// (`temis_envelope_registrar_assinaturas`) grava no quadro do envelope, e é do quadro que as telas
// passam a ler.
//
// ⚠️ UM PARSER SÓ. Os leitores de payload que moravam em `diario-do-envelope.ts` (o documento nas
// três formas, `document.events[]`, as pessoas de um evento, o convite que não chegou) foram
// trazidos para cá e o diário os importa daqui. Duas cópias do "onde mora o documento" já deram
// "0 de 2 assinaram" ao lado de "1/2" na mesma tela (ver a nota de `documentoDoPayload`).
//
// ⚠️ SÓ IMPORTA FOLHA, E POR CAMINHO RELATIVO. `scripts/temis/reprocessar-eventos-clicksign.mjs`
// carrega este arquivo pelo `jiti`, que não resolve o apelido `@/` do Next. `./instante` é outra
// folha pura e `./tipos` entra só como tipo (some na transpilação). Um import de `traduzir.ts`
// aqui arrastaria `@/lib/guardian/...` e derrubaria o script.

// ── O QUE SAI DAQUI ─────────────────────────────────────────────────────────

/**
 * O que um evento do provedor AFIRMA sobre uma pessoa do quadro.
 *
 * ⚠️ NÃO É O ESTADO DA PESSOA, É UMA MARCA. Quem junta as marcas no quadro é a função SQL da 0195,
 * que casa pela `chave`, nunca apaga uma marca e fica com a PRIMEIRA data de assinatura. Por isso
 * uma marca por evento, sem pré-agregar aqui: agregar em dois lugares daria duas respostas.
 */
export type MarcaDeAssinatura = {
  /** ISO com -03:00 (já passado por `emBrasilia`). Nulo = esta marca não afirma assinatura. */
  assinadoEm: null | string;
  /**
   * Id da pessoa NO PROVEDOR, igual ao `chave` do item do quadro: `signer.key` (Clicksign) ou
   * `c2x:<ss.id>` (D4Sign, depois do pareamento).
   */
  chave: null | string;
  /**
   * Minúsculo. Só vale como reserva: quando a marca não tem chave que exista no quadro E o e-mail é
   * único no quadro (quem decide é a função SQL, ATENCAO 3 da 0195).
   */
  email: null | string;
  recusadoEm: null | string;
  /** bounce/dropped da notificação do convite (a régua é `situacaoDoConvite`). */
  conviteFalhouEm?: null | string;
  /** A Clicksign afirmou que o convite foi entregue. */
  conviteEntregueEm?: null | string;
};

// ── OS LEITORES DO PAYLOAD (vieram de `diario-do-envelope.ts`) ───────────────

/** O valor como objeto, ou `{}`. Nunca devolve nulo, então NUNCA encadeie com `??`. */
export function objeto(bruto: unknown): Record<string, unknown> {
  return bruto && typeof bruto === "object" && !Array.isArray(bruto)
    ? (bruto as Record<string, unknown>)
    : {};
}

export function lista(bruto: unknown): unknown[] {
  return Array.isArray(bruto) ? bruto : [];
}

export function texto(bruto: unknown): string {
  return typeof bruto === "string" ? bruto.trim() : "";
}

/**
 * O `document` do payload, ACEITANDO AS TRÊS FORMAS que a Clicksign usa.
 *
 * ⚠️ LER SÓ A RAIZ ZERA A TELA SEM ERRO NENHUM. O card do quadro já procurava nos três lugares
 * (`lerEventosDoPayload`, em `lib/temis/trabalhos-db.ts`) e o diário procurava em um só: um payload
 * no formato JSON:API (`data.document`) fazia o painel dizer "0 de 2 assinaram" ao lado de um card
 * dizendo "1/2". Duas telas, duas verdades, sobre o mesmo envelope.
 */
export function documentoDoPayload(payload: unknown): Record<string, unknown> {
  const raiz = objeto(payload);
  for (const candidato of [raiz.document, objeto(raiz.data).document, objeto(raiz.event).document]) {
    const achado = objeto(candidato);
    if (Object.keys(achado).length > 0) return achado;
  }
  return {};
}

/** Um evento de `document.events[]`, com o nome em minúsculas e a data normalizada. */
export type EventoDoDocumento = {
  dados: Record<string, unknown>;
  nome: string;
  quando: string;
};

/**
 * Os eventos que a Clicksign mandou dentro do documento.
 *
 * ⚠️ SÓ `document.events[]`, E O `event` DA RAIZ FICA DE FORA DE PROPÓSITO. Medido no payload real
 * de 12/09/2026: o evento que disparou o webhook é sempre o PRIMEIRO item do array. Somar os dois
 * duplicaria toda última linha do diário. (As marcas somam os dois e deduplicam: ver
 * `marcasDoPayloadDaClicksign`.)
 *
 * ⚠️ E PAYLOAD TORTO DEVOLVE VAZIO, NUNCA LANÇA.
 */
export function eventosDoDocumento(payload: unknown): EventoDoDocumento[] {
  const documento = documentoDoPayload(payload);
  const saida: EventoDoDocumento[] = [];
  for (const bruto of lista(documento.events)) {
    const evento = objeto(bruto);
    // ⚠️ ITEM QUE NÃO É OBJETO NÃO É "EVENTO DESCONHECIDO": é lixo, e não carrega fato nenhum.
    if (Object.keys(evento).length === 0) continue;
    const nome = texto(evento.name) || texto(evento.type);
    saida.push({
      dados: objeto(evento.data),
      nome: nome.toLowerCase(),
      quando: emIso(evento.occurred_at),
    });
  }
  return saida;
}

/**
 * As pessoas de um evento.
 *
 * ⚠️ A CLICKSIGN USA OS DOIS FORMATOS NO MESMO PAYLOAD: `add_signer` traz `data.signers[]` (array,
 * mesmo com uma pessoa só) e `sign` / `signature_started` / `tracking_notification_error` trazem
 * `data.signer` (objeto).
 */
export function pessoasDoEvento(dados: Record<string, unknown>): unknown[] {
  const doArray = lista(dados.signers);
  if (doArray.length > 0) return doArray;
  const unico = objeto(dados.signer);
  return Object.keys(unico).length > 0 ? [unico] : [];
}

/**
 * A data em ISO (`Z`), normalizada, para ORDENAR.
 *
 * ⚠️ OS DOIS FUSOS CONVIVEM NO MESMO PAYLOAD: o `event.occurred_at` da raiz chega em `-03:00` e os
 * de `document.events[]` chegam em `Z`. O QUE NÃO DÁ PARA LER FICA COMO VEIO (a ordenação joga o
 * ilegível para o fim). Para GUARDAR a marca, o texto é outro: `emBrasilia`.
 */
export function emIso(bruto: unknown): string {
  const cru = texto(bruto);
  if (!cru) return "";
  const lido = Date.parse(cru);
  return Number.isNaN(lido) ? cru : new Date(lido).toISOString();
}

/** O que a Clicksign disse sobre o CONVITE de assinatura. */
export type SituacaoDoConvite = "entregue" | "nao_entregue";

/**
 * O que este evento diz sobre o CONVITE de quem assina — ou nada.
 *
 * ⚠️ SÓ O CONVITE DE ASSINATURA CONTA. A Clicksign usa o mesmo `notification` para lembretes e para o
 * aviso de documento finalizado (`kind` diferente de `signature_request`); um lembrete que voltou
 * não quer dizer que o convite original não chegou.
 *
 * ⚠️ `entregue` SÓ SAI DE UMA AFIRMAÇÃO DO PROVEDOR. Silêncio é "sem notícia", nunca "entregue".
 */
export function situacaoDoConvite(
  nomeDoEvento: string,
  dados: Record<string, unknown>,
): null | SituacaoDoConvite {
  const notificacao = objeto(dados.notification);
  if (Object.keys(notificacao).length === 0) return null;
  if (texto(notificacao.kind) !== "signature_request") return null;

  const status = texto(notificacao.last_status).toLowerCase();
  if (status === "delivered") return "entregue";

  const deuErrado =
    nomeDoEvento === "tracking_notification_error" ||
    ["blocked", "bounce", "dropped", "failed", "spam", "spamcomplaint"].includes(status);
  return deuErrado ? "nao_entregue" : null;
}

// ── O CATÁLOGO DOS EVENTOS QUE MUDAM O ESTADO ───────────────────────────────

/**
 * Os eventos da Clicksign que propõem um estado. Os demais (~20) são de bastidor.
 *
 * ⚠️ ELE MORA AQUI, E `traduzir.ts` O LÊ DAQUI. A regra de ouro de `traduzir.ts` é "o catálogo de
 * eventos não pode ter duas cópias"; ele mudou de casa porque esta folha não pode importar
 * `traduzir.ts` (ver o topo), e `estadoPropostoPeloEvento` precisa dele.
 *
 * ⚠️ `sign` NÃO VIRA `assinado`: um `sign` é UMA pessoa. E os três fechamentos só viram `assinado`
 * com a prova de que todos assinaram (`estadoPropostoPeloEvento`, bug 8.7 do plano): `closed` sem
 * todos é `expirado`.
 */
export const ESTADO_POR_EVENTO_DA_CLICKSIGN: Readonly<Record<string, EstadoDaAssinatura>> = {
  auto_close: "assinado",
  cancel: "cancelado",
  close: "assinado",
  deadline: "expirado",
  document_closed: "assinado",
  refusal: "recusado",
  sign: "parcial",
  signature_started: "aguardando",
  upload: "rascunho",
};

/** Os eventos que FECHAM o documento — os que dependem de "todos assinaram?". */
const EVENTOS_DE_FECHAMENTO = new Set(["auto_close", "close", "document_closed"]);

/** Os eventos cuja data é a do fim do documento (para `fechado_em`, que nunca é "agora"). */
const EVENTOS_QUE_ENCERRAM = new Set([...EVENTOS_DE_FECHAMENTO, "cancel", "deadline", "refusal"]);

// ── AS MARCAS ───────────────────────────────────────────────────────────────

/** Os eventos do documento MAIS o da raiz, que em alguns payloads é o único que vem. */
function eventosComARaiz(payload: unknown): EventoDoDocumento[] {
  const doDocumento = eventosDoDocumento(payload);
  const raiz = objeto(objeto(payload).event);
  const nome = (texto(raiz.name) || texto(raiz.type)).toLowerCase();
  if (!nome) return doDocumento;
  // ⚠️ `event.data.signer` É ONDE O SIGNATÁRIO VEM DE VERDADE (0.4 do plano: 55 de 226 payloads, e
  // nenhum em `raiz.signer`). O evento da raiz costuma repetir `events[0]`; a duplicata some na
  // deduplicação das marcas, e a função SQL fica com a primeira data de qualquer jeito.
  return [...doDocumento, { dados: objeto(raiz.data), nome, quando: emIso(raiz.occurred_at) }];
}

// ── O LINK DE ASSINATURA ────────────────────────────────────────────────────

/** O tamanho máximo de um link de assinatura: os reais têm ~100 caracteres. */
const TETO_DO_LINK = 300;

/**
 * O LINK É DA CLICKSIGN? — `https://app.clicksign.com/...`, no caminho da assinatura, ou nada.
 *
 * ⚠️ ESTE LINK VAI PARA O CLIENTE PELA MÃO DO NOSSO ATENDIMENTO, e por isso a régua é estreita. Lucas,
 * 02/10/2026: *"quero ter esse link para mandar para o cliente, tem hora que ele não acha o link no
 * e-mail"*. Um link de outro endereço que entrasse aqui seria encaminhado ao cliente por nós: só
 * passa https, o host exato `app.clicksign.com`, sem usuário, senha nem porta, e só os dois caminhos
 * de assinatura que a Clicksign usa. O formato real (fixture `clicksign-sign-com-bounce.json`) é
 * `/notarial/widget/signatures/<id>/redirect`.
 */
export function linkDeAssinaturaValido(bruto: unknown): null | string {
  const valor = texto(bruto);
  if (!valor || valor.length > TETO_DO_LINK) return null;
  let url: URL;
  try {
    url = new URL(valor);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.hostname !== "app.clicksign.com") return null;
  if (url.username || url.password || url.port || url.search || url.hash) return null;
  const caminho = /^\/(?:notarial\/widget\/signatures\/[A-Za-z0-9-]+\/redirect|sign\/[A-Za-z0-9-]+)\/?$/;
  return caminho.test(url.pathname) ? url.toString() : null;
}

/**
 * O LINK DE ASSINATURA DESTA PESSOA, lido no payload do webhook.
 *
 * ⚠️ O HISTÓRICO INTEIRO VEM EM TODO PAYLOAD, E É ISSO QUE FAZ O LINK EXISTIR PARA TODO MUNDO. O
 * `add_signer` de cada pessoa (com `data.signers[].url`) fica em `document.events[]`, então qualquer
 * aviso novo do envelope (alguém abriu, alguém assinou) traz o link de todos. Quem foi recadastrado
 * por uma troca de e-mail tem link NOVO, e o `add_signer` dele vem depois: vale o mais recente.
 *
 * ⚠️ SÓ A `key` CASA, NUNCA O E-MAIL. A `signer.key` do webhook é o id REST (58 de 58 iguais ao
 * quadro, medido em 02/10/2026), e um e-mail repetido levaria o link de uma pessoa para outra.
 */
export function linkDeAssinaturaNoPayload(payload: unknown, chave: string): null | string {
  const procurada = chave.trim();
  if (!procurada) return null;
  let achado: { link: string; quando: string } | null = null;
  let saiuEm: null | string = null;
  for (const evento of eventosComARaiz(payload)) {
    for (const bruto of pessoasDoEvento(evento.dados)) {
      const pessoa = objeto(bruto);
      if (texto(pessoa.key) !== procurada) continue;
      // ⚠️ QUEM SAIU DO ENVELOPE NÃO TEM LINK QUE SIRVA. O `add_signer` antigo continua no histórico
      // com o link, mas depois do `remove_signer` ele abre um convite morto.
      if (evento.nome === "remove_signer") {
        if (saiuEm === null || evento.quando > saiuEm) saiuEm = evento.quando;
        continue;
      }
      const link = linkDeAssinaturaValido(pessoa.url);
      if (!link) continue;
      if (achado === null || evento.quando > achado.quando) achado = { link, quando: evento.quando };
    }
  }
  if (achado === null) return null;
  return saiuEm !== null && saiuEm >= achado.quando ? null : achado.link;
}

/**
 * As marcas que o histórico INTEIRO afirma: `sign`, `refusal` e as notícias do convite.
 *
 * ⚠️ O HISTÓRICO INTEIRO VEM EM TODO PAYLOAD (`document.events[]`), e por isso um `add_signer` que
 * chega depois de um `sign` carrega o `sign` junto. O webhook antigo só olhava o evento que
 * disparou, e o `signature_started` atrasado regredia o envelope (13 vezes em 5 documentos).
 *
 * ⚠️ `sign` SEM `occurred_at` NÃO VIRA MARCA. Uma assinatura sem data não diz quando começa o prazo
 * de 7 dias, e "agora" seria inventar a data de um contrato.
 */
export function marcasDoPayloadDaClicksign(payload: unknown): MarcaDeAssinatura[] {
  const saida: MarcaDeAssinatura[] = [];
  const vistas = new Set<string>();

  for (const evento of eventosComARaiz(payload)) {
    const pessoa = objeto(evento.dados.signer);
    const chave = texto(pessoa.key) || null;
    const email = texto(pessoa.email).toLowerCase() || null;
    if (!chave && !email) continue;

    const quando = emBrasilia(evento.quando);
    if (!quando) continue;

    let marca: MarcaDeAssinatura | null = null;
    if (evento.nome === "sign") {
      marca = { assinadoEm: quando, chave, email, recusadoEm: null };
    } else if (evento.nome === "refusal") {
      marca = { assinadoEm: null, chave, email, recusadoEm: quando };
    } else {
      const convite = situacaoDoConvite(evento.nome, evento.dados);
      if (convite === "nao_entregue") {
        marca = { assinadoEm: null, chave, conviteFalhouEm: quando, email, recusadoEm: null };
      } else if (convite === "entregue") {
        marca = { assinadoEm: null, chave, conviteEntregueEm: quando, email, recusadoEm: null };
      }
    }
    if (!marca) continue;

    const identidade = JSON.stringify(marca);
    if (vistas.has(identidade)) continue;
    vistas.add(identidade);
    saida.push(marca);
  }

  return saida;
}

// ── O FECHAMENTO ────────────────────────────────────────────────────────────

type LeituraDoFechamento = {
  /** O documento diz `closed`. */
  fechado: boolean;
  /** Há `document.signers[]` no payload (o `upload` chega com a lista VAZIA). */
  temLista: boolean;
  /** Todo mundo da lista oficial tem um `sign` no histórico. */
  todos: boolean;
};

function lerFechamento(payload: unknown): LeituraDoFechamento {
  const documento = documentoDoPayload(payload);
  const signatarios = lista(documento.signers).map((bruto) => {
    const pessoa = objeto(bruto);
    return { chave: texto(pessoa.key), email: texto(pessoa.email).toLowerCase() };
  }).filter((p) => p.chave || p.email);

  const chavesQueAssinaram = new Set<string>();
  const emailsQueAssinaram = new Set<string>();
  for (const evento of eventosComARaiz(payload)) {
    if (evento.nome !== "sign") continue;
    const pessoa = objeto(evento.dados.signer);
    if (texto(pessoa.key)) chavesQueAssinaram.add(texto(pessoa.key));
    if (texto(pessoa.email)) emailsQueAssinaram.add(texto(pessoa.email).toLowerCase());
  }

  // ⚠️ A CHAVE PRIMEIRO, O E-MAIL SÓ QUANDO A PESSOA DA LISTA NÃO TEM CHAVE. O e-mail pode ter sido
  // trocado entre o convite que quicou e o que chegou; a `key` é a identidade na Clicksign.
  const todos =
    signatarios.length > 0 &&
    signatarios.every((p) =>
      p.chave ? chavesQueAssinaram.has(p.chave) : emailsQueAssinaram.has(p.email),
    );

  return {
    fechado: texto(documento.status).toLowerCase() === "closed",
    temLista: signatarios.length > 0,
    todos,
  };
}

/**
 * O documento fechou com TODO MUNDO assinado?
 *
 * `document.status` `closed` E todo `document.signers[]` com `sign` no histórico. `null` = payload
 * sem lista de signatários, e ignorância não vira acusação (nem certeza).
 */
export function fechouComTodosNoPayload(payload: unknown): boolean | null {
  const leitura = lerFechamento(payload);
  if (!leitura.temLista) return null;
  return leitura.fechado && leitura.todos;
}

/**
 * O estado que o evento PODE propor — quem decide se vale é a função da 0195 (só para a frente).
 *
 * ⚠️ O FECHAMENTO VEM ANTES DO NOME DO EVENTO (bug 8.7 do plano). `close`/`auto_close` viravam
 * `assinado` direto, embora `closed` sem todos seja `expirado` (a armadilha do
 * `deadline_partial_signature_action`, em `traduzir.ts`). E o `sign` da ÚLTIMA pessoa chega com o
 * documento já `closed`: pela regra do nome ele seria `parcial` e o contrato nunca fecharia se o
 * `auto_close` não viesse (nenhum fechamento chegou até 28/09).
 *
 * ⚠️ FECHAMENTO SEM A LISTA NÃO PROPÕE TERMINAL. `null` aqui é "não sei": a rede da Clicksign do
 * cron confere depois. Terminal errado não se desfaz (a função SQL não deixa sair de terminal).
 */
export function estadoPropostoPeloEvento(evento: string, payload: unknown): EstadoDaAssinatura | null {
  const nome = texto(evento).toLowerCase();
  const leitura = lerFechamento(payload);

  if (leitura.temLista && leitura.fechado && leitura.todos) return "assinado";

  if (EVENTOS_DE_FECHAMENTO.has(nome)) {
    if (!leitura.temLista) return null;
    return leitura.todos ? "assinado" : "expirado";
  }

  return ESTADO_POR_EVENTO_DA_CLICKSIGN[nome] ?? null;
}

/**
 * A data REAL em que o provedor encerrou o documento, em -03:00, ou `null`.
 *
 * ⚠️ NUNCA "AGORA" (ATENCAO 5 da 0195). `document.finished_at` primeiro; senão o `occurred_at` do
 * último evento que encerra (fechamento, cancelamento, prazo, recusa). Sem nenhum dos dois, a
 * função SQL deixa `fechado_em` nulo e recalcula na próxima chamada.
 */
export function fechadoEmDoPayload(payload: unknown): null | string {
  const documento = documentoDoPayload(payload);
  const doDocumento = emBrasilia(texto(documento.finished_at));
  if (doDocumento) return doDocumento;

  let ultimo: null | string = null;
  for (const evento of eventosComARaiz(payload)) {
    if (!EVENTOS_QUE_ENCERRAM.has(evento.nome) || !evento.quando) continue;
    if (ultimo === null || Date.parse(evento.quando) > Date.parse(ultimo)) ultimo = evento.quando;
  }
  return ultimo === null ? null : emBrasilia(ultimo);
}

// ── O QUE SE GUARDA DO CORPO ────────────────────────────────────────────────

/**
 * As chaves que carregam ESTRUTURA: o redutor desce por elas.
 *
 * ⚠️ SÃO TODOS OS CAMINHOS QUE OS LEITORES DA CASA PERCORREM (`lerEventoDoWebhook`, o diário, o
 * contador do card em `trabalhos-db.ts` e as marcas acima). Tirar uma daqui faz um leitor ler zero
 * do payload guardado, sem erro nenhum.
 */
const CHAVES_DE_ESTRUTURA = new Set([
  "attributes",
  "data",
  "document",
  "envelope",
  "event",
  "events",
  "notification",
  "signer",
  "signers",
  "user",
]);

/**
 * As chaves de VALOR que se guardam: nomes, datas, chaves, e-mails e status.
 *
 * ⚠️ É UMA ALLOWLIST, E NÃO UMA LISTA DO QUE TIRAR (bug 8.8 do plano). O corpo da Clicksign trazia
 * CPF (`documentation`) em 201 de 226 eventos, nascimento (`birthday`) em 201 e geolocalização em
 * 39, além do IP (`address`), telefone e o link assinado do PDF. Uma lista do que tirar deixaria
 * passar o próximo campo que a Clicksign criar; esta só deixa passar o que a casa lê.
 */
const CHAVES_DE_VALOR = new Set([
  "auto_close",
  "created_at",
  "deadline_at",
  "details",
  "document_id",
  "email",
  "envelope_id",
  "filename",
  "finished_at",
  "id",
  "key",
  "kind",
  "last_bounce_type",
  "last_status",
  "name",
  "occurred_at",
  "provider",
  "sign_as",
  "signer_email",
  "status",
  "type",
  "updated_at",
  "uploaded_at",
]);

/** Teto de itens por lista e de caracteres por texto: o payload guardado não cresce sem limite. */
const TETO_DE_ITENS = 300;
const TETO_DE_TEXTO = 2_000;

function valorSimples(valor: unknown): unknown {
  if (typeof valor === "string") return valor.slice(0, TETO_DE_TEXTO);
  if (typeof valor === "number" || typeof valor === "boolean" || valor === null) return valor;
  return undefined;
}

/** O `metadata` é NOSSO (o Panteon o gravou no envio): fica, mas só os valores simples. */
function metadataReduzido(bruto: unknown): Record<string, unknown> {
  const saida: Record<string, unknown> = {};
  for (const [chave, valor] of Object.entries(objeto(bruto))) {
    const simples = valorSimples(valor);
    if (simples !== undefined) saida[chave] = simples;
  }
  return saida;
}

/** As estruturas em que `url` é o LINK DE ASSINATURA de uma pessoa (e não a raiz do site deles). */
const ESTRUTURAS_DO_SIGNATARIO = new Set(["signer", "signers"]);

function reduzir(bruto: unknown, profundidade: number, pai = ""): unknown {
  if (profundidade > 8) return undefined;
  if (Array.isArray(bruto)) {
    return bruto
      .slice(0, TETO_DE_ITENS)
      .map((item) => reduzir(item, profundidade + 1, pai))
      .filter((item) => item !== undefined);
  }
  if (!bruto || typeof bruto !== "object") return valorSimples(bruto);

  const saida: Record<string, unknown> = {};
  for (const [chave, valor] of Object.entries(bruto as Record<string, unknown>)) {
    if (chave === "metadata") {
      saida.metadata = metadataReduzido(valor);
    } else if (CHAVES_DE_ESTRUTURA.has(chave)) {
      // ⚠️ `event` PODE SER TEXTO (o nome do evento, em formatos mais enxutos): aí é valor.
      const reduzido =
        valor && typeof valor === "object" ? reduzir(valor, profundidade + 1, chave) : valorSimples(valor);
      if (reduzido !== undefined) saida[chave] = reduzido;
    } else if (chave === "url" && ESTRUTURAS_DO_SIGNATARIO.has(pai)) {
      // ⚠️ O LINK DE ASSINATURA ENTRA, E SÓ ELE (02/10/2026). Até aqui `url` ficava fora da allowlist
      // inteira, e nenhum dos 2.331 signatários guardados tinha link. Ele entra só dentro de
      // `signer`/`signers` e só se for da Clicksign (`linkDeAssinaturaValido`): o `data.url` da raiz
      // (o endereço do site deles) e o link assinado do PDF continuam de fora. E este redutor só
      // roda no evento com HMAC conferido: o não conferido guarda o esqueleto.
      const link = linkDeAssinaturaValido(valor);
      if (link) saida.url = link;
    } else if (CHAVES_DE_VALOR.has(chave)) {
      const simples = valorSimples(valor);
      if (simples !== undefined) saida[chave] = simples;
    }
  }
  return saida;
}

/**
 * O corpo do webhook no recorte que a casa lê: nomes, datas, chaves, e-mails, status e o nosso
 * `metadata`. Nunca `documentation`, `birthday`, geolocalização, IP (`address`), `user_agent`,
 * telefone nem o link assinado do PDF.
 *
 * ⚠️ O E-MAIL FICA, E É DADO INTERNO. É por ele que o diário casa a pessoa com o quadro congelado
 * quando a chave não bate; ele não atravessa para navegador de fora (plano, seção 5).
 */
export function payloadReduzidoDaClicksign(payload: unknown): unknown {
  if (!payload || typeof payload !== "object") return null;
  return reduzir(payload, 0);
}

/** Quantas chaves de primeiro nível o esqueleto guarda, e com quantos caracteres cada uma. */
const TETO_DE_CHAVES_DO_ESQUELETO = 40;
const TETO_DO_NOME_DE_CHAVE = 40;
/** O nome do evento, cortado: no esqueleto e na coluna `evento` do não conferido. */
export const TETO_DO_NOME_DO_EVENTO = 80;

/**
 * O esqueleto do evento que NÃO passou no HMAC: o nome, as chaves de primeiro nível e o tamanho.
 *
 * ⚠️ O NÃO CONFERIDO GUARDA SÓ A FORMA, E COM TETO. Antes ele gravava o corpo inteiro (`route.ts`),
 * e qualquer um que soubesse a URL escrevia o que quisesse na nossa tabela. O esqueleto guarda o que
 * serve para descobrir um forjado (ou um cabeçalho de HMAC trocado) sem guardar o que ele mandou.
 *
 * ⚠️ O NOME DE CADA CHAVE TAMBÉM É CORTADO (revisão da F1). Limitar só a QUANTIDADE deixava 40
 * chaves de ~3 KB cada: o nome da chave virava o lugar de escrever texto arbitrário, até ~128 KB
 * por POST. Com 40 × 40 caracteres o esqueleto não passa de ~2 KB.
 */
export function esqueletoDoPayload(payload: unknown, tamanho: number): unknown {
  const raiz = objeto(payload);
  const evento = objeto(raiz.event);
  const nome = texto(evento.name) || texto(evento.type) || texto(raiz.event) || texto(raiz.type);
  return {
    __esqueleto: true,
    chaves: Array.isArray(payload)
      ? ["(array)"]
      : payload && typeof payload === "object"
        ? Object.keys(raiz)
            .slice(0, TETO_DE_CHAVES_DO_ESQUELETO)
            .map((chave) => chave.slice(0, TETO_DO_NOME_DE_CHAVE))
        : [`(${typeof payload})`],
    evento: nome.slice(0, TETO_DO_NOME_DO_EVENTO) || null,
    tamanho,
  };
}

/** O formato dos ids da Clicksign (documento, envelope, signatário): UUID. */
const FORMA_DE_ID_DA_CLICKSIGN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * O id como veio, SE tiver forma de id da Clicksign; senão `null`.
 *
 * ⚠️ SÓ PARA O NÃO CONFERIDO. As colunas `envelope_id` e `provedor_documento_id` do evento que não
 * passou no HMAC são texto livre vindo de um corpo que qualquer um escreve: sem esta régua, o
 * forjado gravava ali o que quisesse. Um id de verdade continua servindo de pista.
 */
export function idComFormaDaClicksign(bruto: null | string | undefined): null | string {
  const valor = typeof bruto === "string" ? bruto.trim() : "";
  return FORMA_DE_ID_DA_CLICKSIGN.test(valor) ? valor : null;
}

/**
 * Os cabeçalhos que se guardam do webhook. Tudo o que não está aqui NÃO é gravado.
 *
 * ⚠️ LISTA DO QUE GUARDAR, E NÃO DO QUE OMITIR (revisão da F1, medido em 28/09/2026). A lista de
 * omissão de antes deixava passar o que a Vercel injeta na chamada: `x-vercel-oidc-token` (um JWT),
 * `x-vercel-sc-headers` (com `Authorization: Bearer`) e `x-vercel-proxy-signature` estavam nas 230
 * linhas guardadas, mais IP e geolocalização de quem chamou. O motivo de guardar cabeçalho é saber EM
 * QUAL deles a Clicksign manda o HMAC (os candidatos de `clicksign/webhook.ts`), e o resto que ajuda
 * a ler um evento: tipo, tamanho, nome do evento, agente, data e o id da requisição na Vercel.
 */
const CABECALHOS_GUARDADOS = new Set([
  "clicksign-signature",
  "content-hmac",
  "content-length",
  "content-type",
  "date",
  "event",
  "user-agent",
  "x-clicksign-signature",
  "x-signature",
  "x-vercel-id",
]);

/** O teto de cada valor guardado: nenhum cabeçalho legítimo da lista passa disso. */
const TETO_DO_VALOR_DE_CABECALHO = 512;

/**
 * O recorte dos cabeçalhos para `temis_assinatura_eventos.headers`.
 *
 * ⚠️ NO NÃO CONFERIDO FICA TAMBÉM O `x-real-ip`: é a pista forense de quem forjou (o IP que a Vercel
 * viu, não um que o corpo diz). No conferido ele não serve para nada e não é guardado.
 */
export function cabecalhosParaGuardar(
  cabecalhos: Iterable<[string, string]> | Record<string, unknown>,
  conferido: boolean,
): Record<string, string> {
  const pares: Array<[string, unknown]> =
    Symbol.iterator in Object(cabecalhos)
      ? [...(cabecalhos as Iterable<[string, string]>)]
      : Object.entries(cabecalhos as Record<string, unknown>);
  const saida: Record<string, string> = {};
  for (const [chave, valor] of pares) {
    const nome = String(chave).toLowerCase();
    const guarda = CABECALHOS_GUARDADOS.has(nome) || (!conferido && nome === "x-real-ip");
    if (!guarda || typeof valor !== "string") continue;
    saida[nome] = valor.slice(0, TETO_DO_VALOR_DE_CABECALHO);
  }
  return saida;
}
