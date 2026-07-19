// Sondagem da central de CADs no Asana (READ-ONLY).
//
// Objetivo: enxergar o que existe LÁ antes de importar qualquer coisa pro Board do Apolo.
// Não cria nada, não baixa arquivo e NÃO chama a MOST — cada documento lido depois será uma
// consulta cobrada, então a decisão de importar precisa ser tomada com os números na mão.
//
// A sondagem responde as perguntas que travam a importação:
//   - quais são as seções reais e quantas CADs tem em cada
//   - QUE CAMPOS existem nas tasks (o nome exato varia por empreendimento)
//   - as CADs têm CPF? (createApoloEntity exige documento válido: sem CPF elas não entram)
//   - tem corretor? tem imobiliária? qual o valor real do empreendimento?
//   - que tipos de anexo aparecem (pra dimensionar o custo do iOCR depois)
// Ver [[project_esteira_credenciamento_venda]].

const ASANA_API = "https://app.asana.com/api/1.0";

// Projeto passado pelo Lucas:
// https://app.asana.com/1/1209376950274415/project/1209726796886414
const PROJETO_CADS = process.env.ASANA_CAD_PROJECT_GID?.trim() || "1209726796886414";

export type AsanaCampoResumo = {
  // Quantas tasks da amostra têm este campo PREENCHIDO.
  preenchidos: number;
  nome: string;
  // Até 3 valores distintos, pra reconhecer o formato (ex.: "VOR", "Vale do Ouro").
  valores: string[];
};

export type AsanaTarefaAmostra = {
  campos: Record<string, string>;
  criadoEm: string | null;
  gid: string;
  nome: string;
  qtdAnexos: number;
};

export type AsanaSecaoResumo = {
  amostra: AsanaTarefaAmostra[];
  anexosNaAmostra: number;
  gid: string;
  nome: string;
  tarefasAbertas: number;
  tiposDeAnexo: Record<string, number>;
};

export type AsanaCadsSondagem = {
  // Todos os campos vistos no projeto, com quantas vezes vieram preenchidos.
  campos: AsanaCampoResumo[];
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

type TarefaAsana = {
  completed: boolean;
  created_at: string | null;
  custom_fields?: { display_value?: string | null; name?: string | null }[] | null;
  gid: string;
  name: string;
};

export async function sondarCadsNoAsana(
  amostraPorSecao = 6,
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

  // Catálogo global de campos: é o que revela se existe CPF, corretor, imobiliária.
  const camposVistos = new Map<string, { valores: Set<string>; preenchidos: number }>();

  for (const secao of secoes) {
    const tarefas = await api<TarefaAsana[]>(`/sections/${secao.gid}/tasks`, {
      limit: "100",
      opt_fields:
        "name,completed,created_at,custom_fields.name,custom_fields.display_value",
    });

    // NÃO descartar concluída: a seção "Finalizado" é justamente onde as tasks estão marcadas
    // como completed, e é o lote que mais interessa importar.
    const abertas = tarefas;
    totalTarefasAbertas += abertas.length;

    // Catálogo de campos varre TODAS as tarefas da seção (é barato: já veio na resposta).
    for (const tarefa of abertas) {
      for (const campo of tarefa.custom_fields ?? []) {
        const nome = (campo.name ?? "").trim();
        if (!nome) continue;

        const registro = camposVistos.get(nome) ?? {
          preenchidos: 0,
          valores: new Set<string>(),
        };
        const valor = (campo.display_value ?? "").trim();
        if (valor) {
          registro.preenchidos += 1;
          if (registro.valores.size < 3) registro.valores.add(valor);
        }
        camposVistos.set(nome, registro);
      }
    }

    // Anexos SÓ na amostra: a sondagem não pode estourar o rate limit do Asana.
    const tiposDeAnexo: Record<string, number> = {};
    let anexosNaAmostra = 0;
    const amostra: AsanaTarefaAmostra[] = [];

    for (const tarefa of abertas.slice(0, amostraPorSecao)) {
      const anexos = await api<{ name: string }[]>(`/tasks/${tarefa.gid}/attachments`, {
        opt_fields: "name",
      });
      anexosNaAmostra += anexos.length;
      for (const anexo of anexos) {
        const ext = extensao(anexo.name);
        tiposDeAnexo[ext] = (tiposDeAnexo[ext] ?? 0) + 1;
      }

      const campos: Record<string, string> = {};
      for (const campo of tarefa.custom_fields ?? []) {
        const nome = (campo.name ?? "").trim();
        const valor = (campo.display_value ?? "").trim();
        if (nome && valor) campos[nome] = valor;
      }

      amostra.push({
        campos,
        criadoEm: tarefa.created_at,
        gid: tarefa.gid,
        nome: tarefa.name,
        qtdAnexos: anexos.length,
      });
    }

    resumo.push({
      amostra,
      anexosNaAmostra,
      gid: secao.gid,
      nome: secao.name,
      tarefasAbertas: abertas.length,
      tiposDeAnexo,
    });
  }

  const campos: AsanaCampoResumo[] = [...camposVistos.entries()]
    .map(([nome, registro]) => ({
      nome,
      preenchidos: registro.preenchidos,
      valores: [...registro.valores],
    }))
    .sort((a, b) => b.preenchidos - a.preenchidos);

  return { campos, projeto: projeto.name, secoes: resumo, totalTarefasAbertas };
}
