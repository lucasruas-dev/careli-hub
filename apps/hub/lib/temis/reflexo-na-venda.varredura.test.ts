import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import ts from "typescript";
import { describe, expect, it } from "vitest";

import { etapaDaVendaParaOCard } from "@/lib/hercules/reflexo-da-temis";
import { ESTAGIOS } from "@/lib/temis/trabalhos";

// A GARANTIA ESCRITA, PONTO DE ESCRITA POR PONTO DE ESCRITA.
//
// Lucas, 24/09/2026: *"preciso garantir que tudo que acontece na temis reflete no hercules"* e
// *"lembrando que quando tem cancelamento a unidade tem que ficar disponivel, tem que ter esse
// reflexo"*. Medido em produção em 24/09/2026: os 5 envios para assinatura de 23/09 moveram o card e
// deixaram a venda em `contrato`, porque `moverCardDaTemis` só mexia no card.
//
// ⚠️ A VERSÃO ANTERIOR APROVAVA O ARQUIVO INTEIRO (revisão de 24/09/2026). Bastava uma chamada a
// `refletirCardNaVenda` em qualquer lugar do arquivo, e `trabalho-servico.ts` e
// `concluir-cancelamento-server.ts` estavam isentos por inteiro: uma função nova, no mesmo arquivo,
// movendo o card sem reflexo, passava. Agora a varredura lê a árvore do TypeScript e confere CADA
// `update` pela FUNÇÃO nomeada que o contém:
//
//   PARTE 1. Todo `update` em `temis_trabalhos` que grava `estagio` está numa função que chama
//            `refletirCardNaVenda`, ou é exceção nomeada (arquivo#função:estágio) com o motivo e com
//            o dono da venda que a função chama no lugar.
//   PARTE 2. Todo `update` que leva `hercules_propostas.etapa` para `cancelado` ou `distrato` está
//            numa função que chama `soltarLoteDaVendaDesfeita`, `devolverCadastroDaUnidade` ou
//            `devolverCadastroSeNaoHaOutroDono`, ou é exceção nomeada com o motivo.
//
// ⚠️ O QUE A VARREDURA NÃO CONSEGUE LER, ELA RECUSA. Payload que não é objeto literal nem variável
// montada na própria função, e etapa calculada (sem texto literal), entram só pela lista com motivo.

const RAIZ = join(__dirname, "..", "..");

// ── AS EXCEÇÕES, CADA UMA COM O MOTIVO E COM O DONO QUE A FUNÇÃO CHAMA NO LUGAR ──────────────

type Excecao = { chama: string; motivo: string };

/** PARTE 1. Chave: `arquivo#função:estágio` (o valor literal gravado em `estagio`, ou `*`). */
const CARD_SEM_REFLEXO: Record<string, Excecao> = {
  // O Indeferir tem dono próprio da venda, com as guardas de pedido aberto, outro card aberto e
  // envelope vivo (indeferimento-na-venda-server.ts). `etapaDaVendaParaOCard` devolve null para
  // `indeferido` de propósito.
  "lib/temis/trabalho-servico.ts#decidirSobreOTrabalho:indeferido": {
    chama: "devolverVendaNoIndeferimento",
    motivo: "o indeferimento devolve a venda a quem vendeu por devolverVendaNoIndeferimento",
  },
  // O motor da conclusão é o DONO da venda no cancelamento e no distrato: derruba a venda no passo 1
  // (comparar-e-trocar com a etapa lida) e só DEPOIS indefere o card de contrato irmão.
  "lib/hercules/concluir-cancelamento-server.ts#concluirCancelamentoDoCard:indeferido": {
    chama: "soltarLoteDaVendaDesfeita",
    motivo: "o motor derrubou a venda antes de indeferir o contrato irmão, e solta o lote",
  },
  // O card do pedido vai a Concluído no fim do mesmo motor: a venda já caiu no passo 1, e o reflexo
  // de card de pedido é sempre nulo (`etapaDaVendaParaOCard` só reflete o tipo `contrato`).
  "lib/hercules/concluir-cancelamento-server.ts#concluirCancelamentoDoCard:faturado": {
    chama: "soltarLoteDaVendaDesfeita",
    motivo: "o card do pedido conclui depois de o motor derrubar a venda e soltar o lote",
  },
};

/** PARTE 2. Chave: `arquivo#função`. */
const VENDA_DESFEITA_SEM_SOLTURA: Record<string, Excecao> = {
  // A cópia do C2X é o reflexo, na carga antiga, da MESMA venda que o motor acabou de derrubar (e
  // cujo lote o motor solta): ela só é encerrada em `reservado`, e nunca foi dona do lote no Panteon.
  "lib/hercules/concluir-cancelamento-server.ts#encerrarCopiasDoC2x": {
    chama: "",
    motivo: "encerra a cópia do C2X da venda que o motor já derrubou; quem solta o lote é o motor",
  },
};

/** PARTE 2. Etapa gravada por expressão sem texto literal. Chave: `arquivo#função`. */
const ETAPA_CALCULADA: Record<string, string> = {
  // O destino vem da tabela `etapaDaVendaParaOCard`, e o teste abaixo prova que ela nunca devolve
  // `cancelado` nem `distrato`.
  "lib/hercules/reflexo-da-temis-server.ts#refletirCardNaVenda": "o destino da tabela de tradução",
};

const SOLTAM_O_LOTE = ["soltarLoteDaVendaDesfeita", "devolverCadastroDaUnidade", "devolverCadastroSeNaoHaOutroDono"];

// ── A LEITURA DA ÁRVORE ─────────────────────────────────────────────────────────

/** Um `update` em uma das duas tabelas, com a função nomeada que o contém. */
type PontoDeEscrita = {
  /** Os nomes chamados dentro da função (qualquer profundidade). */
  chamadas: Set<string>;
  funcao: string;
  linha: number;
  /** O que a escrita grava na coluna que interessa. `null` = não grava a coluna. */
  grava: null | { literais: string[]; texto: string };
  /** O payload não pôde ser lido (nem objeto literal, nem variável montada na função). */
  ilegivel: boolean;
  tabela: "desconhecida" | "hercules_propostas" | "temis_trabalhos";
};

const COLUNA = { hercules_propostas: "etapa", temis_trabalhos: "estagio" } as const;

function funcaoNomeada(no: ts.Node): null | { corpo: ts.Node; nome: string } {
  for (let n: ts.Node | undefined = no.parent; n; n = n.parent) {
    if (ts.isFunctionDeclaration(n) && n.name) return { corpo: n, nome: n.name.text };
    if (ts.isMethodDeclaration(n)) return { corpo: n, nome: n.name.getText() };
    if ((ts.isArrowFunction(n) || ts.isFunctionExpression(n)) && ts.isVariableDeclaration(n.parent)) {
      return { corpo: n, nome: n.parent.name.getText() };
    }
  }
  return null;
}

/**
 * A tabela do `.update()`, subindo a cadeia até o `from()`.
 *
 * ⚠️ "NÃO SEI" NÃO É "NÃO É COMIGO" (revisão de 24/09/2026). Antes, argumento que não fosse texto
 * literal devolvia `null` e o ponto era DESCARTADO em silêncio: `from(TABELA).update({ estagio })`
 * — formato já usado na casa (apolo/enterprise-settings.ts) — passava sem veredito nenhum. Agora a
 * constante é resolvida no módulo, e o que sobra volta como `"desconhecida"`, que vira problema.
 * `null` fica só para a cadeia que não tem `from()` nenhum (um `.update()` que não é do Supabase).
 */
function tabelaDaCadeia(no: ts.Expression, sf: ts.SourceFile): null | string {
  let alvo: ts.Node = no;
  for (;;) {
    if (ts.isCallExpression(alvo)) {
      const chamado = alvo.expression;
      if (ts.isPropertyAccessExpression(chamado) && chamado.name.text === "from") {
        const primeiro = alvo.arguments[0];
        if (!primeiro) return "desconhecida";
        if (ts.isStringLiteral(primeiro) || ts.isNoSubstitutionTemplateLiteral(primeiro)) return primeiro.text;
        if (ts.isIdentifier(primeiro)) {
          const origem = resolverNoCorpo(sf, primeiro.text);
          if (origem && (ts.isStringLiteral(origem) || ts.isNoSubstitutionTemplateLiteral(origem))) return origem.text;
        }
        return "desconhecida";
      }
      alvo = chamado;
    } else if (ts.isPropertyAccessExpression(alvo) || ts.isParenthesizedExpression(alvo) || ts.isAwaitExpression(alvo)) {
      alvo = alvo.expression;
    } else {
      return null;
    }
  }
}

function literaisDe(no: ts.Node): string[] {
  const saida: string[] = [];
  const visitar = (n: ts.Node) => {
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) saida.push(n.text);
    ts.forEachChild(n, visitar);
  };
  visitar(no);
  return saida;
}

/** O valor gravado na coluna, por um objeto literal. `undefined` = o objeto não tem a coluna. */
function valorNoObjeto(obj: ts.ObjectLiteralExpression, coluna: string): ts.Node | undefined {
  for (const p of obj.properties) {
    if (ts.isPropertyAssignment(p) && p.name.getText().replace(/["']/g, "") === coluna) return p.initializer;
    if (ts.isShorthandPropertyAssignment(p) && p.name.text === coluna) return p.name;
  }
  return undefined;
}

/** Resolve uma variável dentro da função: `const x = "..."` (para ler literais do valor). */
function resolverNoCorpo(corpo: ts.Node, nome: string): ts.Node | undefined {
  let achado: ts.Node | undefined;
  const visitar = (n: ts.Node) => {
    if (!achado && ts.isVariableDeclaration(n) && n.name.getText() === nome && n.initializer) achado = n.initializer;
    ts.forEachChild(n, visitar);
  };
  visitar(corpo);
  return achado;
}

function lerGravacao(
  arg: ts.Expression | undefined,
  coluna: string,
  corpo: ts.Node,
): { grava: PontoDeEscrita["grava"]; ilegivel: boolean } {
  if (!arg) return { grava: null, ilegivel: true };
  const valores: ts.Node[] = [];
  if (ts.isObjectLiteralExpression(arg)) {
    if (arg.properties.some((p) => ts.isSpreadAssignment(p))) return { grava: null, ilegivel: true };
    const v = valorNoObjeto(arg, coluna);
    if (v) valores.push(v);
  } else if (ts.isIdentifier(arg)) {
    const inicial = resolverNoCorpo(corpo, arg.text);
    if (!inicial || !ts.isObjectLiteralExpression(inicial)) return { grava: null, ilegivel: true };
    const v = valorNoObjeto(inicial, coluna);
    if (v) valores.push(v);
    // `x.coluna = ...` e `x["coluna"] = ...` na mesma função.
    const visitar = (n: ts.Node) => {
      if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
        const esq = n.left;
        const nomeDaColuna = ts.isPropertyAccessExpression(esq)
          ? esq.name.text
          : ts.isElementAccessExpression(esq) && ts.isStringLiteral(esq.argumentExpression)
            ? esq.argumentExpression.text
            : null;
        if (nomeDaColuna === coluna && esq.getChildAt(0).getText() === arg.text) valores.push(n.right);
      }
      ts.forEachChild(n, visitar);
    };
    visitar(corpo);
  } else {
    return { grava: null, ilegivel: true };
  }
  if (valores.length === 0) return { grava: null, ilegivel: false };
  // Identificador simples no valor (`etapa: destino`): lê os literais de onde ele nasceu.
  const literais = valores.flatMap((v) => {
    if (ts.isIdentifier(v)) {
      const origem = resolverNoCorpo(corpo, v.text);
      return origem ? literaisDe(origem) : [];
    }
    return literaisDe(v);
  });
  return { grava: { literais, texto: valores.map((v) => v.getText()).join(" | ") }, ilegivel: false };
}

function chamadasDe(corpo: ts.Node): Set<string> {
  const nomes = new Set<string>();
  const visitar = (n: ts.Node) => {
    if (ts.isCallExpression(n)) {
      const c = n.expression;
      if (ts.isIdentifier(c)) nomes.add(c.text);
      else if (ts.isPropertyAccessExpression(c)) nomes.add(c.name.text);
    }
    ts.forEachChild(n, visitar);
  };
  visitar(corpo);
  return nomes;
}

/** Todos os `update` em `temis_trabalhos` e `hercules_propostas` de um arquivo. */
function pontosDeEscrita(caminho: string, fonte: string): PontoDeEscrita[] {
  const sf = ts.createSourceFile(caminho, fonte, ts.ScriptTarget.Latest, true, caminho.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const saida: PontoDeEscrita[] = [];
  const visitar = (no: ts.Node) => {
    if (ts.isCallExpression(no) && ts.isPropertyAccessExpression(no.expression) && no.expression.name.text === "update") {
      const tabela = tabelaDaCadeia(no.expression.expression, sf);
      if (tabela === "temis_trabalhos" || tabela === "hercules_propostas" || tabela === "desconhecida") {
        const f = funcaoNomeada(no);
        const corpo = f?.corpo ?? sf;
        const daTabela =
          tabela === "desconhecida"
            ? { grava: null, ilegivel: true }
            : lerGravacao(no.arguments[0], COLUNA[tabela], corpo);
        saida.push({
          chamadas: chamadasDe(corpo),
          funcao: f?.nome ?? "(topo do arquivo)",
          grava: daTabela.grava,
          ilegivel: daTabela.ilegivel,
          linha: sf.getLineAndCharacterOfPosition(no.getStart()).line + 1,
          tabela,
        });
      }
    }
    ts.forEachChild(no, visitar);
  };
  visitar(sf);
  return saida;
}

function arquivosDeCodigo(pasta: string): string[] {
  const saida: string[] = [];
  for (const nome of readdirSync(pasta)) {
    if (nome === "node_modules" || nome.startsWith(".")) continue;
    const caminho = join(pasta, nome);
    if (statSync(caminho).isDirectory()) saida.push(...arquivosDeCodigo(caminho));
    else if (/\.(ts|tsx)$/.test(nome) && !/\.test\.tsx?$/.test(nome) && !nome.includes("para-teste")) {
      saida.push(caminho);
    }
  }
  return saida;
}

const DESFAZ = new Set(["cancelado", "distrato"]);

type Veredito = { onde: string; problema: string };

/** O veredito da PARTE 1 para um ponto de `temis_trabalhos`. `null` = coberto. */
function vereditoDoCard(arquivo: string, p: PontoDeEscrita): null | Veredito {
  const onde = `${arquivo}:${p.linha} (${p.funcao})`;
  if (p.ilegivel) return { onde, problema: "payload ilegível: não dá para saber se move o card" };
  if (!p.grava) return null;
  if (p.chamadas.has("refletirCardNaVenda")) return null;
  const literal = p.grava.literais.length === 1 ? p.grava.literais[0] : "*";
  const excecao = CARD_SEM_REFLEXO[`${arquivo}#${p.funcao}:${literal}`];
  if (!excecao) return { onde, problema: `move o card para ${p.grava.texto} sem chamar refletirCardNaVenda` };
  if (excecao.chama && !p.chamadas.has(excecao.chama)) {
    return { onde, problema: `a exceção diz que a função chama ${excecao.chama}, e ela não chama` };
  }
  return null;
}

/** O veredito da PARTE 2 para um ponto de `hercules_propostas`. `null` = coberto ou não desfaz. */
function vereditoDaVenda(arquivo: string, p: PontoDeEscrita): null | Veredito {
  const onde = `${arquivo}:${p.linha} (${p.funcao})`;
  const chave = `${arquivo}#${p.funcao}`;
  if (p.ilegivel) return { onde, problema: "payload ilegível: não dá para saber se desfaz a venda" };
  if (!p.grava) return null;
  if (p.grava.literais.length === 0) {
    return ETAPA_CALCULADA[chave] ? null : { onde, problema: `etapa calculada (${p.grava.texto}) sem exceção nomeada` };
  }
  if (!p.grava.literais.some((l) => DESFAZ.has(l))) return null;
  if (SOLTAM_O_LOTE.some((f) => p.chamadas.has(f))) return null;
  const excecao = VENDA_DESFEITA_SEM_SOLTURA[chave];
  if (!excecao) return { onde, problema: `leva a venda para ${p.grava.texto} sem soltar o lote` };
  if (excecao.chama && !p.chamadas.has(excecao.chama)) {
    return { onde, problema: `a exceção diz que a função chama ${excecao.chama}, e ela não chama` };
  }
  return null;
}

// ── O CÓDIGO DE VERDADE ─────────────────────────────────────────────────────────

const todos = [...arquivosDeCodigo(join(RAIZ, "lib")), ...arquivosDeCodigo(join(RAIZ, "app"))]
  .map((caminho) => ({ arquivo: relative(RAIZ, caminho).replace(/\\/g, "/"), fonte: readFileSync(caminho, "utf8") }))
  .filter((a) => a.fonte.includes("temis_trabalhos") || a.fonte.includes("hercules_propostas"))
  .flatMap((a) => pontosDeEscrita(a.arquivo, a.fonte).map((p) => ({ arquivo: a.arquivo, p })));

const doCard = todos.filter((x) => x.p.tabela === "temis_trabalhos");
const daVenda = todos.filter((x) => x.p.tabela === "hercules_propostas");
const semTabelaLegivel = todos.filter((x) => x.p.tabela === "desconhecida");

describe("PARTE 1: todo ponto que move o card da Têmis reflete na venda", () => {
  it("a varredura acha quem move card (senão ela provaria nada)", () => {
    const quem = doCard.filter((x) => x.p.grava).map((x) => `${x.arquivo}#${x.p.funcao}`);
    expect(quem).toEqual(
      expect.arrayContaining([
        "lib/assinatura/estado-db.ts#moverCardDaTemis",
        "lib/assinatura/estado-db.ts#concluirAssinaturaDoCard",
        "lib/temis/retorno-para-correcao.ts#retornarParaAnalise",
        "lib/temis/trabalhos-db.ts#marcarAtividade",
        "lib/temis/trabalho-servico.ts#decidirSobreOTrabalho",
        "lib/hercules/concluir-cancelamento-server.ts#concluirCancelamentoDoCard",
      ]),
    );
  });

  it("cada ponto está numa função que chama refletirCardNaVenda, ou é exceção nomeada", () => {
    const problemas = doCard.map((x) => vereditoDoCard(x.arquivo, x.p)).filter(Boolean);
    expect(problemas).toEqual([]);
  });

  it("toda exceção ainda casa com um ponto de escrita (exceção morta é porta aberta para o próximo)", () => {
    const vivas = new Set(
      doCard
        .filter((x) => x.p.grava)
        .map((x) => `${x.arquivo}#${x.p.funcao}:${x.p.grava?.literais.length === 1 ? x.p.grava.literais[0] : "*"}`),
    );
    expect(Object.keys(CARD_SEM_REFLEXO).filter((k) => !vivas.has(k))).toEqual([]);
  });
});

describe("e nenhum `update` some por causa do jeito de escrever a tabela", () => {
  // ⚠️ `from(CONSTANTE).update(...)` JÁ É USADO NA CASA (apolo/enterprise-settings.ts,
  // apolo/arquivos-do-produto-servidor.ts). Se um ponto das duas tabelas nascer assim e a varredura
  // o descartar calado, PARTE 1 e PARTE 2 ficam verdes com o card andando sem reflexo — o defeito
  // de 23/09 de volta. Constante do módulo é resolvida; o que sobrar entra como ilegível e aparece
  // aqui, para ser lido por gente.
  it("nos arquivos que mexem nas duas tabelas, toda cadeia `.update()` diz de qual tabela é", () => {
    expect(semTabelaLegivel.map((x) => `${x.arquivo}:${x.p.linha} (${x.p.funcao})`)).toEqual([]);
  });
});

describe("PARTE 2: todo ponto que desfaz a venda solta o lote", () => {
  it("a varredura acha quem desfaz a venda (senão ela provaria nada)", () => {
    const quem = daVenda
      .filter((x) => x.p.grava?.literais.some((l) => DESFAZ.has(l)))
      .map((x) => `${x.arquivo}#${x.p.funcao}`);
    expect(quem).toEqual(
      expect.arrayContaining([
        "app/api/incorporador/venda/proposta/route.ts#PATCH",
        "lib/hercules/concluir-cancelamento-server.ts#concluirCancelamentoDoCard",
        "lib/hercules/concluir-cancelamento-server.ts#encerrarCopiasDoC2x",
      ]),
    );
  });

  it("cada ponto está numa função que solta o lote, ou é exceção nomeada com o motivo", () => {
    const problemas = daVenda.map((x) => vereditoDaVenda(x.arquivo, x.p)).filter(Boolean);
    expect(problemas).toEqual([]);
  });

  it("toda exceção ainda casa com um ponto de escrita", () => {
    const vivas = new Set(daVenda.filter((x) => x.p.grava).map((x) => `${x.arquivo}#${x.p.funcao}`));
    expect(
      [...Object.keys(VENDA_DESFEITA_SEM_SOLTURA), ...Object.keys(ETAPA_CALCULADA)].filter((k) => !vivas.has(k)),
    ).toEqual([]);
  });

  it("a etapa calculada do reflexo nunca é cancelado nem distrato (a exceção acima depende disto)", () => {
    const tipos = ["contrato", "cancelamento", "distrato", "cessao", "cancelamento_correcao"];
    // ⚠️ `ESTAGIOS` É LISTA DE OBJETOS ({ id, nome, descricao }), E O QUE A TABELA RECEBE É O `id`.
    // Passando o objeto, toda chamada caía no `default` e devolvia null: o teste passava sem provar
    // nada. A contagem de destinos abaixo é a prova de que a tabela foi mesmo consultada.
    const ids = ESTAGIOS.map((e) => e.id);
    const destinos = new Set<string>();
    for (const tipo of tipos) {
      for (const de of ids) {
        for (const para of ids) {
          const destino = etapaDaVendaParaOCard(tipo, de, para)?.destino;
          if (destino) destinos.add(destino);
          expect(destino && DESFAZ.has(destino)).toBeFalsy();
        }
      }
    }
    expect([...destinos].sort()).toEqual(["assinatura", "contrato", "faturado"]);
  });
});

// ── A VARREDURA SE PROVA: ela pega o ponto sem cobertura ────────────────────────

describe("a varredura pega o que deveria pegar", () => {
  const pontos = (fonte: string) => pontosDeEscrita("lib/x/fixture.ts", fonte);

  it("card movido numa função sem reflexo é problema, mesmo com reflexo em OUTRA função do arquivo", () => {
    const fonte = `
      async function comReflexo(sb) {
        await sb.from("temis_trabalhos").update({ estagio: "assinatura" }).eq("id", 1);
        await refletirCardNaVenda(sb, {});
      }
      async function semReflexo(sb) {
        await sb.from("temis_trabalhos").update({ estagio: "faturado" }).eq("id", 1);
      }`;
    const vereditos = pontos(fonte).map((p) => vereditoDoCard("lib/x/fixture.ts", p));
    expect(vereditos[0]).toBeNull();
    expect(vereditos[1]?.problema).toContain("sem chamar refletirCardNaVenda");
  });

  it("payload montado em variável, com `x.estagio =` depois, é lido", () => {
    const fonte = `
      async function marca(sb) {
        const mudanca = { atualizado_em: 1 };
        if (ok) mudanca.estagio = seguinte;
        await sb.from("temis_trabalhos").update(mudanca).eq("id", 1);
      }`;
    const [p] = pontos(fonte);
    expect(p?.grava?.texto).toBe("seguinte");
    expect(vereditoDoCard("lib/x/fixture.ts", p as PontoDeEscrita)?.problema).toContain("sem chamar");
  });

  it("venda levada a cancelado ou distrato (até num ternário) sem soltar o lote é problema", () => {
    const fonte = `
      async function derruba(sb) {
        await sb.from("hercules_propostas").update({ etapa: tipo === "distrato" ? "distrato" : "cancelado" }).eq("id", 1);
      }
      async function derrubaESolta(sb) {
        await sb.from("hercules_propostas").update({ etapa: "cancelado" }).eq("id", 1);
        await soltarLoteDaVendaDesfeita(sb, {});
      }
      async function andaParaContrato(sb) {
        await sb.from("hercules_propostas").update({ etapa: "contrato" }).eq("id", 1);
      }`;
    const vereditos = pontos(fonte).map((p) => vereditoDaVenda("lib/x/fixture.ts", p));
    expect(vereditos[0]?.problema).toContain("sem soltar o lote");
    expect(vereditos[1]).toBeNull();
    expect(vereditos[2]).toBeNull();
  });

  it("tabela que vem de constante é resolvida, e a que não se lê vira problema", () => {
    const fonte = `
      const TABELA_DO_CARD = "temis_trabalhos";
      async function porConstante(sb) {
        await sb.from(TABELA_DO_CARD).update({ estagio: "faturado" }).eq("id", 1);
      }
      async function porVariavelOpaca(sb, qual) {
        await sb.from(qual).update({ estagio: "faturado" }).eq("id", 1);
      }`;
    const [constante, opaca] = pontos(fonte);
    expect(constante?.tabela).toBe("temis_trabalhos");
    expect(vereditoDoCard("lib/x/fixture.ts", constante as PontoDeEscrita)?.problema).toContain("sem chamar");
    // ⚠️ O `from(variável)` NÃO PODE SUMIR EM SILÊNCIO (revisão de 24/09/2026): antes ele nem entrava
    // na lista, e um `update` novo das duas tabelas passava sem veredito nenhum.
    expect(opaca?.tabela).toBe("desconhecida");
    expect(opaca?.ilegivel).toBe(true);
  });

  it("payload que não se lê é problema, não passe livre", () => {
    const fonte = `
      async function opaco(sb) {
        await sb.from("temis_trabalhos").update(montar()).eq("id", 1);
        await sb.from("hercules_propostas").update({ ...resto }).eq("id", 1);
      }`;
    const [card, venda] = pontos(fonte);
    expect(vereditoDoCard("lib/x/fixture.ts", card as PontoDeEscrita)?.problema).toContain("ilegível");
    expect(vereditoDaVenda("lib/x/fixture.ts", venda as PontoDeEscrita)?.problema).toContain("ilegível");
  });

  it("etapa calculada sem exceção nomeada é problema", () => {
    const fonte = `
      async function calcula(sb) {
        await sb.from("hercules_propostas").update({ etapa: traducao.destino }).eq("id", 1);
      }`;
    const [p] = pontos(fonte);
    expect(vereditoDaVenda("lib/x/fixture.ts", p as PontoDeEscrita)?.problema).toContain("etapa calculada");
  });
});

describe("o comentário da régua não promete mais a carga", () => {
  it('"Quem traz a etapa nova é a carga, e nada mais" saiu de situacao-da-unidade.ts', () => {
    const regua = readFileSync(join(RAIZ, "lib/hercules/situacao-da-unidade.ts"), "utf8");
    expect(regua).not.toContain("Quem traz a etapa nova é a carga, e nada mais");
    expect(regua).toContain("refletirCardNaVenda");
  });

  // ⚠️ A REVISÃO DE 24/09/2026: o comentário dizia que o reflexo leva a venda "no faturamento", e
  // nenhuma tela leva o card de contrato do Pré-faturamento a Faturado. O único caminho é
  // `marcarAtividade` pela API (`acao: "atividade"`), sem chamador em tela nenhuma, e a etapa do
  // Pré-faturamento só oferece "Voltar para análise" (tela-de-trabalho.tsx).
  it("o comentário não promete o faturamento como caminho vivo", () => {
    const regua = readFileSync(join(RAIZ, "lib/hercules/situacao-da-unidade.ts"), "utf8");
    expect(regua).not.toContain("no envio, na volta para correção e no faturamento");
  });

  // ⚠️ O FATO, E NÃO A FRASE (revisão de 24/09/2026). Conferir que o TEXTO está no arquivo é a mesma
  // fachada que a revisão tirou do envio: no dia em que a tela do Pré-faturamento ganhar o botão que
  // manda `acao: "atividade"` (a pendência declarada do Lucas, *"depois de assinatura vai ter
  // algumas condicoes para finalizado"*), o comentário volta a mentir e o grep continuaria verde.
  // Aqui os dois andam juntos: sem tela, o comentário TEM que dizer que não há; com tela, ele TEM
  // que sair.
  it("o comentário e as telas concordam sobre quem leva o card a Faturado", () => {
    const FRASE = "HOJE NENHUMA TELA LEVA O CARD DE CONTRATO A FATURADO";
    const telasQueFaturam = arquivosDeCodigo(join(RAIZ, "modules"))
      .filter((caminho) => /acao["']?\s*:\s*["']atividade["']/.test(readFileSync(caminho, "utf8")))
      .map((caminho) => relative(RAIZ, caminho).split("\\").join("/"));
    const regua = readFileSync(join(RAIZ, "lib/hercules/situacao-da-unidade.ts"), "utf8");
    expect(regua.includes(FRASE), telasQueFaturam.length === 0
      ? `nenhuma tela leva o card a Faturado: o comentário da régua precisa dizer isso ("${FRASE}")`
      : `estas telas já levam o card a Faturado, e o comentário da régua ainda diz que nenhuma leva: ${telasQueFaturam.join(", ")}`,
    ).toBe(telasQueFaturam.length === 0);
  });
});

// ⚠️ "O ENVIO DEVOLVE O AVISO DO HÉRCULES" SAIU DAQUI (revisão de 24/09/2026). Era um grep da palavra
// `avisoDoHercules` em envio-db.ts, e apagar o spread do retorno não o derrubava. A promessa agora é
// conferida pelo comportamento: lib/assinatura/envio-aviso-do-hercules.test.ts (o envio responde `ok`
// COM o aviso), assinatura-do-portal.test.ts e trabalho-rotas.test.ts (o serviço repassa) e
// aviso-do-hercules.comportamento.test.tsx (a tela mostra).
