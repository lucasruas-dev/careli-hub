// Cliente server-side do MOSTQI (leitura documental iOCR + status de conexao).
//
// Requisitos da MOST respeitados aqui:
// - Consumo SO pelo backend (este arquivo nunca deve ser importado no client).
// - Autenticacao por JWT temporario (10 min, uso unico): a client key fica na
//   env MOSTQI_CLIENT_KEY, o token e obtido sob demanda em cada operacao e
//   descartado. Se a extracao levar 401 (token morto), reautentica e refaz.
// - Nada de token/chave em log, resposta ao browser, commit ou mensagem.
//
// Enquanto a client key nao estiver na env, o modulo opera em MODO SIMULADO:
// devolve uma extracao de exemplo para a tela de teste funcionar ponta a ponta.

const DEFAULT_BASE_URL = "https://mostqiapi.com"; // homolog/POC (sem IP whitelist)
const DEFAULT_AUTH_PATH = "/user/authenticate";
const DEFAULT_EXTRACTION_PATH = "/process-image/content-extraction";
// Enrichment (BigDataCorp por baixo). Sincrono sob /big-data/enrichment/*.
// Path configuravel por env caso a conta use outra rota.
const DEFAULT_ENRICHMENT_PATH = "/big-data/enrichment";
// O MOST consulta por QUERY nomeada (CARELI_PF_01 = dados cadastrais rapidos de
// pessoa fisica), que ja empacota os datasets contratados. Configuravel por env.
// CARELI_PF_02/03 (certidoes/GOLD) e CARELI_PJ_01 (empresa) sao para etapas
// futuras.
const DEFAULT_ENRICHMENT_QUERY = "CARELI_PF_01";
// A doc do MOST (user/authenticate) manda a client key no campo "token";
// a resposta tambem volta em "token".
const DEFAULT_AUTH_KEY_FIELD = "token";

function env(name: string): string {
  return (process.env[name] ?? "").trim();
}

function config() {
  const baseUrl = env("MOSTQI_BASE_URL") || DEFAULT_BASE_URL;
  return {
    authKeyField: env("MOSTQI_AUTH_KEY_FIELD") || DEFAULT_AUTH_KEY_FIELD,
    authPath: env("MOSTQI_AUTH_PATH") || DEFAULT_AUTH_PATH,
    baseUrl,
    clientKey: env("MOSTQI_CLIENT_KEY"),
    enrichmentPath: env("MOSTQI_ENRICHMENT_PATH") || DEFAULT_ENRICHMENT_PATH,
    enrichmentQuery: env("MOSTQI_ENRICHMENT_QUERY") || DEFAULT_ENRICHMENT_QUERY,
    extractionPath: env("MOSTQI_EXTRACTION_PATH") || DEFAULT_EXTRACTION_PATH,
  };
}

export function isMostqiConfigured(): boolean {
  return Boolean(config().clientKey);
}

// Em producao o app chama o MOST atraves do proxy de IP fixo (VPS), que exige
// uma senha no cabecalho X-Proxy-Secret. Fora do proxy (POC direto), a env fica
// vazia e o header nao e enviado. O valor nunca e logado.
function proxyHeaders(): Record<string, string> {
  const secret = env("MOSTQI_PROXY_SECRET");
  return secret ? { "X-Proxy-Secret": secret } : {};
}

export type MostqiStatus = {
  authPath: string;
  baseUrl: string;
  clientKeyPresent: boolean;
  environment: "producao" | "homologacao";
  extractionPath: string;
  mode: "live" | "mock";
};

// Status seguro para exibir na tela (nunca inclui a chave nem o token).
export function getMostqiStatus(): MostqiStatus {
  const cfg = config();
  const configured = Boolean(cfg.clientKey);

  return {
    authPath: cfg.authPath,
    baseUrl: cfg.baseUrl,
    clientKeyPresent: configured,
    environment:
      cfg.baseUrl.includes("mostqiapi.com") && !cfg.baseUrl.includes("production")
        ? "homologacao"
        : "producao",
    extractionPath: cfg.extractionPath,
    mode: configured ? "live" : "mock",
  };
}

export class MostqiError extends Error {
  status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = "MostqiError";
    this.status = status;
  }
}

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;
}

// A doc nao fixa o campo do token; procuramos os nomes usuais sem vazar nada.
function pickToken(payload: unknown): string {
  const root = asRecord(payload);
  if (!root) return typeof payload === "string" ? payload : "";

  const candidates: unknown[] = [
    root.token,
    root.jwt,
    root.accessToken,
    root.access_token,
    root.bearer,
    root.result,
    asRecord(root.result)?.token,
    asRecord(root.result)?.jwt,
    asRecord(root.data)?.token,
    asRecord(root.data)?.jwt,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.length > 0) {
      return candidate;
    }
  }

  return "";
}

// Recorta a resposta de erro do MOST para exibir sem nunca ecoar a client key.
function safeSnippet(text: string, clientKey: string): string {
  let out = (text ?? "").replace(/\s+/g, " ").trim().slice(0, 300);
  if (clientKey) out = out.split(clientKey).join("***");
  return out;
}

// A doc diz "client key no corpo", mas nao fixa o nome do campo. Tentamos o
// campo configurado (env) primeiro e caimos nos nomes usuais. Assim um 400 por
// nome de campo se resolve sozinho, sem novo deploy.
function authBodyCandidates(clientKey: string, preferredField: string) {
  const fields = [preferredField, "key", "clientKey", "apiKey", "client_key", "token"];
  const seen = new Set<string>();
  const bodies: Record<string, string>[] = [];
  for (const field of fields) {
    if (!field || seen.has(field)) continue;
    seen.add(field);
    bodies.push({ [field]: clientKey });
  }
  return bodies;
}

// Autentica com a client key e devolve o JWT temporario (nunca logado).
export async function authenticateMostqi(): Promise<string> {
  const cfg = config();

  if (!cfg.clientKey) {
    throw new MostqiError("MOSTQI_CLIENT_KEY nao configurada.", 412);
  }

  let lastStatus = 0;
  let lastBody = "";

  for (const body of authBodyCandidates(cfg.clientKey, cfg.authKeyField)) {
    let response: Response;
    try {
      response = await fetch(`${cfg.baseUrl}${cfg.authPath}`, {
        body: JSON.stringify(body),
        cache: "no-store",
        headers: { "Content-Type": "application/json", ...proxyHeaders() },
        method: "POST",
      });
    } catch (error) {
      throw new MostqiError(
        `Falha de rede ao autenticar no MOSTQI: ${(error as Error).message}`,
      );
    }

    const text = await response.text().catch(() => "");
    let payload: unknown = text;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      payload = text;
    }

    if (response.ok) {
      const token = pickToken(payload);
      if (token) return token;
    }

    lastStatus = response.status;
    lastBody = safeSnippet(text, cfg.clientKey);

    // 401/403 = chave invalida: trocar o nome do campo nao resolve, para aqui.
    if (response.status === 401 || response.status === 403) break;
  }

  throw new MostqiError(
    `Autenticacao MOSTQI recusada (HTTP ${lastStatus || 502})${
      lastBody ? `: ${lastBody}` : "."
    }`,
    lastStatus || 502,
  );
}

// ---------- normalizacao da extracao para o cadastro ----------

export type CadastroField = {
  confidence: number | null;
  key: string;
  label: string;
  value: string;
};

export type CadastroDraft = {
  bairro: string;
  cep: string;
  cidade: string;
  cpf: string;
  dataNascimento: string;
  logradouro: string;
  naturalidade: string;
  nome: string;
  nomeMae: string;
  nomePai: string;
  numero: string;
  orgaoEmissor: string;
  rg: string;
  uf: string;
};

export type DocumentExtraction = {
  cadastro: CadastroDraft;
  documentType: string;
  fields: CadastroField[];
  overallConfidence: number | null;
  raw?: unknown;
  source: "mock" | "mostqi";
  stdType: string;
  warnings: string[];
};

function emptyCadastro(): CadastroDraft {
  return {
    bairro: "",
    cep: "",
    cidade: "",
    cpf: "",
    dataNascimento: "",
    logradouro: "",
    naturalidade: "",
    nome: "",
    nomeMae: "",
    nomePai: "",
    numero: "",
    orgaoEmissor: "",
    rg: "",
    uf: "",
  };
}

function normalizeKey(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// Percorre a resposta do MOSTQI e coleta qualquer par {nome/label, valor,
// score}. A doc entrega campos por tipo de documento (catalogo mostqi_types_
// fields), entao mantemos o coletor tolerante a variacoes de formato.
function collectFields(node: unknown, out: CadastroField[], seen: Set<unknown>) {
  if (!node || typeof node !== "object" || seen.has(node)) return;
  seen.add(node);

  if (Array.isArray(node)) {
    for (const item of node) collectFields(item, out, seen);
    return;
  }

  const record = node as JsonRecord;
  const nameRaw =
    (typeof record.name === "string" && record.name) ||
    (typeof record.label === "string" && record.label) ||
    (typeof record.key === "string" && record.key) ||
    (typeof record.field === "string" && record.field) ||
    "";
  const valueRaw =
    typeof record.value === "string"
      ? record.value
      : typeof record.text === "string"
        ? record.text
        : typeof record.content === "string"
          ? record.content
          : "";

  if (nameRaw && valueRaw) {
    const scoreRaw =
      typeof record.score === "number"
        ? record.score
        : typeof record.confidence === "number"
          ? record.confidence
          : null;
    out.push({
      confidence: scoreRaw,
      key: normalizeKey(nameRaw),
      label: nameRaw,
      value: valueRaw,
    });
  }

  for (const value of Object.values(record)) {
    if (value && typeof value === "object") collectFields(value, out, seen);
  }
}

// Dicionario de sinonimos: aponta cada campo do cadastro para os nomes que o
// MOSTQI costuma usar (RG/CNH/comprovante). Casamos por "contem".
const FIELD_MATCHERS: Array<{ target: keyof CadastroDraft; needles: string[] }> = [
  { needles: ["nome-mae", "filiacao-mae", "mae"], target: "nomeMae" },
  { needles: ["nome-pai", "filiacao-pai", "pai"], target: "nomePai" },
  { needles: ["nome-social", "nome-completo", "nome", "titular"], target: "nome" },
  { needles: ["cpf"], target: "cpf" },
  { needles: ["registro-geral", "rg", "identidade", "doc-identidade"], target: "rg" },
  { needles: ["data-nascimento", "nascimento", "data-nasc", "dt-nascimento"], target: "dataNascimento" },
  { needles: ["orgao-emissor", "orgao-expedidor", "emissor", "expedidor"], target: "orgaoEmissor" },
  { needles: ["naturalidade", "natural"], target: "naturalidade" },
  { needles: ["logradouro", "endereco", "rua", "avenida"], target: "logradouro" },
  { needles: ["numero", "num", "nro"], target: "numero" },
  { needles: ["bairro"], target: "bairro" },
  { needles: ["municipio", "cidade", "localidade"], target: "cidade" },
  { needles: ["uf", "estado"], target: "uf" },
  { needles: ["cep", "codigo-postal"], target: "cep" },
];

// Pontua o quanto uma chave casa com um sinonimo: exato > token isolado >
// substring (so p/ sinonimos com hifen). Evita falsos positivos como "orgao"
// casar com "rg" (o-RG-ao) ou "estado-emissao" virar UF.
function keyScore(key: string, needle: string): number {
  if (key === needle) return 3;
  const tokens = key.split("-");
  if (tokens.includes(needle)) return 2;
  if (needle.includes("-") && key.includes(needle)) return 1;
  return 0;
}

function mapCadastro(fields: CadastroField[]): CadastroDraft {
  const draft = emptyCadastro();

  for (const matcher of FIELD_MATCHERS) {
    let best: CadastroField | null = null;
    let bestScore = 0;
    for (const field of fields) {
      if (!field.value) continue;
      for (const needle of matcher.needles) {
        const score = keyScore(field.key, needle);
        if (score > bestScore) {
          bestScore = score;
          best = field;
        }
      }
    }
    if (best) draft[matcher.target] = best.value;
  }

  return draft;
}

export function normalizeExtraction(
  payload: unknown,
  options: { includeRaw?: boolean } = {},
): DocumentExtraction {
  const warnings: string[] = [];
  const fields: CadastroField[] = [];
  collectFields(payload, fields, new Set());

  const root = asRecord(payload);
  const resultArray = Array.isArray(root?.result)
    ? (root?.result as unknown[])
    : root?.result
      ? [root.result]
      : [];
  const first = asRecord(resultArray[0]);
  const documentType =
    (typeof first?.type === "string" && first.type) || "desconhecido";
  const stdType = (typeof first?.stdType === "string" && first.stdType) || "";

  const scores = fields
    .map((field) => field.confidence)
    .filter((score): score is number => typeof score === "number");
  const overallConfidence = scores.length
    ? scores.reduce((total, score) => total + score, 0) / scores.length
    : null;

  if (!fields.length) {
    warnings.push("Nenhum campo reconhecido na resposta do MOSTQI.");
  }

  return {
    cadastro: mapCadastro(fields),
    documentType,
    fields,
    overallConfidence,
    raw: options.includeRaw ? payload : undefined,
    source: "mostqi",
    stdType,
    warnings,
  };
}

// ---------- extracao ----------

type ExtractInput = {
  fileBase64?: string;
  fileName?: string;
  fileUrl?: string;
  includeRaw?: boolean;
  returnCrops?: boolean;
  returnImage?: boolean;
  returnMetadata?: boolean;
  tags?: string[];
};

async function callExtraction(
  token: string,
  input: ExtractInput,
): Promise<Response> {
  const cfg = config();
  const body: JsonRecord = {
    returnCrops: Boolean(input.returnCrops),
    returnImage: Boolean(input.returnImage),
    returnMetadata: Boolean(input.returnMetadata),
  };
  if (input.fileBase64) body.fileBase64 = input.fileBase64;
  if (input.fileUrl) body.fileUrl = input.fileUrl;
  if (input.tags?.length) body.tags = input.tags;

  return fetch(`${cfg.baseUrl}${cfg.extractionPath}`, {
    body: JSON.stringify(body),
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...proxyHeaders(),
    },
    method: "POST",
  });
}

export async function extractDocument(
  input: ExtractInput,
): Promise<DocumentExtraction> {
  if (!isMostqiConfigured()) {
    return mockExtraction(input.includeRaw);
  }

  if (!input.fileBase64 && !input.fileUrl) {
    throw new MostqiError("Envie fileBase64 ou fileUrl para extrair.", 400);
  }

  // Token temporario de uso unico: pega um fresco por operacao; se a extracao
  // recusar por token morto (401), reautentica uma vez e refaz.
  let token = await authenticateMostqi();
  let response = await callExtraction(token, input);

  if (response.status === 401) {
    token = await authenticateMostqi();
    response = await callExtraction(token, input);
  }

  const text = await response.text().catch(() => "");
  let payload: unknown = text;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = text;
  }

  if (!response.ok) {
    const snippet = safeSnippet(text, config().clientKey);
    throw new MostqiError(
      `Extracao MOSTQI falhou (HTTP ${response.status})${snippet ? `: ${snippet}` : "."}`,
      response.status,
    );
  }

  return normalizeExtraction(payload, { includeRaw: input.includeRaw });
}

// ---------- modo simulado ----------

export function mockExtraction(includeRaw = false): DocumentExtraction {
  const fields: CadastroField[] = [
    { confidence: 0.98, key: "nome", label: "Nome", value: "MARIA APARECIDA DA SILVA" },
    { confidence: 0.97, key: "cpf", label: "CPF", value: "123.456.789-09" },
    { confidence: 0.94, key: "registro-geral", label: "Registro Geral", value: "12.345.678-9" },
    { confidence: 0.96, key: "data-nascimento", label: "Data de Nascimento", value: "12/03/1985" },
    { confidence: 0.92, key: "filiacao-mae", label: "Filiacao (Mae)", value: "JOANA MARIA DA SILVA" },
    { confidence: 0.9, key: "filiacao-pai", label: "Filiacao (Pai)", value: "JOSE CARLOS DA SILVA" },
    { confidence: 0.88, key: "orgao-emissor", label: "Orgao Emissor", value: "SSP/GO" },
    { confidence: 0.86, key: "naturalidade", label: "Naturalidade", value: "GOIANIA/GO" },
  ];

  const raw = {
    elapsedMilliseconds: 0,
    requestId: "mock-request",
    result: [{ fields, stdType: "identity-document", tags: ["id=bra-rg"], type: "rg" }],
    status: { code: "200", message: "Ok (simulado)" },
  };

  return {
    cadastro: mapCadastro(fields),
    documentType: "rg",
    fields,
    overallConfidence: 0.925,
    raw: includeRaw ? raw : undefined,
    source: "mock",
    stdType: "identity-document",
    warnings: [
      "Modo simulado: preencha MOSTQI_CLIENT_KEY para chamar o MOSTQI de verdade.",
    ],
  };
}

// ---------- enrichment (dados cadastrais por CPF) ----------

// Certidao/documento oficial devolvido pela consulta (antecedentes, nada
// consta, CND, situacao RF, sancoes, processos, KYC...).
export type Certidao = {
  conteudo: string;
  emissao: string;
  status: string;
  tipo: string; // pdf | html | dados
  titulo: string;
  tone: "bom" | "atencao" | "neutro";
  url: string;
  validade: string;
};

export type EnrichmentResult = {
  available: boolean;
  certidoes: Certidao[];
  conjuge: string;
  emails: string[];
  enderecos: string[];
  estadoCivil: string;
  nomeMae: string;
  nomePai: string;
  obito: boolean;
  patrimonio: string;
  profissao: string;
  raw?: unknown;
  renda: string;
  sexo: string;
  source: "mock" | "mostqi" | "unavailable";
  telefones: string[];
  warnings: string[];
};

function emptyEnrichment(
  source: EnrichmentResult["source"],
  warnings: string[],
): EnrichmentResult {
  return {
    available: source === "mostqi" || source === "mock",
    certidoes: [],
    conjuge: "",
    emails: [],
    enderecos: [],
    estadoCivil: "",
    nomeMae: "",
    nomePai: "",
    obito: false,
    patrimonio: "",
    profissao: "",
    renda: "",
    sexo: "",
    source,
    telefones: [],
    warnings,
  };
}

// Helpers p/ ler a resposta do MOST (BigDataCorp): datasets[] -> data[0] -> obj.
function str(value: unknown): string {
  if (value === null || value === undefined) return "";
  return typeof value === "string" ? value : String(value);
}

function datasetPayload(datasets: unknown[], name: string): JsonRecord | null {
  for (const entry of datasets) {
    const record = asRecord(entry);
    if (record?.name === name) {
      const data = record.data;
      const first = Array.isArray(data) ? data[0] : data;
      return asRecord(first);
    }
  }
  return null;
}

// Titulos amigaveis por dataset de certidao.
const CERTIDAO_TITULOS: Record<string, string> = {
  ondemand_administrative_sanctions: "Sancoes Administrativas (BACEN)",
  ondemand_cert_labor_debt_absence: "CND Trabalhista",
  ondemand_comprot_processes: "Processos COMPROT",
  ondemand_nada_consta: "Nada Consta Criminal (Justica Federal)",
  ondemand_pf_antecedente: "Antecedentes Criminais (Policia Federal)",
  ondemand_rf_status: "Situacao na Receita Federal",
};

function certidaoTone(status: string): Certidao["tone"] {
  const s = status.toUpperCase();
  if (/(NADA CONSTA|NAO CONSTA|NEGATIVA|REGULAR|FALSE)/.test(s)) return "bom";
  if (/(CONSTA|POSITIVA|IRREGULAR|PENDENTE|SUSPENSA|TRUE)/.test(s)) return "atencao";
  return "neutro";
}

// Extrai as certidoes/documentos oficiais dos datasets on-demand.
function extractCertidoes(datasets: unknown[]): Certidao[] {
  const certidoes: Certidao[] = [];

  for (const entry of datasets) {
    const record = asRecord(entry);
    const name = str(record?.name);
    const titulo = CERTIDAO_TITULOS[name];
    if (!titulo || record?.status !== "DONE") continue;

    const first = asRecord(Array.isArray(record?.data) ? (record?.data as unknown[])[0] : record?.data);
    const online = Array.isArray(first?.onlineCertificates)
      ? (first?.onlineCertificates as unknown[])
      : [];

    for (const cert of online) {
      const c = asRecord(cert);
      const extra = asRecord(c?.additionalOutputData);
      const status =
        str(c?.baseStatus) || str(extra?.status) || str(extra?.isInDebt && "NAO CONSTA");
      const url = str(extra?.rawResultFile);
      const conteudo =
        str(extra?.certificateText) ||
        str(extra?.content) ||
        str(extra?.rawCertificateText) ||
        "";
      certidoes.push({
        conteudo,
        emissao: str(extra?.emissionDate) || str(extra?.certificateIssuedDate) || "",
        status: status || "consultado",
        tipo: str(extra?.rawResultFileType) || (url ? "documento" : "dados"),
        titulo,
        tone: certidaoTone(status),
        url,
        validade: str(extra?.validUntil) || str(extra?.certificateValidUntil) || str(extra?.expiration) || "",
      });
    }
  }

  return certidoes;
}

// Le a resposta do MOST na estrutura real (mapeada da resposta crua 8/jul).
function normalizeEnrichment(payload: unknown, includeRaw: boolean): EnrichmentResult {
  const result = emptyEnrichment("mostqi", []);
  const root = asRecord(payload);
  const resultObj = asRecord(root?.result);
  const datasets = Array.isArray(resultObj?.datasets)
    ? (resultObj?.datasets as unknown[])
    : [];

  // Dados cadastrais basicos: nome mae/pai, estado civil, sexo, obito.
  const basic = asRecord(datasetPayload(datasets, "basic_data")?.basicData);
  if (basic) {
    result.nomeMae = str(basic.motherName);
    result.nomePai = str(basic.fatherName);
    result.estadoCivil = str(asRecord(basic.maritalStatusData)?.maritalStatus);
    // Sexo/genero: BigDataCorp costuma usar "gender" (M/F); tentamos variantes.
    result.sexo = str(basic.gender) || str(basic.sex) || str(basic.genero);
    result.obito = basic.hasObitIndication === true;
  }

  // Telefones estendidos: "(DDD) numero".
  const phones = asRecord(datasetPayload(datasets, "phones_extended")?.extendedPhones);
  const phoneList = Array.isArray(phones?.phones) ? (phones?.phones as unknown[]) : [];
  result.telefones = phoneList
    .slice(0, 5)
    .map((item) => {
      const phone = asRecord(item);
      const area = str(phone?.areaCode);
      const num = str(phone?.number);
      return num ? (area ? `(${area}) ${num}` : num) : "";
    })
    .filter(Boolean);

  // Enderecos estendidos.
  const addresses = asRecord(datasetPayload(datasets, "addresses_extended")?.extendedAddresses);
  const addrList = Array.isArray(addresses?.addresses) ? (addresses?.addresses as unknown[]) : [];
  result.enderecos = addrList
    .slice(0, 5)
    .map((item) => {
      const a = asRecord(item);
      return [
        str(a?.addressMain),
        str(a?.number),
        str(a?.neighborhood),
        str(a?.city),
        str(a?.state),
        str(a?.zipCode),
      ]
        .filter(Boolean)
        .join(", ");
    })
    .filter(Boolean);

  // Renda estimada (financial_data) + patrimonio.
  const fin = asRecord(datasetPayload(datasets, "financial_data")?.finantialData);
  const income = asRecord(fin?.incomeEstimates);
  const faixaRenda =
    str(income?.bigdatA_V2) ||
    str(income?.bigdata) ||
    str(income?.mte) ||
    str(income?.ibge);
  const patrimonio = str(fin?.totalAssets);
  result.renda = faixaRenda && faixaRenda !== "SEM INFORMACAO" ? faixaRenda : "";
  result.patrimonio = patrimonio && patrimonio !== "SEM INFORMACAO" ? patrimonio : "";

  // Profissao/setor: melhor esforco a partir do vinculo ativo (occupation_data).
  const occ = asRecord(datasetPayload(datasets, "occupation_data")?.professionData);
  const professions = Array.isArray(occ?.professions)
    ? (occ?.professions as unknown[])
    : [];
  const active =
    professions.map(asRecord).find((p) => p?.status === "ACTIVE") ??
    asRecord(professions[0]);
  if (active) {
    const sector = str(active.sector); // "PRIVATE - 4693100 - COMERCIO ..."
    result.profissao = sector.split(" - ").slice(2).join(" - ") || str(active.level);
  }

  result.certidoes = extractCertidoes(datasets);

  if (includeRaw) result.raw = payload;
  return result;
}

// A rota sincrona do enrichment nao esta na doc publica (SPA). Tentamos os
// caminhos provaveis e ficamos no primeiro que responde (auto-descoberta),
// guardando o vencedor em memoria do modulo.
let cachedEnrichmentPath = "";

function enrichmentPathCandidates(configuredPath: string): string[] {
  return Array.from(
    new Set(
      [
        cachedEnrichmentPath,
        configuredPath,
        "/big-data/enrichment",
        "/big-data/enrichment/sync",
        "/big-data/enrichment/query",
        "/big-data/enrichment/on-demand",
      ].filter(Boolean),
    ),
  );
}

function isInvalidRoute(status: number, body: string): boolean {
  return status === 404 || /invalid route|r118|rota invalida/i.test(body);
}

async function callEnrichment(
  token: string,
  path: string,
  cpf: string,
  datasets?: string[],
): Promise<Response> {
  const cfg = config();
  // MOST consulta por query nomeada + parametros num objeto "parameters".
  // Se datasets vier, tentamos subsetar a consulta pelo nosso lado (experimento
  // p/ ver se da p/ escolher os datasets sem criar query nova no MOST).
  const body: JsonRecord = { parameters: { cpf }, query: cfg.enrichmentQuery };
  if (datasets && datasets.length) body.datasets = datasets;
  return fetch(`${cfg.baseUrl}${path}`, {
    body: JSON.stringify(body),
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...proxyHeaders(),
    },
    method: "POST",
  });
}

// Enriquece por CPF. Best-effort: se a rota divergir ou o dataset nao estiver
// contratado, NAO quebra o cadastro — devolve available:false + o motivo real.
export async function enrichPerson(
  cpf: string,
  opts: { datasets?: string[]; includeRaw?: boolean } = {},
): Promise<EnrichmentResult> {
  const digits = (cpf || "").replace(/\D/g, "");
  if (!isMostqiConfigured()) return mockEnrichment(opts.includeRaw);
  if (digits.length !== 11) {
    return emptyEnrichment("unavailable", ["CPF ausente ou invalido para enriquecer."]);
  }

  const cfg = config();
  let lastMsg = "";
  try {
    for (const path of enrichmentPathCandidates(cfg.enrichmentPath)) {
      let token = await authenticateMostqi();
      let response = await callEnrichment(token, path, digits, opts.datasets);
      if (response.status === 401) {
        token = await authenticateMostqi();
        response = await callEnrichment(token, path, digits, opts.datasets);
      }
      const text = await response.text().catch(() => "");

      if (isInvalidRoute(response.status, text)) {
        lastMsg = `${path} -> HTTP ${response.status}`;
        continue; // caminho errado, tenta o proximo
      }

      cachedEnrichmentPath = path; // rota valida encontrada
      let payload: unknown = text;
      try {
        payload = text ? JSON.parse(text) : null;
      } catch {
        payload = text;
      }
      if (!response.ok) {
        const snippet = safeSnippet(text, cfg.clientKey);
        return emptyEnrichment("unavailable", [
          `Enrichment recusou em ${path} (HTTP ${response.status})${snippet ? `: ${snippet}` : ""}.`,
        ]);
      }
      return normalizeEnrichment(payload, Boolean(opts.includeRaw));
    }
    return emptyEnrichment("unavailable", [
      `Rota de enrichment nao encontrada (todas deram invalid route; ultima: ${lastMsg}). Confirmar endpoint com o MOST.`,
    ]);
  } catch (error) {
    return emptyEnrichment("unavailable", [
      `Enrichment falhou: ${(error as Error).message}`,
    ]);
  }
}

export function mockEnrichment(includeRaw = false): EnrichmentResult {
  const result = emptyEnrichment("mock", [
    "Enriquecimento simulado (sem MOSTQI_CLIENT_KEY).",
  ]);
  result.estadoCivil = "CASADO";
  result.conjuge = "CARLOS EDUARDO PACHECO";
  result.profissao = "ADVOGADA";
  result.renda = "R$ 8.000,00 a R$ 12.000,00 (estimada)";
  result.nomeMae = "JOANA MARIA DA SILVA";
  result.telefones = ["(31) 99999-0000", "(31) 3333-0000"];
  result.emails = ["cliente@exemplo.com.br"];
  result.enderecos = ["RUA DAS FLORES, 100 - CENTRO - BELO HORIZONTE/MG"];
  result.certidoes = [
    {
      conteudo: "A Policia Federal CERTIFICA que NAO CONSTA condenacao...",
      emissao: "08/07/2026",
      status: "NADA CONSTA",
      tipo: "pdf",
      titulo: "Antecedentes Criminais (Policia Federal)",
      tone: "bom",
      url: "",
      validade: "06/10/2026",
    },
    {
      conteudo: "CND Trabalhista: NAO CONSTA como inadimplente no BNDT.",
      emissao: "08/07/2026",
      status: "NAO CONSTA",
      tipo: "pdf",
      titulo: "CND Trabalhista",
      tone: "bom",
      url: "",
      validade: "04/01/2027",
    },
  ];
  if (includeRaw) result.raw = { mock: true };
  return result;
}
