// O MEI QUE TEM O CPF DENTRO DA RAZÃO SOCIAL: NOME LIMPO NO ENVELOPE, RAZÃO SOCIAL INTEIRA NO PAPEL.
//
// ⚠️ O NOME NÃO ESTAVA ERRADO, E ESSE É O FATO QUE DECIDE O DESENHO. "NOME + CPF" é a razão social
// que a Receita registra para o MEI, e é assim que ela chega do cadastro. Medido em produção
// (29/09/2026, só SELECT): a ficha `d20ac04f-e9c5-571f-8ed0-a4e4ba816a17` (entity_kind `pj`, CNPJ
// 24.634.744/0001-26, papéis imobiliária e pessoa_juridica, espelho do C2X por `users:4147`) tinha
// `legal_name` = "ROMULO ANTONIO SIQUEIRA GARCIA 05848834636" e `trade_name` = "ROMULO ANTONIO
// SIQUEIRA GARCIA". Quem recusava era a NOSSA conferência, antes de existir envelope, porque a
// Clicksign não aceita numeral no nome do signatário.
//
// ⚠️ SEIS IMOBILIÁRIAS NO MESMO FORMATO, e todas dariam o mesmo erro na primeira assinatura (medido
// em produção, 29/09/2026): o Rômulo mais EDSON LUIZ BARBOSA 06914662622 (38.069.036/0001-02),
// ERLAINE PERLA LEITE MENDES 02916013679 (32.428.801/0001-49), JOSE AMAVEL DE ALMEIDA 63691965687
// (37.234.063/0001-12), ROBERTO MATHEUS SILVA LANDAETA 40258211687 (42.806.352/0001-89) e ROSIMARY
// DOS SANTOS FREITAS 60066423600 (37.678.548/0001-03). A correção no CÓDIGO resolve as seis de uma
// vez, sem ninguém editar ficha por ficha, e é por isso que ela não é um UPDATE no banco.
//
// ⚠️ A DECISÃO É DO LUCAS (29/09/2026), perguntada e respondida: o nome do signatário é *"o nome sem
// o CPF"*. O sistema tira o número SÓ na hora de mandar para a Clicksign, e a razão social completa
// continua guardada e sai no contrato.
//
// ⚠️ UM PONTO SÓ LIMPA E O MESMO PONTO JULGA. Quem limpa é `nomeDeSignatario` (`ordem.ts`), a função
// que os dois montadores já chamam; `conferirSignatarios` julga o resultado DELA, e não o texto cru.
// Limpar num lugar e validar noutro seria a divergência de sempre: um dia a conferência recusa o que
// o envio já sabia arrumar, ou pior, aceita o que ele não arruma.

import { describe, expect, it } from "vitest";

import type { DadosDoContrato } from "@/lib/temis/preencher-contrato";

import { dadosDaProposta } from "@/lib/temis/dados-do-contrato";

import { nomeDeSignatario } from "./ordem";
import { conferirSignatarios, signatariosDoContrato } from "./signatarios";

const RAZAO_SOCIAL_DO_MEI = "ROMULO ANTONIO SIQUEIRA GARCIA 05848834636";
const NOME_SEM_O_CPF = "ROMULO ANTONIO SIQUEIRA GARCIA";

// ── O PADRÃO DO NOME ────────────────────────────────────────────────────────

describe("o nome que vai para a Clicksign perde o número", () => {
  it("⚠️ tira o CPF da razão social do MEI, e é a palavra inteira que sai", () => {
    expect(nomeDeSignatario(RAZAO_SOCIAL_DO_MEI)).toBe(NOME_SEM_O_CPF);
  });

  it("tira o CPF pontuado também, que é como o cadastro às vezes guarda", () => {
    expect(nomeDeSignatario("ROMULO ANTONIO SIQUEIRA GARCIA 058.488.346-36")).toBe(NOME_SEM_O_CPF);
  });

  it("não mexe em nome de pessoa física, que é a esmagadora maioria", () => {
    expect(nomeDeSignatario("Henrique Sales do Vale")).toBe("HENRIQUE SALES DO VALE");
    expect(nomeDeSignatario("Antônio Barbosa da Costa Júnior")).toBe(
      "ANTÔNIO BARBOSA DA COSTA JÚNIOR",
    );
  });

  it("não deixa espaço dobrado onde o número estava", () => {
    expect(nomeDeSignatario("ROMULO 05848834636 ANTONIO GARCIA")).toBe("ROMULO ANTONIO GARCIA");
  });

  // ⚠️ O OUTRO FORMATO DO MEI É O NÚMERO NA FRENTE, e ele é a MAIORIA. Medido em produção
  // (29/09/2026, só SELECT): das 36 fichas `pj` com número na razão social, 26 têm uma palavra de
  // documento, e a maior parte delas é a raiz do CNPJ antes do nome ("24.773.857 MARIA APARECIDA DE
  // ALMEIDA"), que é como a Receita registra o MEI novo. Só as SEIS do formato "NOME + CPF" apareceram
  // no print; as outras vinte travariam igual, na primeira assinatura de cada uma.
  it("⚠️ tira a raiz do CNPJ quando ela vem ANTES do nome, que é o MEI novo", () => {
    expect(nomeDeSignatario("24.773.857 MARIA APARECIDA DE ALMEIDA")).toBe(
      "MARIA APARECIDA DE ALMEIDA",
    );
    expect(nomeDeSignatario("60.054.065 RAIANE SANTOS OLIVEIRA")).toBe("RAIANE SANTOS OLIVEIRA");
  });

  it("tira o CNPJ inteiro também, com barra e tudo", () => {
    expect(nomeDeSignatario("ROMULO ANTONIO SIQUEIRA GARCIA 24.634.744/0001-26")).toBe(
      NOME_SEM_O_CPF,
    );
  });
});

// ── O NÚMERO QUE É DO NOME NÃO SAI, E A RECUSA CONTINUA ─────────────────────
//
// ⚠️ ESTA É A METADE QUE NÃO PODE SER ESQUECIDA, e ela veio da medição, não do print: das 36 fichas
// `pj` com número na razão social (produção, 29/09/2026, só SELECT), DEZ têm o número COMO PARTE DO
// NOME, e entre elas há imobiliária de verdade ("6BORGES IMOVEIS LTDA", "TS 360 NEGOCIOS
// IMOBILIARIOS") e incorporadora ("DS2 EMPREENDIMENTOS IMOBILIARIOS LTDA", "ON 1 CONSTRUTORA E
// EMPREENDIMENTOS IMOBILIARIOS LTDA", "KATZ 17 - HARAS DO PASSO...", "EMCCAMP INCORPORACAO SC 38 SPE
// LTDA", "J3M EMPREENDIMENTOS IMOBILIARIOS LTDA", "BE4 GROUP LTDA").
//
// ⚠️ APAGAR ESSAS PALAVRAS SERIA TROCAR UMA RECUSA BARATA POR UM CONTRATO ASSINADO COM O NOME ERRADO:
// "DS2 EMPREENDIMENTOS IMOBILIARIOS LTDA" viraria "EMPREENDIMENTOS IMOBILIARIOS LTDA" e ninguém
// veria, porque o envelope sairia normalmente. Então elas FICAM, e quem recusa é a conferência, com a
// frase que manda corrigir o cadastro: a mesma resposta que a casa dá desde que a trava existe.

describe("o número que é do nome fica no nome", () => {
  const pessoa = (nome: string) => ({ email: "h@x.com", nome, papel: "corretor" as const });

  it("⚠️ palavra com letra E número não é documento: ela não é apagada", () => {
    expect(nomeDeSignatario("6BORGES IMOVEIS LTDA")).toBe("6BORGES IMOVEIS LTDA");
    expect(nomeDeSignatario("DS2 EMPREENDIMENTOS IMOBILIARIOS LTDA")).toBe(
      "DS2 EMPREENDIMENTOS IMOBILIARIOS LTDA",
    );
  });

  it("⚠️ número curto e solto não é documento: \"TS 360\" e \"ON 1\" ficam inteiros", () => {
    expect(nomeDeSignatario("TS 360 NEGOCIOS IMOBILIARIOS")).toBe("TS 360 NEGOCIOS IMOBILIARIOS");
    expect(nomeDeSignatario("ON 1 CONSTRUTORA E EMPREENDIMENTOS IMOBILIARIOS LTDA")).toBe(
      "ON 1 CONSTRUTORA E EMPREENDIMENTOS IMOBILIARIOS LTDA",
    );
  });

  it("⚠️ data no nome não é documento: a barra só passa no CNPJ inteiro", () => {
    // A ficha 55.086.726/0001-80 tem a DATA DE CONSTITUIÇÃO colada na razão social. É cadastro para
    // consertar, e a conferência é quem tem de dizer isso.
    expect(nomeDeSignatario("IGREJA EVANGELICA CBA TEMPLO NOVO 10/05/2024")).toContain("10/05/2024");
  });

  // ⚠️ E A DATA NÃO PODE SUMIR SÓ PORQUE FOI ESCRITA COM PONTO (revisão de 29/09/2026). A primeira
  // escrita desta fatia contava DÍGITOS, e a barra era o que salvava a data: rodando aquela versão,
  // "...TEMPLO NOVO 10.05.2024" virava "...TEMPLO NOVO", calado. Data, CEP e telefone fixo têm oito
  // dígitos, como a raiz do CNPJ, e a ficha 55.086.726/0001-80 só estava protegida por acaso, porque
  // usa barra. Todos estes têm de FICAR no nome: a recusa é barata, o envelope de produção assinado
  // com o nome truncado não se desfaz.
  it("⚠️ data com PONTO, com HÍFEN e ao contrário ficam no nome, e não viram documento", () => {
    expect(nomeDeSignatario("IGREJA EVANGELICA CBA TEMPLO NOVO 10.05.2024")).toContain("10.05.2024");
    expect(nomeDeSignatario("IGREJA EVANGELICA CBA TEMPLO NOVO 10-05-2024")).toContain("10-05-2024");
    expect(nomeDeSignatario("IGREJA EVANGELICA CBA 2024.05.10")).toContain("2024.05.10");
    expect(nomeDeSignatario("2024-2025 ASSOCIACAO BENEFICENTE")).toContain("2024-2025");
  });

  it("⚠️ CEP, telefone fixo e bloco de 8 dígitos nus ficam no nome", () => {
    expect(nomeDeSignatario("FULANO IMOVEIS LTDA 74.000-000")).toContain("74.000-000");
    expect(nomeDeSignatario("FULANO IMOVEIS LTDA 74000000")).toContain("74000000");
    expect(nomeDeSignatario("IMOBILIARIA CENTRO 3221-4567")).toContain("3221-4567");
    expect(nomeDeSignatario("EMPRESA 12345678 LTDA")).toContain("12345678");
  });

  it("⚠️ e a conferência RECUSA cada um deles, que é o comportamento de antes desta fatia", () => {
    for (const cadastro of [
      "IGREJA EVANGELICA CBA TEMPLO NOVO 10.05.2024",
      "IGREJA EVANGELICA CBA TEMPLO NOVO 10-05-2024",
      "FULANO IMOVEIS LTDA 74.000-000",
      "FULANO IMOVEIS LTDA 74000000",
      "IMOBILIARIA CENTRO 3221-4567",
    ]) {
      const veredito = conferirSignatarios([pessoa(cadastro)]);
      expect(veredito.ok, cadastro).toBe(false);
    }
  });

  it("⚠️ e a conferência CONTINUA RECUSANDO o que sobrou com número", () => {
    const veredito = conferirSignatarios([pessoa("6BORGES IMOVEIS LTDA")]);

    expect(veredito.ok).toBe(false);
    if (veredito.ok) return;
    expect(veredito.erro).toContain("número");
    expect(veredito.erro).toContain("6BORGES IMOVEIS LTDA");
  });
});

// ── A SÉTIMA FICHA DE MEI: O CPF COLADO NO SOBRENOME ────────────────────────
//
// ⚠️ MEDIDA EM PRODUÇÃO (29/09/2026, só SELECT): `apolo_entities`
// `3b75c6e4-98db-551a-9379-0f8f1a922798`, `pj`, CNPJ 32.683.933/0001-17, com `legal_name` =
// `trade_name` = `display_name` = "MARCIA MARIA APARECIDA PEREIRA-CPF085.612.976-38". É o caso do
// Rômulo — razão social de MEI com o CPF dentro —, escrito com o documento GRUDADO no sobrenome. A
// regra da palavra inteira não pegava (a palavra tem letras), e a ficha travaria na primeira venda
// dela ouvindo "corrija o nome no cadastro" sobre uma razão social juridicamente correta.

describe("o documento grudado na palavra", () => {
  const pessoa = (nome: string) => ({ email: "h@x.com", nome, papel: "corretor" as const });

  it("⚠️ sai o CPF ancorado, e o sobrenome FICA", () => {
    expect(nomeDeSignatario("MARCIA MARIA APARECIDA PEREIRA-CPF085.612.976-38")).toBe(
      "MARCIA MARIA APARECIDA PEREIRA",
    );
  });

  it("aceita o CNPJ ancorado e a palavra que é só o documento rotulado", () => {
    expect(nomeDeSignatario("ALFA IMOVEIS-CNPJ24.634.744/0001-26")).toBe("ALFA IMOVEIS");
    expect(nomeDeSignatario("ALFA IMOVEIS CPF058.488.346-36")).toBe("ALFA IMOVEIS");
  });

  it("⚠️ e a conferência DEIXA PASSAR, porque não sobrou número", () => {
    expect(
      conferirSignatarios([pessoa("MARCIA MARIA APARECIDA PEREIRA-CPF085.612.976-38")]),
    ).toEqual({ ok: true });
  });

  // ⚠️ A ÂNCORA É O QUE SEGURA O RISCO DS2. Sem a palavra "CPF"/"CNPJ" e sem a contagem exata, apagar
  // dígito de dentro de palavra mutilaria marca de verdade — e o envelope sairia normal.
  it("⚠️ sem a âncora, ou com a contagem errada, a palavra fica inteira", () => {
    expect(nomeDeSignatario("DS2 EMPREENDIMENTOS IMOBILIARIOS LTDA")).toContain("DS2");
    expect(nomeDeSignatario("ALFA-CPF085.612.976")).toBe("ALFA-CPF085.612.976");
    expect(nomeDeSignatario("KATZ 17 - HARAS DO PASSO")).toContain("17");
  });
});

// ── O MONTADOR DOS SIGNATÁRIOS ──────────────────────────────────────────────

const contrato = (gerais: Record<string, string>): DadosDoContrato => ({
  compradores: [
    {
      ehPessoaFisica: true,
      temConjuge: false,
      valores: { email_cliente: "thiago@zzteste.careli.dev", nome_cliente: "THIAGO HENRIQUE DE SOUZA" },
    },
  ],
  gerais,
});

describe("a imobiliária MEI no envelope", () => {
  const dados = contrato({
    cpf_cnpj_vinculado: "24.634.744/0001-26",
    email_vinculado: "romulo@imobiliaria.test",
    nome_vinculado: RAZAO_SOCIAL_DO_MEI,
  });

  it("⚠️ o signatário sai SEM o CPF", () => {
    const { pessoas } = signatariosDoContrato(dados);
    const daImobiliaria = pessoas.find((p) => p.papel === "corretor");

    expect(daImobiliaria?.nome).toBe(NOME_SEM_O_CPF);
  });

  it("⚠️ e a conferência DEIXA PASSAR: era ela que travava o contrato do Rômulo", () => {
    const { pessoas } = signatariosDoContrato(dados);

    expect(conferirSignatarios(pessoas)).toEqual({ ok: true });
  });

  it("⚠️ o DADO não é tocado: `nome_vinculado` continua com a razão social inteira", () => {
    signatariosDoContrato(dados);

    // É a mesma chave que a minuta imprime (`[nome_vinculado]`, usada pelas 5 minutas publicadas).
    // Montar signatário não pode reescrever o que o papel diz.
    expect(dados.gerais.nome_vinculado).toBe(RAZAO_SOCIAL_DO_MEI);
  });

  it("o CPF/CNPJ do signatário continua indo, porque ele é campo próprio e não parte do nome", () => {
    const { pessoas } = signatariosDoContrato(dados);
    const daImobiliaria = pessoas.find((p) => p.papel === "corretor");

    expect(daImobiliaria?.cpf).toBe("24.634.744/0001-26");
  });
});

// ── A CONFERÊNCIA CONTINUA DE PÉ ────────────────────────────────────────────
//
// ⚠️ O QUE ELA PROTEGE DE VERDADE NÃO MUDOU: a Clicksign exige *"ao menos um `Nome` e um
// `Sobrenome`"*, e nome vazio não é signatário. Recusar aqui custa uma frase; descobrir no passo 3
// de 6 deixa envelope de PRODUÇÃO criado, pago e, depois de ativado, impossível de apagar.

// ⚠️ E ESTES TESTES ENTRAM PELO MONTADOR, que é o caminho de produção (revisão de 29/09/2026).
// Chamar `conferirSignatarios` à mão com o texto cru pulava a linha que muta o nome
// (`signatarios.ts:149`) e por isso não via o defeito real: no envio de verdade, `p.nome` já chega na
// conferência LIMPO, e as frases citavam o nome limpo em vez do texto do cadastro. Num cadastro que é
// só o documento, a frase saía com ASPAS VAZIAS, e o operador não tinha como achar a ficha.

/** O contrato de uma venda cuja imobiliária tem `nome_vinculado` igual ao texto do cadastro. */
const daImobiliariaComNome = (nomeNoCadastro: string) =>
  contrato({
    cpf_cnpj_vinculado: "24.634.744/0001-26",
    email_vinculado: "romulo@imobiliaria.test",
    nome_vinculado: nomeNoCadastro,
  });

/** A recusa que o envio de verdade produziria, do cadastro à frase. */
function recusaDoEnvio(nomeNoCadastro: string): string {
  const { pessoas } = signatariosDoContrato(daImobiliariaComNome(nomeNoCadastro));
  const veredito = conferirSignatarios(pessoas);

  expect(veredito.ok).toBe(false);
  return veredito.ok ? "" : veredito.erro;
}

describe("o que a conferência ainda recusa", () => {
  const pessoa = (nome: string) => ({ email: "h@x.com", nome, papel: "comprador" as const });

  it("nome de UMA PALAVRA continua recusado", () => {
    expect(recusaDoEnvio("Henrique")).toContain("sobrenome");
  });

  it("⚠️ nome que fica com UMA PALAVRA depois de limpo é recusado, e não sai lixo para a Clicksign", () => {
    const erro = recusaDoEnvio("ROMULO 05848834636");

    expect(erro).toContain("sobrenome");
    // ⚠️ E A FRASE CITA O CADASTRO INTEIRO, não o "ROMULO" que sobrou: é pelo texto gravado que se
    // acha a ficha.
    expect(erro).toContain("ROMULO 05848834636");
  });

  it("⚠️ nome que fica VAZIO depois de limpo é recusado, com o texto do cadastro na frase", () => {
    const erro = recusaDoEnvio("05848834636");

    expect(erro).toContain("sem nome para a Clicksign");
    // A frase diz o que o cadastro TEM (para a pessoa achar a ficha) e o que falta.
    expect(erro).toContain("05848834636");
    // ⚠️ E NUNCA SAI COM ASPAS VAZIAS, que é o que o caminho de produção produzia.
    expect(erro).not.toContain('""');
  });

  it("⚠️ e quem está sem e-mail é nomeado pelo cadastro, e não por um espaço em branco", () => {
    const dados = contrato({ email_vinculado: "", nome_vinculado: "05848834636" });
    const { pessoas } = signatariosDoContrato(dados);
    const veredito = conferirSignatarios(pessoas);

    expect(veredito.ok).toBe(false);
    if (veredito.ok) return;
    expect(veredito.erro).toContain("e-mail");
    expect(veredito.erro).toContain("05848834636");
  });

  it("pessoa física com nome normal não é afetada", () => {
    expect(conferirSignatarios([pessoa("Henrique Sales do Vale")])).toEqual({ ok: true });
  });
});

// ── A FRASE DIZ ONDE SE ARRUMA ──────────────────────────────────────────────
//
// ⚠️ "CORRIJA NO CADASTRO" ESTAVA ERRADO DE DOIS JEITOS. Para vendedora, coordenador e testemunha não
// existe ficha do Apolo para abrir: o nome deles é DIGITADO no Quadro de assinatura (aba Setup,
// sub-aba Assinatura). Medido em produção (29/09/2026, só SELECT): a única das 51 linhas de
// `temis_assinantes` com número no nome é `2b731fdc-60f1-4cda-82c6-9623a323f729`, empreendimento 41,
// coordenador, contrato@fgurgel.com.br, nome "1 FABRICIO LUZIANO GURGEL" — e ele assina TODO contrato
// daquele empreendimento. E para a imobiliária o campo É a razão social que o papel imprime: obedecer
// à frase antiga apagando o "DS2" põe o nome errado no contrato assinado.

describe("a frase de recusa diz onde se arruma", () => {
  it("⚠️ o coordenador do quadro é mandado ao Quadro de assinatura, e não a uma ficha", () => {
    const { pessoas } = signatariosDoContrato(contrato({}), [
      { email: "contrato@fgurgel.com.br", nome: "1 FABRICIO LUZIANO GURGEL", papel: "coordenadora" },
    ]);
    const veredito = conferirSignatarios(pessoas);

    expect(veredito.ok).toBe(false);
    if (veredito.ok) return;
    expect(veredito.erro).toContain("1 FABRICIO LUZIANO GURGEL");
    expect(veredito.erro).toContain("Quadro de assinatura");
  });

  it("⚠️ e a marca com número NÃO manda apagar o nome da ficha: o papel imprime esse campo", () => {
    const erro = recusaDoEnvio("DS2 EMPREENDIMENTOS IMOBILIARIOS LTDA");

    expect(erro).toContain("DS2 EMPREENDIMENTOS IMOBILIARIOS LTDA");
    expect(erro).toContain("RAZÃO SOCIAL");
    expect(erro).toContain("coordenação");
  });
});

// ── O MESMO DADO, OS DOIS DESTINOS ──────────────────────────────────────────
//
// ⚠️ ESTE É O TESTE QUE PRENDE O CONFLITO INTEIRO, e ele roda a leitura de verdade
// (`dadosDaProposta`), não um objeto montado à mão: `legal_name` é ao mesmo tempo a razão social que
// o contrato imprime (`dados-do-contrato.ts:1225` e :1405) e o nome do signatário
// (`signatarios.ts`, pelo `gerais.nome_vinculado`). Um campo só servindo a duas coisas
// incompatíveis: no papel o CPF do MEI DEVE aparecer, no envelope ele é recusado.

type Linhas = Record<string, unknown>;

/** O mesmo duplo encadeável de `lib/temis/dados-do-contrato.test.ts`: lê por tabela, sem banco. */
function clienteFalso(porTabela: Linhas) {
  const construir = (tabela: string) => {
    const filtros: Record<string, unknown> = {};
    const linhas = () => {
      const bruto = porTabela[tabela];
      return typeof bruto === "function"
        ? (bruto as (f: Record<string, unknown>) => unknown)(filtros)
        : bruto;
    };
    const resposta = () => ({ data: linhas() ?? null, error: null });
    const encadeia: Record<string, unknown> = new Proxy(
      {},
      {
        get(_alvo, prop: string) {
          if (prop === "maybeSingle") return () => Promise.resolve(resposta());
          if (prop === "then") {
            return (resolver: (r: unknown) => unknown) => Promise.resolve(resolver(resposta()));
          }
          if (prop === "eq") {
            return (coluna: string, valor: unknown) => {
              filtros[coluna] = valor;
              return encadeia;
            };
          }
          return () => encadeia;
        },
      },
    );
    return encadeia;
  };
  return { from: (tabela: string) => construir(tabela) } as never;
}

const CLIENTE = "aaaaaaaa-0000-0000-0000-000000000001";
const MEI = "d20ac04f-e9c5-571f-8ed0-a4e4ba816a17";

const ENTIDADE_CLIENTE = {
  display_name: "THIAGO HENRIQUE DE SOUZA",
  document_masked: "123.456.789-00",
  entity_kind: "pf",
  id: CLIENTE,
  legal_name: null,
  trade_name: null,
};

/** A ficha do Rômulo como ela estava em produção antes da limpeza de emergência do dia 29/09. */
const ENTIDADE_MEI = {
  display_name: RAZAO_SOCIAL_DO_MEI,
  document_masked: "24.634.744/0001-26",
  entity_kind: "pj",
  id: MEI,
  legal_name: RAZAO_SOCIAL_DO_MEI,
  trade_name: NOME_SEM_O_CPF,
};

const UNIDADE = {
  area: 300,
  area_extenso: null,
  codigo: "JDG0617",
  lote: "07",
  matricula: "45.678",
  matricula_livro: "3",
  preco_extenso: null,
  preco_tabela: 185400,
  quadra: "12",
  tipo_unidade: "lote",
};

const EMPREENDIMENTO = {
  c2x_enterprise_id: "39",
  cidade: "João Monlevade",
  codigo: "JDG",
  nome: "Jardim das Gerais",
  uf: "MG",
};

const PROPOSTA = {
  cliente_documento: "12345678900",
  cliente_nome: "THIAGO HENRIQUE DE SOUZA",
  compradores: [
    { cpf: "123.456.789-00", nome: "THIAGO HENRIQUE DE SOUZA", participacao: 100, titular: true },
  ],
  condicoes: {
    anuais: [],
    entrada: [{ numero: 1, total: 1, valor: 37080, vencimento: "2026-10-10" }],
    mensais: Array.from({ length: 120 }, (_, k) => ({ numero: k + 1, valor: 1236 })),
    totais: { anuais: 0, entrada: 37080, financiado: 148320, geral: 185400, mensais: 148320 },
  },
  dia_vencimento: 10,
  empreendimento_id: "eeeeeeee-0000-0000-0000-000000000001",
  imobiliaria_entity_id: MEI,
  imobiliaria_nome: "ROMULO IMOVEIS",
  plano_nome: "Normal 120x",
  unidade_id: "dddddddd-0000-0000-0000-000000000001",
  valor: 185400,
};

function vendaDoMei() {
  return clienteFalso({
    apolo_contacts: (f: Record<string, unknown>) =>
      f.entity_id === MEI
        ? [{ contact_type: "email", entity_id: MEI, value: "romulo@imobiliaria.test" }]
        : [{ contact_type: "email", entity_id: CLIENTE, value: "thiago@zzteste.careli.dev" }],
    apolo_entities: (f: Record<string, unknown>) => (f.id === MEI ? ENTIDADE_MEI : [ENTIDADE_CLIENTE]),
    apolo_esteira: [],
    apolo_relationships: [],
    apolo_source_links: [],
    hercules_empreendimentos: EMPREENDIMENTO,
    hercules_propostas: PROPOSTA,
    hercules_unidades: UNIDADE,
  });
}

describe("o mesmo dado, os dois destinos", () => {
  it("⚠️ razão social INTEIRA no papel e nome LIMPO no envelope, da mesma leitura", async () => {
    const lido = await dadosDaProposta("p1", vendaDoMei());
    const dados = lido!.dados;

    // No PAPEL: a razão social como a Receita registra, com o CPF do MEI.
    expect(dados.gerais.nome_vinculado).toBe(RAZAO_SOCIAL_DO_MEI);
    expect(dados.gerais.imobiliaria_nome).toBe(RAZAO_SOCIAL_DO_MEI);

    // No ENVELOPE: o nome sem o CPF.
    const { pessoas } = signatariosDoContrato(dados);
    const daImobiliaria = pessoas.find((p) => p.papel === "corretor");
    expect(daImobiliaria?.nome).toBe(NOME_SEM_O_CPF);

    // E o envio não é recusado.
    expect(conferirSignatarios(pessoas)).toEqual({ ok: true });
  });
});
