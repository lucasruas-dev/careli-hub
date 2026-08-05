// Prometeu: contas de OPERADOR do evento (login proprio, nao e' usuario do hub).
//
// Decisao do Lucas (24/jul): a equipe do dia loga com nome.sobrenome + senha e so ve o Prometeu.
// Estas funcoes recebem o admin client (mesmo padrao de data.ts) e SEMPRE tratam a senha como
// segredo: `senha_hash` nunca sai daqui para as telas de listagem — so a rota de login le o hash,
// para conferir a senha em `verificarSenha`.
import { createApoloAdminClient } from "@/lib/apolo/server";

import { hashSenha, normalizarUsername } from "./operador-auth";
import {
  PROMETEU_PAPEIS,
  PROMETEU_ZONAS,
  type PrometeuOperadorEu,
  type PrometeuOperadorResumo,
  type PrometeuPapel,
  type PrometeuZona,
} from "./types";

type AdminClient = NonNullable<ReturnType<typeof createApoloAdminClient>>;

const PERFIS_VALIDOS = new Set<string>(PROMETEU_PAPEIS.map((p) => p.id));
const ZONAS_VALIDAS = new Set<string>(PROMETEU_ZONAS.map((z) => z.id));

// A forma que a rota de login precisa: inclui o `senha_hash` (uso interno, para conferir a senha).
export type OperadorLoginRow = {
  evento_id: string;
  id: string;
  mesa_id: string | null;
  nome: string;
  perfil: string;
  senha_hash: string;
  username: string;
  zona: string;
};

// ---------------------------------------------------------------- login

// Busca o operador ATIVO por username (comparado ja normalizado; o valor gravado tambem e' sempre
// normalizado na criacao, e o indice unico do banco e' em lower(username)). Devolve o hash junto
// PORQUE quem chama e' a rota de login, que precisa conferir a senha. Nunca use em listagem.
export async function buscarOperadorAtivoPorUsername(
  client: AdminClient,
  username: string,
): Promise<OperadorLoginRow | null> {
  const alvo = normalizarUsername(username);
  if (!alvo) return null;

  const { data, error } = await client
    .from("prometeu_operadores")
    .select("id, username, nome, senha_hash, perfil, zona, mesa_id, evento_id")
    .eq("ativo", true)
    .eq("username", alvo)
    .maybeSingle();

  if (error || !data) return null;
  return data as OperadorLoginRow;
}

// Carimba o ultimo_login_em (chamado apos a senha conferir).
export async function registrarLoginOperador(
  client: AdminClient,
  id: string,
): Promise<void> {
  const agora = new Date().toISOString();
  await client
    .from("prometeu_operadores")
    .update({ ultimo_login_em: agora, updated_at: agora })
    .eq("id", id);
}

// "Quem sou eu" a partir do id (o token de sessao carrega o id; o NOME e os campos atuais vem do
// banco). Devolve null se o operador nao existe mais ou foi desativado — assim inativar um
// operador derruba a sessao dele no proximo /eu, mesmo com token ainda valido.
export async function buscarOperadorEuPorId(
  client: AdminClient,
  id: string,
): Promise<PrometeuOperadorEu> {
  const { data, error } = await client
    .from("prometeu_operadores")
    .select("id, username, nome, perfil, zona, mesa_id, evento_id, ativo")
    .eq("id", id)
    .maybeSingle();

  if (error || !data) return null;

  const row = data as {
    ativo: boolean;
    evento_id: string;
    id: string;
    mesa_id: string | null;
    nome: string;
    perfil: string;
    username: string;
    zona: string;
  };

  if (!row.ativo) return null;

  return {
    eventoId: row.evento_id,
    mesaId: row.mesa_id,
    nome: row.nome,
    operadorId: row.id,
    perfil: row.perfil as PrometeuPapel,
    username: row.username,
    zona: row.zona as PrometeuZona,
  };
}

// ---------------------------------------------------------------- admin (Setup)

// O roster de operadores do evento, para o Setup listar. NUNCA traz senha_hash.
export async function listarOperadores(
  client: AdminClient,
  eventoId: string,
): Promise<PrometeuOperadorResumo[]> {
  const { data } = await client
    .from("prometeu_operadores")
    .select(
      "id, username, nome, perfil, zona, mesa_id, ativo, ultimo_login_em, prometeu_mesas(numero)",
    )
    .eq("evento_id", eventoId)
    .order("nome", { ascending: true });

  // O supabase-js tipa o join como ARRAY quando nao sabe a cardinalidade; normalizamos (1:1 aqui).
  const primeiro = <T,>(valor: T | T[] | null | undefined): T | null =>
    Array.isArray(valor) ? (valor[0] ?? null) : (valor ?? null);

  return ((data ?? []) as Array<{
    ativo: boolean | null;
    id: string;
    mesa_id: string | null;
    nome: string;
    perfil: string;
    prometeu_mesas: { numero: string } | { numero: string }[] | null;
    ultimo_login_em: string | null;
    username: string;
    zona: string;
  }>).map((row) => {
    const mesa = primeiro(row.prometeu_mesas);
    return {
      ativo: row.ativo ?? true,
      id: row.id,
      mesaId: row.mesa_id,
      mesaNumero: mesa?.numero ?? null,
      nome: row.nome,
      perfil: row.perfil as PrometeuPapel,
      ultimoLoginEm: row.ultimo_login_em,
      username: row.username,
      zona: row.zona as PrometeuZona,
    };
  });
}

// Cria um operador. Valida username (unico), perfil, zona e a regra do atendente (so na secretaria,
// e com mesa). A senha e' guardada como hash — nunca em texto.
export async function criarOperador(
  client: AdminClient,
  input: {
    eventoId: string;
    mesaId?: string | null;
    nome: string;
    perfil: string;
    senha: string;
    username: string;
    zona: string;
  },
): Promise<{ error?: string; id?: string; ok: boolean }> {
  const nome = input.nome.trim();
  const username = normalizarUsername(input.username);
  const senha = input.senha.trim();

  if (!nome) return { error: "Informe o nome do operador.", ok: false };
  if (!username) return { error: "Informe o usuário (nome.sobrenome).", ok: false };
  if (!senha) return { error: "Informe uma senha.", ok: false };

  if (!PERFIS_VALIDOS.has(input.perfil)) {
    return { error: "Perfil inválido.", ok: false };
  }
  if (!ZONAS_VALIDAS.has(input.zona)) {
    return { error: "Posto inválido.", ok: false };
  }

  const ehAtendente = input.perfil === "atendente";
  if (ehAtendente && input.zona !== "secretaria") {
    return { error: "Atendente só existe na secretaria.", ok: false };
  }
  const mesaId = ehAtendente ? (input.mesaId ?? null) : null;
  if (ehAtendente && !mesaId) {
    return { error: "Atendente da secretaria precisa de uma mesa.", ok: false };
  }

  // Unicidade amigavel antes do insert; o indice unico em lower(username) e' a rede final (corrida).
  const { data: existente } = await client
    .from("prometeu_operadores")
    .select("id")
    .eq("username", username)
    .limit(1)
    .maybeSingle();

  if (existente) {
    return { error: "Já existe um operador com esse usuário.", ok: false };
  }

  const senha_hash = await hashSenha(senha);

  const { data, error } = await client
    .from("prometeu_operadores")
    .insert({
      ativo: true,
      evento_id: input.eventoId,
      mesa_id: mesaId,
      nome,
      perfil: input.perfil,
      senha_hash,
      username,
      zona: input.zona,
    })
    .select("id")
    .single();

  if (error || !data) {
    if (error?.code === "23505") {
      return { error: "Já existe um operador com esse usuário.", ok: false };
    }
    return { error: error?.message ?? "Não foi possível criar o operador.", ok: false };
  }

  return { id: (data as { id: string }).id, ok: true };
}

export async function removerOperador(
  client: AdminClient,
  id: string,
): Promise<{ error?: string; ok: boolean }> {
  const { error } = await client.from("prometeu_operadores").delete().eq("id", id);
  if (error) return { error: error.message, ok: false };
  return { ok: true };
}

// Redefine a senha (guarda o novo hash). Util quando o operador esquece a senha.
export async function definirSenhaOperador(
  client: AdminClient,
  id: string,
  senha: string,
): Promise<{ error?: string; ok: boolean }> {
  const limpa = senha.trim();
  if (!limpa) return { error: "Informe uma senha.", ok: false };

  const agora = new Date().toISOString();
  const { error } = await client
    .from("prometeu_operadores")
    .update({ senha_hash: await hashSenha(limpa), updated_at: agora })
    .eq("id", id);

  if (error) return { error: error.message, ok: false };
  return { ok: true };
}

// Ativa/desativa sem apagar (preserva o historico de ultimo_login). Desativar derruba a sessao no
// proximo /eu.
export async function definirAtivoOperador(
  client: AdminClient,
  id: string,
  ativo: boolean,
): Promise<{ error?: string; ok: boolean }> {
  const agora = new Date().toISOString();
  const { error } = await client
    .from("prometeu_operadores")
    .update({ ativo, updated_at: agora })
    .eq("id", id);

  if (error) return { error: error.message, ok: false };
  return { ok: true };
}
