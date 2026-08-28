// Leitura do cadastro do INCORPORADOR: quem ele é, o que ele enxerga e quem pode entrar por ele.
//
// Tudo aqui roda com service_role, e é obrigatório: as três tabelas do 0083 estão com RLS
// deny-all de propósito (o hash de senha nunca pode sair pelo PostgREST, e a lista de
// empreendimentos É a regra de permissão). Nenhuma destas funções deve virar rota que aceita
// filtro do cliente: o único caminho é slug (porta pública) ou id vindo da sessão assinada.
import { createApoloAdminClient } from "@/lib/apolo/server";

import { chaveDoPortal } from "./logo";
import { verificarSenhaIncorporador } from "./senha";

/**
 * O slug que pode entrar numa consulta.
 *
 * ⚠️ `%` E `_` SÃO CURINGA NO `ilike` DO POSTGREST. Sem esta passagem, `/incorporador/cec%` casa
 * com `cecilio-rocha` por prefixo e a porta vira um enumerador de quem é cliente da Careli — o
 * oposto do 404 mudo que estas funções fazem questão de dar. `chaveDoPortal` só deixa passar
 * `[a-z0-9-]`, então o curinga morre antes da query. Slug legítimo já nasce assim
 * (`normalizarSlug`), então nada de verdadeiro é perdido; a tolerância a MAIÚSCULAS continua,
 * porque quem compara é o `ilike`.
 */
function slugDeConsulta(valor: null | string | undefined): string {
  return chaveDoPortal(String(valor ?? ""));
}

export type IncorporadorEmpreendimento = {
  carteiraAdministrada: boolean;
  enterpriseId: string;
};

export type Incorporador = {
  ativo: boolean;
  empreendimentos: IncorporadorEmpreendimento[];
  entityId: string | null;
  id: string;
  logoEscuraPath: string | null;
  logoPath: string | null;
  nome: string;
  slug: string;
};

type LinhaIncorporador = {
  ativo: boolean;
  entity_id: string | null;
  id: string;
  logo_escura_path: string | null;
  logo_path: string | null;
  nome: string;
  slug: string;
};

type LinhaEmpreendimento = {
  carteira_administrada: boolean;
  enterprise_id: string;
};

type LinhaUsuario = {
  ativo: boolean;
  email: string;
  id: string;
  incorporador_id: string;
  nome: string;
  senha_hash: string;
};

async function carregarEmpreendimentos(
  client: NonNullable<ReturnType<typeof createApoloAdminClient>>,
  incorporadorId: string,
): Promise<IncorporadorEmpreendimento[]> {
  const { data, error } = await client
    .from("apolo_incorporador_empreendimentos")
    .select("enterprise_id,carteira_administrada")
    .eq("incorporador_id", incorporadorId)
    .returns<LinhaEmpreendimento[]>();

  if (error) {
    // Falha FECHADA: devolver lista vazia por erro de banco daria "incorporador sem
    // empreendimento", que a sessão recusa. Melhor estourar do que abrir ou confundir.
    throw new Error(`Não foi possível ler os empreendimentos do incorporador: ${error.message}`);
  }

  return (data ?? []).map((linha) => ({
    carteiraAdministrada: Boolean(linha.carteira_administrada),
    enterpriseId: String(linha.enterprise_id),
  }));
}

/** O incorporador da porta de entrada: é o slug da URL que decide qual marca a tela veste. */
export async function carregarIncorporadorPorSlug(slug: string): Promise<Incorporador | null> {
  const client = createApoloAdminClient();
  if (!client) return null;

  const alvo = slugDeConsulta(slug);
  if (!alvo) return null;

  const { data, error } = await client
    .from("apolo_incorporadores")
    .select("id,slug,nome,entity_id,logo_path,logo_escura_path,ativo")
    .ilike("slug", alvo)
    .maybeSingle<LinhaIncorporador>();

  if (error || !data || !data.ativo) return null;

  return {
    ativo: data.ativo,
    empreendimentos: await carregarEmpreendimentos(client, data.id),
    entityId: data.entity_id,
    id: data.id,
    logoEscuraPath: data.logo_escura_path,
    logoPath: data.logo_path,
    nome: data.nome,
    slug: data.slug,
  };
}

/**
 * Leitura MAGRA para a rota pública da logo: só slug real + as duas referências de marca.
 *
 * Existe separada de `carregarIncorporadorPorSlug` de propósito. Aquela carrega também a lista de
 * empreendimentos (que É a regra de permissão) e ESTOURA quando o banco falha; servir uma imagem
 * não precisa de nada disso e não pode derrubar a porta por causa de uma logo. Aqui, portal
 * inexistente ou inativo devolve `null` e a rota responde 404 sem dizer qual dos dois.
 */
export async function carregarMarcaDoPortal(
  slug: string,
): Promise<null | { logoEscuraPath: null | string; logoPath: null | string; slug: string }> {
  const client = createApoloAdminClient();
  if (!client) return null;

  const alvo = slugDeConsulta(slug);
  if (!alvo) return null;

  const { data, error } = await client
    .from("apolo_incorporadores")
    .select("slug,logo_path,logo_escura_path,ativo")
    .ilike("slug", alvo)
    .maybeSingle<{
      ativo: boolean;
      logo_escura_path: null | string;
      logo_path: null | string;
      slug: string;
    }>();

  if (error || !data || !data.ativo) return null;

  return {
    logoEscuraPath: data.logo_escura_path,
    logoPath: data.logo_path,
    slug: data.slug,
  };
}

export type AutenticacaoResultado =
  | { ok: false; motivo: "credencial" | "indisponivel" }
  | {
      ok: true;
      incorporador: Incorporador;
      usuario: { email: string; id: string; nome: string };
    };

/**
 * Confere e-mail + senha e devolve o incorporador com a lista de empreendimentos dele.
 *
 * ⚠️ MESMA RESPOSTA PARA E-MAIL INEXISTENTE E SENHA ERRADA (`motivo: "credencial"`). Distinguir
 * os dois transforma a tela de acesso num confirmador de e-mail de cliente nosso. Pelo mesmo
 * motivo a senha é verificada mesmo quando o usuário não existe: sem isso o tempo de resposta
 * denuncia quais e-mails estão cadastrados.
 */
export async function autenticarUsuarioIncorporador(
  email: string,
  senha: string,
  /** Slug do portal onde a pessoa está entrando. Vem da URL; sem ele, busca só pelo e-mail. */
  slug?: null | string,
): Promise<AutenticacaoResultado> {
  const client = createApoloAdminClient();
  if (!client) return { motivo: "indisponivel", ok: false };

  const alvo = email.trim().toLowerCase();
  if (!alvo || !senha) return { motivo: "credencial", ok: false };

  // ⚠️ O PORTAL FAZ PARTE DA CREDENCIAL, e é isso que deixa o MESMO e-mail servir a vários
  // incorporadores (regra do Lucas, 17/08/2026: *"deixa o meu e-mail padrão acessar todos, só
  // muda a URL"*). Antes o e-mail era único no sistema inteiro e um `maybeSingle()` por e-mail
  // bastava; com o mesmo endereço em dois portais, ele passaria a estourar com "mais de uma
  // linha" e derrubaria o login dos DOIS.
  //
  // O slug vem da URL, que é pública e não autoriza nada sozinha: quem autoriza é a senha. O que
  // ele faz é dizer EM QUAL portal a pessoa está tentando entrar.
  const portal = slugDeConsulta(slug);

  let consulta = client
    .from("apolo_incorporador_usuarios")
    .select("id,incorporador_id,email,nome,senha_hash,ativo")
    .ilike("email", alvo);

  if (portal) {
    const { data: doPortal } = await client
      .from("apolo_incorporadores")
      .select("id")
      .ilike("slug", portal)
      .maybeSingle<{ id: string }>();

    // Portal inexistente: não devolve "não achei o portal" (isso confirmaria quais slugs existem
    // para quem chuta endereço). Segue com um id impossível e cai no mesmo "credencial inválida".
    consulta = consulta.eq("incorporador_id", doPortal?.id ?? "00000000-0000-0000-0000-000000000000");
  }

  const { data, error } = await consulta.limit(1).maybeSingle<LinhaUsuario>();

  if (error) return { motivo: "indisponivel", ok: false };

  // Hash descartável de mesmo formato, para o caminho "não existe" custar o mesmo scrypt do
  // caminho "existe". O valor nunca confere com senha nenhuma.
  const hashComparado =
    data?.ativo && data.senha_hash
      ? data.senha_hash
      : "00000000000000000000000000000000:0000000000000000000000000000000000000000000000000000000000000000";

  const senhaConfere = await verificarSenhaIncorporador(senha, hashComparado);

  if (!data || !data.ativo || !senhaConfere) return { motivo: "credencial", ok: false };

  const { data: inc, error: erroInc } = await client
    .from("apolo_incorporadores")
    .select("id,slug,nome,entity_id,logo_path,logo_escura_path,ativo")
    .eq("id", data.incorporador_id)
    .maybeSingle<LinhaIncorporador>();

  if (erroInc || !inc || !inc.ativo) return { motivo: "credencial", ok: false };

  return {
    incorporador: {
      ativo: inc.ativo,
      empreendimentos: await carregarEmpreendimentos(client, inc.id),
      entityId: inc.entity_id,
      id: inc.id,
      logoEscuraPath: inc.logo_escura_path,
      logoPath: inc.logo_path,
      nome: inc.nome,
      slug: inc.slug,
    },
    ok: true,
    usuario: { email: data.email, id: data.id, nome: data.nome },
  };
}

/**
 * A conta ainda está ativa? `null` = não deu para conferir (banco fora); quem chama decide o
 * fallback. Existe para a REVALIDAÇÃO de sessão: desativar a conta no Setup tem que valer no
 * próximo carregamento do portal, não no vencimento do cookie.
 */
export async function usuarioIncorporadorSegueAtivo(usuarioId: string): Promise<boolean | null> {
  const client = createApoloAdminClient();
  if (!client) return null;

  const { data, error } = await client
    .from("apolo_incorporador_usuarios")
    .select("ativo")
    .eq("id", usuarioId)
    .maybeSingle<{ ativo: boolean }>();

  if (error) return null;
  return Boolean(data?.ativo);
}

/** Carimba o último acesso. Falha aqui não derruba o login: é trilha, não autorização. */
export async function registrarLoginIncorporador(usuarioId: string): Promise<void> {
  const client = createApoloAdminClient();
  if (!client) return;

  await client
    .from("apolo_incorporador_usuarios")
    .update({ ultimo_login_em: new Date().toISOString() })
    .eq("id", usuarioId);
}
