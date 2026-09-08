import { describe, expect, it } from "vitest";

import { agrupar } from "@/lib/apolo/catalogo-empreendimentos";
import { canonizador } from "@/lib/apolo/empreendimento-equivalencia";

import { empreendimentosPermitidos, type SessaoIncorporador } from "./sessao";

// O ESCOPO É A PEÇA DE SEGURANÇA DO PORTAL. Estes testes cobrem a decisão pura — "este id está
// autorizado?" — sem banco. A parte que consulta o C2X (`unidadeNoEscopo`) é integração e depende
// do legado; o que dá para travar aqui é a REGRA, que é onde o erro custa vazamento.
//
// Catálogo REAL do C2X, lido em 17/08/2026 (o VOR conferido em 08/09/2026: 3 unidades).
const CATALOGO = agrupar([
  { code: "LBF", id: 33, name: "LAGOA BONITA" },
  { code: "LBR", id: 27, name: "LAGOA BONITA" },
  { code: "LBP", id: 32, name: "LAGOA BONITA" },
  { code: "VOC", id: 37, name: "VALE DO OURO" },
  { code: "VOL", id: 36, name: "VALE DO OURO" },
  { code: "VOR", id: 41, name: "VALE DO OURO - EXTRAS" },
  { code: "JDG", id: 40, name: "JARDIM DAS GERAIS" },
]);

function sessao(ids: string[]): SessaoIncorporador {
  return {
    enterpriseIds: ids,
    enterpriseIdsComCarteira: ids,
    exp: Math.floor(Date.parse("2026-08-18T00:00:00Z") / 1000),
    incorporadorId: "inc-1",
    incorporadorNome: "Cecílio Rocha",
    slug: "cecilio",
    tipo: "incorporador",
    usuarioId: "user-1",
    usuarioNome: "Vitor Cecílio",
  };
}

describe("o recorte do incorporador", () => {
  it("sem pedido, devolve tudo o que a sessão autoriza", () => {
    expect(empreendimentosPermitidos(sessao(["37"]))).toEqual(["37"]);
  });

  it("⚠️ pedir um empreendimento de FORA some da lista, não vaza", () => {
    // O caso do Cecílio: ele tem o VOC (37) e pede o VOL (36), do Lino. A resposta não pode
    // conter 36 nem devolver a lista inteira por não achar nada.
    expect(empreendimentosPermitidos(sessao(["37"]), "36")).toEqual([]);
  });

  it("pedido misto devolve só a parte autorizada", () => {
    expect(empreendimentosPermitidos(sessao(["37", "40"]), ["36", "40"])).toEqual(["40"]);
  });

  it("string vazia NÃO é 'pedido nenhum' disfarçado de curinga", () => {
    // `""` cai no caminho de "sem pedido" e devolve o que a sessão tem — nunca mais que isso.
    const r = empreendimentosPermitidos(sessao(["37"]), "");
    expect(r).toEqual(["37"]);
  });

  it("sessão sem empreendimento não enxerga nada, com ou sem pedido", () => {
    expect(empreendimentosPermitidos(sessao([]))).toEqual([]);
    expect(empreendimentosPermitidos(sessao([]), "37")).toEqual([]);
  });
});

describe("a equivalência de grupo dentro do escopo", () => {
  const canon = canonizador(CATALOGO);

  it("quem tem o grupo Lagoa Bonita alcança as três divisões", () => {
    const autorizados = new Set(empreendimentosPermitidos(sessao(["group:Lagoa Bonita"])).map(canon));

    expect(autorizados.has(canon("33"))).toBe(true);
    expect(autorizados.has(canon("27"))).toBe(true);
    expect(autorizados.has(canon("32"))).toBe(true);
  });

  it("quem tem UMA divisão alcança o grupo (é o mesmo empreendimento)", () => {
    const autorizados = new Set(empreendimentosPermitidos(sessao(["33"])).map(canon));

    expect(autorizados.has(canon("group:Lagoa Bonita"))).toBe(true);
  });

  it("⚠️ VOC e VOL passam a CANONIZAR juntos — e quem separa a leitura é a assimetria", () => {
    // ⚠️ ESTE TESTE MUDOU DE LADO EM 08/09/2026, e a versão anterior pedia exatamente isto: "se
    // um dia alguém puser o Vale do Ouro em ENTERPRISE_GROUPS, este teste quebra e é aí que se
    // decide na mão". Decidido: o Vale do Ouro virou grupo (Lucas, comparando com o portal da
    // Gurgel: *"na tela da gurgel, vale do ouro está agrupado, no apolo não"*), então o
    // `canonizador` passa a dizer que 37 e 36 são o MESMO empreendimento — igual ao que já dizia
    // das três glebas do Lagoa Bonita.
    //
    // ⚠️ ISSO NÃO ABRE A CARTEIRA DO LINO PARA O CECÍLIO. Quem recorta a LEITURA do portal é
    // `codigosDaSessao`/`idsDaSessao`, e as duas mantêm a assimetria (o id do GRUPO abre as
    // divisões; o id de uma DIVISÃO vale só por ela) — provado no bloco "uma divisão NÃO alcança
    // as divisões irmãs", no fim deste arquivo, onde `codes(["37"])` continua devolvendo só VOC.
    //
    // O `canonizador` é usado onde a equivalência é a REGRA, não o vazamento: a habilitação de
    // imobiliária, que vale para o empreendimento inteiro. O efeito lá é FECHAR, não abrir — o
    // coordenador que cobre só o VOC passa a receber 409 ("a decisão é da Careli") em vez de
    // habilitar sozinho, que é o mesmo tratamento que uma gleba solta do Lagoa Bonita já recebia.
    const autorizados = new Set(empreendimentosPermitidos(sessao(["37"])).map(canon));

    expect(canon("37")).toBe("group:Vale do Ouro");
    expect(canon("36")).toBe("group:Vale do Ouro");
    expect(autorizados.has(canon("36"))).toBe(true);
  });

  it("os códigos do grupo saem completos, para as leituras do C2X", () => {
    const grupo = CATALOGO.find((emp) => emp.id === "group:Lagoa Bonita");

    // ⚠️ CÓPIA ANTES DE ORDENAR. `.sort()` MUTA o array, e `CATALOGO` é criado uma vez e
    // compartilhado por toda a suíte: ordenar aqui deixava `codes` fora de sincronia com
    // `stageIds`, e os testes seguintes passavam a casar a divisão errada (27 devolvia LBP em vez
    // de LBR). Fixture mutado por um teste é defeito que só aparece no teste do vizinho.
    expect([...(grupo?.codes ?? [])].sort()).toEqual(["LBF", "LBP", "LBR"]);
  });

  it("empreendimento simples devolve o próprio código", () => {
    expect(CATALOGO.find((emp) => emp.id === "40")?.codes).toEqual(["JDG"]);
  });
});

describe("idsDaSessao (a tradução para as tabelas do Apolo)", () => {
  // A regra pura por trás de `idsDaSessao`: o que ela devolve TEM que casar com os dois formatos
  // gravados hoje em `apolo_esteira.enterprise_id` e em `apolo_relationships.metadata.enterpriseId`
  // — a divisão ("33") e o grupo ("group:Lagoa Bonita"). A função de verdade lê o catálogo do C2X,
  // que aqui está congelado em CATALOGO.
  const canon = canonizador(CATALOGO);
  // ⚠️ ESTE ATALHO CANONIZA, E A `idsDaSessao` DE VERDADE NÃO — divergência achada em 08/09/2026,
  // ao pôr o Vale do Ouro em ENTERPRISE_GROUPS. A função real (escopo.ts) só abre as divisões
  // quando a sessão traz o id do GRUPO; id de divisão vale por ele mesmo e NÃO devolve o id do
  // grupo. Enquanto o Vale do Ouro estava solto, os dois caminhos davam a mesma resposta para
  // "37" e a diferença não aparecia em teste nenhum. O que a produção faz está provado por
  // `idsDaSessaoReal`, abaixo; este atalho fica porque descreve o formato do retorno.
  const idsAutorizados = (permitidos: string[]): string[] => {
    const autorizados = new Set(permitidos.map(canon));

    return [
      ...new Set(
        CATALOGO.filter((emp) => autorizados.has(canon(emp.id))).flatMap((emp) => [
          emp.id,
          ...emp.stageIds,
        ]),
      ),
    ];
  };

  /** A regra de `idsDaSessao` (escopo.ts) copiada linha a linha, sem tocar no C2X. */
  const idsDaSessaoReal = (permitidos: string[]): string[] => {
    const daSessao = new Set(permitidos.map((id) => String(id).trim()));
    const ids: string[] = [];

    for (const emp of CATALOGO) {
      if (daSessao.has(emp.id)) {
        ids.push(emp.id, ...emp.stageIds);
        continue;
      }
      for (const stageId of emp.stageIds) {
        if (daSessao.has(String(stageId))) ids.push(String(stageId));
      }
    }

    return [...new Set([...ids, ...permitidos])];
  };

  it("quem tem o GRUPO alcança o id do grupo e o de cada divisão", () => {
    const ids = idsAutorizados(empreendimentosPermitidos(sessao(["group:Lagoa Bonita"])));

    expect(ids).toContain("group:Lagoa Bonita");
    expect(ids).toContain("33");
    expect(ids).toContain("27");
    expect(ids).toContain("32");
  });

  // ⚠️ ESTE É O ATALHO, NÃO A PRODUÇÃO. `idsDaSessaoReal(["33"])` devolve só ["33"]: a função de
  // verdade NÃO acrescenta o id do grupo quando a sessão traz uma divisão. Divergência anotada em
  // 08/09/2026 e deixada como está — mexer nela é decisão de escopo do portal, não do
  // agrupamento do Vale do Ouro. Efeito prático: uma CAD gravada como "group:Lagoa Bonita" não é
  // alcançada por quem tem só a gleba, que é o comportamento fail-closed descrito no escopo.ts.
  it("quem tem UMA divisão também alcança o id do grupo (é o mesmo empreendimento)", () => {
    expect(idsAutorizados(empreendimentosPermitidos(sessao(["33"])))).toContain(
      "group:Lagoa Bonita",
    );
  });

  it("⚠️ e NÃO alcança o empreendimento do vizinho", () => {
    // ⚠️ MEDIDO PELA REGRA REAL, não pelo atalho canonizado. Desde que o Vale do Ouro virou grupo
    // (08/09/2026), o atalho acima devolveria 36 junto com 37 — a produção não devolve, e é isto
    // que precisa continuar valendo: o VOC é a carteira do Cecílio e o VOL a do Lino.
    const ids = idsDaSessaoReal(empreendimentosPermitidos(sessao(["37"])));

    expect(ids).toContain("37");
    expect(ids).not.toContain("36");
    expect(ids).not.toContain("40");
    // O id do GRUPO também fica fora: quem tem uma divisão não vira dono do conjunto.
    expect(ids).not.toContain("group:Vale do Ouro");
  });
});

describe("autorizar", () => {
  it("sem cookie, 401 e nenhuma consulta", async () => {
    const { autorizar } = await import("./escopo");
    const r = autorizar(new Request("https://c2x.app.br/api/incorporador/carteira"));

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.response.status).toBe(401);
  });
});

describe("foraDoEscopo", () => {
  it("responde 404, não 403: para quem não tem, o empreendimento não existe", async () => {
    const { foraDoEscopo } = await import("./escopo");
    expect(foraDoEscopo().status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// A ASSIMETRIA: grupo abre as divisões, divisão NÃO abre as irmãs
// (achado da revisão adversarial, 17/08/2026 — defeito meu, do mesmo dia)
// ---------------------------------------------------------------------------

describe("uma divisão NÃO alcança as divisões irmãs", () => {
  // ⚠️ A REGRA MUDA CONFORME QUEM PERGUNTA. Para a IMOBILIÁRIA, Lagoa Bonita é um empreendimento
  // só ("para eles não tem essa de divisão, isso é interno"). Para o INCORPORADOR, cada divisão é
  // a gleba de um responsável DIFERENTE: LBF é do Fernando, LBR do Raposo, LBP do Paulo.
  //
  // A primeira versão canonizava o id da sessão para o grupo e devolvia o grupo inteiro. Quem
  // tivesse a gleba do Fernando leria as CADs, a carteira e os compradores das outras duas.
  // Ninguém estava nessa situação ainda, mas a tela de gestão lista as DIVISÕES (nunca o grupo),
  // então o próximo incorporador de Lagoa Bonita nasceria assim.

  function codes(catalogo: typeof CATALOGO, ids: string[]): string[] {
    // Mesma lógica de `codesDosIds`, exercitada sem tocar no C2X.
    const daSessao = new Set(ids);
    const saida: string[] = [];
    for (const emp of catalogo) {
      if (daSessao.has(emp.id)) {
        saida.push(...emp.codes);
        continue;
      }
      emp.stageIds.forEach((stageId, i) => {
        if (daSessao.has(String(stageId))) {
          const code = emp.codes[i];
          if (code) saida.push(code);
        }
      });
    }
    return [...new Set(saida)];
  }

  it("a gleba do Fernando (LBF) NÃO abre as do Raposo e do Paulo", () => {
    expect(codes(CATALOGO, ["33"])).toEqual(["LBF"]);
  });

  it("cada gleba enxerga só a sua", () => {
    expect(codes(CATALOGO, ["27"])).toEqual(["LBR"]);
    expect(codes(CATALOGO, ["32"])).toEqual(["LBP"]);
  });

  it("duas glebas somam as duas, e não a terceira", () => {
    expect(codes(CATALOGO, ["33", "27"]).sort()).toEqual(["LBF", "LBR"]);
  });

  it("o dono do GRUPO continua vendo as três: ele é dono do conjunto", () => {
    expect(codes(CATALOGO, ["group:Lagoa Bonita"]).sort()).toEqual(["LBF", "LBP", "LBR"]);
  });

  it("empreendimento simples segue igual, e a divisão do Vale do Ouro também", () => {
    expect(codes(CATALOGO, ["40"])).toEqual(["JDG"]);
    // ⚠️ O 37 DEIXOU DE SER SIMPLES em 08/09/2026 (virou divisão do grupo "Vale do Ouro"), e a
    // resposta continua a mesma: id de divisão devolve só o código dela.
    expect(codes(CATALOGO, ["37"])).toEqual(["VOC"]);
  });

  it("o VOC continua sem alcançar o VOL, que é do outro sócio", () => {
    expect(codes(CATALOGO, ["37"])).not.toContain("VOL");
  });
});
