// CONSULTA D4SIGN — o STATUS de um documento e a lista de assinantes dele, direto na fonte.
//
// Por que existe: o C2X guarda o status em `contract_signatures` e ele é FURADO. Medido em
// 18/08/2026 nas 3.675 linhas: `statusId` é NULO em 100% delas, e o `contract_signature_status_id`
// tem 1.470 "Em aberto" (7) — documentos que a D4Sign já finalizou e o C2X nunca soube, porque o
// webhook nunca foi ligado (`create_webhook = 0` em 100% das linhas). O dono pediu (18/08/2026):
// *"queria usar somente o D4Sign, o C2X tem muito gap ainda"*. Este arquivo é esse "somente".
//
// ⚠️ UMA CHAMADA, NÃO DUAS. `GET /documents/{uuid}/list` devolve os MESMOS 11 campos do
// `GET /documents/{uuid}` MAIS a lista de assinantes (sondado com documento real do Vista Alegre).
// Quem quiser status + assinantes não deve chamar os dois: é o dobro do custo pelo mesmo dado.
//
// ⚠️ O QUE SAI DAQUI PARA A TELA. A resposta do `/list` traz CPF (`user_document`), e-mail, IP,
// geolocalização e user-agent de quem assinou (`sign_info`). Nada disso pode atravessar para o
// navegador. O tipo interno (`SignatarioD4Sign`) guarda e-mail e CPF porque são o que casa o
// assinante com a linha do C2X; `signatarioParaTela` é a ÚNICA porta de saída, e ela deixa passar
// nome, papel, assinou e quando. Mesma regra para o documento: `whoCanceled` é o e-mail do
// operador da Careli que cancelou — dado interno, não vai para o cliente.
//
// ⚠️ CREDENCIAL: `D4SIGN_TOKEN_API` e `D4SIGN_CRYPT_KEY` vêm de `process.env`, viajam na QUERY
// STRING (é como a API autentica) e NUNCA podem entrar em log, em erro ou em payload. Por isso
// nenhuma função daqui devolve a URL montada, e o `catch` não repassa a mensagem do fetch.
const D4SIGN_API_BASE_URL = "https://secure.d4sign.com.br/api/v1";

/**
 * TTL do documento que ainda pode mudar (aguardando assinaturas/signatários): 5 minutos, o mesmo
 * do painel interno (`lib/apolo/painel-assinatura.ts`) e da tela Contratos. A régua é a de lá:
 * chegam ~7 assinaturas por hora nas horas úteis, então cada ciclo de 5 min traz meia assinatura
 * nova — atualizar mais rápido só gasta.
 */
const TTL_MS = 5 * 60 * 1000;

/**
 * TTL do documento TERMINAL (Finalizado ou Cancelado): 12 horas.
 *
 * Isto é o que faz a conta fechar. Finalizado e Cancelado não voltam atrás — no catálogo inteiro
 * (3.923 documentos) são 2.489 + 1.161 = 3.650 dos 3.923, ou seja 93% do acervo. Guardar os
 * terminais por 5 minutos seria pagar 1,4 s por documento a cada 5 minutos para reler um dado que
 * é imutável por definição. Com esta faixa, o custo recorrente da tela é só o dos documentos EM
 * MOVIMENTO (269 aguardando assinaturas + 4 aguardando signatários no acervo todo).
 */
const TTL_TERMINAL_MS = 12 * 60 * 60 * 1000;

/**
 * Teto de documentos residentes no cache. O acervo inteiro tem ~3.900; o escopo do portal, 467.
 * O teto existe para o processo não crescer sem limite, e a poda tira o mais velho.
 */
const MAX_DOCUMENTOS = 2000;

/** Tempo máximo de UMA chamada. Medido: mediana 1,4 s, pior caso 2,7 s. 6 s é folga larga. */
const TIMEOUT_MS = 6000;

/**
 * Chamadas simultâneas ao D4Sign. Medido: 5 em paralelo custaram 1.402 ms no TOTAL — o gargalo é
 * latência fixa, não vazão, então paralelismo funciona. Ficamos em 6 porque a API não devolve
 * NENHUM cabeçalho de rate limit (procurei por `rate|limit|retry|remaining|quota`: veio vazio):
 * sem teto publicado, o teto que a gente respeita é o que a gente mesmo se impõe.
 */
const CONCORRENCIA_PADRAO = 6;

/**
 * Orçamento de tempo de uma carga da tela. Estourou, o resto vira "indisponível" e a tela cai no
 * fallback honesto em vez de deixar o usuário olhando um spinner de meio minuto.
 */
const ORCAMENTO_PADRAO_MS = 8000;

/** Falhas seguidas que abrem o disjuntor. */
const FALHAS_PARA_ABRIR = 3;

/** Quanto tempo o disjuntor fica aberto. Com ele aberto, ninguém chama o D4Sign: devolve na hora. */
const DISJUNTOR_MS = 60 * 1000;

/** As situações do documento na D4Sign, já traduzidas do `statusId` numérico. */
export type SituacaoD4Sign =
  | "aguardando-assinaturas"
  | "aguardando-signatarios"
  | "cancelado"
  | "desconhecida"
  | "finalizado";

/**
 * O de-para do `statusId` da D4Sign. Os quatro observados no catálogo inteiro em 18/08/2026:
 * 4 Finalizado (2.489), 6 Cancelado (1.161), 3 Aguardando Assinaturas (269), 2 Aguardando
 * Signatários (4). Qualquer outro cai em "desconhecida" — de propósito: inventar significado para
 * um código que a gente nunca viu é como o C2X errou.
 */
const SITUACAO_POR_STATUS_ID: Record<number, SituacaoD4Sign> = {
  2: "aguardando-signatarios",
  3: "aguardando-assinaturas",
  4: "finalizado",
  6: "cancelado",
};

/** O rótulo que a tela mostra para cada situação. Fonte única do texto. */
export const SITUACAO_D4SIGN_LABELS: Record<SituacaoD4Sign, string> = {
  "aguardando-assinaturas": "Aguardando assinaturas",
  "aguardando-signatarios": "Aguardando signatários",
  cancelado: "Cancelado",
  desconhecida: "Situação desconhecida",
  finalizado: "Finalizado",
};

/** Situação que não muda mais: pode ficar no cache pelo TTL longo. */
export function situacaoEhTerminal(situacao: SituacaoD4Sign): boolean {
  return situacao === "finalizado" || situacao === "cancelado";
}

/**
 * Traduz o `statusId` da D4Sign (que vem como STRING no JSON: `"4"`, não `4`).
 *
 * ⚠️ Aceita `unknown` porque a resposta é JSON sem contrato: número, string ou ausente. String
 * vazia, nulo e código fora da tabela viram "desconhecida", nunca um chute.
 */
export function interpretarStatusD4Sign(statusId: unknown): SituacaoD4Sign {
  if (statusId === null || statusId === undefined || statusId === "") return "desconhecida";
  const numero = Number(statusId);
  if (!Number.isFinite(numero)) return "desconhecida";
  return SITUACAO_POR_STATUS_ID[numero] ?? "desconhecida";
}

/**
 * O documento como o servidor o enxerga.
 *
 * ⚠️ `canceladoPor` e `nome` são INTERNOS. O primeiro é o e-mail do operador da Careli que
 * cancelou (peguei um caso real na sondagem); o segundo é o nome do arquivo, que carrega
 * empreendimento e unidade. Nenhum dos dois atravessa `documentoParaTela`.
 */
export type DocumentoD4Sign = {
  /** INTERNO — e-mail do operador que cancelou. Nunca sai, nem em log. */
  canceladoPor: null | string;
  cofre: null | string;
  /** INTERNO — nome do arquivo na D4Sign. */
  nome: string;
  paginas: null | number;
  situacao: SituacaoD4Sign;
  /** O código cru, guardado para a divergência conseguir dizer "D4Sign 4 × C2X 7". */
  statusId: null | number;
  /** O rótulo que a própria D4Sign devolve. Guardado para conferência, não para a tela. */
  statusName: string;
  uuidDoc: string;
};

/**
 * Um assinante do documento, como o servidor o enxerga.
 *
 * ⚠️ `documento` (CPF) e `email` NÃO SAEM DAQUI. Estão no tipo porque são o que casa este
 * assinante com a linha do C2X (o e-mail casa; o CPF é a rede de segurança para homônimo), e
 * porque `perfilDeTela` precisa do e-mail para saber quem é Backoffice. A saída é
 * `signatarioParaTela`.
 *
 * ⚠️ IP, geolocalização e user-agent (`sign_info`) NEM ENTRAM no tipo. A única coisa que este
 * módulo extrai de `sign_info` é a DATA — o resto é rastro pessoal de quem assinou e não tem uso
 * nenhum na tela.
 */
export type SignatarioD4Sign = {
  /** ISO COM FUSO (`sign_info.date_signed_atom`). Nulo enquanto não assinou. */
  assinadoEm: null | string;
  assinou: boolean;
  /** Quando o convite foi criado (`date`). NÃO é a data da assinatura. */
  convidadoEm: null | string;
  /** Entrega do e-mail de convite (`email_sent_status`, ex.: "Delivery"). Diagnóstico de "não recebeu". */
  entregaDoEmail: null | string;
  /** INTERNO — CPF (`user_document`). Nunca sai do servidor, nunca vai para log. */
  documento: string;
  /** INTERNO — e-mail. Casa o assinante com a linha do C2X. Nunca sai para a tela. */
  email: string;
  /** `key_signer` — id opaco do assinante na D4Sign. Serve de referência em log sem expor pessoa. */
  chave: string;
  nome: string;
  /** `nomenclatura` — o papel textual ("Assinar como parte"). NÃO é ordem de assinatura. */
  papel: null | string;
};

/** O que pode sair para o navegador sobre um assinante. Allowlist, não denylist. */
export type SignatarioPublico = {
  /** ISO com fuso. */
  assinadoEm: null | string;
  assinou: boolean;
  nome: string;
  papel: null | string;
};

/** O que pode sair para o navegador sobre o documento. */
export type DocumentoPublico = {
  rotulo: string;
  situacao: SituacaoD4Sign;
};

/**
 * A ÚNICA porta de saída do assinante.
 *
 * Escrita como allowlist explícita de propósito: um `delete s.email` ou um spread com omissão
 * volta a vazar no dia em que a D4Sign acrescentar um campo. Aqui, campo novo da API só chega à
 * tela se alguém escrever a linha dele.
 */
export function signatarioParaTela(signatario: SignatarioD4Sign): SignatarioPublico {
  return {
    assinadoEm: signatario.assinadoEm,
    assinou: signatario.assinou,
    nome: signatario.nome,
    papel: signatario.papel,
  };
}

/** A porta de saída do documento: situação e rótulo. `whoCanceled` e nome do arquivo ficam. */
export function documentoParaTela(documento: DocumentoD4Sign): DocumentoPublico {
  return {
    rotulo: SITUACAO_D4SIGN_LABELS[documento.situacao],
    situacao: documento.situacao,
  };
}

const texto = (valor: unknown): string => (valor === null || valor === undefined ? "" : String(valor).trim());
const textoOuNulo = (valor: unknown): null | string => texto(valor) || null;

/**
 * A resposta do `/list` e a do `/documents/{uuid}` vêm como ARRAY de um item só — diferente da
 * listagem em lote (`/documents?pg=N`), onde o item `[0]` é cabeçalho de paginação e não
 * documento. Esta função aceita as duas formas e o objeto solto.
 */
function primeiroObjeto(payload: unknown): null | Record<string, unknown> {
  const alvo = Array.isArray(payload) ? payload[0] : payload;
  return alvo && typeof alvo === "object" ? (alvo as Record<string, unknown>) : null;
}

/** Lê o documento de uma resposta de `/documents/{uuid}` ou `/documents/{uuid}/list`. */
export function lerDocumentoDaResposta(payload: unknown): DocumentoD4Sign | null {
  const bruto = primeiroObjeto(payload);
  const uuidDoc = texto(bruto?.uuidDoc);
  // Sem uuid não é documento: é o `{message: "..."}` que a API devolve para uuid que ela não
  // conhece, ou lixo. Quem chama decide o que fazer — aqui a gente só não inventa.
  if (!bruto || !uuidDoc) return null;

  const statusId = Number(bruto.statusId);

  return {
    canceladoPor: textoOuNulo(bruto.whoCanceled),
    cofre: textoOuNulo(bruto.uuidSafe),
    nome: texto(bruto.nameDoc),
    paginas: Number.isFinite(Number(bruto.pages)) && texto(bruto.pages) ? Number(bruto.pages) : null,
    situacao: interpretarStatusD4Sign(bruto.statusId),
    statusId: Number.isFinite(statusId) && texto(bruto.statusId) ? statusId : null,
    statusName: texto(bruto.statusName),
    uuidDoc,
  };
}

/**
 * Lê os assinantes de uma resposta de `/documents/{uuid}/list`.
 *
 * O que distingue assinou de não assinou (sondado no campo):
 *   • `signed` é a STRING `"1"` ou `"0"` — comparar com número dá sempre falso;
 *   • `sign_info` SÓ EXISTE quando `signed = "1"`; quando não assinou, a chave nem aparece. Por
 *     isso a presença dele entra como confirmação cruzada: se um dos dois disser que assinou e o
 *     outro não, a gente NÃO chuta — trata como não assinado e o `assinadoEm` fica nulo, que é o
 *     estado que faz a tela cobrar em vez de dar por resolvido.
 *   • a data boa é `sign_info.date_signed_atom` (ISO com fuso). O `date_signed` é ingênuo de fuso.
 *
 * ⚠️ ORDEM DE ASSINATURA NÃO EXISTE NA D4SIGN. Não há `order`, `sequence` nem `priority` — só
 * `nomenclatura` (papel textual) e `type` (código de papel). Quem precisa de fila usa o
 * `after_position` do C2X, que é onde a ordem mora de verdade.
 */
export function lerSignatariosDaResposta(payload: unknown): SignatarioD4Sign[] {
  const bruto = primeiroObjeto(payload);
  const lista = bruto?.list;
  if (!Array.isArray(lista)) return [];

  const signatarios: SignatarioD4Sign[] = [];
  for (const item of lista) {
    if (!item || typeof item !== "object") continue;
    const linha = item as Record<string, unknown>;
    const info =
      linha.sign_info && typeof linha.sign_info === "object"
        ? (linha.sign_info as Record<string, unknown>)
        : null;
    const marcadoComoAssinado = texto(linha.signed) === "1";
    const assinou = marcadoComoAssinado && info !== null;

    signatarios.push({
      assinadoEm: assinou ? textoOuNulo(info?.date_signed_atom) : null,
      assinou,
      chave: texto(linha.key_signer),
      convidadoEm: textoOuNulo(linha.date),
      documento: texto(linha.user_document),
      email: texto(linha.email).toLowerCase(),
      entregaDoEmail: textoOuNulo(linha.email_sent_status),
      nome: texto(linha.user_name),
      papel: textoOuNulo(linha.nomenclatura),
    });
  }

  return signatarios;
}

/**
 * O resultado de uma consulta.
 *
 * `motivo` existe para quem chama saber a diferença entre "a D4Sign não conhece esse documento"
 * (dado ruim no C2X: o uuid está lá e não existe lá) e "a D4Sign não respondeu" (rede, timeout,
 * disjuntor aberto). São fallbacks diferentes.
 */
export type ConsultaD4Sign =
  | {
      documento: DocumentoD4Sign;
      ok: true;
      signatarios: SignatarioD4Sign[];
    }
  | {
      motivo: "credencial-ausente" | "documento-desconhecido" | "indisponivel";
      ok: false;
    };

type EmCache = {
  em: number;
  ttl: number;
  valor: ConsultaD4Sign;
};

const cache = new Map<string, EmCache>();
/** Chamadas em voo, por uuid: é o que impede N cargas simultâneas de virarem N chamadas iguais. */
const emVoo = new Map<string, Promise<ConsultaD4Sign>>();

let falhasSeguidas = 0;
let disjuntorAbertoAte = 0;

/** Zera cache, chamadas em voo e disjuntor. Existe para os testes; não use em runtime. */
export function limparCacheD4Sign(): void {
  cache.clear();
  emVoo.clear();
  falhasSeguidas = 0;
  disjuntorAbertoAte = 0;
}

/** Números do cache para diagnóstico. Não expõe conteúdo de documento nenhum. */
export function estadoDoCacheD4Sign(): {
  disjuntorAberto: boolean;
  documentos: number;
  emVoo: number;
} {
  return {
    disjuntorAberto: Date.now() < disjuntorAbertoAte,
    documentos: cache.size,
    emVoo: emVoo.size,
  };
}

function guardar(uuid: string, valor: ConsultaD4Sign): void {
  // Falha NÃO entra no cache: ela é caso do disjuntor, e cachear "indisponível" por 5 minutos
  // deixaria a tela mentindo por 5 minutos depois que a D4Sign já voltou. A única exceção é o
  // documento que a D4Sign não conhece: esse é dado ruim do C2X, é estável, e reperguntar a cada
  // carga é pagar 1,4 s para ouvir o mesmo "não existe".
  if (!valor.ok && valor.motivo !== "documento-desconhecido") return;

  const ttl = valor.ok && situacaoEhTerminal(valor.documento.situacao) ? TTL_TERMINAL_MS : TTL_MS;
  cache.set(uuid, { em: Date.now(), ttl, valor });

  if (cache.size <= MAX_DOCUMENTOS) return;
  // Poda o mais velho. Map em JS itera na ordem de inserção, então o primeiro é o mais antigo a
  // ter entrado — e reinserção move para o fim, o que dá um LRU pobre e suficiente.
  const maisVelho = cache.keys().next();
  if (!maisVelho.done) cache.delete(maisVelho.value);
}

function doCache(uuid: string): ConsultaD4Sign | null {
  const guardado = cache.get(uuid);
  if (!guardado) return null;
  if (Date.now() - guardado.em >= guardado.ttl) {
    cache.delete(uuid);
    return null;
  }
  return guardado.valor;
}

function registrarFalha(): void {
  falhasSeguidas += 1;
  if (falhasSeguidas >= FALHAS_PARA_ABRIR) {
    disjuntorAbertoAte = Date.now() + DISJUNTOR_MS;
    falhasSeguidas = 0;
    console.warn("[guardian][d4sign] disjuntor aberto por 60s apos falhas seguidas");
  }
}

async function buscar(uuid: string): Promise<ConsultaD4Sign> {
  const tokenAPI = process.env.D4SIGN_TOKEN_API;
  const cryptKey = process.env.D4SIGN_CRYPT_KEY;
  if (!tokenAPI || !cryptKey) {
    // NÃO é falha de rede: não conta para o disjuntor e não vira "indisponível". A tela precisa
    // saber que o problema é de configuração, não da D4Sign.
    return { motivo: "credencial-ausente", ok: false };
  }

  // ⚠️ A credencial vai na query string porque é assim que a API autentica. Esta URL não pode ser
  // logada, devolvida nem colocada em mensagem de erro em lugar nenhum.
  const url = `${D4SIGN_API_BASE_URL}/documents/${encodeURIComponent(uuid)}/list?${new URLSearchParams(
    { cryptKey, tokenAPI },
  ).toString()}`;

  try {
    const resposta = await fetch(url, {
      cache: "no-store",
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!resposta.ok) {
      registrarFalha();
      return { motivo: "indisponivel", ok: false };
    }

    const payload: unknown = await resposta.json().catch(() => null);
    const documento = lerDocumentoDaResposta(payload);
    if (!documento) {
      // HTTP 200 sem documento é o `{message: "..."}` de uuid que a D4Sign não conhece. A conexão
      // funcionou, então isto NÃO conta falha para o disjuntor.
      falhasSeguidas = 0;
      return { motivo: "documento-desconhecido", ok: false };
    }

    falhasSeguidas = 0;
    return { documento, ok: true, signatarios: lerSignatariosDaResposta(payload) };
  } catch {
    // ⚠️ O erro do fetch NÃO é repassado nem logado: a URL que ele carrega tem a credencial.
    registrarFalha();
    return { motivo: "indisponivel", ok: false };
  }
}

/**
 * Consulta UM documento, com cache e deduplicação.
 *
 * As três camadas, nesta ordem:
 *   1. cache válido → devolve na hora, custo zero;
 *   2. disjuntor aberto → devolve "indisponível" na hora, sem tocar na rede (é o que impede uma
 *      D4Sign fora do ar de virar 467 timeouts de 6 s por carga de tela);
 *   3. chamada em voo para o MESMO uuid → devolve a promessa que já está correndo. Sem isso, dez
 *      abas abertas no mesmo instante viram dez chamadas idênticas — o cache só protege depois
 *      que a primeira volta, e a janela entre "pediu" e "voltou" é de 1,4 s.
 */
export async function consultarDocumentoD4Sign(uuidDoc: string): Promise<ConsultaD4Sign> {
  const uuid = uuidDoc.trim();
  if (!uuid) return { motivo: "documento-desconhecido", ok: false };

  const guardado = doCache(uuid);
  if (guardado) return guardado;

  if (Date.now() < disjuntorAbertoAte) return { motivo: "indisponivel", ok: false };

  const correndo = emVoo.get(uuid);
  if (correndo) return correndo;

  const promessa = buscar(uuid)
    .then((valor) => {
      guardar(uuid, valor);
      return valor;
    })
    .finally(() => {
      emVoo.delete(uuid);
    });

  emVoo.set(uuid, promessa);
  return promessa;
}

export type OpcoesDeLote = {
  /** Chamadas simultâneas. Padrão 6. */
  concorrencia?: number;
  /** Teto de tempo da rodada inteira. Estourou, o que faltava vira "indisponível". Padrão 8 s. */
  orcamentoMs?: number;
};

/**
 * Consulta VÁRIOS documentos com concorrência limitada e orçamento de tempo.
 *
 * A conta que manda no desenho: são ~1,4 s de latência FIXA por chamada, e o escopo do portal tem
 * 467 documentos. Em série seriam 11 minutos; com 6 em paralelo, ~1,8 min — ainda inaceitável numa
 * carga de tela. O que torna isso viável é o cache de terminais: 93% do acervo é Finalizado ou
 * Cancelado e cai no TTL de 12 h, então o custo de regime é o dos documentos EM MOVIMENTO. O
 * orçamento é a rede de segurança para a primeira carga fria e para o dia em que a D4Sign estiver
 * lenta: o que não coube volta "indisponível" e a tela mostra o fallback honesto em vez de pendurar.
 *
 * ⚠️ NÃO EXISTE POLLING AQUI, e não deve existir. Quem chama é uma carga de tela.
 */
export async function consultarDocumentosD4Sign(
  uuids: string[],
  opcoes: OpcoesDeLote = {},
): Promise<Map<string, ConsultaD4Sign>> {
  const concorrencia = Math.max(1, opcoes.concorrencia ?? CONCORRENCIA_PADRAO);
  const orcamentoMs = Math.max(0, opcoes.orcamentoMs ?? ORCAMENTO_PADRAO_MS);
  const limite = Date.now() + orcamentoMs;

  const unicos = [...new Set(uuids.map((uuid) => uuid.trim()).filter(Boolean))];
  const resultado = new Map<string, ConsultaD4Sign>();

  // Primeiro o que já está em cache: é grátis e não consome orçamento nem fila.
  const pendentes: string[] = [];
  for (const uuid of unicos) {
    const guardado = doCache(uuid);
    if (guardado) resultado.set(uuid, guardado);
    else pendentes.push(uuid);
  }

  let proximo = 0;
  const trabalhador = async (): Promise<void> => {
    for (;;) {
      const indice = proximo;
      proximo += 1;
      const uuid = pendentes[indice];
      if (uuid === undefined) return;

      if (Date.now() >= limite) {
        // Orçamento estourado: o resto nem tenta. Devolver "indisponível" é o que aciona o
        // fallback honesto na camada de cima — mentir "pendente" aqui seria pior.
        resultado.set(uuid, { motivo: "indisponivel", ok: false });
        continue;
      }

      resultado.set(uuid, await consultarDocumentoD4Sign(uuid));
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(concorrencia, pendentes.length) }, () => trabalhador()),
  );

  return resultado;
}
