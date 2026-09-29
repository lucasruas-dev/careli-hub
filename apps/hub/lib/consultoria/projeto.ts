import { randomBytes, timingSafeEqual } from "node:crypto";

import { NextResponse } from "next/server";

import { createApoloAdminClient } from "@/lib/apolo/server";

import DOCUMENTO_INICIAL_CR from "./cr-inicial.json";

// A CONSULTORIA DE REESTRUTURAÇÃO (c2x.app.br/consultoria/<slug>).
//
// Documento de trabalho da consultoria do Lucas num cliente: escopo, frentes, plano de ação,
// indicadores e o relatório mensal. Não é módulo do Panteon e não lê nada do Panteon.
//
// Quem ESCREVE: o dono (Lucas, por e-mail do token verificado; papel admin NÃO basta, a consultoria
// é dele e não da Careli). Quem LÊ: o dono, e o cliente por um link com token secreto.
//
// ⚠️ O documento é salvo INTEIRO pela tela. Duas abas abertas escrevendo ao mesmo tempo apagariam
// uma o trabalho da outra em silêncio, por isso todo salvamento diz de qual versão partiu
// (`base`) e é recusado com 409 se o banco já estiver em outra.

export const PROJETOS_DE_CONSULTORIA: Record<string, unknown> = {
  cr: DOCUMENTO_INICIAL_CR,
};

const DONOS_PADRAO = ["lucas.ruas@careli.adm.br"];
// Teto do documento. O conteúdo inicial tem ~30 KB; 12 meses de registro cabem com folga. Um corpo
// maior que isso é erro de quem chamou, não crescimento do projeto.
const TAMANHO_MAXIMO = 2_000_000;
// Uma cópia no histórico a cada janela, não a cada tecla: a tela salva sozinha poucos segundos
// depois de cada edição.
const JANELA_DO_HISTORICO_MS = 20 * 60 * 1000;

function donos(): string[] {
  const doEnv = (process.env.CONSULTORIA_OWNER_EMAILS ?? "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);

  return doEnv.length > 0 ? doEnv : DONOS_PADRAO;
}

export function ehProjetoConhecido(slug: string): boolean {
  return Object.prototype.hasOwnProperty.call(PROJETOS_DE_CONSULTORIA, slug);
}

function erro(status: number, mensagem: string) {
  return NextResponse.json({ error: mensagem }, { headers: { "cache-control": "no-store" }, status });
}

type Acesso = { email: string; ok: true } | { ok: false; response: NextResponse };

export async function autorizarDono(request: Request): Promise<Acesso> {
  const header = request.headers.get("authorization") ?? "";
  const token = header.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() ?? "";

  if (!token) return { ok: false, response: erro(401, "Sessão ausente.") };

  const client = createApoloAdminClient();
  if (!client) return { ok: false, response: erro(503, "Banco indisponível.") };

  const { data, error } = await client.auth.getUser(token);
  if (error || !data.user) return { ok: false, response: erro(401, "Sessão inválida ou expirada.") };

  const email = (data.user.email ?? "").trim().toLowerCase();
  if (!email || !donos().includes(email)) {
    return { ok: false, response: erro(403, "Só o consultor edita este projeto.") };
  }

  return { email, ok: true };
}

type Linha = { atualizado_em: string; dados: unknown; token_leitura: string };

async function lerLinha(slug: string): Promise<Linha | null> {
  const client = createApoloAdminClient();
  if (!client) throw new Error("Banco indisponível.");

  const { data, error } = await client
    .from("consultoria_projetos")
    .select("dados,token_leitura,atualizado_em")
    .eq("slug", slug)
    .maybeSingle<Linha>();

  if (error) throw new Error(error.message);
  return data ?? null;
}

/** Lê o projeto; se ainda não existe no banco, nasce aqui com o conteúdo inicial aprovado. */
export async function abrirProjetoDoDono(slug: string, email: string): Promise<Linha> {
  const existente = await lerLinha(slug);
  if (existente) return existente;

  const client = createApoloAdminClient();
  if (!client) throw new Error("Banco indisponível.");

  const nova = {
    atualizado_por: email,
    dados: PROJETOS_DE_CONSULTORIA[slug],
    slug,
    token_leitura: randomBytes(24).toString("base64url"),
  };
  // `ignoreDuplicates`: duas abas abrindo ao mesmo tempo não podem gerar dois tokens; a segunda
  // relê o que a primeira gravou.
  const { error } = await client
    .from("consultoria_projetos")
    .upsert(nova, { ignoreDuplicates: true, onConflict: "slug" });
  if (error) throw new Error(error.message);

  const criada = await lerLinha(slug);
  if (!criada) throw new Error("Projeto não foi criado.");
  return criada;
}

function tokenConfere(recebido: string, esperado: string): boolean {
  const a = Buffer.from(recebido);
  const b = Buffer.from(esperado);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Leitura do cliente pelo link. Token errado e projeto inexistente respondem igual. */
export async function abrirProjetoPeloLink(slug: string, token: string) {
  if (!token || !ehProjetoConhecido(slug)) return null;
  const linha = await lerLinha(slug);
  if (!linha || !tokenConfere(token, linha.token_leitura)) return null;
  return { atualizadoEm: linha.atualizado_em, dados: linha.dados };
}

export type ResultadoDoSalvamento =
  | { atualizadoEm: string; ok: true }
  | { motivo: "conflito" | "invalido"; ok: false };

export async function salvarProjeto(
  slug: string,
  email: string,
  dados: unknown,
  base: string,
): Promise<ResultadoDoSalvamento> {
  if (!dados || typeof dados !== "object" || Array.isArray(dados)) return { motivo: "invalido", ok: false };
  if (JSON.stringify(dados).length > TAMANHO_MAXIMO) return { motivo: "invalido", ok: false };

  const client = createApoloAdminClient();
  if (!client) throw new Error("Banco indisponível.");

  const atual = await lerLinha(slug);
  if (!atual) return { motivo: "conflito", ok: false };
  if (new Date(atual.atualizado_em).getTime() !== new Date(base).getTime()) {
    return { motivo: "conflito", ok: false };
  }

  const agora = new Date().toISOString();
  // A condição de versão vai no próprio UPDATE: entre a leitura acima e esta escrita outra aba
  // pode ter salvo, e aí nenhuma linha casa.
  const { data, error } = await client
    .from("consultoria_projetos")
    .update({ atualizado_em: agora, atualizado_por: email, dados })
    .eq("slug", slug)
    .eq("atualizado_em", atual.atualizado_em)
    .select("atualizado_em");
  if (error) throw new Error(error.message);
  if (!data || data.length === 0) return { motivo: "conflito", ok: false };

  await guardarNoHistorico(slug, atual, email);
  return { atualizadoEm: agora, ok: true };
}

async function guardarNoHistorico(slug: string, anterior: Linha, email: string) {
  const client = createApoloAdminClient();
  if (!client) return;

  const { data: ultima } = await client
    .from("consultoria_projetos_historico")
    .select("salvo_em")
    .eq("slug", slug)
    .order("salvo_em", { ascending: false })
    .limit(1)
    .maybeSingle<{ salvo_em: string }>();

  if (ultima && Date.now() - new Date(ultima.salvo_em).getTime() < JANELA_DO_HISTORICO_MS) return;

  const { error } = await client.from("consultoria_projetos_historico").insert({
    dados: anterior.dados,
    salvo_por: email,
    slug,
    versao_de: anterior.atualizado_em,
  });
  // O documento já foi salvo; falhar o histórico não pode desfazer isso, mas não pode ser mudo.
  if (error) console.error("[consultoria] histórico não gravado", slug, error.message);
}
