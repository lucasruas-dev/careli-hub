// Comunicação com o Asaas pela conta da GURGEL (env ASAAS_GURGEL_API_KEY) — a que GERA os PIX da
// pré-venda. Conta SEPARADA da Careli (ASAAS_API_KEY, usada pelo Hades read-only): nunca misturar.
//
// Base URL em ASAAS_API_BASE_URL (host, sem /v3; o código concatena /v3 por chamada). Auth por
// header `access_token`. Ver [[project_asaas_prevenda]].

function baseUrl(): string {
  return (process.env.ASAAS_API_BASE_URL?.trim() || "https://api.asaas.com").replace(/\/+$/, "");
}

function chaveGurgel(): string | null {
  return process.env.ASAAS_GURGEL_API_KEY?.trim() || null;
}

export type AsaasResult<T> =
  | { data: T; ok: true }
  | { erro: string; ok: false; status: number };

async function asaasFetch<T>(
  path: string,
  init?: { body?: unknown; method?: string },
): Promise<AsaasResult<T>> {
  const key = chaveGurgel();
  if (!key) {
    return { erro: "ASAAS_GURGEL_API_KEY não configurada.", ok: false, status: 0 };
  }

  let res: Response;
  try {
    res = await fetch(`${baseUrl()}/v3${path}`, {
      // GET sem body (o Asaas dá 403 em GET com corpo, ex.: pixQrCode).
      body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "Careli Pre-venda",
        access_token: key,
      },
      method: init?.method ?? "GET",
    });
  } catch (e) {
    return { erro: (e as Error).message, ok: false, status: 0 };
  }

  const corpo = (await res.json().catch(() => null)) as
    | (T & { errors?: { code?: string; description?: string }[] })
    | null;

  if (!res.ok) {
    const erro = corpo?.errors?.[0]?.description || `HTTP ${res.status}`;
    return { erro, ok: false, status: res.status };
  }
  return { data: corpo as T, ok: true };
}

// Dados da conta (confirma que a chave é da Gurgel e está válida).
export type AsaasMyAccount = { companyName?: string; email?: string; name?: string };
export function asaasMyAccount(): Promise<AsaasResult<AsaasMyAccount>> {
  return asaasFetch<AsaasMyAccount>("/myAccount");
}

export type AsaasCliente = { id: string; name?: string };
export function criarClienteAsaas(input: {
  cpfCnpj: string;
  email?: string;
  externalReference?: string;
  nome: string;
}): Promise<AsaasResult<AsaasCliente>> {
  return asaasFetch<AsaasCliente>("/customers", {
    body: {
      cpfCnpj: input.cpfCnpj.replace(/\D/g, ""),
      email: input.email,
      externalReference: input.externalReference,
      name: input.nome,
    },
    method: "POST",
  });
}

// Detalhe do cliente (o webhook só traz o id do customer; é por aqui que chegamos no CPF/contato).
export type AsaasClienteDetalhe = {
  cpfCnpj?: string;
  email?: string;
  mobilePhone?: string;
  name?: string;
  phone?: string;
};
export function consultarClienteAsaas(
  customerId: string,
): Promise<AsaasResult<AsaasClienteDetalhe>> {
  return asaasFetch<AsaasClienteDetalhe>(`/customers/${encodeURIComponent(customerId)}`);
}

export type AsaasCobranca = {
  billingType: string;
  dateCreated?: string;
  // "Pré-venda - Empreendimento {nome}. ..." — usado pra cancelar SÓ o lançamento certo.
  description?: string;
  dueDate: string;
  id: string;
  invoiceUrl?: string;
  status: string;
  value: number;
};
export function criarCobrancaPix(input: {
  customer: string;
  descricao?: string;
  externalReference?: string;
  valor: number;
  vencimento: string; // yyyy-mm-dd
}): Promise<AsaasResult<AsaasCobranca>> {
  return asaasFetch<AsaasCobranca>("/payments", {
    body: {
      billingType: "PIX",
      customer: input.customer,
      description: input.descricao,
      dueDate: input.vencimento,
      externalReference: input.externalReference,
      value: input.valor,
    },
    method: "POST",
  });
}

// QR Code PIX (chamada SEPARADA da criação). Devolve a imagem base64, o copia-e-cola e a expiração
// — o expirationDate é o que denuncia se a conta tem chave PIX própria (senão expira no mesmo dia).
export type AsaasPixQrCode = { encodedImage: string; expirationDate: string; payload: string };
export function obterQrCodePix(paymentId: string): Promise<AsaasResult<AsaasPixQrCode>> {
  return asaasFetch<AsaasPixQrCode>(`/payments/${encodeURIComponent(paymentId)}/pixQrCode`);
}

export function consultarCobranca(paymentId: string): Promise<AsaasResult<AsaasCobranca>> {
  return asaasFetch<AsaasCobranca>(`/payments/${encodeURIComponent(paymentId)}`);
}

// Lista cobranças por status (paginado). Usado para achar as PENDENTES/VENCIDAS a cancelar.
// O Asaas devolve { data, totalCount, hasMore, limit, offset }.
export type AsaasListagem = {
  data: AsaasCobranca[];
  hasMore: boolean;
  limit: number;
  offset: number;
  totalCount: number;
};
export function listarCobrancas(params: {
  limit?: number;
  offset?: number;
  status?: string;
}): Promise<AsaasResult<AsaasListagem>> {
  const q = new URLSearchParams();
  if (params.status) q.set("status", params.status);
  q.set("limit", String(params.limit ?? 100));
  q.set("offset", String(params.offset ?? 0));

  return asaasFetch<AsaasListagem>(`/payments?${q.toString()}`);
}

// CANCELA (remove) uma cobrança. O Asaas só permite deletar cobrança NÃO paga — uma paga
// (RECEIVED/CONFIRMED) é recusada pela própria API, então isto nunca apaga dinheiro recebido.
export type AsaasDelete = { deleted?: boolean; id?: string };
export function cancelarCobranca(paymentId: string): Promise<AsaasResult<AsaasDelete>> {
  return asaasFetch<AsaasDelete>(`/payments/${encodeURIComponent(paymentId)}`, {
    method: "DELETE",
  });
}
