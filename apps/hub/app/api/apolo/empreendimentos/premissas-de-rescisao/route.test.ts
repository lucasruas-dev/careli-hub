import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { conferirPremissa, RUBRICAS } from "@/lib/apolo/premissas-de-rescisao";

// A ROTA DAS PREMISSAS DE RESCISÃO, LIDA COMO TEXTO — e a régua dela, exercitada de verdade.
//
// ⚠️ LER O ARQUIVO É GROSSEIRO, E É DE PROPÓSITO. É o mesmo molde do teste da rota de bloqueio, e
// ele existe por um defeito pago: em 14/09/2026 uma rota filtrou por
// `workspace_id = "00000000-0000-0000-0000-000000000001"`. A coluna é TEXT com o valor `'careli'`,
// então a comparação não deu erro de tipo — casou zero linhas, em silêncio, e a rota respondeu 404
// em TODA chamada com a suíte inteira verde, porque nada tocava na constante. Importar a rota aqui
// exigiria subir o cliente do Supabase e a sessão do Hub: um teste que precisa de banco não roda no
// pre-commit, e o que não roda não protege.
//
// O que estas asserções cobrem é a classe de defeito que já aconteceu — constante trocada, gate
// apagado, `select` sem `where`, `upsert` sem conferir o que casou —, tudo visível no texto e tudo
// invisível para o typecheck. O resto do arquivo testa a régua de validação com os números REAIS do
// termo da LAVRA DO OURO (Quadra 06 — Lote 10, emitido em 25/06/2026).
const ROTA = readFileSync(join(__dirname, "route.ts"), "utf8");

describe("o workspace", () => {
  it("é a string `careli`", () => {
    expect(ROTA).toContain('const WORKSPACE = "careli"');
  });

  it("não é um uuid", () => {
    // O defeito exato de 14/09/2026: uuid contra coluna TEXT casa zero linhas sem erro de tipo.
    expect(ROTA).not.toMatch(/const WORKSPACE = "[0-9a-f]{8}-/);
  });

  it("filtra a leitura pelo workspace E pelos degraus do empreendimento", () => {
    // ⚠️ `.in`, E NÃO `.eq`. Até 15/09/2026 a leitura filtrava um empreendimento só, e com isso a
    // precedência filho → pai não tinha como acontecer: a premissa que mora no PAI voltava como
    // "não cadastrada", o operador copiava "por segurança" e a herança morria calada.
    expect(ROTA).toContain('.eq("workspace_id", WORKSPACE)');
    expect(ROTA).toContain('.in("enterprise_id", degraus)');
  });

  it("grava na tabela da migration 0166", () => {
    expect(ROTA).toContain('const TABELA = "hercules_premissas_de_rescisao"');
  });
});

describe("o gate de cada verbo", () => {
  it("é leitura no GET", () => {
    expect(ROTA).toContain("export async function GET");
    expect(ROTA).toContain("const auth = await authorizeApoloRead(request);");
  });

  it("é ESCRITA no PUT, e não a leitura", () => {
    // `viewer` lê o Apolo inteiro. Gravar alíquota que vai virar retenção no bolso do cliente não é
    // coisa de quem só visualiza.
    expect(ROTA).toContain("export async function PUT");
    expect(ROTA).toContain("const auth = await authorizeApoloWrite(request);");
  });

  it("aparece uma vez em cada verbo, e não sobra nem falta", () => {
    expect((ROTA.match(/authorizeApoloRead\(request\)/g) ?? []).length).toBe(1);
    expect((ROTA.match(/authorizeApoloWrite\(request\)/g) ?? []).length).toBe(1);
  });

  it("devolve a resposta do gate em vez de seguir", () => {
    expect((ROTA.match(/if \(!auth\.ok\) return auth\.response;/g) ?? []).length).toBe(2);
  });
});

describe("a validação", () => {
  it("é `conferirPremissa`, e não uma cópia dentro da rota", () => {
    // Duas réguas para a mesma regra: a que discordar do banco vira um 23514 na cara do operador.
    expect(ROTA).toContain("conferirPremissa({");
    expect(ROTA).not.toMatch(/percentual\s*>\s*100/);
    expect(ROTA).not.toMatch(/rubrica\s*!==\s*"fruicao"/);
  });

  it("recusa `ativa` que não seja booleano de verdade", () => {
    // `"false"` é truthy e `"true"` não é `=== true`: um dos dois caminhos desliga calada a rubrica
    // que o operador acabou de ligar.
    expect(ROTA).toContain('typeof recebida.ativa !== "boolean"');
  });

  it("barra a rubrica repetida antes de mandar o lote ao Postgres", () => {
    // O índice único é (workspace_id, enterprise_id, rubrica). Duas linhas da mesma rubrica no mesmo
    // upsert derrubam o comando inteiro com "cannot affect row a second time" — e as CINCO deixam de
    // salvar por causa de uma.
    expect(ROTA).toContain("rubricasVistas.has(rubrica)");
  });

  it("guarda três casas no percentual, que é o que a coluna numeric(6, 3) tem", () => {
    // Cortar na segunda casa faria o número mudar sozinho entre salvar e reabrir a tela.
    expect(ROTA).toContain("Math.round(numero * 1000) / 1000");
  });
});

describe("o erro diz QUAL rubrica errou", () => {
  it("compõe a chave do campo com a rubrica", () => {
    // Um 400 dizendo só "percentual inválido" numa tela de cinco linhas obriga a adivinhar.
    expect(ROTA).toContain("${chave}.${erro.campo}");
  });

  it("começa a frase pelo rótulo da rubrica", () => {
    expect(ROTA).toContain("${rotulo}: ${erro.mensagem}");
  });

  it("responde 422 com a frase curta E a lista de erros, igual à rota irmã da posse", () => {
    // ⚠️ O ENVELOPE É COMBINADO COM `app/api/apolo/posse`: são as duas escritas da MESMA tela de
    // rescisão. 422 é o molde da casa para corpo legível com conteúdo recusado (bloqueio, reserva,
    // proposta); e o `error` vai JUNTO da lista porque toda aba de empreendimento do Apolo lê
    // `corpo.error` e só ele — sem a frase curta, a tela imprime "Não foi possível salvar." tendo
    // as frases certas na mão.
    expect(ROTA).toContain('{ error: "Confira as premissas antes de salvar.", erros }');
    expect(ROTA).toContain("{ status: 422 }");
  });

  it("nomeia a linha pela posição quando a rubrica é desconhecida", () => {
    // Sem isto, uma rubrica inventada pela tela produziria um erro sem dono.
    expect(ROTA).toContain("`linha${indice + 1}`");
    expect(ROTA).toContain("`Linha ${indice + 1}`");
  });
});

describe("a gravação", () => {
  it("é um upsert só, pela chave única das três colunas", () => {
    expect(ROTA).toContain('onConflict: "workspace_id,enterprise_id,rubrica"');
  });

  it("confere quantas linhas casaram", () => {
    // `.upsert()` sem `.select()` devolve sucesso sem dizer quantas gravou, e a tela diria "salvo"
    // para uma gravação que não aconteceu.
    expect(ROTA).toContain('.select("rubrica")');
    expect(ROTA).toContain("rubricasGravadas.length !== linhas.length");
  });

  it("carimba o autor com id e nome", () => {
    // O nome vai gravado para NÃO ser resolvido por join depois: a pessoa sai da empresa e o
    // histórico tem de continuar dizendo quem mexeu naquele dia.
    expect(ROTA).toContain("atualizado_por: auth.userId");
    expect(ROTA).toContain("atualizado_por_nome: auth.nome");
    expect(ROTA).toContain("atualizado_em: agora");
  });

  it("lê de volta as colunas que a tela mostra, INCLUSIVE o dono da linha", () => {
    // ⚠️ `enterprise_id` NA LISTA É O QUE FAZ A HERANÇA EXISTIR: é por ele que `itensDoMenorRecorte`
    // sabe se a linha é deste empreendimento ou do pai. Sem a coluna, toda linha chega sem dono e a
    // régua não casa degrau nenhum.
    expect(ROTA).toContain(
      '"rubrica,ativa,percentual,base,periodicidade,clausula,enterprise_id,atualizado_em,atualizado_por_nome"',
    );
  });

  it("nunca apaga linha", () => {
    // "Desligada continua cadastrada": a cláusula colada no campo explica por que aquele
    // empreendimento não cobra a rubrica, e isso vale mais do que a linha removida.
    expect(ROTA).not.toContain(".delete()");
  });

  it("usa a régua canônica de tabela ausente, e não uma cópia com os códigos à mão", () => {
    // ⚠️ A CÓPIA QUE ESTAVA AQUI ERA PIOR QUE O ORIGINAL, e não igual: ela testava
    // `/does not exist|schema cache/i`, e o PGRST204 de COLUNA ausente diz "Could not find the 'x'
    // column of 'y' in the schema cache" — casa com "schema cache". Uma 0166 aplicada de um rascunho
    // velho (sem `atualizado_por_nome`, que o PUT grava) responderia "migration 0166 pendente" para
    // uma tabela que JÁ EXISTE. `ehTabelaAusente` exige o nome da TABELA e recusa mensagem de coluna.
    expect(ROTA).toContain('import { ehTabelaAusente } from "@/lib/temis/tabela-ausente"');
    expect(ROTA).toContain("ehTabelaAusente(error, TABELA)");
    expect(ROTA).not.toMatch(/schema cache\|/);
    expect(ROTA).not.toMatch(/erro\.code === "42P01"/);
  });

  it("trata a recusa do CHECK como erro do corpo, não do servidor", () => {
    expect(ROTA).toContain('error.code === "23514"');
  });
});

describe("as cinco rubricas se salvam juntas", () => {
  it("não repete a trava de `um campo por vez` da Política Comercial", () => {
    // Lá cada linha é uma decisão independente; aqui as cinco compõem o MESMO número do papel.
    expect(ROTA).not.toContain("Salve um campo por vez");
  });

  it("explica no cabeçalho por que diverge da aba irmã", () => {
    expect(ROTA).toContain("AS CINCO SE SALVAM JUNTAS");
    expect(ROTA).toContain("um campo por vez");
  });

  it("monta o formulário a partir de RUBRICAS, sem lista própria de rubricas", () => {
    expect(ROTA).toContain("RUBRICAS.map((rubrica)");
    expect(ROTA).not.toMatch(/\["clausula_penal",\s*"publicidade"/);
  });

  it("devolve as cadastradas aqui, as HERDADAS do pai e as que faltam", () => {
    // A tela precisa desenhar as cinco, inclusive as que ninguém cadastrou: são justamente essas
    // que o termo calcularia pela praxe sem ninguém ter conferido. E "faltando" tem de significar
    // "ninguém decidiu" — rubrica herdada do pai TEM decisão.
    expect(ROTA).toContain('cadastrada: origem === "filho"');
    expect(ROTA).toContain('herdada: origem === "pai"');
    expect(ROTA).toContain("faltando:");
    expect(ROTA).toContain("herdadas:");
  });

  it("decide o degrau com a régua da casa, e não com uma sexta cópia da precedência", () => {
    // Categoria → filho → pai é a MESMA régua de planos, faixas e comissão. Seis implementações
    // dela já discordaram entre si; uma sétima faria a mesma tela obedecer a duas leis.
    expect(ROTA).toContain("itensDoMenorRecorte(recorte, daRubrica)");
    expect(ROTA).toContain("comoSeHerdou(origem)");
    expect(ROTA).toContain("premissasDoRecorte(recorte, linhas)");
  });

  it("são cinco, e a fruição está entre elas", () => {
    expect(RUBRICAS).toHaveLength(5);
    expect(RUBRICAS.map((r) => r.valor)).toContain("fruicao");
  });
});

describe("a régua que a rota chama, com os números da Lavra do Ouro", () => {
  // O termo de 25/06/2026 (Quadra 06 — Lote 10): comissão 6,50%, multa penal 10%, publicidade 4%,
  // tributos 5,93%. A fruição de 0,75%/mês é a praxe sobre a Lei 13.786/18.
  const CADASTRO_DA_LAVRA = [
    { ativa: true, base: "valor_de_tabela_menos_comissao", percentual: 10, rubrica: "clausula_penal" },
    { ativa: true, base: "valor_de_tabela_menos_comissao", percentual: 4, rubrica: "publicidade" },
    { ativa: true, base: "valor_de_tabela", percentual: 6.5, rubrica: "corretagem" },
    { ativa: true, base: "total_pago", percentual: 5.93, rubrica: "tributos" },
  ];

  it("aceita as quatro rubricas do termo real", () => {
    for (const premissa of CADASTRO_DA_LAVRA) {
      expect(conferirPremissa({ ...premissa, periodicidade: "unica" })).toEqual([]);
    }
  });

  it("aceita a fruição de 0,75% ao mês", () => {
    expect(
      conferirPremissa({
        ativa: true,
        base: "valor_do_contrato_atualizado",
        percentual: 0.75,
        periodicidade: "mensal",
        rubrica: "fruicao",
      }),
    ).toEqual([]);
  });

  it("aceita a corretagem em reais, sem percentual", () => {
    // `valor_efetivo` é a exceção prevista pela própria migration: a comissão saiu do caixa lá atrás.
    expect(
      conferirPremissa({
        ativa: true,
        base: "valor_efetivo",
        percentual: null,
        periodicidade: "unica",
        rubrica: "corretagem",
      }),
    ).toEqual([]);
  });

  it("recusa `mensal` fora da fruição, apontando a periodicidade", () => {
    // Uma publicidade "4% ao mês" multiplicaria a dedução pelo número de meses do contrato.
    const erros = conferirPremissa({
      ativa: true,
      base: "valor_de_tabela_menos_comissao",
      percentual: 4,
      periodicidade: "mensal",
      rubrica: "publicidade",
    });

    expect(erros.map((e) => e.campo)).toContain("periodicidade");
  });

  it("recusa base que não se aplica à rubrica", () => {
    // Tributos incidem sobre o que a empresa recebeu, não sobre o valor do imóvel.
    const erros = conferirPremissa({
      ativa: true,
      base: "valor_de_tabela_menos_comissao",
      percentual: 5.93,
      periodicidade: "unica",
      rubrica: "tributos",
    });

    expect(erros.map((e) => e.campo)).toContain("base");
  });

  it("recusa rubrica ligada sem percentual", () => {
    const erros = conferirPremissa({
      ativa: true,
      base: "valor_de_tabela_menos_comissao",
      percentual: null,
      periodicidade: "unica",
      rubrica: "clausula_penal",
    });

    expect(erros.map((e) => e.campo)).toContain("percentual");
  });

  it("dá à tela um rótulo e ao menos uma base para cada rubrica", () => {
    // É com estas duas peças que a rota compõe a frase do erro: sem rótulo, a mensagem sairia com o
    // nome interno da coluna ("clausula_penal: ...") na frente do operador.
    for (const rubrica of RUBRICAS) {
      expect(rubrica.rotulo.trim().length).toBeGreaterThan(0);
      expect(rubrica.bases.length).toBeGreaterThan(0);
    }
  });

  it("a frase do erro nomeia a rubrica, do jeito que a rota a monta", () => {
    const publicidade = RUBRICAS.find((r) => r.valor === "publicidade");
    const erro = conferirPremissa({
      ativa: true,
      base: "valor_de_tabela_menos_comissao",
      percentual: 4,
      periodicidade: "mensal",
      rubrica: "publicidade",
    })[0];

    expect(publicidade).toBeDefined();
    expect(erro).toBeDefined();
    expect(`${publicidade?.rotulo}: ${erro?.mensagem}`).toContain("Publicidade: ");
  });
});

// ───────────────────────────────────────────────────────────────────────────────────────────────
// O COMPORTAMENTO, COM O SUPABASE MOCKADO.
//
// ⚠️ ESTE BLOCO FOI ACRESCENTADO NA REVISÃO DE 15/09/2026, E O MOTIVO É O DEFEITO QUE ELE EVITA.
// Até aqui o arquivo tinha 36 testes verdes e NENHUM deles importava a rota: 27 liam `route.ts`
// como texto e 9 exercitavam `conferirPremissa`, que já tem suíte própria com 45 testes em
// `lib/apolo/premissas-de-rescisao.test.ts`. Ou seja, `GET` e `PUT` nunca rodavam. Um `await`
// esquecido, um corpo montado errado, um 503 que devolvesse as cinco rubricas vazias — nada disso
// apareceria, porque `toContain` sobre o código-fonte prova que a LINHA existe, não que ela FAZ o
// que promete. Ler o arquivo continua valendo para a constante e para o portão (é a classe de
// defeito de 14/09/2026, invisível ao typecheck); o que faltava era exercitar a rota de verdade.
const ENTERPRISE = "31";

const estado = vi.hoisted(() => ({
  autorizado: true,
  /** `hercules_empreendimentos`: é daqui que a rota tira o parentesco. */
  cadastro: [] as Array<Record<string, unknown>>,
  erroDaLeitura: null as null | { code?: string; message: string },
  erroDoCadastro: null as null | { code?: string; message: string },
  erroDoUpsert: null as null | { code?: string; message: string },
  gravadas: [] as Array<Record<string, unknown>>,
  linhas: [] as Array<Record<string, unknown>>,
  /** Força a divergência entre o que foi mandado e o que o banco diz ter casado. */
  rubricasQueCasam: null as null | string[],
  semCliente: false,
  usuarioId: "3f7a2c18-9d4b-4f2a-8a11-0c5e6b7d8e90",
  usuarioNome: "Cinthia" as null | string,
}));

vi.mock("@/lib/apolo/auth", () => {
  const autorizar = async () =>
    estado.autorizado
      ? { nome: estado.usuarioNome, ok: true, userId: estado.usuarioId }
      : {
          ok: false,
          response: Response.json({ error: "Usuario sem acesso ao Apolo." }, { status: 403 }),
        };
  return { authorizeApoloRead: autorizar, authorizeApoloWrite: autorizar };
});

vi.mock("@/lib/apolo/server", () => {
  type Ctx = {
    filtros: Record<string, unknown>;
    tabela: string;
    tipo: "select" | "upsert";
    valores: Array<Record<string, unknown>>;
  };

  // ⚠️ O MOCK HONRA OS FILTROS DE PROPÓSITO. É isso que faz a troca de `WORKSPACE` por um uuid
  // derrubar teste de COMPORTAMENTO, e não só a asserção de texto: sem casar `workspace_id`, a
  // linha cadastrada some da leitura exatamente como sumiria em produção.
  //
  // ⚠️ E ELE HONRA O `.in()` COMO LISTA (15/09/2026). A leitura das premissas passou a trazer os
  // DOIS degraus — este empreendimento e o pai —, e um mock que ignorasse a lista deixaria passar
  // justamente o defeito oposto: uma rota que devolvesse a premissa de um empreendimento qualquer.
  const casa = (linha: Record<string, unknown>, filtros: Record<string, unknown>) =>
    Object.entries(filtros).every(([coluna, valor]) =>
      Array.isArray(valor)
        ? valor.includes(linha[coluna] ?? null)
        : (linha[coluna] ?? null) === valor,
    );

  const resolver = (
    ctx: Ctx,
  ): { data: unknown; error: null | { code?: string; message: string } } => {
    // O mock é CIENTE DA TABELA porque a rota agora lê duas: as premissas e o cadastro de
    // empreendimentos, de onde sai o parentesco. Um mock que respondesse a mesma lista para as duas
    // faria o teste da herança provar nada.
    if (ctx.tabela === "hercules_empreendimentos") {
      if (estado.erroDoCadastro) return { data: null, error: estado.erroDoCadastro };
      return { data: estado.cadastro.filter((linha) => casa(linha, ctx.filtros)), error: null };
    }
    if (ctx.tipo === "upsert") {
      if (estado.erroDoUpsert) return { data: null, error: estado.erroDoUpsert };
      estado.gravadas = ctx.valores;
      const casadas = estado.rubricasQueCasam ?? ctx.valores.map((linha) => String(linha.rubrica));
      return { data: casadas.map((rubrica) => ({ rubrica })), error: null };
    }
    if (estado.erroDaLeitura) return { data: null, error: estado.erroDaLeitura };
    return { data: estado.linhas.filter((linha) => casa(linha, ctx.filtros)), error: null };
  };

  const construir = (tabela: string) => {
    const ctx: Ctx = { filtros: {}, tabela, tipo: "select", valores: [] };
    const api = {
      eq: (coluna: string, valor: unknown) => {
        ctx.filtros[coluna] = valor;
        return api;
      },
      in: (coluna: string, valores: unknown[]) => {
        ctx.filtros[coluna] = valores;
        return api;
      },
      select: () => api,
      then: (aceitar: (v: unknown) => unknown, recusar?: (e: unknown) => unknown) =>
        Promise.resolve(resolver(ctx)).then(aceitar, recusar),
      upsert: (valores: Array<Record<string, unknown>>) => {
        ctx.tipo = "upsert";
        ctx.valores = valores;
        return api;
      },
    };
    return api;
  };

  return {
    createApoloAdminClient: () =>
      estado.semCliente ? null : { from: (tabela: string) => construir(tabela) },
  };
});

import { GET, PUT } from "@/app/api/apolo/empreendimentos/premissas-de-rescisao/route";

type PremissaNaResposta = {
  ativa: boolean;
  atualizadoPorNome: null | string;
  base: null | string;
  basesPermitidas: Array<{ rotulo: string; valor: string }>;
  cadastrada: boolean;
  clausula: null | string;
  herdada: boolean;
  herdadaDe: null | string;
  origem: null | string;
  origemFrase: string;
  percentual: null | number;
  periodicidade: string;
  rubrica: string;
  valeNoTermo: boolean;
};

type Resposta = {
  data?: {
    cadastradas?: string[];
    faltando?: string[];
    gravadas?: string[];
    herdadas?: string[];
    naoEnviadas?: string[];
    paiEnterpriseId?: null | string;
    premissas?: PremissaNaResposta[];
  };
  erros?: Array<{ campo: string; mensagem: string }>;
  error?: string;
};

const pedirGet = (query = `?enterprise=${ENTERPRISE}`) =>
  GET(new Request(`https://x/api/apolo/empreendimentos/premissas-de-rescisao${query}`));

const pedirPut = (corpo: unknown) =>
  PUT(
    new Request("https://x/api/apolo/empreendimentos/premissas-de-rescisao", {
      body: JSON.stringify(corpo),
      method: "PUT",
    }),
  );

/** O cadastro da Lavra do Ouro como a tela mandaria: as cinco rubricas, de uma vez. */
const CINCO_DA_LAVRA = [
  {
    ativa: true,
    base: "valor_de_tabela_menos_comissao",
    percentual: 10,
    periodicidade: "unica",
    rubrica: "clausula_penal",
  },
  {
    ativa: true,
    base: "valor_de_tabela_menos_comissao",
    percentual: 4,
    periodicidade: "unica",
    rubrica: "publicidade",
  },
  {
    ativa: true,
    base: "valor_de_tabela",
    percentual: 6.5,
    periodicidade: "unica",
    rubrica: "corretagem",
  },
  {
    ativa: true,
    base: "total_pago",
    percentual: 5.93,
    periodicidade: "unica",
    rubrica: "tributos",
  },
  {
    ativa: true,
    base: "valor_do_contrato_atualizado",
    percentual: 0.75,
    periodicidade: "mensal",
    rubrica: "fruicao",
  },
];

// O CADASTRO DO PANTEON, recortado: o Lagoa Bonita (31) é PAI do LBF (33). É a família real, medida
// em 15/09/2026 — 400 lotes no próprio pai, 39 no LBF — e é ela que faz a herança ter o que provar.
/** O 31 dos testes acima É o Lagoa Bonita: aqui ele ganha o filho que herda dele. */
const PAI = ENTERPRISE;
const FILHO = "33";
const CADASTRO_LAGOA_BONITA = [
  { c2x_enterprise_id: PAI, id: "uuid-lab", pai_id: null, workspace_id: "careli" },
  { c2x_enterprise_id: FILHO, id: "uuid-lbf", pai_id: "uuid-lab", workspace_id: "careli" },
];

/** A cláusula penal cadastrada NO PAI — a rubrica mais pesada do termo. */
const PENAL_DO_PAI = {
  ativa: true,
  atualizado_em: "2026-09-10T12:00:00.000Z",
  atualizado_por_nome: "Northon",
  base: "valor_de_tabela_menos_comissao",
  clausula: "Clausula 12.1 do contrato padrao",
  enterprise_id: PAI,
  percentual: 10,
  periodicidade: "unica",
  rubrica: "clausula_penal",
  workspace_id: "careli",
};

beforeEach(() => {
  estado.autorizado = true;
  estado.cadastro = [];
  estado.erroDaLeitura = null;
  estado.erroDoCadastro = null;
  estado.erroDoUpsert = null;
  estado.gravadas = [];
  estado.linhas = [];
  estado.rubricasQueCasam = null;
  estado.semCliente = false;
  estado.usuarioNome = "Cinthia";
});

describe("o GET desenha o formulario inteiro", () => {
  it("devolve as cinco rubricas mesmo com a tabela vazia, e diz que faltam as cinco", async () => {
    const resposta = await pedirGet();
    const corpo = (await resposta.json()) as Resposta;

    expect(resposta.status).toBe(200);
    expect(corpo.data?.premissas).toHaveLength(5);
    expect(corpo.data?.faltando).toHaveLength(5);
    expect(corpo.data?.cadastradas).toEqual([]);
    expect(corpo.data?.premissas?.every((p) => p.cadastrada === false)).toBe(true);
  });

  it("sugere `mensal` so para a fruicao", async () => {
    // Sugerir "unica" para a fruicao faria o banco ACEITAR uma deducao de uma vez so que o termo
    // imprimiria errado: a fruicao e cobrada por mes de ocupacao.
    const corpo = (await (await pedirGet()).json()) as Resposta;
    const porRubrica = new Map(corpo.data?.premissas?.map((p) => [p.rubrica, p]) ?? []);

    expect(porRubrica.get("fruicao")?.periodicidade).toBe("mensal");
    expect(porRubrica.get("clausula_penal")?.periodicidade).toBe("unica");
  });

  it("casa a linha gravada e converte o `numeric` que volta como TEXTO", async () => {
    // ⚠️ PostgREST devolve `numeric` como string. Um `percentual: "4.000"` chegando cru a tela
    // viraria "4.000" num input numerico, e a comparacao com 4 falharia calada.
    estado.linhas = [
      {
        ativa: true,
        atualizado_em: "2026-09-15T12:00:00.000Z",
        atualizado_por_nome: "Northon",
        base: "valor_de_tabela_menos_comissao",
        clausula: "Clausula 7.2",
        enterprise_id: ENTERPRISE,
        percentual: "4.000",
        periodicidade: "unica",
        rubrica: "publicidade",
        workspace_id: "careli",
      },
    ];

    const corpo = (await (await pedirGet()).json()) as Resposta;
    const publicidade = corpo.data?.premissas?.find((p) => p.rubrica === "publicidade");

    expect(publicidade?.cadastrada).toBe(true);
    expect(publicidade?.percentual).toBe(4);
    expect(corpo.data?.cadastradas).toEqual(["publicidade"]);
    expect(corpo.data?.faltando).toHaveLength(4);
  });

  it("nao enxerga a linha de OUTRO empreendimento", async () => {
    estado.linhas = [
      {
        ativa: true,
        base: "total_pago",
        enterprise_id: "32",
        percentual: 5.93,
        rubrica: "tributos",
        workspace_id: "careli",
      },
    ];

    const corpo = (await (await pedirGet()).json()) as Resposta;
    expect(corpo.data?.cadastradas).toEqual([]);
  });

  it("percentual ZERO cadastrado nao vira `nao cadastrado`", async () => {
    // A 0166 distingue os dois no CHECK: 0% e uma decisao ("esta rubrica existe e e zero"), `null`
    // e a ausencia de decisao. Um `Number(v) || null` colapsaria as duas.
    estado.linhas = [
      {
        ativa: true,
        base: "valor_de_tabela_menos_comissao",
        enterprise_id: ENTERPRISE,
        percentual: 0,
        periodicidade: "unica",
        rubrica: "publicidade",
        workspace_id: "careli",
      },
    ];

    const publicidade = ((await (await pedirGet()).json()) as Resposta).data?.premissas?.find(
      (p) => p.rubrica === "publicidade",
    );

    expect(publicidade?.percentual).toBe(0);
    expect(publicidade?.cadastrada).toBe(true);
  });

  it("falha de leitura vira 503, e NUNCA as cinco rubricas vazias", async () => {
    // ⚠️ O defeito que este teste tranca: responder 200 com as cinco em branco depois de um timeout
    // faria a tela AFIRMAR que o empreendimento nao tem premissa, e o operador estaria a um clique
    // de gravar esse vazio por cima do cadastro real.
    estado.erroDaLeitura = { code: "57014", message: "canceling statement due to timeout" };

    const resposta = await pedirGet();
    const corpo = (await resposta.json()) as Resposta;

    expect(resposta.status).toBe(503);
    expect(corpo.data).toBeUndefined();
  });

  it("tabela ausente diz que a migration 0166 esta pendente", async () => {
    estado.erroDaLeitura = {
      code: "42P01",
      message: 'relation "hercules_premissas_de_rescisao" does not exist',
    };

    const resposta = await pedirGet();
    expect(resposta.status).toBe(503);
    expect(((await resposta.json()) as Resposta).error).toContain("0166");
  });

  it("COLUNA ausente NAO vira `migration 0166 pendente`", async () => {
    // ⚠️ ESTE E O TESTE QUE A COPIA CASEIRA NAO PASSAVA. Ela testava `/does not exist|schema cache/i`
    // e o PGRST204 de coluna ausente diz "Could not find the 'x' column of 'y' in the schema cache":
    // uma 0166 aplicada de um rascunho velho (sem `atualizado_por_nome`, que o PUT grava) mandaria o
    // operador esperar uma migration que JA FOI aplicada, e ninguem procuraria a coluna que falta.
    estado.erroDaLeitura = {
      code: "PGRST204",
      message:
        "Could not find the 'enterprise_id' column of 'hercules_premissas_de_rescisao' in the schema cache",
    };

    const resposta = await pedirGet();
    const corpo = (await resposta.json()) as Resposta;

    expect(resposta.status).toBe(503);
    expect(corpo.error).not.toContain("0166");
    expect(corpo.data).toBeUndefined();
  });

  it("sem empreendimento e 400", async () => {
    expect((await pedirGet("")).status).toBe(400);
  });

  it("sem cliente do Supabase e 503, e nao estouro", async () => {
    estado.semCliente = true;
    expect((await pedirGet()).status).toBe(503);
  });

  it("o portao fechado devolve 403 antes de olhar o banco", async () => {
    estado.autorizado = false;
    expect((await pedirGet()).status).toBe(403);
  });
});

// ───────────────────────────────────────────────────────────────────────────────────────────────
// A HERANCA FILHO -> PAI, QUE ATE 15/09/2026 NAO EXISTIA NESTA ROTA.
//
// ⚠️ O DEFEITO ERA DE DESENHO, e ele nao aparecia em nenhum dos 64 testes anteriores: a leitura
// filtrava `.eq("enterprise_id", ...)` e nem trazia a coluna `enterprise_id`, entao a premissa que
// mora no PAI voltava como "nao cadastrada". A aba dizia "nao cadastrado" para o filho, o operador
// cadastrava "por seguranca", e a heranca morria calada — mudar o pai deixava de alcancar quem
// copiou. `LinhaDePremissa` sempre exigiu `enterpriseId`, e `itensDoMenorRecorte` sempre decidiu o
// degrau por ele; o que faltava era a rota trazer o campo e os dois degraus.
describe("o GET enxerga a heranca do empreendimento pai", () => {
  it("devolve a rubrica do PAI como herdada, com a origem, e NAO como faltando", async () => {
    estado.cadastro = CADASTRO_LAGOA_BONITA;
    estado.linhas = [PENAL_DO_PAI];

    const corpo = (await (await pedirGet(`?enterprise=${FILHO}`)).json()) as Resposta;
    const penal = corpo.data?.premissas?.find((p) => p.rubrica === "clausula_penal");

    expect(penal?.herdada).toBe(true);
    expect(penal?.cadastrada).toBe(false);
    expect(penal?.origem).toBe("pai");
    expect(penal?.herdadaDe).toBe(PAI);
    expect(penal?.percentual).toBe(10);
    expect(penal?.base).toBe("valor_de_tabela_menos_comissao");
    expect(penal?.clausula).toBe("Clausula 12.1 do contrato padrao");
    expect(penal?.atualizadoPorNome).toBe("Northon");
    expect(penal?.valeNoTermo).toBe(true);
    // A frase e a da casa (`comoSeHerdou`), escrita uma vez so.
    expect(penal?.origemFrase).toBe("herdado do empreendimento principal");
    expect(corpo.data?.herdadas).toEqual(["clausula_penal"]);
    expect(corpo.data?.faltando).not.toContain("clausula_penal");
    expect(corpo.data?.faltando).toHaveLength(4);
    expect(corpo.data?.cadastradas).toEqual([]);
    expect(corpo.data?.paiEnterpriseId).toBe(PAI);
  });

  it("a linha do FILHO ganha da do pai, inclusive quando ela DESLIGA a rubrica", async () => {
    // ⚠️ E AQUI A ORDEM IMPORTA: `ativa` e olhada DEPOIS da regua, nunca antes. Filtrando antes, o
    // filho que desliga a multa penal (com a clausula explicando por que nao cobra) ficaria sem
    // linha nenhuma, a regua subiria para o pai e o termo deduziria 10% de um cliente cujo
    // empreendimento decidiu nao cobrar.
    estado.cadastro = CADASTRO_LAGOA_BONITA;
    estado.linhas = [
      PENAL_DO_PAI,
      {
        ativa: false,
        atualizado_em: "2026-09-15T09:00:00.000Z",
        atualizado_por_nome: "Cinthia",
        base: "valor_de_tabela_menos_comissao",
        clausula: "O LBF nao cobra multa penal.",
        enterprise_id: FILHO,
        percentual: null,
        periodicidade: "unica",
        rubrica: "clausula_penal",
        workspace_id: "careli",
      },
    ];

    const corpo = (await (await pedirGet(`?enterprise=${FILHO}`)).json()) as Resposta;
    const penal = corpo.data?.premissas?.find((p) => p.rubrica === "clausula_penal");

    expect(penal?.cadastrada).toBe(true);
    expect(penal?.herdada).toBe(false);
    expect(penal?.origem).toBe("filho");
    expect(penal?.ativa).toBe(false);
    expect(penal?.percentual).toBeNull();
    expect(penal?.clausula).toBe("O LBF nao cobra multa penal.");
    // Desligada continua CADASTRADA — e nao entra na conta do termo. Sao duas respostas diferentes,
    // e a tela precisa das duas.
    expect(penal?.valeNoTermo).toBe(false);
    expect(corpo.data?.herdadas).toEqual([]);
  });

  it("o PAI nao enxerga a premissa do filho", async () => {
    // A heranca sobe, nunca desce: o pai que lesse a linha do filho mostraria no formulario um
    // numero que so vale para uma das glebas.
    estado.cadastro = CADASTRO_LAGOA_BONITA;
    estado.linhas = [
      {
        ativa: true,
        base: "total_pago",
        enterprise_id: FILHO,
        percentual: 5.93,
        periodicidade: "unica",
        rubrica: "tributos",
        workspace_id: "careli",
      },
    ];

    const corpo = (await (await pedirGet(`?enterprise=${PAI}`)).json()) as Resposta;

    expect(corpo.data?.cadastradas).toEqual([]);
    expect(corpo.data?.herdadas).toEqual([]);
    expect(corpo.data?.faltando).toHaveLength(5);
    expect(corpo.data?.paiEnterpriseId).toBeNull();
  });

  it("empreendimento sem pai no cadastro nao herda de ninguem", async () => {
    estado.cadastro = [
      { c2x_enterprise_id: FILHO, id: "uuid-lbf", pai_id: null, workspace_id: "careli" },
    ];
    estado.linhas = [PENAL_DO_PAI];

    const corpo = (await (await pedirGet(`?enterprise=${FILHO}`)).json()) as Resposta;

    expect(corpo.data?.paiEnterpriseId).toBeNull();
    expect(corpo.data?.faltando).toHaveLength(5);
  });

  it("pai que so existe no Panteon (sem id do C2X) nao inventa heranca", async () => {
    // O LOX da Lavra do Ouro e assim: pai de verdade no cadastro, sem `c2x_enterprise_id`. Como a
    // tabela de premissas e chaveada pelo id do C2X, nao ha o que herdar dele — e isso nao e falha.
    estado.cadastro = [
      { c2x_enterprise_id: null, id: "uuid-lox", pai_id: null, workspace_id: "careli" },
      { c2x_enterprise_id: FILHO, id: "uuid-lav", pai_id: "uuid-lox", workspace_id: "careli" },
    ];
    estado.linhas = [PENAL_DO_PAI];

    const resposta = await pedirGet(`?enterprise=${FILHO}`);
    const corpo = (await resposta.json()) as Resposta;

    expect(resposta.status).toBe(200);
    expect(corpo.data?.paiEnterpriseId).toBeNull();
    expect(corpo.data?.faltando).toHaveLength(5);
  });

  it("falha ao ler o cadastro vira 503, e NAO um `nao cadastrada` mentiroso", async () => {
    // ⚠️ Tratar a falha como "nao tem pai" recriaria o defeito no unico momento em que ninguem
    // desconfia. Uma tela que nao consegue distinguir "herdada" de "nao cadastrada" nao pode
    // perguntar ao operador se ele quer cadastrar.
    estado.erroDoCadastro = { code: "57014", message: "canceling statement due to timeout" };
    estado.linhas = [PENAL_DO_PAI];

    const resposta = await pedirGet(`?enterprise=${FILHO}`);
    const corpo = (await resposta.json()) as Resposta;

    expect(resposta.status).toBe(503);
    expect(corpo.data).toBeUndefined();
    expect(corpo.error).toContain("principal");
  });

  it("linha cuja base NAO serve a rubrica aparece cadastrada e fora da conta", async () => {
    // ⚠️ O CHECK da 0166 aceita qualquer uma das seis bases para qualquer rubrica, entao uma linha
    // nascida de SQL direto ou de backfill pode ter `fruicao` sobre `total_pago` — e a conta
    // multiplicaria o total pago pelos meses de ocupacao. `premissasDoRecorte` ignora a linha; a
    // tela precisa MOSTRAR que ela existe e que o termo nao vai usa-la.
    estado.linhas = [
      {
        ativa: true,
        base: "total_pago",
        enterprise_id: ENTERPRISE,
        percentual: 0.75,
        periodicidade: "mensal",
        rubrica: "fruicao",
        workspace_id: "careli",
      },
    ];

    const fruicao = ((await (await pedirGet()).json()) as Resposta).data?.premissas?.find(
      (p) => p.rubrica === "fruicao",
    );

    expect(fruicao?.cadastrada).toBe(true);
    expect(fruicao?.valeNoTermo).toBe(false);
  });
});

describe("o PUT grava as cinco de uma vez", () => {
  it("grava as cinco da Lavra do Ouro e devolve todas em `gravadas`", async () => {
    const resposta = await pedirPut({ enterpriseId: ENTERPRISE, premissas: CINCO_DA_LAVRA });
    const corpo = (await resposta.json()) as Resposta;

    expect(resposta.status).toBe(200);
    expect(corpo.data?.gravadas).toHaveLength(5);
    expect(corpo.data?.naoEnviadas).toEqual([]);
    expect(estado.gravadas).toHaveLength(5);
  });

  it("carimba o workspace `careli`, o empreendimento e o autor em TODAS as linhas", async () => {
    await pedirPut({ enterpriseId: ENTERPRISE, premissas: CINCO_DA_LAVRA });

    for (const linha of estado.gravadas) {
      expect(linha.workspace_id).toBe("careli");
      expect(linha.enterprise_id).toBe(ENTERPRISE);
      expect(linha.atualizado_por).toBe(estado.usuarioId);
      expect(linha.atualizado_por_nome).toBe("Cinthia");
    }
  });

  it("aceita o autor sem nome, em vez de inventar `Sistema`", async () => {
    estado.usuarioNome = null;
    await pedirPut({ enterpriseId: ENTERPRISE, premissas: CINCO_DA_LAVRA });

    expect(estado.gravadas[0]?.atualizado_por_nome).toBeNull();
  });

  it("guarda tres casas no percentual, e nao duas", async () => {
    // A regra das duas casas e de DINHEIRO. Aqui a coluna e numeric(6,3) e cortar na segunda casa
    // faria o numero mudar sozinho entre salvar e reabrir a tela.
    await pedirPut({
      enterpriseId: ENTERPRISE,
      premissas: [
        {
          ativa: true,
          base: "total_pago",
          percentual: 5.9337,
          periodicidade: "unica",
          rubrica: "tributos",
        },
      ],
    });

    expect(estado.gravadas[0]?.percentual).toBe(5.934);
  });

  it("le o percentual escrito com VIRGULA, do jeito que o operador digita", async () => {
    await pedirPut({
      enterpriseId: ENTERPRISE,
      premissas: [
        {
          ativa: true,
          base: "total_pago",
          percentual: "5,93",
          periodicidade: "unica",
          rubrica: "tributos",
        },
      ],
    });

    expect(estado.gravadas[0]?.percentual).toBe(5.93);
  });

  it("diz em `naoEnviadas` o que ficou como estava", async () => {
    // A tela nao pode dizer "premissas salvas" quando vieram duas de cinco.
    const corpo = (await (
      await pedirPut({ enterpriseId: ENTERPRISE, premissas: CINCO_DA_LAVRA.slice(0, 2) })
    ).json()) as Resposta;

    expect(corpo.data?.gravadas).toHaveLength(2);
    expect(corpo.data?.naoEnviadas).toEqual(["corretagem", "tributos", "fruicao"]);
  });

  it("nunca manda `delete` ao banco: desligar e `ativa: false`", async () => {
    await pedirPut({
      enterpriseId: ENTERPRISE,
      premissas: [
        {
          ativa: false,
          base: "valor_de_tabela_menos_comissao",
          clausula: "O empreendimento nao cobra publicidade.",
          percentual: null,
          periodicidade: "unica",
          rubrica: "publicidade",
        },
      ],
    });

    expect(estado.gravadas).toHaveLength(1);
    expect(estado.gravadas[0]?.ativa).toBe(false);
    expect(estado.gravadas[0]?.clausula).toBe("O empreendimento nao cobra publicidade.");
  });
});

describe("o PUT recusa antes de tocar no banco", () => {
  it("linha `null` no corpo e 422 com {campo, mensagem}, e NAO um 500 com stack", async () => {
    // ⚠️ MEDIDO EM 15/09/2026: `Array.isArray(corpo.premissas)` prova que e ARRAY, nao que os itens
    // sao objetos. `PUT { enterpriseId: "31", premissas: [null] }` estourava `Cannot read properties
    // of null` no primeiro `recebida.rubrica` — fora de qualquer try — e o operador recebia um 500
    // com stack no lugar do erro com campo e frase que o resto da rota entrega.
    const resposta = await pedirPut({ enterpriseId: ENTERPRISE, premissas: [null] });
    const corpo = (await resposta.json()) as Resposta;

    expect(resposta.status).toBe(422);
    expect(corpo.error).toBe("Confira as premissas antes de salvar.");
    expect(corpo.erros?.map((e) => e.campo)).toContain("linha1.rubrica");
    expect(corpo.erros?.[0]?.mensagem).toContain("Linha 1: ");
    expect(estado.gravadas).toHaveLength(0);
  });

  it("corpo que e o JSON `null` e 400, e NAO um 500 sem rastro", async () => {
    // ⚠️ MEDIDO EM 15/09/2026, DEPOIS do conserto das linhas: a porta `ehLinhaLegivel` fechou o
    // `premissas: [null]`, mas o corpo INTEIRO continuava entrando sem conferencia. `request.json()`
    // devolve `null` para o corpo `null` — que e JSON valido, entao o `catch` nao dispara — e o
    // `String(corpo.enterpriseId ?? "")` logo abaixo estourava `Cannot read properties of null`,
    // fora de qualquer try. E o mesmo defeito que a rota irma da posse ja fechou, na mesma data.
    const resposta = await pedirPut(null);
    const corpo = (await resposta.json()) as Resposta;

    expect(resposta.status).toBe(400);
    expect(corpo.error).toBe("Corpo inválido.");
    expect(estado.gravadas).toHaveLength(0);
  });

  it("corpo que e JSON mas nao e objeto (texto, numero, array) e 400", async () => {
    // `"texto".enterpriseId` e `undefined` e nao estoura, entao estes caiam em "Informe o
    // empreendimento." — uma frase que manda o operador procurar um campo num corpo que nem e
    // formulario. A porta e a mesma da irma: o que nao e objeto nao passa.
    for (const lixo of ["texto", 7, [], true]) {
      const resposta = await pedirPut(lixo);
      expect(resposta.status).toBe(400);
      expect(((await resposta.json()) as Resposta).error).toBe("Corpo inválido.");
    }
    expect(estado.gravadas).toHaveLength(0);
  });

  it("pedido torto responde 400 mesmo SEM cliente do Supabase, como na rota irma", async () => {
    // ⚠️ A ORDEM E auth → PEDIDO → INFRAESTRUTURA. Conferindo o cliente antes do corpo, o MESMO
    // pedido torto respondia 400 em producao e 503 num ambiente sem credencial: a resposta a um
    // defeito do pedido mudando com a infraestrutura, que e o que confunde quem le o log. A rota da
    // posse ja arrumou os tres verbos dela; esta era a ultima divergencia entre as duas.
    estado.semCliente = true;

    const resposta = await pedirPut({ enterpriseId: "", premissas: [] });

    expect(resposta.status).toBe(400);
    expect(((await resposta.json()) as Resposta).error).toBe("Informe o empreendimento.");
  });

  it("texto, numero, booleano e array no lugar da linha saem pela mesma porta", async () => {
    // `[].rubrica` e `undefined` e passaria como "rubrica desconhecida" — uma frase que manda o
    // operador procurar um campo que nao existe naquela linha.
    for (const lixo of ["clausula_penal", 7, true, []]) {
      const resposta = await pedirPut({ enterpriseId: ENTERPRISE, premissas: [lixo] });
      expect(resposta.status).toBe(422);
    }
    expect(estado.gravadas).toHaveLength(0);
  });

  it("a linha quebrada e apontada pela POSICAO, mesmo ao lado de uma linha boa", async () => {
    const corpo = (await (
      await pedirPut({ enterpriseId: ENTERPRISE, premissas: [CINCO_DA_LAVRA[0], null] })
    ).json()) as Resposta;

    expect(corpo.erros?.map((e) => e.campo)).toContain("linha2.rubrica");
    // Nada vai ao banco: o formulario e um so, e ele nao vale pela metade.
    expect(estado.gravadas).toHaveLength(0);
  });

  it("rubrica repetida e 422 e NAO vai ao Postgres", async () => {
    // ⚠️ O indice unico e (workspace_id, enterprise_id, rubrica): duas linhas da mesma rubrica no
    // mesmo upsert derrubam o lote inteiro com "cannot affect row a second time", e as cinco
    // deixariam de salvar por causa de uma.
    const resposta = await pedirPut({
      enterpriseId: ENTERPRISE,
      premissas: [CINCO_DA_LAVRA[0], CINCO_DA_LAVRA[0]],
    });
    const corpo = (await resposta.json()) as Resposta;

    expect(resposta.status).toBe(422);
    expect(corpo.erros?.map((e) => e.campo)).toContain("clausula_penal.rubrica");
    expect(estado.gravadas).toHaveLength(0);
  });

  it("`ativa` como TEXTO e 422, e nao um desligamento calado", async () => {
    // `"false"` e truthy e `"true"` nao e `=== true`: um input mal convertido desligaria a rubrica
    // que o operador acabou de ligar.
    const resposta = await pedirPut({
      enterpriseId: ENTERPRISE,
      premissas: [{ ...CINCO_DA_LAVRA[0], ativa: "true" }],
    });

    expect(resposta.status).toBe(422);
    expect(((await resposta.json()) as Resposta).erros?.map((e) => e.campo)).toContain(
      "clausula_penal.ativa",
    );
    expect(estado.gravadas).toHaveLength(0);
  });

  it("o erro NOMEIA a rubrica no campo e na frase", async () => {
    const corpo = (await (
      await pedirPut({
        enterpriseId: ENTERPRISE,
        premissas: [{ ...CINCO_DA_LAVRA[1], periodicidade: "mensal" }],
      })
    ).json()) as Resposta;

    expect(corpo.erros?.[0]?.campo).toBe("publicidade.periodicidade");
    expect(corpo.erros?.[0]?.mensagem).toContain("Publicidade: ");
  });

  it("rubrica desconhecida e nomeada pela POSICAO da linha", async () => {
    const corpo = (await (
      await pedirPut({
        enterpriseId: ENTERPRISE,
        premissas: [CINCO_DA_LAVRA[0], { ...CINCO_DA_LAVRA[1], rubrica: "taxa_inventada" }],
      })
    ).json()) as Resposta;

    expect(corpo.erros?.some((e) => e.campo.startsWith("linha2."))).toBe(true);
    expect(estado.gravadas).toHaveLength(0);
  });

  it("percentual que nao e numero e 422, e `Number(true)` nao vira 1%", async () => {
    // ⚠️ `Number(true) === 1`. Sem a porta de tipo, um booleano de um input mal convertido viraria
    // uma aliquota de 1% que ninguem digitou.
    const resposta = await pedirPut({
      enterpriseId: ENTERPRISE,
      premissas: [{ ...CINCO_DA_LAVRA[0], percentual: true }],
    });

    expect(resposta.status).toBe(422);
    expect(estado.gravadas).toHaveLength(0);
  });

  it("uma frase por campo: `dez` nao gera dois erros no mesmo lugar", async () => {
    const corpo = (await (
      await pedirPut({
        enterpriseId: ENTERPRISE,
        premissas: [{ ...CINCO_DA_LAVRA[0], percentual: "dez" }],
      })
    ).json()) as Resposta;

    const doPercentual = corpo.erros?.filter((e) => e.campo === "clausula_penal.percentual") ?? [];
    expect(doPercentual).toHaveLength(1);
  });

  it("corpo sem empreendimento, sem lista e ilegivel sao 400", async () => {
    expect((await pedirPut({ premissas: CINCO_DA_LAVRA })).status).toBe(400);
    expect((await pedirPut({ enterpriseId: ENTERPRISE, premissas: [] })).status).toBe(400);
    const quebrado = await PUT(
      new Request("https://x/api/apolo/empreendimentos/premissas-de-rescisao", {
        body: "{",
        method: "PUT",
      }),
    );
    expect(quebrado.status).toBe(400);
  });

  it("o portao do PUT e o de ESCRITA e fecha antes do banco", async () => {
    estado.autorizado = false;
    const resposta = await pedirPut({ enterpriseId: ENTERPRISE, premissas: CINCO_DA_LAVRA });

    expect(resposta.status).toBe(403);
    expect(estado.gravadas).toHaveLength(0);
  });
});

describe("o PUT traduz o que o banco recusa", () => {
  it("tabela ausente e 503 com a frase da migration 0166, e nao um 500 generico", async () => {
    estado.erroDoUpsert = {
      code: "PGRST205",
      message: "Could not find the table in the schema cache",
    };
    const resposta = await pedirPut({ enterpriseId: ENTERPRISE, premissas: CINCO_DA_LAVRA });

    expect(resposta.status).toBe(503);
    expect(((await resposta.json()) as Resposta).error).toContain("0166");
  });

  it("COLUNA ausente NAO vira `migration 0166 pendente` na gravacao", async () => {
    // ⚠️ O caso real: 0166 aplicada de um rascunho velho, sem `atualizado_por_nome` — que e
    // justamente uma das colunas que este PUT grava. A copia caseira (`/does not exist|schema
    // cache/i`) dizia "migration pendente" para uma tabela que JA EXISTE, e o historico do contrato
    // deixava de ser gravado, calado, no ponto exato em que a auditoria vai procurar.
    estado.erroDoUpsert = {
      code: "PGRST204",
      message:
        "Could not find the 'atualizado_por_nome' column of 'hercules_premissas_de_rescisao' in the schema cache",
    };
    const resposta = await pedirPut({ enterpriseId: ENTERPRISE, premissas: CINCO_DA_LAVRA });
    const corpo = (await resposta.json()) as Resposta;

    expect(resposta.status).toBe(500);
    expect(corpo.error).not.toContain("0166");
    expect(corpo.error).toContain("atualizado_por_nome");
  });

  it("violacao de CHECK e 400, porque significa que rota e banco divergiram", async () => {
    estado.erroDoUpsert = { code: "23514", message: "violates check constraint" };
    expect(
      (await pedirPut({ enterpriseId: ENTERPRISE, premissas: CINCO_DA_LAVRA })).status,
    ).toBe(400);
  });

  it("gravacao parcial NAO responde `salvo`", async () => {
    // ⚠️ `.upsert()` sem conferir o `select` devolve sucesso sem dizer quantas linhas casaram. A
    // tela diria "premissas salvas" para uma gravacao que aconteceu pela metade.
    estado.rubricasQueCasam = ["clausula_penal", "publicidade"];
    const resposta = await pedirPut({ enterpriseId: ENTERPRISE, premissas: CINCO_DA_LAVRA });

    expect(resposta.status).toBe(500);
    expect(((await resposta.json()) as Resposta).error).toContain("2 de 5");
  });
});
