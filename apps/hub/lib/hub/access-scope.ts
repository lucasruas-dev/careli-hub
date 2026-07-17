// Régua de acesso do hub (decisão do Lucas, 15/jul).
//
// Quem enxerga o quê sai do PERFIL do usuário logado (hub_users.operational_profile)
// cruzado com os vínculos dele (hub_user_assignments: departamento + setor) e com
// os vínculos do RECURSO (hoje: a fila da Iris — caredesk_queue_scopes).
//
//   op1 / op2 / op3 / ldr  -> vínculo do SEU SETOR, ou vínculo de DEPARTAMENTO
//                             INTEIRO que seja um departamento seu
//   cdr                    -> qualquer vínculo do SEU DEPARTAMENTO
//   adm                    -> tudo
//
// Regras de borda decididas pelo Lucas:
//   • Recurso SEM nenhum vínculo -> só adm.
//   • Usuário com VÁRIOS vínculos ativos -> soma todos (não só o is_primary).
//   • Fora do escopo = não existe (nem lista, nem métrica) — não é "vê sem responder".
//   • O recurso pode ter VÁRIOS vínculos (ex.: Grupo/Direct = Operação + Relação).
//
// Isto é a régua da APLICAÇÃO. A segurança de verdade (impedir leitura direta no
// banco) é a camada de RLS, tratada à parte.

export type HubOperationalProfile = "op1" | "op2" | "op3" | "ldr" | "cdr" | "adm";

export type HubUserScope = {
  profile: HubOperationalProfile | null;
  departmentIds: string[];
  sectorIds: string[];
};

// Um vínculo do recurso. sectorId null = departamento inteiro.
export type ResourceScope = {
  departmentId: string | null;
  sectorId: string | null;
};

export function isAdminProfile(profile: string | null | undefined): boolean {
  return profile === "adm";
}

// cdr enxerga no nível de DEPARTAMENTO; op*/ldr no nível de SETOR.
export function seesByDepartment(profile: string | null | undefined): boolean {
  return profile === "cdr";
}

function matchesScope(user: HubUserScope, scope: ResourceScope): boolean {
  const { departmentId, sectorId } = scope;

  if (seesByDepartment(user.profile)) {
    // cdr: basta o vínculo ser de um departamento dele (com ou sem setor).
    return Boolean(departmentId && user.departmentIds.includes(departmentId));
  }

  // op1/op2/op3/ldr
  if (sectorId) {
    return user.sectorIds.includes(sectorId);
  }

  // Vínculo de departamento inteiro: vale pra quem é de qualquer setor dele.
  return Boolean(departmentId && user.departmentIds.includes(departmentId));
}

export function canSeeResource(
  user: HubUserScope,
  scopes: ResourceScope[],
): boolean {
  if (isAdminProfile(user.profile)) {
    return true;
  }

  // Sem vínculo nenhum = só adm (que já retornou acima).
  if (scopes.length === 0) {
    return false;
  }

  return scopes.some((scope) => matchesScope(user, scope));
}
