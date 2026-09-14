// Quem pode cadastrar e editar gente no Setup do Hub, e o que cada um pode escrever.
//
// Existe porque o Setup só conhecia dois estados: admin (pode tudo) e o resto (não entra). O
// RH da casa precisa cadastrar pessoas em qualquer departamento — e NÃO pode virar admin por
// isso, nem de propósito nem por caminho torto. Regra do Lucas (14/09/2026): "ela cuida do RH
// da empresa, ou seja, ela pode cadastrar em qualquer setor ou departamento".
//
// ⚠️ ESTA FUNÇÃO É A ÚNICA DONA DA DECISÃO. A trava de admin estava espalhada em SEIS pontos
// (route.ts:106, :215, :411, :613, avatar/route.ts:175 e page.tsx:204). Seis cópias de uma
// regra de segurança divergem com o tempo, e a que diverge é a que abre a porta.
//
// ⚠️ A TELA NÃO PROTEGE NADA. O perfil chega no CORPO da requisição: tirar a opção "adm" do
// <select> não impede ninguém de mandar profile:"adm" no POST. A decisão vale no servidor.
//
// ⚠️ E TEM QUE RODAR ANTES DA ESCRITA NO AUTH. O papel real é propagado por TRIGGER
// (migration 0147: app_metadata.role escreve hub_users.role sozinho). Validar depois do
// `auth.admin.updateUserById` é validar depois de a promoção já ter acontecido.

export const PERMISSAO_GERIR_PESSOAS = "setup-usuarios";

export type PapelDoHub = "admin" | "leader" | "operator" | "viewer";

export type ChamadorDoSetup = {
  id: string;
  podeGerirPessoas: boolean;
  role: PapelDoHub | string | null;
  status?: string | null;
};

export type EscritaDePessoa = {
  /** Papel ATUAL do alvo. Nulo quando o alvo está sendo criado agora. */
  alvoRoleAtual?: PapelDoHub | string | null;
  /** Id do alvo. Ausente quando está criando alguém novo. */
  alvoUserId?: string | null;
  /** Quantos admins ativos existem hoje, para não trancar a casa. */
  adminsAtivos?: number;
  mudaEmail?: boolean;
  novoStatus?: string | null;
  perfilDesejado?: string | null;
};

export type Veredito = { motivo: string; ok: boolean };

// Monta o chamador a partir do banco: o papel vem de `hub_users` e a permissão de
// `hub_user_permissions`. Molde copiado de lib/ares/server.ts:1220-1236, que já roda em
// produção com a mesma tabela.
//
// ⚠️ SEMPRE PELO adminClient (service role). `hub_user_permissions` tem RLS ligada e ZERO
// policies: com o token do próprio usuário a consulta volta VAZIA, sem erro — e a pessoa
// perderia a permissão em silêncio.
export async function carregarChamadorDoSetup(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  adminClient: any,
  userId: string,
): Promise<ChamadorDoSetup | null> {
  const { data: usuario } = (await adminClient
    .from("hub_users")
    .select("id,role,status")
    .eq("id", userId)
    .maybeSingle()) as {
    data: { id: string; role: string; status: string } | null;
  };

  if (!usuario) {
    return null;
  }

  const { data: concessoes } = await adminClient
    .from("hub_user_permissions")
    .select("permission_id")
    .eq("user_id", userId)
    .eq("permission_id", PERMISSAO_GERIR_PESSOAS)
    .is("revoked_at", null);

  return {
    id: usuario.id,
    podeGerirPessoas: (concessoes ?? []).length > 0,
    role: usuario.role,
    status: usuario.status,
  };
}

// Os perfis que a tela oferece. Só `adm` vira role admin (route.ts:938) — os outros todos
// param em leader ou operator, e por isso são livres para quem gere pessoas.
const PERFIL_QUE_VIRA_ADMIN = "adm";

function estaAtivo(chamador: ChamadorDoSetup): boolean {
  return (chamador.status ?? "active") === "active";
}

export function ehAdmin(chamador: ChamadorDoSetup): boolean {
  return chamador.role === "admin" && estaAtivo(chamador);
}

export function podeAbrirSetupDePessoas(chamador: ChamadorDoSetup): boolean {
  if (!estaAtivo(chamador)) {
    return false;
  }

  return ehAdmin(chamador) || chamador.podeGerirPessoas === true;
}

export function podeEscreverPessoa(
  chamador: ChamadorDoSetup,
  escrita: EscritaDePessoa,
): Veredito {
  if (!podeAbrirSetupDePessoas(chamador)) {
    return { motivo: "sem permissao para gerir pessoas", ok: false };
  }

  const admin = ehAdmin(chamador);
  const alvoEhAdmin = escrita.alvoRoleAtual === "admin";
  const viraAdmin = escrita.perfilDesejado === PERFIL_QUE_VIRA_ADMIN;
  const desativa = Boolean(escrita.novoStatus && escrita.novoStatus !== "active");
  const rebaixa =
    alvoEhAdmin &&
    Boolean(escrita.perfilDesejado) &&
    escrita.perfilDesejado !== PERFIL_QUE_VIRA_ADMIN;

  // INVARIANTE 4, e vale ATÉ PARA ADMIN: tirar o último admin ativo tranca todo mundo para
  // fora do Setup, e não há por onde voltar sem ir ao banco na mão.
  if (alvoEhAdmin && (desativa || rebaixa) && (escrita.adminsAtivos ?? 0) <= 1) {
    return {
      motivo: "este e o ultimo admin ativo: desativa-lo tranca o Setup para todos",
      ok: false,
    };
  }

  if (admin) {
    return { motivo: "admin", ok: true };
  }

  // INVARIANTE 1 — conceder o perfil que vira admin é privilégio de admin.
  if (viraAdmin) {
    return { motivo: "so um admin concede o perfil de admin", ok: false };
  }

  // INVARIANTE 2 — a linha de um admin é intocável para os outros. Não é só o papel: o mesmo
  // caminho troca o E-MAIL com email_confirm, e isso é tomada de conta sem mexer em papel.
  if (alvoEhAdmin) {
    return { motivo: "so um admin edita a linha de um admin", ok: false };
  }

  // INVARIANTE 3 — editar o próprio cadastro é o caminho mais curto para a auto-promoção.
  if (escrita.alvoUserId && escrita.alvoUserId === chamador.id) {
    return { motivo: "nao e possivel editar o proprio cadastro", ok: false };
  }

  return { motivo: "gestao de pessoas", ok: true };
}
