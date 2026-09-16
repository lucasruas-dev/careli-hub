import { beforeEach, describe, expect, it } from "vitest";

import type { LinhaDoCadastro } from "@/lib/hercules/cadastro";

import {
  mesclarEmpreendimentosDisponiveis,
  salvarIncorporador,
  vinculosParaApagar,
  vinculosSemRepeticao,
} from "./gestao";
import { vinculosDoPortalNoCorpo } from "./vinculos-do-formulario";

// O SETUP DOS PORTAIS E O PRODUTO QUE SÓ EXISTE NO PANTEON.
//
// ⚠️ DOIS DEFEITOS TRAVADOS AQUI:
//   1. a lista de empreendimentos para vincular vinha só do C2X, então o prédio cadastrado no
//      Panteon (id a partir de 100000) não tinha como ser marcado para o portal da Cecílio;
//   2. salvar o portal APAGAVA todos os vínculos antes de regravar, e um insert que falhasse (um id
//      repetido já bastava, a chave primária é incorporador + empreendimento) deixava o portal sem
//      empreendimento nenhum — inclusive o do Panteon, que a tela nem desenhava.

const linha = (
  p: Partial<LinhaDoCadastro> & { codigo: string; id: string },
): LinhaDoCadastro => ({
  c2xEnterpriseId: null,
  cidade: null,
  nome: p.codigo,
  operadoPor: null,
  ordem: 0,
  paiId: null,
  tipoProduto: "loteamento",
  uf: null,
  vendendo: true,
  ...p,
});

const DO_C2X = [
  { code: "GDN", enterpriseId: "39", nome: "GARDEN" },
  { code: "VOC", enterpriseId: "37", nome: "VALE DO OURO" },
];

const CADASTRO: LinhaDoCadastro[] = [
  linha({ c2xEnterpriseId: "37", codigo: "VOC", id: "voc", nome: "Vale do Ouro · VOC", operadoPor: "inc-cecilio" }),
  linha({ c2xEnterpriseId: "39", codigo: "GDN", id: "gdn", nome: "Garden" }),
  linha({ c2xEnterpriseId: "9001", codigo: "TST", id: "tst", nome: "ZZ TESTE" }),
  linha({ c2xEnterpriseId: "100000", codigo: "JAD", id: "jad", nome: "Ed. Jade", operadoPor: "inc-cecilio" }),
  linha({ c2xEnterpriseId: "100001", codigo: "RUB", id: "rub", nome: "Ed. Rubi", operadoPor: "inc-sem-nome" }),
  // Pai de grupo sem id: não tem o que gravar no vínculo.
  linha({ codigo: "LOX", id: "lox", nome: "Lavra do Ouro" }),
];

const NOMES = new Map([["inc-cecilio", "Cecílio Rocha"]]);

describe("mesclarEmpreendimentosDisponiveis", () => {
  it("⚠️ junta C2X e Panteon sem repetir, com a marca e quem opera", () => {
    const lista = mesclarEmpreendimentosDisponiveis({
      cadastro: CADASTRO,
      doC2x: DO_C2X,
      nomesDosOperadores: NOMES,
    });

    expect(lista).toEqual([
      { code: "GDN", enterpriseId: "39", nome: "GARDEN", operadoPor: null, operadoPorNome: null, origem: "c2x" },
      { code: "JAD", enterpriseId: "100000", nome: "Ed. Jade", operadoPor: "inc-cecilio", operadoPorNome: "Cecílio Rocha", origem: "panteon" },
      // Operador que o cadastro de portais não achou: o id vai, o nome fica nulo.
      { code: "RUB", enterpriseId: "100001", nome: "Ed. Rubi", operadoPor: "inc-sem-nome", operadoPorNome: null, origem: "panteon" },
      { code: "TST", enterpriseId: "9001", nome: "ZZ TESTE", operadoPor: null, operadoPorNome: null, origem: "panteon" },
      // O do C2X mantém sigla e nome do legado, e ganha quem opera pelo cadastro.
      { code: "VOC", enterpriseId: "37", nome: "VALE DO OURO", operadoPor: "inc-cecilio", operadoPorNome: "Cecílio Rocha", origem: "c2x" },
    ]);
  });

  it("C2X fora do ar: o cadastro segura a lista, e a marca sai pelo id (>= 100000)", () => {
    const lista = mesclarEmpreendimentosDisponiveis({
      cadastro: CADASTRO,
      doC2x: null,
      nomesDosOperadores: NOMES,
    });
    const origem = Object.fromEntries(lista.map((e) => [e.code, e.origem]));
    expect(origem).toEqual({ GDN: "c2x", JAD: "panteon", RUB: "panteon", TST: "c2x", VOC: "c2x" });
  });

  it("cadastro fora do ar: a lista do C2X de sempre, sem operador", () => {
    const lista = mesclarEmpreendimentosDisponiveis({
      cadastro: null,
      doC2x: DO_C2X,
      nomesDosOperadores: NOMES,
    });
    expect(lista.map((e) => [e.code, e.origem, e.operadoPor])).toEqual([
      ["GDN", "c2x", null],
      ["VOC", "c2x", null],
    ]);
  });

  it("as duas fora: lista vazia (a tela já diz que dá para salvar e marcar depois)", () => {
    expect(
      mesclarEmpreendimentosDisponiveis({ cadastro: null, doC2x: null, nomesDosOperadores: new Map() }),
    ).toEqual([]);
  });
});

describe("vinculosSemRepeticao / vinculosParaApagar", () => {
  it("tira espaço, vazio e repetição; a carteira fica ligada se qualquer cópia pedia", () => {
    expect(
      vinculosSemRepeticao([
        { carteiraAdministrada: false, enterpriseId: "37" },
        { carteiraAdministrada: true, enterpriseId: " 37 " },
        { carteiraAdministrada: false, enterpriseId: "" },
        { enterpriseId: "100000" },
      ]),
    ).toEqual([
      { carteiraAdministrada: true, enterpriseId: "37" },
      { carteiraAdministrada: false, enterpriseId: "100000" },
    ]);
  });

  it("apaga só o que saiu da lista, comparando o valor cru gravado", () => {
    expect(vinculosParaApagar(["37", "100000", "99", " 39"], ["37", "100000", "39"])).toEqual([
      "99",
      " 39",
    ]);
    expect(vinculosParaApagar([], ["37"])).toEqual([]);
  });
});

// ── salvarIncorporador com um client falso que ANOTA a ordem ─────────────────
type Chamada = { filtros: Array<[string, string, unknown]>; op: string; tabela: string; valor?: unknown };

const banco = {
  chamadas: [] as Chamada[],
  falhaNoUpsert: false,
  gravados: [] as string[],
};

function clientFalso() {
  return {
    from(tabela: string) {
      const chamada: Chamada = { filtros: [], op: "", tabela };
      const builder = {
        delete() {
          chamada.op = "delete";
          return builder;
        },
        eq(coluna: string, valor: unknown) {
          chamada.filtros.push(["eq", coluna, valor]);
          return builder;
        },
        in(coluna: string, valor: unknown) {
          chamada.filtros.push(["in", coluna, valor]);
          return builder;
        },
        returns() {
          return builder;
        },
        select() {
          chamada.op ||= "select";
          return builder;
        },
        then(resolver: (valor: unknown) => unknown) {
          banco.chamadas.push(chamada);
          if (chamada.op === "upsert" && banco.falhaNoUpsert) {
            return Promise.resolve(resolver({ data: null, error: { message: "duplicate key" } }));
          }
          if (chamada.op === "select" && tabela === "apolo_incorporador_empreendimentos") {
            return Promise.resolve(
              resolver({ data: banco.gravados.map((enterprise_id) => ({ enterprise_id })), error: null }),
            );
          }
          return Promise.resolve(resolver({ data: null, error: null }));
        },
        update(valor: unknown) {
          chamada.op = "update";
          chamada.valor = valor;
          return builder;
        },
        upsert(valor: unknown) {
          chamada.op = "upsert";
          chamada.valor = valor;
          return builder;
        },
      };
      return builder;
    },
  } as unknown as Parameters<typeof salvarIncorporador>[0];
}

const EDITAR_CECILIO = {
  empreendimentos: [
    { carteiraAdministrada: true, enterpriseId: "37" },
    { carteiraAdministrada: false, enterpriseId: "100000" },
  ],
  id: "inc-cecilio",
  nome: "Cecílio Rocha",
  slug: "cecilio-rocha",
};

const doVinculo = () =>
  banco.chamadas.filter((c) => c.tabela === "apolo_incorporador_empreendimentos");

beforeEach(() => {
  banco.chamadas = [];
  banco.falhaNoUpsert = false;
  banco.gravados = ["37", "100000", "99"];
});

describe("salvarIncorporador · os vínculos", () => {
  it("⚠️ grava ANTES de apagar, e só apaga o que saiu da lista", async () => {
    const r = await salvarIncorporador(clientFalso(), EDITAR_CECILIO);
    expect(r).toEqual({ id: "inc-cecilio", ok: true });

    const ops = doVinculo().map((c) => c.op);
    expect(ops).toEqual(["select", "upsert", "delete"]);

    const upsert = doVinculo()[1];
    expect(upsert?.valor).toEqual([
      { carteira_administrada: true, enterprise_id: "37", incorporador_id: "inc-cecilio" },
      { carteira_administrada: false, enterprise_id: "100000", incorporador_id: "inc-cecilio" },
    ]);

    // O vínculo do produto do Panteon (100000) não entra na limpeza; só o 99, que saiu.
    const apagar = doVinculo()[2];
    expect(apagar?.filtros).toEqual([
      ["eq", "incorporador_id", "inc-cecilio"],
      ["in", "enterprise_id", ["99"]],
    ]);
  });

  it("⚠️ upsert falhou: NADA é apagado, e a tela recebe o erro", async () => {
    banco.falhaNoUpsert = true;
    const r = await salvarIncorporador(clientFalso(), EDITAR_CECILIO);
    expect(r.ok).toBe(false);
    expect(doVinculo().some((c) => c.op === "delete")).toBe(false);
  });

  it("⚠️ id repetido no corpo vira um vínculo só (antes derrubava o insert depois do delete)", async () => {
    await salvarIncorporador(clientFalso(), {
      ...EDITAR_CECILIO,
      empreendimentos: [...EDITAR_CECILIO.empreendimentos, { carteiraAdministrada: false, enterpriseId: "100000" }],
    });
    const upsert = doVinculo().find((c) => c.op === "upsert");
    expect((upsert?.valor as unknown[]).length).toBe(2);
  });

  it("nada saiu da lista: não há delete", async () => {
    banco.gravados = ["37", "100000"];
    await salvarIncorporador(clientFalso(), EDITAR_CECILIO);
    expect(doVinculo().map((c) => c.op)).toEqual(["select", "upsert"]);
  });

  it("⚠️ com os vínculos iniciais do formulário, o vínculo gravado depois da abertura NÃO é apagado", async () => {
    // O formulário abriu com 37, 100000 e 99; enquanto estava aberto o portal cadastrou o 100004.
    banco.gravados = ["37", "100000", "99", "100004"];
    await salvarIncorporador(clientFalso(), { ...EDITAR_CECILIO, vinculosIniciais: ["37", "100000", "99"] });
    const apagar = doVinculo().find((c) => c.op === "delete");
    expect(apagar?.filtros).toEqual([
      ["eq", "incorporador_id", "inc-cecilio"],
      ["in", "enterprise_id", ["99"]],
    ]);
  });

  it("vinculosParaApagar com iniciais: só sai o que a pessoa viu e desmarcou", () => {
    expect(vinculosParaApagar(["37", "99", "100004"], ["37"], ["37", "99"])).toEqual(["99"]);
    expect(vinculosParaApagar(["37", "99", "100004"], ["37"])).toEqual(["99", "100004"]);
  });

  it("⚠️ do corpo da tela ao servidor: a rota repassa os iniciais e o 100004 gravado depois fica", async () => {
    // O mesmo caminho da rota POST /api/apolo/incorporadores: o corpo passa por
    // `vinculosDoPortalNoCorpo` e vai espalhado para `salvarIncorporador`.
    banco.gravados = ["37", "100000", "99", "100004"];
    const corpo = {
      empreendimentos: [
        { carteiraAdministrada: true, enterpriseId: "37" },
        { carteiraAdministrada: false, enterpriseId: "100000" },
      ],
      vinculosIniciais: ["37", "100000", "99"],
    };
    await salvarIncorporador(clientFalso(), { ...EDITAR_CECILIO, ...vinculosDoPortalNoCorpo(corpo) });
    const apagar = doVinculo().find((c) => c.op === "delete");
    expect(apagar?.filtros).toEqual([
      ["eq", "incorporador_id", "inc-cecilio"],
      ["in", "enterprise_id", ["99"]],
    ]);
  });

  it("lista vazia de propósito: não grava nada e apaga tudo o que estava", async () => {
    await salvarIncorporador(clientFalso(), { ...EDITAR_CECILIO, empreendimentos: [] });
    const ops = doVinculo();
    expect(ops.map((c) => c.op)).toEqual(["select", "delete"]);
    expect(ops[1]?.filtros[1]).toEqual(["in", "enterprise_id", ["37", "100000", "99"]]);
  });
});
