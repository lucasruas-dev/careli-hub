// Sessão do corretor no formulário PÚBLICO de CAD (sem login).
//
// POR QUE UM TOKEN ASSINADO E NÃO UM ID SOLTO: o formulário é anônimo, então quem envia a CAD
// não tem usuário no `hub_users`. A autorização aqui é POR POSSE DE DADO (CPF cadastrado +
// CNPJ credenciado), e o token é o comprovante de que a antessala foi vencida no SERVIDOR.
// O vínculo da CAD (corretor + imobiliária + empreendimento) sai DAQUI, nunca do corpo que o
// browser manda: sem isso, um anônimo escolheria em que imobiliária a CAD nasce vinculada.
//
// POR QUE NÃO COOKIE: cookie viaja sozinho (CSRF) e persiste num celular emprestado. O token
// vai no corpo/header e o cliente guarda em `sessionStorage`, que morre ao fechar a aba.
//
// HS256 na mão com node:crypto de propósito: uma dependência nova para assinar 200 bytes não
// se justifica, e o formato é o mesmo JWT de sempre.
import { createHmac, timingSafeEqual } from "node:crypto";

// 90 min (era 45): o fluxo parte do corretor JÁ com os documentos em mãos (premissa do Lucas,
// 03/08), então não precisa de horas — mas 45 min expirava no meio de preenchimento real e o
// Enviar morria com tudo digitado (achado da revisão de 03/08). 90 min é o dobro folgado de um
// preenchimento caprichado, e o token segue curto o bastante para não virar acesso permanente
// (morre ao fechar a aba; só serve para o próprio formulário).
export const SESSAO_TTL_SEGUNDOS = 90 * 60;

export type SessaoCad = {
  // Entidade PF do corretor (papel 'corretor'). É o dono da CAD.
  // O e-mail é o DESEMPATE do corretor: o nome não serve como chave (dois Henriques de
  // imobiliárias diferentes viram o mesmo texto). É o que a coluna `corretor_email` da 0060
  // existe para guardar.
  corretorEmail: string;
  corretorEntityId: string;
  corretorNome: string;
  // Empreendimentos que a imobiliária está habilitada a trabalhar (ids do C2X).
  enterpriseIds: string[];
  // Empreendimento ESCOLHIDO. Vazio até o corretor decidir (ou até o "só um" pular a escolha).
  enterpriseId?: string;
  imobiliariaEntityId: string;
  imobiliariaNome: string;
  // Identificador da sessão, gravado no source_link: é a trilha de quem enviou.
  sessaoId: string;
};

type Payload = SessaoCad & { exp: number; iat: number };

function segredo(): string | null {
  return process.env.SESSAO_CAD_SECRET?.trim() || null;
}

function b64url(buffer: Buffer): string {
  return buffer.toString("base64url");
}

function assinar(conteudo: string, chave: string): string {
  return b64url(createHmac("sha256", chave).update(conteudo).digest());
}

export type EmitirResultado =
  | { ok: false; error: string }
  | { ok: true; token: string };

export function emitirSessao(sessao: SessaoCad): EmitirResultado {
  const chave = segredo();
  if (!chave) {
    // Falha FECHADA de propósito. Sem segredo não há como distinguir sessão legítima de
    // forjada, e esta é uma rota anônima: emitir um token não verificável seria pior que
    // recusar o cadastro.
    return { error: "Assinatura de sessão indisponível.", ok: false };
  }

  const agora = Math.floor(Date.now() / 1000);
  const payload: Payload = { ...sessao, exp: agora + SESSAO_TTL_SEGUNDOS, iat: agora };
  const cabecalho = b64url(Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })));
  const corpo = b64url(Buffer.from(JSON.stringify(payload)));
  const conteudo = `${cabecalho}.${corpo}`;

  return { ok: true, token: `${conteudo}.${assinar(conteudo, chave)}` };
}

export type VerificarResultado =
  | { ok: false; error: string }
  | { ok: true; sessao: SessaoCad };

export function verificarSessao(token: string | null | undefined): VerificarResultado {
  const chave = segredo();
  if (!chave) return { error: "Assinatura de sessão indisponível.", ok: false };

  const bruto = String(token ?? "").trim();
  const partes = bruto.split(".");
  if (partes.length !== 3) return { error: "Sessão inválida.", ok: false };

  const [cabecalho, corpo, assinatura] = partes as [string, string, string];
  const esperada = assinar(`${cabecalho}.${corpo}`, chave);

  // Comparação em tempo constante: comparar com === vaza o prefixo correto pelo relógio.
  const a = Buffer.from(assinatura);
  const b = Buffer.from(esperada);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { error: "Sessão inválida.", ok: false };
  }

  let payload: Payload;
  try {
    payload = JSON.parse(Buffer.from(corpo, "base64url").toString("utf8")) as Payload;
  } catch {
    return { error: "Sessão inválida.", ok: false };
  }

  if (!payload?.exp || payload.exp < Math.floor(Date.now() / 1000)) {
    return { error: "Sessão expirada.", ok: false };
  }
  if (!payload.corretorEntityId || !payload.imobiliariaEntityId) {
    return { error: "Sessão inválida.", ok: false };
  }

  return {
    ok: true,
    sessao: {
      corretorEmail: payload.corretorEmail ?? "",
      corretorEntityId: payload.corretorEntityId,
      corretorNome: payload.corretorNome ?? "",
      enterpriseId: payload.enterpriseId,
      enterpriseIds: Array.isArray(payload.enterpriseIds) ? payload.enterpriseIds : [],
      imobiliariaEntityId: payload.imobiliariaEntityId,
      imobiliariaNome: payload.imobiliariaNome ?? "",
      sessaoId: payload.sessaoId ?? "",
    },
  };
}

// Lê a sessão do header. NUNCA da query string: o token identifica uma pessoa e query string
// entra em log de servidor, histórico e Referer.
export function sessaoDoRequest(request: Request): VerificarResultado {
  const header = request.headers.get("x-cad-sessao");
  return verificarSessao(header);
}

// ---------------------------------------------------------------------------
// Pré-sessão: o CNPJ passou, o corretor ainda não existe
// ---------------------------------------------------------------------------

// Entre S1 (CNPJ aprovado) e S4 (corretor criado) precisamos carregar a imobiliária resolvida
// SEM devolver o `entityId` dela ao browser: um id vazado vira handle para outra rota, e a
// resposta pública de CNPJ é justamente um oráculo de enumeração. Um token assinado carrega o
// id sem expô-lo, e é o servidor quem o lê de volta.
export type PreSessaoCad = {
  imobiliariaEntityId: string;
  imobiliariaNome: string;
};

type PrePayload = PreSessaoCad & { exp: number; pre: true };

export function emitirPreSessao(pre: PreSessaoCad): EmitirResultado {
  const chave = segredo();
  if (!chave) return { error: "Assinatura de sessão indisponível.", ok: false };

  const payload: PrePayload = {
    ...pre,
    exp: Math.floor(Date.now() / 1000) + SESSAO_TTL_SEGUNDOS,
    pre: true,
  };
  const cabecalho = b64url(Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })));
  const corpo = b64url(Buffer.from(JSON.stringify(payload)));
  const conteudo = `${cabecalho}.${corpo}`;
  return { ok: true, token: `${conteudo}.${assinar(conteudo, chave)}` };
}

export type VerificarPreResultado =
  | { ok: false; error: string }
  | { ok: true; pre: PreSessaoCad };

export function verificarPreSessao(token: string | null | undefined): VerificarPreResultado {
  const chave = segredo();
  if (!chave) return { error: "Assinatura de sessão indisponível.", ok: false };

  const partes = String(token ?? "").trim().split(".");
  if (partes.length !== 3) return { error: "Sessão inválida.", ok: false };

  const [cabecalho, corpo, assinatura] = partes as [string, string, string];
  const a = Buffer.from(assinatura);
  const b = Buffer.from(assinar(`${cabecalho}.${corpo}`, chave));
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { error: "Sessão inválida.", ok: false };
  }

  let payload: PrePayload;
  try {
    payload = JSON.parse(Buffer.from(corpo, "base64url").toString("utf8")) as PrePayload;
  } catch {
    return { error: "Sessão inválida.", ok: false };
  }

  // `pre` distingue os dois tokens: uma pré-sessão NUNCA pode ser aceita onde se espera uma
  // sessão completa (ela não tem corretor, e é o corretor que assina a CAD).
  if (payload?.pre !== true) return { error: "Sessão inválida.", ok: false };
  if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) {
    return { error: "Sessão expirada.", ok: false };
  }
  if (!payload.imobiliariaEntityId) return { error: "Sessão inválida.", ok: false };

  return {
    ok: true,
    pre: {
      imobiliariaEntityId: payload.imobiliariaEntityId,
      imobiliariaNome: payload.imobiliariaNome ?? "",
    },
  };
}

export function preSessaoDoRequest(request: Request): VerificarPreResultado {
  return verificarPreSessao(request.headers.get("x-cad-pre-sessao"));
}

// ---------------------------------------------------------------------------
// Pré-sessão da IMOBILIÁRIA: o CNPJ foi conferido na antessala, a imobiliária ainda NÃO existe
// ---------------------------------------------------------------------------
//
// POR QUE UMA PRÉ-SESSÃO PRÓPRIA: o auto-cadastro público de imobiliária reusa o CadastroFlow
// completo, que faz OCR do cartão CNPJ e `enrich-company` — DUAS torneiras PAGAS. A regra de
// ouro exige sessão para qualquer torneira paga, então antes de abrir o wizard a antessala
// confere o CNPJ (formato + que ele NÃO está já credenciado) e emite este token. Ele carrega
// SÓ o CNPJ conferido: a rota de salvamento rejeita se o `empresa.cnpj` do corpo divergir
// (anti-troca), e o OCR só roda com este token no header `x-cad-pre-sessao-imob`.
//
// O discriminante `preImob` impede que este token seja aceito onde se espera uma sessão de
// corretor (que carrega o vínculo) ou a pré-sessão do corretor (que carrega a imobiliária dele).
export type PreSessaoImob = {
  // Só dígitos do CNPJ conferido na antessala. É a chave anti-troca do /cadastro.
  cnpj: string;
};

type PreImobPayload = PreSessaoImob & { exp: number; preImob: true };

export function assinarPreSessaoImob(pre: PreSessaoImob): EmitirResultado {
  const chave = segredo();
  if (!chave) return { error: "Assinatura de sessão indisponível.", ok: false };

  const payload: PreImobPayload = {
    ...pre,
    exp: Math.floor(Date.now() / 1000) + SESSAO_TTL_SEGUNDOS,
    preImob: true,
  };
  const cabecalho = b64url(Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })));
  const corpo = b64url(Buffer.from(JSON.stringify(payload)));
  const conteudo = `${cabecalho}.${corpo}`;
  return { ok: true, token: `${conteudo}.${assinar(conteudo, chave)}` };
}

export type VerificarPreImobResultado =
  | { ok: false; error: string }
  | { ok: true; pre: PreSessaoImob };

export function verificarPreSessaoImob(
  token: string | null | undefined,
): VerificarPreImobResultado {
  const chave = segredo();
  if (!chave) return { error: "Assinatura de sessão indisponível.", ok: false };

  const partes = String(token ?? "").trim().split(".");
  if (partes.length !== 3) return { error: "Sessão inválida.", ok: false };

  const [cabecalho, corpo, assinatura] = partes as [string, string, string];
  const a = Buffer.from(assinatura);
  const b = Buffer.from(assinar(`${cabecalho}.${corpo}`, chave));
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { error: "Sessão inválida.", ok: false };
  }

  let payload: PreImobPayload;
  try {
    payload = JSON.parse(Buffer.from(corpo, "base64url").toString("utf8")) as PreImobPayload;
  } catch {
    return { error: "Sessão inválida.", ok: false };
  }

  // `preImob` isola este token dos outros dois: sessão de corretor e pré-sessão do corretor
  // NUNCA valem aqui, e vice-versa.
  if (payload?.preImob !== true) return { error: "Sessão inválida.", ok: false };
  if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) {
    return { error: "Sessão expirada.", ok: false };
  }
  const cnpj = String(payload.cnpj ?? "").replace(/\D/g, "");
  if (cnpj.length !== 14) return { error: "Sessão inválida.", ok: false };

  return { ok: true, pre: { cnpj } };
}

export function preSessaoImobDoRequest(request: Request): VerificarPreImobResultado {
  return verificarPreSessaoImob(request.headers.get("x-cad-pre-sessao-imob"));
}

// ---------------------------------------------------------------------------
// Dono da área de staging do upload direto de documento
// ---------------------------------------------------------------------------
//
// O documento GRANDE não cabe no corpo do POST, então sobe direto para o Storage por uma URL
// assinada (ver lib/apolo/documentos.ts). O caminho é escolhido pelo SERVIDOR e amarrado a quem
// pediu: na hora de salvar, a rota exige que o caminho comece pelo prefixo DESTE dono. Sem essa
// amarração, um corpo forjado apontaria a linha do documento para o arquivo de outra pessoa.
export function donoUploadSessao(sessao: SessaoCad): string {
  return `s-${sessao.sessaoId || sessao.corretorEntityId}`;
}

export function donoUploadPreImob(pre: PreSessaoImob): string {
  return `c-${pre.cnpj}`;
}

// Reemite a sessão com o empreendimento escolhido. O corretor pode enviar várias CADs na
// mesma sessão, trocando só esta parte.
export function comEmpreendimento(sessao: SessaoCad, enterpriseId: string): EmitirResultado {
  // A escolha só vale se o empreendimento estiver na lista habilitada que o SERVIDOR calculou.
  // Confiar no id que o cliente mandou seria deixar o corretor subir CAD em empreendimento
  // onde a imobiliária dele não está habilitada.
  if (!sessao.enterpriseIds.includes(enterpriseId)) {
    return { error: "Empreendimento não habilitado para esta imobiliária.", ok: false };
  }
  return emitirSessao({ ...sessao, enterpriseId });
}
