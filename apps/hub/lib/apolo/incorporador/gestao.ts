// GESTÃO das contas de incorporador (ferramenta interna, Setup do Apolo).
//
// Pedido do Lucas em 12/08/2026: "eu preciso ter um local que eu crio o login e senha desses
// usuarios e vincula-los ao perfil correto". Até aqui o Cecílio Rocha e as duas contas dele
// entraram por INSERT manual; com Recanto do Pará, Vista Alegre e Lavra do Ouro entrando, o
// caminho manual vira gargalo e risco (uma linha errada em `apolo_incorporador_empreendimentos`
// é um cliente vendo a carteira de outro).
//
// TUDO AQUI É service_role, e é obrigatório: as três tabelas do 0083 estão com RLS deny-all de
// propósito. Nenhuma função deste arquivo pode virar rota sem `authorizeApoloWrite` na frente:
// quem chega aqui cria conta de gente de fora.
//
// ⚠️ ESTE ARQUIVO NUNCA DEVOLVE `senha_hash`. Nem para a tela interna. A senha se define e se
// troca, não se consulta.
import type { RowDataPacket } from "mysql2";

import { getHadesDbPool } from "@/lib/guardian/db";
import { resolverLogoDoPortal } from "@/lib/apolo/incorporador/logo";
import { type TipoDePortal, tipoDePortal } from "@/lib/apolo/incorporador/perfis-de-portal";
import { createApoloAdminClient } from "@/lib/apolo/server";

import { hashSenhaIncorporador } from "./senha";

type AdminClient = NonNullable<ReturnType<typeof createApoloAdminClient>>;

export type EmpreendimentoDisponivel = {
  code: string;
  enterpriseId: string;
  nome: string;
};

export type UsuarioDoIncorporador = {
  ativo: boolean;
  criadoEm: null | string;
  email: string;
  /**
   * O recorte PRÓPRIO desta conta (migration 0122). No comercial é aqui que o coordenador é
   * vinculado aos empreendimentos dele — e vazio significa "não entra" (não herda o portal). No
   * portal de incorporador o campo fica vazio e a conta vê o que o portal vê.
   */
  empreendimentos: string[];
  id: string;
  nome: string;
  ultimoLoginEm: null | string;
};

export type IncorporadorGerenciado = {
  ativo: boolean;
  empreendimentos: { carteiraAdministrada: boolean; enterpriseId: string }[];
  id: string;
  logoEscuraPath: null | string;
  /** Endereço pronto para a prévia da tela — o MESMO que a porta usa. Resolvido no servidor. */
  logoEscuraUrl: null | string;
  logoPath: null | string;
  logoUrl: null | string;
  nome: string;
  slug: string;
  tipo: TipoDePortal;
  usuarios: UsuarioDoIncorporador[];
};

/** Slug da URL: minúsculo, sem acento, sem espaço. Vira a porta `/incorporador/<slug>`. */
export function normalizarSlug(valor: string): string {
  return valor
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

const emailValido = (valor: string): boolean => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(valor.trim());

/**
 * Senha mínima. Não é política de segurança de banco, é o piso para não nascer conta com "123":
 * são contas de gente de fora, criadas por nós, e quem digita a senha aqui é o operador interno.
 */
export function senhaAceitavel(senha: string): boolean {
  return senha.trim().length >= 8;
}

/** Os empreendimentos do C2X, só o suficiente para escolher na tela. Leitura pura. */
export async function listarEmpreendimentosDisponiveis(): Promise<EmpreendimentoDisponivel[]> {
  const pool = getHadesDbPool();
  if (!pool.ok) return [];

  // Consulta magra de propósito: `loadApoloEnterprises` traz o cenário comercial inteiro
  // (agrega unidades, preço, status) e aqui só precisamos de id, sigla e nome para um seletor.
  const [rows] = await pool.pool.query<(RowDataPacket & {
    code: null | string;
    id: number;
    name: null | string;
  })[]>(`select e.id, e.code, e.name from enterprises e order by e.code`);

  return rows
    .filter((r) => r.code)
    .map((r) => ({
      code: String(r.code),
      enterpriseId: String(r.id),
      nome: r.name?.trim() || String(r.code),
    }));
}

/** Todos os incorporadores, com usuários e empreendimentos. Sem hash de senha. */
export async function listarIncorporadores(
  client: AdminClient,
  /** Só os portais deste tipo. A tela "Incorporadores" e a tela "Comercial" do Setup partem daqui. */
  filtro: { tipo?: TipoDePortal } = {},
): Promise<IncorporadorGerenciado[]> {
  let consulta = client
    .from("apolo_incorporadores")
    .select("id,slug,nome,ativo,logo_path,logo_escura_path,tipo")
    .order("nome");
  if (filtro.tipo) consulta = consulta.eq("tipo", filtro.tipo);

  const { data: incs, error } = await consulta.returns<{
      ativo: boolean;
      id: string;
      logo_escura_path: null | string;
      logo_path: null | string;
      nome: string;
      slug: string;
      tipo: null | string;
    }[]>();

  if (error) throw new Error(`Não foi possível ler os incorporadores: ${error.message}`);
  if (!incs?.length) return [];

  const ids = incs.map((i) => i.id);

  const [{ data: emps }, { data: usus }] = await Promise.all([
    client
      .from("apolo_incorporador_empreendimentos")
      .select("incorporador_id,enterprise_id,carteira_administrada")
      .in("incorporador_id", ids)
      .returns<{
        carteira_administrada: boolean;
        enterprise_id: string;
        incorporador_id: string;
      }[]>(),
    // `senha_hash` NÃO entra nesta lista. Ver o alerta no topo do arquivo.
    client
      .from("apolo_incorporador_usuarios")
      .select("id,incorporador_id,email,nome,ativo,ultimo_login_em,created_at")
      .in("incorporador_id", ids)
      .order("nome")
      .returns<{
        ativo: boolean;
        created_at: null | string;
        email: string;
        id: string;
        incorporador_id: string;
        nome: string;
        ultimo_login_em: null | string;
      }[]>(),
  ]);

  // O recorte próprio de cada conta (0122). Lido num só disparo para o Setup inteiro.
  const idsDeUsuario = (usus ?? []).map((u) => u.id);
  const { data: vinculos } = idsDeUsuario.length
    ? await client
        .from("apolo_incorporador_usuario_empreendimentos")
        .select("usuario_id,enterprise_id")
        .in("usuario_id", idsDeUsuario)
        .returns<{ enterprise_id: string; usuario_id: string }[]>()
    : { data: [] as { enterprise_id: string; usuario_id: string }[] };

  return incs.map((i) => ({
    ativo: Boolean(i.ativo),
    empreendimentos: (emps ?? [])
      .filter((e) => e.incorporador_id === i.id)
      .map((e) => ({
        carteiraAdministrada: Boolean(e.carteira_administrada),
        enterpriseId: String(e.enterprise_id),
      })),
    id: i.id,
    logoEscuraPath: i.logo_escura_path,
    logoEscuraUrl: resolverLogoDoPortal({
      referencia: i.logo_escura_path,
      slug: i.slug,
      variante: "escura",
    }),
    logoPath: i.logo_path,
    logoUrl: resolverLogoDoPortal({ referencia: i.logo_path, slug: i.slug, variante: "clara" }),
    nome: i.nome,
    slug: i.slug,
    tipo: tipoDePortal(i.tipo),
    usuarios: (usus ?? [])
      .filter((u) => u.incorporador_id === i.id)
      .map((u) => ({
        ativo: Boolean(u.ativo),
        criadoEm: u.created_at,
        email: u.email,
        empreendimentos: (vinculos ?? [])
          .filter((v) => v.usuario_id === u.id)
          .map((v) => String(v.enterprise_id)),
        id: u.id,
        nome: u.nome,
        ultimoLoginEm: u.ultimo_login_em,
      })),
  }));
}

/**
 * ⚠️ O PORTÃO DO UPLOAD. Responde a uma pergunta só: em qual prefixo do bucket este operador
 * pode gravar agora?
 *
 * Sem ela, a rota de upload obedecia ao texto do campo "endereço de acesso" e mais nada — e o
 * furo era real e silencioso: o operador clica em "Novo incorporador", digita `vistaalegre`
 * (endereço que JÁ existe, erro comum quando se recria um cadastro), escolhe o arquivo, e o
 * upload com `upsert` SOBRESCREVE a arte do portal que está no ar. Só depois, ao salvar, o banco
 * recusa por endereço duplicado — e ninguém liga uma coisa à outra. Pior: como o `?v=` gravado
 * na coluna não mudou, quem já tinha a logo em cache continua vendo a certa, e só visitante novo
 * vê a errada.
 *
 * As duas regras:
 *   • EDIÇÃO (`id` presente): o prefixo é o slug GRAVADO no banco, nunca o que está no campo. Se
 *     o operador está renomeando o endereço, a arte sobe no prefixo antigo e o `migrarLogoDeSlug`
 *     da gravação a leva para o novo — a renomeação continua funcionando, e mesmo assim é
 *     impossível escrever no prefixo de outro portal.
 *   • NOVO (sem `id`): endereço que já pertence a alguém é recusado ANTES de tocar no bucket, com
 *     a mesma mensagem que a gravação daria.
 */
export async function prefixoDeLogoPermitido(
  client: AdminClient,
  entrada: { id?: null | string; slug: string },
): Promise<{ erro: string; ok: false } | { ok: true; slug: string }> {
  const pedido = normalizarSlug(entrada.slug ?? "");
  const id = entrada.id?.trim() || "";

  if (id) {
    const { data, error } = await client
      .from("apolo_incorporadores")
      .select("slug")
      .eq("id", id)
      .maybeSingle<{ slug: string }>();

    if (error) return { erro: "Não foi possível confirmar o portal.", ok: false };
    if (!data) return { erro: "Incorporador não encontrado.", ok: false };

    const gravado = normalizarSlug(data.slug ?? "");
    if (!gravado) return { erro: "O portal está com o endereço de acesso inválido.", ok: false };
    return { ok: true, slug: gravado };
  }

  if (!pedido) {
    return { erro: "Defina o endereço de acesso antes de enviar a logo.", ok: false };
  }

  const livre = await enderecoDeAcessoLivre(client, { id: null, slug: pedido });
  if (!livre.ok) return livre;

  return { ok: true, slug: pedido };
}

/**
 * O endereço de acesso pedido já pertence a OUTRO incorporador?
 *
 * ⚠️ ISTO PRECISA RODAR ANTES DE QUALQUER MEXIDA NO BUCKET. A gravação move o objeto da logo para
 * o prefixo do endereço novo, e o índice único do banco só reclama depois. Renomear o portal A
 * para o endereço do portal B, então, mandava a arte de A para o prefixo de B ANTES de a gravação
 * ser recusada — na melhor hipótese o `move` falha e o operador recebe uma mensagem sobre logo que
 * nada tem a ver com o problema real; na pior, a marca do portal B, que está no ar, é substituída.
 *
 * `ilike` porque o slug gravado pode ter caixa diferente do normalizado; `pedido` já saiu de
 * `normalizarSlug`, então não carrega `%` nem `_` para virar curinga do pattern matching.
 */
export async function enderecoDeAcessoLivre(
  client: AdminClient,
  entrada: { id?: null | string; slug: string },
): Promise<{ erro: string; ok: false } | { ok: true }> {
  const pedido = normalizarSlug(entrada.slug ?? "");
  if (!pedido) {
    return { erro: "O endereço de acesso ficou vazio. Use letras e números.", ok: false };
  }

  const { data, error } = await client
    .from("apolo_incorporadores")
    .select("id")
    .ilike("slug", pedido)
    .maybeSingle<{ id: string }>();

  if (error) return { erro: "Não foi possível confirmar o endereço de acesso.", ok: false };

  // O próprio registro ocupando o próprio endereço não é conflito — é o caso normal de editar
  // qualquer outro campo sem mexer no endereço.
  if (data && data.id !== (entrada.id?.trim() || "")) {
    return { erro: `Já existe um incorporador com o endereço "${pedido}".`, ok: false };
  }

  return { ok: true };
}

/**
 * O que as duas colunas de logo do registro apontam AGORA. Serve para duas perguntas da gravação:
 * antes dela, "qual arquivo vai ficar para trás?"; e, quando ela falha, "o registro chegou a ser
 * gravado?" — porque `salvarIncorporador` também falha DEPOIS de gravar o incorporador, na lista
 * de empreendimentos que vem em seguida.
 */
export async function logosGravadasDoIncorporador(
  client: AdminClient,
  id: string,
): Promise<null | { logoEscuraPath: null | string; logoPath: null | string }> {
  const alvo = id.trim();
  if (!alvo) return null;

  const { data } = await client
    .from("apolo_incorporadores")
    .select("logo_path,logo_escura_path")
    .eq("id", alvo)
    .maybeSingle<{ logo_escura_path: null | string; logo_path: null | string }>();

  if (!data) return null;
  return { logoEscuraPath: data.logo_escura_path, logoPath: data.logo_path };
}

export type ResultadoGravacao = { erro: string; ok: false } | { id: string; ok: true };

/**
 * Cria ou atualiza um incorporador e a lista do que ele enxerga.
 *
 * A lista de empreendimentos é substituída INTEIRA (apaga e regrava), e isso é de propósito: é a
 * regra de permissão, e um merge deixaria empreendimento antigo pendurado quando o operador
 * desmarca. Como a tela sempre manda a lista completa, a substituição é a operação honesta.
 */
export async function salvarIncorporador(
  client: AdminClient,
  entrada: {
    ativo?: boolean;
    empreendimentos: { carteiraAdministrada: boolean; enterpriseId: string }[];
    id?: null | string;
    logoEscuraPath?: null | string;
    logoPath?: null | string;
    nome: string;
    slug: string;
    /**
     * Só na CRIAÇÃO. Um portal não muda de tipo depois de nascer: as contas, o recorte e a marca
     * foram desenhados para um dos dois, e trocar viraria um incorporador em operador da fila.
     */
    tipo?: TipoDePortal;
  },
): Promise<ResultadoGravacao> {
  const nome = entrada.nome.trim();
  const slug = normalizarSlug(entrada.slug || entrada.nome);

  if (!nome) return { erro: "Informe o nome do incorporador.", ok: false };
  if (!slug) return { erro: "O endereço de acesso ficou vazio. Use letras e números.", ok: false };

  const campos: Record<string, unknown> = {
    ativo: entrada.ativo ?? true,
    logo_escura_path: entrada.logoEscuraPath?.trim() || null,
    logo_path: entrada.logoPath?.trim() || null,
    nome,
    slug,
    updated_at: new Date().toISOString(),
  };

  let id = entrada.id?.trim() || "";

  if (id) {
    const { error } = await client.from("apolo_incorporadores").update(campos).eq("id", id);
    if (error) return { erro: mensagemDeErro(error.message, slug), ok: false };
  } else {
    if (entrada.tipo) campos.tipo = entrada.tipo;
    const { data, error } = await client
      .from("apolo_incorporadores")
      .insert(campos)
      .select("id")
      .maybeSingle<{ id: string }>();

    // ⚠️ CHECAR `error` SEMPRE: upsert/insert do PostgREST falha calado quando bate em NOT NULL
    // ou índice único, e sem esta linha a tela diria "salvo" com nada gravado.
    if (error || !data?.id) return { erro: mensagemDeErro(error?.message, slug), ok: false };
    id = data.id;
  }

  const { error: erroApagar } = await client
    .from("apolo_incorporador_empreendimentos")
    .delete()
    .eq("incorporador_id", id);
  if (erroApagar) return { erro: `Não foi possível atualizar os empreendimentos: ${erroApagar.message}`, ok: false };

  const linhas = entrada.empreendimentos
    .filter((e) => String(e.enterpriseId).trim())
    .map((e) => ({
      carteira_administrada: Boolean(e.carteiraAdministrada),
      enterprise_id: String(e.enterpriseId).trim(),
      incorporador_id: id,
    }));

  if (linhas.length) {
    const { error } = await client.from("apolo_incorporador_empreendimentos").insert(linhas);
    if (error) {
      return { erro: `Não foi possível gravar os empreendimentos: ${error.message}`, ok: false };
    }
  }

  return { id, ok: true };
}

function mensagemDeErro(mensagem: null | string | undefined, slug: string): string {
  if (mensagem?.includes("apolo_incorporadores_slug_uk")) {
    return `Já existe um incorporador com o endereço "${slug}".`;
  }
  return mensagem ?? "Não foi possível gravar o incorporador.";
}

/**
 * Cria a conta de login, ou atualiza a que existe.
 *
 * Senha vazia em edição = MANTER a atual. Sem isso, salvar o nome de um usuário zeraria o acesso
 * dele, e o operador só descobriria pelo cliente ligando.
 */
export async function salvarUsuarioIncorporador(
  client: AdminClient,
  entrada: {
    ativo?: boolean;
    email: string;
    /**
     * O recorte PRÓPRIO desta conta (0122). `undefined` = não mexer; lista, mesmo vazia, =
     * substituir. No comercial, vazia significa "não entra" (escopoDoUsuario não herda o portal).
     *
     * ⚠️ SÓ VALE EM PORTAL `comercial`. Em portal de incorporador o campo é IGNORADO, mesmo que
     * o corpo mande: a rota é interna (authorizeApoloWrite), mas um POST com `empreendimentos:
     * ["1"]` para a conta do Cecílio gravaria a Lavra do Ouro no vínculo dele e o próximo GET
     * /sessao reemitiria o cookie com ela — o recorte da conta SUBSTITUI o do portal, sem
     * interseção (revisão de 02/09/2026). A tela nem oferece a lista nesse modo.
     *
     * DECISÃO: no comercial NÃO há interseção com a lista do portal. Depois da correção em
     * escopoDoUsuario a lista do /gurgel não define escopo nenhum (só o vínculo da conta vale),
     * e o portal pode nascer sem empreendimento — intersectar deixaria toda conta vazia.
     */
    empreendimentos?: string[];
    id?: null | string;
    incorporadorId: string;
    nome: string;
    senha?: null | string;
  },
): Promise<ResultadoGravacao> {
  const email = entrada.email.trim().toLowerCase();
  const nome = entrada.nome.trim();
  const senha = entrada.senha?.trim() ?? "";
  const id = entrada.id?.trim() || "";

  if (!nome) return { erro: "Informe o nome da pessoa.", ok: false };
  if (!emailValido(email)) return { erro: "E-mail inválido.", ok: false };
  if (!id && !senha) return { erro: "Defina uma senha para o primeiro acesso.", ok: false };
  if (senha && !senhaAceitavel(senha)) {
    return { erro: "A senha precisa de pelo menos 8 caracteres.", ok: false };
  }

  // O vínculo próprio só existe no portal comercial (ver o comentário do campo). Portal não
  // encontrado cai em "incorporador" e ignora — fail-closed: na dúvida, não amplia recorte.
  const empreendimentos =
    entrada.empreendimentos === undefined
      ? undefined
      : (await tipoDoPortalDaConta(client, { id, incorporadorId: entrada.incorporadorId })) ===
          "comercial"
        ? entrada.empreendimentos
        : undefined;

  const campos: Record<string, unknown> = {
    ativo: entrada.ativo ?? true,
    email,
    nome,
    updated_at: new Date().toISOString(),
  };
  if (senha) campos.senha_hash = await hashSenhaIncorporador(senha);

  if (id) {
    const { error } = await client.from("apolo_incorporador_usuarios").update(campos).eq("id", id);
    if (error) return { erro: mensagemDeUsuario(error.message, email), ok: false };
    return gravarVinculosDaConta(client, id, empreendimentos);
  }

  campos.incorporador_id = entrada.incorporadorId;

  const { data, error } = await client
    .from("apolo_incorporador_usuarios")
    .insert(campos)
    .select("id")
    .maybeSingle<{ id: string }>();

  if (error || !data?.id) return { erro: mensagemDeUsuario(error?.message, email), ok: false };
  return gravarVinculosDaConta(client, data.id, empreendimentos);
}

/**
 * O tipo do portal a que a conta pertence. Na criação vem pelo `incorporadorId`; na edição a
 * tela pode mandar só o `id` da conta, e aí o portal sai da própria linha dela — nunca do corpo,
 * que poderia apontar outro portal.
 */
async function tipoDoPortalDaConta(
  client: AdminClient,
  conta: { id: string; incorporadorId: string },
): Promise<TipoDePortal> {
  let incorporadorId = conta.incorporadorId.trim();

  if (conta.id) {
    const { data } = await client
      .from("apolo_incorporador_usuarios")
      .select("incorporador_id")
      .eq("id", conta.id)
      .maybeSingle<{ incorporador_id: string }>();
    if (data?.incorporador_id) incorporadorId = String(data.incorporador_id);
  }
  if (!incorporadorId) return "incorporador";

  const { data } = await client
    .from("apolo_incorporadores")
    .select("tipo")
    .eq("id", incorporadorId)
    .maybeSingle<{ tipo: null | string }>();

  return tipoDePortal(data?.tipo);
}

/**
 * Substitui o recorte próprio da conta. Apaga e reinsere, como `salvarIncorporador` faz com o do
 * portal: a lista da tela é a verdade inteira, não um delta.
 *
 * ⚠️ A CONTA JÁ FOI GRAVADA quando isto roda. Erro aqui volta como erro para a tela, mas o nome e
 * a senha ficaram — igual ao que acontece com os empreendimentos do portal. Quem receber o erro
 * salva de novo; a segunda gravação apaga e reinsere, sem duplicar.
 */
async function gravarVinculosDaConta(
  client: AdminClient,
  usuarioId: string,
  empreendimentos: string[] | undefined,
): Promise<ResultadoGravacao> {
  if (empreendimentos === undefined) return { id: usuarioId, ok: true };

  const { error: erroApagar } = await client
    .from("apolo_incorporador_usuario_empreendimentos")
    .delete()
    .eq("usuario_id", usuarioId);
  if (erroApagar) {
    return { erro: `Não foi possível atualizar os empreendimentos da conta: ${erroApagar.message}`, ok: false };
  }

  const linhas = [...new Set(empreendimentos.map((e) => String(e ?? "").trim()).filter(Boolean))].map(
    (enterprise_id) => ({ enterprise_id, usuario_id: usuarioId }),
  );
  if (linhas.length === 0) return { id: usuarioId, ok: true };

  const { error } = await client.from("apolo_incorporador_usuario_empreendimentos").insert(linhas);
  if (error) {
    return { erro: `Não foi possível gravar os empreendimentos da conta: ${error.message}`, ok: false };
  }
  return { id: usuarioId, ok: true };
}

function mensagemDeUsuario(mensagem: null | string | undefined, email: string): string {
  // Desde a 0094 o índice é POR PORTAL (`apolo_incorporador_usuarios_portal_email_uk`): o mesmo
  // e-mail pode ter conta em vários incorporadores, com senha própria em cada um; o que ele não
  // pode é repetir DENTRO do mesmo portal. O nome antigo fica no match para o caso de a migration
  // ainda não ter chegado no banco que atender esta chamada.
  if (
    mensagem?.includes("apolo_incorporador_usuarios_portal_email_uk") ||
    mensagem?.includes("apolo_incorporador_usuarios_email_uk")
  ) {
    return `O e-mail ${email} já tem conta neste portal. Em outro incorporador ele pode entrar; aqui é uma conta por pessoa.`;
  }
  return mensagem ?? "Não foi possível gravar o usuário.";
}
