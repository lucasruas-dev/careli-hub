// O CLIENTE HTTP DA CLICKSIGN — a única porta de saída para a API deles.
//
// ⚠️ A BASE URL VEM DE ENV, SEM DEFAULT NO CÓDIGO, e isso é a proteção contra o erro mais caro da
// integração: mandar contrato para o ambiente de teste, receber 200, e ter um documento assinado
// SEM VALIDADE JURÍDICA. É o mesmo estrago do [[reference_c2x_write_url_aponta_teste]], e a
// diferença é que aqui o resultado é um contrato imobiliário. Sem a env, o cliente RECUSA a chamada
// em vez de escolher um ambiente sozinho.
//
// ⚠️ O TOKEN VAI NO HEADER, e é uma vantagem real sobre o D4Sign, que leva `tokenAPI` e `cryptKey`
// na QUERY STRING — onde vazam em log de proxy, em APM e em stack trace de fetch.
//
// ⚠️ E O ERRO NUNCA REPASSA A MENSAGEM CRUA DO FETCH. A mensagem de um fetch que falha carrega a URL
// chamada; num cliente cuja URL leva credencial isso seria vazamento, e mesmo aqui (onde não leva)
// a regra fica valendo — porque o dia em que alguém acrescentar um parâmetro sensível, o cuidado já
// está no lugar.
//
// ⚠️ TIMEOUT EM TODA CHAMADA. Sem `AbortSignal`, o fetch do Node espera o socket, e uma função da
// Vercel presa nisso queima os 300 s e devolve erro de JSON na tela — o padrão que já nos mordeu.

/** Quanto esperamos por uma chamada comum (criar envelope, cadastrar signatário). */
const TIMEOUT_MS = 15_000;
/** O upload leva o PDF inteiro em base64: precisa de mais folga. */
const TIMEOUT_UPLOAD_MS = 60_000;

export type ErroDaClicksign = {
  /** O corpo da resposta, quando veio em JSON:API (`errors[].detail`). Ajuda a dizer QUAL campo. */
  detalhes: string[];
  /** `X-Request-Id` da resposta: é o que o suporte deles pede para investigar. */
  requestId: null | string;
  status: number;
};

export class FalhaDaClicksign extends Error {
  readonly erro: ErroDaClicksign;

  constructor(mensagem: string, erro: ErroDaClicksign) {
    super(mensagem);
    this.name = "FalhaDaClicksign";
    this.erro = erro;
  }
}

/** As três variáveis de que a integração depende. Só os NOMES aparecem em qualquer log. */
export type ConfiguracaoDaClicksign = {
  baseUrl: string;
  token: string;
  webhookSecret: null | string;
};

/**
 * Lê a configuração do ambiente.
 *
 * ⚠️ TRATA STRING VAZIA COMO AUSENTE. Variável marcada como "Sensitive" na Vercel chega VAZIA na
 * função, sem erro nenhum — aconteceu com cinco chaves do Asaas
 * ([[reference_vercel_env_sensitive]]). Um `??` não pegaria isso, porque string vazia não é nulo:
 * o app se comportaria como se a chave existisse e falharia lá na frente, no meio de um envio.
 */
export function lerConfiguracao(): ConfiguracaoDaClicksign | null {
  const baseUrl = process.env.CLICKSIGN_API_BASE_URL?.trim();
  const token = process.env.CLICKSIGN_TOKEN_API?.trim();
  const webhookSecret = process.env.CLICKSIGN_WEBHOOK_SECRET?.trim();

  if (!baseUrl || !token) return null;

  return {
    baseUrl: baseUrl.replace(/\/+$/, ""),
    token,
    webhookSecret: webhookSecret || null,
  };
}

/** Quais chaves estão presentes — para a rota de diagnóstico, sem revelar nenhum valor. */
export function conferirConfiguracao(): {
  ambiente: null | string;
  faltando: string[];
  presentes: string[];
} {
  const nomes = ["CLICKSIGN_API_BASE_URL", "CLICKSIGN_TOKEN_API", "CLICKSIGN_WEBHOOK_SECRET"] as const;
  const presentes: string[] = [];
  const faltando: string[] = [];

  for (const nome of nomes) {
    // Vazio conta como faltando — ver a nota de `lerConfiguracao`.
    if (process.env[nome]?.trim()) presentes.push(nome);
    else faltando.push(nome);
  }

  // ⚠️ A BASE URL NÃO É SEGREDO, e mostrá-la é o ponto: é como se enxerga, de fora, se a produção
  // está apontando para o sandbox. Um contrato assinado no ambiente errado não tem validade, e o
  // sintoma é invisível — a API responde 200 igual.
  const ambiente = process.env.CLICKSIGN_API_BASE_URL?.trim() || null;

  return { ambiente, faltando, presentes };
}

/** O ambiente parece ser o de teste? Serve para a tela avisar antes de alguém mandar contrato real. */
export function pareceSandbox(baseUrl: null | string): boolean {
  return (baseUrl ?? "").toLowerCase().includes("sandbox");
}

/**
 * COMO O TOKEN VAI NO CABEÇALHO — e por que isto é configurável em vez de fixo.
 *
 * ⚠️ ESTA CASA JÁ LEVOU ESSA PANCADA. O write do C2X usa `Authorization` com o token CRU, sem o
 * esquema (`reference_c2x_write_header_sem_bearer`), e passamos horas atrás de um 401 que era o
 * prefixo. A documentação da Clicksign mostra `Bearer`, mas a v3 é JSON:API e há forte indício de
 * que ela queira o token puro — e o custo de errar não é o 401: é o DIAGNÓSTICO afirmar "a Clicksign
 * recusou o token" e mandar alguém trocar uma chave que está certa.
 *
 * Por isso o esquema não é escolhido no escuro: o diagnóstico SONDA as duas formas contra a conta
 * real e diz qual respondeu. Depois de sabido, fixa-se aqui.
 */
export type EsquemaDoToken = "bearer" | "cru";

export const ESQUEMAS: EsquemaDoToken[] = ["bearer", "cru"];

function cabecalhoDeAutorizacao(token: string, esquema: EsquemaDoToken): string {
  return esquema === "bearer" ? `Bearer ${token}` : token;
}

/**
 * O `Content-Type` da chamada.
 *
 * ⚠️ JSON:API PEDE `application/vnd.api+json`, e mandar `application/json` num POST costuma voltar
 * 415 — um erro que só aparece na primeira ESCRITA, ou seja, quando já há contrato em jogo. Como a
 * leitura funciona com os dois, sondar isso junto com o esquema do token é de graça.
 */
export type TipoDeConteudo = "json" | "jsonapi";

export const TIPOS_DE_CONTEUDO: TipoDeConteudo[] = ["jsonapi", "json"];

function mime(tipo: TipoDeConteudo): string {
  return tipo === "jsonapi" ? "application/vnd.api+json" : "application/json";
}

export type Opcoes = {
  /** Corpo JSON. Ausente = a chamada não manda corpo. */
  corpo?: unknown;
  /** Sobrepõe o esquema do token — usado pela sonda do diagnóstico. */
  esquema?: EsquemaDoToken;
  metodo?: "DELETE" | "GET" | "PATCH" | "POST";
  /** Chamada de upload: usa o timeout longo. */
  pesada?: boolean;
  /** Sobrepõe o content-type — usado pela sonda do diagnóstico. */
  tipoDeConteudo?: TipoDeConteudo;
};

/**
 * Uma chamada à API da Clicksign.
 *
 * Devolve o JSON já lido. Lança `FalhaDaClicksign` com status, `X-Request-Id` e os detalhes do
 * JSON:API — que é a informação que o D4Sign não dá (lá o corpo de erro tem schema vazio, e não se
 * distingue "token inválido" de "cofre inexistente" sem catalogar na tentativa e erro).
 */
export async function chamar<T = unknown>(caminho: string, opcoes: Opcoes = {}): Promise<T> {
  const cfg = lerConfiguracao();
  if (!cfg) {
    throw new FalhaDaClicksign("Clicksign não configurada (falta CLICKSIGN_API_BASE_URL ou CLICKSIGN_TOKEN_API).", {
      detalhes: [],
      requestId: null,
      status: 0,
    });
  }

  const url = `${cfg.baseUrl}${caminho.startsWith("/") ? caminho : `/${caminho}`}`;
  const metodo = opcoes.metodo ?? "GET";

  let resposta: Response;
  try {
    resposta = await fetch(url, {
      body: opcoes.corpo === undefined ? undefined : JSON.stringify(opcoes.corpo),
      headers: {
        Accept: mime(opcoes.tipoDeConteudo ?? "jsonapi"),
        Authorization: cabecalhoDeAutorizacao(cfg.token, opcoes.esquema ?? "bearer"),
        "Content-Type": mime(opcoes.tipoDeConteudo ?? "jsonapi"),
      },
      method: metodo,
      signal: AbortSignal.timeout(opcoes.pesada ? TIMEOUT_UPLOAD_MS : TIMEOUT_MS),
    });
  } catch (e) {
    // ⚠️ NÃO REPASSA `e.message`: a mensagem de um fetch que falha carrega a URL chamada. Ver o topo.
    const expirou = e instanceof Error && e.name === "TimeoutError";
    throw new FalhaDaClicksign(
      expirou ? `Clicksign não respondeu em ${opcoes.pesada ? 60 : 15}s.` : "Falha de rede ao chamar a Clicksign.",
      { detalhes: [], requestId: null, status: 0 },
    );
  }

  const requestId = resposta.headers.get("x-request-id");
  const texto = await resposta.text().catch(() => "");

  if (!resposta.ok) {
    throw new FalhaDaClicksign(`Clicksign devolveu ${resposta.status}.`, {
      detalhes: detalhesDoErro(texto),
      requestId,
      status: resposta.status,
    });
  }

  if (!texto) return undefined as T;

  try {
    return JSON.parse(texto) as T;
  } catch {
    throw new FalhaDaClicksign("Clicksign devolveu um corpo que não é JSON.", {
      // ⚠️ O 429 deles devolve TEXTO PURO, não JSON:API — medido no estudo. Guardar o início do
      // corpo é o que permite reconhecer isso em vez de reportar "JSON inválido" e parar aí.
      detalhes: [texto.slice(0, 200)],
      requestId,
      status: resposta.status,
    });
  }
}

/**
 * A PORTA DA CLICKSIGN — a assinatura de `chamar`, nomeada para poder ser TROCADA.
 *
 * ⚠️ EXISTE PARA O TESTE NÃO PRECISAR DA CONTA REAL, e isso não é preciosismo de arquitetura: a
 * conta configurada é de PRODUÇÃO (Lucas, 08/09/2026: o sandbox deles está com problema), o
 * envelope criado tem CUSTO e, depois de ativado, NÃO SE APAGA. Um teste que chamasse a API de
 * verdade deixaria lixo pago e permanente na conta a cada `vitest run`.
 *
 * Quem envia recebe esta porta por parâmetro e usa `chamar` como padrão; o teste passa um duplo que
 * grava o que foi pedido e devolve o que a doc diz que volta.
 */
export type PortaDaClicksign = <T = unknown>(caminho: string, opcoes?: Opcoes) => Promise<T>;

/**
 * SONDA: qual combinação de cabeçalho a conta aceita?
 *
 * ⚠️ EXISTE PORQUE ESCOLHER NO ESCURO CUSTA CARO. Se o esquema do token estiver errado, TUDO volta
 * 401 — e um diagnóstico ingênuo diria "a Clicksign recusou o token", mandando trocar uma chave que
 * está certa e caçar a armadilha do "Sensitive" da Vercel. O defeito seriam seis caracteres no
 * cabeçalho. Esta casa já levou exatamente essa pancada no write do C2X
 * ([[reference_c2x_write_header_sem_bearer]]).
 *
 * Faz até 4 leituras baratas (uma página de listagem) e devolve a primeira que responder. É LEITURA:
 * não cria nada na conta.
 */
export async function sondarCabecalho(): Promise<
  | { erroFinal: string; ok: false }
  | { esquema: EsquemaDoToken; ok: true; tipoDeConteudo: TipoDeConteudo }
> {
  let ultimoErro = "não foi possível falar com a Clicksign";

  for (const tipoDeConteudo of TIPOS_DE_CONTEUDO) {
    for (const esquema of ESQUEMAS) {
      try {
        await chamar("/envelopes?page[number]=1&page[size]=1", { esquema, tipoDeConteudo });
        return { esquema, ok: true, tipoDeConteudo };
      } catch (e) {
        if (!(e instanceof FalhaDaClicksign)) throw e;
        // 401/403/415 = combinação errada, vale tentar a próxima. Qualquer outro erro (rede, 429,
        // 5xx) é da CONEXÃO e não do cabeçalho: insistir nas outras combinações só gastaria o teto
        // de requisições sem responder nada.
        const vaisTentarOutra = [401, 403, 415].includes(e.erro.status);
        ultimoErro = `${e.message} ${e.erro.detalhes.join(" · ")}`.trim();
        if (!vaisTentarOutra) return { erroFinal: ultimoErro, ok: false };
      }
    }
  }

  return { erroFinal: ultimoErro, ok: false };
}

/** Os `errors[].detail` do JSON:API, quando vierem. É o que diz QUAL campo falhou. */
function detalhesDoErro(texto: string): string[] {
  if (!texto) return [];
  try {
    const corpo = JSON.parse(texto) as { errors?: { detail?: string; source?: { pointer?: string } }[] };
    const erros = corpo?.errors;
    if (!Array.isArray(erros)) return [texto.slice(0, 200)];
    return erros
      .map((e) => [e?.source?.pointer, e?.detail].filter(Boolean).join(" "))
      .filter((s) => s.length > 0);
  } catch {
    return [texto.slice(0, 200)];
  }
}
