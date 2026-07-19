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
import { createApoloEntity } from "@/lib/apolo/cadastro-persist";
import { hashIdentifier, type createApoloAdminClient } from "@/lib/apolo/server";

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
  // Descrição da task + os campos preenchidos, concatenados. É onde se procura o CPF antes de
  // pagar pela leitura do documento.
  notas: string | null;
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
  // Nome quase igual (erro de digitação de uma ou duas letras). NUNCA aplicado sozinho:
  // "Joao Silva" e "Joao Silvo" também são parecidos e são pessoas diferentes.
  quaseCasados: ItemCasado[];
  secoesEncontradas: string[];
  total: number;
};

// Distância de edição (Levenshtein). Usada só para SUGERIR, nunca para decidir.
function distanciaEdicao(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let anterior = Array.from({ length: b.length + 1 }, (_, i) => i);

  for (let i = 1; i <= a.length; i += 1) {
    const atual = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const custo = a[i - 1] === b[j - 1] ? 0 : 1;
      atual[j] = Math.min(
        (atual[j - 1] ?? 0) + 1,
        (anterior[j] ?? 0) + 1,
        (anterior[j - 1] ?? 0) + custo,
      );
    }
    anterior = atual;
  }

  return anterior[b.length] ?? 0;
}

export function similaridade(a: string, b: string): number {
  const maior = Math.max(a.length, b.length);
  if (maior === 0) return 1;
  return 1 - distanciaEdicao(a, b) / maior;
}

// Acima disto o nome é "quase igual" — erro de digitação, não pessoa diferente.
// Calibrado nos casos reais: "cristiana"/"cristina", "higno"/"higino", "feliphe"/"felipe"
// ficam todos acima de 0,90.
const LIMIAR_SIMILARIDADE = 0.86;

// Diagnóstico da varredura: quando a busca volta vazia, é isto que diz POR QUÊ — em vez de
// deixar a pessoa adivinhar a grafia.
export type DiagnosticoVarredura = {
  // Quantas tasks existem em cada seção (antes de qualquer filtro).
  porSecao: Record<string, number>;
  // Valores de empreendimento que realmente aparecem nas tasks das seções pedidas.
  valoresEmpreendimento: string[];
  // Quantas foram descartadas só pelo filtro de empreendimento.
  descartadasPorEmpreendimento: number;
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
  notes?: string | null;
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
//
// ⚠️ NÃO filtra task concluída. A seção "Finalizado" é justamente onde as tasks estão marcadas
// como completed no Asana — descartá-las zerava o lote que mais interessa.
export async function escanearCads(input: {
  empreendimento: string;
  secoes: string[];
}): Promise<{
  cads: CadDoAsana[];
  diagnostico: DiagnosticoVarredura;
  secoesEncontradas: string[];
}> {
  const alvoEmpreendimento = normalizarNome(input.empreendimento);
  const alvoSecoes = input.secoes.map(normalizarSecao);

  const cads: CadDoAsana[] = [];
  const secoesEncontradas = new Set<string>();
  const porSecao: Record<string, number> = {};
  const valoresEmpreendimento = new Set<string>();
  let descartadasPorEmpreendimento = 0;
  let offset: string | undefined;

  for (let pagina = 0; pagina < 40; pagina += 1) {
    const params: Record<string, string> = {
      limit: "100",
      // `notes` = descrição da task. É onde o CPF costuma estar digitado, e achá-lo ali
      // dispensa a leitura PAGA do documento daquela CAD.
      opt_fields:
        "gid,name,completed,created_at,notes,memberships.project.gid,memberships.section.name,custom_fields.name,custom_fields.display_value",
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
      const secao = secaoDaTask(task);
      if (secao) {
        secoesEncontradas.add(secao);
        porSecao[secao] = (porSecao[secao] ?? 0) + 1;
      }

      const empreendimento = valorDoCampo(task, ["empreendimento"], "indica")
        ?? valorDoCampo(task, ["empreendimento"]);

      const bateSecao =
        alvoSecoes.length === 0 || alvoSecoes.includes(normalizarSecao(secao));
      if (!bateSecao) continue;

      // Dentro da seção pedida, guarda os valores que existem: é o que a tela mostra quando
      // a busca volta vazia por causa da grafia do empreendimento.
      if (empreendimento) valoresEmpreendimento.add(empreendimento);

      const bateEmpreendimento =
        !alvoEmpreendimento || normalizarNome(empreendimento).includes(alvoEmpreendimento);
      if (!bateEmpreendimento) {
        descartadasPorEmpreendimento += 1;
        continue;
      }

      // Junta descrição e TODOS os campos preenchidos: o CPF tanto pode estar escrito na
      // descrição quanto num campo personalizado, e procurar nos dois é de graça.
      const textoDosCampos = (task.custom_fields ?? [])
        .map((campo) => campo.display_value ?? "")
        .filter(Boolean)
        .join(" ");

      cads.push({
        corretor: valorDoCampo(task, ["corretor"]),
        criadoEm: task.created_at,
        empreendimento,
        gid: task.gid,
        imobiliaria: valorDoCampo(task, ["imobiliar"]),
        nome: task.name.trim(),
        notas: [task.notes ?? "", textoDosCampos].join(" ").trim() || null,
        secao,
      });
    }

    offset = envelope.next_page?.offset ?? undefined;
    if (!offset) break;
  }

  return {
    cads,
    diagnostico: {
      descartadasPorEmpreendimento,
      porSecao,
      valoresEmpreendimento: [...valoresEmpreendimento].sort(),
    },
    secoesEncontradas: [...secoesEncontradas].sort(),
  };
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
  // Bloco por PRIMEIRO nome: sem isto, sugerir por similaridade custaria comparar cada CAD
  // com milhares de entidades. Erro de digitação quase nunca cai na primeira palavra.
  const porPrimeiroNome = new Map<string, EntidadeCandidata[]>();
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

      const primeiro = chave.split(" ")[0] ?? "";
      if (primeiro) {
        porPrimeiroNome.set(primeiro, [
          ...(porPrimeiroNome.get(primeiro) ?? []),
          candidato,
        ]);
      }
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
    quaseCasados: [],
    secoesEncontradas: [],
    total: cads.length,
  };

  for (const cad of cads) {
    const chave = normalizarNome(cad.nome);
    const candidatos = porNome.get(chave) ?? [];
    const item: ItemCasado = {
      cad,
      candidatos,
      jaImportado: jaVinculados.has(cad.gid),
    };

    if (item.jaImportado) {
      preview.jaImportados.push(item);
      continue;
    }
    if (candidatos.length === 1) {
      preview.casados.push(item);
      continue;
    }
    if (candidatos.length > 1) {
      preview.ambiguos.push(item);
      continue;
    }

    // Não casou exato: procura nome quase igual dentro do bloco do primeiro nome.
    const primeiro = chave.split(" ")[0] ?? "";
    const parecidos = (porPrimeiroNome.get(primeiro) ?? [])
      .map((candidato) => ({
        candidato,
        score: similaridade(chave, normalizarNome(candidato.nome)),
      }))
      .filter((linha) => linha.score >= LIMIAR_SIMILARIDADE)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);

    if (parecidos.length > 0) {
      preview.quaseCasados.push({
        ...item,
        candidatos: parecidos.map((linha) => linha.candidato),
      });
    } else {
      preview.naoCasados.push(item);
    }
  }

  return preview;
}

export type CriacaoResultado = {
  criados: number;
  erros: { cad: string; motivo: string }[];
  // CPF já existia no Apolo: reaproveitamos a entidade em vez de criar outra.
  reaproveitados: number;
};

// Cria as entidades das CADs que ainda NÃO existem no Apolo (é o caso da seção "Em Cadastro").
//
// ⚠️ DEDUP NO CÓDIGO, obrigatoriamente: a migration 0026 DROPOU o índice único de
// `document_hash` (linha 57) e `createApoloEntity` insere cego. Sem esta checagem, o mesmo CPF
// vira duas entidades, dois itens na fila do Board, dois códigos de credenciamento — e quebra
// o `maybeSingle()` da consulta do portal.
export async function criarEntidadesDoLote(input: {
  client: AdminClient;
  itens: {
    cpf: string;
    empreendimento?: string | null;
    empreendimentoId?: string | null;
    gid: string;
    imobiliaria?: string | null;
    nome: string;
  }[];
  ownerUserId?: string | null;
}): Promise<{ entidadePorCad: Record<string, string>; resultado: CriacaoResultado }> {
  const resultado: CriacaoResultado = { criados: 0, erros: [], reaproveitados: 0 };
  const entidadePorCad: Record<string, string> = {};

  for (const item of input.itens) {
    const digitos = item.cpf.replace(/\D/g, "");
    if (digitos.length !== 11) {
      resultado.erros.push({ cad: item.nome, motivo: "CPF invalido" });
      continue;
    }

    try {
      // Já existe alguém com este CPF? Então é a mesma pessoa: vincula, não duplica.
      const hash = hashIdentifier("cpf", digitos);
      const { data: existente } = await input.client
        .from("apolo_entities")
        .select("id")
        .eq("document_hash", hash)
        .limit(1)
        .maybeSingle();

      if (existente) {
        entidadePorCad[item.gid] = (existente as { id: string }).id;
        resultado.reaproveitados += 1;
        continue;
      }

      const criada = await createApoloEntity(input.client, {
        empreendimentos: item.empreendimentoId
          ? [{ id: item.empreendimentoId, label: item.empreendimento ?? "" }]
          : [],
        identidade: { cpf: digitos, nome: item.nome },
        origem: "asana-cad",
        ownerUserId: input.ownerUserId ?? null,
        persona: "pf",
        role: "prospect",
      });

      if (!criada.ok) {
        resultado.erros.push({ cad: item.nome, motivo: criada.error });
        continue;
      }

      entidadePorCad[item.gid] = criada.entityId;
      resultado.criados += 1;
    } catch (erro) {
      resultado.erros.push({ cad: item.nome, motivo: (erro as Error).message });
    }
  }

  return { entidadePorCad, resultado };
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
export type EtapaImportacao = "validacao" | "credito" | "credenciado";

export async function aplicarVinculos(input: {
  // Quem fica responsável pelos itens importados. Sem isto todos entram "Sem analista" e
  // alguém teria que atribuir um a um.
  analistaId?: string | null;
  client: AdminClient;
  etapa: EtapaImportacao;
  itens: {
    corretor?: string | null;
    // Quando a CAD foi criada no Asana. É a data de chegada DE VERDADE: o created_at da
    // entidade no Apolo é quando o sync do C2X a criou, o que não diz nada sobre a CAD.
    criadoEm?: string | null;
    empreendimento?: string | null;
    entityId: string;
    gid: string;
    imobiliaria?: string | null;
    secao: string;
  }[];
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

    // 23505 = índice único: a task já tinha sido importada. O vínculo não se repete, mas os
    // DADOS são atualizados assim mesmo — é o que permite completar o que ficou faltando numa
    // importação anterior (foi o caso do empreendimento) sem ter que apagar nada.
    const jaVinculado = erroLink?.code === "23505";
    if (erroLink && !jaVinculado) {
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
            analistaId: input.analistaId ?? null,
            atualizadoEm: agora,
            atualizadoPor: input.porUsuario ?? null,
            // O que veio da CAD do Asana. O Board mostra estes campos na fila: sem eles, a
            // coluna Empreendimento fica vazia para quem foi importado (cadastro antigo não
            // tem metadata.cadastro).
            // Data de chegada da CAD (Asana). O Board mostra esta em vez do created_at da
            // entidade, que é quando o sync do C2X a criou.
            chegouEm: item.criadoEm ?? null,
            corretor: item.corretor ?? null,
            empreendimento: item.empreendimento ?? null,
            etapa: input.etapa,
            imobiliaria: item.imobiliaria ?? null,
            origem: "asana",
          },
        },
      })
      .eq("id", item.entityId);

    if (erroEtapa) {
      resultado.erros.push({ gid: item.gid, motivo: erroEtapa.message });
      continue;
    }

    if (jaVinculado) resultado.ignorados += 1;
    else resultado.vinculados += 1;
  }

  return resultado;
}
