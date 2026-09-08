import { describe, expect, it } from "vitest";

import { agrupar } from "@/lib/apolo/catalogo-empreendimentos";
import type { LinhaDoCadastro } from "@/lib/hercules/cadastro";

import { empreendimentosDoPortal } from "./empreendimentos-do-portal";
import { produtosDoPortal } from "./produtos-do-portal";

// O SELETOR DO FINANCEIRO — o que o Lucas viu em 08/09/2026 e o que ele passa a ver.
//
// ⚠️ O CATÁLOGO ABAIXO É O REAL, LIDO DO C2X EM 08/09/2026 (`select id, code, name from
// enterprises`, 37 linhas). O que importa aqui é o detalhe que causava o defeito: os QUATRO
// registros do Vale do Ouro têm o `name` EXATAMENTE igual — a string "VALE DO OURO" — e as três
// Lagoa Bonita vivas também. Sem isso o teste não reproduz a queixa.
//
// ⚠️ E O `agrupar` JÁ APLICA `ENTERPRISE_GROUPS`: VOC+VOL+VOR chegam como "group:Vale do Ouro"
// (entrou no commit 7cf0b6e3, hoje) e LBF+LBR+LBP como "group:Lagoa Bonita". O VLO (35) é ESPELHO
// e continua linha solta com o mesmo nome — é ele o segundo chip. O LAB (31) nem chega: está em
// `EXCLUDED_ENTERPRISE_CODES`.
const CATALOGO = agrupar([
  { code: "ACP", id: 42, name: "ALDEIA DAS CACHOEIRAS DAS PEDRAS" },
  { code: "JDG", id: 40, name: "JARDIM DAS GERAIS" },
  { code: "LBF", id: 33, name: "LAGOA BONITA" },
  { code: "LBP", id: 32, name: "LAGOA BONITA" },
  { code: "LBR", id: 27, name: "LAGOA BONITA" },
  { code: "RDV", id: 43, name: "RECANTO DO VALE" },
  { code: "REP", id: 20, name: "CONDOMINIO RECANTO DO PARA" },
  { code: "VAL", id: 29, name: "VISTA ALEGRE" },
  { code: "VDO", id: 19, name: "VEREDAS DO OURO" },
  { code: "VLO", id: 35, name: "VALE DO OURO" },
  { code: "VOC", id: 37, name: "VALE DO OURO" },
  { code: "VOL", id: 36, name: "VALE DO OURO" },
  { code: "VOR", id: 41, name: "VALE DO OURO" },
]);

const linha = (
  p: Partial<LinhaDoCadastro> & { codigo: string; id: string },
): LinhaDoCadastro => ({
  c2xEnterpriseId: null,
  cidade: null,
  nome: p.codigo,
  ordem: 0,
  paiId: null,
  uf: null,
  vendendo: true,
  ...p,
});

// O cadastro REAL de `hercules_empreendimentos` (lido em 08/09/2026), recortado nas linhas que a
// sessão do Lucas no /comercial/gurgel alcança. O VLO é o PAI do Vale do Ouro (espelho, c2x 35) e
// o LAB é o pai da Lagoa Bonita (espelho, c2x 31).
const CADASTRO: LinhaDoCadastro[] = [
  linha({ c2xEnterpriseId: "35", codigo: "VLO", id: "uuid-vlo", nome: "Vale do Ouro", ordem: 5 }),
  linha({
    c2xEnterpriseId: "37",
    codigo: "VOC",
    id: "uuid-voc",
    nome: "Vale do Ouro · VOC",
    ordem: 0,
    paiId: "uuid-vlo",
  }),
  linha({
    c2xEnterpriseId: "36",
    codigo: "VOL",
    id: "uuid-vol",
    nome: "Vale do Ouro · VOL",
    ordem: 1,
    paiId: "uuid-vlo",
  }),
  linha({
    c2xEnterpriseId: "41",
    codigo: "VOR",
    id: "uuid-vor",
    nome: "Vale do Ouro · VOR",
    ordem: 2,
    paiId: "uuid-vlo",
  }),
  linha({ c2xEnterpriseId: "31", codigo: "LAB", id: "uuid-lab", nome: "Lagoa Bonita", ordem: 3 }),
  linha({
    c2xEnterpriseId: "33",
    codigo: "LBF",
    id: "uuid-lbf",
    nome: "Lagoa Bonita · LBF",
    ordem: 0,
    paiId: "uuid-lab",
  }),
  linha({
    c2xEnterpriseId: "32",
    codigo: "LBP",
    id: "uuid-lbp",
    nome: "Lagoa Bonita · LBP",
    ordem: 1,
    paiId: "uuid-lab",
  }),
  linha({
    c2xEnterpriseId: "27",
    codigo: "LBR",
    id: "uuid-lbr",
    nome: "Lagoa Bonita · LBR",
    ordem: 2,
    paiId: "uuid-lab",
  }),
  linha({ c2xEnterpriseId: "19", codigo: "VDO", id: "uuid-vdo", nome: "Veredas do Ouro", ordem: 6 }),
  linha({ c2xEnterpriseId: "20", codigo: "REP", id: "uuid-rep", nome: "Recanto do Pará", ordem: 4 }),
  linha({ c2xEnterpriseId: "29", codigo: "VAL", id: "uuid-val", nome: "Vista Alegre", ordem: 8 }),
  linha({
    c2xEnterpriseId: "40",
    codigo: "JDG",
    id: "uuid-jdg",
    nome: "Jardim das Gerais",
    ordem: 2,
  }),
  linha({
    c2xEnterpriseId: "42",
    codigo: "ACP",
    id: "uuid-acp",
    nome: "Aldeia das Cachoeiras das Pedras",
    ordem: 0,
  }),
  linha({ c2xEnterpriseId: "43", codigo: "RDV", id: "uuid-rdv", nome: "Recanto do Vale", ordem: 19 }),
  // ⚠️ EXISTE NO PANTEON E NÃO EXISTE NO C2X (medido: nenhum dos 37 `enterprises` tem id 9001).
  linha({
    c2xEnterpriseId: "9001",
    codigo: "TST",
    id: "uuid-tst",
    nome: "ZZ TESTE - nao e empreendimento real",
    ordem: 999,
  }),
];

/**
 * A sessão do Lucas no /comercial/gurgel, como `idsDaSessao` a expande: os ids do token mais os
 * ids de grupo/divisão equivalentes. Os ids do token são 19, 20, 27, 29, 31, 32, 33, 35, 36, 37,
 * 40, 41, 42, 43 e 9001.
 */
const PERMITIDOS = new Set([
  "19",
  "20",
  "27",
  "29",
  "31",
  "32",
  "33",
  "35",
  "36",
  "37",
  "40",
  "41",
  "42",
  "43",
  "9001",
  "group:Lagoa Bonita",
  "group:Vale do Ouro",
]);

/** O que `codigosDaSessao` devolve para essa mesma sessão (o LAB e o 9001 não viram código). */
const CODES = [
  "ACP",
  "JDG",
  "LBF",
  "LBP",
  "LBR",
  "RDV",
  "REP",
  "VAL",
  "VDO",
  "VLO",
  "VOC",
  "VOL",
  "VOR",
];

function montar(
  permitidos = PERMITIDOS,
  codes = CODES,
  cadastro = CADASTRO,
) {
  return produtosDoPortal({
    cadastro,
    catalogo: CATALOGO,
    codesAutorizados: codes,
    doCatalogo: empreendimentosDoPortal(CATALOGO, codes),
    permitidos,
  });
}

describe("o seletor de hoje (lista fixa em código) — o defeito que o Lucas viu", () => {
  it("⚠️ MOSTRA DOIS 'Vale do Ouro', e o segundo é o espelho", () => {
    // É exatamente o que `empreendimentosDoPortal` devolve hoje na rota da carteira: o grupo
    // (VOC+VOL+VOR) e o VLO solto, com o MESMO rótulo. O commit 7cf0b6e3 tirou a tela de quatro
    // chips para dois; este teste trava o "dois" para o de baixo provar que virou um.
    const nomes = empreendimentosDoPortal(CATALOGO, CODES).map((emp) => emp.nome);
    expect(nomes.filter((nome) => nome === "Vale do Ouro")).toHaveLength(2);
  });
});

describe("produtosDoPortal · a sessão do Lucas no gurgel", () => {
  const produtos = montar();

  it("(a) O VALE DO OURO VIRA UMA LINHA SÓ, com VOC + VOL + VOR dentro", () => {
    const doVale = produtos.filter((p) => p.nome === "Vale do Ouro");

    expect(doVale).toHaveLength(1);
    expect(doVale[0]!.id).toBe("pai:uuid-vlo");
    expect(doVale[0]!.filhos.map((f) => f.codigo).sort()).toEqual(["VOC", "VOL", "VOR"]);
    expect([...doVale[0]!.codes].sort()).toEqual(["VOC", "VOL", "VOR"]);
  });

  it("⚠️ O ESPELHO NÃO VIRA UM SEGUNDO CHIP: o VLO sai da lista, não do cadastro", () => {
    // O VLO continua em `hercules_empreendimentos` (é ele o PAI acima) — o que ele não faz é
    // aparecer ao lado dos próprios filhos com o mesmo nome. Medido em 08/09/2026: o VLO tem ZERO
    // parcelas em carteira ativa (VOC 13.242 · VOL 13.150 · VOR 104), então esse chip abria vazio.
    expect(produtos.some((p) => p.codes.includes("VLO"))).toBe(false);
    expect(CADASTRO.some((l) => l.codigo === "VLO" && l.paiId === null)).toBe(true);
  });

  it("⚠️ e a soma de 'Todos' é a dos PRODUTOS: o espelho não entra duas vezes", () => {
    // É esta lista que a rota manda para a leitura da carteira quando nenhum chip está escolhido.
    // Somar pai e filhos contaria o mesmo loteamento duas vezes — o erro que já mordeu o
    // consolidado do Apolo (4.560 unidades onde o certo eram 4.262).
    const soma = [...new Set(produtos.flatMap((p) => p.codes))].sort();

    expect(soma).toEqual(CODES.filter((code) => code !== "VLO").sort());
  });

  it("a Lagoa Bonita segue a MESMA regra: uma linha, três recortes", () => {
    const lagoa = produtos.filter((p) => p.nome === "Lagoa Bonita");

    expect(lagoa).toHaveLength(1);
    expect(lagoa[0]!.filhos.map((f) => f.codigo).sort()).toEqual(["LBF", "LBP", "LBR"]);
  });

  it("⚠️ PRODUTO SEM CÓDIGO NO C2X NÃO VIRA CHIP (o ZZ TESTE, c2x 9001)", () => {
    // A carteira é lida por CÓDIGO do C2X, e o 9001 não existe entre os 37 `enterprises`. Um chip
    // para ele abriria vazio — a mesma queixa do segundo "Vale do Ouro".
    expect(produtos.some((p) => p.nome.startsWith("ZZ TESTE"))).toBe(false);
  });

  it("são OITO produtos, sem nome repetido e sem sobra do catálogo", () => {
    expect(produtos.map((p) => p.nome)).toEqual([
      "Aldeia das Cachoeiras das Pedras",
      "Jardim das Gerais",
      "Lagoa Bonita",
      "Recanto do Pará",
      "Recanto do Vale",
      "Vale do Ouro",
      "Veredas do Ouro",
      "Vista Alegre",
    ]);
  });

  it("todo produto resolve em pelo menos um código autorizado", () => {
    const autorizados = new Set(CODES);
    for (const produto of produtos) {
      expect(produto.codes.length).toBeGreaterThan(0);
      for (const code of produto.codes) expect(autorizados.has(code)).toBe(true);
    }
  });
});

// ⚠️ A ASSIMETRIA DO ESCOPO É REGRA DE NEGÓCIO, e não detalhe de implementação: um id de GRUPO
// abre as divisões, mas um id de DIVISÃO vale SÓ por ela. Cada divisão é a carteira de um dono
// diferente (VOC é do Cecílio, VOL da família Lino). Agrupar pelo pai não pode afrouxar isso —
// seria entregar a carteira de um ao outro. Ver `escopo.ts` e `escopo.test.ts`.
describe("produtosDoPortal · o escopo não afrouxa", () => {
  it("(c) sessão que só tem a divisão 37 (VOC) vê o produto, e SÓ o VOC dentro dele", () => {
    const produtos = montar(new Set(["37"]), ["VOC"]);

    expect(produtos).toHaveLength(1);
    expect(produtos[0]!.nome).toBe("Vale do Ouro");
    expect(produtos[0]!.codes).toEqual(["VOC"]);
    expect(produtos[0]!.filhos.map((f) => f.codigo)).toEqual(["VOC"]);
  });

  it("quem tem a gleba do Fernando (LBF) não recebe a do Raposo dentro do pai", () => {
    const produtos = montar(new Set(["33"]), ["LBF"]);

    expect(produtos.map((p) => p.nome)).toEqual(["Lagoa Bonita"]);
    expect(produtos[0]!.codes).toEqual(["LBF"]);
    expect(produtos[0]!.filhos.map((f) => f.codigo)).toEqual(["LBF"]);
  });

  it("fail-closed: id alcançado pela sessão mas código fora da lista não vira produto", () => {
    // As duas camadas continuam de pé — a expansão pelo escopo E o cruzamento com os códigos
    // autorizados. Aqui a sessão alcança o 37, mas o VOC não está entre os códigos: o Vale do
    // Ouro não aparece. (O JDG que sobra é o residual do catálogo, montado sobre a MESMA lista de
    // códigos — ele não vem do escopo expandido.)
    const produtos = montar(new Set(["37"]), ["JDG"]);

    expect(produtos.some((p) => p.nome === "Vale do Ouro")).toBe(false);
    expect(produtos.flatMap((p) => p.codes)).toEqual(["JDG"]);
  });

  it("a sessão que só alcança o ESPELHO continua vendo o Vale do Ouro (pelo 35)", () => {
    // É a sessão antiga, com o vínculo feito no 35 e não em VOC/VOL/VOR. Zero seria mentira maior:
    // o 35 está autorizado, e é o único número que ela tem direito de ver.
    const produtos = montar(new Set(["35"]), ["VLO"]);

    expect(produtos).toHaveLength(1);
    expect(produtos[0]!.nome).toBe("Vale do Ouro");
    expect(produtos[0]!.codes).toEqual(["VLO"]);
    expect(produtos[0]!.filhos).toEqual([]);
  });
});

describe("produtosDoPortal · cadastro fora do ar", () => {
  it("degrada para a lista do catálogo, e não derruba a tela", () => {
    const produtos = montar(PERMITIDOS, CODES, []);
    const doCatalogo = empreendimentosDoPortal(CATALOGO, CODES);

    expect(produtos.map((p) => p.id).sort()).toEqual(doCatalogo.map((e) => e.id).sort());
  });
});
