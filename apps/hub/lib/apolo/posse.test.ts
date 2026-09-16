import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  conferirPosse,
  dataDaPosseEmTexto,
  type ErroDePosse,
  mesesDeFruicao,
  ORIGENS_DA_POSSE,
  rotuloDaOrigem,
} from "./posse";

// A DATA DA POSSE, CONFERIDA LINHA A LINHA.
//
// A posse é o marco que liga (ou desliga) a rubrica mais pesada do termo de rescisão. No caso de
// referência de 15/09/2026 — LAVRA DO OURO, Quadra 06 Lote 10, termo emitido em 25/06/2026 — a
// fruição foi R$ 542,91/mês por 21 meses, R$ 11.401,11: mais do que TODAS as outras deduções
// somadas (R$ 16.101,52 no total, das quais a multa penal é R$ 6.768,28). Um dia a mais ou a menos
// nesta conta é dinheiro real no papel que o cliente assina.
//
// ⚠️ TODO TESTE DE DATA AQUI PASSA O "HOJE" NA MÃO, E ISSO NÃO É PREFERÊNCIA DE ESTILO. Um teste
// que chama `new Date()` por baixo é um teste que muda de resultado sozinho: fica verde hoje,
// vermelho amanhã, e vermelho ÀS 21H de qualquer dia (a casa está em UTC-3, então às 21h locais o
// relógio UTC já virou o dia). `conferirPosse` aceita `hoje` e `mesesDeFruicao` aceita
// `ateRestituicao` exatamente para que a conta seja conferível sem depender do relógio da máquina.
//
// ⚠️ O BLOCO DO FUSO NÃO É DECORAÇÃO. `posse.ts` mistura duas leituras de data — a string
// 'YYYY-MM-DD' (que o JS lê como meia-noite UTC) e o `Date` do "agora" (que carrega hora) — e
// misturar UTC com local nesse ponto desloca a fruição em um dia inteiro. Os testes provam que a
// hora do `hoje` não entra na conta: 00:30Z e 23:30Z do MESMO dia devolvem o MESMO número.
//
// ⚠️ A DATA IMPOSSÍVEL É O CASO SILENCIOSO. `Date.UTC(2025, 1, 31)` não dá erro: devolve 3 de março
// de 2025 (e 2 de março em ano bissexto). Sem a comparação de volta que `emUtc` faz, "31/02" viraria
// posse válida com um a três dias de fruição a mais, e ninguém reconferiria.
//
// ⚠️ E O CADASTRO VAZIO É O ESTADO NORMAL, NÃO UM ERRO. A cláusula 5.1 da minuta da Lavra do Ouro
// concede a posse após dois anos E com o comprador em dia — o inadimplente, que é de quem se faz
// rescisão, nunca recebeu a posse. Por isso `mesesDeFruicao` devolve 0 (a rubrica some do termo) em
// vez de estourar quando a data não existe.

/** O "hoje" congelado de toda a suíte: o dia em que o campo de posse nasceu. */
const HOJE = new Date("2026-09-15T12:00:00Z");

/** O mesmo dia, às 23h30 UTC — 20h30 no fuso da casa. */
const HOJE_HORA_ALTA = new Date("2026-09-15T23:30:00Z");

/** O mesmo dia, às 00h30 UTC — 21h30 do dia ANTERIOR no fuso da casa. */
const HOJE_HORA_BAIXA = new Date("2026-09-15T00:30:00Z");

function erroDe(erros: ErroDePosse[], campo: string): ErroDePosse | undefined {
  return erros.find((e) => e.campo === campo);
}

describe("conferirPosse recusa o que a tela não pode gravar", () => {
  it("data em branco pede a data", () => {
    const erros = conferirPosse({ dataDaPosse: "", hoje: HOJE, origem: "declarada" });
    expect(erroDe(erros, "dataDaPosse")?.mensagem).toBe(
      "Informe a data em que a posse foi concedida.",
    );
  });

  it("nulo, indefinido e só espaços caem no mesmo lugar", () => {
    for (const vazio of [null, undefined, "   "]) {
      const erros = conferirPosse({ dataDaPosse: vazio, hoje: HOJE, origem: "declarada" });
      expect(erroDe(erros, "dataDaPosse")?.mensagem).toBe(
        "Informe a data em que a posse foi concedida.",
      );
    }
  });

  // ⚠️ O OPERADOR DIGITA 15/03/2024, e o banco guarda 2024-03-15. Quem converte é a tela; o que
  // chega aqui já tem de estar no formato do banco, e o teste trava isso.
  it("formato errado é recusado, inclusive o formato que o operador vê", () => {
    for (const torto of ["15/03/2024", "2024-3-15", "2024/03/15", "ontem", "20240315"]) {
      const erros = conferirPosse({ dataDaPosse: torto, hoje: HOJE, origem: "declarada" });
      expect(erroDe(erros, "dataDaPosse")?.mensagem).toBe(
        "Data inválida. Use o formato dia/mês/ano.",
      );
    }
  });

  // ⚠️ A MENSAGEM ENSINA O CAMINHO, e é de propósito: "posse no futuro" quase sempre é o operador
  // tentando anotar a posse PREVISTA. O campo em branco já significa "não aconteceu".
  it("data futura é recusada, e a frase manda deixar em branco", () => {
    const erros = conferirPosse({ dataDaPosse: "2026-09-16", hoje: HOJE, origem: "declarada" });
    const erro = erroDe(erros, "dataDaPosse");
    expect(erro?.mensagem).toBe(
      "A posse não pode ser uma data futura. Se ainda não aconteceu, deixe em branco.",
    );
    expect(erro?.mensagem).toContain("deixe em branco");
  });

  it("o próprio dia de hoje passa: futuro começa amanhã", () => {
    const erros = conferirPosse({ dataDaPosse: "2026-09-15", hoje: HOJE, origem: "declarada" });
    expect(erros).toEqual([]);
  });

  // ⚠️ O PISO ESPELHA O CHECK DA MIGRATION 0165 (`data_da_posse >= date '2000-01-01'`). A trava do
  // banco existe; esta aqui existe para o operador ler "confira o ano" em vez de um 23514.
  it("data anterior a 2000 é recusada", () => {
    const erros = conferirPosse({ dataDaPosse: "1999-12-31", hoje: HOJE, origem: "declarada" });
    expect(erroDe(erros, "dataDaPosse")?.mensagem).toBe("Data anterior a 2000. Confira o ano.");
  });

  it("e 01/01/2000 passa, porque o piso é inclusivo como no banco", () => {
    const erros = conferirPosse({ dataDaPosse: "2000-01-01", hoje: HOJE, origem: "declarada" });
    expect(erros).toEqual([]);
  });

  // ⚠️ ESTE É O TESTE QUE JUSTIFICA A COMPARAÇÃO DE VOLTA DENTRO DE `emUtc`. `Date.UTC(2025, 1, 31)`
  // devolve 03/03/2025 e `Date.UTC(2024, 1, 31)` devolve 02/03/2024, os dois sem reclamar. Sem a
  // conferência, 31/02 viraria posse válida com até três dias de fruição a mais.
  it("31 de fevereiro não escorrega para março", () => {
    for (const impossivel of ["2025-02-31", "2024-02-31", "2025-04-31", "2025-13-01", "2025-00-10"]) {
      const erros = conferirPosse({ dataDaPosse: impossivel, hoje: HOJE, origem: "declarada" });
      expect(erroDe(erros, "dataDaPosse")?.mensagem).toBe(
        "Data inválida. Use o formato dia/mês/ano.",
      );
    }
  });

  it("origem desconhecida é recusada", () => {
    for (const torta of ["", "   ", "habite_se", "DECLARADA", null, undefined, 7]) {
      const erros = conferirPosse({ dataDaPosse: "2024-10-03", hoje: HOJE, origem: torta });
      expect(erroDe(erros, "origem")?.mensagem).toBe("Escolha de onde a data da posse saiu.");
    }
  });

  it("as três origens do cadastro passam", () => {
    for (const { valor } of ORIGENS_DA_POSSE) {
      const erros = conferirPosse({ dataDaPosse: "2024-10-03", hoje: HOJE, origem: valor });
      expect(erros).toEqual([]);
    }
  });

  it("observação com mais de 500 caracteres é recusada", () => {
    const erros = conferirPosse({
      dataDaPosse: "2024-10-03",
      hoje: HOJE,
      observacao: "x".repeat(501),
      origem: "declarada",
    });
    expect(erroDe(erros, "observacao")?.mensagem).toBe("A observação passa de 500 caracteres.");
  });

  it("exatamente 500 caracteres passa, e ausente também", () => {
    const noLimite = conferirPosse({
      dataDaPosse: "2024-10-03",
      hoje: HOJE,
      observacao: "x".repeat(500),
      origem: "declarada",
    });
    expect(noLimite).toEqual([]);

    const semObservacao = conferirPosse({
      dataDaPosse: "2024-10-03",
      hoje: HOJE,
      observacao: null,
      origem: "declarada",
    });
    expect(semObservacao).toEqual([]);
  });

  it("o cadastro inteiro válido não devolve erro nenhum", () => {
    const erros = conferirPosse({
      dataDaPosse: "2024-10-03",
      hoje: HOJE,
      observacao: "Termo de vistoria assinado na sede, protocolo 4471.",
      origem: "termo_de_vistoria",
    });
    expect(erros).toEqual([]);
  });

  // ⚠️ A TELA MOSTRA OS TRÊS ERROS DE UMA VEZ, e não o primeiro. Um formulário que devolve um erro
  // por vez faz o operador salvar três vezes para descobrir três problemas.
  it("três campos errados devolvem três erros, não um", () => {
    const erros = conferirPosse({
      dataDaPosse: "2027-01-01",
      hoje: HOJE,
      observacao: "y".repeat(501),
      origem: "inventada",
    });
    expect(erros.map((e) => e.campo)).toEqual(["dataDaPosse", "origem", "observacao"]);
  });
});

describe("mesesDeFruicao devolve zero quando a fruição não existe", () => {
  // ⚠️ SEM POSSE, SEM RUBRICA. É o estado normal do inadimplente, não uma pendência de cadastro:
  // `calcularRescisao` omite a linha inteira do termo quando este número é zero.
  it("sem data, o resultado é zero", () => {
    for (const vazio of [null, undefined, ""]) {
      expect(mesesDeFruicao({ ateRestituicao: HOJE, dataDaPosse: vazio })).toBe(0);
    }
  });

  it("data inválida não vira NaN nem fruição inventada", () => {
    for (const torta of ["2025-02-31", "abacaxi", "15/03/2024", "2024-3-15"]) {
      expect(mesesDeFruicao({ ateRestituicao: HOJE, dataDaPosse: torta })).toBe(0);
    }
  });

  // ⚠️ ZERO EM VEZ DE NEGATIVO. Fruição negativa numa linha de DEDUÇÃO viraria crédito ao cliente, e
  // o papel diria o contrário do que a conta pretende.
  it("posse posterior à restituição é zero, nunca negativo", () => {
    const meses = mesesDeFruicao({ ateRestituicao: HOJE, dataDaPosse: "2026-12-01" });
    expect(meses).toBe(0);
    expect(meses).toBeGreaterThanOrEqual(0);
  });

  it("posse hoje é zero: ocupação de zero dia não se cobra", () => {
    expect(mesesDeFruicao({ ateRestituicao: HOJE, dataDaPosse: "2026-09-15" })).toBe(0);
  });
});

describe("mesesDeFruicao conta em mês comercial de 30 dias", () => {
  // ⚠️ MÊS COMERCIAL, A MESMA RÉGUA DOS JUROS DE MORA DO DOSSIÊ (`lib/hades/dossie/encargos.ts`,
  // `(taxa / 100) / 30 * dias`). Duas réguas discordando no mesmo cliente é defeito já registrado
  // entre o acordo e o dossiê.
  it("30 dias dão 1 mês", () => {
    expect(
      mesesDeFruicao({ ateRestituicao: new Date("2026-01-31T00:00:00Z"), dataDaPosse: "2026-01-01" }),
    ).toBe(1);
  });

  it("45 dias dão 1,5 mês", () => {
    expect(
      mesesDeFruicao({ ateRestituicao: new Date("2026-02-15T00:00:00Z"), dataDaPosse: "2026-01-01" }),
    ).toBe(1.5);
  });

  it("645 dias dão 21,5 meses", () => {
    expect(
      mesesDeFruicao({ ateRestituicao: new Date("2025-10-07T00:00:00Z"), dataDaPosse: "2024-01-01" }),
    ).toBe(21.5);
  });

  // O papel imprime "por 21,53 meses": a fração tem duas casas, e a conta tem de bater com o que
  // está impresso.
  it("646 dias dão 21,53 meses — duas casas, como o termo imprime", () => {
    expect(
      mesesDeFruicao({ ateRestituicao: new Date("2025-10-08T00:00:00Z"), dataDaPosse: "2024-01-01" }),
    ).toBe(21.53);
  });

  // ⚠️ O CASO DO PAPEL DE 25/06/2026 (LAVRA DO OURO, Quadra 06 Lote 10). A fruição de 0,75% sobre o
  // valor de tabela de R$ 72.388,00 dá R$ 542,91/mês; o termo cobrou 21 meses, R$ 11.401,11. Se
  // esta asserção cair, o Panteon parou de reproduzir o número que o jurídico produziu à mão.
  it("630 dias dão os 21 meses do termo real, e R$ 11.401,11 de fruição", () => {
    const meses = mesesDeFruicao({
      ateRestituicao: new Date("2026-06-25T00:00:00Z"),
      dataDaPosse: "2024-10-03",
    });
    expect(meses).toBe(21);

    const porMes = Math.round(72388 * 0.0075 * 100) / 100;
    expect(porMes).toBe(542.91);
    expect(Math.round(porMes * meses * 100) / 100).toBe(11401.11);
  });

  it("a restituição omitida cai no agora, sem estourar", () => {
    // Posse antiga o bastante para o resultado ser positivo em qualquer dia em que a suíte rodar.
    const meses = mesesDeFruicao({ dataDaPosse: "2020-01-01" });
    expect(Number.isFinite(meses)).toBe(true);
    expect(meses).toBeGreaterThan(0);
  });
});

describe("o fuso não desliza um dia", () => {
  // ⚠️ A CASA ESTÁ EM UTC-3. Se a conta lesse componentes LOCAIS de um lado e UTC do outro, o mesmo
  // dia às 23h30Z e às 00h30Z devolveria números diferentes — e a suíte quebraria sozinha às 21h,
  // que é quando o relógio UTC vira o dia para quem está no Brasil.
  it("a hora do dia da restituição não entra na conta", () => {
    const alta = mesesDeFruicao({ ateRestituicao: HOJE_HORA_ALTA, dataDaPosse: "2024-12-15" });
    const baixa = mesesDeFruicao({ ateRestituicao: HOJE_HORA_BAIXA, dataDaPosse: "2024-12-15" });

    expect(alta).toBe(baixa);
    // 15/12/2024 → 15/09/2026 são 639 dias corridos; 639 / 30 = 21,3 meses.
    expect(alta).toBe(21.3);
  });

  it("nem o meio-dia, nem a virada exata do dia", () => {
    const meiaNoite = mesesDeFruicao({
      ateRestituicao: new Date("2026-09-15T00:00:00Z"),
      dataDaPosse: "2024-12-15",
    });
    const quaseMeiaNoite = mesesDeFruicao({
      ateRestituicao: new Date("2026-09-15T23:59:59Z"),
      dataDaPosse: "2024-12-15",
    });
    expect(meiaNoite).toBe(21.3);
    expect(quaseMeiaNoite).toBe(21.3);
  });

  // ⚠️ O MESMO VALE PARA O TETO DA VALIDAÇÃO. Uma posse gravada com a data de hoje não pode virar
  // "data futura" só porque o operador salvou às 20h30.
  it("a posse de hoje continua válida às 23h30Z e às 00h30Z", () => {
    expect(
      conferirPosse({ dataDaPosse: "2026-09-15", hoje: HOJE_HORA_ALTA, origem: "declarada" }),
    ).toEqual([]);
    expect(
      conferirPosse({ dataDaPosse: "2026-09-15", hoje: HOJE_HORA_BAIXA, origem: "declarada" }),
    ).toEqual([]);
  });

  it("e amanhã continua recusada nas duas horas", () => {
    for (const hoje of [HOJE_HORA_ALTA, HOJE_HORA_BAIXA]) {
      const erros = conferirPosse({ dataDaPosse: "2026-09-16", hoje, origem: "declarada" });
      expect(erroDe(erros, "dataDaPosse")?.mensagem).toContain("não pode ser uma data futura");
    }
  });
});

describe("dataDaPosseEmTexto escreve a data como o papel escreve", () => {
  it("devolve dia/mês/ano com dois dígitos", () => {
    expect(dataDaPosseEmTexto("2024-03-15")).toBe("15/03/2024");
    expect(dataDaPosseEmTexto("2024-01-05")).toBe("05/01/2024");
    expect(dataDaPosseEmTexto("2024-10-03")).toBe("03/10/2024");
  });

  // ⚠️ AQUI ESTAVA O DESLIZE CLÁSSICO. `new Date("2024-03-01").toLocaleDateString("pt-BR")` numa
  // máquina em UTC-3 imprime 29/02/2024: a data volta um dia no papel enquanto a conta usa o dia
  // certo. Lendo os componentes em UTC, o primeiro de março continua primeiro de março.
  it("o primeiro do mês não volta para o último dia do mês anterior", () => {
    expect(dataDaPosseEmTexto("2024-03-01")).toBe("01/03/2024");
    expect(dataDaPosseEmTexto("2025-01-01")).toBe("01/01/2025");
  });

  it("sem data, devolve nulo", () => {
    expect(dataDaPosseEmTexto(null)).toBeNull();
    expect(dataDaPosseEmTexto(undefined)).toBeNull();
    expect(dataDaPosseEmTexto("")).toBeNull();
  });

  it("data inválida devolve nulo, e não 'Invalid Date' impresso no termo", () => {
    expect(dataDaPosseEmTexto("2025-02-31")).toBeNull();
    expect(dataDaPosseEmTexto("15/03/2024")).toBeNull();
    expect(dataDaPosseEmTexto("abacaxi")).toBeNull();
  });
});

describe("rotuloDaOrigem traduz a origem para a tela e para o termo", () => {
  it("cada origem cadastrada tem o rótulo que o jurídico lê", () => {
    expect(rotuloDaOrigem("termo_de_vistoria")).toBe("Termo de vistoria assinado");
    expect(rotuloDaOrigem("contrato")).toBe("Cláusula do contrato com data certa");
    expect(rotuloDaOrigem("declarada")).toBe("Declarada pelo operador");
  });

  it("origem ausente ou desconhecida devolve nulo", () => {
    expect(rotuloDaOrigem(null)).toBeNull();
    expect(rotuloDaOrigem(undefined)).toBeNull();
    expect(rotuloDaOrigem("")).toBeNull();
    expect(rotuloDaOrigem("habite_se")).toBeNull();
  });

  it("a lista da tela não tem origem sem rótulo nem valor repetido", () => {
    expect(ORIGENS_DA_POSSE.length).toBe(3);
    for (const { rotulo, valor } of ORIGENS_DA_POSSE) {
      expect(rotulo.length).toBeGreaterThan(0);
      expect(rotuloDaOrigem(valor)).toBe(rotulo);
    }
    expect(new Set(ORIGENS_DA_POSSE.map((o) => o.valor)).size).toBe(3);
  });
});

// A MIGRATION 0165, LIDA COMO TEXTO.
//
// ⚠️ ISTO É O MESMO CONTRA-VENENO DA ROTA DO BLOQUEIO (`app/api/incorporador/venda/bloqueio/
// route.test.ts`): o typecheck não alcança o banco. `origem` é uma coluna TEXT com CHECK, e o
// TypeScript não sabe disso. Renomear uma origem aqui e esquecer o CHECK — ou o contrário — compila,
// passa em toda esta suíte e só falha em produção, com um 23514 no rosto do operador no momento de
// gravar. A tabela JÁ ESTÁ APLICADA com 0 linhas: a hora de divergir é agora.
const MIGRATION_0165 = readFileSync(
  join(__dirname, "..", "..", "..", "..", "packages", "database", "migrations", "0165_posse_da_unidade.sql"),
  "utf8",
);

describe("o código e o CHECK da migration 0165 falam a mesma língua", () => {
  it("as origens do código são exatamente as origens do banco", () => {
    const doCheck = (/origem in \(([^)]+)\)/.exec(MIGRATION_0165)?.[1] ?? "")
      .split(",")
      .map((p) => p.trim().replace(/'/g, ""))
      .filter((p) => p.length > 0);

    expect(doCheck.length).toBe(3);
    expect([...doCheck].sort()).toEqual([...ORIGENS_DA_POSSE.map((o) => o.valor)].sort());
  });

  it("o piso de 2000 é o mesmo dos dois lados", () => {
    expect(MIGRATION_0165).toContain("data_da_posse >= date '2000-01-01'");
    const erros = conferirPosse({ dataDaPosse: "1999-12-31", hoje: HOJE, origem: "declarada" });
    expect(erroDe(erros, "dataDaPosse")?.mensagem).toContain("anterior a 2000");
  });

  // ⚠️ O TETO NÃO ESTÁ NO BANCO DE PROPÓSITO (`current_date` não é IMMUTABLE e o Postgres recusa em
  // CHECK). Se alguém "consertar" isso um dia, esta asserção avisa que a trava do futuro passou a
  // ter dois donos — e a asserção olha o TEXTO DO CHECK, não o arquivo inteiro: o cabeçalho da
  // migration cita `current_date` em prosa, justamente para explicar por que ele não está lá.
  it("o teto do futuro mora só na aplicação", () => {
    const checkDaData =
      /constraint hercules_posse_data_plausivel check \(([^)]+)\)/.exec(MIGRATION_0165)?.[1] ?? "";
    expect(checkDaData).toContain(">= date '2000-01-01'");
    expect(checkDaData).not.toContain("current_date");
    expect(checkDaData).not.toContain("<=");
  });
});
