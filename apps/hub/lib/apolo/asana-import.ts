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
import { extrairDaDescricao, type DadosDaDescricao } from "@/lib/apolo/asana-descricao";
import { createApoloEntity } from "@/lib/apolo/cadastro-persist";
import { matchEstadoCivilId } from "@/lib/apolo/c2x-fields";
import {
  matchEscolaridadeId,
  matchFaixaRendaId,
  matchProfissaoId,
} from "@/lib/apolo/c2x-match";
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
  // Código da CAD no Asana (GCAD-7808): é como o time se refere a ela.
  codigo: string | null;
  // Cônjuge, lido da DESCRIÇÃO do formulário. Para casado isso entra no contrato, então vem
  // junto — e vem de graça.
  conjuge: DadosDaDescricao["conjuge"];
  corretor: string | null;
  criadoEm: string | null;
  email: string | null;
  empreendimento: string | null;
  // Escolaridade, estado civil, profissão e renda: TUDO isso está na descrição da CAD, em
  // texto livre. É o que evita pagar enriquecimento para descobrir o mesmo.
  escolaridade: string | null;
  estadoCivil: string | null;
  gid: string;
  imobiliaria: string | null;
  nome: string;
  // Nome do PROPONENTE = o cliente. O título da task costuma ser o mesmo, mas o campo é o
  // que o corretor preencheu de propósito.
  nomeProponente: string | null;
  profissao: string | null;
  renda: string | null;
  telefone: string | null;
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

      // ⚠️ A DESCRIÇÃO da CAD é a fonte mais rica que temos: o formulário "CAD - Vale do
      // Ouro" pergunta profissão, renda, estado civil, escolaridade e os dados do cônjuge.
      // Tudo isso chegava aqui e era ignorado, enquanto o plano era PAGAR enriquecimento
      // (R$ 1,06 por CPF) para descobrir parte do mesmo.
      const daDescricao = extrairDaDescricao(task.notes);

      // Cuidado com "Solicitante" e "Corretor": os dois também têm e-mail e telefone. O
      // campo do proponente é buscado primeiro; o parser da descrição já exclui os outros.
      const telefone =
        valorDoCampo(task, ["contato", "telefone", "celular"], "proponente") ??
        daDescricao.proponente.telefone ??
        null;
      const email =
        valorDoCampo(task, ["mail"], "proponente") ?? daDescricao.proponente.email ?? null;
      const nomeProponente =
        valorDoCampo(task, ["nome"], "proponente") ?? daDescricao.proponente.nome ?? null;

      cads.push({
        codigo: valorDoCampo(task, ["gcad", "codigo"]),
        conjuge: daDescricao.conjuge,
        corretor: valorDoCampo(task, ["corretor"]) ?? daDescricao.corretor ?? null,
        criadoEm: task.created_at,
        email,
        empreendimento,
        escolaridade: daDescricao.proponente.escolaridade ?? null,
        estadoCivil: daDescricao.proponente.estadoCivil ?? null,
        gid: task.gid,
        imobiliaria: valorDoCampo(task, ["imobiliar"]) ?? daDescricao.imobiliaria ?? null,
        nome: task.name.trim(),
        nomeProponente,
        notas: [task.notes ?? "", textoDosCampos].join(" ").trim() || null,
        profissao: daDescricao.proponente.profissao ?? null,
        renda: daDescricao.proponente.renda ?? null,
        secao,
        telefone,
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

// Os ids das listas do C2X viajam como texto no cadastro (é o que o wizard manda). Null vira
// string vazia, que é como o formulário representa "não escolhido".
function textoDoId(id: number | null): string {
  return id === null ? "" : String(id);
}

export type CriacaoResultado = {
  criados: number;
  erros: { cad: string; motivo: string }[];
  // CPF já existia no Apolo: reaproveitamos a entidade em vez de criar outra.
  reaproveitados: number;
};

// Procura a entidade dona deste CPF em DUAS fontes — e as duas são obrigatórias.
//
// ⚠️ `apolo_entities.document_hash` só existe para quem o Apolo criou: são 153 de 4.286. O sync
// do C2X grava `document_hash: null` de propósito (lib/apolo/server.ts:3415) e guarda o CPF em
// `apolo_entity_identifiers.value_hash`. Procurar só na primeira coluna é ser CEGO para 96% da
// base: a pessoa já existe, o dedup não a enxerga, e nasce um cadastro duplicado.
//
// Foi exatamente o que aconteceu com RAFAEL GONÇALVES LEITE (CPF 132.619.696-01), que ficou com
// duas entidades — uma vinda do C2X em "credito", outra criada pela importação em "validacao".
// O `hashIdentifier("cpf", digitos)` é o MESMO nas duas tabelas, então basta olhar as duas.
async function acharPorCpf(client: AdminClient, hash: string): Promise<string | null> {
  const { data: porColuna } = await client
    .from("apolo_entities")
    .select("id")
    .eq("document_hash", hash)
    .limit(1)
    .maybeSingle();

  if (porColuna) return (porColuna as { id: string }).id;

  const { data: porIdentificador } = await client
    .from("apolo_entity_identifiers")
    .select("entity_id")
    .in("identifier_type", ["cpf", "cnpj"])
    .eq("value_hash", hash)
    .limit(1)
    .maybeSingle();

  return porIdentificador ? (porIdentificador as { entity_id: string }).entity_id : null;
}

// Cria as entidades das CADs que ainda NÃO existem no Apolo (é o caso da seção "Em Cadastro").
//
// ⚠️ DEDUP NO CÓDIGO, obrigatoriamente: a migration 0026 DROPOU o índice único de
// `document_hash` (linha 57) e `createApoloEntity` insere cego. Sem esta checagem, o mesmo CPF
// vira duas entidades, dois itens na fila do Board, dois códigos de credenciamento — e quebra
// o `maybeSingle()` da consulta do portal.
export async function criarEntidadesDoLote(input: {
  client: AdminClient;
  itens: {
    // Tudo que o OCR leu — cada campo aqui JÁ FOI PAGO. Gravar só o CPF significaria pagar a
    // leitura e deixar o operador redigitando o que a máquina já tinha entendido.
    cidade?: string;
    cpf: string;
    dataNascimento?: string;
    // Contato que o corretor preencheu na CAD do Asana. Vem de graça e evita pagar
    // enriquecimento para descobrir telefone e e-mail que já estavam ali.
    email?: string | null;
    empreendimento?: string | null;
    empreendimentoId?: string | null;
    gid: string;
    imobiliaria?: string | null;
    nacionalidade?: string;
    naturalidade?: string;
    nome: string;
    // Nome como veio NO DOCUMENTO. Vale mais que o título da task, que é digitado à mão.
    nomeDoDocumento?: string;
    nomeMae?: string;
    nomePai?: string;
    orgaoEmissor?: string;
    rg?: string;
    telefone?: string | null;
    uf?: string;
    // Vindos da DESCRIÇÃO da CAD (texto livre do formulário).
    conjuge?: DadosDaDescricao["conjuge"];
    escolaridade?: string | null;
    estadoCivil?: string | null;
    profissao?: string | null;
    renda?: string | null;
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
      const entidadeExistente = await acharPorCpf(input.client, hash);

      if (entidadeExistente) {
        entidadePorCad[item.gid] = entidadeExistente;
        resultado.reaproveitados += 1;
        continue;
      }

      const criada = await createApoloEntity(input.client, {
        empreendimentos: item.empreendimentoId
          ? [{ id: item.empreendimentoId, label: item.empreendimento ?? "" }]
          : [],
        // A ficha nasce com TUDO que o documento entregou. O nome do documento ganha do
        // título da task quando existe: o título é digitado à mão e é onde estão os erros
        // de grafia que já nos custaram tempo.
        identidade: {
          cpf: digitos,
          dataNascimento: item.dataNascimento,
          nacionalidade: item.nacionalidade,
          naturalidade: item.naturalidade ?? item.cidade,
          nome: item.nomeDoDocumento || item.nome,
          nomeMae: item.nomeMae,
          nomePai: item.nomePai,
          orgaoEmissor: item.orgaoEmissor,
        },
        // O cônjuge vira relacionamento de contato, como no wizard. Para casado isso entra
        // no contrato, então não pode ficar de fora.
        conjuge: item.conjuge?.nome
          ? {
              email: item.conjuge.email,
              nome: item.conjuge.nome,
              telefone: item.conjuge.telefone,
            }
          : null,
        origem: "asana-cad",
        ownerUserId: input.ownerUserId ?? null,
        persona: "pf",
        // Texto livre do formulário convertido para os ids das listas do C2X. O que não casa
        // com confiança fica vazio, para o operador escolher — melhor branco que errado.
        perfil: {
          email: item.email ?? "",
          escolaridadeId: textoDoId(matchEscolaridadeId(item.escolaridade)),
          estadoCivilId: textoDoId(matchEstadoCivilId(item.estadoCivil ?? "")),
          profissaoId: textoDoId(matchProfissaoId(item.profissao)),
          rendaId: textoDoId(matchFaixaRendaId(item.renda)),
          telefone: item.telefone ?? "",
        },
        role: "prospect",
      });

      if (!criada.ok) {
        resultado.erros.push({ cad: item.nome, motivo: criada.error });
        continue;
      }

      // O CPF fica VISÍVEL na ficha, no mesmo formato que o sync do C2X usa.
      //
      // `createApoloEntity` grava `document_masked` mascarado (***.***.***-39) e a tabela de
      // identificadores só guarda hash — ou seja, o número completo não é persistido em lugar
      // nenhum. Só que o Board é tela INTERNA de validação: o operador precisa conferir o CPF
      // contra o documento, e conferir com dois dígitos não dá. O sync do C2X já grava
      // completo, então mascarar aqui deixava metade da fila num formato e metade noutro.
      await input.client
        .from("apolo_entities")
        .update({
          document_masked: digitos.replace(
            /(\d{3})(\d{3})(\d{3})(\d{2})/,
            "$1.$2.$3-$4",
          ),
        })
        .eq("id", criada.entityId);

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

// Ordem da esteira. Serve para uma regra só, mas essencial: a importação NUNCA REBAIXA quem já
// avançou.
//
// Foi exatamente isto que faltou em 20/jul: ao ler as CADs de "Em Cadastro", o dedup por CPF
// reaproveitou 122 entidades que já estavam em ANÁLISE DE CRÉDITO (vindas do "Finalizado") e
// regravou "validacao" por cima — o Lucas viu a coluna inteira sumir do Board. Um lote de
// importação não pode desfazer o trabalho que já andou.
const ORDEM_ETAPA: Record<string, number> = {
  credenciado: 3,
  credito: 1,
  prevenda: 2,
  validacao: 0,
};

export function etapaMaisAvancada(
  atual: string | null | undefined,
  nova: EtapaImportacao,
): EtapaImportacao | string {
  const pesoAtual = ORDEM_ETAPA[atual ?? ""] ?? -1;
  const pesoNovo = ORDEM_ETAPA[nova] ?? -1;
  return pesoAtual > pesoNovo ? (atual as string) : nova;
}

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
    // Contato preenchido pelo corretor na CAD. Reaplicar a importação completa isto em quem
    // já foi importado sem custo nenhum — é dado que sempre esteve no Asana.
    email?: string | null;
    empreendimento?: string | null;
    entityId: string;
    gid: string;
    imobiliaria?: string | null;
    secao: string;
    telefone?: string | null;
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

    // ⚠️ A esteira vive em TABELA PRÓPRIA (`apolo_esteira`), não no metadata da entidade.
    // Motivo (incidente 20/jul): o sync do C2X faz upsert com metadata montado do zero e
    // SUBSTITUI o objeto inteiro — 122 CADs perderam etapa e analista na primeira rodada
    // depois da importação. Tabela separada é imune a isso.
    const { data: esteiraLinha } = await input.client
      .from("apolo_esteira")
      .select("etapa, analista_id, chegou_em, corretor, empreendimento, imobiliaria")
      .eq("entity_id", item.entityId)
      .maybeSingle();

    const esteiraAtual = (esteiraLinha ?? {}) as {
      analista_id?: string | null;
      chegou_em?: string | null;
      corretor?: string | null;
      empreendimento?: string | null;
      etapa?: string | null;
      imobiliaria?: string | null;
    };

    // NUNCA rebaixar quem já avançou na esteira.
    const etapaFinal = etapaMaisAvancada(esteiraAtual.etapa, input.etapa);

    // Campos da CAD só preenchem o que está VAZIO: reimportar completa a ficha, nunca apaga o
    // que o operador já corrigiu à mão. O analista idem — reimportar não rouba o item de quem
    // já estava cuidando dele.
    const { error: erroEtapa } = await input.client.from("apolo_esteira").upsert(
      {
        analista_id: esteiraAtual.analista_id ?? input.analistaId ?? null,
        atualizado_em: agora,
        atualizado_por: input.porUsuario ?? null,
        // Data de chegada da CAD no Asana — não o created_at da entidade, que é quando o
        // sync do C2X a criou (100 das 122 no mesmo segundo).
        chegou_em: esteiraAtual.chegou_em ?? item.criadoEm ?? null,
        corretor: esteiraAtual.corretor ?? item.corretor ?? null,
        empreendimento: esteiraAtual.empreendimento ?? item.empreendimento ?? null,
        entity_id: item.entityId,
        etapa: etapaFinal,
        imobiliaria: esteiraAtual.imobiliaria ?? item.imobiliaria ?? null,
        origem: "asana",
      },
      { onConflict: "entity_id" },
    );

    if (erroEtapa) {
      resultado.erros.push({ gid: item.gid, motivo: erroEtapa.message });
      continue;
    }

    if (jaVinculado) resultado.ignorados += 1;
    else resultado.vinculados += 1;
  }

  return resultado;
}

// Monta os campos da ficha a partir do que foi importado: o que o OCR leu do documento e o
// que o formulário do Asana trouxe, já convertido para os ids das listas do C2X.
//
// Mesma conversão que `criarEntidadesDoLote` aplica ao metadata — feita aqui uma vez só para
// as duas fontes não divergirem (o operador veria um valor na ficha e outro no cadastro).
export function camposDaFicha(item: {
  dataNascimento?: string | null;
  escolaridade?: string | null;
  estadoCivil?: string | null;
  nacionalidade?: string | null;
  naturalidade?: string | null;
  nomeMae?: string | null;
  nomePai?: string | null;
  orgaoEmissor?: string | null;
  profissao?: string | null;
  renda?: string | null;
  rg?: string | null;
}): Record<string, string | null | undefined> {
  return {
    dataNascimento: item.dataNascimento,
    escolaridadeId: textoDoId(matchEscolaridadeId(item.escolaridade ?? null)),
    estadoCivilId: textoDoId(matchEstadoCivilId(item.estadoCivil ?? "")),
    nacionalidade: item.nacionalidade,
    naturalidade: item.naturalidade,
    nomeMae: item.nomeMae,
    nomePai: item.nomePai,
    orgaoEmissor: item.orgaoEmissor,
    profissaoId: textoDoId(matchProfissaoId(item.profissao ?? null)),
    rendaId: textoDoId(matchFaixaRendaId(item.renda ?? null)),
    rg: item.rg,
  };
}

// Copia o cadastro importado para `apolo_esteira.ficha` — a fonte que a validação lê.
//
// Sem isto o dado do formulário do Asana fica SÓ em `apolo_entities.metadata`, e para quem
// existe no C2X o sync noturno substitui o metadata inteiro e apaga tudo (foi o que aconteceu
// com a esteira em 20/jul). A ficha tem tabela própria justamente para sobreviver a isso.
//
// ⚠️ Só preenche chave AUSENTE: o que o operador digitou na validação sempre ganha da
// importação. Reimportar não pode desfazer trabalho humano.
export async function gravarFichaDoLote(input: {
  client: AdminClient;
  itens: {
    campos: Record<string, string | null | undefined>;
    entityId: string;
  }[];
}): Promise<{ atualizados: number; erros: string[] }> {
  const resultado = { atualizados: 0, erros: [] as string[] };

  for (const item of input.itens) {
    const preencher = Object.entries(item.campos).filter(
      ([, valor]) => typeof valor === "string" && valor.trim() !== "",
    );
    if (preencher.length === 0) continue;

    const { data: atual } = await input.client
      .from("apolo_esteira")
      .select("ficha")
      .eq("entity_id", item.entityId)
      .maybeSingle();

    // Linha ausente = vínculo não aplicado; sem esteira não há ficha para preencher.
    if (!atual) continue;

    const ficha = ((atual as { ficha: Record<string, unknown> | null }).ficha ?? {}) as Record<
      string,
      unknown
    >;
    let mudou = false;
    for (const [chave, valor] of preencher) {
      if (ficha[chave] === undefined || ficha[chave] === null || ficha[chave] === "") {
        ficha[chave] = valor;
        mudou = true;
      }
    }
    if (!mudou) continue;

    const { error } = await input.client
      .from("apolo_esteira")
      .update({ ficha })
      .eq("entity_id", item.entityId);

    if (error) resultado.erros.push(`${item.entityId}: ${error.message}`);
    else resultado.atualizados += 1;
  }

  return resultado;
}
