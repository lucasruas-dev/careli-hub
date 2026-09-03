import { idsDoEmpreendimento } from "@/lib/apolo/empreendimento-equivalencia";
import type { createApoloAdminClient } from "@/lib/apolo/server";
import type { ApoloVendaUnit } from "@/lib/apolo/vendas";

import { rotuloDaEtapa, type LinhaEsteira } from "./crm";

// AS IMOBILIÁRIAS DE UM PRODUTO, VISTAS PELO PROCESSO — a aba Imobiliárias da ficha do Hércules.
//
// Pedido do Lucas (02/09/2026): *"deixa imobiliárias separado para a gente visualizar as
// imobiliárias habilitadas, com os corretores com os clientes (cads credenciadas, enviadas,
// erradas, ou seja uma visão processual das cads)"*.
//
// A árvore é IMOBILIÁRIA → CORRETOR → CLIENTE (a CAD), e cada nível responde uma pergunta do
// coordenador: quem está habilitado a vender aqui, quem dentro dela está mandando cadastro, e em
// que pé está cada cadastro. O CRM do portal (crm.ts) já responde "quanto cada imobiliária vendeu";
// esta aba responde "o que ela está fazendo ANTES de vender".
//
// AS FONTES, e o que cada uma traz:
//   • `lerImobiliariasVinculadas` → quem tem vínculo `empreendimento` no Apolo (verified =
//     Habilitada; pending = Aguardando habilitação). É a LISTA BASE: imobiliária sem vínculo
//     vigente não é "imobiliária do produto", por mais CAD que tenha mandado;
//   • `lerEsteiraDoEscopo` → as CADs, uma por (pessoa, empreendimento), com o `imobiliaria_entity_id`
//     que casa com o id do vínculo e o texto do corretor;
//   • `loadApoloEnterpriseVendas(codes).units` → as unidades com venda ativa, por imobiliária.
//
// ⚠️ NÃO EXISTE ENTIDADE DE CORRETOR NA ESTEIRA. A coluna `corretor` de `apolo_esteira` é TEXTO
// livre, digitado no wizard da CAD; não há `corretor_entity_id`. Por isso o agrupamento por
// corretor é pelo texto normalizado (espaços colapsados, sem distinguir caixa), e "João Silva" e
// "JOAO SILVA" (sem acento) ainda saem como dois corretores. Registrado como pendência: quando a
// CAD gravar o id do corretor, este arquivo troca a chave e nada mais muda.
//
// ⚠️ A IMOBILIÁRIA É PELO `imobiliaria_entity_id`, NUNCA PELO TEXTO. A mesma imobiliária aparece
// escrita de três formas na esteira sobre o MESMO id (ver `contarCadsPorImobiliaria` em crm.ts).
//
// Função pura + dois leitores pequenos. A rota carrega, chama daqui e devolve.

export type SituacaoDaImobiliaria = "aguardando" | "habilitada";

/**
 * O estado da CAD no PROCESSO, em quatro baldes que o coordenador entende:
 *   credenciada  → a pessoa passou (etapa `credenciado`);
 *   com_erro     → voltou para a imobiliária corrigir (etapa `correcao`);
 *   nao_seguiu   → parou (etapa `indeferido`);
 *   em_andamento → todo o resto (validação, crédito, revisão, pré-venda…).
 */
export type SituacaoDaCad = "com_erro" | "credenciada" | "em_andamento" | "nao_seguiu";

export type ClienteDoCorretor = {
  chegouEm: null | string;
  entityId: string;
  /** A chave interna da etapa. A tela mostra `rotulo`; a chave só serve para cor/agrupamento. */
  etapa: string;
  nome: string;
  /** Vocabulário do cliente (`rotuloDaEtapa`): sem veredito de crédito. */
  rotulo: string;
  situacao: SituacaoDaCad;
};

export type CorretorDaImobiliaria = {
  clientes: ClienteDoCorretor[];
  nome: string;
};

export type ContagensDaImobiliaria = {
  comErro: number;
  credenciadas: number;
  emAndamento: number;
  /** Todas as CADs desta imobiliária neste produto (= credenciadas + emAndamento + comErro + naoSeguiu). */
  enviadas: number;
  naoSeguiu: number;
  /** Unidades com venda ATIVA por esta imobiliária (C2X). */
  vendas: number;
};

export type ImobiliariaDoProduto = {
  contagens: ContagensDaImobiliaria;
  corretores: CorretorDaImobiliaria[];
  /** CNPJ sem máscara (regra do Lucas, 18/08/2026 — igual ao Apolo interno). */
  documento: null | string;
  /** `entityId` do CRM — a mesma exceção declarada em `CompradorDoCrm.id` (crm.ts). */
  id: string;
  nome: string;
  situacao: SituacaoDaImobiliaria;
};

export type ImobiliariasDoProduto = {
  aguardando: number;
  /**
   * CADs que chegaram ao produto SEM imobiliária com vínculo vigente (sem `imobiliaria_entity_id`,
   * ou com um id que não está na lista de vínculos). Elas não somem: continuam na aba Cadastro.
   * Sai como número para a tela avisar, em vez de a soma das linhas "não bater" com o board.
   */
  cadsForaDaLista: number;
  habilitadas: number;
  imobiliarias: ImobiliariaDoProduto[];
};

/** O rótulo de quem mandou CAD sem informar corretor. */
export const SEM_CORRETOR = "Sem corretor";

/** Nome de quem não tem entidade no Apolo (mesmo texto de `nomeDaEntidade` em crm.ts). */
const SEM_NOME = "Sem nome";

// ── REGRAS PURAS ────────────────────────────────────────────────────────────

export function situacaoDaCad(etapa: null | string | undefined): SituacaoDaCad {
  const chave = String(etapa ?? "").trim().toLowerCase();

  if (chave === "credenciado") return "credenciada";
  if (chave === "correcao") return "com_erro";
  if (chave === "indeferido") return "nao_seguiu";
  return "em_andamento";
}

/** Espaços colapsados; vazio vira `SEM_CORRETOR`. É o NOME de exibição, não a chave. */
function nomeDoCorretor(valor: null | string | undefined): string {
  const limpo = String(valor ?? "").replace(/\s+/g, " ").trim();
  return limpo || SEM_CORRETOR;
}

/** A chave de agrupamento do corretor: o nome sem distinguir caixa. */
function chaveDoCorretor(nome: string): string {
  return nome.toLocaleLowerCase("pt-BR");
}

/**
 * Quantas unidades com venda ativa cada imobiliária tem — a coluna Vendas.
 *
 * Mesmo recorte de `agregarImobiliarias` (crm.ts): unidade com `imobiliaria` preenchida. O filtro
 * de `disponivel` é cinto e suspensório — unidade sem venda não deveria trazer imobiliária, mas se
 * o C2X um dia trouxer, ela não vira venda aqui.
 */
export function contarVendasPorImobiliaria(units: ApoloVendaUnit[]): Map<string, number> {
  const contagem = new Map<string, number>();

  for (const unidade of units) {
    if (!unidade.imobiliaria || unidade.stage === "disponivel") continue;
    const id = unidade.imobiliaria.entityId;
    contagem.set(id, (contagem.get(id) ?? 0) + 1);
  }

  return contagem;
}

export function montarImobiliariasDoProduto({
  credenciadas,
  esteira,
  nomes,
  vendasPorImobiliaria,
}: {
  /** As imobiliárias com vínculo de empreendimento no Apolo (`lerImobiliariasVinculadas`). */
  credenciadas: Array<{
    documento: null | string;
    id: string;
    nome: string;
    verificada: boolean;
  }>;
  /** As CADs do produto (`lerEsteiraDoEscopo`). */
  esteira: LinhaEsteira[];
  /** entityId da pessoa → nome de exibição. Quem não está no mapa sai como "Sem nome". */
  nomes: Map<string, string>;
  /** entityId da imobiliária → unidades com venda ativa (`contarVendasPorImobiliaria`). */
  vendasPorImobiliaria: Map<string, number>;
}): ImobiliariasDoProduto {
  // Uma linha por imobiliária DO VÍNCULO. A mesma imobiliária pode chegar mais de uma vez quando o
  // recorte tem mais de um empreendimento (grupo + divisões): basta um vínculo habilitado para a
  // situação ser "habilitada" — a mesma regra do `||` em `agregarImobiliarias`.
  const porImobiliaria = new Map<
    string,
    {
      corretores: Map<string, CorretorDaImobiliaria>;
      documento: null | string;
      id: string;
      nome: string;
      verificada: boolean;
    }
  >();

  for (const credenciada of credenciadas) {
    const atual = porImobiliaria.get(credenciada.id);
    if (atual) {
      atual.verificada = atual.verificada || credenciada.verificada;
      // `??` de propósito: só completa o que estava vazio.
      atual.documento = atual.documento ?? credenciada.documento;
      continue;
    }

    porImobiliaria.set(credenciada.id, {
      corretores: new Map(),
      documento: credenciada.documento,
      id: credenciada.id,
      nome: credenciada.nome,
      verificada: credenciada.verificada,
    });
  }

  let cadsForaDaLista = 0;

  for (const linha of esteira) {
    const imobiliaria = linha.imobiliaria_entity_id
      ? porImobiliaria.get(linha.imobiliaria_entity_id)
      : undefined;

    if (!imobiliaria) {
      cadsForaDaLista += 1;
      continue;
    }

    const nome = nomeDoCorretor(linha.corretor);
    const chave = chaveDoCorretor(nome);
    const corretor = imobiliaria.corretores.get(chave) ?? { clientes: [], nome };
    imobiliaria.corretores.set(chave, corretor);

    corretor.clientes.push({
      chegouEm: linha.chegou_em,
      entityId: linha.entity_id,
      etapa: String(linha.etapa ?? "").trim().toLowerCase(),
      nome: nomes.get(linha.entity_id) ?? SEM_NOME,
      rotulo: rotuloDaEtapa(linha.etapa),
      situacao: situacaoDaCad(linha.etapa),
    });
  }

  const imobiliarias: ImobiliariaDoProduto[] = [...porImobiliaria.values()].map((imobiliaria) => {
    const contagens: ContagensDaImobiliaria = {
      comErro: 0,
      credenciadas: 0,
      emAndamento: 0,
      enviadas: 0,
      naoSeguiu: 0,
      vendas: vendasPorImobiliaria.get(imobiliaria.id) ?? 0,
    };

    const corretores = [...imobiliaria.corretores.values()].map((corretor) => {
      for (const cliente of corretor.clientes) {
        contagens.enviadas += 1;
        if (cliente.situacao === "credenciada") contagens.credenciadas += 1;
        else if (cliente.situacao === "com_erro") contagens.comErro += 1;
        else if (cliente.situacao === "nao_seguiu") contagens.naoSeguiu += 1;
        else contagens.emAndamento += 1;
      }

      // O cadastro mais recente primeiro: é a visão de processo, e o que chegou ontem é o que o
      // coordenador ainda não viu. Empate (mesma data ou sem data) resolve pelo nome.
      const clientes = [...corretor.clientes].sort(
        (a, b) =>
          (b.chegouEm ?? "").localeCompare(a.chegouEm ?? "") ||
          a.nome.localeCompare(b.nome, "pt-BR"),
      );

      return { clientes, nome: corretor.nome };
    });

    // Quem mais manda cadastro em cima; "Sem corretor" sempre no fim, porque não é um corretor.
    corretores.sort((a, b) => {
      if (a.nome === SEM_CORRETOR) return 1;
      if (b.nome === SEM_CORRETOR) return -1;
      return b.clientes.length - a.clientes.length || a.nome.localeCompare(b.nome, "pt-BR");
    });

    return {
      contagens,
      corretores,
      documento: imobiliaria.documento,
      id: imobiliaria.id,
      nome: imobiliaria.nome,
      situacao: imobiliaria.verificada ? "habilitada" : "aguardando",
    };
  });

  // Habilitadas primeiro, depois quem mais mandou CAD, depois o nome.
  imobiliarias.sort((a, b) => {
    if (a.situacao !== b.situacao) return a.situacao === "habilitada" ? -1 : 1;
    return (
      b.contagens.enviadas - a.contagens.enviadas || a.nome.localeCompare(b.nome, "pt-BR")
    );
  });

  let habilitadas = 0;
  let aguardando = 0;
  for (const imobiliaria of imobiliarias) {
    if (imobiliaria.situacao === "habilitada") habilitadas += 1;
    else aguardando += 1;
  }

  return { aguardando, cadsForaDaLista, habilitadas, imobiliarias };
}

/**
 * Os ids que as tabelas do APOLO usam para este recorte (`apolo_esteira.enterprise_id`,
 * `apolo_relationships.metadata->>enterpriseId`), SEM ampliar o escopo.
 *
 * ⚠️ POR QUE NÃO `idsDaSessao(sessao, pedido)`. Aquela filtra o pedido contra `sessao.enterpriseIds`
 * CRU: uma sessão que carrega "group:Lagoa Bonita" não tem o "33" lá, e o filho que a expansão do
 * pai devolveu voltaria vazio (é a mesma armadilha descrita em `codigosDosIdsDoC2x`). Aqui o alvo
 * JÁ passou pelo escopo (ids do C2X saídos de `expandirIdDoPainel`, ou o id do catálogo que
 * `codesDoRecorte` aceitou) e só falta enumerar os formatos equivalentes que o Apolo guarda —
 * o id do grupo E o de cada divisão (ver [[empreendimento-equivalencia]]).
 *
 * Fail-closed: tudo o que sai está em `permitidos` (o escopo expandido de `idsDaSessao`). O id do
 * GRUPO só entra quando a sessão o alcança — quem tem só a gleba do Fernando não lê a CAD gravada
 * no grupo, porque ela pode ser do Raposo. Alvo com o grupo abre as divisões autorizadas; alvo com
 * divisões entra só com elas (e o grupo, se permitido: a CAD gravada como "group:…" é do conjunto,
 * e o dono do conjunto tem direito a vê-la em qualquer produto do conjunto).
 */
export function idsDoApoloDoRecorte(
  catalogo: Array<{ id: string; stageIds?: string[] }>,
  alvo: string[],
  permitidos: Set<string>,
): string[] {
  const pedidos = new Set(alvo.map((id) => String(id ?? "").trim()).filter(Boolean));
  if (pedidos.size === 0) return [];

  const ids = new Set<string>();

  for (const emp of catalogo) {
    const equivalentes = idsDoEmpreendimento(emp);
    if (!equivalentes.some((id) => pedidos.has(id))) continue;

    const pediuOGrupo = pedidos.has(String(emp.id).trim());

    for (const id of equivalentes) {
      if (!permitidos.has(id)) continue;
      if (pediuOGrupo || pedidos.has(id) || id === String(emp.id).trim()) ids.add(id);
    }
  }

  // Id pedido que o catálogo não conhece mais: se a sessão o autoriza, ele continua valendo — o
  // empreendimento sumiu do C2X, não da permissão (mesma regra de `idsDaSessao`).
  for (const id of pedidos) {
    if (permitidos.has(id)) ids.add(id);
  }

  return [...ids];
}

// ── LEITURAS (Supabase) ─────────────────────────────────────────────────────

type AdminClient = NonNullable<ReturnType<typeof createApoloAdminClient>>;

/** PostgREST estoura a URL com `in.(...)` grande. Ver [[postgrest-in-url-limite]]. */
const LOTE = 100;

type LinhaNome = {
  display_name: null | string;
  id: string;
  legal_name: null | string;
  trade_name: null | string;
};

/**
 * entityId → nome de exibição das pessoas das CADs. SÓ o nome: esta aba não mostra documento nem
 * cidade do cliente (quem precisa abre a CAD em Cadastro).
 *
 * Falha de leitura NÃO derruba a aba: quem ficou sem nome sai como "Sem nome", que é o mesmo que
 * já acontece com quem não tem entidade. Mapa vazio, nunca exceção.
 */
export async function lerNomesDasEntidades(
  admin: AdminClient,
  entityIds: string[],
): Promise<Map<string, string>> {
  const ids = [...new Set(entityIds)].filter(Boolean);
  const nomes = new Map<string, string>();

  for (let i = 0; i < ids.length; i += LOTE) {
    const { data, error } = await admin
      .from("apolo_entities")
      .select("id, display_name, trade_name, legal_name")
      .in("id", ids.slice(i, i + LOTE))
      .returns<LinhaNome[]>();

    if (error) return nomes;

    for (const linha of data ?? []) {
      const candidatos = [linha.display_name, linha.trade_name, linha.legal_name];
      const nome = candidatos.map((c) => String(c ?? "").trim()).find(Boolean);
      if (nome) nomes.set(linha.id, nome);
    }
  }

  return nomes;
}
