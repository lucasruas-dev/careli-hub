import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  conferirPremissa,
  type ErroDePremissa,
  type LinhaDePremissa,
  premissasDoRecorte,
  ROTULO_DA_BASE_NA_TELA,
  RUBRICAS,
} from "./premissas-de-rescisao";

// AS PREMISSAS CADASTRADAS, CONFERIDAS — o que a tela grava e o que a conta recebe.
//
// ⚠️ O TESTE QUE JUSTIFICA ESTA SUÍTE É O DA PRECEDÊNCIA POR RUBRICA, e todo o resto é escolta.
// Para planos, a tabela do filho SUBSTITUI a do pai inteira; para premissas, não: cadastrar só
// "publicidade" no filho APAGARIA a cláusula penal herdada do pai se alguém aplicasse a régua ao
// conjunto. A cláusula penal é a dedução mais pesada do termo (10% sobre o valor de tabela menos a
// comissão — R$ 6.768,28 no papel da Lavra do Ouro de 25/06/2026), e ela sumiria do documento
// porque um operador cadastrou uma rubrica menor. Ninguém reconferiria: o papel sai bonito, só
// menor. Por isso o caso está montado com pai e filho de verdade e provado numa assertiva só.
//
// ⚠️ OS IDS SÃO OS REAIS DA LAGOA BONITA — pai 31, filhos LBF 33 e LBP 32 — os mesmos de
// `lib/hercules/recorte-da-unidade.test.ts`. É o produto dividido que a casa usa para pensar
// herança, e repetir os ids deixa os dois testes lado a lado sem tradução.
//
// ⚠️ E OS PERCENTUAIS SÃO OS PRATICADOS: multa 10%, publicidade 4%, corretagem 6,5%, tributos
// 5,93% e fruição 0,75% ao mês. Número inventado num teste de premissa esconde o dia em que a
// alíquota deixar de casar com o modelo em Word.

const PAI = "31";
const LBF = "33";
const LBP = "32";

const loteDoLBF = { categoriaId: null, enterpriseId: LBF, paiEnterpriseId: PAI };
const loteDoLBP = { categoriaId: null, enterpriseId: LBP, paiEnterpriseId: PAI };

/** Uma linha do banco, com os defaults do caso comum: ativa, única, sem cláusula transcrita. */
const linha = (
  parcial: Partial<LinhaDePremissa> & { enterpriseId: null | string; rubrica: string },
): LinhaDePremissa => ({
  ativa: true,
  base: "valor_de_tabela_menos_comissao",
  clausula: null,
  percentual: 10,
  periodicidade: "unica",
  ...parcial,
});

const campos = (erros: ErroDePremissa[]): string[] => erros.map((e) => e.campo);

describe("a precedência é por rubrica, e não pelo conjunto", () => {
  const CLAUSULA_DO_PAI = "Cláusula 12ª, §2º — multa compensatória de 10%.";

  // O pai cobra as duas coisas; o filho só cadastrou publicidade, e com outra base.
  const LINHAS: LinhaDePremissa[] = [
    linha({ clausula: CLAUSULA_DO_PAI, enterpriseId: PAI, rubrica: "clausula_penal" }),
    linha({ enterpriseId: PAI, percentual: 4, rubrica: "publicidade" }),
    linha({ base: "total_pago", enterpriseId: LBF, percentual: 2, rubrica: "publicidade" }),
  ];

  // ⚠️ É ESTE. Se este `it` sumir, a peça não está entregue: ele prova, de uma vez, que a
  // publicidade veio do filho, que a cláusula penal continuou vindo do pai, e que a origem de cada
  // uma foi registrada para ir impressa no termo.
  it("cadastrar só a publicidade no filho NÃO apaga a cláusula penal herdada do pai", () => {
    expect(premissasDoRecorte(loteDoLBF, LINHAS)).toEqual({
      origemPorRubrica: { clausula_penal: "pai", publicidade: "filho" },
      premissas: {
        clausula_penal: {
          base: "valor_de_tabela_menos_comissao",
          clausula: CLAUSULA_DO_PAI,
          percentual: 10,
          periodicidade: "unica",
        },
        publicidade: {
          base: "total_pago",
          clausula: null,
          percentual: 2,
          periodicidade: "unica",
        },
      },
    });
  });

  it("e o irmão que não cadastrou nada fica com as duas do pai", () => {
    const { origemPorRubrica, premissas } = premissasDoRecorte(loteDoLBP, LINHAS);
    expect(origemPorRubrica).toEqual({ clausula_penal: "pai", publicidade: "pai" });
    expect(premissas.publicidade?.percentual).toBe(4);
  });

  // ⚠️ O DEGRAU CONTINUA FECHANDO A QUESTÃO DENTRO DA RUBRICA: onde os dois níveis cadastraram a
  // MESMA rubrica, o pai não entra nem para completar. É a régua de `itensDoMenorRecorte` intacta —
  // o que muda aqui é só o recorte do universo, uma rubrica por vez.
  it("onde os dois cadastraram a mesma rubrica, o filho ganha sozinho", () => {
    const { premissas } = premissasDoRecorte(loteDoLBF, LINHAS);
    expect(premissas.publicidade).toEqual({
      base: "total_pago",
      clausula: null,
      percentual: 2,
      periodicidade: "unica",
    });
  });

  it("as cinco rubricas convivem, cada uma com a sua origem", () => {
    const cheio: LinhaDePremissa[] = [
      ...LINHAS,
      linha({ base: "valor_efetivo", enterpriseId: PAI, percentual: null, rubrica: "corretagem" }),
      linha({ base: "total_pago", enterpriseId: LBF, percentual: 5.93, rubrica: "tributos" }),
      linha({
        base: "valor_do_contrato_atualizado",
        enterpriseId: LBF,
        percentual: 0.75,
        periodicidade: "mensal",
        rubrica: "fruicao",
      }),
    ];
    expect(premissasDoRecorte(loteDoLBF, cheio).origemPorRubrica).toEqual({
      clausula_penal: "pai",
      corretagem: "pai",
      fruicao: "filho",
      publicidade: "filho",
      tributos: "filho",
    });
  });
});

describe("de onde a premissa veio, que é o que vai impresso no termo", () => {
  // ⚠️ PRODUTO SEM DIVISÃO NÃO PODE DIZER "PAI". Quando a unidade e o pai são o mesmo
  // `enterprise_id`, o degrau de cima repetiria o do meio e o termo sairia dizendo "herdado do
  // empreendimento principal" para uma premissa do próprio produto.
  it("num produto sem divisão, a origem é `filho` e não `pai`", () => {
    const soUmNivel = { categoriaId: null, enterpriseId: PAI, paiEnterpriseId: PAI };
    const { origemPorRubrica } = premissasDoRecorte(soUmNivel, [
      linha({ enterpriseId: PAI, rubrica: "clausula_penal" }),
    ]);
    expect(origemPorRubrica.clausula_penal).toBe("filho");
  });

  // ⚠️ NÃO HÁ COLUNA DE CATEGORIA NA 0166, e isso é decisão registrada na própria migration: o
  // pedido é por empreendimento. A régua trata "sem categoria" como o caso normal, então a unidade
  // que TEM categoria continua lendo do filho — e não cai em lista vazia.
  it("unidade com categoria lê do empreendimento, porque premissa não tem categoria", () => {
    const loteCondominio = { ...loteDoLBF, categoriaId: "cat-condominio" };
    const { origemPorRubrica, premissas } = premissasDoRecorte(loteCondominio, [
      linha({ enterpriseId: LBF, percentual: 8, rubrica: "clausula_penal" }),
    ]);
    expect(origemPorRubrica.clausula_penal).toBe("filho");
    expect(premissas.clausula_penal?.percentual).toBe(8);
  });

  it("sem cadastro em nível nenhum, não há origem — e isso não é erro", () => {
    const forasteiro = { categoriaId: null, enterpriseId: "99", paiEnterpriseId: null };
    expect(premissasDoRecorte(forasteiro, [linha({ enterpriseId: PAI, rubrica: "publicidade" })]))
      .toEqual({ origemPorRubrica: {}, premissas: {} });
  });
});

describe("a linha desligada não vira dedução", () => {
  it("rubrica cadastrada só como desligada fica de fora, e sem origem", () => {
    const { origemPorRubrica, premissas } = premissasDoRecorte(loteDoLBF, [
      linha({ ativa: false, enterpriseId: PAI, percentual: 4, rubrica: "publicidade" }),
      linha({ enterpriseId: PAI, rubrica: "clausula_penal" }),
    ]);
    expect(Object.keys(premissas)).toEqual(["clausula_penal"]);
    expect(origemPorRubrica.publicidade).toBeUndefined();
  });

  it("desligada no filho não empurra a linha do filho para o degrau do pai", () => {
    // A linha desligada é do FILHO; o pai não cadastrou nada. Nada pode aparecer — nem com a
    // origem trocada para "pai" só porque a linha sobrou no universo.
    const { origemPorRubrica, premissas } = premissasDoRecorte(loteDoLBF, [
      linha({ ativa: false, enterpriseId: LBF, percentual: 4, rubrica: "publicidade" }),
    ]);
    expect(premissas).toEqual({});
    expect(origemPorRubrica).toEqual({});
  });

  // ⚠️⚠️ DESLIGAR NO FILHO VENCE O PAI, E ESTE É O TESTE QUE GUARDA A DECISÃO. A primeira versão do
  // código descartava a linha desligada ANTES da régua, e o efeito era o contrário do pretendido: o
  // LBF desligava a publicidade, a régua não achava linha nenhuma daquela rubrica no filho, subia
  // para o pai e o termo deduzia 4% de um cliente cujo empreendimento tinha decidido não cobrar.
  //
  // A migration 0166 já tinha escrito a intenção na própria coluna: *"Desligada continua cadastrada
  // ... para explicar por que aquele empreendimento nao cobra a rubrica"*. Desligar é uma DECISÃO
  // cadastrada, não ausência de cadastro — e o nível que decide fecha a questão. O conserto foi
  // filtrar por rubrica, rodar a régua, e só então olhar `ativa`.
  //
  // Achado pela revisão adversarial em 15/09/2026, antes de existir tela ou chamador.
  it("desligar no filho vence o pai: a rubrica não entra, e não herda", () => {
    const { origemPorRubrica, premissas } = premissasDoRecorte(loteDoLBF, [
      linha({ enterpriseId: PAI, percentual: 4, rubrica: "publicidade" }),
      linha({
        ativa: false,
        clausula: "O LBF não cobra publicidade.",
        enterpriseId: LBF,
        percentual: 0,
        rubrica: "publicidade",
      }),
    ]);
    expect(premissas.publicidade).toBeUndefined();
    expect(origemPorRubrica.publicidade).toBeUndefined();
  });

  // ⚠️ E O DESLIGAMENTO NÃO CONTAMINA AS VIZINHAS: desligar a publicidade no filho não pode fazer a
  // cláusula penal do pai sumir junto. Cada rubrica corre a régua sozinha.
  it("desligar uma rubrica no filho não derruba as outras herdadas do pai", () => {
    const { origemPorRubrica, premissas } = premissasDoRecorte(loteDoLBF, [
      linha({ enterpriseId: PAI, percentual: 10, rubrica: "clausula_penal" }),
      linha({ enterpriseId: PAI, percentual: 4, rubrica: "publicidade" }),
      linha({ ativa: false, enterpriseId: LBF, percentual: 0, rubrica: "publicidade" }),
    ]);
    expect(Object.keys(premissas)).toEqual(["clausula_penal"]);
    expect(premissas.clausula_penal?.percentual).toBe(10);
    expect(origemPorRubrica.clausula_penal).toBe("pai");
  });
});

describe("o que o banco tem e o código não conhece é ignorado sem quebrar", () => {
  // ⚠️ O CÓDIGO É MAIS NOVO QUE O BANCO EM PRODUÇÃO, SEMPRE. Uma rubrica que entrar pelo CHECK
  // antes de a lista daqui crescer não pode derrubar a emissão do termo: a linha some, as outras
  // continuam.
  it("rubrica desconhecida some e não leva as vizinhas junto", () => {
    const { premissas } = premissasDoRecorte(loteDoLBF, [
      linha({ enterpriseId: PAI, rubrica: "mora" }),
      linha({ enterpriseId: PAI, percentual: 4, rubrica: "publicidade" }),
    ]);
    expect(Object.keys(premissas)).toEqual(["publicidade"]);
  });

  it("rubrica com espaços em volta ainda casa, porque a leitura apara", () => {
    const { premissas } = premissasDoRecorte(loteDoLBF, [
      linha({ enterpriseId: PAI, percentual: 4, rubrica: "  publicidade  " }),
    ]);
    expect(premissas.publicidade?.percentual).toBe(4);
  });

  // ⚠️ BASE DESCONHECIDA DERRUBA A RUBRICA INTEIRA, DE PROPÓSITO. `calcularRescisao` só sabe
  // calcular as seis bases do CHECK; entregar a rubrica com uma base que ela não entende produziria
  // dedução sobre nada. Melhor a rubrica cair para o padrão da casa, com aviso, do que sair errada.
  it("base desconhecida tira a rubrica da conta, sem tirar as outras", () => {
    const { origemPorRubrica, premissas } = premissasDoRecorte(loteDoLBF, [
      linha({ base: "valor_venal", enterpriseId: PAI, rubrica: "clausula_penal" }),
      linha({ base: "total_pago", enterpriseId: PAI, percentual: 5.93, rubrica: "tributos" }),
    ]);
    expect(Object.keys(premissas)).toEqual(["tributos"]);
    expect(origemPorRubrica.clausula_penal).toBeUndefined();
  });

  it("base com espaços em volta continua valendo", () => {
    const { premissas } = premissasDoRecorte(loteDoLBF, [
      linha({ base: " total_pago ", enterpriseId: PAI, percentual: 5.93, rubrica: "tributos" }),
    ]);
    expect(premissas.tributos?.base).toBe("total_pago");
  });
});

describe("rubrica sem cadastro é CHAVE AUSENTE, nunca chave com undefined", () => {
  // ⚠️ A DIFERENÇA NÃO É ESTÉTICA: `calcularRescisao` pergunta se a rubrica foi cadastrada para
  // decidir entre a premissa do empreendimento e o padrão da casa. Chave presente valendo
  // `undefined` diria "alguém cadastrou" sobre um cadastro que ninguém fez, e o percentual viraria
  // buraco no meio da conta. `toEqual` ignora chave com undefined — por isso a prova é
  // `Object.keys`, que não ignora.
  it("só a rubrica cadastrada aparece em Object.keys", () => {
    const { premissas } = premissasDoRecorte(loteDoLBF, [
      linha({ enterpriseId: PAI, percentual: 4, rubrica: "publicidade" }),
    ]);
    expect(Object.keys(premissas)).toEqual(["publicidade"]);
    expect("clausula_penal" in premissas).toBe(false);
  });

  it("o mesmo vale para a origem", () => {
    const { origemPorRubrica } = premissasDoRecorte(loteDoLBF, [
      linha({ enterpriseId: PAI, percentual: 4, rubrica: "publicidade" }),
    ]);
    expect(Object.keys(origemPorRubrica)).toEqual(["publicidade"]);
  });

  it("empreendimento sem cadastro nenhum devolve os dois objetos vazios", () => {
    const vazio = premissasDoRecorte(loteDoLBF, []);
    expect(Object.keys(vazio.premissas)).toEqual([]);
    expect(Object.keys(vazio.origemPorRubrica)).toEqual([]);
  });
});

describe("o que a linha do banco vira", () => {
  // ⚠️ A BASE TEM DE SERVIR À RUBRICA, e por isso a fruição não usa a base padrão do helper.
  // `valor_de_tabela_menos_comissao` não está entre as bases da fruição, e a leitura passou a
  // ignorar a linha cuja base não se aplica — foi assim que este bloco quebrou quando a trava
  // entrou, em 15/09/2026.
  const umaSo = (parcial: Partial<LinhaDePremissa>): LinhaDePremissa =>
    linha({
      base: "valor_do_contrato_atualizado",
      enterpriseId: PAI,
      rubrica: "fruicao",
      ...parcial,
    });

  it("`mensal` é mensal; qualquer outra coisa é única", () => {
    const mensal = premissasDoRecorte(loteDoLBF, [umaSo({ periodicidade: " mensal " })]);
    const estranha = premissasDoRecorte(loteDoLBF, [umaSo({ periodicidade: "anual" })]);
    expect(mensal.premissas.fruicao?.periodicidade).toBe("mensal");
    expect(estranha.premissas.fruicao?.periodicidade).toBe("unica");
  });

  // ⚠️ QUEM BARRA "MENSAL" FORA DA FRUIÇÃO É `conferirPremissa` E O CHECK DA 0166, na gravação. A
  // leitura confia no banco de propósito: repetir a trava aqui daria duas leis para a mesma regra,
  // e a de leitura calaria uma linha que o banco aceitou em vez de mostrar o erro a quem cadastrou.
  it("a leitura não reprova `mensal` em rubrica que não é fruição — isso é da gravação", () => {
    const { premissas } = premissasDoRecorte(loteDoLBF, [
      linha({ enterpriseId: PAI, percentual: 4, periodicidade: "mensal", rubrica: "publicidade" }),
    ]);
    expect(premissas.publicidade?.periodicidade).toBe("mensal");
  });

  it("percentual que não é número finito vira nulo, e não NaN", () => {
    const nulo = premissasDoRecorte(loteDoLBF, [umaSo({ percentual: null })]);
    const naoNumero = premissasDoRecorte(loteDoLBF, [umaSo({ percentual: Number.NaN })]);
    expect(nulo.premissas.fruicao?.percentual).toBeNull();
    expect(naoNumero.premissas.fruicao?.percentual).toBeNull();
  });

  it("o percentual válido atravessa com as casas decimais que tem", () => {
    const { premissas } = premissasDoRecorte(loteDoLBF, [
      linha({ base: "total_pago", enterpriseId: PAI, percentual: 5.93, rubrica: "tributos" }),
    ]);
    expect(premissas.tributos?.percentual).toBe(5.93);
  });

  it("a cláusula transcrita atravessa inteira, porque vai impressa no termo", () => {
    const texto = "Cláusula 15ª — ressarcimento de publicidade de 4% (quatro por cento).";
    const { premissas } = premissasDoRecorte(loteDoLBF, [
      linha({ clausula: texto, enterpriseId: PAI, percentual: 4, rubrica: "publicidade" }),
    ]);
    expect(premissas.publicidade?.clausula).toBe(texto);
  });
});

describe("a lista de rubricas que a tela mostra", () => {
  it("é a ordem em que o termo imprime", () => {
    expect(RUBRICAS.map((r) => r.valor)).toEqual([
      "clausula_penal",
      "publicidade",
      "corretagem",
      "tributos",
      "fruicao",
    ]);
  });

  it("toda base oferecida tem rótulo para a tela escrever", () => {
    const semRotulo = RUBRICAS.flatMap((r) => r.bases).filter((b) => !ROTULO_DA_BASE_NA_TELA[b]);
    expect(semRotulo).toEqual([]);
  });

  // ⚠️ `valor_efetivo` SÓ PODE APARECER NA CORRETAGEM. `calcularRescisao` devolve nulo para essa
  // base em qualquer outra rubrica — a premissa seria aceita na tela e a rubrica sairia do papel
  // com aviso, que é a forma silenciosa de a dedução sumir.
  it("`valor_efetivo` só é oferecido para a corretagem", () => {
    const comEfetivo = RUBRICAS.filter((r) => r.bases.includes("valor_efetivo"));
    expect(comEfetivo.map((r) => r.valor)).toEqual(["corretagem"]);
  });

  it("nenhuma rubrica fica sem rótulo e sem ajuda na tela", () => {
    expect(RUBRICAS.filter((r) => !r.ajuda.trim() || !r.rotulo.trim())).toEqual([]);
  });
});

describe("o código e o CHECK da migration 0166 dizem a mesma coisa", () => {
  // ⚠️ LER O .SQL É GROSSEIRO, E É DE PROPÓSITO — é o mesmo contra-veneno do teste da rota de
  // bloqueio. A 0166 ainda NÃO foi aplicada (aguarda o OK do dono do produto), então o divórcio
  // entre a lista daqui e o CHECK de lá não apareceria em typecheck nenhum: apareceria como
  // `23514` na primeira gravação, com o nome da constraint na cara do operador.
  const SQL = readFileSync(
    join(__dirname, "../../../../packages/database/migrations/0166_premissas_de_rescisao.sql"),
    "utf8",
  );

  it("as cinco rubricas estão no CHECK", () => {
    const foraDoCheck = RUBRICAS.filter((r) => !SQL.includes(`'${r.valor}'`)).map((r) => r.valor);
    expect(foraDoCheck).toEqual([]);
  });

  it("as seis bases estão no CHECK", () => {
    const foraDoCheck = Object.keys(ROTULO_DA_BASE_NA_TELA).filter((b) => !SQL.includes(`'${b}'`));
    expect(foraDoCheck).toEqual([]);
  });
});

describe("conferirPremissa recusa antes de o banco recusar", () => {
  /** A premissa do dia a dia: a multa de 10% sobre o valor de tabela menos a comissão. */
  const MULTA = {
    ativa: true,
    base: "valor_de_tabela_menos_comissao",
    clausula: "Cláusula 12ª, §2º.",
    percentual: 10,
    periodicidade: "unica",
    rubrica: "clausula_penal",
  };

  it("a premissa do papel de hoje passa limpa", () => {
    expect(conferirPremissa(MULTA)).toEqual([]);
  });

  it("rubrica desconhecida é recusada", () => {
    expect(campos(conferirPremissa({ ...MULTA, rubrica: "mora" }))).toEqual(["rubrica"]);
  });

  it("rubrica ausente é recusada como desconhecida", () => {
    expect(campos(conferirPremissa({ ...MULTA, rubrica: null }))).toEqual(["rubrica"]);
  });

  it("base fora do CHECK é recusada", () => {
    expect(campos(conferirPremissa({ ...MULTA, base: "valor_venal" }))).toEqual(["base"]);
  });

  // ⚠️ TRIBUTO INCIDE SOBRE O QUE ENTROU NO CAIXA. `valor_efetivo` não se aplica: ela existe para a
  // corretagem em reais do contrato, e em tributos devolveria nulo lá na conta.
  it("base que não se aplica àquela rubrica é recusada com o rótulo da rubrica", () => {
    const erros = conferirPremissa({
      ...MULTA,
      base: "valor_efetivo",
      percentual: 5.93,
      rubrica: "tributos",
    });
    expect(erros).toEqual([
      { campo: "base", mensagem: "Esta base não se aplica a Tributos." },
    ]);
  });

  it("periodicidade fora de única/mensal é recusada", () => {
    expect(campos(conferirPremissa({ ...MULTA, periodicidade: "anual" }))).toEqual([
      "periodicidade",
    ]);
  });

  // ⚠️ O ERRO DE DIGITAÇÃO QUE A 0166 ENCOMENDOU O CHECK PARA PEGAR: uma publicidade "4% ao mês"
  // multiplicaria a dedução pelo número de meses de contrato, e ninguém conferiria.
  it("`mensal` em rubrica que não é fruição é recusada com a frase do operador", () => {
    const erros = conferirPremissa({
      ...MULTA,
      percentual: 4,
      periodicidade: "mensal",
      rubrica: "publicidade",
    });
    expect(erros).toEqual([
      {
        campo: "periodicidade",
        mensagem: "Só a fruição é cobrada por mês. As demais rubricas deduzem uma vez.",
      },
    ]);
  });

  it("`mensal` na fruição passa, que é a praxe de 0,75% ao mês", () => {
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

  it("percentual fora de 0 a 100 é recusado nas duas pontas", () => {
    expect(campos(conferirPremissa({ ...MULTA, percentual: 101 }))).toEqual(["percentual"]);
    expect(campos(conferirPremissa({ ...MULTA, percentual: -1 }))).toEqual(["percentual"]);
  });

  it("zero e cem são percentuais válidos", () => {
    expect(conferirPremissa({ ...MULTA, percentual: 0 })).toEqual([]);
    expect(conferirPremissa({ ...MULTA, percentual: 100 })).toEqual([]);
  });

  it("rubrica ligada sem percentual é recusada", () => {
    expect(conferirPremissa({ ...MULTA, percentual: null })).toEqual([
      { campo: "percentual", mensagem: "Informe o percentual desta rubrica." },
    ]);
  });

  it("percentual que não é número finito conta como ausente", () => {
    expect(campos(conferirPremissa({ ...MULTA, percentual: Number.NaN }))).toEqual(["percentual"]);
    expect(campos(conferirPremissa({ ...MULTA, percentual: "10" }))).toEqual(["percentual"]);
  });

  // ⚠️ A EXCEÇÃO QUE A MIGRATION PREVIU, E QUE NÃO PODE SER "ARRUMADA" POR ZELO: a corretagem
  // costuma ser o valor em reais que saiu do caixa lá atrás (R$ 4.705,22 no papel da Lavra do
  // Ouro). Recalculá-la por percentual hoje daria outro número se a tabela do lote mudou desde
  // então. Exigir percentual nas cinco rubricas impediria de cadastrar do jeito que o banco previu.
  it("ligada com base `valor_efetivo` e percentual nulo PASSA — é a corretagem em reais", () => {
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

  // ⚠️ DESLIGADA CONTINUA CADASTRADA: o histórico de por que aquele empreendimento não cobra a
  // rubrica vale mais do que a linha apagada — e por isso ela não precisa de número.
  it("desligada sem percentual passa, para guardar a cláusula que explica o porquê", () => {
    expect(
      conferirPremissa({
        ativa: false,
        base: "valor_de_tabela_menos_comissao",
        clausula: "O contrato do LBF não prevê ressarcimento de publicidade.",
        percentual: null,
        periodicidade: "unica",
        rubrica: "publicidade",
      }),
    ).toEqual([]);
  });

  it("cláusula de mais de 2.000 caracteres é recusada, e a de 2.000 passa", () => {
    expect(conferirPremissa({ ...MULTA, clausula: "x".repeat(2001) })).toEqual([
      { campo: "clausula", mensagem: "O trecho do contrato passa de 2.000 caracteres." },
    ]);
    expect(conferirPremissa({ ...MULTA, clausula: "x".repeat(2000) })).toEqual([]);
  });

  it("cláusula ausente ou nula passa, porque transcrever o contrato é opcional", () => {
    expect(conferirPremissa({ ...MULTA, clausula: null })).toEqual([]);
    expect(
      conferirPremissa({
        ativa: true,
        base: "valor_de_tabela_menos_comissao",
        percentual: 10,
        periodicidade: "unica",
        rubrica: "clausula_penal",
      }),
    ).toEqual([]);
  });

  // ⚠️ A TELA MOSTRA TODOS OS ERROS DE UMA VEZ, e não o primeiro. Devolver um erro por vez faria o
  // operador salvar cinco vezes para descobrir cinco problemas do mesmo formulário.
  it("junta os erros do formulário inteiro numa lista só", () => {
    const erros = conferirPremissa({
      ativa: true,
      base: "valor_venal",
      percentual: 140,
      periodicidade: "semanal",
      rubrica: "mora",
    });
    expect(campos(erros).sort()).toEqual(["base", "percentual", "periodicidade", "rubrica"]);
  });
});

// ⚠️⚠️ A TERCEIRA RÉGUA, QUE ERA A QUE FALTAVA. O par rubrica × base tinha três leis que
// discordavam: o CHECK da migration 0166 aceita qualquer uma das seis bases para qualquer rubrica;
// `conferirPremissa` (a gravação pela tela) só aceita as da rubrica; e a LEITURA aceitava qualquer
// uma. Uma linha nascida de SQL direto ou de backfill entraria com `fruicao` sobre `total_pago`, e
// `calcularRescisao` multiplicaria o total pago pelos meses de ocupação.
//
// Achado pela revisão adversarial em 15/09/2026.
describe("a leitura recusa base que não serve à rubrica", () => {
  it("fruição sobre o total pago é ignorada, e a rubrica cai na praxe", () => {
    const { premissas } = premissasDoRecorte(loteDoLBF, [
      linha({ base: "total_pago", enterpriseId: PAI, percentual: 0.75, rubrica: "fruicao" }),
    ]);
    expect(premissas.fruicao).toBeUndefined();
  });

  it("mas a mesma base passa na rubrica a que ela serve", () => {
    const { premissas } = premissasDoRecorte(loteDoLBF, [
      linha({ base: "total_pago", enterpriseId: PAI, percentual: 5.93, rubrica: "tributos" }),
    ]);
    expect(premissas.tributos?.base).toBe("total_pago");
  });

  it("a linha recusada não leva as vizinhas junto", () => {
    const { premissas } = premissasDoRecorte(loteDoLBF, [
      linha({ base: "total_pago", enterpriseId: PAI, percentual: 0.75, rubrica: "fruicao" }),
      linha({ enterpriseId: PAI, percentual: 10, rubrica: "clausula_penal" }),
    ]);
    expect(Object.keys(premissas)).toEqual(["clausula_penal"]);
  });
});
