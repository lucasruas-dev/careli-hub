// COMPLETAR VÍNCULOS das CADs já importadas — corretor, e-mail do corretor e imobiliária.
//
// POR QUE ESTE ARQUIVO EXISTE (e não é uma reaplicação da importação):
// as 392 CADs do Vale do Ouro entraram com `corretor` ZERADO (0 de 392). A causa é conhecida:
// `app/api/apolo/asana/leitura/route.ts` monta o item com `corretor: null` fixo, e o import
// rodou antes da leitura da descrição entrar em vigor. O parser (`asana-descricao.ts`) já
// extrai corretor e e-mail corretamente — só faltou alguém gravar.
//
// Reaplicar `aplicarVinculos` resolveria o corretor, mas cobra três pedágios inaceitáveis para
// um backfill:
//   1. PROMOVE a etapa (`etapaMaisAvancada` com default "credito" na rota) — quem está em
//      validação subiria para crédito. Backfill não muda estado operacional.
//   2. reescreve `atualizado_em` nas 392 linhas — o Board ordena por isso, a fila embaralha
//      inteira sem uma única mudança real de dado.
//   3. usa `upsert` com array heterogêneo — a armadilha do PostgREST que já nos custou dado:
//      chave ausente no corpo vira NULL no ON CONFLICT DO UPDATE.
//
// Aqui a superfície de escrita é mínima e deliberada: UPDATE de UMA coluna por chamada, com
// guarda `.is(coluna, null)` no próprio banco. É estruturalmente impossível zerar `ficha`,
// `etapa`, `analista_id` ou a imobiliária de outra linha.
import {
  escanearCads,
  imobiliariaAncorada,
  normalizarNome,
} from "@/lib/apolo/asana-import";
import { type createApoloAdminClient } from "@/lib/apolo/server";

type AdminClient = NonNullable<ReturnType<typeof createApoloAdminClient>>;

// ⚠️ TRAVA DE ESCOPO — o Lucas autorizou SOMENTE o Vale do Ouro. Os demais empreendimentos
// seguem outro fluxo já montado, e completar vínculo neles com esta regra seria inventar
// processo onde já existe um.
//
// A comparação é por IGUALDADE normalizada, nunca substring: o filtro do `escanearCads` é
// substring, então "Vale do Ouro II" passaria por lá e entraria no lote sem ninguém notar.
export const EMPREENDIMENTOS_AUTORIZADOS: string[] = ["Vale do Ouro"];

// Está no escopo autorizado? Usada DUAS vezes de propósito: no que vem do Asana e no que já
// está gravado em `apolo_esteira.empreendimento`. Uma guarda só protegeria metade do caminho.
export function noEscopo(valor: string | null | undefined): boolean {
  const alvo = normalizarNome(valor);
  if (!alvo) return false;
  return EMPREENDIMENTOS_AUTORIZADOS.some((nome) => normalizarNome(nome) === alvo);
}

export type SituacaoCampo = "ambiguo" | "completar" | "jaTemValor" | "semDado";

export type LinhaPlano = {
  corretor: string | null;
  corretorEmail: string | null;
  // Confiança de qual campo do Asana foi usado para a imobiliária (ver `imobiliariaAncorada`).
  confiancaImobiliaria: "ambiguo" | "ancorado" | "campo_unico";
  candidatosImobiliaria: string[];
  empreendimentoAsana: string | null;
  empreendimentoBanco: string | null;
  entityId: string;
  gid: string;
  imobiliaria: string | null;
  nome: string;
  situacaoCorretor: SituacaoCampo;
  situacaoEmail: SituacaoCampo;
  situacaoImobiliaria: SituacaoCampo;
};

export type PlanoCompletar = {
  ambiguos: { candidatos: string[]; gid: string; nome: string }[];
  amostra: {
    corretor: string | null;
    email: string | null;
    entityId: string;
    imobiliaria: string | null;
    nome: string;
  }[];
  // Mesma entidade do Apolo alcançada por DUAS tasks do Asana que discordam. Ver `marcarConflitos`.
  conflitos: { campo: string; entityId: string; nomes: string[]; valores: string[] }[];
  // ⚠️ `emails` NÃO entra aqui: PII de corretor sem consumidor na tela é dado trafegando à toa.
  // O e-mail continua sendo GRAVADO; ele só não volta agregado no payload do dry-run.
  distintos: { corretores: string[]; imobiliarias: string[] };
  escopo: { autorizados: string[]; empreendimento: string };
  grafiasEncontradas: { noAsana: string[]; noBanco: string[] };
  // Só as linhas ACIONÁVEIS (com entidade e dentro do escopo). É o que `aplicarCompletar` usa.
  linhas: LinhaPlano[];
  totais: {
    cadsNoEscopo: number;
    comVinculoDeOrigem: number;
    corretorAPreencher: number;
    corretorJaTemValor: number;
    corretorSemDado: number;
    emailAPreencher: number;
    emailJaTemValor: number;
    emailSemDado: number;
    // Entidades alcançadas por mais de uma task com valores divergentes: NÃO são gravadas.
    entidadesEmConflito: number;
    foraDeEscopo: number;
    imobiliariaAPreencher: number;
    imobiliariaAmbigua: number;
    // Das "a preencher", quantas vêm do campo GENÉRICO em vez do campo do Vale do Ouro. É a
    // escrita menos confiável do lote, e por isso precisa ser visível ANTES do POST.
    imobiliariaPorCampoGenerico: number;
    imobiliariaJaTemValor: number;
    semLinhaNaEsteira: number;
    semVinculoDeOrigem: number;
  };
  vinculoImobiliariaEmpreendimento: {
    cads: number;
    corretores: string[];
    empreendimento: string;
    imobiliaria: string;
  }[];
};

// Classifica UM campo. Pura de propósito: é a regra que decide se algo será gravado em
// produção, e regra que decide escrita tem que ser testável sem banco.
//
// A ordem importa: valor já no banco SEMPRE ganha. Backfill não sobrescreve, nem o que o
// operador digitou à mão, nem o que uma importação anterior acertou.
export function classificarCampo(
  valorNoBanco: string | null | undefined,
  valorNoAsana: string | null | undefined,
): SituacaoCampo {
  const doBanco = (valorNoBanco ?? "").trim();
  if (doBanco) return "jaTemValor";

  const doAsana = (valorNoAsana ?? "").trim();
  if (!doAsana) return "semDado";

  return "completar";
}

// Entidades alcançadas por MAIS DE UMA task do Asana com valores que DISCORDAM.
//
// POR QUE ISTO EXISTE: o dedup por CPF (`criarEntidadesDoLote`) reaproveita a entidade de
// propósito, e o índice único de `apolo_source_links` é por `source_id`, não por `entity_id`.
// Logo dois gids podem apontar para a MESMA entidade. Sem esta checagem, os dois valores
// entrariam em grupos diferentes, o primeiro UPDATE gravaria e o segundo bateria na guarda de
// NULL — resultado: grava o corretor de UMA das duas CADs conforme a ordem de iteração do Map,
// em silêncio e permanentemente.
//
// Valores IGUAIS não são conflito: gravar "Henrique" duas vezes é inofensivo.
export function detectarConflitos(
  linhas: { entityId: string; nome: string; valor: string | null }[],
): Map<string, { nomes: string[]; valores: string[] }> {
  const porEntidade = new Map<string, { nomes: Set<string>; valores: Set<string> }>();

  for (const linha of linhas) {
    const valor = (linha.valor ?? "").trim();
    if (!valor) continue;
    const atual = porEntidade.get(linha.entityId) ?? {
      nomes: new Set<string>(),
      valores: new Set<string>(),
    };
    atual.nomes.add(linha.nome);
    atual.valores.add(valor);
    porEntidade.set(linha.entityId, atual);
  }

  const conflitos = new Map<string, { nomes: string[]; valores: string[] }>();
  for (const [entityId, dados] of porEntidade) {
    if (dados.valores.size < 2) continue;
    conflitos.set(entityId, {
      nomes: [...dados.nomes].sort(),
      valores: [...dados.valores].sort(),
    });
  }

  return conflitos;
}

// Quebra em blocos: o `.in()` do PostgREST vira uma URL, e URL tem limite de tamanho.
export function emBlocos<T>(itens: T[], tamanho: number): T[][] {
  const blocos: T[][] = [];
  for (let i = 0; i < itens.length; i += tamanho) {
    blocos.push(itens.slice(i, i + tamanho));
  }
  return blocos;
}

// Agrupa as entidades por VALOR a gravar. Sem isto seriam ~800 UPDATEs (um por linha); com
// isto são poucas dezenas — ~23 imobiliárias distintas e N corretores.
export function agruparPorValor(
  linhas: { entityId: string; valor: string | null }[],
): Map<string, string[]> {
  const grupos = new Map<string, string[]>();
  for (const linha of linhas) {
    const valor = (linha.valor ?? "").trim();
    if (!valor) continue;
    grupos.set(valor, [...(grupos.get(valor) ?? []), linha.entityId]);
  }
  return grupos;
}

// Mescla o e-mail no metadata do vínculo de origem SEM perder o que já estava lá.
//
// ⚠️ Replace cego apagaria `importadoEm` e `secao`, que é o registro de quando/de onde a CAD
// veio. E só grava se a chave estiver AUSENTE: mesma regra de não sobrescrever de sempre.
export function mesclarMetadataEmail(
  metadataAtual: Record<string, unknown> | null | undefined,
  email: string,
): { metadata: Record<string, unknown>; mudou: boolean } {
  const atual = (metadataAtual ?? {}) as Record<string, unknown>;
  const jaTem = typeof atual.corretorEmail === "string" && atual.corretorEmail.trim() !== "";

  if (jaTem) return { metadata: atual, mudou: false };

  return { metadata: { ...atual, corretorEmail: email }, mudou: true };
}

type LinhaEsteira = {
  corretor: string | null;
  empreendimento: string | null;
  entity_id: string;
  imobiliaria: string | null;
};

type LinhaSourceLink = {
  entity_id: string;
  metadata: Record<string, unknown> | null;
  source_id: string;
};

// LEVANTAMENTO — read-only, custo ZERO (nenhum documento é lido, nenhuma consulta paga).
//
// ⚠️ Toda leitura checa `error` e ABORTA. Não replicamos as duas falhas silenciosas de
// `casarComApolo` (asana-import.ts), que engolem o erro e produzem um preview enganoso — e é
// sobre o preview que a pessoa decide o que gravar em produção.
export async function levantarCompletaveis(
  client: AdminClient,
  input: { empreendimento: string },
): Promise<PlanoCompletar> {
  const alvo = normalizarNome(input.empreendimento);

  // `secoes: []` = todas as seções. As 392 vieram de mais de uma ("Finalizado" e "Em
  // Cadastro"), então restringir a seção deixaria parte do lote de fora.
  const { cads } = await escanearCads({ empreendimento: input.empreendimento, secoes: [] });

  const grafiasNoAsana = new Set<string>();
  for (const cad of cads) if (cad.empreendimento) grafiasNoAsana.add(cad.empreendimento);

  // GUARDA 1 (no Asana): igualdade normalizada. O filtro do `escanearCads` é substring e
  // deixaria passar "Vale do Ouro II".
  const noEscopoAsana = cads.filter((cad) => noEscopo(cad.empreendimento));
  const foraDeEscopo = cads.length - noEscopoAsana.length;

  // Vínculo de origem: é ele que diz qual entidade do Apolo corresponde a cada task.
  const porGid = new Map<string, LinhaSourceLink>();
  for (const bloco of emBlocos(noEscopoAsana.map((c) => c.gid), 200)) {
    const { data, error } = await client
      .from("apolo_source_links")
      .select("entity_id, source_id, metadata")
      .eq("source_system", "asana")
      .eq("source_table", "cad_task")
      .in("source_id", bloco);

    if (error) {
      throw new Error(`Falha ao ler os vinculos de origem: ${error.message}`);
    }
    for (const linha of (data ?? []) as LinhaSourceLink[]) porGid.set(linha.source_id, linha);
  }

  const entityIds = [...porGid.values()].map((l) => l.entity_id);

  // Estado ATUAL da esteira. Só as 4 colunas necessárias: ler `ficha` aqui seria trazer
  // dado de cadastro sem motivo.
  const porEntidade = new Map<string, LinhaEsteira>();
  for (const bloco of emBlocos(entityIds, 200)) {
    const { data, error } = await client
      .from("apolo_esteira")
      .select("entity_id, corretor, imobiliaria, empreendimento")
      .in("entity_id", bloco);

    if (error) {
      throw new Error(`Falha ao ler a esteira: ${error.message}`);
    }
    for (const linha of (data ?? []) as LinhaEsteira[]) porEntidade.set(linha.entity_id, linha);
  }

  const grafiasNoBanco = new Set<string>();
  for (const linha of porEntidade.values()) {
    if (linha.empreendimento) grafiasNoBanco.add(linha.empreendimento);
  }

  const linhas: LinhaPlano[] = [];
  const ambiguos: PlanoCompletar["ambiguos"] = [];
  let semVinculoDeOrigem = 0;
  let foraDeEscopoBanco = 0;
  // Separado de `foraDeEscopo` de propósito: "não tem linha na esteira" e "é de outro
  // empreendimento" são problemas diferentes, e somá-los num número só esconde os dois.
  let semLinhaNaEsteira = 0;

  for (const cad of noEscopoAsana) {
    const link = porGid.get(cad.gid);
    // Sem vínculo de origem não há entidade para atualizar: é CAD que nunca foi importada.
    // Ela não entra no lote — criar entidade aqui seria outra operação, com outro risco.
    if (!link) {
      semVinculoDeOrigem += 1;
      continue;
    }

    const esteira = porEntidade.get(link.entity_id);

    // CAD importada que nunca ganhou linha na esteira. Não é "empreendimento errado".
    if (!esteira) {
      semLinhaNaEsteira += 1;
      continue;
    }

    // GUARDA 2 (no banco): mesmo que o Asana diga "Vale do Ouro", só mexemos na linha se o
    // que está GRAVADO também estiver na lista autorizada. As duas pontas têm que concordar.
    if (!noEscopo(esteira.empreendimento)) {
      foraDeEscopoBanco += 1;
      continue;
    }

    const ancora = imobiliariaAncorada({ custom_fields: cad.customFields }, alvo);

    // Ordem deliberada: valor já gravado ganha de tudo (nem lemos a ambiguidade nesse caso,
    // porque não há decisão a tomar). Só depois a ambiguidade vira bloqueio de escrita.
    let situacaoImobiliaria: SituacaoCampo;
    if ((esteira?.imobiliaria ?? "").trim()) {
      situacaoImobiliaria = "jaTemValor";
    } else if (ancora.confianca === "ambiguo" && ancora.candidatos.length > 0) {
      situacaoImobiliaria = "ambiguo";
    } else {
      situacaoImobiliaria = classificarCampo(esteira?.imobiliaria, ancora.valor);
    }

    if (situacaoImobiliaria === "ambiguo") {
      ambiguos.push({ candidatos: ancora.candidatos, gid: cad.gid, nome: cad.nome });
    }

    linhas.push({
      candidatosImobiliaria: ancora.candidatos,
      confiancaImobiliaria: ancora.confianca,
      corretor: cad.corretor,
      corretorEmail: cad.corretorEmail,
      empreendimentoAsana: cad.empreendimento,
      empreendimentoBanco: esteira?.empreendimento ?? null,
      entityId: link.entity_id,
      gid: cad.gid,
      imobiliaria: ancora.valor,
      nome: cad.nome,
      situacaoCorretor: classificarCampo(esteira?.corretor, cad.corretor),
      // O e-mail não tem coluna própria ainda (migration 0060 pendente de OK): mora em
      // `apolo_source_links.metadata.corretorEmail`. O "valor no banco" é essa chave.
      situacaoEmail: classificarCampo(
        typeof link.metadata?.corretorEmail === "string"
          ? (link.metadata.corretorEmail as string)
          : null,
        cad.corretorEmail,
      ),
      situacaoImobiliaria,
    });
  }

  // CONFLITO ENTRE TASKS QUE APONTAM PARA A MESMA ENTIDADE.
  //
  // Rebaixa para "ambiguo", que é a situação que NUNCA é gravada (os filtros de `aplicarCompletar`
  // exigem "completar"). Assim o desempate vira decisão humana em vez de ordem de iteração.
  const conflitos: PlanoCompletar["conflitos"] = [];
  const camposEmConflito = [
    { campo: "corretor" as const, pegar: (l: LinhaPlano) => l.corretor, situacao: "situacaoCorretor" as const },
    { campo: "corretorEmail" as const, pegar: (l: LinhaPlano) => l.corretorEmail, situacao: "situacaoEmail" as const },
    { campo: "imobiliaria" as const, pegar: (l: LinhaPlano) => l.imobiliaria, situacao: "situacaoImobiliaria" as const },
  ];

  const entidadesEmConflito = new Set<string>();
  for (const { campo, pegar, situacao } of camposEmConflito) {
    const achados = detectarConflitos(
      linhas.map((l) => ({ entityId: l.entityId, nome: l.nome, valor: pegar(l) })),
    );
    for (const [entityId, dados] of achados) {
      entidadesEmConflito.add(entityId);
      conflitos.push({ campo, entityId, nomes: dados.nomes, valores: dados.valores });
      for (const linha of linhas) {
        if (linha.entityId === entityId) linha[situacao] = "ambiguo";
      }
    }
  }

  const contar = (campo: keyof LinhaPlano, valor: SituacaoCampo) =>
    linhas.filter((l) => l[campo] === valor).length;

  // MATRIZ imobiliária × empreendimento — o insumo do credenciamento.
  //
  // Este é o entregável que substitui a criação de `apolo_relationships` neste lote: a lista de
  // QUEM precisa ser credenciado. O relacionamento de verdade nasce em /apolo/credenciamento,
  // com o `enterpriseId` numérico do C2X, que o Asana simplesmente não fornece.
  const matriz = new Map<
    string,
    { cads: number; corretores: Set<string>; imobiliaria: string }
  >();
  for (const linha of linhas) {
    const imobiliaria = (linha.imobiliaria ?? "").trim();
    if (!imobiliaria) continue;
    const atual = matriz.get(imobiliaria) ?? {
      cads: 0,
      corretores: new Set<string>(),
      imobiliaria,
    };
    atual.cads += 1;
    if (linha.corretor?.trim()) atual.corretores.add(linha.corretor.trim());
    matriz.set(imobiliaria, atual);
  }

  const distintosDe = (pegar: (l: LinhaPlano) => string | null) =>
    [...new Set(linhas.map(pegar).filter((v): v is string => Boolean(v?.trim())))].sort();

  return {
    ambiguos,
    amostra: linhas.slice(0, 20).map((l) => ({
      corretor: l.corretor,
      email: l.corretorEmail,
      entityId: l.entityId,
      imobiliaria: l.imobiliaria,
      nome: l.nome,
    })),
    conflitos,
    distintos: {
      corretores: distintosDe((l) => l.corretor),
      imobiliarias: distintosDe((l) => l.imobiliaria),
    },
    escopo: {
      autorizados: [...EMPREENDIMENTOS_AUTORIZADOS],
      empreendimento: input.empreendimento,
    },
    grafiasEncontradas: {
      noAsana: [...grafiasNoAsana].sort(),
      noBanco: [...grafiasNoBanco].sort(),
    },
    linhas,
    totais: {
      cadsNoEscopo: noEscopoAsana.length,
      comVinculoDeOrigem: linhas.length,
      corretorAPreencher: contar("situacaoCorretor", "completar"),
      corretorJaTemValor: contar("situacaoCorretor", "jaTemValor"),
      corretorSemDado: contar("situacaoCorretor", "semDado"),
      emailAPreencher: contar("situacaoEmail", "completar"),
      emailJaTemValor: contar("situacaoEmail", "jaTemValor"),
      emailSemDado: contar("situacaoEmail", "semDado"),
      entidadesEmConflito: entidadesEmConflito.size,
      foraDeEscopo: foraDeEscopo + foraDeEscopoBanco,
      imobiliariaAPreencher: contar("situacaoImobiliaria", "completar"),
      imobiliariaAmbigua: contar("situacaoImobiliaria", "ambiguo"),
      imobiliariaJaTemValor: contar("situacaoImobiliaria", "jaTemValor"),
      imobiliariaPorCampoGenerico: linhas.filter(
        (l) => l.situacaoImobiliaria === "completar" && l.confiancaImobiliaria === "campo_unico",
      ).length,
      semLinhaNaEsteira,
      semVinculoDeOrigem,
    },
    vinculoImobiliariaEmpreendimento: [...matriz.values()]
      .map((v) => ({
        cads: v.cads,
        corretores: [...v.corretores].sort(),
        // Fixo: a linha só chegou aqui depois de passar nas DUAS guardas de escopo.
        empreendimento: EMPREENDIMENTOS_AUTORIZADOS[0]!,
        imobiliaria: v.imobiliaria,
      }))
      .sort((a, b) => b.cads - a.cads),
  };
}

export type ResultadoCompletar = {
  atualizados: { corretor: number; email: number; imobiliaria: number };
  erros: string[];
  // Onde parou, se abortou. É o que permite retomar sem refazer tudo às cegas.
  ultimoEntityId: string | null;
  // Linha que era para atualizar e não voltou: alguém preencheu no meio do caminho. Não é erro.
  pulados: number;
};

// Atualiza UMA coluna, agrupada por valor, com a guarda de NULL no BANCO.
//
// A guarda `.is(coluna, null)` é o que torna a operação idempotente e não-destrutiva sem
// depender de o código ter lido o estado certo: quem decide é o banco, no momento do UPDATE.
// Segunda rodada não encontra nada e não escreve.
//
// ⚠️ `atualizado_em` fica FORA do payload de propósito. A coluna é `not null default now()`, e
// default só se aplica no INSERT — um UPDATE que não a cita não a altera. É isso que impede a
// fila do Board (ordenada por `atualizado_em`) de embaralhar inteira.
async function atualizarColuna(
  client: AdminClient,
  coluna: "corretor" | "imobiliaria",
  linhas: { entityId: string; valor: string | null }[],
  resultado: ResultadoCompletar,
): Promise<boolean> {
  const grupos = agruparPorValor(linhas);

  for (const [valor, ids] of grupos) {
    for (const bloco of emBlocos(ids, 100)) {
      resultado.ultimoEntityId = bloco[bloco.length - 1] ?? resultado.ultimoEntityId;

      // ⚠️ `.select()` é obrigatório aqui: com RLS ligada (migration 0057 só tem policy de
      // SELECT), uma chave sem privilégio devolve SUCESSO com zero linhas afetadas. Sem
      // conferir o retorno, o backfill "passaria" sem gravar nada.
      // ⚠️ `is.null` SOZINHO não casaria uma linha com string vazia, mas `classificarCampo` trata
      // `''` como vazia e a promete na tela. Sem o `eq.` a linha seria prometida e silenciosamente
      // virava "pulado" — código e banco discordando sobre o que é "vazio".
      const { data, error } = await client
        .from("apolo_esteira")
        .update({ [coluna]: valor })
        .in("entity_id", bloco)
        .or(`${coluna}.is.null,${coluna}.eq.`)
        .select("entity_id");

      if (error) {
        resultado.erros.push(`${coluna}: ${error.message}`);
        return false;
      }

      const voltaram = new Set(
        ((data ?? []) as { entity_id: string }[]).map((l) => l.entity_id),
      );
      resultado.atualizados[coluna] += voltaram.size;
      resultado.pulados += bloco.filter((id) => !voltaram.has(id)).length;
    }
  }

  return true;
}

// APLICAÇÃO — a única parte que ESCREVE. Só roda por disparo explícito do Lucas.
//
// `corretor` e `imobiliaria` vão em chamadas SEPARADAS, com payload de uma coluna só. É o que
// torna estruturalmente impossível um zerar o outro.
export async function aplicarCompletar(
  client: AdminClient,
  input: {
    apenas?: ("corretor" | "email" | "imobiliaria")[];
    plano: PlanoCompletar;
  },
): Promise<ResultadoCompletar> {
  const resultado: ResultadoCompletar = {
    atualizados: { corretor: 0, email: 0, imobiliaria: 0 },
    erros: [],
    pulados: 0,
    ultimoEntityId: null,
  };

  const querem = input.apenas?.length
    ? new Set(input.apenas)
    : new Set<"corretor" | "email" | "imobiliaria">(["corretor", "email", "imobiliaria"]);

  if (querem.has("corretor")) {
    const alvos = input.plano.linhas
      .filter((l) => l.situacaoCorretor === "completar")
      .map((l) => ({ entityId: l.entityId, valor: l.corretor }));

    if (!(await atualizarColuna(client, "corretor", alvos, resultado))) return resultado;
  }

  if (querem.has("imobiliaria")) {
    // Ambíguo NUNCA entra: `situacaoImobiliaria === "completar"` já exclui.
    const alvos = input.plano.linhas
      .filter((l) => l.situacaoImobiliaria === "completar")
      .map((l) => ({ entityId: l.entityId, valor: l.imobiliaria }));

    if (!(await atualizarColuna(client, "imobiliaria", alvos, resultado))) return resultado;
  }

  if (querem.has("email")) {
    // Sem coluna própria (migration 0060 aguarda OK), o e-mail vai para o metadata do vínculo
    // de origem: é semanticamente "o que a task do Asana dizia". Uma linha por vez, porque
    // merge de jsonb exige ler antes de escrever.
    for (const linha of input.plano.linhas) {
      if (linha.situacaoEmail !== "completar" || !linha.corretorEmail) continue;

      resultado.ultimoEntityId = linha.entityId;

      const { data, error: erroLeitura } = await client
        .from("apolo_source_links")
        .select("metadata")
        .eq("source_system", "asana")
        .eq("source_table", "cad_task")
        .eq("source_id", linha.gid)
        .maybeSingle();

      if (erroLeitura) {
        resultado.erros.push(`email ${linha.gid}: ${erroLeitura.message}`);
        return resultado;
      }
      if (!data) {
        resultado.pulados += 1;
        continue;
      }

      const { metadata, mudou } = mesclarMetadataEmail(
        (data as { metadata: Record<string, unknown> | null }).metadata,
        linha.corretorEmail,
      );
      if (!mudou) {
        resultado.pulados += 1;
        continue;
      }

      const { data: gravadas, error } = await client
        .from("apolo_source_links")
        .update({ metadata })
        .eq("source_system", "asana")
        .eq("source_table", "cad_task")
        .eq("source_id", linha.gid)
        .select("source_id");

      if (error) {
        resultado.erros.push(`email ${linha.gid}: ${error.message}`);
        return resultado;
      }
      if ((gravadas ?? []).length === 0) resultado.pulados += 1;
      else resultado.atualizados.email += 1;
    }
  }

  return resultado;
}
