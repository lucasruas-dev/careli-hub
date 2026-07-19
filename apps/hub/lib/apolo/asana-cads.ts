// Sondagem da central de CADs no Asana (READ-ONLY).
//
// Objetivo: dimensionar a migração das CADs que estão em "Recepção de CAD" / "Em cadastro"
// para o Board do Apolo, ANTES de importar qualquer coisa. Não cria nada, não chama a MOST e
// não baixa arquivo — só conta o que existe e que tipos de anexo aparecem, pra decidirmos o
// custo (cada documento lido depois será uma consulta cobrada).
// Ver [[project_esteira_credenciamento_venda]].

const ASANA_API = "https://app.asana.com/api/1.0";

// Projeto passado pelo Lucas:
// https://app.asana.com/1/1209376950274415/project/1209726796886414
const PROJETO_CADS = "1209726796886414";

export type AsanaSecaoResumo = {
  amostraTarefas: string[];
  anexosNaAmostra: number;
  gid: string;
  nome: string;
  tarefasAbertas: number;
  tiposDeAnexo: Record<string, number>;
};

export type AsanaCadsSondagem = {
  projeto: string;
  secoes: AsanaSecaoResumo[];
  totalTarefasAbertas: number;
};

function token(): string {
  return process.env.ASANA_ACCESS_TOKEN?.trim() ?? "";
}

async function api<T>(path: string, params: Record<string, string> = {}): Promise<T> {
  const url = new URL(ASANA_API + path);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  const response = await fetch(url, {
    cache: "no-store",
    headers: { Authorization: `Bearer ${token()}` },
  });
  if (!response.ok) {
    throw new Error(`Asana ${path} respondeu HTTP ${response.status}`);
  }
  const json = (await response.json()) as { data: T };
  return json.data;
}

function extensao(nome: string): string {
  const match = /\.([a-z0-9]+)$/i.exec(nome ?? "");
  return match?.[1]?.toLowerCase() ?? "sem-extensao";
}

export function asanaConfigurado(): boolean {
  return token().length > 0;
}

export async function sondarCadsNoAsana(
  amostraPorSecao = 10,
): Promise<AsanaCadsSondagem> {
  const projeto = await api<{ name: string }>(`/projects/${PROJETO_CADS}`, {
    opt_fields: "name",
  });

  const secoes = await api<{ gid: string; name: string }[]>(
    `/projects/${PROJETO_CADS}/sections`,
    { opt_fields: "name" },
  );

  const resumo: AsanaSecaoResumo[] = [];
  let totalTarefasAbertas = 0;

  for (const secao of secoes) {
    const tarefas = await api<{ completed: boolean; gid: string; name: string }[]>(
      `/sections/${secao.gid}/tasks`,
      { limit: "100", opt_fields: "name,completed" },
    );
    const abertas = tarefas.filter((t) => !t.completed);
    totalTarefasAbertas += abertas.length;

    // Amostra só as primeiras: a sondagem não pode estourar o rate limit do Asana.
    const tiposDeAnexo: Record<string, number> = {};
    let anexosNaAmostra = 0;

    for (const tarefa of abertas.slice(0, amostraPorSecao)) {
      const anexos = await api<{ name: string }[]>(
        `/tasks/${tarefa.gid}/attachments`,
        { opt_fields: "name" },
      );
      anexosNaAmostra += anexos.length;
      for (const anexo of anexos) {
        const ext = extensao(anexo.name);
        tiposDeAnexo[ext] = (tiposDeAnexo[ext] ?? 0) + 1;
      }
    }

    resumo.push({
      amostraTarefas: abertas.slice(0, 5).map((t) => t.name),
      anexosNaAmostra,
      gid: secao.gid,
      nome: secao.name,
      tarefasAbertas: abertas.length,
      tiposDeAnexo,
    });
  }

  return { projeto: projeto.name, secoes: resumo, totalTarefasAbertas };
}
