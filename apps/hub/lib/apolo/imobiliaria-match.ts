// DE-PARA das imobiliárias das CADs -> entidade do Apolo.
//
// A imobiliária vive como TEXTO na esteira; a entidade dela existe no Apolo (veio do C2X), mas
// nunca foi ligada. Aqui o operador casa MANUALMENTE cada nome-texto com a entidade certa. O
// casamento fica em `apolo_imobiliaria_match` (chave = nome normalizado). Um passo posterior de
// "match" propaga isso para a esteira e os relacionamentos.
import type { createApoloAdminClient } from "@/lib/apolo/server";

type AdminClient = NonNullable<ReturnType<typeof createApoloAdminClient>>;

const TABLE = "apolo_imobiliaria_match";

// Sem acento, minúsculo, espaço colapsado — a chave de casamento. O mesmo nome vem com grafias
// ligeiramente diferentes do Asana/C2X; queremos um vínculo por imobiliária, não por variação.
export function normalizarNome(v: string | null | undefined): string {
  return String(v ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function tabelaAusente(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return error.code === "42P01" || /does not exist/i.test(error.message ?? "");
}

export type ImobiliariaDaCad = {
  cads: number;
  // A entidade vinculada (se já casada).
  entidade: { documento: string | null; id: string; nome: string } | null;
  nomeNormalizado: string;
  nomeTexto: string;
};

// Lista os nomes-texto distintos de imobiliária nas CADs (esteira), com a contagem e o match atual.
export async function listarImobiliariasDasCads(
  client: AdminClient,
): Promise<ImobiliariaDaCad[]> {
  // ⚠️ A CONTAGEM PASSOU A SER DE **CADs**, NÃO DE PESSOAS (0080: uma linha por CAD). Para o que
  // esta tela faz — padronizar a grafia do nome da imobiliária e mostrar quantas CADs cada
  // grafia tem — CAD é a unidade certa: a mesma pessoa em dois loteamentos pode ter vindo por
  // duas imobiliárias diferentes, e cada uma conta na sua.
  const { data: esteira } = await client
    .from("apolo_esteira")
    .select("imobiliaria")
    .not("imobiliaria", "is", null);

  // Agrupa por nome normalizado, guardando a grafia mais frequente e a contagem.
  const grupos = new Map<string, { contagem: number; grafias: Map<string, number> }>();
  for (const linha of (esteira ?? []) as { imobiliaria: string | null }[]) {
    const texto = (linha.imobiliaria ?? "").trim();
    if (!texto) continue;
    const chave = normalizarNome(texto);
    const g = grupos.get(chave) ?? { contagem: 0, grafias: new Map() };
    g.contagem += 1;
    g.grafias.set(texto, (g.grafias.get(texto) ?? 0) + 1);
    grupos.set(chave, g);
  }

  // Matches já salvos, com o nome da entidade.
  const matches = new Map<string, { documento: string | null; id: string; nome: string } | null>();
  const { data: salvos, error } = await client
    .from(TABLE)
    .select("nome_normalizado, entity_id");
  if (!error) {
    const ids = [
      ...new Set(
        ((salvos ?? []) as { entity_id: string | null }[])
          .map((s) => s.entity_id)
          .filter((v): v is string => Boolean(v)),
      ),
    ];
    const nomePorId = new Map<string, { documento: string | null; nome: string }>();
    for (let i = 0; i < ids.length; i += 300) {
      const { data: ents } = await client
        .from("apolo_entities")
        .select("id, display_name, legal_name, document_masked")
        .in("id", ids.slice(i, i + 300));
      for (const e of (ents ?? []) as Array<{
        display_name: string | null;
        document_masked: string | null;
        id: string;
        legal_name: string | null;
      }>) {
        nomePorId.set(e.id, {
          documento: e.document_masked,
          nome: (e.legal_name || e.display_name || "").trim() || "Sem nome",
        });
      }
    }
    for (const s of (salvos ?? []) as { entity_id: string | null; nome_normalizado: string }[]) {
      const ent = s.entity_id ? nomePorId.get(s.entity_id) : null;
      matches.set(
        s.nome_normalizado,
        ent && s.entity_id ? { documento: ent.documento, id: s.entity_id, nome: ent.nome } : null,
      );
    }
  }

  const lista: ImobiliariaDaCad[] = [];
  for (const [chave, g] of grupos) {
    const grafiaMaisComum = [...g.grafias.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? chave;
    lista.push({
      cads: g.contagem,
      entidade: matches.get(chave) ?? null,
      nomeNormalizado: chave,
      nomeTexto: grafiaMaisComum,
    });
  }

  // Mais CADs primeiro (as que mais importam vincular).
  lista.sort((a, b) => b.cads - a.cads);
  return lista;
}

// As ENTIDADES imobiliária candidatas (papel 'imobiliaria' no Apolo) para o seletor do de-para
// vêm de `loadApoloImobiliarias` (server.ts) — a mesma fonte que o cadastro de CAD usa. São ~413,
// todas com contato, então o front carrega a lista e filtra localmente.

// Salva (ou desfaz) o casamento de um nome-texto com uma entidade. entityId null = desvincula.
export async function salvarMatchImobiliaria(
  client: AdminClient,
  input: { entityId: string | null; nomeTexto: string; userId?: string | null },
): Promise<{ error?: string; ok: boolean }> {
  const nomeTexto = input.nomeTexto.trim();
  const nomeNormalizado = normalizarNome(nomeTexto);
  if (!nomeNormalizado) return { error: "Nome inválido.", ok: false };

  const { error } = await client.from(TABLE).upsert(
    {
      entity_id: input.entityId,
      nome_normalizado: nomeNormalizado,
      nome_texto: nomeTexto,
      updated_at: new Date().toISOString(),
      vinculado_em: input.entityId ? new Date().toISOString() : null,
      vinculado_por: input.entityId ? (input.userId ?? null) : null,
    },
    { onConflict: "nome_normalizado" },
  );

  if (error) {
    if (tabelaAusente(error)) {
      return { error: "Tabela de vínculo ainda não existe (migration 0068 pendente).", ok: false };
    }
    return { error: `Não foi possível salvar: ${error.message}`, ok: false };
  }
  return { ok: true };
}
