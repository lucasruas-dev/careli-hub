// Importação das CADs do Asana para o Board do Apolo — PRIMEIRO LOTE: a seção "Finalizado".
//
// Por que este lote primeiro (ideia do Lucas 19/jul): as CADs finalizadas JÁ VIRARAM cadastro
// no Apolo. Então não precisamos ler documento nenhum — basta casar pelo nome e marcar como
// credenciado. **Custo zero na MOST**, e serve de ensaio da mecânica antes de encarar as
// seções que exigem iOCR (R$ 0,506 por imagem, ver lib/apolo/most-precos.ts).
//
// Nada aqui escreve sem confirmação explícita: `escanear` é read-only e devolve as três
// listas (casou / ambíguo / não casou) para uma pessoa conferir. Casar nome errado significa
// credencial impressa com o nome trocado no dia do evento.
import type { createApoloAdminClient } from "@/lib/apolo/server";

type AdminClient = NonNullable<ReturnType<typeof createApoloAdminClient>>;

const ASANA_API = "https://app.asana.com/api/1.0";
const PROJETO_CADS = process.env.ASANA_CAD_PROJECT_GID?.trim() || "1209726796886414";

// Onde a task fica no Asana → onde ela cai na esteira do Board.
export const DESTINO_POR_SECAO: Record<string, "validacao" | "credenciado"> = {
  "em cadastro": "validacao",
  finalizada: "credenciado",
  finalizado: "credenciado",
  "recepcao de cad": "validacao",
};

export type CadDoAsana = {
  corretor: string | null;
  criadoEm: string | null;
  empreendimento: string | null;
  gid: string;
  imobiliaria: string | null;
  nome: string;
  secao: string;
};

export type EntidadeCandidata = {
  documento: string | null;
  id: string;
  nome: string;
};

export type ItemCasado = {
  cad: CadDoAsana;
  // > 1 candidato = ambíguo: NÃO aplicar sozinho.
  candidatos: EntidadeCandidata[];
  jaImportado: boolean;
};

export type PreviewImportacao = {
  ambiguos: ItemCasado[];
  casados: ItemCasado[];
  jaImportados: ItemCasado[];
  naoCasados: ItemCasado[];
  secoesEncontradas: string[];
  total: number;
};

function token(): string {
  return process.env.ASANA_ACCESS_TOKEN?.trim() ?? "";
}

export function asanaConfigurado(): boolean {
  return token().length > 0;
}

// Tira acento, caixa e espaço repetido. É a chave de comparação entre Asana e Apolo — os dois
// foram digitados por pessoas diferentes, em momentos diferentes.
export function normalizarNome(valor: string | null | undefined): string {
  return String(valor ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizarSecao(nome: string): string {
  return normalizarNome(nome);
}

type TaskAsana = {
  completed: boolean;
  created_at: string | null;
  custom_fields?: { display_value?: string | null; name?: string | null }[] | null;
  gid: string;
  memberships?: {
    project?: { gid?: string | null } | null;
    section?: { name?: string | null } | null;
  }[];
  name: string;
};

// Os campos têm nome inconsistente entre empreendimentos (o da imobiliária muda de nome em
// cada um), então procuramos por pedaço do nome em vez de igualdade.
function valorDoCampo(
  task: TaskAsana,
  contem: string[],
  precisaConter?: string,
): string | null {
  for (const campo of task.custom_fields ?? []) {
    const nome = normalizarNome(campo.name);
    const valor = (campo.display_value ?? "").trim();
    if (!valor) continue;
    if (!contem.some((pedaco) => nome.includes(pedaco))) continue;
    if (precisaConter && !nome.includes(precisaConter)) continue;
    return valor;
  }
  return null;
}

function secaoDaTask(task: TaskAsana): string {
  const daqui = (task.memberships ?? []).find(
    (m) => m.project?.gid === PROJETO_CADS,
  );
  return (daqui?.section?.name ?? task.memberships?.[0]?.section?.name ?? "").trim();
}

// Varre o projeto inteiro (paginado) e devolve as CADs do empreendimento pedido.
// READ-ONLY e sem custo: nenhuma leitura de documento acontece aqui.
export async function escanearCads(input: {
  empreendimento: string;
  secoes: string[];
}): Promise<{ cads: CadDoAsana[]; secoesEncontradas: string[] }> {
  const alvoEmpreendimento = normalizarNome(input.empreendimento);
  const alvoSecoes = input.secoes.map(normalizarSecao);

  const cads: CadDoAsana[] = [];
  const secoesEncontradas = new Set<string>();
  let offset: string | undefined;

  for (let pagina = 0; pagina < 40; pagina += 1) {
    const params: Record<string, string> = {
      limit: "100",
      opt_fields:
        "gid,name,completed,created_at,memberships.project.gid,memberships.section.name,custom_fields.name,custom_fields.display_value",
    };
    if (offset) params.offset = offset;

    const url = new URL(`${ASANA_API}/projects/${PROJETO_CADS}/tasks`);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

    const resposta = await fetch(url, {
      cache: "no-store",
      headers: { Authorization: `Bearer ${token()}` },
    });
    if (!resposta.ok) {
      throw new Error(`Asana respondeu HTTP ${resposta.status} ao listar as CADs.`);
    }
    const envelope = (await resposta.json()) as {
      data: TaskAsana[];
      next_page?: { offset?: string | null } | null;
    };

    for (const task of envelope.data ?? []) {
      if (task.completed) continue;

      const secao = secaoDaTask(task);
      if (secao) secoesEncontradas.add(secao);

      const empreendimento = valorDoCampo(task, ["empreendimento"], "indica")
        ?? valorDoCampo(task, ["empreendimento"]);

      const bateEmpreendimento =
        !alvoEmpreendimento || normalizarNome(empreendimento).includes(alvoEmpreendimento);
      const bateSecao =
        alvoSecoes.length === 0 || alvoSecoes.includes(normalizarSecao(secao));

      if (!bateEmpreendimento || !bateSecao) continue;

      cads.push({
        corretor: valorDoCampo(task, ["corretor"]),
        criadoEm: task.created_at,
        empreendimento,
        gid: task.gid,
        imobiliaria: valorDoCampo(task, ["imobiliar"]),
        nome: task.name.trim(),
        secao,
      });
    }

    offset = envelope.next_page?.offset ?? undefined;
    if (!offset) break;
  }

  return { cads, secoesEncontradas: [...secoesEncontradas].sort() };
}

// Casa cada CAD com as entidades do Apolo pelo nome normalizado.
// Não decide nada: separa em casou / ambíguo / não casou para uma pessoa confirmar.
export async function casarComApolo(
  client: AdminClient,
  cads: CadDoAsana[],
): Promise<PreviewImportacao> {
  // Índice de nomes do Apolo. O volume é de milhares, então trazemos uma vez e casamos em
  // memória em vez de uma consulta por CAD.
  const porNome = new Map<string, EntidadeCandidata[]>();
  const pagina = 1000;

  for (let inicio = 0; ; inicio += pagina) {
    const { data, error } = await client
      .from("apolo_entities")
      .select("id, display_name, legal_name, document_masked")
      .range(inicio, inicio + pagina - 1);

    if (error) break;
    const linhas = (data ?? []) as {
      display_name: string | null;
      document_masked: string | null;
      id: string;
      legal_name: string | null;
    }[];

    for (const linha of linhas) {
      const candidato: EntidadeCandidata = {
        documento: linha.document_masked,
        id: linha.id,
        nome: linha.legal_name || linha.display_name || "",
      };
      const chave = normalizarNome(candidato.nome);
      if (!chave) continue;
      porNome.set(chave, [...(porNome.get(chave) ?? []), candidato]);
    }

    if (linhas.length < pagina) break;
  }

  // Quais tasks já foram importadas antes (trava de reimportação).
  const gids = cads.map((c) => c.gid);
  const jaVinculados = new Set<string>();

  for (let i = 0; i < gids.length; i += 200) {
    const bloco = gids.slice(i, i + 200);
    const { data } = await client
      .from("apolo_source_links")
      .select("source_id")
      .eq("source_system", "asana")
      .eq("source_table", "cad_task")
      .in("source_id", bloco);

    for (const linha of ((data ?? []) as { source_id: string }[])) {
      jaVinculados.add(linha.source_id);
    }
  }

  const preview: PreviewImportacao = {
    ambiguos: [],
    casados: [],
    jaImportados: [],
    naoCasados: [],
    secoesEncontradas: [],
    total: cads.length,
  };

  for (const cad of cads) {
    const candidatos = porNome.get(normalizarNome(cad.nome)) ?? [];
    const item: ItemCasado = {
      cad,
      candidatos,
      jaImportado: jaVinculados.has(cad.gid),
    };

    if (item.jaImportado) preview.jaImportados.push(item);
    else if (candidatos.length === 1) preview.casados.push(item);
    else if (candidatos.length > 1) preview.ambiguos.push(item);
    else preview.naoCasados.push(item);
  }

  return preview;
}

export type AplicacaoResultado = {
  erros: { gid: string; motivo: string }[];
  ignorados: number;
  vinculados: number;
};

// Aplica o vínculo: grava a origem (idempotente pelo índice único de apolo_source_links) e
// marca a etapa da esteira no metadata da entidade.
//
// ⚠️ A etapa vive em `metadata.esteira` porque `apolo_entities.metadata` é jsonb livre e o
// Board já lê de lá — não precisa de coluna nova. O merge é feito lendo e reescrevendo o
// metadata: como a importação é disparada manualmente por uma pessoa e não concorre com o
// wizard de cadastro, é seguro aqui; escrita concorrente exigiria jsonb_set no banco.
export async function aplicarVinculos(input: {
  client: AdminClient;
  etapa: "validacao" | "credenciado";
  itens: { entityId: string; gid: string; secao: string }[];
  porUsuario?: string | null;
}): Promise<AplicacaoResultado> {
  const resultado: AplicacaoResultado = { erros: [], ignorados: 0, vinculados: 0 };
  const agora = new Date().toISOString();

  for (const item of input.itens) {
    const { error: erroLink } = await input.client.from("apolo_source_links").insert({
      entity_id: item.entityId,
      metadata: { importadoEm: agora, secao: item.secao },
      source_id: item.gid,
      source_system: "asana",
      source_table: "cad_task",
    });

    if (erroLink) {
      // 23505 = índice único: esta task já tinha sido importada antes.
      if (erroLink.code === "23505") {
        resultado.ignorados += 1;
        continue;
      }
      resultado.erros.push({ gid: item.gid, motivo: erroLink.message });
      continue;
    }

    const { data: atual } = await input.client
      .from("apolo_entities")
      .select("metadata")
      .eq("id", item.entityId)
      .maybeSingle();

    const metadata = ((atual as { metadata: Record<string, unknown> } | null)?.metadata ??
      {}) as Record<string, unknown>;

    const { error: erroEtapa } = await input.client
      .from("apolo_entities")
      .update({
        metadata: {
          ...metadata,
          esteira: {
            atualizadoEm: agora,
            atualizadoPor: input.porUsuario ?? null,
            etapa: input.etapa,
            origem: "asana",
          },
        },
      })
      .eq("id", item.entityId);

    if (erroEtapa) {
      resultado.erros.push({ gid: item.gid, motivo: erroEtapa.message });
      continue;
    }

    resultado.vinculados += 1;
  }

  return resultado;
}
