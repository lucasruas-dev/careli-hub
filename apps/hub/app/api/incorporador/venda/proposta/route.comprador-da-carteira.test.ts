import { beforeEach, describe, expect, it, vi } from "vitest";

// A ROTA DA PROPOSTA COM O COMPRADOR DA CARTEIRA (26/09/2026).
//
// Lucas, "Nasce a CAD credenciada": quem passa pela porta da carteira (contrato ativo na família,
// nenhuma CAD no escopo) ganha a CAD credenciada, marcada 'comprador_da_carteira', quando a proposta
// é GRAVADA. O que está travado aqui é o ONDE e o QUANDO dessa escrita:
//   • só no POST que grava (nem na prévia, nem no GET que abre a modal);
//   • depois de a reserva virar proposta (no 409 da corrida não sobra CAD órfã) e antes dos avisos;
//   • com ON CONFLICT DO NOTHING (CAD existente não é sobrescrita; a chamada é idempotente);
//   • e a falha dela NÃO derruba a proposta.
//
// O credenciamento é dublê (a régua é testada em cliente-credenciado.test.ts); a escrita da CAD
// (`cad-do-comprador.ts`) é a DE VERDADE, sobre o banco falso abaixo.

const estado = vi.hoisted(() => ({
  apagado: [] as Array<{ tabela: string }>,
  avisados: 0,
  cadJaExiste: false,
  /** A porta do CO-comprador (revisão de 26/09/2026): "carteira", "cad", "falha" ou nenhuma. */
  coPorta: null as "cad" | "carteira" | "falha" | null,
  /** A ordem das escritas e dos avisos, para provar que a CAD vem antes do WhatsApp. */
  eventos: [] as string[],
  erroNaCad: null as null | string,
  inserido: [] as Array<{ linha: Record<string, unknown>; tabela: string }>,
  origem: "comprador_da_carteira" as "cad" | "comprador_da_carteira",
  reserva: {} as Record<string, unknown>,
  reservaJaSaiu: false,
  sessao: { tipo: "comercial", usuarioId: "user-1", usuarioNome: "Lucas Ruas" } as Record<string, unknown>,
  unidade: {} as Record<string, unknown>,
  upserts: [] as Array<{ linha: Record<string, unknown>; opcoes: Record<string, unknown>; tabela: string }>,
}));

const ENTIDADE_DO_CONTRATO = "0b6f3c1e-5d7a-4c2b-9f10-3a2b1c0d9e8f";
const ENTIDADE_DO_CO = "3e9c6f4b-8a0d-4f5e-8c43-6d5e4f3a2b1c";
const IMOBILIARIA = "1c7a4d2f-6e8b-4d3c-8a21-4b3c2d1e0f9a";
const CORRETOR = "2d8b5e3a-7f9c-4e4d-9b32-5c4d3e2f1a0b";

const UNIDADE_DO_VEREDAS = {
  area: "250.00",
  codigo: "VDO1011",
  enterprise_id: "19",
  id: "uni-1011",
  lote: "11",
  preco_tabela: "178100.00",
  quadra: "10",
  situacao: "reservada",
};

const PLANO = {
  entradaPercentual: 10,
  indiceCorrecao: "SEM_CORRECAO",
  jurosConvencao: "equivalente",
  jurosPeriodicidade: "anual",
  jurosTaxa: null,
  nome: "NORMAL",
  parcelas: 180,
  sistemaAmortizacao: "sacoc",
  slot: "normal",
};

vi.mock("@/lib/apolo/incorporador/escopo", async () => {
  const { NextResponse } = await import("next/server");
  return {
    foraDoEscopo: () => NextResponse.json({ error: "Não encontrado." }, { status: 404 }),
    idsDaSessao: async () => ["19", "35", "37"],
  };
});

vi.mock("@/lib/apolo/incorporador/board-do-portal", () => ({
  autorizarOperacaoDeVenda: () => ({ ok: true, sessao: estado.sessao }),
  autorizarPortalQueOperaSozinho: async (_request: Request, sessao: unknown) => ({ ok: true, sessao }),
}));

vi.mock("@/lib/apolo/catalogo-empreendimentos", () => ({
  catalogoDeEmpreendimentos: async () => [
    { codes: ["VDO"], stageIds: ["19"] },
    { codes: ["VLO", "VOC"], stageIds: ["35", "37"] },
  ],
}));

vi.mock("@/lib/apolo/incorporador/resumo-do-produto", () => ({
  comIdsDoGrupo: (familia: string[]) => familia,
}));

// O Veredas (19) não tem pai; o VOC (37) é filho do VLO (35), onde moram as CADs do Vale do Ouro.
const CADASTRO = vi.hoisted(() => [
  { c2xEnterpriseId: "19", cidade: "Goiânia", codigo: "VDO", id: "emp-vdo", nome: "Veredas do Ouro", operadoPor: null, ordem: 1, paiId: null, uf: "GO", vendendo: true },
  { c2xEnterpriseId: "35", cidade: "Goiânia", codigo: "VLO", id: "emp-vlo", nome: "Vale do Ouro", operadoPor: null, ordem: 2, paiId: null, uf: "GO", vendendo: true },
  { c2xEnterpriseId: "37", cidade: "Goiânia", codigo: "VOC", id: "emp-voc", nome: "VOC", operadoPor: null, ordem: 3, paiId: "emp-vlo", uf: "GO", vendendo: true },
]);

vi.mock("@/lib/hercules/cadastro", () => ({
  carregarCadastroDeEmpreendimentos: async () => CADASTRO,
  lerCadastroDeEmpreendimentos: async () => ({ com0170: true, linhas: CADASTRO }),
}));

vi.mock("@/lib/hercules/quem-pode-vender", () => ({
  familiaDoEmpreendimento: (_cadastro: unknown, id: string) => (id === "19" ? ["19"] : ["35", "37"]),
}));

vi.mock("@/lib/apolo/planos-comerciais-c2x", () => ({
  lerPlanosDoC2x: async () => ({ ok: false }) as const,
  lerPlanosDoC2xPorIds: async () => ({ ok: false }) as const,
}));

vi.mock("@/lib/hercules/planos-do-panteon", () => ({
  lerFaixasDoPanteon: async () => ({}),
  lerPlanosDoPanteon: async () => [],
  planosPreferindoOPanteon: () => [{ planos: [{ ...PLANO, descontoPercentual: 0 }] }],
}));

// A régua é dublê: devolve a porta que o teste escolheu. O titular é o CPF da reserva; qualquer
// outro documento é o co-comprador, e responde pela porta de `estado.coPorta`. O parâmetro é
// `documento` (CPF ou CNPJ) desde a v1.384.0: um dublê que lesse `cpf` receberia `undefined` e
// trataria o titular como co.
vi.mock("@/lib/hercules/cliente-credenciado", () => ({
  credenciadoParaVender: async (_admin: unknown, alvo: { documento: string }) => {
    if (String(alvo.documento).replace(/\D/g, "") !== "52998224725") {
      if (estado.coPorta === "falha") throw new Error("apolo_esteira: leitura falhou (conexão caiu)");
      if (estado.coPorta === "carteira") {
        return {
          compra: {
            c2xUserId: "7002",
            codigo: "000730",
            desde: "2024-04-10T12:00:00.000Z",
            enterpriseIdDaUnidade: String(estado.unidade.enterprise_id),
            entityIdApontada: null,
            entityIdDoContrato: ENTIDADE_DO_CO,
            papel: "co",
            propostaId: "prop-antiga-2",
            unidade: "VDO0730",
          },
          credenciado: true,
          desde: null,
          entityId: ENTIDADE_DO_CO,
          etapa: null,
          motivo: null,
          origem: "comprador_da_carteira",
          // ⚠️ A CARTEIRA ABRE A PORTA DA PROPOSTA (junção de 26/09/2026): quem entra por ela vem com
          // `credenciado: true`, e `podeGerarProposta` acompanha. Um dublê sem este campo fazia o
          // POST responder 403 — o portal barrando exatamente quem a v1.385.0 existe para deixar
          // passar.
          podeGerarProposta: true,
        };
      }
      return {
        compra: null,
        credenciado: estado.coPorta === "cad",
        desde: null,
        entityId: "ent-co",
        etapa: estado.coPorta === "cad" ? "credenciado" : null,
        motivo: null,
        origem: estado.coPorta === "cad" ? "cad" : null,
        podeGerarProposta: estado.coPorta === "cad",
      };
    }
    return estado.origem === "comprador_da_carteira"
      ? {
          compra: {
            c2xUserId: "7001",
            codigo: "000728",
            desde: "2024-03-10T12:00:00.000Z",
            enterpriseIdDaUnidade: String(estado.unidade.enterprise_id),
            entityIdApontada: null,
            entityIdDoContrato: ENTIDADE_DO_CONTRATO,
            papel: "titular",
            propostaId: "prop-antiga",
            unidade: "VDO0728",
          },
          credenciado: true,
          // Como a régua de verdade: na porta da carteira não há CAD para datar.
          desde: null,
          entityId: ENTIDADE_DO_CONTRATO,
          etapa: null,
          motivo: null,
          origem: "comprador_da_carteira",
          podeGerarProposta: true,
        }
      : {
          compra: null,
          credenciado: true,
          desde: "2026-09-01",
          entityId: "ent-cliente",
          etapa: "credenciado",
          motivo: null,
          origem: "cad",
          podeGerarProposta: true,
        };
  },
  FalhaAoLerCredenciamento: class extends Error {},
}));

vi.mock("@/lib/hercules/avisos-da-venda", () => ({
  avisarSobreAVenda: async () => {
    estado.avisados += 1;
    estado.eventos.push("avisos");
    return [{ ok: true, para: "imobiliaria" }];
  },
  destinatariosDaVenda: async () => ({
    coordenadores: [{ nome: "Nivea", telefone: "62999990000" }],
    corretor: { nome: "João Souza", telefone: "62988887777" },
    imobiliaria: { nome: "GURGEL", telefone: "6232220000" },
  }),
  registrarAvisoNaoEnviado: async () => [],
  vendaAvisaPeloWhatsapp: () => true,
}));

vi.mock("@/lib/hercules/proposta-pdf", () => ({
  montarPropostaPdf: async () => new Uint8Array([1, 2, 3]),
}));

vi.mock("@/lib/apolo/server", () => {
  type Feito = {
    insert: null | Record<string, unknown>;
    select: boolean;
    soLinhasDoPai: boolean;
    unica: boolean;
    update: boolean;
    upsert: null | Record<string, unknown>;
  };

  const consulta = (tabela: string) => {
    const feito: Feito = { insert: null, select: false, soLinhasDoPai: false, unica: false, update: false, upsert: null };
    const alvo: Record<string, unknown> = {
      then: (aceitar: (r: unknown) => unknown, recusar?: (e: unknown) => unknown) =>
        Promise.resolve(responder(tabela, feito)).then(aceitar, recusar),
    };
    for (const metodo of ["eq", "in", "is", "limit", "or", "order", "range"]) alvo[metodo] = () => alvo;
    for (const metodo of ["maybeSingle", "single"]) {
      alvo[metodo] = () => {
        feito.unica = true;
        return alvo;
      };
    }
    alvo.not = () => {
      feito.soLinhasDoPai = true;
      return alvo;
    };
    alvo.select = () => {
      feito.select = true;
      return alvo;
    };
    alvo.delete = () => {
      estado.apagado.push({ tabela });
      return alvo;
    };
    alvo.insert = (linha: Record<string, unknown>) => {
      feito.insert = linha;
      estado.inserido.push({ linha, tabela });
      return alvo;
    };
    alvo.update = () => {
      feito.update = true;
      return alvo;
    };
    alvo.upsert = (linha: Record<string, unknown>, opcoes: Record<string, unknown>) => {
      feito.upsert = linha;
      estado.upserts.push({ linha, opcoes, tabela });
      estado.eventos.push(`upsert:${tabela}`);
      return alvo;
    };
    return alvo;
  };

  const responder = (tabela: string, feito: Feito) => {
    if (feito.upsert) {
      if (estado.erroNaCad) return { data: null, error: { message: estado.erroNaCad } };
      return { data: estado.cadJaExiste ? [] : [{ entity_id: feito.upsert.entity_id }], error: null };
    }
    if (feito.insert) return { data: { id: "prop-nova" }, error: null };
    if (feito.update) {
      if (!feito.select) return { data: null, error: null };
      const casou = tabela === "hercules_reservas" && estado.reservaJaSaiu ? [] : [{ id: "linha-1" }];
      return { data: casou, error: null };
    }
    if (!feito.unica) {
      if (tabela === "hercules_unidades") {
        return {
          data: feito.soLinhasDoPai
            ? []
            : [{ ...estado.unidade, atualizado_em: null, espelho_de: null, origem_c2x_id: null, workspace_id: "careli" }],
          error: null,
        };
      }
      if (tabela === "hercules_reservas") {
        return { data: [{ ...estado.reserva, prometeu_reserva_id: null, unidade_id: estado.unidade.id }], error: null };
      }
      if (tabela === "hercules_propostas") return { data: [], error: null };
      if (tabela === "prometeu_reservas") return { data: [], error: null };
      if (tabela === "apolo_contacts") return { data: [{ value: "joao@imob.com" }], error: null };
    }
    if (tabela === "hercules_unidades") return { data: estado.unidade, error: null };
    if (tabela === "hercules_reservas") return { data: estado.reserva, error: null };
    if (tabela === "apolo_enterprise_settings") return { data: { entrada_minima_percentual: 10 }, error: null };
    if (tabela === "apolo_entities") {
      return {
        data: [
          { display_name: null, id: IMOBILIARIA, legal_name: null, trade_name: "GURGEL" },
          { display_name: null, id: CORRETOR, legal_name: null, trade_name: "João Souza" },
        ],
        error: null,
      };
    }
    return { data: null, error: null };
  };

  return {
    createApoloAdminClient: () => ({
      from: (tabela: string) => consulta(tabela),
      storage: {
        from: () => ({
          createSignedUrl: async () => ({ data: { signedUrl: "https://exemplo/proposta.pdf" }, error: null }),
          download: async () => ({ data: null, error: { message: "sem logo" } }),
          upload: async () => ({ data: { path: "x" }, error: null }),
        }),
      },
    }),
    hashIdentifier: (tipo: string, valor: string) => `hash:${tipo}:${valor}`,
  };
});

import { GET, POST } from "@/app/api/incorporador/venda/proposta/route";
import { A_CARTEIRA_VALE_PARA_O_CONTRATO } from "@/lib/hercules/cad-para-contrato";

const PRIMEIRA_PARCELA = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
const CPF_DO_TITULAR = "529.982.247-25";

const pedir = (corpo: Record<string, unknown> = {}) =>
  POST(
    new Request("https://c2x.app.br/api/incorporador/venda/proposta", {
      body: JSON.stringify({
        compradores: [{ cpf: CPF_DO_TITULAR, nome: "Pedro", participacao: 100, telefone: "62991234567" }],
        diaDeVencimento: 10,
        entradaValor: 17_810,
        entradaVezes: 2,
        parcelasMensais: 120,
        planoNome: "NORMAL",
        primeiraParcelaEm: PRIMEIRA_PARCELA,
        unidadeId: String(estado.unidade.id),
        valorNegociado: 178_100,
        ...corpo,
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    }),
  );

const cadsGravadas = () => estado.upserts.filter((u) => u.tabela === "apolo_esteira");
const propostaGravada = () =>
  [...estado.inserido].reverse().find((i) => i.tabela === "hercules_propostas")?.linha ?? {};

beforeEach(() => {
  estado.apagado = [];
  estado.avisados = 0;
  estado.cadJaExiste = false;
  estado.coPorta = null;
  estado.eventos = [];
  estado.erroNaCad = null;
  estado.inserido = [];
  estado.origem = "comprador_da_carteira";
  estado.reservaJaSaiu = false;
  estado.sessao = { tipo: "comercial", usuarioId: "user-1", usuarioNome: "Lucas Ruas" };
  estado.unidade = UNIDADE_DO_VEREDAS;
  estado.upserts = [];
  estado.reserva = {
    corretor_entity_id: CORRETOR,
    criado_em: "2026-09-26T12:00:00.000Z",
    id: "res-1011",
    imobiliaria_entity_id: IMOBILIARIA,
    proponentes: [{ cpf: CPF_DO_TITULAR, nome: "PEDRO", telefone: "62991234567" }],
    protocolo_numero: 1011,
    situacao: "ativa",
    validade_em: "2026-10-03T02:59:59.000Z",
  };
});

describe("POST: a CAD do comprador da carteira nasce na gravação", () => {
  it("⚠️ grava a proposta E a CAD credenciada, marcada, com a imobiliária e o corretor da reserva", async () => {
    const r = await pedir();

    expect(r.status).toBe(200);
    const corpo = (await r.json()) as { data: { cadDoComprador?: { estado: string } } };
    expect(corpo.data.cadDoComprador).toEqual({ estado: "criada" });

    expect(cadsGravadas()).toHaveLength(1);
    expect(cadsGravadas()[0]?.linha).toMatchObject({
      corretor: "João Souza",
      corretor_entity_id: CORRETOR,
      empreendimento: "Veredas do Ouro",
      enterprise_id: "19",
      entity_id: ENTIDADE_DO_CONTRATO,
      etapa: "credenciado",
      imobiliaria: "GURGEL",
      imobiliaria_entity_id: IMOBILIARIA,
      origem: "comprador_da_carteira",
    });
    // ⚠️ ON CONFLICT DO NOTHING: uma CAD que já exista naquele (pessoa, empreendimento) fica intacta.
    expect(cadsGravadas()[0]?.opcoes).toEqual({ ignoreDuplicates: true, onConflict: "entity_id,enterprise_id" });
    // A proposta aponta a MESMA entidade: a do contrato.
    expect(propostaGravada().cliente_entity_id).toBe(ENTIDADE_DO_CONTRATO);
  });

  it("a CAD entra ANTES dos avisos, e os avisos são os de sempre (um disparo)", async () => {
    await pedir();
    expect(estado.eventos).toEqual(["upsert:apolo_esteira", "avisos"]);
    expect(estado.avisados).toBe(1);
  });

  it("⚠️ na divisão (VOC, 37) a CAD mora no PAI (35), onde moram as CADs do Vale do Ouro", async () => {
    estado.unidade = { ...UNIDADE_DO_VEREDAS, codigo: "VOC0101", enterprise_id: "37", id: "uni-voc" };
    const r = await pedir();
    expect(r.status).toBe(200);
    expect(cadsGravadas()[0]?.linha).toMatchObject({ empreendimento: "Vale do Ouro", enterprise_id: "35" });
  });

  it("⚠️ CAD que já existia não é sobrescrita: a resposta diz 'ja_existia' e a proposta segue", async () => {
    estado.cadJaExiste = true;
    const r = await pedir();
    expect(r.status).toBe(200);
    expect(((await r.json()) as { data: { cadDoComprador?: { estado: string } } }).data.cadDoComprador).toEqual({
      estado: "ja_existia",
    });
  });

  it("⚠️ a falha da CAD NÃO derruba a proposta: 200, proposta gravada, avisos saem, e a resposta diz", async () => {
    estado.erroNaCad = "violates foreign key constraint";
    const r = await pedir();

    expect(r.status).toBe(200);
    const corpo = (await r.json()) as { data: { cadDoComprador?: { estado: string }; id: string } };
    expect(corpo.data.id).toBe("prop-nova");
    expect(corpo.data.cadDoComprador).toEqual({ estado: "erro" });
    expect(estado.avisados).toBe(1);
    expect(estado.apagado).toEqual([]);
  });

  it("⚠️ a PRÉVIA não escreve CAD nenhuma", async () => {
    const r = await pedir({ previa: true });
    expect(r.status).toBe(200);
    expect(cadsGravadas()).toHaveLength(0);
    expect(estado.inserido).toHaveLength(0);
  });

  it("⚠️ no 409 da corrida (a reserva saiu de 'ativa') não sobra CAD órfã", async () => {
    estado.reservaJaSaiu = true;
    const r = await pedir();
    expect(r.status).toBe(409);
    expect(cadsGravadas()).toHaveLength(0);
  });

  it("quem passou pela CAD de sempre não ganha escrita nenhuma na esteira", async () => {
    estado.origem = "cad";
    const r = await pedir();
    expect(r.status).toBe(200);
    expect(cadsGravadas()).toHaveLength(0);
    expect(((await r.json()) as { data: Record<string, unknown> }).data).not.toHaveProperty("cadDoComprador");
  });
});

describe("GET: a modal só LÊ", () => {
  it("⚠️ devolve a origem 'comprador_da_carteira' para o selo, e não escreve CAD", async () => {
    const r = await GET(
      new Request(`https://c2x.app.br/api/incorporador/venda/proposta?unidade=${String(estado.unidade.id)}`),
    );
    expect(r.status).toBe(200);
    const corpo = (await r.json()) as { data: { credenciamento: Record<string, unknown> } };
    expect(corpo.data.credenciamento).toMatchObject({
      contratoAtivo: true,
      credenciado: true,
      // ⚠️ A data do contrato antigo não vai para a tela (nem para o portal que não é a Careli).
      desde: null,
      origem: "comprador_da_carteira",
    });
    // O objeto da compra (ids e códigos internos) não vai para a tela.
    expect(corpo.data.credenciamento).not.toHaveProperty("compra");
    expect(cadsGravadas()).toHaveLength(0);
    expect(estado.inserido).toHaveLength(0);
  });

  it("pela CAD de sempre, `contratoAtivo` é falso", async () => {
    estado.origem = "cad";
    const r = await GET(
      new Request(`https://c2x.app.br/api/incorporador/venda/proposta?unidade=${String(estado.unidade.id)}`),
    );
    const corpo = (await r.json()) as { data: { credenciamento: Record<string, unknown> } };
    expect(corpo.data.credenciamento).toMatchObject({ contratoAtivo: false, origem: "cad" });
  });

  // ⚠️ O CONTRATO DA TELA TEM OS CAMPOS DAS DUAS DECISÕES DE 26/09/2026, e este teste existe porque
  // a junção podia ter deixado um deles cair no caminho: `origem` troca o SELO (comprador da
  // carteira) e `podeGerarProposta` acende o BOTÃO (a porta afrouxada). A modal lê os dois, e um
  // GET que mandasse só um faria a tela ou mentir no selo ou travar o botão.
  it("⚠️ o GET manda OS DOIS campos novos, `origem` E `podeGerarProposta`", async () => {
    for (const origem of ["comprador_da_carteira", "cad"] as const) {
      estado.origem = origem;
      const r = await GET(
        new Request(`https://c2x.app.br/api/incorporador/venda/proposta?unidade=${String(estado.unidade.id)}`),
      );
      const corpo = (await r.json()) as { data: { credenciamento: Record<string, unknown> } };
      expect(corpo.data.credenciamento).toMatchObject({ origem, podeGerarProposta: true });
    }
  });

  // ⚠️ E MANDA TAMBÉM A DECISÃO DA BARRA DO CONTRATO, que é o terceiro campo que a junção obrigou.
  // `contratoExigeCad` é o espelho de `A_CARTEIRA_VALE_PARA_O_CONTRATO` (`lib/hercules/cad-para-contrato.ts`):
  // sem ele, o dia em que o Lucas responder "a carteira não vale para o contrato" a modal continuaria
  // dizendo *"A reserva pode virar proposta"* e o coordenador descobriria a parede num 409 depois de
  // montar plano e entrada. Hoje a carteira VALE, então o campo é `false` e a tela não avisa nada.
  it("⚠️ o GET manda a decisão da barra do contrato em `contratoExigeCad`", async () => {
    const r = await GET(
      new Request(`https://c2x.app.br/api/incorporador/venda/proposta?unidade=${String(estado.unidade.id)}`),
    );
    const corpo = (await r.json()) as { data: { credenciamento: Record<string, unknown> } };
    expect(corpo.data.credenciamento).toHaveProperty("contratoExigeCad");
    expect(corpo.data.credenciamento.contratoExigeCad).toBe(!A_CARTEIRA_VALE_PARA_O_CONTRATO);
  });
});

// ── O CO-COMPRADOR QUE ENTROU PELA CARTEIRA (revisão de 26/09/2026) ──────────
//
// A busca de proponentes libera o co pela mesma régua do titular; sem a CAD dele, ele ficava fora do
// Board e do CRM, e a esteira deixava de ser a fonte da decisão.

const CPF_DO_CO = "111.444.777-35";
const comCo = () =>
  pedir({
    compradores: [
      { cpf: CPF_DO_TITULAR, nome: "Pedro", participacao: 50, telefone: "62991234567" },
      { cpf: CPF_DO_CO, nome: "Bia", participacao: 50, telefone: "62991230000" },
    ],
  });

describe("POST: a CAD do co-comprador da carteira", () => {
  it("⚠️ o co sem CAD e com contrato ativo ganha a CAD credenciada, com a imobiliária e o corretor da reserva", async () => {
    estado.origem = "cad";
    estado.coPorta = "carteira";
    const r = await comCo();

    expect(r.status).toBe(200);
    const corpo = (await r.json()) as { data: Record<string, unknown> };
    expect(corpo.data).not.toHaveProperty("cadDoComprador");
    expect(corpo.data.cadsDosCoCompradores).toEqual([{ estado: "criada" }]);
    expect(cadsGravadas()).toHaveLength(1);
    expect(cadsGravadas()[0]?.linha).toMatchObject({
      corretor_entity_id: CORRETOR,
      enterprise_id: "19",
      entity_id: ENTIDADE_DO_CO,
      etapa: "credenciado",
      imobiliaria_entity_id: IMOBILIARIA,
      origem: "comprador_da_carteira",
    });
    expect(cadsGravadas()[0]?.opcoes).toEqual({ ignoreDuplicates: true, onConflict: "entity_id,enterprise_id" });
    // E antes dos avisos, como a do titular.
    expect(estado.eventos).toEqual(["upsert:apolo_esteira", "avisos"]);
  });

  it("titular e co pela carteira: as duas CADs nascem, cada uma na sua entidade", async () => {
    estado.coPorta = "carteira";
    const r = await comCo();
    expect(r.status).toBe(200);
    expect(cadsGravadas().map((c) => c.linha.entity_id).sort()).toEqual(
      [ENTIDADE_DO_CONTRATO, ENTIDADE_DO_CO].sort(),
    );
  });

  it("⚠️ o co PESSOA JURÍDICA (CNPJ) entra pela mesma porta, e a CAD dele nasce igual", async () => {
    // (26/09/2026, junção com a v1.384.0) A lista dos co que vão à régua era `cpf.length === 11`:
    // uma empresa co-compradora que passou pela busca ficava sem CAD, fora do Board. Hoje não há
    // co de 14 dígitos nos faturados (medido), então nada muda para quem já vendia.
    estado.origem = "cad";
    estado.coPorta = "carteira";
    const r = await pedir({
      compradores: [
        { cpf: CPF_DO_TITULAR, nome: "Pedro", participacao: 50, telefone: "62991234567" },
        { cpf: "12.345.678/0001-95", nome: "ACME LTDA", participacao: 50, telefone: "62991230000" },
      ],
    });

    expect(r.status).toBe(200);
    const corpo = (await r.json()) as { data: Record<string, unknown> };
    expect(corpo.data.cadsDosCoCompradores).toEqual([{ estado: "criada" }]);
    expect(cadsGravadas().map((c) => c.linha.entity_id)).toEqual([ENTIDADE_DO_CO]);
  });

  it("o co com CAD de sempre não ganha escrita nenhuma", async () => {
    estado.origem = "cad";
    estado.coPorta = "cad";
    const r = await comCo();
    expect(r.status).toBe(200);
    expect(cadsGravadas()).toHaveLength(0);
    expect(((await r.json()) as { data: Record<string, unknown> }).data).not.toHaveProperty(
      "cadsDosCoCompradores",
    );
  });

  it("⚠️ a leitura do co que falha NÃO derruba a proposta: 200, avisos saem, e a resposta diz 'erro'", async () => {
    estado.origem = "cad";
    estado.coPorta = "falha";
    const r = await comCo();
    expect(r.status).toBe(200);
    const corpo = (await r.json()) as { data: Record<string, unknown> };
    expect(corpo.data.id).toBe("prop-nova");
    expect(corpo.data.cadsDosCoCompradores).toEqual([{ estado: "erro" }]);
    expect(estado.avisados).toBe(1);
    expect(cadsGravadas()).toHaveLength(0);
  });

  it("a prévia não escreve a CAD do co", async () => {
    estado.coPorta = "carteira";
    const r = await pedir({
      compradores: [
        { cpf: CPF_DO_TITULAR, nome: "Pedro", participacao: 50, telefone: "62991234567" },
        { cpf: CPF_DO_CO, nome: "Bia", participacao: 50, telefone: "62991230000" },
      ],
      previa: true,
    });
    expect(r.status).toBe(200);
    expect(cadsGravadas()).toHaveLength(0);
  });
});
