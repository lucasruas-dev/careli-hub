import { createHmac, timingSafeEqual } from "node:crypto";

// O WEBHOOK DA CLICKSIGN — conferir quem está falando, e entender o que ele disse.
//
// ⚠️ UM ENDPOINT PÚBLICO SEM CONFERÊNCIA ACEITA QUALQUER UM DIZENDO QUE O CONTRATO FOI ASSINADO. A
// URL do webhook está cadastrada no painel da Clicksign, mas ela é uma rota HTTP como outra
// qualquer: sem conferir a assinatura, um POST de fora move o card da Têmis para "assinado" e o
// contrato segue para o cartório sem ninguém ter assinado nada. Não é hipótese remota — a URL
// aparece em log de proxy, em print de tela e no próprio painel do provedor.
//
// ⚠️ E O QUE NÃO CONFERE NÃO MOVE NADA. A regra deste arquivo é uma só: se o HMAC não bate, o evento
// não vira estado. Ele pode ser registrado (para se descobrir de onde veio), nunca aplicado.
//
// ── O QUE NÃO SABEMOS, E POR QUE ISSO ESTÁ ESCRITO ──────────────────────────
//
// ⚠️ O NOME DO CABEÇALHO NÃO FOI MEDIDO. A doc da v3 documenta os 30 eventos e o `secret` que a
// criação do webhook devolve, e NÃO documenta como o callback é assinado — nem o cabeçalho, nem
// sobre o que o HMAC é calculado. Nenhum evento real chegou ainda (a rota está em modo descoberta
// desde 07/09/2026). Então, em vez de fixar um palpite:
//
//   • aceitamos o HMAC em QUALQUER um dos cabeçalhos candidatos (`CABECALHOS`), e dizemos qual
//     chegou — é assim que o nome verdadeiro se descobre, no primeiro evento;
//   • calculamos sobre o CORPO CRU, que é o que a esmagadora maioria dos provedores faz;
//   • aceitamos o valor com e sem o prefixo `sha256=`.
//
// ⚠️ ATENÇÃO PARA QUEM VIER DEPOIS: se o D4Sign servir de guia, o HMAC dele é sobre o UUID DO
// DOCUMENTO e não sobre o corpo — o que autentica a origem e NÃO protege contra repetição. Se o
// primeiro evento real da Clicksign não bater por nada aqui, é essa a segunda hipótese a testar,
// com o payload que o log de descoberta registrar.

/** Onde o HMAC pode estar. O primeiro que existir é o conferido; o resultado diz qual foi. */
const CABECALHOS = [
  "content-hmac",
  "x-clicksign-signature",
  "clicksign-signature",
  "x-signature",
] as const;

export type VerificacaoDoWebhook =
  | { cabecalho: string; ok: true }
  | {
      motivo: string;
      ok: false;
      /**
       * ⚠️ O MOTIVO É SEPARADO DA MENSAGEM porque a rota responde diferente para cada um.
       * `sem-segredo` é problema NOSSO de configuração (a chave não chegou, ou chegou vazia por
       * estar marcada "Sensitive" na Vercel): responder 401 faria a Clicksign reenviar por horas um
       * evento que nunca vai passar. `nao-bate` é alguém batendo na porta.
       */
      porQue: "corpo-vazio" | "nao-bate" | "sem-assinatura" | "sem-segredo";
    };

/**
 * Este POST veio mesmo da Clicksign?
 *
 * ⚠️ A COMPARAÇÃO É EM TEMPO CONSTANTE (`timingSafeEqual`). Comparar com `===` vaza, pelo tempo de
 * resposta, quantos caracteres do HMAC o atacante acertou — e um HMAC descoberto byte a byte é um
 * webhook que move contrato.
 */
export function conferirAssinaturaDoWebhook(entrada: {
  corpoCru: string;
  headers: Headers;
  segredo: null | string;
}): VerificacaoDoWebhook {
  const segredo = (entrada.segredo ?? "").trim();
  if (!segredo) {
    return {
      motivo:
        "CLICKSIGN_WEBHOOK_SECRET não está configurada (ou chegou vazia). Sem ela não há como provar " +
        "que o evento veio da Clicksign, e nenhum evento move o contrato.",
      ok: false,
      porQue: "sem-segredo",
    };
  }

  if (!entrada.corpoCru) {
    return { motivo: "O corpo do evento chegou vazio.", ok: false, porQue: "corpo-vazio" };
  }

  let cabecalho = "";
  let recebido = "";
  for (const nome of CABECALHOS) {
    const valor = entrada.headers.get(nome);
    if (valor?.trim()) {
      cabecalho = nome;
      recebido = valor.trim();
      break;
    }
  }

  if (!recebido) {
    return {
      motivo: `O evento chegou sem assinatura: nenhum dos cabeçalhos ${CABECALHOS.join(", ")} veio preenchido.`,
      ok: false,
      porQue: "sem-assinatura",
    };
  }

  // `sha256=abc...` e `abc...` são a mesma coisa; provedores variam.
  const limpo = recebido.replace(/^sha-?256=/i, "").trim().toLowerCase();
  const esperado = createHmac("sha256", segredo).update(entrada.corpoCru, "utf8").digest("hex");

  if (!iguais(limpo, esperado)) {
    return {
      motivo: `A assinatura do evento (${cabecalho}) não confere com CLICKSIGN_WEBHOOK_SECRET.`,
      ok: false,
      porQue: "nao-bate",
    };
  }

  return { cabecalho, ok: true };
}

/**
 * Comparação em tempo constante, tolerante a tamanhos diferentes.
 *
 * ⚠️ `timingSafeEqual` LANÇA quando os buffers têm tamanhos diferentes — e é justamente o caso de um
 * atacante mandando lixo. Sem a checagem de tamanho antes, a rota devolveria 500 em vez de 401, o
 * que é um canal lateral por si só (diz que o formato estava errado, não o valor).
 */
function iguais(a: string, b: string): boolean {
  const x = Buffer.from(a, "utf8");
  const y = Buffer.from(b, "utf8");
  if (x.length !== y.length) return false;
  return timingSafeEqual(x, y);
}

// ── O QUE O EVENTO DIZ ──────────────────────────────────────────────────────

export type EventoDaClicksign = {
  /** O nome cru: `sign`, `auto_close`, `refusal`… Vazio quando não deu para achar. */
  evento: string;
  /** O id do documento na Clicksign, quando vier. */
  documentoId: null | string;
  /** O id do envelope na Clicksign, quando vier. */
  envelopeId: null | string;
  /** O `metadata` que NÓS pusemos no documento no envio — é o elo com a proposta. */
  metadados: Record<string, string>;
  /** O e-mail de quem assinou/recusou, quando o evento é de uma pessoa. */
  signatarioEmail: null | string;
};

/**
 * Lê o evento, sem exigir um formato.
 *
 * ⚠️ TOLERANTE DE PROPÓSITO, E A RAZÃO É MEDIDA: a doc da v3 lista os 30 eventos e NÃO mostra um
 * único exemplo do corpo entregue ao endpoint. Escrever o leitor a partir do que a doc "deve"
 * mandar é exatamente o erro do D4Sign, onde a doc mostra JSON e o webhook chega em form-data — um
 * `request.json()` recebe vazio e não falha de forma óbvia.
 *
 * Então procuramos o nome do evento nos cinco lugares plausíveis e os ids nos três, e o que não for
 * achado volta nulo. Quem chama decide o que fazer com a ignorância; o que NÃO se faz é adivinhar.
 */
export function lerEventoDoWebhook(corpoCru: string): EventoDaClicksign {
  const vazio: EventoDaClicksign = {
    documentoId: null,
    envelopeId: null,
    evento: "",
    metadados: {},
    signatarioEmail: null,
  };
  if (!corpoCru) return vazio;

  let corpo: unknown;
  try {
    corpo = JSON.parse(corpoCru);
  } catch {
    // Não é JSON: pode ser form-data (o formato do D4Sign, apesar da doc dele dizer JSON).
    try {
      const campos = new URLSearchParams(corpoCru);
      return {
        ...vazio,
        documentoId: campos.get("document_id") ?? campos.get("document") ?? null,
        envelopeId: campos.get("envelope_id") ?? campos.get("envelope") ?? null,
        evento: (campos.get("event") ?? campos.get("type") ?? "").trim(),
      };
    } catch {
      return vazio;
    }
  }

  if (!corpo || typeof corpo !== "object") return vazio;
  const raiz = corpo as Record<string, unknown>;
  const evento = objeto(raiz.event);
  const dados = objeto(raiz.data);
  const atributos = objeto(dados.attributes);
  const documento = objeto(raiz.document) ?? objeto(evento.document) ?? objeto(dados.document);
  const envelope = objeto(raiz.envelope) ?? objeto(evento.envelope) ?? objeto(dados.envelope);
  const signatario = objeto(raiz.signer) ?? objeto(evento.signer) ?? objeto(dados.signer);

  return {
    documentoId:
      texto(documento.id) || texto(evento.document_id) || texto(raiz.document_id) || null,
    envelopeId: texto(envelope.id) || texto(evento.envelope_id) || texto(raiz.envelope_id) || null,
    // ⚠️ `event.name` VEM PRIMEIRO, e a ordem importa: no formato do envelope da v3 a raiz também
    // tem um `type` (o tipo do RECURSO em JSON:API, tipicamente "envelopes"), que não é o nome do
    // evento. Ler `type` antes faria todo evento ser traduzido como desconhecido.
    evento: (
      texto(evento.name) ||
      texto(evento.type) ||
      texto(raiz.event) ||
      texto(atributos.event) ||
      texto(raiz.type)
    ).trim(),
    metadados: mapaDeTexto(documento.metadata ?? atributos.metadata ?? raiz.metadata),
    signatarioEmail: texto(signatario.email) || texto(evento.signer_email) || null,
  };
}

function objeto(bruto: unknown): Record<string, unknown> {
  return bruto && typeof bruto === "object" && !Array.isArray(bruto)
    ? (bruto as Record<string, unknown>)
    : {};
}

function texto(bruto: unknown): string {
  return typeof bruto === "string" ? bruto.trim() : "";
}

/** O `metadata` só interessa como texto: é o que nós mesmos gravamos lá no envio. */
function mapaDeTexto(bruto: unknown): Record<string, string> {
  const fonte = objeto(bruto);
  const saida: Record<string, string> = {};
  for (const [chave, valor] of Object.entries(fonte)) {
    if (typeof valor === "string" || typeof valor === "number" || typeof valor === "boolean") {
      saida[chave] = String(valor);
    }
  }
  return saida;
}
