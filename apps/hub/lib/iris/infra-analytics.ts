// Saúde de infra (Vercel + Supabase) para o modo ASSISTENTE da CACÁ. Usa tokens de API do
// ambiente (VERCEL_API_TOKEN, SUPABASE_ACCESS_TOKEN) — sensíveis, por isso só no modo admin.
// Degrada com elegância quando falta token. Ver [[project-caca-admin-assistant-mode]].

const VERCEL_PROJECT_ID = "prj_7pgq969nAKwdNKSY3YoMFlxU6qdK";
const VERCEL_TEAM_ID = "team_0AsY43vvHN2fwEkcN8u5LKXX";
const SUPABASE_REF = "bxgukywoxgivlrhjkwjx";

export type InfraSaude = {
  vercel: string;
  supabase: string;
};

async function checkVercel(): Promise<string> {
  const token = process.env.VERCEL_API_TOKEN?.trim();

  if (!token) {
    return "Vercel: sem token de API configurado (não consigo checar agora).";
  }

  try {
    const response = await fetch(
      `https://api.vercel.com/v6/deployments?projectId=${VERCEL_PROJECT_ID}&teamId=${VERCEL_TEAM_ID}&limit=10&target=production`,
      { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" },
    );

    if (!response.ok) {
      return `Vercel: não consegui consultar (HTTP ${response.status}).`;
    }

    const payload = (await response.json()) as {
      deployments?: { state?: string; readyState?: string; createdAt?: number }[];
    };
    const deployments = payload.deployments ?? [];
    const latest = deployments[0];
    const latestState = latest?.readyState ?? latest?.state ?? "desconhecido";
    const erros = deployments.filter(
      (d) => (d.readyState ?? d.state) === "ERROR",
    ).length;

    return `Vercel: último deploy de produção = ${latestState}; ${erros} deploy(s) com erro nos últimos 10.`;
  } catch (error) {
    return `Vercel: falha ao consultar (${error instanceof Error ? error.message : "erro"}).`;
  }
}

async function checkSupabase(): Promise<string> {
  const token = process.env.SUPABASE_ACCESS_TOKEN?.trim();

  if (!token) {
    return "Supabase: sem token de API configurado (não consigo checar advisors agora).";
  }

  try {
    const fetchLints = async (type: "security" | "performance") => {
      const response = await fetch(
        `https://api.supabase.com/v1/projects/${SUPABASE_REF}/advisors/${type}`,
        { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" },
      );

      if (!response.ok) {
        return null;
      }

      const payload = (await response.json()) as { lints?: unknown[] };

      return payload.lints?.length ?? 0;
    };

    const [security, performance] = await Promise.all([
      fetchLints("security"),
      fetchLints("performance"),
    ]);

    if (security == null && performance == null) {
      return "Supabase: não consegui consultar os advisors.";
    }

    return `Supabase: ${security ?? "?"} alerta(s) de segurança e ${performance ?? "?"} de performance nos advisors.`;
  } catch (error) {
    return `Supabase: falha ao consultar (${error instanceof Error ? error.message : "erro"}).`;
  }
}

export async function loadInfraSaude(): Promise<InfraSaude> {
  const [vercel, supabase] = await Promise.all([checkVercel(), checkSupabase()]);

  return { supabase, vercel };
}
