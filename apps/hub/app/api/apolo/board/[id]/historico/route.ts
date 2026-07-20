import { NextResponse } from "next/server";

import { authorizeApoloRead } from "@/lib/apolo/auth";
import { createApoloAdminClient } from "@/lib/apolo/server";

// HISTÓRICO da ficha: o que mudou, para qual valor e quem — exigência do Lucas para poder
// validar depois. Os dados já são gravados a cada salvamento (`edit_ficha`, uma linha por
// campo) e a cada correção de identidade (`edit_identity`); aqui eles viram uma lista legível.
//
// AGRUPADO POR EDIÇÃO: quando o operador salva 13 campos de uma vez, isso é UM evento com 13
// alterações, não 13 eventos. O agrupamento é por autor + minuto, que é o que o salvamento
// único produz.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Rótulo legível de cada campo. Sem isto o histórico fala "escolaridadeId", que não diz nada
// para quem está conferindo.
const ROTULOS: Record<string, string> = {
  bairro: "Bairro",
  cep: "CEP",
  cidade: "Cidade",
  complemento: "Complemento",
  conjugeCpf: "Cônjuge · CPF",
  conjugeEmail: "Cônjuge · E-mail",
  conjugeMae: "Cônjuge · Nome da mãe",
  conjugeNascimento: "Cônjuge · Nascimento",
  conjugeNome: "Cônjuge · Nome",
  conjugeTelefone: "Cônjuge · Telefone",
  dataNascimento: "Nascimento",
  email: "E-mail",
  escolaridadeId: "Escolaridade",
  estadoCivilId: "Estado civil",
  identidade: "Identidade (nome/documento/tipo)",
  logradouro: "Logradouro",
  nacionalidade: "Nacionalidade",
  naturalidade: "Naturalidade",
  nomeMae: "Nome da mãe",
  numero: "Número",
  patrimonio: "Patrimônio",
  profissaoId: "Profissão",
  regimeBensId: "Regime de bens",
  rendaId: "Faixa de renda",
  rg: "RG",
  sexoId: "Sexo",
  telefone: "Telefone",
  uf: "UF",
};

type LinhaAuditoria = {
  action: string;
  actor_user_id: string | null;
  created_at: string;
  field_name: string | null;
  metadata: Record<string, unknown> | null;
};

function comoTexto(valor: unknown): string {
  if (valor === null || valor === undefined || valor === "") return "—";
  if (typeof valor === "string") return valor;
  // Identidade guarda um objeto {nome, documento, tipo}.
  if (typeof valor === "object") {
    const o = valor as Record<string, unknown>;
    return [o.nome, o.documento, o.tipo].filter(Boolean).join(" · ");
  }
  return String(valor);
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await authorizeApoloRead(request);
  if (!auth.ok) return auth.response;

  const client = createApoloAdminClient();
  if (!client) {
    return NextResponse.json({ error: "Supabase indisponivel." }, { status: 503 });
  }

  const { id } = await context.params;

  const { data } = await client
    .from("apolo_audit_events")
    .select("action, actor_user_id, created_at, field_name, metadata")
    .eq("entity_id", id)
    .in("action", ["edit_ficha", "edit_identity"])
    .order("created_at", { ascending: false })
    .limit(300);

  const linhas = (data ?? []) as LinhaAuditoria[];

  // Nome de quem editou, em uma consulta só.
  const autores = [...new Set(linhas.map((l) => l.actor_user_id).filter(Boolean))] as string[];
  const nomePorId = new Map<string, string>();
  if (autores.length > 0) {
    const { data: usuarios } = await client
      .from("hub_users")
      .select("id, display_name, email")
      .in("id", autores);
    for (const u of (usuarios ?? []) as {
      display_name: string | null;
      email: string | null;
      id: string;
    }[]) {
      nomePorId.set(u.id, u.display_name || u.email || "—");
    }
  }

  const porEdicao = new Map<
    string,
    { alteracoes: { campo: string; de: string; para: string }[]; autor: string; quando: string }
  >();

  for (const linha of linhas) {
    // Chave do agrupamento: autor + minuto. Um "Salvar alterações" grava tudo no mesmo minuto.
    const minuto = linha.created_at.slice(0, 16);
    const chave = `${linha.actor_user_id ?? "sistema"}|${minuto}`;

    if (!porEdicao.has(chave)) {
      porEdicao.set(chave, {
        alteracoes: [],
        autor: linha.actor_user_id ? (nomePorId.get(linha.actor_user_id) ?? "—") : "Sistema",
        quando: linha.created_at,
      });
    }

    const campo = linha.field_name ?? "";
    porEdicao.get(chave)!.alteracoes.push({
      campo: ROTULOS[campo] ?? campo,
      de: comoTexto(linha.metadata?.de),
      para: comoTexto(linha.metadata?.para),
    });
  }

  return NextResponse.json(
    { data: { edicoes: [...porEdicao.values()] } },
    { headers: { "Cache-Control": "no-store" } },
  );
}
