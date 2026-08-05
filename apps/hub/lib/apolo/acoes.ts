import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

// AÇÕES DE CONTATO EM MASSA (campanhas). Camada de dados compartilhada pela aba Ações (Iris, login
// do hub) e pela tela pública (freela com senha). Ambas leem/escrevem as mesmas tabelas
// (apolo_acoes / apolo_acao_alvos) SEMPRE pelo servidor — as tabelas têm RLS deny-all.
//
// O contato tem dois canais: 'telefonico' (falou → o operador preenche perfil + unidades na hora)
// e 'whatsapp' (não falou → dispara o template; a resposta das unidades volta pelo botão, gravada
// pela Cacá). Ver [[project_apolo_acao_contato]] no diário.

export type ContatoCanal = "telefonico" | "whatsapp";
export type Perfil = "moradia" | "investimento";
export type UnidadesInteresse = "1" | "2_3" | "acima_3";

export type Acao = {
  empreendimento: string | null;
  id: string;
  nome: string;
  phoneNumberId: string | null;
  publicoSlug: string | null;
  status: string;
  templateMetaName: string | null;
};

export type AcaoAlvo = {
  contatoCanal: ContatoCanal | null;
  contatoEm: string | null;
  contatoPor: string | null;
  corretor: string | null;
  cpf: string | null;
  disparoEm: string | null;
  disparoErro: string | null;
  disparoStatus: string | null;
  entityId: string | null;
  id: string;
  imobiliaria: string | null;
  nome: string | null;
  perfil: Perfil | null;
  // Vem ao vivo do prometeu_credenciados (muda quando alguém paga), não é snapshot.
  pixPago: boolean;
  respostaEm: string | null;
  respostaTexto: string | null;
  telefone: string | null;
  unidadesInteresse: UnidadesInteresse | null;
  unidadesOrigem: string | null;
};

type AcaoRow = {
  empreendimento: string | null;
  id: string;
  nome: string;
  phone_number_id: string | null;
  publico_slug: string | null;
  status: string;
  template_meta_name: string | null;
};

type AlvoRow = {
  contato_canal: string | null;
  contato_em: string | null;
  contato_por: string | null;
  corretor: string | null;
  cpf: string | null;
  disparo_em: string | null;
  disparo_erro: string | null;
  disparo_status: string | null;
  entity_id: string | null;
  id: string;
  imobiliaria: string | null;
  nome: string | null;
  perfil: string | null;
  resposta_em: string | null;
  resposta_texto: string | null;
  telefone: string | null;
  unidades_interesse: string | null;
  unidades_origem: string | null;
};

function mapAcao(row: AcaoRow): Acao {
  return {
    empreendimento: row.empreendimento,
    id: row.id,
    nome: row.nome,
    phoneNumberId: row.phone_number_id,
    publicoSlug: row.publico_slug,
    status: row.status,
    templateMetaName: row.template_meta_name,
  };
}

function mapAlvo(row: AlvoRow, pixPago: boolean): AcaoAlvo {
  return {
    contatoCanal: (row.contato_canal as ContatoCanal | null) ?? null,
    contatoEm: row.contato_em,
    contatoPor: row.contato_por,
    corretor: row.corretor,
    cpf: row.cpf,
    disparoEm: row.disparo_em,
    disparoErro: row.disparo_erro,
    disparoStatus: row.disparo_status,
    entityId: row.entity_id,
    id: row.id,
    imobiliaria: row.imobiliaria,
    nome: row.nome,
    perfil: (row.perfil as Perfil | null) ?? null,
    pixPago,
    respostaEm: row.resposta_em,
    respostaTexto: row.resposta_texto,
    telefone: row.telefone,
    unidadesInteresse: (row.unidades_interesse as UnidadesInteresse | null) ?? null,
    unidadesOrigem: row.unidades_origem,
  };
}

const CAMPOS_ACAO =
  "id, nome, empreendimento, template_meta_name, phone_number_id, publico_slug, status";

export async function listarAcoes(client: SupabaseClient): Promise<Acao[]> {
  const { data } = await client
    .from("apolo_acoes")
    .select(CAMPOS_ACAO)
    .order("created_at", { ascending: false })
    .limit(200);
  return ((data ?? []) as AcaoRow[]).map(mapAcao);
}

export async function lerAcaoPorId(
  client: SupabaseClient,
  id: string,
): Promise<Acao | null> {
  const { data } = await client
    .from("apolo_acoes")
    .select(CAMPOS_ACAO)
    .eq("id", id)
    .maybeSingle<AcaoRow>();
  return data ? mapAcao(data) : null;
}

export async function lerAcaoPorSlug(
  client: SupabaseClient,
  slug: string,
): Promise<Acao | null> {
  const { data } = await client
    .from("apolo_acoes")
    .select(CAMPOS_ACAO)
    .eq("publico_slug", slug)
    .maybeSingle<AcaoRow>();
  return data ? mapAcao(data) : null;
}

// Lista os alvos da ação com o PIX ao vivo. Ordena por quem AINDA não foi contatado primeiro (o
// trabalho do dia), depois por nome.
export async function listarAlvos(
  client: SupabaseClient,
  acaoId: string,
): Promise<AcaoAlvo[]> {
  const { data } = await client
    .from("apolo_acao_alvos")
    .select(
      "id, entity_id, nome, telefone, cpf, imobiliaria, corretor, contato_canal, contato_em, contato_por, perfil, unidades_interesse, unidades_origem, disparo_em, disparo_status, disparo_erro, resposta_em, resposta_texto",
    )
    .eq("acao_id", acaoId)
    .order("nome", { ascending: true })
    .limit(5000);

  const alvos = (data ?? []) as AlvoRow[];

  // PIX ao vivo: pago_em do prometeu_credenciados por entity_id (em lotes para não estourar a URL).
  const ids = alvos
    .map((a) => a.entity_id)
    .filter((id): id is string => Boolean(id));
  const pixPorEntity = new Map<string, boolean>();
  for (let i = 0; i < ids.length; i += 200) {
    const { data: cred } = await client
      .from("prometeu_credenciados")
      .select("entity_id, pago_em")
      .in("entity_id", ids.slice(i, i + 200));
    for (const c of (cred ?? []) as { entity_id: string | null; pago_em: string | null }[]) {
      if (c.entity_id) pixPorEntity.set(c.entity_id, c.pago_em !== null);
    }
  }

  return alvos.map((a) =>
    mapAlvo(a, a.entity_id ? (pixPorEntity.get(a.entity_id) ?? false) : false),
  );
}

// TELEFÔNICO: o operador falou e preencheu perfil + unidades. WHATSAPP: não falou; só marca o
// canal (o disparo e a resposta vêm depois). `unidades_origem='operador'` quando veio da ligação.
export async function salvarContato(
  client: SupabaseClient,
  input: {
    alvoId: string;
    canal: ContatoCanal;
    perfil?: Perfil | null;
    por?: string | null;
    unidades?: UnidadesInteresse | null;
  },
): Promise<{ error?: string; ok: boolean }> {
  const agora = new Date().toISOString();
  const patch: Record<string, unknown> = {
    contato_canal: input.canal,
    contato_em: agora,
    contato_por: input.por ?? null,
    updated_at: agora,
  };

  // No telefônico, perfil e unidades são do operador. No whatsapp, não sobrescreve o que o cliente
  // possa ter respondido — só quando o operador de fato informar algo.
  if (input.canal === "telefonico") {
    patch.perfil = input.perfil ?? null;
    if (input.unidades !== undefined) {
      patch.unidades_interesse = input.unidades;
      patch.unidades_origem = input.unidades ? "operador" : null;
    }
  } else if (input.perfil !== undefined) {
    patch.perfil = input.perfil;
  }

  const { error } = await client
    .from("apolo_acao_alvos")
    .update(patch)
    .eq("id", input.alvoId);

  if (error) return { error: error.message, ok: false };
  return { ok: true };
}

// KPIs da campanha para o cabeçalho das telas.
export async function resumoDaAcao(
  client: SupabaseClient,
  acaoId: string,
): Promise<{
  contatados: number;
  perfilInvestimento: number;
  perfilMoradia: number;
  porTelefone: number;
  porWhatsapp: number;
  respostas: number;
  total: number;
}> {
  const { data } = await client
    .from("apolo_acao_alvos")
    .select("contato_canal, perfil, resposta_em")
    .eq("acao_id", acaoId)
    .limit(5000);
  const linhas = (data ?? []) as {
    contato_canal: string | null;
    perfil: string | null;
    resposta_em: string | null;
  }[];

  return {
    contatados: linhas.filter((l) => l.contato_canal).length,
    perfilInvestimento: linhas.filter((l) => l.perfil === "investimento").length,
    perfilMoradia: linhas.filter((l) => l.perfil === "moradia").length,
    porTelefone: linhas.filter((l) => l.contato_canal === "telefonico").length,
    porWhatsapp: linhas.filter((l) => l.contato_canal === "whatsapp").length,
    respostas: linhas.filter((l) => l.resposta_em).length,
    total: linhas.length,
  };
}

// ── SENHA DA TELA PÚBLICA ──────────────────────────────────────────────────
// scrypt com sal aleatório (mesmo padrão do login do operador do Prometeu). Guardada como
// "sal:hash" em apolo_acoes.publico_senha_hash.
export function hashSenhaAcao(senha: string): string {
  const sal = randomBytes(16);
  const hash = scryptSync(senha, sal, 64);
  return `${sal.toString("hex")}:${hash.toString("hex")}`;
}

export function verificarSenhaAcao(senha: string, guardado: string | null): boolean {
  if (!guardado) return false;
  const [salHex, hashHex] = guardado.split(":");
  if (!salHex || !hashHex) return false;
  try {
    const esperado = Buffer.from(hashHex, "hex");
    const calculado = scryptSync(senha, Buffer.from(salHex, "hex"), esperado.length);
    return esperado.length === calculado.length && timingSafeEqual(esperado, calculado);
  } catch {
    return false;
  }
}
