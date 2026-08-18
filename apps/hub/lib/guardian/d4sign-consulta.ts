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
// ⚠️ E MESMO ASSIM, UMA CHAMADA POR DOCUMENTO NÃO PAGA UMA CARGA DE TELA. Medido em 18/08/2026,
// contra o C2X e contra a D4Sign, nos recortes reais:
//
//   recorte                envios com uuid   terminais   em movimento
//   Vista Alegre (VAL)                  39          38              1
//   Lagoa Bonita (LBR)                 211         198             13
//   Vale do Ouro (VOC+VOL)             185           0            185   ← o padrão da tela do Apolo
//
// A 1,5 s por chamada e 6 em paralelo, o Vale do Ouro sozinho custaria 185/6 × 1,5 s ≈ 46 s — e o
// orçamento de 8 s cortaria quase tudo, entregando uma tela inteira em fallback. É o oposto do
// pedido.
//
// ⚠️ A SAÍDA É A LISTAGEM EM LOTE: `GET /documents?pg=N` devolve 500 documentos por página com
// `uuidDoc`, `statusId`, `statusName`, `nameDoc`, `pages`, `uuidSafe` e `whoCanceled` — tudo o que
// `lerDocumentoDaResposta` já lê, MENOS os assinantes. Medido: o CATÁLOGO INTEIRO (3.923
// documentos, 8 páginas, 6 em paralelo) leva 3,0 s. Dos 2.171 uuid que o C2X aponta, 2.171 estão
// nele — nenhum ficou de fora. E 93% do acervo é TERMINAL (2.489 finalizados + 1.161 cancelados),
// caso em que o assinante a assinante não acrescenta nada que mude a tela:
//   • finalizado = todo mundo daquele documento assinou (é o que "finalizado" quer dizer);
//   • cancelado = não é pendência de ninguém, e a conciliação já ignora os assinantes dele.
//
// Então a divisão de custo ficou assim, e é o que `consultarDocumentosD4Sign` faz:
//   1. lote poucochinho (≤ 8 documentos)  → direto no `/list`, que é mais barato que 8 páginas;
//   2. lote grande                        → CATÁLOGO (3 s, uma vez a cada 5 min, para o Hub
//                                           inteiro) resolve o status de todos;
//   3. os EM MOVIMENTO que sobraram       → `/list` assinante a assinante, se couberem no teto
//                                           (`TETO_ASSINANTES_POR_CARGA`) e no orçamento;
//   4. o que não couber                   → fica com o status do catálogo (`signatarios: null`),
//                                           que a camada de cima marca como "situação confirmada,
//                                           assinaturas do sistema antigo". NÃO vira "indisponível":
//                                           mentir queda de API sobre um dado que a gente TEM seria
//                                           pior que o dado parcial.
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

/**
 * A partir de quantos documentos pendentes vale puxar o CATÁLOGO em vez de perguntar um a um.
 *
 * O catálogo custa 8 chamadas (uma por página) e resolve o acervo inteiro; abaixo disso, perguntar
 * documento a documento é mais barato e ainda traz os assinantes junto. O número é o de páginas
 * medido em 18/08/2026 — se o acervo dobrar, o `total_pages` da primeira página é quem manda no
 * custo real, e este limiar continua sendo o piso honesto.
 */
const LIMIAR_DO_CATALOGO = 8;

/**
 * Quantos documentos EM MOVIMENTO uma carga de tela ainda persegue assinante a assinante.
 *
 * ⚠️ É TUDO OU NADA POR RECORTE, de propósito. Perseguir "o que couber no tempo" faria a mesma
 * tela mostrar metade das linhas confirmadas e metade não, e a metade mudaria a cada F5 — o
 * usuário não teria como saber o que está olhando. Com o teto, o recorte inteiro tem o mesmo grau
 * de confirmação, e ele é dizível numa frase.
 *
 * 20 × 1,5 s ÷ 6 em paralelo ≈ 5 s, que cabe no orçamento junto com os 3 s do catálogo. Cobre
 * Vista Alegre (1 em movimento) e Lagoa Bonita (13); não cobre o Vale do Ouro (185), que fica com
 * a situação do documento confirmada e a marcação de quem assinou vinda do C2X.
 *
 * ═════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠️ E O TETO NÃO ATRAPALHA O CASO QUE IMPORTA — mas só porque o caso que importa é TERMINAL.
 *
 * Medido em 18/08/2026 no acervo inteiro (scripts/apolo/onde-o-c2x-esta-furado.mjs), a pendência
 * que o C2X cobra e a D4Sign já fechou são 496 assinaturas em 2.171 envios, e elas se concentram
 * de um jeito que decide o desenho:
 *
 *   emp                        falsas   documentos finalizados que o C2X mostra abertos
 *   LOS (Lavra do Ouro, id 4)     454   151      ← 91% do problema mora aqui
 *   LBR (Lagoa Bonita)             13     6
 *   REP / CDJ / PDV / RDP           22    17
 *   VDO / MLN / MLC                  7     7
 *   VOC, VOL, VOR, VAL, LBF     LIMPOS   0       ← os portais ativos e o Vale do Ouro
 *
 * E todas as 496 saem do CATÁLOGO, sem uma chamada por documento: finalizado é terminal, e o laço
 * acima resolve terminal ANTES de chegar neste teto. Ou seja, o `desisteDaLista` não perde nenhuma
 * das 496 — ele só desiste do detalhe pessoa a pessoa de documento EM MOVIMENTO.
 *
 * ⚠️ E NO VALE DO OURO ESSE DETALHE NÃO CUSTA NADA, porque lá o C2X está CERTO. Medido assinante a
 * assinante no recorte VOC+VOL (scripts/apolo/conferir-tela-vs-c2x.mjs): 185 envios, 2.295 linhas,
 * 1.487 pareadas com a D4Sign (658 delas pelo nome, porque o e-mail não bastou) e ZERO divergência
 * nas duas direções. As 808 linhas que não pareiam têm 808 signatários sobrando do outro lado — o
 * mesmo número —, então são a mesma pessoa gravada com e-mail e grafia diferentes nos dois
 * sistemas, não assinatura faltando.
 *
 * ⚠️ CUIDADO COM A MEDIÇÃO, que é onde eu mesmo errei antes: casar assinante por e-mail com um
 * `Map` (sem consumir o par) faz UM signatário assinado casar com N linhas do mesmo e-mail e
 * inventa divergência — deu "120 erradas no Vale do Ouro" numa primeira conta, e o número era
 * artefato. O pareamento tem que ser 1-para-1, como `conciliarDocumento` faz. E na resposta do
 * `/list` o nome é `user_name` (não `name`) e `assinou` exige `signed === "1"` E `sign_info`
 * presente: ler o campo errado produz medição limpa e falsa.
 * ═════════════════════════════════════════════════════════════════════════════════════════════
 */
const TETO_ASSINANTES_POR_CARGA = 20;

/** TTL do catálogo. O mesmo dos documentos que se movem: é para eles que ele serve. */
const TTL_CATALOGO_MS = TTL_MS;

/** Trava de segurança: mesmo que a API diga `total_pages` absurdo, a gente para aqui. */
const MAX_PAGINAS_DO_CATALOGO = 40;

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

/** Uma página de `GET /documents?pg=N`: o cabeçalho de paginação e os documentos dela. */
export type PaginaDoCatalogo = {
  documentos: DocumentoD4Sign[];
  /** `total_pages` do cabeçalho. 0 quando a resposta não trouxe. */
  paginas: number;
};

/**
 * Lê uma página da LISTAGEM EM LOTE.
 *
 * ⚠️ O ITEM `[0]` É CABEÇALHO, NÃO DOCUMENTO — `{total_documents, total_in_this_page,
 * current_page, total_pages}`. Ele é a diferença desta resposta para a do `/documents/{uuid}`, e
 * quem tratar o array inteiro como documento vai criar um registro fantasma sem uuid por página.
 * Aqui a defesa é dupla: o cabeçalho é lido à parte E só entra na lista quem tem `uuidDoc`.
 *
 * ⚠️ ESTA RESPOSTA NÃO TRAZ ASSINANTE NENHUM. Ela é a fonte do STATUS; quem precisar de assinante
 * pergunta pelo `/list`.
 */
export function lerPaginaDoCatalogo(payload: unknown): null | PaginaDoCatalogo {
  if (!Array.isArray(payload)) return null;

  const cabecalho = payload[0] && typeof payload[0] === "object" ? (payload[0] as Record<string, unknown>) : null;
  const paginas = Number(cabecalho?.total_pages);

  const documentos: DocumentoD4Sign[] = [];
  for (const item of payload) {
    if (!item || typeof item !== "object") continue;
    const documento = lerDocumentoDaResposta(item);
    if (documento) documentos.push(documento);
  }

  return { documentos, paginas: Number.isFinite(paginas) && paginas > 0 ? paginas : 0 };
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
      /**
       * Os assinantes daquele documento, ou `null` quando a resposta veio da LISTAGEM EM LOTE e
       * ninguém perguntou assinante a assinante.
       *
       * ⚠️ `null` NÃO É "documento sem assinante" — é "não perguntamos". A diferença muda a tela:
       * lista vazia diria que o C2X inventou todo mundo (e viraria um `signatario-so-no-c2x` por
       * linha); `null` diz que o STATUS está confirmado e a marcação de quem assinou continua
       * sendo a do sistema antigo. Quem consome tem que separar os dois casos.
       */
      signatarios: null | SignatarioD4Sign[];
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

/** O catálogo inteiro por uuid, e quando ele foi montado. Um só para o processo. */
let catalogo: null | { em: number; mapa: Map<string, DocumentoD4Sign> } = null;
/** A montagem do catálogo em voo: dez cargas ao mesmo tempo pagam UMA varredura de 8 páginas. */
let catalogoEmVoo: null | Promise<null | Map<string, DocumentoD4Sign>> = null;

let falhasSeguidas = 0;
let disjuntorAbertoAte = 0;

/** Zera cache, catálogo, chamadas em voo e disjuntor. Existe para os testes; não use em runtime. */
export function limparCacheD4Sign(): void {
  cache.clear();
  emVoo.clear();
  catalogo = null;
  catalogoEmVoo = null;
  falhasSeguidas = 0;
  disjuntorAbertoAte = 0;
}

/** Números do cache para diagnóstico. Não expõe conteúdo de documento nenhum. */
export function estadoDoCacheD4Sign(): {
  /** Documentos no catálogo em lote. 0 quando ele nunca foi carregado (ou já venceu). */
  catalogo: number;
  disjuntorAberto: boolean;
  documentos: number;
  emVoo: number;
} {
  return {
    catalogo: catalogo && Date.now() - catalogo.em < TTL_CATALOGO_MS ? catalogo.mapa.size : 0,
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
 * Puxa UMA página da listagem em lote. Devolve nulo em qualquer tropeço — o catálogo é um atalho
 * de custo, e catálogo incompleto só faz o documento faltante cair no caminho normal do `/list`.
 */
async function buscarPaginaDoCatalogo(pg: number): Promise<null | PaginaDoCatalogo> {
  const tokenAPI = process.env.D4SIGN_TOKEN_API;
  const cryptKey = process.env.D4SIGN_CRYPT_KEY;
  if (!tokenAPI || !cryptKey) return null;

  // ⚠️ Mesma regra do `buscar`: a credencial vai na query string e esta URL não pode ser logada,
  // devolvida nem entrar em mensagem de erro.
  const url = `${D4SIGN_API_BASE_URL}/documents?${new URLSearchParams({
    cryptKey,
    pg: String(pg),
    tokenAPI,
  }).toString()}`;

  try {
    const resposta = await fetch(url, {
      cache: "no-store",
      headers: { Accept: "application/json" },
      // A página é maior que um documento (500 itens, ~125 KB): 6 s seria apertado. Medido: 1,5 s.
      signal: AbortSignal.timeout(TIMEOUT_MS * 2),
    });
    if (!resposta.ok) {
      registrarFalha();
      return null;
    }

    const payload: unknown = await resposta.json().catch(() => null);
    const pagina = lerPaginaDoCatalogo(payload);
    if (pagina) falhasSeguidas = 0;

    return pagina;
  } catch {
    // ⚠️ O erro do fetch NÃO é repassado nem logado: a URL que ele carrega tem a credencial.
    registrarFalha();
    return null;
  }
}

/**
 * O CATÁLOGO INTEIRO por uuid — a listagem em lote, com cache e deduplicação de montagem.
 *
 * Medido em 18/08/2026: 3.923 documentos em 8 páginas, 3,0 s com 6 páginas em paralelo. Isso é o
 * status de TODO o acervo por menos tempo do que custam duas consultas documento a documento.
 *
 * ⚠️ ELE NÃO ENTRA NO CACHE POR DOCUMENTO, e isso é decisão, não esquecimento: seriam 3.923
 * entradas num cache com teto de 2.000, e a poda comeria justamente as consultas COMPLETAS (com
 * assinantes) que custaram uma chamada cada. O catálogo mora no mapa dele, com o TTL dele.
 *
 * ⚠️ PÁGINA QUE FALHA NÃO INVALIDA O CATÁLOGO. O que ela deixa de fora simplesmente não é
 * encontrado, e o documento cai no caminho normal (`/list`) — que é a resposta certa para "não
 * sei", e não um erro de tela.
 */
export async function carregarCatalogoD4Sign(): Promise<null | Map<string, DocumentoD4Sign>> {
  if (catalogo && Date.now() - catalogo.em < TTL_CATALOGO_MS) return catalogo.mapa;
  if (Date.now() < disjuntorAbertoAte) return null;
  if (catalogoEmVoo) return catalogoEmVoo;

  const montar = async (): Promise<null | Map<string, DocumentoD4Sign>> => {
    const primeira = await buscarPaginaDoCatalogo(1);
    // Sem a primeira página não há nem quantas são: aqui a gente desiste e deixa o `/list` cuidar.
    if (!primeira) return null;

    const mapa = new Map<string, DocumentoD4Sign>();
    for (const documento of primeira.documentos) mapa.set(documento.uuidDoc, documento);

    const total = Math.min(primeira.paginas, MAX_PAGINAS_DO_CATALOGO);
    if (total > 1) {
      const restantes = Array.from({ length: total - 1 }, (_, i) => i + 2);
      let proxima = 0;
      const trabalhador = async (): Promise<void> => {
        for (;;) {
          const pg = restantes[proxima];
          proxima += 1;
          if (pg === undefined) return;
          const pagina = await buscarPaginaDoCatalogo(pg);
          if (!pagina) continue;
          for (const documento of pagina.documentos) mapa.set(documento.uuidDoc, documento);
        }
      };
      await Promise.all(
        Array.from({ length: Math.min(CONCORRENCIA_PADRAO, restantes.length) }, () => trabalhador()),
      );
    }

    catalogo = { em: Date.now(), mapa };

    return mapa;
  };

  catalogoEmVoo = montar().finally(() => {
    catalogoEmVoo = null;
  });

  return catalogoEmVoo;
}

/** O catálogo está em memória e dentro do TTL? Quem pergunta é quem não pode esperar 4,4 s. */
export function catalogoEstaQuente(): boolean {
  return catalogo !== null && Date.now() - catalogo.em < TTL_CATALOGO_MS;
}

/**
 * Aquece o catálogo (e, opcionalmente, alguns documentos) SEM que ninguém espere.
 *
 * ⚠️ CHAME DENTRO DO `after()` DA ROTA, nunca antes de responder — o ponto todo é a resposta sair
 * na frente. Na Vercel o `after()` mantém a função viva depois do envio, que é justamente onde
 * este trabalho deve morar.
 *
 * ⚠️ NÃO É POLLING. Roda no máximo uma vez por instância a cada TTL (5 min), porque a primeira
 * coisa que faz é desistir se o catálogo já estiver quente. Sem essa guarda, uma tela aberta em
 * várias abas viraria uma fila de aquecimentos idênticos.
 *
 * ⚠️ ENGOLE ERRO DE PROPÓSITO. Ninguém está esperando: se a D4Sign estiver fora, a próxima carga
 * simplesmente cai no fallback do C2X de novo, que é o comportamento correto. Deixar a promessa
 * rejeitar aqui derrubaria a função DEPOIS de a resposta já ter saído, e o log ficaria mentindo
 * sobre uma requisição que deu certo.
 */
export function aquecerD4SignEmSegundoPlano(uuids: string[] = []): void {
  if (catalogoEstaQuente() || Date.now() < disjuntorAbertoAte) return;

  void carregarCatalogoD4Sign()
    .then(async (mapa) => {
      if (!mapa || uuids.length === 0) return;

      // Só o que se MOVE vale detalhe: o terminal já saiu resolvido do catálogo. Com o teto de
      // sempre, para o aquecimento não virar uma varredura do acervo inteiro.
      const emMovimento = [...new Set(uuids.map((u) => u.trim()).filter(Boolean))]
        .filter((uuid) => {
          const documento = mapa.get(uuid);
          return !documento || !situacaoEhTerminal(documento.situacao);
        })
        .slice(0, TETO_ASSINANTES_POR_CARGA);

      if (emMovimento.length > 0) await consultarDocumentosD4Sign(emMovimento, { catalogo: false });
    })
    .catch(() => undefined);
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
  /**
   * Usar a listagem em lote quando o recorte for grande. Padrão: sim.
   *
   * Existe para o teste poder fixar o caminho documento a documento sem depender do limiar — e
   * para um chamador que precise de assinante a assinante custe o que custar (nenhum precisa hoje).
   */
  catalogo?: boolean;
  /** Chamadas simultâneas. Padrão 6. */
  concorrencia?: number;
  /** Teto de tempo da rodada inteira. Estourou, o que faltava vira "indisponível". Padrão 8 s. */
  orcamentoMs?: number;
  /**
   * NÃO ESPERAR REDE NENHUMA: responder com o que já está em memória e aquecer o resto depois.
   *
   * ⚠️ ISTO EXISTE PORQUE A CONTA DA CARGA FRIA ERA INSUSTENTÁVEL, e foi medida: catálogo 4,4 s
   * (8 páginas, `scripts/apolo/medir-catalogo-real.mjs`) mais 7,0 s dos 20 detalhes do teto
   * (concorrência 6) — perto de 12 s de tela parada, contra 0,1 s do SQL que traz a mesma lista.
   * Como o cache é da INSTÂNCIA e a Vercel recicla instância o tempo todo, essa conta não era
   * excepcional: reaparecia várias vezes ao dia, e foi o que o dono sentiu em 18/08/2026
   * (*"está demorando muito para carregar as páginas"*).
   *
   * Ligada: o cache vale, o catálogo vale SE já estiver quente, e nada mais sai para a rede — o
   * que sobra vira "indisponível" e cai no fallback honesto do C2X, com o aviso de sempre. Quem
   * quiser o dado conciliado chama `aquecerD4SignEmSegundoPlano` e pergunta de novo.
   */
  semEsperar?: boolean;
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

  // ── O CATÁLOGO ────────────────────────────────────────────────────────────
  //
  // Ele resolve o STATUS de todo mundo por 8 chamadas. O que ele NÃO resolve é quem assinou — e é
  // por isso que só o TERMINAL sai daqui pronto: em documento finalizado ou cancelado, assinante a
  // assinante não muda nada na tela (ver o cabeçalho). O que está EM MOVIMENTO segue para o
  // `/list`, que é onde a fila de assinatura de verdade se decide.
  // ⚠️ COM `semEsperar`, O CATÁLOGO SÓ VALE SE JÁ ESTIVER QUENTE. Carregá-lo aqui custaria os
  // 4,4 s medidos, que é exatamente o que esse modo existe para não pagar.
  const querCatalogo = (opcoes.catalogo ?? true) && pendentes.length > LIMIAR_DO_CATALOGO;
  const doCatalogo =
    querCatalogo && (!opcoes.semEsperar || catalogoEstaQuente())
      ? await carregarCatalogoD4Sign()
      : null;

  const paraLista: string[] = [];
  for (const uuid of pendentes) {
    const documento = doCatalogo?.get(uuid);
    if (documento && situacaoEhTerminal(documento.situacao)) {
      resultado.set(uuid, { documento, ok: true, signatarios: null });
      continue;
    }
    paraLista.push(uuid);
  }

  // ── OS QUE SE MOVEM ───────────────────────────────────────────────────────
  //
  // ⚠️ TUDO OU NADA. Passou do teto, NINGUÉM é perseguido assinante a assinante: o recorte inteiro
  // fica com o status do catálogo e a tela diz isso numa frase só. Perseguir "o que couber"
  // deixaria metade das linhas confirmadas e metade não, com a metade mudando a cada F5.
  const conhecidosNoCatalogo = paraLista.filter((uuid) => doCatalogo?.has(uuid));
  const desisteDaLista =
    opcoes.semEsperar === true ||
    (paraLista.length > TETO_ASSINANTES_POR_CARGA &&
      conhecidosNoCatalogo.length === paraLista.length);

  let proximo = 0;
  const trabalhador = async (): Promise<void> => {
    for (;;) {
      const indice = proximo;
      proximo += 1;
      const uuid = paraLista[indice];
      if (uuid === undefined) return;

      // Orçamento estourado (ou teto batido): o que o catálogo souber vale como status confirmado,
      // e só o que ele NÃO souber vira "indisponível" — que é o que aciona o fallback honesto. Dar
      // queda de API sobre um dado que a gente tem na mão seria mentira na direção errada.
      if (desisteDaLista || Date.now() >= limite) {
        const documento = doCatalogo?.get(uuid);
        resultado.set(
          uuid,
          documento ? { documento, ok: true, signatarios: null } : { motivo: "indisponivel", ok: false },
        );
        continue;
      }

      resultado.set(uuid, await consultarDocumentoD4Sign(uuid));
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(concorrencia, paraLista.length) }, () => trabalhador()),
  );

  return resultado;
}
