import { beforeEach, describe, expect, it, vi } from "vitest";

// MOVER A CAD DE EMPREENDIMENTO (24/09/2026), com o banco FALSO em memória.
//
// O caso que criou a ação: a CAD do JONATAS ficou no Veredas do Ouro (19) quando era do Vale do Ouro
// (35), porque trocar o vínculo não movia a CAD. O que este arquivo trava:
//   • o destino é SEMPRE o id de mercado (o pai): VOC, VOL, VOR e "group:Vale do Ouro" viram 35;
//   • o destino precisa RECEBER CAD (o mesmo portão do seletor), e "group:*" não se nomeia sozinho;
//   • a esteira, os vínculos de empreendimento e as marcas dos documentos pessoais mudam juntos
//     (imobiliária e corretor não; PDF de CAD e crédito ficam com a marca da origem);
//   • CAD que já existe no destino dá 409, sem escrever nada;
//   • a regra da etapa do Lucas (24/09/2026), ramo a ramo: antes do crédito não muda; destino sem
//     análise não muda (a pré-venda é reaplicada); com análise e consulta recente, avalia no limite DO
//     DESTINO (passou: avança; não passou: revisão); sem consulta recente, volta para a análise;
//   • o REBAIXAMENTO vai no MESMO UPDATE da troca (nunca sobra credenciado no destino sem análise);
//     SUBIR é pelo ponto autoritativo, depois, e a falha fica visível (`incompleto`);
//   • o coordenador e o corretor DO DESTINO são avisados sempre, inclusive quando a etapa não muda.
// E a terceira rodada da revisão (24/09/2026):
//   • imobiliária com CAD: NENHUM vínculo de empreendimento é criado no destino (para ela, o vínculo
//     `verified` é a habilitação no produto) nem arquivado na origem;
//   • `incompleto` é só para DADO (vínculo, documentos, etapa que devia subir); aviso ao coordenador e
//     PDF entram em `avisos` sem ligá-lo, e a frase do aviso não manda "reenviar" (não há reenvio);
//   • `avisos` sai sem repetição; a revisão se chama "Crédito em revisão", como no Board;
//   • portão de CAD ilegível (lista vazia) é 503, e não "não recebe CAD";
//   • CAD com cobrança de pré-venda (`pagamento_ref` ou `pago_em`) não se move: 409.

const m = vi.hoisted(() => ({
  analise: vi.fn(async () => true),
  atualizarEtapa: vi.fn(),
  avisar: vi.fn(),
  config: vi.fn(() => ({ config: { ambiente: "producao" }, ok: true }) as unknown),
  consulta: vi.fn(async () => null as unknown),
  fila: vi.fn(async () => ({ entrou: false, motivo: "sem evento ativo", naFila: false })),
  gerarCad: vi.fn(async () => ({ documentId: "pdf-novo", ok: true })),
  limite: vi.fn(async () => 1000 as null | number),
  nome: vi.fn(async (_c: unknown, id: string): Promise<string> => (id === "35" ? "VALE DO OURO" : "")),
  recebendo: vi.fn(async () => ["19", "20", "35", "38", "group:Lagoa Bonita"] as string[]),
}));

vi.mock("@/lib/apolo/credenciado-para-fila", () => ({ garantirNaFilaDoLancamento: m.fila }));
vi.mock("@/lib/apolo/enterprise-settings", () => ({ listEnterprisesRecebendo: m.recebendo }));
vi.mock("@/lib/apolo/esteira", () => ({ atualizarEtapa: m.atualizarEtapa }));
vi.mock("@/lib/apolo/esteira-avisos", () => ({ avisarEtapa: m.avisar }));
vi.mock("@/lib/apolo/limite-credito", () => ({
  resolverAnaliseHabilitada: m.analise,
  resolverLimiteCredito: m.limite,
}));
vi.mock("@/lib/apolo/salvar-cad", () => ({
  comLimiteDeTempo: <T>(promessa: Promise<T>) => promessa,
  gerarESalvarCad: m.gerarCad,
}));
vi.mock("@/lib/publico/cad/dados", () => ({ nomeDoEmpreendimento: m.nome }));
vi.mock("@/lib/serasa/config", () => ({ lerConfigSerasa: m.config }));
vi.mock("@/lib/serasa/consulta-servico", () => ({ consultaRecenteDoDocumento: m.consulta }));

import { avaliarCredito } from "@/lib/serasa/avaliacao";

import {
  MOTIVO_C2X_FORA_DO_AR,
  MOTIVO_GRUPO_SEM_DIVISOES,
  MOTIVO_SEM_COORDENADOR,
} from "./coordenador-do-empreendimento";
import { type EmpreendimentoDoCadastro, idDeMercado } from "./esteira-cad";
import {
  avisoDoCoordenadorQueNaoSaiu,
  moverCadDeEmpreendimento,
  planejarEtapaDoMover,
} from "./mover-cad";

// ─── o banco falso ───────────────────────────────────────────────────────────────────────────────

type Linha = Record<string, unknown>;
type Filtro = [coluna: string, op: string, valor: unknown];
type Chamada = { filtros: Filtro[]; op: string; tabela: string; valores?: Linha };

function bancoFalso(tabelas: Record<string, Linha[]>, falhas: Record<string, Linha> = {}) {
  const chamadas: Chamada[] = [];
  const client = {
    from(tabela: string) {
      const q = {
        de: 0,
        filtros: [] as Filtro[],
        limite: Number.POSITIVE_INFINITY,
        op: "select",
        retornar: false,
        valores: undefined as Linha | undefined,
      };
      const casa = (linha: Linha) =>
        q.filtros.every(([coluna, op, valor]) => {
          const v = linha[coluna];
          if (op === "eq") return String(v ?? "") === String(valor);
          if (op === "neq") return String(v ?? "") !== String(valor);
          if (op === "is") return v === null || v === undefined;
          if (op === "naoNulo") return v !== null && v !== undefined;
          return true;
        });
      const executar = () => {
        chamadas.push({ filtros: q.filtros, op: q.op, tabela, valores: q.valores });
        const falha = falhas[`${tabela}:${q.op}`];
        if (falha) return { data: null, error: falha };
        const linhas = (tabelas[tabela] ??= []);
        if (q.op === "insert") {
          linhas.push({ id: `novo-${linhas.length + 1}`, ...q.valores });
          return { data: null, error: null };
        }
        const alvo = linhas.filter(casa);
        if (q.op === "update") {
          for (const linha of alvo) Object.assign(linha, q.valores);
          return { data: q.retornar ? alvo.map((l) => ({ ...l })) : null, error: null };
        }
        return { data: alvo.slice(q.de, q.de + q.limite).map((l) => ({ ...l })), error: null };
      };
      const primeira = () => {
        const r = executar();
        return Promise.resolve({
          data: Array.isArray(r.data) ? (r.data[0] ?? null) : r.data,
          error: r.error,
        });
      };
      const cadeia: Record<string, unknown> = {};
      const filtro = (op: string) => (coluna: string, valor?: unknown) => {
        q.filtros.push([coluna, op, valor]);
        return cadeia;
      };
      Object.assign(cadeia, {
        eq: filtro("eq"),
        insert: (valores: Linha) => {
          q.op = "insert";
          q.valores = valores;
          return cadeia;
        },
        is: filtro("is"),
        limit: (n: number) => {
          q.limite = n;
          return cadeia;
        },
        maybeSingle: primeira,
        neq: filtro("neq"),
        not: (coluna: string) => filtro("naoNulo")(coluna),
        order: () => cadeia,
        range: (de: number, ate: number) => {
          q.de = de;
          q.limite = ate - de + 1;
          return cadeia;
        },
        returns: () => cadeia,
        select: () => {
          if (q.op !== "select") q.retornar = true;
          return cadeia;
        },
        single: primeira,
        then: (ok: (v: unknown) => unknown, erro?: (e: unknown) => unknown) =>
          Promise.resolve(executar()).then(ok, erro),
        update: (valores: Linha) => {
          q.op = "update";
          q.valores = valores;
          return cadeia;
        },
      });
      return cadeia;
    },
  };
  return {
    chamadas,
    client: client as unknown as Parameters<typeof moverCadDeEmpreendimento>[0]["client"],
    escritas: (tabela: string) =>
      chamadas.filter((c) => c.tabela === tabela && (c.op === "update" || c.op === "insert")),
    tabelas,
  };
}

// ─── os dados ────────────────────────────────────────────────────────────────────────────────────

const ENTIDADE = "c34d4b6c-ac71-43ca-b7c2-6a7ec7f69c29";
const AUTOR = "c9451037-f47e-4039-a531-4231dfb5cae9";
const CPF_VALIDO = "529.982.247-25";

/** O cadastro do Panteon (hercules_empreendimentos), como medido em 24/09/2026. */
const HERCULES: Linha[] = [
  { c2x_enterprise_id: "35", codigo: "VLO", id: "h-vlo", nome: "Vale do Ouro", pai_id: null },
  { c2x_enterprise_id: "37", codigo: "VOC", id: "h-voc", nome: "Vale do Ouro · VOC", pai_id: "h-vlo" },
  { c2x_enterprise_id: "36", codigo: "VOL", id: "h-vol", nome: "Vale do Ouro · VOL", pai_id: "h-vlo" },
  { c2x_enterprise_id: "41", codigo: "VOR", id: "h-vor", nome: "Vale do Ouro · VOR", pai_id: "h-vlo" },
  { c2x_enterprise_id: "19", codigo: "VDO", id: "h-vdo", nome: "Veredas do Ouro", pai_id: null },
  { c2x_enterprise_id: "31", codigo: "LAB", id: "h-lab", nome: "Lagoa Bonita", pai_id: null },
  { c2x_enterprise_id: "33", codigo: "LBF", id: "h-lbf", nome: "Lagoa Bonita · LBF", pai_id: "h-lab" },
  { c2x_enterprise_id: "27", codigo: "LBR", id: "h-lbr", nome: "Lagoa Bonita · LBR", pai_id: "h-lab" },
  { c2x_enterprise_id: "32", codigo: "LBP", id: "h-lbp", nome: "Lagoa Bonita · LBP", pai_id: "h-lab" },
  { c2x_enterprise_id: null, codigo: "LOX", id: "h-lox", nome: "Lavra do Ouro", pai_id: null },
  { c2x_enterprise_id: "4", codigo: "LOS", id: "h-los", nome: "Lavra do Ouro · LOS", pai_id: "h-lox" },
  { c2x_enterprise_id: "1", codigo: "LOU", id: "h-lou", nome: "Lavra do Ouro · LOU", pai_id: "h-lox" },
  { c2x_enterprise_id: "43", codigo: "RDV", id: "h-rdv", nome: "Recanto do Vale", pai_id: null },
].map((l) => ({ ...l, workspace_id: "careli" }));

const CADASTRO: EmpreendimentoDoCadastro[] = HERCULES.map((l) => ({
  c2xEnterpriseId: (l.c2x_enterprise_id as null | string) ?? null,
  codigo: l.codigo as string,
  id: l.id as string,
  nome: l.nome as string,
  paiId: (l.pai_id as null | string) ?? null,
}));

const vinculo = (id: string, enterpriseId: string, status = "verified"): Linha => ({
  entity_id: ENTIDADE,
  id,
  label: `EMP ${enterpriseId}`,
  metadata: { enterpriseId, source: "publico-cad" },
  related_entity_id: null,
  relationship_type: "empreendimento",
  status,
});

const documento = (id: string, tipo: string, metadata: Linha): Linha => ({
  document_type: tipo,
  entity_id: ENTIDADE,
  id,
  metadata,
});

/** O estado do Jonatas ANTES da troca: CAD no 19, vínculo no 19, imobiliária, corretor e documentos. */
function tabelasDoCaso(
  extra: { etapa?: string; esteira?: Linha[]; imobiliaria?: boolean; vinculos?: Linha[] } = {},
) {
  return {
    apolo_documents: [
      // O PDF de ENVIO (agora imprime "Empreendimento Veredas do Ouro") e o automático da origem.
      documento("pdf-envio", "cad", { enterpriseId: "19" }),
      documento("pdf-auto", "cad", { enterpriseId: "19", origem: "automatico" }),
      // Os documentos pessoais que o portal da origem subiu, com a marca dele.
      documento("rg", "identificacao", { enterpriseId: "19", uploadedByName: "Portal" }),
      documento("endereco", "comprovante_endereco", { enterpriseId: "19" }),
      // A análise de crédito da origem.
      documento("serasa", "comprovante-credito", { enterpriseId: "19" }),
      documento("restricao", "aprovacao-credito-restricao", { enterpriseId: "19" }),
      // Documento pessoal sem marca (o hub sobe assim): não é tocado.
      documento("cnh", "identity", {}),
      // Documento de OUTRO produto: não é tocado.
      documento("outro-produto", "identificacao", { enterpriseId: "38" }),
    ],
    apolo_entities: [
      { document_masked: CPF_VALIDO, entity_kind: "pf", id: ENTIDADE },
    ],
    apolo_entity_profiles: extra.imobiliaria
      ? [{ entity_id: ENTIDADE, profile: "imobiliaria", status: "active" }]
      : [{ entity_id: ENTIDADE, profile: "prospect", status: "active" }],
    apolo_esteira: extra.esteira ?? [
      {
        atualizado_em: "2026-09-24T15:50:53.703Z",
        created_at: "2026-09-21T18:14:52.000Z",
        empreendimento: "VEREDAS DO OURO",
        entity_id: ENTIDADE,
        enterprise_id: "19",
        etapa: extra.etapa ?? "validacao",
        motivo: "Análise de crédito desligada no empreendimento — avançou sem consulta.",
      },
    ],
    apolo_relationships: extra.vinculos ?? [
      vinculo("v-19", "19"),
      {
        entity_id: ENTIDADE,
        id: "v-imob",
        label: "BELTRAO DINIZ",
        metadata: {},
        related_entity_id: "imob-1",
        relationship_type: "imobiliaria",
        status: "verified",
      },
      {
        entity_id: ENTIDADE,
        id: "v-corretor",
        label: "RONILSON",
        metadata: {},
        related_entity_id: "corretor-1",
        relationship_type: "corretor",
        status: "verified",
      },
    ],
    apolo_timeline_events: [],
    hercules_empreendimentos: HERCULES.map((l) => ({ ...l })),
  } satisfies Record<string, Linha[]>;
}

/** Resposta do Serasa no formato que `avaliarCredito` soma (negativeData.*.summary.balance). */
const relatorio = (restricoes: number) => ({
  reports: [{ negativeData: { pefin: { summary: { balance: restricoes } } } }],
});

const consultaRecente = (restricoes: number) => ({
  ambiente: "producao",
  created_at: "2026-09-20T13:00:00.000Z",
  id: "consulta-1",
  report_name: "RELATORIO",
  resposta: relatorio(restricoes),
  resumo: {},
});

/** O aviso da etapa que saiu para os dois (o formato de `avisarEtapa`). */
const avisoOk = (etapa: string) => ({
  coordenador: { destinatario: "HUBER", ok: true, telefone: "5531999999999" },
  corretor: { destinatario: "RONILSON", ok: true, papel: "corretor", telefone: "5531988888888" },
  etapa,
});

const mover = (banco: ReturnType<typeof bancoFalso>, corpo: Linha = { de: "19", para: "37" }) =>
  moverCadDeEmpreendimento({
    autor: { userId: AUTOR },
    client: banco.client,
    corpo,
    entityId: ENTIDADE,
    uploadedByName: "Board",
  });

const dados = (r: { corpo: unknown }) => (r.corpo as { data: Record<string, unknown> }).data;
const erro = (r: { corpo: unknown }) => (r.corpo as { error: string }).error;
const avisosDe = (r: { corpo: unknown }) => (dados(r).avisos as string[]).join(" | ");
const metaDoDoc = (banco: ReturnType<typeof bancoFalso>, id: string) =>
  banco.tabelas.apolo_documents?.find((d) => d.id === id)?.metadata as Linha;

const TABELAS_ESCRITAS = [
  "apolo_documents",
  "apolo_esteira",
  "apolo_relationships",
  "apolo_timeline_events",
] as const;

beforeEach(() => {
  for (const mock of Object.values(m)) mock.mockClear();
  m.analise.mockImplementation(async () => true);
  m.config.mockImplementation(() => ({ config: { ambiente: "producao" }, ok: true }));
  m.consulta.mockImplementation(async () => null);
  m.fila.mockImplementation(async () => ({ entrou: false, motivo: "sem evento ativo", naFila: false }));
  m.gerarCad.mockImplementation(async () => ({ documentId: "pdf-novo", ok: true }));
  m.limite.mockImplementation(async () => 1000);
  m.nome.mockImplementation(async (_c: unknown, id: string) => (id === "35" ? "VALE DO OURO" : ""));
  m.recebendo.mockImplementation(async () => ["19", "20", "35", "38", "group:Lagoa Bonita"]);
  m.atualizarEtapa.mockImplementation(async (_c: unknown, _id: string, etapa: string) => ({
    aviso: avisoOk(etapa),
    error: null,
    etapa,
  }));
  m.avisar.mockImplementation(async (_c: unknown, input: { etapa: string }) => avisoOk(input.etapa));
});

// ─── o id de mercado ─────────────────────────────────────────────────────────────────────────────

describe("idDeMercado: o destino é o PAI", () => {
  it("VOC, VOL, VOR, o grupo legado e o próprio VLO viram 35", () => {
    for (const id of ["37", "36", "41", "group:Vale do Ouro", "35", " 37 "]) {
      expect(idDeMercado(id, CADASTRO)).toBe("35");
    }
  });

  it("Lagoa Bonita fica no grupo: o pai (LAB, 31) está fora do catálogo e não é espelho", () => {
    for (const id of ["33", "27", "32", "31", "group:Lagoa Bonita"]) {
      expect(idDeMercado(id, CADASTRO)).toBe("group:Lagoa Bonita");
    }
  });

  it("Lavra do Ouro (pai sem id do C2X) fica no grupo; empreendimento sem família fica como veio", () => {
    expect(idDeMercado("4", CADASTRO)).toBe("group:Lavra do Ouro");
    expect(idDeMercado("19", CADASTRO)).toBe("19");
    expect(idDeMercado("999", CADASTRO)).toBe("999");
    expect(idDeMercado("", CADASTRO)).toBeNull();
  });
});

// ─── a regra da etapa, sem I/O ───────────────────────────────────────────────────────────────────

describe("planejarEtapaDoMover: a regra do Lucas (24/09/2026)", () => {
  const base = { motivoAnterior: null, nomeAnterior: "VEREDAS DO OURO", nomeNovo: "VALE DO OURO" };
  const aprovada = {
    quando: "2026-09-20T13:00:00.000Z",
    veredito: { aprovado: true, limite: 1000, motivo: "Restrições de R$ 500,00 dentro do limite de R$ 1.000,00.", total: 500 },
  };
  const reprovada = {
    quando: "2026-09-20T13:00:00.000Z",
    veredito: { aprovado: false, limite: 1000, motivo: "Restrições de R$ 5.000,00 acima do limite de R$ 1.000,00.", total: 5000 },
  };

  it("antes do crédito (validação, correção, indeferido): a etapa não muda e nada é avaliado", () => {
    for (const etapaAtual of ["validacao", "correcao", "indeferido", null]) {
      const plano = planejarEtapaDoMover({ ...base, analiseNoDestino: true, consulta: aprovada, etapaAtual });
      expect(plano).toMatchObject({ etapaAlvo: null, gravacao: null });
      expect(plano.credito).toMatchObject({ avaliado: false, passou: null });
    }
  });

  it("destino sem análise de crédito: a etapa não muda, e o motivo diz por quê", () => {
    for (const etapaAtual of ["credito", "revisao", "credenciado"]) {
      const plano = planejarEtapaDoMover({ ...base, analiseNoDestino: false, consulta: aprovada, etapaAtual });
      expect(plano).toMatchObject({ etapaAlvo: null, gravacao: null });
      expect(plano.credito.avaliado).toBe(false);
      expect(plano.credito.motivo).toContain("não faz análise de crédito");
    }
  });

  it("D6: a PRÉ-VENDA é reaplicada no destino (com ou sem análise), pelo ponto autoritativo", () => {
    // Sem isto a CAD ficava em pré-venda esperando um PIX que o destino não cobra.
    const semAnalise = planejarEtapaDoMover({ ...base, analiseNoDestino: false, consulta: null, etapaAtual: "prevenda" });
    expect(semAnalise).toMatchObject({ etapaAlvo: "prevenda", gravacao: "depois" });
    expect(semAnalise.credito.motivo).toContain("A pré-venda segue a regra do novo empreendimento.");
    const comAprovada = planejarEtapaDoMover({ ...base, analiseNoDestino: true, consulta: aprovada, etapaAtual: "prevenda" });
    expect(comAprovada).toMatchObject({ credito: { passou: true }, etapaAlvo: "prevenda", gravacao: "depois" });
  });

  it("com análise e consulta recente APROVADA: crédito/revisão SOBEM depois; o credenciado fica", () => {
    expect(planejarEtapaDoMover({ ...base, analiseNoDestino: true, consulta: aprovada, etapaAtual: "credito" })).toMatchObject({
      credito: { avaliado: true, passou: true },
      etapaAlvo: "prevenda",
      gravacao: "depois",
      saidaDeRevisaoAutorizada: false,
    });
    // Revisão -> pré-venda precisa da autorização explícita (o guard de `atualizarEtapa`).
    expect(planejarEtapaDoMover({ ...base, analiseNoDestino: true, consulta: aprovada, etapaAtual: "revisao" })).toMatchObject({
      etapaAlvo: "prevenda",
      gravacao: "depois",
      saidaDeRevisaoAutorizada: true,
    });
    // Decisão a confirmar com o Lucas: o credenciado NÃO volta para a pré-venda.
    const credenciado = planejarEtapaDoMover({ ...base, analiseNoDestino: true, consulta: aprovada, etapaAtual: "credenciado" });
    expect(credenciado).toMatchObject({ etapaAlvo: null, gravacao: null });
    expect(credenciado.credito).toMatchObject({ avaliado: true, passou: true });
  });

  it("com análise e consulta recente REPROVADA: revisão NA TROCA, com o motivo do fluxo normal", () => {
    const plano = planejarEtapaDoMover({ ...base, analiseNoDestino: true, consulta: reprovada, etapaAtual: "credenciado" });
    expect(plano).toMatchObject({ etapaAlvo: "revisao", gravacao: "na-troca" });
    expect(plano.motivoDaEsteira).toBe(`Crédito reprovado. ${reprovada.veredito.motivo}`);
    expect(plano.credito).toMatchObject({ avaliado: true, passou: false });
    expect(plano.credito.motivo).toContain("acima do limite de R$ 1.000,00");
    // Já em revisão: a etapa não muda, mas o motivo é o do novo limite.
    const emRevisao = planejarEtapaDoMover({ ...base, analiseNoDestino: true, consulta: reprovada, etapaAtual: "revisao" });
    expect(emRevisao).toMatchObject({ etapaAlvo: null, gravacao: null });
    expect(emRevisao.motivoDaEsteira).toBe(`Crédito reprovado. ${reprovada.veredito.motivo}`);
  });

  it("com análise e SEM consulta recente: volta para a análise NA TROCA (credenciado é rebaixado de propósito)", () => {
    for (const etapaAtual of ["revisao", "prevenda", "credenciado"]) {
      const plano = planejarEtapaDoMover({ ...base, analiseNoDestino: true, consulta: null, etapaAtual });
      expect(plano).toMatchObject({ etapaAlvo: "credito", gravacao: "na-troca" });
      expect(plano.credito).toMatchObject({ avaliado: false, passou: null });
    }
    expect(
      planejarEtapaDoMover({ ...base, analiseNoDestino: true, consulta: null, etapaAtual: "credito" }),
    ).toMatchObject({ etapaAlvo: null, gravacao: null });
  });

  it("nenhum texto que a tela mostra leva travessão (nem o motivo antigo que vai junto)", () => {
    const planos = [
      planejarEtapaDoMover({ ...base, analiseNoDestino: true, consulta: null, etapaAtual: "validacao", motivoAnterior: "Algo — outra coisa" }),
      planejarEtapaDoMover({ ...base, analiseNoDestino: false, consulta: null, etapaAtual: "credenciado", motivoAnterior: "x — y" }),
      planejarEtapaDoMover({ ...base, analiseNoDestino: false, consulta: null, etapaAtual: "prevenda", motivoAnterior: "x – y" }),
      planejarEtapaDoMover({ ...base, analiseNoDestino: true, consulta: aprovada, etapaAtual: "credito" }),
      planejarEtapaDoMover({ ...base, analiseNoDestino: true, consulta: reprovada, etapaAtual: "credito" }),
      planejarEtapaDoMover({ ...base, analiseNoDestino: true, consulta: null, etapaAtual: "credenciado" }),
    ];
    for (const plano of planos) {
      expect(plano.motivoDaEsteira).not.toMatch(/[—–]/);
      expect(plano.credito.motivo).not.toMatch(/[—–]/);
    }
  });
});

// ─── a ação inteira ──────────────────────────────────────────────────────────────────────────────

describe("moverCadDeEmpreendimento", () => {
  it("VOC (37) vira 35: esteira, vínculos, documentos, aviso, linha do tempo e PDF no destino", async () => {
    const banco = bancoFalso(tabelasDoCaso({ etapa: "validacao" }));
    const r = await mover(banco);

    expect(r.status).toBe(200);
    expect(dados(r)).toMatchObject({
      avisos: [],
      credito: { avaliado: false, passou: null },
      de: "19",
      empreendimentoNovo: "VALE DO OURO",
      etapaAnterior: "validacao",
      etapaNova: "validacao",
      incompleto: false,
      para: "35",
    });

    // A esteira: mesma linha, agora no 35, com o nome no padrão das CADs do destino.
    expect(banco.tabelas.apolo_esteira).toHaveLength(1);
    expect(banco.tabelas.apolo_esteira?.[0]).toMatchObject({
      atualizado_por: AUTOR,
      empreendimento: "VALE DO OURO",
      enterprise_id: "35",
      etapa: "validacao",
    });
    expect(String(banco.tabelas.apolo_esteira?.[0]?.motivo)).toContain(
      "CAD movida de VEREDAS DO OURO para VALE DO OURO.",
    );

    // Vínculos: o 35 nasce no formato do relationships/create; o 19 é arquivado; imobiliária e
    // corretor não mudam.
    const rel = banco.tabelas.apolo_relationships ?? [];
    const novo = rel.find((v) => (v.metadata as Linha)?.enterpriseId === "35");
    expect(novo).toMatchObject({
      entity_id: ENTIDADE,
      label: "VALE DO OURO",
      related_entity_id: null,
      relationship_type: "empreendimento",
      status: "verified",
    });
    expect(novo?.metadata).toMatchObject({ enterpriseId: "35", enterpriseLabel: "VALE DO OURO", source: "apolo" });
    expect(rel.find((v) => v.id === "v-19")).toMatchObject({ status: "archived" });
    expect((rel.find((v) => v.id === "v-19")?.metadata as Linha).arquivadoPor).toBe(AUTOR);
    expect(rel.find((v) => v.id === "v-imob")?.status).toBe("verified");
    expect(rel.find((v) => v.id === "v-corretor")?.status).toBe("verified");

    // Linha do tempo e PDF regenerado NO DESTINO.
    expect(banco.tabelas.apolo_timeline_events?.[0]).toMatchObject({
      entity_id: ENTIDADE,
      event_type: "cad_movida",
      metadata: {
        avisos: [],
        de: "19",
        documentosRemarcados: 2,
        etapaAnterior: "validacao",
        etapaNova: "validacao",
        incompleto: false,
        para: "35",
        por: AUTOR,
      },
    });
    expect(m.gerarCad).toHaveBeenCalledWith(banco.client, ENTIDADE, {
      enterpriseId: "35",
      uploadedByName: "Board",
    });

    // Etapa anterior ao crédito: nem a régua do crédito é lida, nem a etapa é gravada.
    expect(m.analise).not.toHaveBeenCalled();
    expect(m.atualizarEtapa).not.toHaveBeenCalled();
    // A fila do lançamento é a do DESTINO.
    expect(m.fila).toHaveBeenCalledWith(banco.client, ENTIDADE, { enterpriseId: "35" });
  });

  describe("D3: quais documentos acompanham a CAD", () => {
    it("os documentos PESSOAIS com a marca da origem passam ao destino; CAD e crédito ficam", async () => {
      const banco = bancoFalso(tabelasDoCaso());
      await mover(banco);

      // Sem isto o portal do destino não via o RG que o portal da origem subiu (documentos-do-portal,
      // passo 3: marcado só sai no recorte da marca).
      expect(metaDoDoc(banco, "rg")).toMatchObject({
        enterpriseId: "35",
        enterpriseIdAnterior: "19",
        remarcadoPelo: "mover-cad",
        uploadedByName: "Portal",
      });
      expect(metaDoDoc(banco, "endereco")).toMatchObject({ enterpriseId: "35", enterpriseIdAnterior: "19" });

      // O PDF de ENVIO é o registro histórico (imprime "Veredas do Ouro"): fica na origem. O
      // automático da origem também; o do destino é o regenerado.
      expect(metaDoDoc(banco, "pdf-envio")).toEqual({ enterpriseId: "19" });
      expect(metaDoDoc(banco, "pdf-auto")).toEqual({ enterpriseId: "19", origem: "automatico" });
      // A análise de crédito é da origem: não vai ao portal do destino.
      expect(metaDoDoc(banco, "serasa")).toEqual({ enterpriseId: "19" });
      expect(metaDoDoc(banco, "restricao")).toEqual({ enterpriseId: "19" });
      // Sem marca e de outro produto: intocados.
      expect(metaDoDoc(banco, "cnh")).toEqual({});
      expect(metaDoDoc(banco, "outro-produto")).toEqual({ enterpriseId: "38" });
    });

    it("a marca é comparada pela régua de mercado (o portal marca a divisão, a CAD mora no pai)", async () => {
      const banco = bancoFalso(
        tabelasDoCaso({
          esteira: [{ empreendimento: "VALE DO OURO", entity_id: ENTIDADE, enterprise_id: "35", etapa: "validacao" }],
          vinculos: [vinculo("v-35", "35")],
        }),
      );
      banco.tabelas.apolo_documents = [documento("rg-37", "identificacao", { enterpriseId: "37" })];
      m.nome.mockImplementation(async (_c: unknown, id: string) => (id === "19" ? "VEREDAS DO OURO" : ""));
      const r = await mover(banco, { de: "35", para: "19" });
      expect(r.status).toBe(200);
      expect(metaDoDoc(banco, "rg-37")).toMatchObject({ enterpriseId: "19", enterpriseIdAnterior: "37" });
    });

    it("falha ao remarcar: aviso e `incompleto`, sem desfazer a troca", async () => {
      const banco = bancoFalso(tabelasDoCaso(), { "apolo_documents:update": { message: "falhou" } });
      const r = await mover(banco);
      expect(r.status).toBe(200);
      expect(dados(r).incompleto).toBe(true);
      expect(avisosDe(r)).toContain("o portal do novo empreendimento não os vê");
      expect(banco.tabelas.apolo_esteira?.[0]?.enterprise_id).toBe("35");
    });
  });

  describe("D4: o destino precisa receber CAD", () => {
    it("RDV (43, portão de CAD fechado) e o 9001 de teste: 400, nada escrito", async () => {
      for (const para of ["43", "9001"]) {
        const banco = bancoFalso(tabelasDoCaso({ etapa: "credenciado" }));
        m.nome.mockImplementation(async () => "QUALQUER NOME");
        const r = await mover(banco, { de: "19", para });
        expect(r.status).toBe(400);
        expect(erro(r)).toBe("Este empreendimento não recebe CAD.");
        for (const tabela of TABELAS_ESCRITAS) expect(banco.escritas(tabela)).toHaveLength(0);
        expect(m.atualizarEtapa).not.toHaveBeenCalled();
        expect(m.avisar).not.toHaveBeenCalled();
      }
    });

    it("um 'group:*' inventado não passa (nem se nomeia sozinho)", async () => {
      const banco = bancoFalso(tabelasDoCaso());
      const r = await mover(banco, { de: "19", para: "group:Teste" });
      expect(r.status).toBe(400);
      expect(erro(r)).toBe("Este empreendimento não recebe CAD.");
      expect(banco.escritas("apolo_esteira")).toHaveLength(0);
    });

    // (24/09/2026, terceira rodada) `listEnterprisesRecebendo` NUNCA lança: em erro de leitura devolve
    // []. Hoje há 8 ids com o portão aberto, então vazio só acontece por falha. Antes, esse vazio virava
    // 400 "Este empreendimento não recebe CAD." para o Vale do Ouro, que recebe: fato falso na tela.
    const PORTAO_ILEGIVEL =
      "Não foi possível conferir os empreendimentos que recebem CAD agora. Nada foi alterado.";

    it("a lista vazia (leitura que falhou fechada): 503 'tente de novo', nunca 'não recebe CAD'", async () => {
      m.recebendo.mockImplementation(async () => []);
      const banco = bancoFalso(tabelasDoCaso());
      const r = await mover(banco, { de: "19", para: "35" });
      expect(r.status).toBe(503);
      expect(erro(r)).toBe(PORTAO_ILEGIVEL);
      expect(erro(r)).not.toContain("não recebe CAD");
      for (const tabela of TABELAS_ESCRITAS) expect(banco.escritas(tabela)).toHaveLength(0);
      expect(m.avisar).not.toHaveBeenCalled();
    });

    it("a leitura do portão que lança também é 503, com a mesma frase", async () => {
      m.recebendo.mockImplementation(async () => {
        throw new Error("timeout");
      });
      const banco = bancoFalso(tabelasDoCaso());
      const r = await mover(banco, { de: "19", para: "35" });
      expect(r.status).toBe(503);
      expect(erro(r)).toBe(PORTAO_ILEGIVEL);
      expect(banco.escritas("apolo_esteira")).toHaveLength(0);
    });

    it("a régua é a de mercado: a divisão com o portão aberto vale pelo pai", async () => {
      m.recebendo.mockImplementation(async () => ["36"]);
      const banco = bancoFalso(tabelasDoCaso());
      const r = await mover(banco, { de: "19", para: "37" });
      expect(r.status).toBe(200);
      expect(dados(r).para).toBe("35");
    });

    it("group:Lagoa Bonita (com portão) SEM nome no catálogo nem CAD lá: 400, sem nomear pelo id", async () => {
      const banco = bancoFalso(tabelasDoCaso());
      const r = await mover(banco, { de: "19", para: "33" });
      expect(r.status).toBe(400);
      expect(erro(r)).toBe("O novo empreendimento não foi encontrado no cadastro.");
      expect(banco.escritas("apolo_esteira")).toHaveLength(0);
    });

    it("group:Lagoa Bonita com CADs lá: o nome sai do texto que elas já usam", async () => {
      const banco = bancoFalso(tabelasDoCaso());
      banco.tabelas.apolo_esteira?.push({
        empreendimento: "LAGOA BONITA",
        entity_id: "outra-pessoa",
        enterprise_id: "group:Lagoa Bonita",
        etapa: "credito",
      });
      const r = await mover(banco, { de: "19", para: "33" });
      expect(r.status).toBe(200);
      expect(dados(r)).toMatchObject({ empreendimentoNovo: "LAGOA BONITA", para: "group:Lagoa Bonita" });
    });
  });

  it("o vínculo do destino já existe (a troca feita à mão): não duplica", async () => {
    const banco = bancoFalso(
      tabelasDoCaso({ vinculos: [vinculo("v-19", "19", "archived"), vinculo("v-35", "35")] }),
    );
    const r = await mover(banco, { de: "19", para: "35" });
    expect(r.status).toBe(200);
    expect(banco.escritas("apolo_relationships").filter((c) => c.op === "insert")).toHaveLength(0);
  });

  describe("imobiliária que também tem CAD: os vínculos de empreendimento dela não são tocados", () => {
    // Para a entidade com perfil imobiliária, o vínculo `empreendimento` `verified` É a habilitação no
    // produto: `empreendimentosCredenciados` (link público de CAD) e `lerImobiliariasVinculadas`
    // (portal do incorporador) contam `status === "verified"`. Caso medido em 24/09/2026: b343b378,
    // perfis imobiliaria e prospect, CAD no 20 em validação, um único vínculo (o 20 verified).

    it("D7: o vínculo da origem FICA (é o credenciamento dela)", async () => {
      const banco = bancoFalso(tabelasDoCaso({ imobiliaria: true }));
      const r = await mover(banco);
      expect(r.status).toBe(200);
      expect(dados(r).incompleto).toBe(false);
      expect(banco.tabelas.apolo_relationships?.find((v) => v.id === "v-19")?.status).toBe("verified");
      expect(banco.tabelas.apolo_timeline_events?.[0]?.metadata).toMatchObject({
        vinculosIntocadosPorSerImobiliaria: true,
      });
    });

    it("NENHUM vínculo nasce no destino: mover a CAD não a habilita no Vale do Ouro sem a validação", async () => {
      const banco = bancoFalso(tabelasDoCaso({ imobiliaria: true }));
      const r = await mover(banco);
      expect(r.status).toBe(200);
      // A CAD foi movida (a esteira é o que importa para a CAD de cliente)...
      expect(banco.tabelas.apolo_esteira?.[0]).toMatchObject({ enterprise_id: "35" });
      // ...e nenhum vínculo de empreendimento foi escrito, nem criado nem arquivado.
      expect(banco.escritas("apolo_relationships")).toHaveLength(0);
      const rel = banco.tabelas.apolo_relationships ?? [];
      expect(
        rel.filter(
          (v) =>
            v.relationship_type === "empreendimento" &&
            idDeMercado((v.metadata as Linha)?.enterpriseId, CADASTRO) === "35",
        ),
      ).toEqual([]);
      expect(dados(r)).toMatchObject({ avisos: [], incompleto: false });
    });

    it("a leitura do perfil falha: nenhum vínculo é escrito, e a resposta diz para conferir", async () => {
      const banco = bancoFalso(tabelasDoCaso({ imobiliaria: true }), {
        "apolo_entity_profiles:select": { message: "timeout" },
      });
      const r = await mover(banco);
      expect(r.status).toBe(200);
      expect(banco.escritas("apolo_relationships")).toHaveLength(0);
      expect(dados(r).incompleto).toBe(true);
      expect(avisosDe(r)).toContain("Os vínculos de empreendimento não puderam ser conferidos.");
    });
  });

  it("CAD da pessoa já no destino (mesmo em id equivalente): 409, sem escrever nada", async () => {
    for (const noDestino of ["35", "group:Vale do Ouro"]) {
      const banco = bancoFalso(
        tabelasDoCaso({
          esteira: [
            { empreendimento: "VEREDAS DO OURO", entity_id: ENTIDADE, enterprise_id: "19", etapa: "credito" },
            { empreendimento: "VALE DO OURO", entity_id: ENTIDADE, enterprise_id: noDestino, etapa: "validacao" },
          ],
        }),
      );
      const r = await mover(banco, { de: "19", para: "37" });
      expect(r.status).toBe(409);
      expect(erro(r)).toContain("já tem CAD no novo empreendimento");
      for (const tabela of TABELAS_ESCRITAS) expect(banco.escritas(tabela)).toHaveLength(0);
      expect(m.atualizarEtapa).not.toHaveBeenCalled();
    }
  });

  it("destino equivalente à origem (VOC para a CAD do 35): 400", async () => {
    const banco = bancoFalso(
      tabelasDoCaso({
        esteira: [{ empreendimento: "VALE DO OURO", entity_id: ENTIDADE, enterprise_id: "35", etapa: "credito" }],
      }),
    );
    const r = await mover(banco, { de: "35", para: "37" });
    expect(r.status).toBe(400);
    expect(banco.escritas("apolo_esteira")).toHaveLength(0);
  });

  it("CAD que não existe na origem: 404; corpo sem de/para: 400", async () => {
    const banco = bancoFalso(tabelasDoCaso());
    expect((await mover(banco, { de: "20", para: "35" })).status).toBe(404);
    expect((await mover(banco, { para: "35" })).status).toBe(400);
    expect(banco.escritas("apolo_esteira")).toHaveLength(0);
  });

  it("cadastro de empreendimentos fora do ar: 503, nada escrito", async () => {
    const banco = bancoFalso(tabelasDoCaso(), {
      "hercules_empreendimentos:select": { message: "timeout" },
    });
    const r = await mover(banco);
    expect(r.status).toBe(503);
    expect(banco.escritas("apolo_esteira")).toHaveLength(0);
  });

  it("a etapa mudou entre a leitura e a escrita: 409, nada mais é escrito", async () => {
    // O plano foi decidido sobre 'validacao'; se a régua da origem credenciou nesse meio tempo, mover
    // com o plano velho levaria um credenciado sem análise para o destino.
    const banco = bancoFalso(tabelasDoCaso({ etapa: "validacao" }));
    m.nome.mockImplementation(async (_c: unknown, id: string) => {
      const linha = banco.tabelas.apolo_esteira?.[0];
      if (linha) linha.etapa = "credenciado";
      return id === "35" ? "VALE DO OURO" : "";
    });
    const r = await mover(banco);
    expect(r.status).toBe(409);
    expect(erro(r)).toContain("A CAD mudou enquanto era movida");
    expect(banco.tabelas.apolo_esteira?.[0]?.enterprise_id).toBe("19");
    expect(banco.escritas("apolo_relationships")).toHaveLength(0);
    expect(m.avisar).not.toHaveBeenCalled();
  });

  describe("CAD com cobrança de pré-venda não se move (decisão padrão do Zeus, 24/09/2026)", () => {
    // `pagamento_ref` e `pago_em` moram na linha da esteira, e a troca é um UPDATE dela: o PIX pago ao
    // Vale do Ouro passaria a somar no painel do destino. Medido em 24/09/2026: 432 CADs com
    // `pagamento_ref`, 108 com `pago_em`, todas credenciadas no 35.
    const COBRANCA =
      "Esta CAD já tem cobrança de pré-venda no empreendimento atual. Mover levaria a cobrança para outro empreendimento. Resolva a cobrança antes de mover.";
    const comCobranca = (cobranca: Linha) =>
      tabelasDoCaso({
        esteira: [
          {
            empreendimento: "VEREDAS DO OURO",
            entity_id: ENTIDADE,
            enterprise_id: "19",
            etapa: "credenciado",
            motivo: null,
            ...cobranca,
          },
        ],
      });

    for (const [caso, cobranca] of [
      ["PIX gerado (pagamento_ref)", { pagamento_ref: "pay_abc123", pago_em: null }],
      ["PIX pago (pago_em)", { pagamento_ref: "pay_abc123", pago_em: "2026-09-10T12:00:00.000Z" }],
      ["só pago_em", { pagamento_ref: null, pago_em: "2026-09-10T12:00:00.000Z" }],
      ["reserva do PIX em andamento", { pagamento_ref: "reservado:1790000000000", pago_em: null }],
    ] as const) {
      it(`${caso}: 409, nada escrito e nenhuma régua lida`, async () => {
        const banco = bancoFalso(comCobranca(cobranca));
        const r = await mover(banco, { de: "19", para: "35" });
        expect(r.status).toBe(409);
        expect(erro(r)).toBe(COBRANCA);
        for (const tabela of TABELAS_ESCRITAS) expect(banco.escritas(tabela)).toHaveLength(0);
        expect(banco.tabelas.apolo_esteira?.[0]).toMatchObject({ enterprise_id: "19", ...cobranca });
        expect(m.analise).not.toHaveBeenCalled();
        expect(m.atualizarEtapa).not.toHaveBeenCalled();
        expect(m.avisar).not.toHaveBeenCalled();
        expect(m.gerarCad).not.toHaveBeenCalled();
      });
    }

    it("a cobrança nasce entre a leitura e a escrita: o UPDATE não pega a linha (409), nada mais é escrito", async () => {
      const banco = bancoFalso(tabelasDoCaso({ etapa: "validacao" }));
      m.nome.mockImplementation(async (_c: unknown, id: string) => {
        const linha = banco.tabelas.apolo_esteira?.[0];
        if (linha) linha.pagamento_ref = "pay_nasceu_agora";
        return id === "35" ? "VALE DO OURO" : "";
      });
      const r = await mover(banco);
      expect(r.status).toBe(409);
      expect(erro(r)).toContain("A CAD mudou enquanto era movida");
      expect(banco.tabelas.apolo_esteira?.[0]).toMatchObject({
        enterprise_id: "19",
        pagamento_ref: "pay_nasceu_agora",
      });
      // A condição vai na escrita, e não só na leitura.
      const [troca] = banco.escritas("apolo_esteira");
      expect(troca?.filtros).toEqual(
        expect.arrayContaining([
          ["pagamento_ref", "is", null],
          ["pago_em", "is", null],
        ]),
      );
      expect(banco.escritas("apolo_relationships")).toHaveLength(0);
      expect(m.avisar).not.toHaveBeenCalled();
    });

    it("CAD sem cobrança (o caso do Jonatas) move normalmente", async () => {
      const banco = bancoFalso(comCobranca({ pagamento_ref: null, pago_em: null }));
      m.analise.mockImplementation(async () => false);
      const r = await mover(banco, { de: "19", para: "35" });
      expect(r.status).toBe(200);
      expect(banco.tabelas.apolo_esteira?.[0]?.enterprise_id).toBe("35");
    });
  });

  describe("a etapa, pela regra do crédito do DESTINO", () => {
    it("credenciado + consulta recente APROVADA no limite do destino: fica credenciado, sem regravar", async () => {
      m.consulta.mockImplementation(async () => consultaRecente(500));
      const banco = bancoFalso(tabelasDoCaso({ etapa: "credenciado" }));
      const r = await mover(banco);

      expect(dados(r)).toMatchObject({
        credito: { avaliado: true, passou: true },
        etapaAnterior: "credenciado",
        etapaNova: "credenciado",
      });
      expect(String((dados(r).credito as Linha).motivo)).toContain(
        avaliarCredito(relatorio(500), 1000).motivo,
      );
      expect(m.atualizarEtapa).not.toHaveBeenCalled();
      // A régua é a do DESTINO (35), com a consulta do titular desta ficha, no ambiente atual.
      expect(m.analise).toHaveBeenCalledWith(banco.client, ENTIDADE, "35");
      expect(m.limite).toHaveBeenCalledWith(banco.client, ENTIDADE, "35");
      expect(m.consulta).toHaveBeenCalledWith(banco.client, "52998224725", {
        ambiente: "producao",
        cad: { alvo: "titular", entityId: ENTIDADE },
      });
    });

    it("crédito + aprovada: SOBE pelo ponto autoritativo, JÁ com a CAD no destino", async () => {
      m.consulta.mockImplementation(async () => consultaRecente(0));
      const banco = bancoFalso(tabelasDoCaso({ etapa: "credito" }));
      // A pré-venda do destino desligada: `atualizarEtapa` redireciona para credenciado.
      m.atualizarEtapa.mockImplementation(async () => {
        // No momento da chamada, a CAD já mora no 35 (a ordem das escritas).
        expect(banco.tabelas.apolo_esteira?.[0]?.enterprise_id).toBe("35");
        return { aviso: avisoOk("credenciado"), error: null, etapa: "credenciado" };
      });
      const r = await mover(banco);

      expect(m.atualizarEtapa).toHaveBeenCalledWith(banco.client, ENTIDADE, "prevenda", {
        atualizadoPor: AUTOR,
        enterpriseId: "35",
        motivo: expect.stringContaining("Crédito aprovado no limite do novo empreendimento."),
        saidaDeRevisaoAutorizada: false,
      });
      expect(dados(r)).toMatchObject({ credito: { passou: true }, etapaNova: "credenciado", incompleto: false });
      // A etapa não é gravada no UPDATE da troca (subir não é rebaixar).
      expect(banco.escritas("apolo_esteira")[0]?.valores).not.toHaveProperty("etapa");
      // `atualizarEtapa` já avisou e já pôs na fila: nada repetido.
      expect(m.avisar).not.toHaveBeenCalled();
      expect(m.fila).not.toHaveBeenCalled();
    });

    it("revisão + aprovada no limite do destino: pré-venda, com a saída de revisão autorizada", async () => {
      m.consulta.mockImplementation(async () => consultaRecente(0));
      const banco = bancoFalso(tabelasDoCaso({ etapa: "revisao" }));
      await mover(banco);
      expect(m.atualizarEtapa).toHaveBeenCalledWith(
        banco.client,
        ENTIDADE,
        "prevenda",
        expect.objectContaining({ saidaDeRevisaoAutorizada: true }),
      );
    });

    it("D2: SUBIR que falha: a CAD fica em crédito NO DESTINO, a resposta diz isso e marca `incompleto`", async () => {
      m.consulta.mockImplementation(async () => consultaRecente(0));
      const banco = bancoFalso(tabelasDoCaso({ etapa: "credito" }));
      m.atualizarEtapa.mockImplementation(async () => ({ error: "Falhou — de propósito.", etapa: "prevenda" }));
      const r = await mover(banco);
      expect(r.status).toBe(200);
      expect(dados(r)).toMatchObject({ etapaNova: "credito", incompleto: true });
      expect(avisosDe(r)).toContain(
        "A CAD não avançou para a pré-venda: Falhou, de propósito. A CAD ficou em Análise de crédito no novo empreendimento.",
      );
      expect(avisosDe(r)).not.toMatch(/[—–]/);
      expect(banco.tabelas.apolo_esteira?.[0]).toMatchObject({ enterprise_id: "35", etapa: "credito" });
      // A CAD chegou (em crédito): o destino é avisado e a fila do destino é conferida.
      expect(m.avisar).toHaveBeenCalledWith(banco.client, {
        enterpriseId: "35",
        entityId: ENTIDADE,
        etapa: "credito",
        etapaAnterior: "credito",
        forcar: true,
        origem: "board",
      });
      expect(m.fila).toHaveBeenCalledWith(banco.client, ENTIDADE, { enterpriseId: "35" });
    });

    it("D2: credenciado + REPROVADA: revisão no MESMO UPDATE da troca, e o aviso da revisão ao destino", async () => {
      m.consulta.mockImplementation(async () => consultaRecente(5000));
      const banco = bancoFalso(tabelasDoCaso({ etapa: "credenciado" }));
      const r = await mover(banco);

      const [troca, ...resto] = banco.escritas("apolo_esteira");
      expect(resto).toHaveLength(0);
      expect(troca?.valores).toMatchObject({
        enterprise_id: "35",
        etapa: "revisao",
        // O MESMO texto do fluxo normal (`Crédito reprovado. ${veredito.motivo}`).
        motivo: `Crédito reprovado. ${avaliarCredito(relatorio(5000), 1000).motivo}`,
      });
      expect(m.atualizarEtapa).not.toHaveBeenCalled();
      expect(m.avisar).toHaveBeenCalledWith(banco.client, {
        enterpriseId: "35",
        entityId: ENTIDADE,
        etapa: "revisao",
        etapaAnterior: "credenciado",
        forcar: false,
        origem: "board",
      });
      expect(m.fila).toHaveBeenCalledWith(banco.client, ENTIDADE, { enterpriseId: "35" });
      expect(dados(r)).toMatchObject({ credito: { avaliado: true, passou: false }, etapaNova: "revisao" });
    });

    it("o limite é o do destino: a mesma consulta reprovada no 1.000 passa num limite de 10.000", async () => {
      m.consulta.mockImplementation(async () => consultaRecente(5000));
      m.limite.mockImplementation(async () => 10_000);
      const banco = bancoFalso(tabelasDoCaso({ etapa: "credenciado" }));
      const r = await mover(banco);
      expect(dados(r)).toMatchObject({ credito: { passou: true }, etapaNova: "credenciado" });
      expect(m.atualizarEtapa).not.toHaveBeenCalled();
    });

    it("D2: credenciado SEM consulta recente (o caso do Jonatas): crédito no MESMO UPDATE da troca", async () => {
      const banco = bancoFalso(tabelasDoCaso({ etapa: "credenciado" }));
      // Mesmo que o aviso e o PDF falhem, a CAD NUNCA fica credenciada no destino.
      m.avisar.mockImplementation(async () => {
        throw new Error("Evolution fora do ar");
      });
      m.gerarCad.mockImplementation(async () => ({ error: "C2X lento", ok: false }) as never);
      const r = await mover(banco);

      const escritas = banco.escritas("apolo_esteira");
      expect(escritas).toHaveLength(1);
      expect(escritas[0]?.valores).toMatchObject({ enterprise_id: "35", etapa: "credito" });
      expect(banco.tabelas.apolo_esteira?.[0]).toMatchObject({ enterprise_id: "35", etapa: "credito" });
      expect(m.atualizarEtapa).not.toHaveBeenCalled();
      // (24/09/2026, terceira rodada) Aviso e PDF que falham entram em `avisos`, mas NÃO ligam
      // `incompleto`: o dado está certo (a CAD está no destino, em crédito, com o vínculo certo).
      expect(dados(r)).toMatchObject({
        credito: { avaliado: false, passou: null },
        etapaAnterior: "credenciado",
        etapaNova: "credito",
        incompleto: false,
      });
      expect(dados(r).avisos).toEqual([
        "O aviso ao coordenador do novo empreendimento não saiu.",
        "O PDF da CAD não foi regenerado agora; sai na próxima troca de etapa.",
      ]);
      expect(avisosDe(r)).not.toContain("Reenvie");
    });

    it("SUBIR da revisão que falha: a frase diz 'Crédito em revisão', o rótulo do Board", async () => {
      m.consulta.mockImplementation(async () => consultaRecente(0));
      const banco = bancoFalso(tabelasDoCaso({ etapa: "revisao" }));
      m.atualizarEtapa.mockImplementation(async () => ({ error: "Falhou.", etapa: "prevenda" }));
      const r = await mover(banco);
      expect(dados(r)).toMatchObject({ etapaNova: "revisao", incompleto: true });
      expect(avisosDe(r)).toContain(
        "A CAD não avançou para a pré-venda: Falhou. A CAD ficou em Crédito em revisão no novo empreendimento.",
      );
      // Nunca "Revisão" solto: a linha do resultado e a coluna do Board dizem "Crédito em revisão".
      expect(avisosDe(r)).not.toMatch(/ficou em Revisão/);
    });

    it("destino SEM análise de crédito: a etapa fica, e nenhuma consulta é lida", async () => {
      m.analise.mockImplementation(async () => false);
      const banco = bancoFalso(tabelasDoCaso({ etapa: "credenciado" }));
      const r = await mover(banco);
      expect(m.consulta).not.toHaveBeenCalled();
      expect(m.atualizarEtapa).not.toHaveBeenCalled();
      expect(dados(r)).toMatchObject({ credito: { avaliado: false }, etapaNova: "credenciado" });
    });

    it("D6: pré-venda num destino sem pré-venda: reaplicada, e `atualizarEtapa` manda para credenciado", async () => {
      m.analise.mockImplementation(async () => false);
      const banco = bancoFalso(tabelasDoCaso({ etapa: "prevenda" }));
      m.atualizarEtapa.mockImplementation(async () => ({
        aviso: avisoOk("credenciado"),
        error: null,
        etapa: "credenciado",
      }));
      const r = await mover(banco);
      expect(m.atualizarEtapa).toHaveBeenCalledWith(
        banco.client,
        ENTIDADE,
        "prevenda",
        expect.objectContaining({ enterpriseId: "35" }),
      );
      expect(dados(r)).toMatchObject({ etapaAnterior: "prevenda", etapaNova: "credenciado", incompleto: false });
      expect(m.avisar).not.toHaveBeenCalled();
    });

    it("D6: pré-venda que continua pré-venda no destino: o destino é avisado de que ela chegou", async () => {
      m.consulta.mockImplementation(async () => consultaRecente(0));
      const banco = bancoFalso(tabelasDoCaso({ etapa: "prevenda" }));
      // A mesma etapa: `atualizarEtapa` não repete o aviso (etapaAnterior === etapa).
      m.atualizarEtapa.mockImplementation(async () => ({ aviso: null, error: null, etapa: "prevenda" }));
      const r = await mover(banco);
      expect(dados(r)).toMatchObject({ etapaNova: "prevenda", incompleto: false });
      expect(m.avisar).toHaveBeenCalledWith(
        banco.client,
        expect.objectContaining({ enterpriseId: "35", etapa: "prevenda", forcar: true }),
      );
    });

    it("sem a configuração do Serasa não se sabe o ambiente: 503 e nada muda", async () => {
      m.config.mockImplementation(() => ({ faltando: ["SERASA_AUTH_URL"], ok: false }));
      const banco = bancoFalso(tabelasDoCaso({ etapa: "credenciado" }));
      const r = await mover(banco);
      expect(r.status).toBe(503);
      expect(banco.escritas("apolo_esteira")).toHaveLength(0);
      expect(banco.escritas("apolo_relationships")).toHaveLength(0);
    });
  });

  describe("D5: o destino é avisado mesmo quando a etapa não muda", () => {
    it("validação movida: corretor e coordenador DO DESTINO recebem o aviso da etapa, forçado", async () => {
      const banco = bancoFalso(tabelasDoCaso({ etapa: "validacao" }));
      await mover(banco);
      expect(m.avisar).toHaveBeenCalledTimes(1);
      expect(m.avisar).toHaveBeenCalledWith(banco.client, {
        enterpriseId: "35",
        entityId: ENTIDADE,
        etapa: "validacao",
        etapaAnterior: "validacao",
        forcar: true,
        origem: "board",
      });
    });

    it("credenciado que fica: o coordenador do destino fica sabendo do cliente", async () => {
      m.analise.mockImplementation(async () => false);
      const banco = bancoFalso(tabelasDoCaso({ etapa: "credenciado" }));
      await mover(banco);
      expect(m.avisar).toHaveBeenCalledWith(
        banco.client,
        expect.objectContaining({ enterpriseId: "35", etapa: "credenciado", forcar: true }),
      );
    });

    it("coordenador não achado (nem no Panteon nem no C2X): o aviso diz o que conferir, sem `incompleto`", async () => {
      // Medido em 24/09/2026: o group:Lagoa Bonita tem code "LBF + LBR + LBP", a busca pela sigla não
      // achava o coordenador e 6 de 6 avisos falharam. Antes, todo Mover para lá voltava `incompleto` e
      // mandava "Reenvie pelo Board", um reenvio que não existe e falharia igual. A frase é a constante
      // de quem escreve o motivo, não uma cópia (revisão de 24/09/2026).
      m.avisar.mockImplementation(async (_c: unknown, input: { etapa: string }) => ({
        coordenador: { destinatario: null, erro: MOTIVO_SEM_COORDENADOR, ok: false },
        corretor: { destinatario: null, erro: "sem telefone", ok: false, papel: "imobiliaria" },
        etapa: input.etapa,
      }));
      const banco = bancoFalso(tabelasDoCaso({ etapa: "validacao" }));
      const r = await mover(banco);
      expect(dados(r).incompleto).toBe(false);
      expect(dados(r).avisos).toEqual([
        "O aviso ao coordenador do novo empreendimento não saiu: Empreendimento sem coordenador de vendas no Panteon nem no C2X. Confira o coordenador de vendas no cadastro do empreendimento, no Panteon.",
      ]);
    });

    it("o aviso que falhou junto com um passo de DADO: os dois em `avisos`, e `incompleto` pelo dado", async () => {
      m.avisar.mockImplementation(async () => null);
      const banco = bancoFalso(tabelasDoCaso({ etapa: "validacao" }), {
        "apolo_relationships:insert": { message: "falhou" },
      });
      const r = await mover(banco);
      expect(dados(r).incompleto).toBe(true);
      expect(dados(r).avisos).toEqual([
        "O vínculo com o novo empreendimento não foi criado.",
        "O aviso ao coordenador do novo empreendimento não saiu.",
      ]);
    });

    it("só o PDF que não saiu: aviso escrito, sem `incompleto`", async () => {
      m.gerarCad.mockImplementation(async () => {
        throw new Error("C2X fora");
      });
      const banco = bancoFalso(tabelasDoCaso({ etapa: "validacao" }));
      const r = await mover(banco);
      expect(dados(r)).toMatchObject({
        avisos: ["O PDF da CAD não foi regenerado agora; sai na próxima troca de etapa."],
        incompleto: false,
      });
    });

    it("só o corretor sem aviso: não é `incompleto` (fica registrado em apolo_disparos)", async () => {
      m.avisar.mockImplementation(async (_c: unknown, input: { etapa: string }) => ({
        ...avisoOk(input.etapa),
        corretor: { destinatario: null, erro: "sem telefone", ok: false, papel: "imobiliaria" },
      }));
      const banco = bancoFalso(tabelasDoCaso({ etapa: "validacao" }));
      const r = await mover(banco);
      expect(dados(r)).toMatchObject({ avisos: [], incompleto: false });
    });
  });

  it("a CAD some entre a leitura e a escrita (PK nova no destino): 409", async () => {
    const banco = bancoFalso(tabelasDoCaso(), {
      "apolo_esteira:update": { code: "23505", message: "duplicate key" },
    });
    const r = await mover(banco);
    expect(r.status).toBe(409);
    expect(banco.escritas("apolo_relationships")).toHaveLength(0);
  });

  it("vínculo do destino que não pôde ser criado: a origem NÃO é arquivada, e a resposta é `incompleto`", async () => {
    const banco = bancoFalso(tabelasDoCaso(), {
      "apolo_relationships:insert": { message: "falhou" },
    });
    const r = await mover(banco);
    expect(r.status).toBe(200);
    expect(banco.tabelas.apolo_relationships?.find((v) => v.id === "v-19")?.status).toBe("verified");
    expect(avisosDe(r)).toContain("não foi criado");
    expect(dados(r).incompleto).toBe(true);
  });

  it("`avisos` sem repetição: dois vínculos da origem (35 e a divisão 37) que não arquivam dão UMA frase", async () => {
    // O passo 2 escreve a frase uma vez por vínculo que falha, e a tela usa o texto como chave da lista.
    const banco = bancoFalso(
      tabelasDoCaso({
        esteira: [{ empreendimento: "VALE DO OURO", entity_id: ENTIDADE, enterprise_id: "35", etapa: "validacao" }],
        vinculos: [vinculo("v-35", "35"), vinculo("v-37", "37")],
      }),
      { "apolo_relationships:update": { message: "falhou" } },
    );
    m.nome.mockImplementation(async (_c: unknown, id: string) => (id === "19" ? "VEREDAS DO OURO" : ""));
    const r = await mover(banco, { de: "35", para: "19" });
    expect(r.status).toBe(200);
    // Os DOIS arquivamentos foram tentados...
    expect(banco.escritas("apolo_relationships").filter((c) => c.op === "update")).toHaveLength(2);
    // ...e a frase sai uma vez só, na resposta e na linha do tempo.
    const avisos = dados(r).avisos as string[];
    expect(avisos).toEqual(["O vínculo com o empreendimento anterior não foi arquivado."]);
    expect(new Set(avisos).size).toBe(avisos.length);
    expect((banco.tabelas.apolo_timeline_events?.[0]?.metadata as Linha).avisos).toEqual(avisos);
    expect(dados(r).incompleto).toBe(true);
  });
});

describe("avisoDoCoordenadorQueNaoSaiu: diz o que aconteceu e, se for cadastro, o que conferir", () => {
  const BASE = "O aviso ao coordenador do novo empreendimento não saiu";

  it("sem motivo (aviso que lançou ou voltou null): só o fato", () => {
    for (const motivo of [null, undefined, "", "  "]) {
      expect(avisoDoCoordenadorQueNaoSaiu(motivo)).toBe(`${BASE}.`);
    }
  });

  // ⚠️ AS FRASES VÊM DAS CONSTANTES DE QUEM ESCREVE (revisão de 24/09/2026). Estes testes usavam as
  // frases da busca antiga pela sigla, escritas à mão, e continuaram verdes depois que o
  // `coordenadorDaCad` passou a devolver outras: a tela perdeu a dica e nada acusou.
  it("motivo de CADASTRO: diz onde conferir no Panteon (e não depende do ponto final)", () => {
    for (const motivo of [MOTIVO_SEM_COORDENADOR, MOTIVO_SEM_COORDENADOR.replace(/\.$/, "")]) {
      expect(avisoDoCoordenadorQueNaoSaiu(motivo)).toBe(
        `${BASE}: Empreendimento sem coordenador de vendas no Panteon nem no C2X. Confira o coordenador de vendas no cadastro do empreendimento, no Panteon.`,
      );
    }
    expect(avisoDoCoordenadorQueNaoSaiu(MOTIVO_GRUPO_SEM_DIVISOES)).toMatch(
      /Confira as divisões do empreendimento no cadastro do Panteon\.$/,
    );
  });

  it("⚠️ coordenador sem telefone, com o NOME no meio da frase: diz onde corrigir, conforme a fonte", () => {
    // O Garden (39): a CARELI ACESSORIA está cadastrada no Panteon, sem telefone.
    expect(avisoDoCoordenadorQueNaoSaiu("Coordenador CARELI ACESSORIA sem telefone no cadastro do Panteon.")).toBe(
      `${BASE}: Coordenador CARELI ACESSORIA sem telefone no cadastro do Panteon. Confira o telefone na ficha do coordenador, no Panteon.`,
    );
    // LOU/LOS: o Panteon não tem coordenador cadastrado e o do C2X (GLENDER) está sem telefone.
    expect(avisoDoCoordenadorQueNaoSaiu("Coordenador GLENDER sem telefone no C2X.")).toBe(
      `${BASE}: Coordenador GLENDER sem telefone no C2X. Cadastre o coordenador de vendas do empreendimento no Panteon, com o telefone.`,
    );
    for (const motivo of [
      "Coordenador LUNA com telefone que não serve para WhatsApp.",
      "Coordenador sem telefone.",
    ]) {
      expect(avisoDoCoordenadorQueNaoSaiu(motivo)).toMatch(/Confira o telefone na ficha do coordenador, no Panteon\.$/);
    }
  });

  it("motivo de ENVIO ou de leitura: só o fato com o motivo, sem inventar conserto", () => {
    expect(avisoDoCoordenadorQueNaoSaiu("Evolution — timeout.")).toBe(`${BASE}: Evolution, timeout.`);
    expect(avisoDoCoordenadorQueNaoSaiu(MOTIVO_C2X_FORA_DO_AR)).toBe(
      `${BASE}: Não foi possível ler o cadastro do empreendimento no C2X.`,
    );
  });

  it("nunca manda reenviar (esse reenvio não existe para a CAD movida) e nunca leva travessão", () => {
    for (const motivo of [
      null,
      MOTIVO_SEM_COORDENADOR,
      MOTIVO_GRUPO_SEM_DIVISOES,
      MOTIVO_C2X_FORA_DO_AR,
      "Coordenador CARELI ACESSORIA sem telefone no cadastro do Panteon.",
      "Coordenador GLENDER sem telefone no C2X.",
      "Falhou — de novo",
    ]) {
      const frase = avisoDoCoordenadorQueNaoSaiu(motivo);
      expect(frase).not.toMatch(/reenvi/i);
      expect(frase).not.toMatch(/[—–]/);
    }
  });
});
