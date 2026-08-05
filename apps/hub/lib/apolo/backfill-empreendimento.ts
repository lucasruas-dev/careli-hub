// BACKFILL do empreendimento na esteira, buscando no Asana.
//
// Fichas que entram na esteira FORA do import do Asana (ex.: cadastro manual do prospect) podem
// ficar SEM empreendimento. Sem ele, o aviso de reprovação ao coordenador falha (não dá pra saber
// qual coordenador avisar) e a ficha some dos relatórios da imobiliária (que filtram por
// empreendimento). Esta varredura pega as fichas sem empreendimento, procura cada uma no Asana
// pelo NOME (a MESMA regra do import — `casarComApolo`) e, quando casa com UMA CAD de
// empreendimento conhecido e SEM divergência, preenche.
//
// Segurança: READ-ONLY no Asana; a única escrita é preencher o campo VAZIO da esteira (nunca
// sobrescreve um empreendimento já gravado). Só aplica o casamento EXATO (1 candidato) e
// consistente (todas as CADs da pessoa no mesmo empreendimento); o resto vira lista de
// conferência, nunca é gravado no chute — é o mesmo princípio do preview de importação.
import { casarComApolo, escanearCads } from "@/lib/apolo/asana-import";
import type { createApoloAdminClient } from "@/lib/apolo/server";

type AdminClient = NonNullable<ReturnType<typeof createApoloAdminClient>>;

export type BackfillResultado = {
  // Casou com CADs de empreendimentos diferentes, ou falhou ao gravar: precisa de conferência.
  ambiguos: { motivo: string; nome: string }[];
  atualizados: { empreendimento: string; nome: string }[];
  // Órfã que não casou com nenhuma CAD do Asano (não tem CAD lá, ou o nome diverge).
  semCadNoAsana: { nome: string }[];
  totalSemEmpreendimento: number;
};

function norm(v: string | null | undefined): string {
  return String(v ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export async function backfillEmpreendimentoViaAsana(
  client: AdminClient,
  opts?: { dryRun?: boolean },
): Promise<BackfillResultado> {
  const dryRun = opts?.dryRun ?? false;

  // 1) Fichas sem empreendimento na esteira (null ou vazio), com o nome pra casar e reportar.
  //
  // ⚠️ FERRAMENTA DE CONSERTO, HOJE SEM ASSUNTO. A migration 0080 tornou `enterprise_id`
  // obrigatório e parte da chave, então "CAD sem empreendimento" deixou de existir: rodar isto
  // num banco migrado devolve zero. Fica porque `empreendimento` (o TEXTO) ainda pode estar em
  // branco em linhas antigas, e é dele que o Board tira o rótulo.
  const { data: esteiraData } = await client
    .from("apolo_esteira")
    .select("entity_id, enterprise_id, empreendimento");
  const orfaIds = ((esteiraData ?? []) as { empreendimento: string | null; entity_id: string }[])
    .filter((r) => !(r.empreendimento ?? "").trim())
    .map((r) => r.entity_id);

  const resultado: BackfillResultado = {
    ambiguos: [],
    atualizados: [],
    semCadNoAsana: [],
    totalSemEmpreendimento: orfaIds.length,
  };
  if (orfaIds.length === 0) return resultado;

  // Nome de cada órfã (pra casar e reportar). O casamento é por nome; o id é a chave.
  const nomePorId = new Map<string, string>();
  for (let i = 0; i < orfaIds.length; i += 300) {
    const { data } = await client
      .from("apolo_entities")
      .select("id, display_name, legal_name")
      .in("id", orfaIds.slice(i, i + 300));
    for (const e of (data ?? []) as Array<{
      display_name: string | null;
      id: string;
      legal_name: string | null;
    }>) {
      nomePorId.set(e.id, (e.legal_name || e.display_name || "").trim() || "Sem nome");
    }
  }
  const orfas = new Set(orfaIds);

  // 2) Todas as CADs do Asana (cada uma com seu empreendimento no custom field).
  const { cads } = await escanearCads({ empreendimento: "", secoes: [] });

  // 3) Casa CAD -> entidade pelo nome (a mesma regra do import). Só os casados exatos (1
  //    candidato) contam; ambíguos por homônimo já ficam de fora aqui.
  const preview = await casarComApolo(client, cads);

  // 4) Agrupa, por entidade órfã, os empreendimentos das CADs que casaram com ela.
  const porEntidade = new Map<string, { brutoPorChave: Map<string, string>; chaves: Set<string> }>();
  for (const item of [...preview.casados, ...preview.jaImportados]) {
    const ent = item.candidatos[0];
    if (!ent || !orfas.has(ent.id)) continue;
    const emp = (item.cad.empreendimento ?? "").trim();
    if (!emp) continue;
    const chave = norm(emp);
    if (!chave) continue;
    const g = porEntidade.get(ent.id) ?? { brutoPorChave: new Map(), chaves: new Set() };
    g.chaves.add(chave);
    if (!g.brutoPorChave.has(chave)) g.brutoPorChave.set(chave, emp);
    porEntidade.set(ent.id, g);
  }

  // 5) Aplica quando há UM empreendimento consistente para a pessoa.
  for (const [entityId, g] of porEntidade) {
    const nome = nomePorId.get(entityId) ?? "Sem nome";
    if (g.chaves.size > 1) {
      resultado.ambiguos.push({
        motivo: `CADs em empreendimentos diferentes: ${[...g.brutoPorChave.values()].join(", ")}`,
        nome,
      });
      continue;
    }
    const chave = [...g.chaves][0]!;
    const empreendimento = g.brutoPorChave.get(chave)!;
    if (!dryRun) {
      // Sem `enterprise_id` no filtro de propósito: o alvo é justamente a linha SEM nome de
      // empreendimento (`is null`), e o `is null` sozinho já a isola — nenhuma CAD que tem nome
      // é tocada.
      const { error } = await client
        .from("apolo_esteira")
        .update({ atualizado_em: new Date().toISOString(), empreendimento })
        .eq("entity_id", entityId)
        .is("empreendimento", null);
      if (error) {
        resultado.ambiguos.push({ motivo: `falha ao gravar: ${error.message}`, nome });
        continue;
      }
    }
    resultado.atualizados.push({ empreendimento, nome });
  }

  // 6) Órfãs que não casaram com nenhuma CAD do Asana.
  for (const id of orfaIds) {
    if (!porEntidade.has(id)) {
      resultado.semCadNoAsana.push({ nome: nomePorId.get(id) ?? "Sem nome" });
    }
  }

  return resultado;
}
