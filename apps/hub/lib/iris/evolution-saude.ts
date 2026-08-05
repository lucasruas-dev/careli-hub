import { createClient } from "@supabase/supabase-js";

import { publishHubNotification } from "@/lib/notifications/publish";
import { getServerSupabaseConfig } from "@/lib/supabase/server-config";

// VIGIA DA CONEXÃO DOS GRUPOS (Evolution / número observador).
//
// Por que existe: em 03/08 a sessão do WhatsApp do observador caiu às 7h57 e ninguém percebeu
// até as 14h41 — quase 7 horas com os grupos MUDOS nos dois sentidos. Descobrimos pelo pior
// caminho: a operadora tentou responder um cliente e levou erro na cara.
//
// A queda é silenciosa por natureza: o servidor Evolution continua de pé, o webhook continua
// registrado, e só a sessão do WhatsApp morre. Nada quebra visivelmente — as mensagens
// simplesmente param de chegar, o que é indistinguível de "ninguém escreveu hoje".
//
// AVISA NA VIRADA, não a cada verificação: cair gera UM aviso, voltar gera outro. Sem isso o
// alarme viraria ruído e o time aprenderia a ignorá-lo — que é como alarme de verdade morre.

const INSTANCIA = process.env.EVOLUTION_INSTANCE || "caca-observadora";
// A MEMÓRIA DO ESTADO É A PRÓPRIA NOTIFICAÇÃO: a última que este vigia publicou diz se o
// alarme está aceso ou apagado (context.vigia = 'evolution-conexao'). Sem tabela nova, sem
// migration — e como o histórico fica visível na central, dá para auditar as quedas depois.
const MARCA_VIGIA = "evolution-conexao";

export type SaudeEvolution = {
  detalhe?: string;
  estado: "open" | "close" | "connecting" | "desconhecido";
  ok: boolean;
};

export async function lerEstadoDaConexao(): Promise<SaudeEvolution> {
  const url = process.env.EVOLUTION_API_URL?.replace(/\/+$/, "");
  const apiKey = process.env.EVOLUTION_API_KEY;
  if (!url || !apiKey) {
    return { detalhe: "Evolution não configurado", estado: "desconhecido", ok: false };
  }

  try {
    const abort = new AbortController();
    const t = setTimeout(() => abort.abort(), 10_000);
    const resposta = await fetch(`${url}/instance/connectionState/${INSTANCIA}`, {
      cache: "no-store",
      headers: { apikey: apiKey },
      signal: abort.signal,
    });
    clearTimeout(t);

    if (!resposta.ok) {
      return {
        detalhe: `Evolution respondeu ${resposta.status}`,
        estado: "desconhecido",
        ok: false,
      };
    }

    const corpo = (await resposta.json()) as { instance?: { state?: string } };
    const estado = (corpo.instance?.state ?? "desconhecido") as SaudeEvolution["estado"];
    return { estado, ok: estado === "open" };
  } catch (erro) {
    return {
      detalhe: erro instanceof Error ? erro.message : "sem resposta",
      estado: "desconhecido",
      ok: false,
    };
  }
}

function admin() {
  const { serviceRoleKey, url } = getServerSupabaseConfig();
  if (!url || !serviceRoleKey) return null;
  return createClient(url, serviceRoleKey, { auth: { persistSession: false } });
}

// Quem recebe o alarme: os admins do hub (mesmo público do Zeus).
async function destinatarios(client: NonNullable<ReturnType<typeof admin>>) {
  const { data } = await client
    .from("hub_users")
    .select("id")
    .or("role.eq.admin,operational_profile.eq.adm")
    .limit(20);
  return ((data ?? []) as { id: string }[]).map((u) => u.id);
}

export type ResultadoVigia = {
  avisou: boolean;
  estado: SaudeEvolution["estado"];
  mudou: boolean;
  ok: boolean;
};

export async function vigiarConexaoDosGrupos(): Promise<ResultadoVigia> {
  const saude = await lerEstadoDaConexao();
  const client = admin();
  if (!client) return { avisou: false, estado: saude.estado, mudou: false, ok: saude.ok };

  // Último aviso que ESTE vigia publicou (qualquer destinatário serve — todos recebem juntos).
  const { data: ultimo } = await client
    .from("hub_notifications")
    .select("context")
    .eq("context->>vigia", MARCA_VIGIA)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ context: { situacao?: string } }>();

  const anterior = ultimo?.context?.situacao ?? "open";
  const atual = saude.ok ? "open" : "caiu";
  const mudou = anterior !== atual;

  if (mudou) {
    const users = await destinatarios(client);
    if (users.length) {
      const caiu = atual === "caiu";
      await publishHubNotification({
        actionHref: "/iris",
        body: caiu
          ? `A sessão do WhatsApp dos grupos caiu (estado: ${saude.estado}${saude.detalhe ? ` · ${saude.detalhe}` : ""}). Enquanto isso ninguém recebe nem envia mensagem nos grupos. É preciso reconectar o número observador pelo QR.`
          : "A sessão do WhatsApp dos grupos voltou. Mensagens fluindo nos dois sentidos.",
        // `situacao` + `vigia` são a memória de estado lida no início desta função.
        context: {
          detalhe: saude.detalhe ?? null,
          estado: saude.estado,
          instancia: INSTANCIA,
          situacao: atual,
          vigia: MARCA_VIGIA,
        },
        kind: "alerta",
        moduleId: "caredesk",
        recipientUserIds: users,
        severity: caiu ? "danger" : "success",
        title: caiu ? "Grupos de WhatsApp OFFLINE" : "Grupos de WhatsApp de volta",
      });
    }
    // Log sempre — os grupos mudos passaram 7h despercebidos em 03/08.
    console.warn(`[iris][evolution] conexão dos grupos: ${anterior} -> ${atual} (${saude.estado})`);
  }

  return { avisou: mudou, estado: saude.estado, mudou, ok: saude.ok };
}
