import {
  loadApoloEnterpriseCarteira,
  loadApoloUnitInstallments,
  type ApoloCarteiraUnit,
  type ApoloUnitInstallment,
} from "@/lib/apolo/carteira";
import { catalogoDeEmpreendimentos } from "@/lib/apolo/catalogo-empreendimentos";
import { createApoloAdminClient } from "@/lib/apolo/server";
import {
  APOLO_VENDA_STAGE_LABELS,
  loadApoloEnterpriseVendas,
  type ApoloVendaUnit,
} from "@/lib/apolo/vendas";

import { codigosDaSessao, idsDaSessao } from "./escopo";
import {
  formatarDocumento,
  lerCadastroDaPessoa,
  lerC2xUserId,
  lerCorretorDoContrato,
  type GrupoDoCadastro,
  type RelacionamentosDaFicha,
} from "./ficha-cadastro";
import type { SessaoIncorporador } from "./sessao";

// O CRM DO INCORPORADOR: as pessoas do empreendimento dele.
//
// Pedido do Lucas (17/08/2026): *"no CRM, quero as mesmas telas do Apolo, CRM, é replicar ela… é
// como se o incorporador estivesse acessando o Apolo, contudo filtrado o empreendimento deles,
// tanto prospect, comprador, e imobiliárias, todos deverão ter vínculos com o empreendimento"*.
//
// ⚠️ REPLICAR A TELA NÃO É REUSAR O PAYLOAD. O CRM interno serve `loadApoloDashboard`, e a entidade
// que sai de lá carrega a ficha inteira do cliente: CPF, RG, nome da mãe, cônjuge, telefone,
// e-mail, endereço. Aquilo é para o analista da Careli, que atende a pessoa. O incorporador é
// CLIENTE — ele acompanha a venda no loteamento dele, não faz atendimento. Por isso este arquivo
// monta um payload PRÓPRIO, com o mínimo que responde "quem está comprando, em que pé está e por
// qual imobiliária", e nada além disso. O que ficou de fora está escrito campo a campo abaixo.
//
// As três listas e de onde cada uma vem:
//   • COMPRADORES  — C2X (carteira + vendas do empreendimento). É quem tem unidade.
//   • PROSPECTS    — `apolo_esteira`, a CAD por (pessoa, empreendimento).
//   • IMOBILIÁRIAS — as que venderam no C2X + as que têm vínculo `empreendimento` no Apolo.

type AdminClient = NonNullable<ReturnType<typeof createApoloAdminClient>>;

/** Uma unidade na mão de um comprador, do jeito que o incorporador acompanha. */
export type UnidadeDoCrm = {
  /** Código do lote (VOCQ02L18), o mesmo do Apolo e do masterplan. */
  codigo: string;
  empreendimento: null | string;
  /** Rótulo do funil: Reservado, Proposta emitida, Contrato gerado, Em assinatura, Faturado. */
  estagio: string;
  lote: null | string;
  quadra: null | string;
  vgv: number;
};

export type SituacaoDoComprador = "em_atraso" | "em_dia" | "sem_parcelas";

export type CompradorDoCrm = {
  aReceber: number;
  /** CPF/CNPJ SEM máscara (ordem do Lucas, 18/08/2026 — ver `formatarDocumento`). */
  documento: null | string;
  emAtraso: number;
  /**
   * ⚠️ EXCEÇÃO DECLARADA à regra "id interno de entidade do CRM não sai em /api/incorporador/*".
   *
   * Este `id` É o `entityId` do CRM interno (`deterministicUuid("apolo:c2x:users:<id>")`), e ele
   * sai no payload porque a ficha (`/api/incorporador/crm/ficha`) precisa de UMA chave para o
   * clique no card reabrir a MESMA pessoa. Por que a exceção é aceitável, ponto a ponto:
   *   • é um UUID determinístico OPACO: não é o `users.id` do C2X nem revela nada sozinho, e não
   *     dá para enumerar sem conhecer o namespace do hash;
   *   • ele NÃO é credencial: a rota da ficha reconfere o pertencimento ao escopo da sessão no
   *     SERVIDOR a cada chamada (`montarFicha` refaz a consulta estreitada por
   *     `codigosDaSessao`/`idsDaSessao`) — id de outro loteador responde 404;
   *   • a alternativa (id derivado por sessão, ex. HMAC) quebraria link/cache entre sessões do
   *     mesmo cliente sem reduzir risco real, já que a autorização nunca depende do id.
   * Registrado em 17/08/2026 como divergência consciente, pendente de ratificação do Lucas. O
   * mesmo vale para `ImobiliariaDoCrm.id` e `ProspectDoCrm.id`.
   */
  id: string;
  imobiliaria: null | string;
  /** Cidade/UF da entidade no Apolo (o card da lista mostra embaixo do nome, como o interno). */
  local: null | string;
  maiorAtrasoDias: number;
  nome: string;
  pago: number;
  parcelasEmAtraso: number;
  situacao: SituacaoDoComprador;
  total: number;
  unidades: UnidadeDoCrm[];
};

export type ProspectDoCrm = {
  corretor: null | string;
  /** Quando a CAD chegou. É a idade do interesse, que é o que o loteador olha. */
  desde: null | string;
  /** CPF/CNPJ SEM máscara (ordem do Lucas, 18/08/2026 — ver `formatarDocumento`). */
  documento: null | string;
  empreendimento: null | string;
  /** Rótulo público da etapa. Ver `rotuloDaEtapa` — o vocabulário interno não sai daqui. */
  etapa: string;
  id: string;
  imobiliaria: null | string;
  local: null | string;
  nome: string;
};

export type ImobiliariaDoCrm = {
  /** CADs desta imobiliária na esteira do empreendimento. */
  cads: number;
  compradores: number;
  /** Tem vínculo de empreendimento habilitado (`verified`) no Apolo. */
  credenciada: boolean;
  documento: null | string;
  /** `entityId` do CRM — exceção declarada; ver a justificativa em `CompradorDoCrm.id`. */
  id: string;
  nome: string;
  unidades: number;
  vgv: number;
};

// ── REGRAS PURAS ────────────────────────────────────────────────────────────
//
// ⚠️ SOBRE O DOCUMENTO: até 17/08 este arquivo mascarava CPF/CNPJ (`mascararDocumento`). Em
// 18/08/2026 o Lucas mandou o portal ser IGUAL ao Apolo interno — *"tem que ser igual, cadastro,
// tudo que estiver no apolo tem que está aqui"* — e no interno o documento sai inteiro (ele já
// tinha mandado tirar a máscara do Panteon). O documento agora sai SEM máscara, na lista e na
// ficha, normalizado por `formatarDocumento` (ficha-cadastro.ts).

/**
 * A etapa da CAD no VOCABULÁRIO DO CLIENTE.
 *
 * Duas regras do Lucas mandam aqui. A primeira: *"esteira é nosso"* — o corretor e o incorporador
 * chamam isso de fluxo de cadastro, e peça externa não usa nome interno. A segunda, mais dura, é de
 * privacidade: `revisao` e `indeferido` são, na prática, o resultado da ANÁLISE DE CRÉDITO da
 * pessoa (score, restrição). O incorporador não é o credor — quem administra a carteira é a Careli
 * — e não tem por que saber que fulano foi reprovado no Serasa. Por isso os dois desvios saem como
 * estado do processo, nunca como veredito sobre a pessoa.
 */
export function rotuloDaEtapa(etapa: null | string | undefined): string {
  const chave = String(etapa ?? "").trim().toLowerCase();

  const rotulos: Record<string, string> = {
    cadastro: "Em cadastro",
    correcao: "Aguardando correção",
    credenciado: "Credenciado",
    credito: "Em análise",
    indeferido: "Não seguiu",
    prevenda: "Aguardando pré-venda",
    revisao: "Em análise",
    validacao: "Em validação",
  };

  return rotulos[chave] ?? "Em andamento";
}

/**
 * O CÓDIGO do empreendimento embutido no código da unidade.
 *
 * `buildUnitCode` (carteira.ts/vendas.ts) monta o rótulo como `<3 letras do code><quadra><lote>`, e
 * `ApoloVendaUnit` não devolve o código do empreendimento separado. Como todo `enterprises.code` do
 * C2X tem exatamente 3 letras (conferido nas 36 linhas em 17/08/2026), o prefixo É o código. Se um
 * dia nascer código com outro tamanho, o nome do empreendimento vira nulo na tela — some o rótulo,
 * não some a unidade.
 */
export function codeDaUnidade(codigoDaUnidade: string): string {
  return String(codigoDaUnidade ?? "").slice(0, 3).toUpperCase();
}

function situacao(
  emAtraso: number,
  total: number,
): SituacaoDoComprador {
  if (emAtraso > 0) return "em_atraso";
  return total > 0 ? "em_dia" : "sem_parcelas";
}

/**
 * Junta as duas leituras do C2X numa lista por PESSOA.
 *
 * As vendas dizem em que pé está cada unidade (inclusive o que ainda não virou contrato: reserva,
 * proposta, assinatura). A carteira diz o dinheiro (pago, a receber, atraso), e só existe depois do
 * faturamento. Uma sozinha não responde "quem está comprando e como está pagando" — por isso as
 * duas, casadas pelo `entityId`, que as duas derivam do MESMO `users.id` do C2X.
 */
export function agregarCompradores({
  carteira,
  nomePorCode,
  vendas,
}: {
  carteira: ApoloCarteiraUnit[];
  /** code do empreendimento -> nome de exibição. */
  nomePorCode: Map<string, string>;
  vendas: ApoloVendaUnit[];
}): CompradorDoCrm[] {
  const porPessoa = new Map<string, CompradorDoCrm>();
  // Unidades já lançadas por pessoa, para a carteira não repetir o que a venda já trouxe.
  const unidadesVistas = new Map<string, Set<string>>();

  const abrir = (id: string, nome: string): CompradorDoCrm => {
    const atual = porPessoa.get(id);
    if (atual) return atual;

    const novo: CompradorDoCrm = {
      aReceber: 0,
      // Documento e local chegam DEPOIS, por `anexarIdentidade` — a agregação só conhece o C2X,
      // e o documento/cidade vivem na entidade do Apolo.
      documento: null,
      emAtraso: 0,
      id,
      imobiliaria: null,
      local: null,
      maiorAtrasoDias: 0,
      nome,
      pago: 0,
      parcelasEmAtraso: 0,
      situacao: "sem_parcelas",
      total: 0,
      unidades: [],
    };
    porPessoa.set(id, novo);
    unidadesVistas.set(id, new Set());
    return novo;
  };

  for (const unidade of vendas) {
    if (!unidade.client) continue;

    const pessoa = abrir(unidade.client.entityId, unidade.client.name);
    // ⚠️ `??` NÃO troca string vazia: a imobiliária só entra se tiver nome de verdade, senão a
    // primeira linha sem nome trancaria o campo e as próximas não corrigiriam.
    if (!pessoa.imobiliaria && unidade.imobiliaria?.name) {
      pessoa.imobiliaria = unidade.imobiliaria.name;
    }

    pessoa.unidades.push({
      codigo: unidade.code,
      empreendimento: nomePorCode.get(codeDaUnidade(unidade.code)) ?? null,
      estagio: APOLO_VENDA_STAGE_LABELS[unidade.stage],
      lote: unidade.lot,
      quadra: unidade.block,
      vgv: unidade.vgv,
    });
    unidadesVistas.get(unidade.client.entityId)?.add(unidade.id);
  }

  for (const unidade of carteira) {
    if (!unidade.client) continue;

    const pessoa = abrir(unidade.client.entityId, unidade.client.name);
    if (!pessoa.imobiliaria && unidade.imobiliaria?.name) {
      pessoa.imobiliaria = unidade.imobiliaria.name;
    }

    pessoa.aReceber += unidade.toReceiveAmount;
    pessoa.emAtraso += unidade.overdueAmount;
    pessoa.pago += unidade.paidAmount;
    pessoa.parcelasEmAtraso += unidade.overdueInstallments;
    pessoa.total += unidade.totalContract;
    pessoa.maiorAtrasoDias = Math.max(pessoa.maiorAtrasoDias, unidade.maxOverdueDays);

    // A unidade que a venda não listou para esta pessoa (revenda: o contrato é dela, a proposta
    // mais recente da unidade é de outro) entra aqui, para o dinheiro não ficar sem lote.
    const vistas = unidadesVistas.get(unidade.client.entityId);
    if (vistas && !vistas.has(unidade.id)) {
      vistas.add(unidade.id);
      pessoa.unidades.push({
        codigo: unidade.code,
        empreendimento:
          unidade.enterpriseName ?? nomePorCode.get(unidade.enterpriseCode) ?? null,
        estagio: APOLO_VENDA_STAGE_LABELS.faturado,
        lote: unidade.lot,
        quadra: unidade.block,
        vgv: unidade.totalContract,
      });
    }
  }

  return [...porPessoa.values()]
    .map((pessoa) => ({ ...pessoa, situacao: situacao(pessoa.emAtraso, pessoa.total) }))
    .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
}

/** Documento + cidade/UF de uma entidade, para o card da lista (padrão do CRM 360 interno). */
export type IdentidadeDaEntidade = { documento: null | string; local: null | string };

/**
 * Completa a lista de compradores com documento e cidade/UF (o card interno mostra "documento
 * nome" na primeira linha e a cidade embaixo). Quem não tem entidade no Apolo fica com nulo —
 * o card mostra só o nome, nunca trava a lista.
 */
export function anexarIdentidade(
  compradores: CompradorDoCrm[],
  porEntidade: Map<string, IdentidadeDaEntidade>,
): CompradorDoCrm[] {
  return compradores.map((comprador) => {
    const identidade = porEntidade.get(comprador.id);
    if (!identidade) return comprador;

    return { ...comprador, documento: identidade.documento, local: identidade.local };
  });
}


/**
 * As imobiliárias do empreendimento: as que já venderam (C2X) e as que estão habilitadas no Apolo
 * sem venda ainda.
 *
 * Quem só tem vínculo aparece com zero venda de propósito: para o loteador, "credenciei cinco e
 * duas nunca venderam" é informação, e uma lista que só mostra quem vendeu esconde exatamente isso.
 */
export function agregarImobiliarias({
  cadsPorEntidade,
  carteira,
  credenciadas,
  vendas,
}: {
  /** entityId da imobiliária -> quantas CADs ela tem na esteira deste empreendimento. */
  cadsPorEntidade: Map<string, number>;
  carteira: ApoloCarteiraUnit[];
  /** As que têm vínculo de empreendimento no Apolo, com nome e documento já mascarado. */
  credenciadas: Array<{
    documento: null | string;
    id: string;
    nome: string;
    /** Vínculo `verified` = habilitada de fato. `pending` entra na lista, mas sem o selo. */
    verificada: boolean;
  }>;
  vendas: ApoloVendaUnit[];
}): ImobiliariaDoCrm[] {
  const porImobiliaria = new Map<string, ImobiliariaDoCrm>();
  const compradoresPorImobiliaria = new Map<string, Set<string>>();

  const abrir = (id: string, nome: string): ImobiliariaDoCrm => {
    const atual = porImobiliaria.get(id);
    if (atual) return atual;

    const novo: ImobiliariaDoCrm = {
      cads: cadsPorEntidade.get(id) ?? 0,
      compradores: 0,
      credenciada: false,
      documento: null,
      id,
      nome,
      unidades: 0,
      vgv: 0,
    };
    porImobiliaria.set(id, novo);
    compradoresPorImobiliaria.set(id, new Set());
    return novo;
  };

  // As unidades com venda ativa: é o que o loteador entende por "vendeu".
  for (const unidade of vendas) {
    if (!unidade.imobiliaria) continue;

    const imobiliaria = abrir(unidade.imobiliaria.entityId, unidade.imobiliaria.name);
    imobiliaria.unidades += 1;
    imobiliaria.vgv += unidade.vgv;
    if (unidade.client) {
      compradoresPorImobiliaria.get(unidade.imobiliaria.entityId)?.add(unidade.client.entityId);
    }
  }

  // A carteira só acrescenta COMPRADOR (o contrato existe), nunca unidade: somar as duas fontes
  // contaria a mesma venda duas vezes.
  for (const unidade of carteira) {
    if (!unidade.imobiliaria || !unidade.client) continue;

    abrir(unidade.imobiliaria.entityId, unidade.imobiliaria.name);
    compradoresPorImobiliaria
      .get(unidade.imobiliaria.entityId)
      ?.add(unidade.client.entityId);
  }

  for (const credenciada of credenciadas) {
    const imobiliaria = abrir(credenciada.id, credenciada.nome);
    // `||` e não `=`: a mesma imobiliária pode chegar aqui por mais de um empreendimento do
    // escopo, um habilitado e outro em análise. Basta um habilitado para o selo valer.
    imobiliaria.credenciada = imobiliaria.credenciada || credenciada.verificada;
    imobiliaria.documento = credenciada.documento;
  }

  return [...porImobiliaria.values()]
    .map((imobiliaria) => ({
      ...imobiliaria,
      compradores: compradoresPorImobiliaria.get(imobiliaria.id)?.size ?? 0,
    }))
    .sort((a, b) => b.vgv - a.vgv || a.nome.localeCompare(b.nome, "pt-BR"));
}

// ── LEITURAS (Supabase) ─────────────────────────────────────────────────────

/** PostgREST estoura a URL com `in.(...)` grande: 700 ids devolvem 400. Ver [[postgrest-in-url-limite]]. */
const LOTE = 100;

async function emLotes<T>(
  ids: string[],
  // `PromiseLike` e não `Promise`: o builder do supabase-js é um thenable, e só vira Promise no
  // `await`. Exigir `Promise` aqui obrigaria cada chamada a embrulhar a query numa função async.
  ler: (bloco: string[]) => PromiseLike<{
    data: null | T[];
    error: null | { message: string };
  }>,
): Promise<{ error: null | string; linhas: T[] }> {
  const linhas: T[] = [];

  for (let i = 0; i < ids.length; i += LOTE) {
    const { data, error } = await ler(ids.slice(i, i + LOTE));

    // ⚠️ SEMPRE CHECAR O `error`. Lista vazia por falha de leitura vira "este empreendimento não
    // tem cliente" na tela do cliente, que é uma afirmação falsa e cara.
    if (error) return { error: error.message, linhas: [] };
    linhas.push(...((data ?? []) as T[]));
  }

  return { error: null, linhas };
}

export type LinhaEsteira = {
  chegou_em: null | string;
  corretor: null | string;
  empreendimento: null | string;
  enterprise_id: null | string;
  entity_id: string;
  etapa: null | string;
  imobiliaria: null | string;
  imobiliaria_entity_id: null | string;
};

type LinhaEntidade = {
  display_name: null | string;
  document_masked: null | string;
  id: string;
  legal_name: null | string;
  primary_city: null | string;
  primary_state: null | string;
  trade_name: null | string;
};

function nomeDaEntidade(linha: LinhaEntidade | undefined): string {
  const candidatos = [linha?.display_name, linha?.trade_name, linha?.legal_name];

  for (const candidato of candidatos) {
    const limpo = String(candidato ?? "").trim();
    if (limpo) return limpo;
  }

  return "Sem nome";
}

function local(linha: LinhaEntidade | undefined): null | string {
  const cidade = String(linha?.primary_city ?? "").trim();
  const uf = String(linha?.primary_state ?? "").trim();

  if (cidade && uf) return `${cidade}/${uf}`;
  return cidade || uf || null;
}

/**
 * As linhas de CAD dos empreendimentos autorizados.
 *
 * `apolo_esteira` é chaveada por `(entity_id, enterprise_id)` desde a migration 0080: uma CAD por
 * pessoa POR empreendimento. Por isso o filtro é direto na coluna, sem precisar cruzar vínculo.
 *
 * Fica separada de `montarProspects` porque a aba de imobiliárias precisa SÓ da contagem por
 * imobiliária: sem a divisão, montar aquela aba puxaria as 700 entidades das CADs à toa.
 */
export async function lerEsteiraDoEscopo(
  admin: AdminClient,
  enterpriseIds: string[],
): Promise<{ erro: string; ok: false } | { linhas: LinhaEsteira[]; ok: true }> {
  if (enterpriseIds.length === 0) return { linhas: [], ok: true };

  const esteira = await emLotes<LinhaEsteira>(enterpriseIds, (bloco) =>
    admin
      .from("apolo_esteira")
      .select(
        "entity_id, etapa, enterprise_id, empreendimento, imobiliaria, corretor, chegou_em, imobiliaria_entity_id",
      )
      .in("enterprise_id", bloco)
      .limit(5000)
      .returns<LinhaEsteira[]>(),
  );

  if (esteira.error) return { erro: esteira.error, ok: false };

  return { linhas: esteira.linhas, ok: true };
}

/**
 * Quantas CADs cada imobiliária tem no escopo.
 *
 * ⚠️ PELO `imobiliaria_entity_id`, NUNCA pelo texto de `imobiliaria`. A mesma imobiliária aparece
 * escrita de três formas na esteira ("RR Soluções", "RR Soluções Imobiliárias LTDA", "RR SOLUCOES
 * IMOBILIARIAS LTDA") sobre o MESMO entity_id — contar por nome daria três imobiliárias. Ver
 * [[apolo-imobiliaria-duas-fontes]].
 *
 * O id casa com o das vendas do C2X porque os dois são `deterministicUuid("apolo:c2x:users:<id>")`
 * — conferido em 17/08/2026 pelos `apolo_source_links` das imobiliárias da esteira.
 */
export function contarCadsPorImobiliaria(linhas: LinhaEsteira[]): Map<string, number> {
  const contagem = new Map<string, number>();

  for (const linha of linhas) {
    const id = linha.imobiliaria_entity_id;
    if (id) contagem.set(id, (contagem.get(id) ?? 0) + 1);
  }

  return contagem;
}

/** Completa as CADs com o nome e a cidade de cada pessoa. */
export async function montarProspects(
  admin: AdminClient,
  linhas: LinhaEsteira[],
): Promise<{ erro: string; ok: false } | { ok: true; prospects: ProspectDoCrm[] }> {
  if (linhas.length === 0) return { ok: true, prospects: [] };

  const entityIds = [...new Set(linhas.map((linha) => linha.entity_id))];
  const entidades = await emLotes<LinhaEntidade>(entityIds, (bloco) =>
    admin
      .from("apolo_entities")
      .select(
        "id, display_name, legal_name, trade_name, document_masked, primary_city, primary_state",
      )
      .in("id", bloco)
      .returns<LinhaEntidade[]>(),
  );

  if (entidades.error) return { erro: entidades.error, ok: false };

  const porId = new Map(entidades.linhas.map((linha) => [linha.id, linha]));

  const prospects = linhas
    .map((linha) => {
      const entidade = porId.get(linha.entity_id);

      return {
        corretor: texto(linha.corretor),
        desde: linha.chegou_em,
        // SEM máscara, por ordem do dono (18/08/2026) — ver o aviso no topo das regras puras.
        documento: formatarDocumento(entidade?.document_masked),
        empreendimento: texto(linha.empreendimento),
        etapa: rotuloDaEtapa(linha.etapa),
        // A CHAVE É (pessoa, empreendimento), não a pessoa: desde a migration 0080 a mesma pessoa
        // tem uma CAD por empreendimento, e quem tem dois empreendimentos no escopo veria a linha
        // duplicada com o mesmo id.
        id: `${linha.entity_id}:${linha.enterprise_id ?? ""}`,
        imobiliaria: texto(linha.imobiliaria),
        local: local(entidade),
        nome: nomeDaEntidade(entidade),
      };
    })
    .sort((a, b) => (b.desde ?? "").localeCompare(a.desde ?? ""));

  return { ok: true, prospects };
}

/** Lê documento e cidade/UF das entidades pedidas (em lotes — ver `emLotes`). */
export async function lerIdentidades(
  admin: AdminClient,
  entityIds: string[],
): Promise<Map<string, IdentidadeDaEntidade>> {
  const ids = [...new Set(entityIds)].filter(Boolean);
  if (ids.length === 0) return new Map();

  const entidades = await emLotes<LinhaEntidade>(ids, (bloco) =>
    admin
      .from("apolo_entities")
      .select(
        "id, display_name, legal_name, trade_name, document_masked, primary_city, primary_state",
      )
      .in("id", bloco)
      .returns<LinhaEntidade[]>(),
  );

  // Falha de leitura NÃO derruba a lista: o card fica sem documento/cidade, como já ficaria
  // para quem não tem entidade.
  if (entidades.error) return new Map();

  return new Map(
    entidades.linhas.map((linha) => [
      linha.id,
      { documento: formatarDocumento(linha.document_masked), local: local(linha) },
    ]),
  );
}

type LinhaVinculo = {
  entity_id: string;
  metadata: null | { enterpriseId?: null | number | string };
  status: null | string;
};

/**
 * As imobiliárias com vínculo de empreendimento no Apolo.
 *
 * ⚠️ FILTRAR PELO PAPEL É OBRIGATÓRIO. O vínculo `empreendimento` NÃO é só de imobiliária: prospect
 * e corretor recebem o mesmo `relationship_type` (medido: das 151 linhas, 71 são de prospect ou
 * corretor). Sem o filtro de perfil, o painel do coordenador já contou 76 "imobiliárias" onde
 * havia 30 — ver [[apolo-vinculo-empreendimento-papeis]].
 *
 * A tabela inteira é lida e filtrada em memória de propósito: são 151 linhas, e passar ids com
 * dois-pontos e espaço ("group:Lagoa Bonita") por um `in.(...)` de PostgREST depende de quoting que
 * é fácil de errar em silêncio.
 */
export async function lerImobiliariasVinculadas(
  admin: AdminClient,
  enterpriseIds: string[],
): Promise<
  | {
      credenciadas: Array<{
        documento: null | string;
        id: string;
        nome: string;
        verificada: boolean;
      }>;
      ok: true;
    }
  | { erro: string; ok: false }
> {
  if (enterpriseIds.length === 0) return { credenciadas: [], ok: true };

  const autorizados = new Set(enterpriseIds.map((id) => String(id).trim()));

  const { data, error } = await admin
    .from("apolo_relationships")
    .select("entity_id, status, metadata")
    .eq("relationship_type", "empreendimento")
    .limit(5000)
    .returns<LinhaVinculo[]>();

  if (error) return { erro: error.message, ok: false };

  // `archived` fica de fora: vínculo desfeito não é imobiliária do empreendimento.
  const candidatos = new Map<string, boolean>();
  for (const linha of data ?? []) {
    const alvo = String(linha.metadata?.enterpriseId ?? "").trim();
    if (!alvo || !autorizados.has(alvo)) continue;
    if (linha.status === "archived") continue;

    candidatos.set(linha.entity_id, candidatos.get(linha.entity_id) || linha.status === "verified");
  }

  if (candidatos.size === 0) return { credenciadas: [], ok: true };

  const ids = [...candidatos.keys()];

  const perfis = await emLotes<{ entity_id: string; profile: string }>(ids, (bloco) =>
    admin
      .from("apolo_entity_profiles")
      .select("entity_id, profile")
      .eq("profile", "imobiliaria")
      .in("entity_id", bloco)
      .returns<Array<{ entity_id: string; profile: string }>>(),
  );

  if (perfis.error) return { erro: perfis.error, ok: false };

  const ehImobiliaria = new Set(perfis.linhas.map((linha) => linha.entity_id));
  const somenteImobiliarias = ids.filter((id) => ehImobiliaria.has(id));

  if (somenteImobiliarias.length === 0) return { credenciadas: [], ok: true };

  const entidades = await emLotes<LinhaEntidade>(somenteImobiliarias, (bloco) =>
    admin
      .from("apolo_entities")
      .select(
        "id, display_name, legal_name, trade_name, document_masked, primary_city, primary_state",
      )
      .in("id", bloco)
      .returns<LinhaEntidade[]>(),
  );

  if (entidades.error) return { erro: entidades.error, ok: false };

  return {
    credenciadas: entidades.linhas.map((linha) => ({
      documento: formatarDocumento(linha.document_masked),
      id: linha.id,
      nome: nomeDaEntidade(linha),
      verificada: candidatos.get(linha.id) === true,
    })),
    ok: true,
  };
}

function texto(valor: unknown): null | string {
  const limpo = typeof valor === "string" ? valor.trim() : "";
  return limpo ? limpo : null;
}

// ── FICHA: a visão de UMA pessoa da lista ───────────────────────────────────
//
// A ficha que o clique no card do CRM do portal abre. O contrato continua sendo payload PRÓPRIO,
// allowlist campo a campo, nunca a ApoloEntity — mas desde 18/08/2026 ele carrega o CADASTRO
// COMPLETO da pessoa e os RELACIONAMENTOS dela, por ordem do Lucas: *"CRM, tem que ser igual,
// cadastro, tudo que estiver no apolo tem que está aqui, os documentos"*. O que segue NÃO saindo:
// link Asaas, rótulo interno de esteira, telefone/e-mail de TERCEIROS (imobiliária, corretor),
// nome de empreendimento de outro loteador. O `id` que ela recebe é o MESMO que a lista devolveu
// (comprador/imobiliária: o id determinístico da entidade; prospect: a chave `entity:enterprise`
// da CAD) — nenhum id novo entra em circulação por aqui.

/** Os três papéis que a lista do portal devolve; a ficha só abre para eles. */
export type TipoDaFicha = "comprador" | "imobiliaria" | "prospect";

export function ehTipoDeFicha(valor: string): valor is TipoDaFicha {
  return valor === "comprador" || valor === "imobiliaria" || valor === "prospect";
}

/** Resumo financeiro de uma unidade na ficha do comprador. Números, nunca boleto/link. */
export type ResumoFinanceiroDaUnidade = {
  aReceber: number;
  pago: number;
  /**
   * Quantas parcelas estão em dia (pagas + a vencer). Só é preenchida quando as parcelas da
   * unidade foram lidas de verdade; sem leitura fica `null`, NUNCA 0 — zero seria afirmar que
   * está tudo vencido. Ver [[polling-sem-payload-apaga-tela]] (mesma regra: sem dado, não afirma).
   */
  parcelasEmDia: null | number;
  parcelasVencidas: number;
  total: number;
  vencido: number;
};

export type UnidadeDaFicha = {
  codigo: string;
  empreendimento: null | string;
  /** Rótulo do funil (Reservado, Proposta emitida… Faturado) — nunca a chave interna do C2X. */
  etapa: string;
  /** `null` enquanto a venda não faturou: reserva/proposta ainda não tem boleto. */
  financeiro: null | ResumoFinanceiroDaUnidade;
  lote: null | string;
  quadra: null | string;
  valor: number;
};

export type FichaComprador = {
  /** A aba Cadastro: os mesmos grupos do RegistrationPanel interno. Ver ficha-cadastro.ts. */
  cadastro: GrupoDoCadastro[];
  /** CPF/CNPJ SEM máscara (ordem do Lucas, 18/08/2026), ou null quando o Apolo não tem a entidade. */
  documento: null | string;
  id: string;
  imobiliaria: null | string;
  nome: string;
  papel: "comprador";
  relacionamentos: RelacionamentosDaFicha;
  /** Rótulo externo: Em dia, Em atraso, Sem parcelas. */
  situacao: string;
  totais: {
    aReceber: number;
    maiorAtrasoDias: number;
    pago: number;
    parcelasVencidas: number;
    total: number;
    vencido: number;
  };
  unidades: UnidadeDaFicha[];
};

export type FichaProspect = {
  /** A aba Cadastro: os mesmos grupos do RegistrationPanel interno. Ver ficha-cadastro.ts. */
  cadastro: GrupoDoCadastro[];
  corretor: null | string;
  desde: null | string;
  documento: null | string;
  empreendimento: null | string;
  id: string;
  imobiliaria: null | string;
  local: null | string;
  nome: string;
  papel: "prospect";
  relacionamentos: RelacionamentosDaFicha;
  /** Já vem de `rotuloDaEtapa`: vocabulário do cliente, sem veredito de crédito. */
  situacao: string;
};

export type FichaImobiliaria = {
  cads: number;
  compradores: number;
  credenciada: boolean;
  documento: null | string;
  id: string;
  nome: string;
  papel: "imobiliaria";
  /** Posição no ranking por VGV entre as imobiliárias do escopo desta sessão. */
  ranking: { posicao: number; total: number };
  situacao: string;
  totais: { unidades: number; vgv: number };
  /** As unidades com venda ativa desta imobiliária no escopo — o mesmo recorte da contagem. */
  unidadesVendidas: UnidadeDoCrm[];
};

export type FichaDoCrm = FichaComprador | FichaImobiliaria | FichaProspect;

export type ResultadoDaFicha =
  | { erro: string; ok: false; status: 404 | 503 }
  | { ficha: FichaDoCrm; ok: true };

// 404 e não 403, pela mesma razão de `foraDoEscopo`: para quem não tem o empreendimento, a
// pessoa não existe. A mensagem interna nunca chega ao cliente (a rota troca pelo 404 padrão).
const FICHA_NAO_ENCONTRADA = {
  erro: "Ficha nao encontrada.",
  ok: false,
  status: 404,
} as const;

const FICHA_INDISPONIVEL = {
  erro: "Não foi possível carregar a ficha agora.",
  ok: false,
  status: 503,
} as const;

/** A situação financeira do comprador no vocabulário da tela. */
export function rotuloDaSituacao(valor: SituacaoDoComprador): string {
  const rotulos: Record<SituacaoDoComprador, string> = {
    em_atraso: "Em atraso",
    em_dia: "Em dia",
    sem_parcelas: "Sem parcelas",
  };

  return rotulos[valor];
}

/**
 * Conta as parcelas da unidade para a ficha: vencida de um lado, o resto (paga + a vencer) do
 * outro. É só contagem de propósito — a lista de parcelas traz link de boleto Asaas
 * (`paymentUrl`/`invoiceUrl`), e NADA dela além do status atravessa para o payload da ficha.
 */
export function contarParcelas(parcelas: ApoloUnitInstallment[]): {
  emDia: number;
  vencidas: number;
} {
  let vencidas = 0;
  for (const parcela of parcelas) {
    if (parcela.status === "vencida") vencidas += 1;
  }

  return { emDia: parcelas.length - vencidas, vencidas };
}

/**
 * As unidades de UM comprador, com o financeiro por unidade — o drill da ficha.
 *
 * Mesma costura de `agregarCompradores` (venda diz o estágio, carteira diz o dinheiro, casadas
 * pelo id da unidade), mas linha a linha em vez de somada. O `unitId` interno sai FORA do objeto
 * da ficha, só para `montarFicha` buscar a contagem de parcelas — ele não entra no payload.
 */
export function unidadesDoComprador({
  carteira,
  entityId,
  nomePorCode,
  vendas,
}: {
  carteira: ApoloCarteiraUnit[];
  entityId: string;
  /** code do empreendimento -> nome de exibição. */
  nomePorCode: Map<string, string>;
  vendas: ApoloVendaUnit[];
}): Array<{ unidade: UnidadeDaFicha; unitId: null | string }> {
  const resultado: Array<{ unidade: UnidadeDaFicha; unitId: null | string }> = [];
  // id da unidade -> índice no resultado, para a carteira completar a linha que a venda abriu.
  const indicePorUnitId = new Map<string, number>();

  for (const unidade of vendas) {
    if (unidade.client?.entityId !== entityId) continue;

    indicePorUnitId.set(unidade.id, resultado.length);
    resultado.push({
      unidade: {
        codigo: unidade.code,
        empreendimento: nomePorCode.get(codeDaUnidade(unidade.code)) ?? null,
        etapa: APOLO_VENDA_STAGE_LABELS[unidade.stage],
        // Reserva/proposta ainda não tem boleto: financeiro nulo, nunca zerado.
        financeiro: null,
        lote: unidade.lot,
        quadra: unidade.block,
        valor: unidade.vgv,
      },
      unitId: null,
    });
  }

  for (const unidade of carteira) {
    if (unidade.client?.entityId !== entityId) continue;

    const financeiro: ResumoFinanceiroDaUnidade = {
      aReceber: unidade.toReceiveAmount,
      pago: unidade.paidAmount,
      // Sem a leitura das parcelas ainda: a carteira só sabe quantas VENCERAM.
      parcelasEmDia: null,
      parcelasVencidas: unidade.overdueInstallments,
      total: unidade.totalContract,
      vencido: unidade.overdueAmount,
    };

    const indice = indicePorUnitId.get(unidade.id);
    const linha = indice == null ? undefined : resultado[indice];

    if (linha) {
      linha.unitId = unidade.id;
      if (linha.unidade.financeiro) {
        // Dois contratos ativos na MESMA unidade (a carteira agrupa por contrato): soma, para o
        // total da linha bater com o total da pessoa em `agregarCompradores`.
        linha.unidade.financeiro.aReceber += financeiro.aReceber;
        linha.unidade.financeiro.pago += financeiro.pago;
        linha.unidade.financeiro.parcelasVencidas += financeiro.parcelasVencidas;
        linha.unidade.financeiro.total += financeiro.total;
        linha.unidade.financeiro.vencido += financeiro.vencido;
      } else {
        linha.unidade.financeiro = financeiro;
      }
      continue;
    }

    // Só na carteira (revenda: o contrato é dele, a proposta atual da unidade é de outro).
    resultado.push({
      unidade: {
        codigo: unidade.code,
        empreendimento:
          unidade.enterpriseName ?? nomePorCode.get(unidade.enterpriseCode) ?? null,
        etapa: APOLO_VENDA_STAGE_LABELS.faturado,
        financeiro,
        lote: unidade.lot,
        quadra: unidade.block,
        valor: unidade.totalContract,
      },
      unitId: unidade.id,
    });
  }

  return resultado;
}

/**
 * A posição da imobiliária na lista JÁ ORDENADA por VGV de `agregarImobiliarias`.
 *
 * Entre as zeradas o desempate é alfabético, então a posição lá no fim da fila é nominal — mas o
 * topo, que é o que o loteador olha, é VGV puro.
 */
export function rankingDaImobiliaria(
  lista: ImobiliariaDoCrm[],
  id: string,
): null | { posicao: number; total: number } {
  const indice = lista.findIndex((imobiliaria) => imobiliaria.id === id);
  if (indice < 0) return null;

  return { posicao: indice + 1, total: lista.length };
}

// ── FICHA: montagem (IO) ────────────────────────────────────────────────────

/**
 * Quantas unidades da ficha ganham a leitura de parcelas (uma query C2X cada). Um comprador
 * normal tem 1 a 3 unidades; o teto só protege o C2X de um investidor fora da curva — acima dele
 * a linha fica com `parcelasEmDia: null`, que a tela sabe mostrar como "sem contagem".
 */
const UNIDADES_COM_LEITURA_DE_PARCELAS = 15;

/** Nomes de exibição por code, para as unidades da ficha nomearem o empreendimento. */
async function nomesPorCode(): Promise<Map<string, string>> {
  const catalogo = await catalogoDeEmpreendimentos(Date.now());
  const nomePorCode = new Map<string, string>();

  for (const empreendimento of catalogo) {
    for (const code of empreendimento.codes) {
      nomePorCode.set(code.toUpperCase(), empreendimento.name);
    }
  }

  return nomePorCode;
}

/**
 * O documento da entidade, direto do Apolo. Qualquer falha vira `null`: ficha sem
 * documento é aceitável, ficha travada ou documento cru não. (A coluna `document_masked` vem CRUA
 * do banco; a normalização é a de `formatarDocumento` — SEM máscara, ordem do dono 18/08/2026.)
 */
async function documentoDaEntidade(entityId: string): Promise<null | string> {
  const admin = createApoloAdminClient();
  if (!admin) return null;

  try {
    const { data, error } = await admin
      .from("apolo_entities")
      .select("document_masked")
      .eq("id", entityId)
      .limit(1)
      .returns<Array<{ document_masked: null | string }>>();

    if (error) return null;
    return formatarDocumento(data?.[0]?.document_masked);
  } catch {
    return null;
  }
}

/**
 * Monta a ficha de um comprador, prospect ou imobiliária da lista do CRM do portal.
 *
 * ⚠️ A CONFERÊNCIA DE ESCOPO É REFEITA AQUI, A CADA CHAMADA. "O id veio da lista" NÃO é proteção:
 * o cliente pode trocar o id da URL por qualquer id válido de outro loteador. A prova de
 * pertencimento é achar a pessoa DENTRO da consulta já estreitada por `codigosDaSessao`/
 * `idsDaSessao` — quem não aparece nela recebe 404, o mesmo "não existe" de `foraDoEscopo`.
 */
export async function montarFicha({
  id,
  sessao,
  tipo,
}: {
  id: string;
  sessao: SessaoIncorporador;
  tipo: TipoDaFicha;
}): Promise<ResultadoDaFicha> {
  const alvo = String(id ?? "").trim();
  if (!alvo) return FICHA_NAO_ENCONTRADA;

  const [codes, enterpriseIds] = await Promise.all([
    codigosDaSessao(sessao),
    idsDaSessao(sessao),
  ]);

  // Sessão sem empreendimento nenhum: não há escopo em que a pessoa possa estar.
  if (codes.length === 0 && enterpriseIds.length === 0) return FICHA_NAO_ENCONTRADA;

  // Prospect mora na esteira (Supabase), que é chaveada por ID de empreendimento — não depende
  // do catálogo do C2X para traduzir em code.
  if (tipo === "prospect") return fichaDeProspect(alvo, enterpriseIds);

  // Sessão com empreendimento e SEM código = o catálogo do C2X não respondeu. Comprador e
  // imobiliária dependem do C2X: dizer "indisponível" em vez de um 404 que soaria como "essa
  // pessoa não existe" — afirmação errada na tela do cliente.
  if (codes.length === 0) return FICHA_INDISPONIVEL;

  if (tipo === "comprador") return fichaDeComprador(alvo, codes, enterpriseIds);
  return fichaDeImobiliaria(alvo, codes, enterpriseIds);
}

async function fichaDeComprador(
  alvo: string,
  codes: string[],
  enterpriseIds: string[],
): Promise<ResultadoDaFicha> {
  const [carteira, vendas, nomePorCode] = await Promise.all([
    loadApoloEnterpriseCarteira(codes),
    loadApoloEnterpriseVendas(codes),
    nomesPorCode(),
  ]);

  if (!carteira.ok || !vendas.ok) return FICHA_INDISPONIVEL;

  // Reusa a MESMA agregação da lista: a matemática dos totais da ficha e da linha da lista é uma
  // só, e é aqui que o pertencimento ao escopo é provado (as leituras acima só trazem os codes
  // desta sessão — quem não está nelas, não é deste loteador).
  const compradores = agregarCompradores({
    carteira: carteira.data.units,
    nomePorCode,
    vendas: vendas.data.units,
  });
  const comprador = compradores.find((pessoa) => pessoa.id === alvo);
  if (!comprador) return FICHA_NAO_ENCONTRADA;

  const pares = unidadesDoComprador({
    carteira: carteira.data.units,
    entityId: alvo,
    nomePorCode,
    vendas: vendas.data.units,
  });

  // Completa a contagem de parcelas por unidade. As unidades vieram da consulta escopada acima,
  // então já estão provadas no escopo — é a condição para ler as parcelas delas.
  const unidades = await Promise.all(
    pares.map(async ({ unidade, unitId }, indice) => {
      if (!unitId || !unidade.financeiro) return unidade;
      if (indice >= UNIDADES_COM_LEITURA_DE_PARCELAS) return unidade;

      const parcelas = await loadApoloUnitInstallments(unitId);
      // Falha na leitura: fica a contagem que a carteira já deu (vencidas) e `emDia: null`.
      if (!parcelas.ok) return unidade;

      const contagem = contarParcelas(parcelas.installments);
      return {
        ...unidade,
        financeiro: {
          ...unidade.financeiro,
          parcelasEmDia: contagem.emDia,
          parcelasVencidas: contagem.vencidas,
        },
      };
    }),
  );

  // Cadastro completo + corretor do contrato (ordem do Lucas, 18/08/2026). O pertencimento já
  // foi provado acima (a pessoa saiu da consulta escopada); estas leituras só completam a ficha,
  // e qualquer falha vira aba vazia — nunca ficha travada.
  const admin = createApoloAdminClient();
  const [documento, cadastroInfo, c2xUserId] = await Promise.all([
    documentoDaEntidade(alvo),
    lerCadastroDaPessoa({ enterpriseIds, entityId: alvo }),
    admin ? lerC2xUserId(admin, alvo) : Promise.resolve(null),
  ]);
  const corretor = await lerCorretorDoContrato(c2xUserId, codes);

  return {
    ficha: {
      cadastro: cadastroInfo.grupos,
      documento,
      id: comprador.id,
      imobiliaria: comprador.imobiliaria,
      nome: comprador.nome,
      papel: "comprador",
      relacionamentos: {
        conjuge: cadastroInfo.conjugeNome ? { nome: cadastroInfo.conjugeNome } : null,
        // "Outros contratos da mesma pessoa DENTRO do escopo": as unidades já provadas acima.
        contratos: unidades.map((unidade) => ({
          codigo: unidade.codigo,
          empreendimento: unidade.empreendimento,
          etapa: unidade.etapa,
        })),
        corretor,
        imobiliaria: comprador.imobiliaria,
      },
      situacao: rotuloDaSituacao(comprador.situacao),
      totais: {
        aReceber: comprador.aReceber,
        maiorAtrasoDias: comprador.maiorAtrasoDias,
        pago: comprador.pago,
        parcelasVencidas: comprador.parcelasEmAtraso,
        total: comprador.total,
        vencido: comprador.emAtraso,
      },
      unidades,
    },
    ok: true,
  };
}

async function fichaDeImobiliaria(
  alvo: string,
  codes: string[],
  enterpriseIds: string[],
): Promise<ResultadoDaFicha> {
  const admin = createApoloAdminClient();
  // Sem o Apolo não dá para montar CADs e credenciamento; ficha pela metade afirmaria "zero CAD".
  if (!admin) return FICHA_INDISPONIVEL;

  const [carteira, vendas, esteira, vinculadas, nomePorCode] = await Promise.all([
    loadApoloEnterpriseCarteira(codes),
    loadApoloEnterpriseVendas(codes),
    lerEsteiraDoEscopo(admin, enterpriseIds),
    lerImobiliariasVinculadas(admin, enterpriseIds),
    nomesPorCode(),
  ]);

  if (!carteira.ok || !vendas.ok || !esteira.ok || !vinculadas.ok) {
    return FICHA_INDISPONIVEL;
  }

  // Mesma agregação da aba de imobiliárias: prova o escopo e dá o ranking de graça.
  const lista = agregarImobiliarias({
    cadsPorEntidade: contarCadsPorImobiliaria(esteira.linhas),
    carteira: carteira.data.units,
    credenciadas: vinculadas.credenciadas,
    vendas: vendas.data.units,
  });

  const imobiliaria = lista.find((linha) => linha.id === alvo);
  const ranking = rankingDaImobiliaria(lista, alvo);
  if (!imobiliaria || !ranking) return FICHA_NAO_ENCONTRADA;

  // O mesmo recorte da contagem de `agregarImobiliarias`: venda ativa com esta imobiliária.
  const unidadesVendidas: UnidadeDoCrm[] = vendas.data.units
    .filter((unidade) => unidade.imobiliaria?.entityId === alvo)
    .map((unidade) => ({
      codigo: unidade.code,
      empreendimento: nomePorCode.get(codeDaUnidade(unidade.code)) ?? null,
      estagio: APOLO_VENDA_STAGE_LABELS[unidade.stage],
      lote: unidade.lot,
      quadra: unidade.block,
      vgv: unidade.vgv,
    }));

  // A lista só tem documento de quem veio do vínculo; quem só vendeu pelo C2X busca no Apolo.
  const documento = imobiliaria.documento ?? (await documentoDaEntidade(alvo));

  return {
    ficha: {
      cads: imobiliaria.cads,
      compradores: imobiliaria.compradores,
      credenciada: imobiliaria.credenciada,
      documento,
      id: imobiliaria.id,
      nome: imobiliaria.nome,
      papel: "imobiliaria",
      ranking,
      // Factual: com vínculo `verified` é credenciada; sem, não há credenciamento vigente.
      situacao: imobiliaria.credenciada ? "Credenciada" : "Sem credenciamento vigente",
      totais: { unidades: imobiliaria.unidades, vgv: imobiliaria.vgv },
      unidadesVendidas,
    },
    ok: true,
  };
}

async function fichaDeProspect(
  alvo: string,
  enterpriseIds: string[],
): Promise<ResultadoDaFicha> {
  if (enterpriseIds.length === 0) return FICHA_NAO_ENCONTRADA;

  const admin = createApoloAdminClient();
  if (!admin) return FICHA_INDISPONIVEL;

  // A esteira já sai filtrada pelos empreendimentos da sessão; o id pedido só pode casar com uma
  // linha que a sessão alcança.
  const esteira = await lerEsteiraDoEscopo(admin, enterpriseIds);
  if (!esteira.ok) return FICHA_INDISPONIVEL;

  // O id da lista é a chave (pessoa, empreendimento) — `entity_id:enterprise_id`. O match
  // reconstrói a MESMA chave sobre as linhas do escopo: id de fora simplesmente não casa.
  const linha = esteira.linhas.find(
    (candidata) => `${candidata.entity_id}:${candidata.enterprise_id ?? ""}` === alvo,
  );
  if (!linha) return FICHA_NAO_ENCONTRADA;

  const prospects = await montarProspects(admin, [linha]);
  if (!prospects.ok) return FICHA_INDISPONIVEL;

  const prospect = prospects.prospects[0];
  if (!prospect) return FICHA_NAO_ENCONTRADA;

  // Cadastro completo (ordem do Lucas, 18/08/2026). O prospect nasceu no Apolo: a fonte forte é
  // a esteira DESTE empreendimento (a chave da ficha é por CAD, não por pessoa).
  const cadastroInfo = await lerCadastroDaPessoa({
    enterpriseIds: linha.enterprise_id ? [String(linha.enterprise_id)] : enterpriseIds,
    entityId: linha.entity_id,
  });

  return {
    ficha: {
      cadastro: cadastroInfo.grupos,
      corretor: prospect.corretor,
      desde: prospect.desde,
      documento: prospect.documento,
      empreendimento: prospect.empreendimento,
      id: prospect.id,
      imobiliaria: prospect.imobiliaria,
      local: prospect.local,
      nome: prospect.nome,
      papel: "prospect",
      relacionamentos: {
        conjuge: cadastroInfo.conjugeNome ? { nome: cadastroInfo.conjugeNome } : null,
        // CAD ainda não é contrato: a lista fica vazia até a venda existir.
        contratos: [],
        corretor: prospect.corretor,
        imobiliaria: prospect.imobiliaria,
      },
      // `montarProspects` já rotulou com `rotuloDaEtapa`: vocabulário do cliente.
      situacao: prospect.etapa,
    },
    ok: true,
  };
}
