import { beforeEach, describe, expect, it, vi } from "vitest";

// AS DUAS PORTAS DA MESMA RÉGUA, NO MESMO DIA — E O QUE ACONTECE QUANDO ELAS SE CRUZAM.
//
// Este arquivo existe por causa de uma junção: duas sessões mexeram na régua do titular em
// 26/09/2026, cada uma acrescentando uma porta diferente, e o merge obrigou a responder o que
// acontece quando as duas valem para a mesma pessoa. As duas frases do Lucas, do mesmo dia:
//   • *"pode deixar os coordenadores emitirem proposta sem a cad esta credenciada. ela pode estar em
//     validacao ou em qualquer outro estagio"* e, minutos depois, *"faz uma barra, para enviar para
//     contrato precisa da cad validada"* → o MODO DO COORDENADOR mais a BARRA DO CONTRATO;
//   • *"tem um cliente que é comprador, mas não está dando para ele comprar mais uma unidade [...]
//     temos que aproveitar esses cadastros de comprador"* → o COMPRADOR DA CARTEIRA.
//
// ⚠️ AS DUAS RÉGUAS SÃO EXERCITADAS DE VERDADE AQUI, não dubladas: `credenciadoParaVender` e
// `recusaDaCadParaContrato` rodam com um banco falso, e o hash é o `hashIdentifier` real. Um dublê
// não provaria nada sobre o cruzamento, que é justamente o que o merge pôs em risco.
//
// ⚠️ O CASO MAIS PERIGOSO É A CAD INDEFERIDA COM CONTRATO ATIVO: a pessoa foi REPROVADA no crédito e
// tem compra antiga na família. Ela não pode entrar pela carteira por cima de um indeferimento, e há
// um teste só para isso. MEDIDO em produção (`bxgukywoxgivlrhjkwjx`, só SELECT, 26/09/2026):
//   select etapa, origem, count(*) from apolo_esteira group by 1,2;
//     → 842 linhas no total e ZERO em `indeferido` hoje (credenciado 662 · revisao 173 · correcao 6
//       · validacao 1), e 1 linha com `origem = 'comprador_da_carteira'`, na etapa `credenciado`.
// Não há vítima hoje: a trava existe para o dia em que a coordenação reprovar alguém que já comprou.

const estado = vi.hoisted(() => ({
  cadastro: [] as Array<Record<string, unknown>>,
  contratos: [] as Array<Record<string, unknown>>,
  esteira: [] as Array<Record<string, unknown>>,
  fontes: [] as Array<Record<string, unknown>>,
  propostas: [] as Array<Record<string, unknown>>,
  unidades: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/lib/hercules/cadastro", () => ({
  carregarCadastroDeEmpreendimentos: async () => estado.cadastro,
}));

vi.mock("@/lib/apolo/catalogo-empreendimentos", () => ({
  catalogoDeEmpreendimentos: async () => [
    { id: "group:Vale do Ouro", stageIds: ["36", "37", "41"] },
    { id: "35", stageIds: ["35"] },
  ],
  GRUPOS_DO_CATALOGO: [
    { id: "group:Vale do Ouro", stageIds: ["36", "37", "41"] },
    { id: "35", stageIds: ["35"] },
  ],
}));

import { hashIdentifier } from "@/lib/apolo/server";

import {
  A_CARTEIRA_VALE_PARA_O_CONTRATO,
  recusaDaCadDaProposta,
  recusaDaCadParaContrato,
  recusaPelaCarteira,
} from "./cad-para-contrato";
import { credenciadoParaVender } from "./cliente-credenciado";
import { ORIGEM_COMPRADOR_DA_CARTEIRA } from "./origem-da-cad";

/**
 * O client falso, com FILTRO DE VERDADE e caminho com ponto.
 *
 * ⚠️ O PONTO NÃO É DETALHE: `lerContratosAtivos` filtra `in("unidade.enterprise_id", ids)` sobre o
 * embutido `unidade:hercules_unidades!inner(...)`, e é esse filtro que decide se o contrato da pessoa
 * está NA FAMÍLIA. Um fake que ignorasse o caminho com ponto deixaria passar o contrato do
 * empreendimento vizinho e este arquivo diria "a carteira funciona" sobre a régua errada.
 */
function valorDe(linha: Record<string, unknown>, coluna: string): unknown {
  return coluna
    .split(".")
    .reduce<unknown>(
      (atual, parte) =>
        atual && typeof atual === "object" ? (atual as Record<string, unknown>)[parte] : undefined,
      linha,
    );
}

function clienteFake() {
  const from = (tabela: string) => {
    const filtros: Array<(linha: Record<string, unknown>) => boolean> = [];
    const base = (): Array<Record<string, unknown>> => {
      if (tabela === "apolo_esteira") return estado.esteira;
      if (tabela === "apolo_entities") return [];
      if (tabela === "apolo_entity_identifiers") return estado.fontes;
      if (tabela === "hercules_propostas") return [...estado.contratos, ...estado.propostas];
      if (tabela === "hercules_unidades") return estado.unidades;
      if (tabela === "apolo_source_links") return [];
      if (tabela === "apolo_contacts") return [];
      return [];
    };
    const resultado = () => ({
      data: base().filter((l) => filtros.every((f) => f(l))),
      error: null,
    });
    const cadeia = {
      eq: (coluna: string, valor: unknown) => {
        filtros.push((l) => valorDe(l, coluna) === valor);
        return cadeia;
      },
      in: (coluna: string, valores: unknown[]) => {
        filtros.push((l) => valores.includes(valorDe(l, coluna)));
        return cadeia;
      },
      is: (coluna: string, valor: unknown) => {
        filtros.push((l) => valorDe(l, coluna) === valor);
        return cadeia;
      },
      limit: () => cadeia,
      maybeSingle: () => Promise.resolve({ data: resultado().data[0] ?? null, error: null }),
      order: () => cadeia,
      range: () => cadeia,
      select: () => cadeia,
      then: (ok: (r: ReturnType<typeof resultado>) => unknown) => Promise.resolve(resultado()).then(ok),
    };
    return cadeia;
  };
  return { from } as unknown as Parameters<typeof recusaDaCadParaContrato>[0];
}

const CPF = "52998224725";
const ENTIDADE = "ent-comprador";
/** A venda NOVA (a que está pedindo proposta ou contrato) mora no filho VOC. */
const VOC = "37";
/** A CAD do Vale do Ouro mora no PAI, e é o escopo expandido que a acha. */
const VLO = "35";

/** A família como está no cadastro do Panteon: a CAD no pai 35, a venda no filho 37. */
const FAMILIA_DO_VALE = [
  { c2xEnterpriseId: VLO, id: "vlo", paiId: null },
  { c2xEnterpriseId: "36", id: "vol", paiId: "vlo" },
  { c2xEnterpriseId: VOC, id: "voc", paiId: "vlo" },
  { c2xEnterpriseId: "41", id: "vor", paiId: "vlo" },
];

/** O modo do coordenador da Careli: a CAD em andamento abre a porta da PROPOSTA. */
const COORDENADOR = { cadEmAndamentoLibera: true };
/** O portal do Cecílio e a busca de proponentes: o default apertado. */
const APERTADO = {};

function cad(parcial: Record<string, unknown> = {}) {
  return {
    atualizado_em: "2026-09-26T12:00:00.000Z",
    chegou_em: null,
    created_at: "2026-09-01T12:00:00.000Z",
    enterprise_id: VLO,
    entity_id: ENTIDADE,
    etapa: "credenciado",
    origem: "asana",
    ...parcial,
  };
}

/** Um contrato FATURADO ativo numa unidade da família (o que faz a pessoa "comprador da carteira"). */
function contratoAtivo(parcial: Record<string, unknown> = {}) {
  return {
    cancelada_em: null,
    cancelamento_pedido_em: null,
    cliente_c2x_id: "7001",
    cliente_documento: "529.982.247-25",
    cliente_entity_id: null,
    cliente_nome: "COMPRADOR ANTIGO",
    codigo: "000728",
    compradores: [
      { c2x_user_id: "7001", documento: CPF, nome: "COMPRADOR ANTIGO", percentual: 100, titular: true },
    ],
    etapa: "faturado",
    etapa_desde: "2024-03-10T12:00:00.000Z",
    id: "prop-antiga",
    unidade: { codigo: "VLO0728", enterprise_id: VLO, id: "u-antiga" },
    // ⚠️ `workspace_id` NÃO É ENFEITE: `lerContratosAtivos` filtra `.eq("workspace_id", "careli")`,
    // e sem a coluna o fake devolve zero contratos e a carteira "não existe" calada.
    workspace_id: "careli",
    ...parcial,
  };
}

/** A proposta NOVA, a que a barra do contrato confere. */
// ⚠️ `unidade_id` SOLTO, E NÃO O EMBUTIDO: `recusaDaCadDaProposta` lê
// `select("cliente_documento, unidade_id")` e depois busca a unidade à parte, para o escopo sair da
// UNIDADE e não de `empreendimento_id` (a medição está no topo de `cad-para-contrato.ts`). Sem
// `workspace_id` a proposta não é achada, e a barra devolve `null` — verde por engano.
const PROPOSTA_NOVA = {
  cliente_documento: "529.982.247-25",
  etapa: "proposta",
  id: "prop-nova",
  unidade_id: "u-nova",
  workspace_id: "careli",
};

async function regua(modo: Record<string, unknown>) {
  return await credenciadoParaVender(
    clienteFake(),
    { documento: CPF, enterpriseIds: [VLO, "36", VOC, "41"] },
    modo,
  );
}

async function barra() {
  return await recusaDaCadParaContrato(clienteFake(), { documento: CPF, enterpriseId: VOC });
}

beforeEach(() => {
  estado.cadastro = FAMILIA_DO_VALE;
  estado.contratos = [];
  estado.esteira = [];
  estado.fontes = [{ entity_id: ENTIDADE, value_hash: hashIdentifier("cpf", CPF) }];
  estado.propostas = [];
  estado.unidades = [
    { enterprise_id: VOC, id: "u-nova", workspace_id: "careli" },
    { enterprise_id: VLO, id: "u-antiga", workspace_id: "careli" },
  ];
});

// ── 1. A CARTEIRA SEM CAD NENHUMA ────────────────────────────────────────────
describe("comprador da carteira SEM CAD nenhuma", () => {
  beforeEach(() => {
    estado.contratos = [contratoAtivo()];
  });

  it("passa a proposta pelas DUAS portas, e a resposta diz por qual", async () => {
    const decisao = await regua(COORDENADOR);

    expect(decisao.credenciado).toBe(true);
    expect(decisao.podeGerarProposta).toBe(true);
    expect(decisao.origem).toBe("comprador_da_carteira");
    // ⚠️ A COMPRA VEM PREENCHIDA, e é ela que manda o POST abrir a CAD (`cad-do-comprador.ts`).
    expect(decisao.compra?.codigo).toBe("000728");
    expect(decisao.compra?.entityIdDoContrato).toBe(ENTIDADE);
    // Sem CAD, não há data de CAD para mostrar: a do contrato antigo fica dentro de `compra`.
    expect(decisao.desde).toBeNull();
    expect(decisao.etapa).toBeNull();
  });

  it("⚠️ a carteira NÃO depende do modo: o portal do Cecílio também a enxerga", async () => {
    // O modo é sobre a ETAPA de uma CAD que existe. Aqui não há CAD, e a prova é o contrato — a
    // mesma para todo portal. Se a carteira passasse a depender do modo, o `cecilio-rocha` perderia
    // o comprador do próprio loteamento sem ninguém ter pedido isso.
    const decisao = await regua(APERTADO);

    expect(decisao.credenciado).toBe(true);
    expect(decisao.podeGerarProposta).toBe(true);
    expect(decisao.origem).toBe("comprador_da_carteira");
  });

  it("⚠️ E PASSA PELA BARRA DO CONTRATO — a resposta que a junção obrigou a dar", async () => {
    // A leitura que ficou valendo: a carteira SUBSTITUI a CAD (é o que o topo de
    // `cliente-credenciado.ts` declara), e a barra lê `credenciado`. Some-se a isso que a CAD desta
    // pessoa NASCE `credenciado` na gravação da proposta (`cad-do-comprador.ts`): recusar aqui daria
    // dois vereditos diferentes para o mesmo fato. ⚠️ PERGUNTA LEVADA AO LUCAS, não decidida aqui.
    //
    // ⚠️ E AQUI SE PROVA O COMPORTAMENTO, NÃO O VALOR DA CONSTANTE. A versão anterior deste teste era
    // `expect(A_CARTEIRA_VALE_PARA_O_CONTRATO).toBe(true)`, que CONGELA a decisão: inverter a
    // constante deixava a suíte vermelha neste ponto e o ramo da recusa nunca rodava em lugar nenhum.
    // O valor de hoje é conferido uma vez (é ele que a rota manda para a tela em `contratoExigeCad`), e
    // os dois lados da decisão são exercitados no describe 6.
    expect(A_CARTEIRA_VALE_PARA_O_CONTRATO).toBe(true);
    expect(await barra()).toBeNull();
  });

  it("o contrato do empreendimento VIZINHO não serve: a família é o alcance", async () => {
    // Lucas escolheu "Só no mesmo" (26/09/2026). O Garden (39) não é da família do Vale do Ouro.
    estado.contratos = [
      contratoAtivo({ id: "prop-garden", unidade: { codigo: "GDN0101", enterprise_id: "39", id: "u-gdn" } }),
    ];

    const decisao = await regua(COORDENADOR);

    expect(decisao.credenciado).toBe(false);
    expect(decisao.podeGerarProposta).toBe(false);
    expect(decisao.origem).toBeNull();
    expect(decisao.motivo).toBe("Este cliente não tem CAD neste empreendimento.");
  });
});

// ── 2. A CARTEIRA COM CAD EM ANDAMENTO ───────────────────────────────────────
//
// ⚠️ AQUI AS DUAS PORTAS SE ENCONTRAM, E A CAD GANHA. Ter contrato antigo não apaga a CAD que a
// coordenação está analisando agora: a compra só é lida no ramo "sem CAD nenhuma".
describe("comprador da carteira COM CAD em andamento", () => {
  beforeEach(() => {
    estado.contratos = [contratoAtivo()];
    estado.esteira = [cad({ etapa: "validacao" })];
  });

  it("a CAD decide, e a compra nem é lida", async () => {
    const decisao = await regua(COORDENADOR);

    // A porta da PROPOSTA abre, mas pelo MODO (a CAD em andamento), não pela carteira.
    expect(decisao.podeGerarProposta).toBe(true);
    expect(decisao.credenciado).toBe(false);
    expect(decisao.etapa).toBe("validacao");
    expect(decisao.origem).toBe("cad");
    // ⚠️ `compra` NULA é a prova de que a carteira não entrou: com ela preenchida, o POST abriria
    // uma segunda CAD credenciada em cima da que está em validação.
    expect(decisao.compra).toBeNull();
  });

  it("e a BARRA DO CONTRATO barra, com a etapa real da CAD", async () => {
    const recusa = await barra();

    expect(recusa?.status).toBe(409);
    expect(recusa?.etapa).toBe("validacao");
    expect(recusa?.erro).toContain("em validação de cadastro");
  });

  it("no portal do Cecílio a mesma CAD em andamento continua fechando a proposta", async () => {
    const decisao = await regua(APERTADO);

    expect(decisao.podeGerarProposta).toBe(false);
    expect(decisao.credenciado).toBe(false);
  });
});

// ── 3. O CASO PERIGOSO: CAD INDEFERIDA COM CONTRATO ATIVO ────────────────────
//
// ⚠️ A PESSOA FOI REPROVADA NO CRÉDITO E TEM COMPRA ANTIGA. As duas portas têm de dizer NÃO, e por
// razões diferentes: a carteira porque não é lida (existe CAD no escopo), o modo porque `indeferido`
// é a única etapa `false` do mapa. Se qualquer uma das duas cedesse, a proposta nasceria para quem a
// coordenação acabou de recusar.
describe("⚠️ CAD INDEFERIDA com contrato ativo na família", () => {
  beforeEach(() => {
    estado.contratos = [contratoAtivo()];
    estado.esteira = [cad({ etapa: "indeferido" })];
  });

  it("a proposta é barrada no modo do coordenador, e a compra não entra", async () => {
    const decisao = await regua(COORDENADOR);

    expect(decisao.podeGerarProposta).toBe(false);
    expect(decisao.credenciado).toBe(false);
    expect(decisao.etapa).toBe("indeferido");
    expect(decisao.compra).toBeNull();
    expect(decisao.origem).toBe("cad");
  });

  it("a barra do contrato também barra, com a frase própria do indeferimento", async () => {
    const recusa = await barra();

    expect(recusa?.status).toBe(409);
    expect(recusa?.etapa).toBe("indeferido");
    expect(recusa?.erro).toContain("indeferido");
  });

  it("⚠️ nem com a CAD indeferida num OUTRO empreendimento da família ela entra pela carteira", async () => {
    // A recusa é procurada no escopo INTEIRO (não na linha mais nova): indeferido no pai 35 mais uma
    // CAD em revisão no filho 37 continua sendo uma pessoa reprovada.
    estado.esteira = [
      cad({ atualizado_em: "2026-09-20T12:00:00.000Z", enterprise_id: VLO, etapa: "indeferido" }),
      cad({ atualizado_em: "2026-09-26T12:00:00.000Z", enterprise_id: VOC, etapa: "revisao" }),
    ];

    const decisao = await regua(COORDENADOR);

    expect(decisao.podeGerarProposta).toBe(false);
    expect(decisao.etapa).toBe("indeferido");
    expect(decisao.compra).toBeNull();
  });
});

// ── 4. A CAD QUE NASCEU DA CARTEIRA ──────────────────────────────────────────
describe("a CAD que NASCEU da carteira", () => {
  it("credenciada, ela diz 'comprador da carteira' sem a compra ser lida de novo", async () => {
    estado.esteira = [cad({ origem: ORIGEM_COMPRADOR_DA_CARTEIRA })];

    const decisao = await regua(COORDENADOR);

    expect(decisao.credenciado).toBe(true);
    expect(decisao.podeGerarProposta).toBe(true);
    expect(decisao.origem).toBe("comprador_da_carteira");
    // ⚠️ `compra` NULA: a CAD já existe, e nada precisa ser escrito outra vez.
    expect(decisao.compra).toBeNull();
  });

  it("e ela passa pela barra do contrato, como qualquer CAD credenciada", async () => {
    estado.esteira = [cad({ origem: ORIGEM_COMPRADOR_DA_CARTEIRA })];

    expect(await barra()).toBeNull();
  });

  it("⚠️ mexida no Board para `revisao`, a tela lê OS DOIS FATOS: a carteira E a CAD em andamento", async () => {
    // É o ramo que a junção acrescentou. Sem ele, `origem` voltava `"cad"` e a modal esquecia o
    // "Comprador da carteira" justamente quando ele é a única explicação para existir CAD sem
    // esteira. MEDIDO: zero linhas assim em produção hoje (26/09/2026).
    estado.esteira = [cad({ etapa: "revisao", origem: ORIGEM_COMPRADOR_DA_CARTEIRA })];

    const decisao = await regua(COORDENADOR);

    expect(decisao.origem).toBe("comprador_da_carteira");
    expect(decisao.credenciado).toBe(false);
    expect(decisao.podeGerarProposta).toBe(true);
    expect(decisao.etapa).toBe("revisao");
  });

  it("e nesse estado a barra do contrato barra: a carteira não dispensa a aprovação da CAD", async () => {
    estado.esteira = [cad({ etapa: "revisao", origem: ORIGEM_COMPRADOR_DA_CARTEIRA })];

    const recusa = await barra();

    expect(recusa?.status).toBe(409);
    expect(recusa?.etapa).toBe("revisao");
  });
});

// ── 5. QUEM A BARRA PEGA HOJE, PELO NOME ─────────────────────────────────────
//
// ⚠️ MEDIDO EM PRODUÇÃO (`bxgukywoxgivlrhjkwjx`, só SELECT, 26/09/2026), porque este número foi
// relatado ao Lucas e a porta da carteira podia tê-lo mudado:
//   as 2 propostas em etapa `proposta` SEM CAD nenhuma são CDJ0403 (ADALBERTO ANDRADE VILARINO,
//   empreendimento 22) e MDB1306 (JUSSARA SILVA DE ALVARENGA DUARTE, empreendimento 21), herdadas do
//   C2X em novembro de 2025. As duas têm ZERO contratos `faturado` ativos na própria família:
//     select count(*) from hercules_propostas fp join hercules_unidades fu on fu.id = fp.unidade_id
//      where fp.workspace_id='careli' and fp.etapa='faturado' and fp.cancelada_em is null
//        and fp.cancelamento_pedido_em is null and fu.enterprise_id = <22 ou 21>
//        and regexp_replace(coalesce(fp.cliente_documento,''),'\D','','g') = <o CPF>;  → 0 e 0
//   Logo: a porta da carteira NÃO as destrava, e as duas continuam barradas.
describe("⚠️ sem CAD e SEM contrato: as duas pessoas que a barra pega hoje", () => {
  it("continuam barradas nas duas portas, e a carteira não muda isso", async () => {
    // Nem CAD na esteira, nem contrato faturado na família: é o retrato do ADALBERTO e da JUSSARA.
    const decisao = await regua(COORDENADOR);

    expect(decisao.credenciado).toBe(false);
    expect(decisao.podeGerarProposta).toBe(false);
    expect(decisao.origem).toBeNull();
    expect(decisao.compra).toBeNull();

    const recusa = await barra();
    expect(recusa?.status).toBe(409);
    expect(recusa?.etapa).toBeNull();
    expect(recusa?.erro).toContain("não tem CAD neste empreendimento");
  });

  it("e a barra a partir da PROPOSTA (a porta da Têmis e do envio) diz o mesmo", async () => {
    estado.propostas = [PROPOSTA_NOVA];

    const recusa = await recusaDaCadDaProposta(clienteFake(), "prop-nova");

    expect(recusa?.status).toBe(409);
    expect(recusa?.erro).toContain("não tem CAD neste empreendimento");
  });
});

// ── 6. O BOTÃO DE INVERSÃO, EXERCITADO NOS DOIS VALORES ──────────────────────
//
// ⚠️ ESTE DESCRIBE EXISTE PORQUE A "UMA LINHA" PROMETIDA AO LUCAS PRECISA SER UMA LINHA DE VERDADE.
// `A_CARTEIRA_VALE_PARA_O_CONTRATO` é declarada `: boolean` justamente para o ramo da recusa não ser
// inalcançável, e a decisão foi extraída para `recusaPelaCarteira`, que é pura: aqui o valor entra
// como PARÂMETRO, e os dois lados rodam. Sem isto, trocar a constante ligaria em produção um caminho
// que nunca havia sido executado — nem a frase, nem a última oração de cada ato.
describe("⚠️ a inversão da carteira (A_CARTEIRA_VALE_PARA_O_CONTRATO)", () => {
  const daCarteira = { etapa: null, origem: "comprador_da_carteira" };
  /** A CAD que NASCEU da carteira e já está credenciada: `origem` é a mesma, e a recusa a alcança. */
  const cadDaCarteira = { etapa: "credenciado", origem: "comprador_da_carteira" };
  const daEsteira = { etapa: "revisao", origem: "cad" };

  it("com `true` (o que vale hoje) a barra não tem nada a dizer, nos dois casos da carteira", () => {
    expect(recusaPelaCarteira(daCarteira, "enviar_para_contrato", true)).toBeNull();
    expect(recusaPelaCarteira(cadDaCarteira, "mandar_para_assinatura", true)).toBeNull();
  });

  it("com `false` ela recusa com 409 e a frase da carteira, nos QUATRO atos", () => {
    const atos = [
      ["enviar_para_contrato", "envie para contrato depois"],
      ["gerar_contrato", "gere o contrato depois"],
      ["mandar_para_assinatura", "mande para assinatura depois"],
      ["marcar_atividade", "marque a atividade depois"],
    ] as const;

    for (const [ato, oQueFazerDepois] of atos) {
      const recusa = recusaPelaCarteira(daCarteira, ato, false);
      expect(recusa?.status).toBe(409);
      // A frase diz O QUE HOUVE (entrou como comprador da carteira, sem CAD analisada)...
      expect(recusa?.erro).toContain("comprador da carteira");
      expect(recusa?.erro).toContain("não por uma CAD analisada pela coordenação");
      // ...e O QUE FAZER, com a última oração do ato certo — a régua da casa.
      expect(recusa?.erro).toContain(oQueFazerDepois);
      expect(recusa?.etapa).toBeNull();
    }
  });

  it("⚠️ com `false` ela alcança TAMBÉM a CAD credenciada que nasceu da carteira", () => {
    // É o que o comentário da constante promete, e é o caso que ninguém descobriria sozinho: a CAD da
    // carteira é `credenciado` de verdade na esteira, então sem este ramo ela passaria pela barra pelo
    // `veredito.credenciado` e a inversão só valeria metade. A etapa real volta para o log e a tela.
    const recusa = recusaPelaCarteira(cadDaCarteira, "gerar_contrato", false);

    expect(recusa?.status).toBe(409);
    expect(recusa?.etapa).toBe("credenciado");
  });

  it("e ela NUNCA fala de quem veio pela esteira, com qualquer um dos dois valores", () => {
    // A recusa da CAD de verdade é a de `fraseDaRecusa`, com a etapa e o que cobrar da coordenação:
    // se este ramo se metesse aí, a administrativa leria "comprador da carteira" sobre alguém que tem
    // CAD em revisão e iria cobrar a pessoa errada.
    expect(recusaPelaCarteira(daEsteira, "enviar_para_contrato", false)).toBeNull();
    expect(recusaPelaCarteira(daEsteira, "enviar_para_contrato", true)).toBeNull();
  });
});

// ── 7. A BARRA OLHA TODOS OS COMPRADORES, NÃO SÓ O TITULAR ───────────────────
//
// ⚠️ É O BURACO QUE ESTA JUNÇÃO ABRIU, E ELE É EXATO. A busca de proponentes passou a receber o MODO
// DO COORDENADOR (`app/api/incorporador/venda/proponentes/route.ts:256`), então o cônjuge com a CAD em
// `revisao` virou ESCOLHÍVEL (a tela usa `podeGerarProposta`, `ModalDeProposta.tsx:1787`). Antes do
// merge ele precisava estar `credenciado` para ser escolhido, e por isso a barra do contrato podia
// olhar só `hercules_propostas.cliente_documento`. Depois do merge não pode: `montarSignatarios`
// percorre TODOS os `dados.compradores` (`lib/assinatura/signatarios.ts:71`) e cada um assina o
// contrato e responde pela dívida.
//
// ⚠️ MEDIDO ANTES DE ESCREVER (`bxgukywoxgivlrhjkwjx`, só SELECT, 26/09/2026): 28 co-compradores de
// propostas vivas estão sem CAD `credenciado` no escopo (27 em `assinatura`, 1 em `proposta`), e 28 de
// 28 estão em propostas cujo TITULAR já é barrado pela mesma barra. Zero vítimas novas hoje. Havia
// 173 CADs em `revisao` no mesmo dia: o caminho é usado.
describe("⚠️ a barra do contrato confere o CO-COMPRADOR", () => {
  const CPF_DO_CO = "39053344705";
  const ENTIDADE_DO_CO = "ent-co";

  /** A proposta do casal: o titular credenciado, a esposa como segunda compradora. */
  const PROPOSTA_DO_CASAL = {
    ...PROPOSTA_NOVA,
    compradores: [
      { cpf: "529.982.247-25", nome: "COMPRADOR TITULAR", participacao: 50, titular: true },
      { cpf: "390.533.447-05", nome: "ESPOSA DO TITULAR", participacao: 50, titular: false },
    ],
  };

  beforeEach(() => {
    estado.propostas = [PROPOSTA_DO_CASAL];
    estado.fontes = [
      { entity_id: ENTIDADE, value_hash: hashIdentifier("cpf", CPF) },
      { entity_id: ENTIDADE_DO_CO, value_hash: hashIdentifier("cpf", CPF_DO_CO) },
    ];
  });

  it("titular credenciado e co-comprador credenciada: passa", async () => {
    estado.esteira = [cad(), cad({ entity_id: ENTIDADE_DO_CO })];

    expect(await recusaDaCadDaProposta(clienteFake(), "prop-nova")).toBeNull();
  });

  it("⚠️ titular credenciado e CAD DA ESPOSA em revisão: RECUSA, e a frase diz o nome dela", async () => {
    // É o cenário da junção: a lista ofereceu a esposa porque `podeGerarProposta` é `true` no modo do
    // coordenador; a barra tem de fechar o contrato. E a frase precisa dizer QUEM barrou: com "a CAD
    // deste cliente" a administrativa abriria a ficha do titular, veria `credenciado`, e concluiria
    // que o sistema está com defeito.
    estado.esteira = [cad(), cad({ entity_id: ENTIDADE_DO_CO, etapa: "revisao" })];

    const recusa = await recusaDaCadDaProposta(clienteFake(), "prop-nova", "mandar_para_assinatura");

    expect(recusa?.status).toBe(409);
    expect(recusa?.etapa).toBe("revisao");
    expect(recusa?.erro).toContain("ESPOSA DO TITULAR");
    expect(recusa?.erro).toContain("co-comprador");
    expect(recusa?.erro).toContain("em revisão pela coordenação");
    expect(recusa?.erro).toContain("mande para assinatura depois");
  });

  it("o TITULAR vem primeiro: com os dois barrados, a frase é a dele, sem nome de co", async () => {
    estado.esteira = [
      cad({ etapa: "revisao" }),
      cad({ entity_id: ENTIDADE_DO_CO, etapa: "correcao" }),
    ];

    const recusa = await recusaDaCadDaProposta(clienteFake(), "prop-nova");

    expect(recusa?.etapa).toBe("revisao");
    expect(recusa?.erro).not.toContain("ESPOSA DO TITULAR");
  });

  it("⚠️ a esposa SEM CAD nenhuma entra pela carteira, pela mesma régua do titular", async () => {
    // A porta da carteira não é do titular: é da PESSOA. Quem já tem contrato ativo na família passa,
    // e é isso que faz o casal de compradores antigos não travar no contrato.
    estado.esteira = [cad()];
    estado.contratos = [
      contratoAtivo({
        cliente_c2x_id: "7002",
        cliente_documento: "390.533.447-05",
        compradores: [
          {
            c2x_user_id: "7002",
            documento: CPF_DO_CO,
            nome: "ESPOSA DO TITULAR",
            percentual: 100,
            titular: true,
          },
        ],
        id: "prop-antiga-da-esposa",
      }),
    ];

    expect(await recusaDaCadDaProposta(clienteFake(), "prop-nova")).toBeNull();
  });

  it("co-comprador com documento ilegível não inventa recusa (dado torto da carga do C2X)", async () => {
    // A régua de ENTRADA da proposta (`conferirProposta`) é quem cuida disso. Transformar dado torto
    // em parede aqui congelaria venda antiga sem ninguém ter medido nada.
    estado.esteira = [cad()];
    estado.propostas = [
      {
        ...PROPOSTA_NOVA,
        compradores: [
          { cpf: "529.982.247-25", nome: "COMPRADOR TITULAR", titular: true },
          { cpf: "", nome: "SEGUNDO SEM DOCUMENTO", titular: false },
        ],
      },
    ];

    expect(await recusaDaCadDaProposta(clienteFake(), "prop-nova")).toBeNull();
  });

  it("proposta com UM comprador só continua respondendo exatamente como antes", async () => {
    estado.esteira = [cad({ etapa: "revisao" })];
    estado.propostas = [PROPOSTA_NOVA];

    const recusa = await recusaDaCadDaProposta(clienteFake(), "prop-nova");

    expect(recusa?.status).toBe(409);
    expect(recusa?.erro).toContain("em revisão pela coordenação");
    // Sem co-comprador, nada de prefixo: a frase é a de sempre.
    expect(recusa?.erro).not.toContain("co-comprador");
  });
});
