// Régua de acesso do hub (decisão do Lucas, 15/jul).
//
// Quem enxerga o quê sai do PERFIL do usuário logado (hub_users.operational_profile)
// cruzado com os vínculos dele (hub_user_assignments: departamento + setor):
//
//   op1 / op2 / op3 / ldr  -> só o que estiver vinculado ao SEU SETOR
//   cdr                    -> tudo do SEU DEPARTAMENTO (todos os setores dele)
//   adm                    -> tudo
//
// Regras de borda decididas pelo Lucas:
//   • Recurso SEM vínculo (sem setor e sem departamento) -> só adm.
//   • Usuário com VÁRIOS vínculos ativos -> soma todos (não só o is_primary).
//   • Fora do escopo = não existe (nem lista, nem métrica) — não é "vê sem responder".
//
// Isto é a régua da APLICAÇÃO. A segurança de verdade (impedir leitura direta no
// banco) é a camada de RLS, tratada à parte.

export type HubOperationalProfile = "op1" | "op2" | "op3" | "ldr" | "cdr" | "adm";

export type HubUserScope = {
  profile: HubOperationalProfile | null;
  departmentIds: string[];
  sectorIds: string[];
};

// Recurso que carrega o vínculo (hoje: fila da Iris; amanhã: o que precisar).
export type ScopedResource = {
  departmentId?: string | null;
  sectorId?: string | null;
};

export function isAdminProfile(profile: string | null | undefined): boolean {
  return profile === "adm";
}

// cdr enxerga no nível de DEPARTAMENTO; op*/ldr no nível de SETOR.
export function seesByDepartment(profile: string | null | undefined): boolean {
  return profile === "cdr";
}

export function canSeeScopedResource(
  scope: HubUserScope,
  resource: ScopedResource,
): boolean {
  if (isAdminProfile(scope.profile)) {
    return true;
  }

  const departmentId = resource.departmentId ?? null;
  const sectorId = resource.sectorId ?? null;

  // Sem vínculo nenhum = só adm (que já retornou acima).
  if (!departmentId && !sectorId) {
    return false;
  }

  if (seesByDepartment(scope.profile)) {
    // cdr: pelo departamento do recurso; se o recurso só tem setor, aceita quando
    // esse setor pertence a um departamento dele (o chamador resolve o de-para).
    return Boolean(departmentId && scope.departmentIds.includes(departmentId));
  }

  // op1/op2/op3/ldr: só o próprio setor.
  return Boolean(sectorId && scope.sectorIds.includes(sectorId));
}

// Resolve o de-para setor->departamento antes de aplicar a régua, pra o cdr
// enxergar fila que só tem setor preenchido (o departamento vem do setor).
export function resolveResourceScope(
  resource: ScopedResource,
  sectorToDepartment: Map<string, string | null>,
): ScopedResource {
  const sectorId = resource.sectorId ?? null;
  const departmentId =
    resource.departmentId ??
    (sectorId ? (sectorToDepartment.get(sectorId) ?? null) : null);

  return { departmentId, sectorId };
}
