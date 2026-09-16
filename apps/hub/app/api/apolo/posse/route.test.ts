import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

// A ROTA DA POSSE — metade lida como TEXTO, metade exercitada com o Supabase mockado.
//
// ⚠️ A PARTE LIDA COMO TEXTO EXISTE PORQUE OS 28 TESTES DA LIB PASSAVAM COM A ROTA MORTA. Em
// 14/09/2026, `venda/bloqueio` filtrava por `workspace_id = "00000000-..."` — um uuid que não existe
// em lugar nenhum do banco. A coluna é TEXT com `'careli'` em todas as linhas: a comparação não dá
// erro de tipo, casa zero linhas em silêncio, e a suíte inteira fica verde enquanto a rota responde
// 404 para tudo. Aqui o sintoma seria pior, porque não é um 404: o GET diria "sem posse" para um
// contrato QUE TEM posse, o termo de rescisão sairia sem a fruição — a rubrica mais pesada do
// documento — e ninguém veria erro nenhum.
//
// ⚠️ LER O ARQUIVO É GROSSEIRO, E É DE PROPÓSITO. A constante trocada, o portão apagado e o
// `.upsert()` que o índice parcial não aceita são visíveis no texto e invisíveis para o typecheck.
// O resto — o que dá para provar sem banco — é exercitado de verdade, com o cliente mockado.
const ROTA = readFileSync(join(__dirname, "route.ts"), "utf8");

/**
 * O arquivo SEM as linhas de comentário.
 *
 * ⚠️ SEM ISTO O CABEÇALHO DERRUBA AS ASSERÇÕES. Os avisos desta casa citam justamente o que a rota
 * NÃO faz (`.upsert()`, o outro portão), e um `not.toContain` sobre o arquivo inteiro acusaria o
 * comentário que explica a escolha. O que se afirma aqui é sobre o CÓDIGO.
 */
const CODIGO = ROTA.split("\n")
  .filter((linha) => !/^\s*(\/\/|\/\*|\*)/.test(linha))
  .join("\n");

/** O trecho do código que pertence a um verbo, até a próxima função exportada. */
function blocoDo(metodo: "DELETE" | "GET" | "PUT"): string {
  const inicio = CODIGO.indexOf(`export async function ${metodo}(`);
  const resto = CODIGO.slice(inicio + 1);
  const fim = resto.indexOf("\nexport async function ");
  return fim === -1 ? resto : resto.slice(0, fim);
}

function quantas(agulha: string): number {
  return CODIGO.split(agulha).length - 1;
}

describe("a rota da posse, lida como texto", () => {
  it("o workspace é `careli`, e não um uuid", () => {
    expect(ROTA).toContain('const WORKSPACE = "careli"');
    // O defeito exato de 14/09/2026.
    expect(ROTA).not.toMatch(/const WORKSPACE = "[0-9a-f]{8}-/);
  });

  it("cada verbo tem o seu portão", () => {
    // Leitura é `Read` (inclui `viewer`); gravar e apagar são `Write` (o `viewer` fica de fora).
    expect(blocoDo("GET")).toContain("authorizeApoloRead(request)");
    expect(blocoDo("GET")).not.toContain("authorizeApoloWrite");
    expect(blocoDo("PUT")).toContain("authorizeApoloWrite(request)");
    expect(blocoDo("PUT")).not.toContain("authorizeApoloRead");
    expect(blocoDo("DELETE")).toContain("authorizeApoloWrite(request)");
    expect(blocoDo("DELETE")).not.toContain("authorizeApoloRead");
  });

  it("toda ida à tabela carrega o workspace", () => {
    // Quatro filtram, uma grava no payload (o insert). Nenhuma fala com a tabela sem dizer o
    // workspace — que é onde a linha errada mora quando a constante muda.
    expect(quantas('.eq("workspace_id", WORKSPACE)') + quantas("workspace_id: WORKSPACE")).toBe(
      quantas('.from("hercules_posse")'),
    );
  });

  it("a validação é a `conferirPosse` da lib, e não uma segunda régua", () => {
    // Duas réguas discordando no mesmo cliente é o defeito que o levantamento já registrou entre o
    // acordo e o dossiê. O teto ("posse no futuro") não está no CHECK: só a lib o conhece.
    expect(CODIGO).toContain("conferirPosse({");
    expect(CODIGO).toContain('from "@/lib/apolo/posse"');
  });

  it("não usa `.upsert()`, porque o índice é PARCIAL", () => {
    // `on_conflict` do PostgREST só escreve a lista de colunas; sem o `where` do índice parcial o
    // Postgres devolve 42P10. O contorno é select → insert ou update, com o 23505 traduzido.
    expect(CODIGO).not.toContain(".upsert(");
    expect(CODIGO).toContain('erroDoInsert.code === "23505"');
  });

  it("o DELETE confere o que casou", () => {
    // Sem o `.select("id")`, o PostgREST devolve o mesmo sucesso para "apaguei" e "não havia".
    expect(blocoDo("DELETE")).toContain('.select("id")');
  });

  it("o GET seleciona o retrato, senão a tela não tem como reenviá-lo", () => {
    // ⚠️ ESTA PROVA TEM DE SER NO TEXTO. O `.select()` do cliente mockado é um no-op: ele devolve a
    // linha inteira independentemente das colunas pedidas, então um teste de comportamento passaria
    // com a constante errada — exatamente o buraco por onde o defeito entrou. O que decide de
    // verdade, em produção, é a lista de colunas escrita aqui.
    const colunas = (/const COLUNAS =\s*\n?\s*"([^"]+)"/.exec(CODIGO)?.[1] ?? "").split(",");

    expect(colunas).toContain("enterprise_id");
    expect(colunas).toContain("unidade_c2x_id");
    // `registrado_por` continua fora: é uuid interno e não tem o que fazer na tela.
    expect(colunas).not.toContain("registrado_por");
  });

  it("o erro de validação do PUT sai em 422 com `error`, como na rota irmã", () => {
    // A tela do Apolo lê `corpo.error` e SÓ ele (`politica-comercial-tab.tsx` e companhia). Um 400
    // com apenas `erros` vira "Não foi possível salvar." na cara do operador.
    expect(blocoDo("PUT")).toContain("status: 422");
    expect(blocoDo("PUT")).not.toContain("{ erros }, { status: 400 }");
  });
});

// ───────────────────────────────────────────────────────────────────────────────────────────────
// O comportamento, com o Supabase mockado.

const estado = vi.hoisted(() => ({
  autorizado: true,
  /** Liga a corrida: o insert perde para quem gravou primeiro e volta 23505. */
  corridaNoInsert: false,
  /** Liga a falha de leitura: todo `select` volta com erro, como num timeout do PostgREST. */
  falhaDeLeitura: false,
  linhas: [] as Array<Record<string, unknown>>,
  operacoes: [] as Array<{
    filtros: Record<string, unknown>;
    tipo: "delete" | "insert" | "select" | "update";
    valores: Record<string, unknown>;
  }>,
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
    tipo: "delete" | "insert" | "select" | "update";
    valores: Record<string, unknown>;
  };

  const casa = (linha: Record<string, unknown>, filtros: Record<string, unknown>) =>
    Object.entries(filtros).every(([coluna, valor]) => (linha[coluna] ?? null) === valor);

  const resolver = (
    ctx: Ctx,
  ): { data: unknown; error: null | { code?: string; message: string } } => {
    const alvo = estado.linhas.filter((l) => casa(l, ctx.filtros));

    if (ctx.tipo === "select" && estado.falhaDeLeitura) {
      return { data: null, error: { message: "canceling statement due to statement timeout" } };
    }

    if (ctx.tipo === "insert") {
      if (estado.corridaNoInsert) {
        estado.corridaNoInsert = false;
        // Quem ganhou a corrida deixou a linha gravada — é ela que o update vai encontrar.
        estado.linhas.push({
          id: "posse-do-outro",
          ...ctx.valores,
          data_da_posse: "2023-01-10",
          registrado_por_nome: "Northon",
        });
        return {
          data: null,
          error: { code: "23505", message: "duplicate key value violates unique constraint" },
        };
      }
      const nova = { id: `posse-${estado.linhas.length + 1}`, ...ctx.valores };
      estado.linhas.push(nova);
      estado.operacoes.push({ filtros: {}, tipo: "insert", valores: ctx.valores });
      return { data: [nova], error: null };
    }

    if (ctx.tipo === "update") {
      for (const linha of alvo) Object.assign(linha, ctx.valores);
      estado.operacoes.push({ filtros: ctx.filtros, tipo: "update", valores: ctx.valores });
      return { data: alvo, error: null };
    }

    if (ctx.tipo === "delete") {
      estado.linhas = estado.linhas.filter((l) => !casa(l, ctx.filtros));
      estado.operacoes.push({ filtros: ctx.filtros, tipo: "delete", valores: {} });
      return { data: alvo, error: null };
    }

    return { data: alvo, error: null };
  };

  const construir = () => {
    const ctx: Ctx = { filtros: {}, tipo: "select", valores: {} };
    const api = {
      delete: () => {
        ctx.tipo = "delete";
        return api;
      },
      eq: (coluna: string, valor: unknown) => {
        ctx.filtros[coluna] = valor;
        return api;
      },
      insert: (valores: Record<string, unknown>) => {
        ctx.tipo = "insert";
        ctx.valores = valores;
        return api;
      },
      maybeSingle: async () => {
        const { data, error } = resolver(ctx);
        return { data: Array.isArray(data) ? (data[0] ?? null) : data, error };
      },
      select: () => api,
      then: (aceitar: (v: unknown) => unknown, recusar?: (e: unknown) => unknown) =>
        Promise.resolve(resolver(ctx)).then(aceitar, recusar),
      update: (valores: Record<string, unknown>) => {
        ctx.tipo = "update";
        ctx.valores = valores;
        return api;
      },
    };
    return api;
  };

  return {
    createApoloAdminClient: () => (estado.semCliente ? null : { from: () => construir() }),
  };
});

import { DELETE, GET, PUT } from "@/app/api/apolo/posse/route";

/** Contrato real do C2X: é o 2038 do Cidade Jardim, citado na migration 0166. */
const CONTRATO = 2038;

/** A data que a própria `lib/apolo/posse.ts` usa de exemplo ("15/03/2024"). */
const DATA = "2024-03-15";

/** Amanhã, calculado na hora: "posse no futuro" tem de continuar futuro daqui a um ano. */
const AMANHA = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);

type Resposta = {
  data?: { apagada?: boolean; posse?: null | Record<string, unknown> };
  erros?: Array<{ campo: string; mensagem: string }>;
  error?: string;
};

const pedirGet = (query = `?contrato=${CONTRATO}`) =>
  GET(new Request(`https://x/api/apolo/posse${query}`));

const pedirPut = (corpo: unknown) =>
  PUT(
    new Request("https://x/api/apolo/posse", { body: JSON.stringify(corpo), method: "PUT" }),
  );

const pedirDelete = (query = `?contrato=${CONTRATO}`) =>
  DELETE(new Request(`https://x/api/apolo/posse${query}`, { method: "DELETE" }));

const corpoValido = (extra: Record<string, unknown> = {}) => ({
  contratoC2xId: CONTRATO,
  dataDaPosse: DATA,
  // ⚠️ O retrato é COPIADO no ato e não decide nada (migration 0165): o que o teste prova é que ele
  // chega ao banco, não que este contrato seja deste empreendimento.
  enterpriseId: "31",
  origem: "termo_de_vistoria",
  unidadeC2xId: 4211,
  ...extra,
});

/** Uma posse já registrada, como a linha sai do banco. */
const linhaGravada = (extra: Record<string, unknown> = {}) => ({
  contrato_c2x_id: CONTRATO,
  data_da_posse: DATA,
  enterprise_id: "31",
  id: "posse-1",
  observacao: null,
  origem: "termo_de_vistoria",
  registrado_em: "2026-09-15T12:00:00.000Z",
  registrado_por_nome: "Cinthia",
  unidade_c2x_id: 4211,
  workspace_id: "careli",
  ...extra,
});

const ultimoInsert = () => estado.operacoes.find((o) => o.tipo === "insert")?.valores ?? {};

const ultimoUpdate = () => estado.operacoes.find((o) => o.tipo === "update")?.valores ?? {};

beforeEach(() => {
  estado.autorizado = true;
  estado.corridaNoInsert = false;
  estado.falhaDeLeitura = false;
  estado.linhas = [];
  estado.operacoes = [];
  estado.semCliente = false;
  estado.usuarioId = "3f7a2c18-9d4b-4f2a-8a11-0c5e6b7d8e90";
  estado.usuarioNome = "Cinthia";
});

describe("GET — a posse de um contrato", () => {
  it("sem contrato na URL é 400", async () => {
    const r = await pedirGet("");
    expect(r.status).toBe(400);
  });

  it("contrato que não é número é 400, e não 500", async () => {
    // `contrato_c2x_id` é bigint: mandar isto ao PostgREST voltaria 22P02 e viraria 500 — erro de
    // servidor para um erro de digitação na URL.
    const r = await pedirGet("?contrato=2038a");
    expect(r.status).toBe(400);
  });

  it("contrato sem posse devolve `null`, e não 404", async () => {
    // ⚠️ AUSÊNCIA É O ESTADO NORMAL: a cláusula 5.1 da Lavra do Ouro só concede posse a quem está
    // em dia, que é justamente quem não se distrata. 404 faria a tela desenhar erro na maioria.
    const r = await pedirGet();
    const corpo = (await r.json()) as Resposta;

    expect(r.status).toBe(200);
    expect(corpo.data?.posse).toBe(null);
  });

  it("devolve a posse registrada, com a origem e quem registrou", async () => {
    estado.linhas = [linhaGravada({ observacao: "Termo assinado na entrega das chaves." })];

    const corpo = (await (await pedirGet()).json()) as Resposta;

    expect(corpo.data?.posse?.dataDaPosse).toBe(DATA);
    expect(corpo.data?.posse?.origem).toBe("termo_de_vistoria");
    expect(corpo.data?.posse?.registradoPorNome).toBe("Cinthia");
    expect(corpo.data?.posse?.observacao).toBe("Termo assinado na entrega das chaves.");
  });

  it("devolve o retrato, para a tela conseguir reenviá-lo no PUT seguinte", async () => {
    // ⚠️ SEM ISTO O SEGUNDO PUT APAGA O RETRATO. A tela recarrega a posse por este GET; o que não
    // vier aqui, ela não tem como mandar de volta ao corrigir a data.
    estado.linhas = [linhaGravada()];

    const corpo = (await (await pedirGet()).json()) as Resposta;

    expect(corpo.data?.posse?.enterpriseId).toBe("31");
    expect(corpo.data?.posse?.unidadeC2xId).toBe(4211);
  });

  it("sem cliente do Supabase é 503, e não um `null` mentiroso", async () => {
    estado.semCliente = true;
    const r = await pedirGet();
    expect(r.status).toBe(503);
  });

  it("falha de leitura é 503 (como na rota irmã), e não 500 nem `posse: null`", async () => {
    // ⚠️ "NÃO CONSEGUI LER" NÃO É "NÃO TEM POSSE". Devolver `null` depois de um timeout faria a tela
    // afirmar que a posse não aconteceu, e o operador estaria a um clique de gravar esse vazio por
    // cima de uma data real. E 500 diria que o defeito é desta rota, quando é o banco fora de
    // alcance — a rota das premissas já responde 503 no mesmo caso.
    estado.falhaDeLeitura = true;

    const r = await pedirGet();
    const corpo = (await r.json()) as Resposta;

    expect(r.status).toBe(503);
    expect(corpo.data?.posse).toBeUndefined();
    expect(corpo.error).toBeTruthy();
  });

  it("contrato sem posse continua 400 quando falta o parâmetro, mesmo sem Supabase", async () => {
    // A ordem das guardas: o pedido é conferido ANTES da infraestrutura, igual à rota irmã. Sem
    // isso, a mesma URL torta responderia 400 em produção e 503 num ambiente sem credencial.
    estado.semCliente = true;

    const r = await pedirGet("");

    expect(r.status).toBe(400);
  });
});

describe("PUT — registrar e corrigir a posse", () => {
  it("grava a data com o autor COPIADO no ato", async () => {
    const r = await pedirPut(corpoValido());
    const corpo = (await r.json()) as Resposta;

    expect(r.status).toBe(200);
    expect(corpo.data?.posse?.dataDaPosse).toBe(DATA);
    // ⚠️ O nome vai junto porque o termo não pode resolver o autor por join depois: a pessoa sai da
    // empresa e o histórico tem de continuar dizendo quem foi naquele dia.
    expect(ultimoInsert().registrado_por).toBe(estado.usuarioId);
    expect(ultimoInsert().registrado_por_nome).toBe("Cinthia");
    expect(ultimoInsert().workspace_id).toBe("careli");
    expect(ultimoInsert().enterprise_id).toBe("31");
    expect(ultimoInsert().unidade_c2x_id).toBe(4211);
  });

  it("o dono da linha é o contrato do C2X, e `venda_id` nem é escrito", async () => {
    await pedirPut(corpoValido());
    // O CHECK `hercules_posse_um_dono` exige EXATAMENTE um dono. `venda_id` fica com o default.
    expect(ultimoInsert().contrato_c2x_id).toBe(CONTRATO);
    expect("venda_id" in ultimoInsert()).toBe(false);
  });

  it("o nome nulo se grava como nulo, sem inventar 'Sistema'", async () => {
    estado.usuarioNome = null;
    await pedirPut(corpoValido());
    expect(ultimoInsert().registrado_por_nome).toBe(null);
  });

  it("corrigir não cria uma segunda linha", async () => {
    estado.linhas = [linhaGravada()];

    const r = await pedirPut(corpoValido({ dataDaPosse: "2024-05-02" }));
    const corpo = (await r.json()) as Resposta;

    expect(r.status).toBe(200);
    expect(estado.linhas.length).toBe(1);
    expect(estado.linhas[0]?.data_da_posse).toBe("2024-05-02");
    expect(corpo.data?.posse?.dataDaPosse).toBe("2024-05-02");
    expect(estado.operacoes.some((o) => o.tipo === "insert")).toBe(false);
  });

  it("corrigir troca o autor JUNTO com a data", async () => {
    estado.linhas = [linhaGravada()];
    estado.usuarioNome = "Northon";
    estado.usuarioId = "9b1c4d22-1111-4aaa-bbbb-222233334444";

    await pedirPut(corpoValido({ dataDaPosse: "2024-05-02" }));

    // ⚠️ A ficha imprime a frase inteira ("02/05/2024, por Fulano em ..."). Deixar o autor antigo
    // atribuiria a ele um número que ele não escolheu.
    expect(estado.linhas[0]?.registrado_por_nome).toBe("Northon");
    expect(estado.linhas[0]?.registrado_por).toBe("9b1c4d22-1111-4aaa-bbbb-222233334444");
  });

  it("corrigir SEM o retrato não apaga o empreendimento já gravado", async () => {
    // ⚠️ O DEFEITO QUE OS 28 TESTES NÃO PEGARAM, porque TODO PUT daqui usava o `corpoValido()`, que
    // sempre carrega `enterpriseId` e `unidadeC2xId`. Na vida real o segundo PUT vem da tela que
    // recarregou a posse: ela manda o que o GET devolveu. Enquanto o UPDATE mandava o objeto inteiro,
    // um corpo sem o retrato zerava `enterprise_id` — e a linha saía do índice parcial
    // `hercules_posse_por_empreendimento` (`where enterprise_id is not null`), sumindo para sempre da
    // pergunta "quais lotes deste empreendimento têm posse?". Em silêncio: a data ficava certa e a
    // tela dizia "salvo".
    estado.linhas = [linhaGravada()];

    const r = await pedirPut({
      contratoC2xId: CONTRATO,
      dataDaPosse: "2024-05-02",
      origem: "contrato",
    });
    const corpo = (await r.json()) as Resposta;

    expect(r.status).toBe(200);
    expect(estado.linhas[0]?.data_da_posse).toBe("2024-05-02");
    expect(estado.linhas[0]?.enterprise_id).toBe("31");
    expect(estado.linhas[0]?.unidade_c2x_id).toBe(4211);
    expect(corpo.data?.posse?.enterpriseId).toBe("31");

    // A prova de POR QUE sobreviveu: as colunas do retrato nem chegaram ao payload do UPDATE.
    expect("enterprise_id" in ultimoUpdate()).toBe(false);
    expect("unidade_c2x_id" in ultimoUpdate()).toBe(false);
  });

  it("retrato em branco também não apaga o que está gravado", async () => {
    // A tela que não conhece o retrato manda `""` exatamente como manda nada. Tratar os dois igual é
    // a escolha desta rota: limpar um campo que SÓ serve para filtrar nunca é o que alguém quis.
    estado.linhas = [linhaGravada()];

    await pedirPut(corpoValido({ enterpriseId: "", unidadeC2xId: "" }));

    expect(estado.linhas[0]?.enterprise_id).toBe("31");
    expect(estado.linhas[0]?.unidade_c2x_id).toBe(4211);
  });

  it("corrigir COM retrato novo troca o retrato", async () => {
    // O outro lado da moeda: preservar o ausente não pode virar "o retrato é imutável". Mandar o
    // valor novo continua sendo o caminho para corrigir um retrato errado.
    estado.linhas = [linhaGravada()];

    await pedirPut(corpoValido({ enterpriseId: "42", unidadeC2xId: 5150 }));

    expect(estado.linhas[0]?.enterprise_id).toBe("42");
    expect(estado.linhas[0]?.unidade_c2x_id).toBe(5150);
  });

  it("a recusa é 422 e traz `error`, que é o que a tela lê", async () => {
    // ⚠️ A TELA DO APOLO LÊ `corpo.error` E SÓ ELE — `politica-comercial-tab.tsx` (177, 262, 378),
    // `categorias-tab.tsx` (154, 186, 222), `anexos-do-contrato.tsx`, `adicionar-unidades.tsx`, todas
    // com `corpo.error ?? "<frase genérica>"`. Enquanto a rota devolvia só `erros`, o operador que
    // digitava uma posse no futuro lia "Não foi possível salvar." e nunca ficava sabendo o motivo.
    // 422 é o molde da casa para corpo legível com conteúdo recusado (`venda/bloqueio`, `reserva`,
    // `proposta`), e é o MESMO envelope da rota irmã das premissas.
    const r = await pedirPut(corpoValido({ dataDaPosse: AMANHA }));
    const corpo = (await r.json()) as Resposta;

    expect(r.status).toBe(422);
    expect(typeof corpo.error).toBe("string");
    expect(corpo.error?.length).toBeGreaterThan(0);
    // `erros` continua junto: é ele que diz QUAL campo a tela pinta de vermelho.
    expect(Array.isArray(corpo.erros)).toBe(true);
  });

  it("recusa posse no futuro, com o campo e a frase", async () => {
    const r = await pedirPut(corpoValido({ dataDaPosse: AMANHA }));
    const corpo = (await r.json()) as Resposta;

    expect(r.status).toBe(422);
    expect(corpo.erros?.[0]?.campo).toBe("dataDaPosse");
    expect(corpo.erros?.[0]?.mensagem).toContain("deixe em branco");
    expect(estado.linhas.length).toBe(0);
  });

  it("recusa data impossível (31 de fevereiro)", async () => {
    // `Date.UTC` aceita 31/02 e devolve 2 ou 3 de março, calado — a fruição sairia de uma data que
    // não existe.
    const r = await pedirPut(corpoValido({ dataDaPosse: "2024-02-31" }));
    expect(r.status).toBe(422);
    expect(estado.linhas.length).toBe(0);
  });

  it("recusa origem que não existe", async () => {
    const r = await pedirPut(corpoValido({ origem: "achismo" }));
    const corpo = (await r.json()) as Resposta;

    expect(r.status).toBe(422);
    expect(corpo.erros?.some((e) => e.campo === "origem")).toBe(true);
  });

  it("recusa corpo que traga venda, em vez de gravar dois donos", async () => {
    const r = await pedirPut(corpoValido({ vendaId: "8c2f5a90-0000-4000-8000-000000000001" }));
    const corpo = (await r.json()) as Resposta;

    expect(r.status).toBe(422);
    expect(corpo.erros?.some((e) => e.campo === "vendaId")).toBe(true);
    expect(estado.linhas.length).toBe(0);
  });

  it("recusa contrato ausente", async () => {
    const r = await pedirPut(corpoValido({ contratoC2xId: null }));
    const corpo = (await r.json()) as Resposta;

    expect(r.status).toBe(422);
    expect(corpo.erros?.some((e) => e.campo === "contratoC2xId")).toBe(true);
  });

  it("recusa retrato de unidade quebrado, em vez de engoli-lo", async () => {
    // Engolir faria a linha sumir do filtro "quais lotes deste empreendimento têm posse?", e
    // ninguém procura o que nunca apareceu.
    const r = await pedirPut(corpoValido({ unidadeC2xId: "lote 5" }));
    const corpo = (await r.json()) as Resposta;

    expect(r.status).toBe(422);
    expect(corpo.erros?.some((e) => e.campo === "unidadeC2xId")).toBe(true);
  });

  it("quem perde a corrida do insert grava por cima, e não devolve erro de banco", async () => {
    // O índice parcial `hercules_posse_um_por_contrato` é a trava de verdade: duas telas gravando o
    // mesmo contrato no mesmo segundo. 23505 não é erro do operador, é a mesma gravação ao inverso.
    estado.corridaNoInsert = true;

    const r = await pedirPut(corpoValido());
    const corpo = (await r.json()) as Resposta;

    expect(r.status).toBe(200);
    expect(estado.linhas.length).toBe(1);
    expect(corpo.data?.posse?.dataDaPosse).toBe(DATA);
    expect(corpo.data?.posse?.registradoPorNome).toBe("Cinthia");
  });

  it("corpo que não é JSON é 400", async () => {
    // 400 e não 422: 422 é para o corpo LEGÍVEL cujo conteúdo foi recusado. Isto aqui nem chega a
    // ser um pedido.
    const r = await PUT(new Request("https://x/api/apolo/posse", { body: "{", method: "PUT" }));
    expect(r.status).toBe(400);
  });

  it("corpo que é JSON mas não é objeto é 400, e não um 500 sem rastro", async () => {
    // ⚠️ `null` É JSON VÁLIDO, e `[]` também. O antigo `.json().catch(() => null)` deixava um array
    // passar pelo `!corpo`, e a primeira leitura de propriedade num `null` viraria 500.
    for (const bruto of ["null", "[]", '"texto"', "7"]) {
      const r = await PUT(new Request("https://x/api/apolo/posse", { body: bruto, method: "PUT" }));
      expect(r.status).toBe(400);
    }
    expect(estado.linhas.length).toBe(0);
  });
});

describe("DELETE — a posse que não aconteceu", () => {
  it("apaga e diz que apagou", async () => {
    estado.linhas = [linhaGravada()];

    const r = await pedirDelete();
    const corpo = (await r.json()) as Resposta;

    expect(r.status).toBe(200);
    expect(corpo.data?.apagada).toBe(true);
    expect(estado.linhas.length).toBe(0);
  });

  it("apagar o que não existe é 200, e não 404", async () => {
    // ⚠️ VAZIO É O RESULTADO PEDIDO. Dois cliques, ou uma aba aberta desde ontem, não podem virar
    // erro vermelho por cima de um estado que já é o que o operador queria.
    const r = await pedirDelete();
    const corpo = (await r.json()) as Resposta;

    expect(r.status).toBe(200);
    expect(corpo.data?.apagada).toBe(false);
  });

  it("só apaga o contrato pedido", async () => {
    estado.linhas = [linhaGravada(), linhaGravada({ contrato_c2x_id: 2039, id: "posse-2" })];

    await pedirDelete();

    expect(estado.linhas.length).toBe(1);
    expect(estado.linhas[0]?.contrato_c2x_id).toBe(2039);
  });

  it("sem contrato na URL é 400, e não um delete sem `where`", async () => {
    const r = await pedirDelete("");

    expect(r.status).toBe(400);
    expect(estado.operacoes.some((o) => o.tipo === "delete")).toBe(false);
  });
});
