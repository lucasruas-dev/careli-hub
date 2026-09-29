import { readFileSync } from "node:fs";

import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";

import { clienteEmMemoria, novoEstado } from "@/lib/temis/fixtures/supabase-em-memoria";
import { lerOrdemDoCorpo } from "@/lib/temis/ordem-da-categoria";
import type { DadosDoContrato } from "@/lib/temis/preencher-contrato";

import { lerRegraDeOrdem, ordenarSignatarios } from "./ordem";
import { regraDeOrdemDaVenda } from "./ordem-db";
import {
  assinanteDeTermosDaVendedora,
  assinantesDoQuadro,
  PAPEL_DE_TERMOS_DA_VENDEDORA,
} from "./quadro-db";
import { signatariosDoContrato } from "./signatarios";

// REVISÃO INDEPENDENTE (20/09/2026) — UMA LENTE SÓ: O CONTRATO DE VENDA CONTINUA INTACTO.
//
// O papel `termos_vendedora` nasceu para o TERMO DE ACORDO do Hades. Ele mora na MESMA tabela
// (`temis_assinantes`), é gravado pela MESMA rota e aparece no MESMO cartão dos três papéis que
// assinam a compra e venda. Essa economia é boa e tem um preço exato: a única coisa que separa os
// dois mundos é um mapa em `quadro-db.ts`. Estes testes não confiam no mapa — eles montam o
// envelope do contrato com as funções REAIS do envio (`assinantesDoQuadro`,
// `signatariosDoContrato`, `regraDeOrdemDaVenda`, `ordenarSignatarios`, a mesma sequência de
// `prepararEnvio`) e comparam a lista inteira, pessoa por pessoa e número por número, ANTES e
// DEPOIS de o papel novo existir no banco. (Até 25/09/2026 a sequência começava por
// `empresasDoEmpreendimento`, que alimentava a herança do representante legal; as duas saíram.)
//
// ⚠️ O QUE ESTÁ SENDO PROTEGIDO, EM UMA FRASE: que um analista apontado para despachar termos não
// apareça, no dia seguinte, na qualificação e no envelope de uma COMPRA E VENDA.
//
// ── O QUE FOI MEDIDO EM PRODUÇÃO (Supabase bxgukywoxgivlrhjkwjx, SELECT, 20/09/2026) ────────────
//
//     apolo_enterprise_settings                40 linhas
//     ↳ com vendedora (vendedor_entity_id)     35, de 23 incorporadoras distintas
//     ↳ com coordenador                        24
//     apolo_relationships representante_legal  60 no total; ZERO apontam para as 23 incorporadoras
//                                              (conferido nas duas pontas), e exatamente 1 aponta
//                                              para uma empresa COORDENADORA
//     temis_assinantes                          0 linhas
//     temis_envelopes                           0 linhas
//     temis_categorias                          6, nenhuma com ordem própria
//     empreendimento com ordem gravada          1 (o de id 38), no FORMATO ANTIGO (lista de papéis)
//
// O cadastro abaixo reproduz essa forma. Nomes, CPF e e-mail são inventados de propósito: o que
// precisa ser fiel é a ESTRUTURA (quem tem vendedora, quem tem representante, quem é pai de quem).

/** Os 40 `enterprise_id` de produção, na ordem em que o banco os devolve. */
const EMPREENDIMENTOS = [
  "1", "2", "3", "4", "7", "10", "11", "12", "13", "14", "15", "17", "18", "19", "20", "21", "22",
  "23", "24", "26", "27", "28", "29", "30", "31", "32", "33", "34", "35", "36", "37", "38", "39",
  "40", "41", "42", "43", "9001", "group:Lagoa Bonita", "group:Vale do Ouro",
];

/** Os 5 sem `vendedor_entity_id` (medido). */
const SEM_VENDEDORA = new Set(["17", "33", "9001", "group:Lagoa Bonita", "group:Vale do Ouro"]);

/** Os 16 sem `coordenador_entity_id` (medido). */
const SEM_COORDENADOR = new Set([
  "1", "3", "4", "7", "10", "12", "19", "23", "24", "26", "31", "42", "43", "9001",
  "group:Lagoa Bonita", "group:Vale do Ouro",
]);

// ⚠️ A FAMÍLIA REAL DO VALE DO OURO: VLO (35) é o PAI de VOC (37), VOL (36) e VOR (41). É com ela
// que se testa "pai com assinante de termos, filho sem" — a tentativa mais óbvia de fazer o papel
// novo atravessar um nível que o quadro nunca teve.
const PAI_VLO = "35";
const FILHO_VOC = "37";

/** A única empresa coordenadora que TEM representante legal hoje (1 em 24). */
const COORDENADOR_COM_REPRESENTANTE = "2";

const UNIDADE_DO_FILHO = "55555555-5555-4555-8555-555555555555";
const CATEGORIA_DO_PAI = "44444444-4444-4444-8444-444444444444";

type Estado = ReturnType<typeof novoEstado>;

function cadastroDeProducao(): Estado {
  const estado = novoEstado();

  estado.tabelas.apolo_enterprise_settings = EMPREENDIMENTOS.map((id) => ({
    assinatura_ordem: id === "38" ? ORDEM_GRAVADA_EM_PRODUCAO : null,
    assinatura_ordenada: false,
    coordenador_entity_id: SEM_COORDENADOR.has(id) ? null : `coord-${id}`,
    enterprise_id: id,
    vendedor_entity_id: SEM_VENDEDORA.has(id) ? null : `pj-${id}`,
  }));

  // Nenhuma das 23 incorporadoras tem representante legal; uma coordenadora tem.
  estado.tabelas.apolo_relationships = [
    {
      entity_id: `coord-${COORDENADOR_COM_REPRESENTANTE}`,
      related_entity_id: "pessoa-do-coordenador",
      relationship_type: "representante_legal",
    },
  ];
  estado.tabelas.apolo_entities = [
    {
      display_name: "Pessoa Representante Da Coordenadora",
      document_masked: "529.982.247-25",
      id: "pessoa-do-coordenador",
    },
  ];
  estado.tabelas.apolo_contacts = [
    {
      contact_type: "email",
      entity_id: "pessoa-do-coordenador",
      value: "representante@exemplo.test",
    },
  ];

  estado.tabelas.temis_assinantes = [];
  estado.tabelas.temis_categorias = [];
  estado.tabelas.hercules_unidades = [
    { categoria_id: null, enterprise_id: FILHO_VOC, id: UNIDADE_DO_FILHO },
  ];

  return estado;
}

/** A única `assinatura_ordem` gravada em produção hoje: o formato ANTIGO, uma lista de papéis. */
const ORDEM_GRAVADA_EM_PRODUCAO = [
  "comprador",
  "conjuge",
  "vendedora",
  "coordenadora",
  "corretor",
  "testemunha",
  "interveniente",
];

const cliente = (estado: Estado) => clienteEmMemoria(estado) as unknown as SupabaseClient;

const linhaDoQuadro = (
  enterpriseId: string,
  papel: string,
  posicao: number,
  nome: string,
  extra: Record<string, unknown> = {},
) => ({
  ativo: true,
  cpf: "529.982.247-25",
  email: `${papel}${posicao}@exemplo.test`,
  enterprise_id: enterpriseId,
  id: `00000000-0000-4000-8000-${papel.slice(0, 4)}${String(posicao).padStart(8, "0")}`,
  nome,
  ordem_assinatura: null,
  papel,
  posicao,
  telefone: null,
  workspace_id: "careli",
  ...extra,
});

const CONTRATO: DadosDoContrato = {
  compradores: [
    {
      ehPessoaFisica: true,
      temConjuge: true,
      valores: {
        cpf_cliente: "999.999.004-53",
        email_cliente: "comprador@exemplo.test",
        email_conjuge: "conjuge@exemplo.test",
        nome_cliente: "COMPRADOR TITULAR EXEMPLO",
        nome_conjuge: "CONJUGE DO TITULAR EXEMPLO",
      },
    },
  ],
  gerais: {},
};

/**
 * O ENVELOPE DO CONTRATO, montado com as funções reais e na ordem real.
 *
 * É a mesma sequência de `prepararEnvio` (`lib/assinatura/envio-db.ts`), sem a leitura do PDF
 * guardado: quadro → signatários do contrato → regra de ordem → numeração. Se o papel novo tivesse
 * como entrar no contrato, entraria por aqui.
 */
async function envelopeDoContrato(
  estado: Estado,
  enterpriseId: string,
  unidadeId: null | string = null,
) {
  const sb = cliente(estado);
  const doQuadro = await assinantesDoQuadro(sb, { enterpriseId });
  const montagem = signatariosDoContrato(CONTRATO, doQuadro);
  const { origem, regra } = await regraDeOrdemDaVenda(sb, { enterpriseId, unidadeId });
  return {
    avisos: montagem.avisos,
    origemDaRegra: origem,
    regra,
    signatarios: ordenarSignatarios(montagem.pessoas, regra),
  };
}

describe("o envelope do contrato, nos 40 empreendimentos de produção", () => {
  // ⚠️ ESTE É O TESTE QUE VALE O ARQUIVO. Ele não pergunta "o papel está no mapa?": ele MONTA os 40
  // envelopes duas vezes — com a tabela como está hoje (vazia) e com uma linha `termos_vendedora`
  // em CADA UM DOS 40 — e exige que as duas listas sejam iguais, pessoa por pessoa, papel por papel
  // e número por número. É a forma direta de dizer "nenhum contrato passa a ter um assinante a mais
  // ou a menos".
  it("não ganha nem perde ninguém quando o papel novo existe em todos eles", async () => {
    const antes = novoEstado();
    Object.assign(antes, cadastroDeProducao());
    const listaAntes: unknown[] = [];
    for (const id of EMPREENDIMENTOS) listaAntes.push(await envelopeDoContrato(antes, id));

    const depois = cadastroDeProducao();
    depois.tabelas.temis_assinantes = EMPREENDIMENTOS.map((id) =>
      linhaDoQuadro(id, PAPEL_DE_TERMOS_DA_VENDEDORA, 1, "Analista Do Juridico Exemplo"),
    );
    const listaDepois: unknown[] = [];
    for (const id of EMPREENDIMENTOS) listaDepois.push(await envelopeDoContrato(depois, id));

    expect(listaDepois).toEqual(listaAntes);
  });

  // O retrato de hoje, para que a comparação acima não seja "vazio igual a vazio" sem ninguém notar:
  // sem `temis_assinantes` e sem representante legal na incorporadora, o envelope sai com comprador
  // e cônjuge e mais ninguém — e com os dois avisos que a tela mostra ao lado do botão.
  it("hoje sai com comprador e cônjuge, e avisa que falta vendedora e testemunha", async () => {
    const { avisos, signatarios } = await envelopeDoContrato(cadastroDeProducao(), FILHO_VOC);

    expect(signatarios.map((s) => s.papel)).toEqual(["comprador", "conjuge"]);
    expect(avisos).toHaveLength(2);
  });

  // ⚠️ A HERANÇA DA FICHA ACABOU (25/09/2026). Até esta data a coordenadora com representante legal
  // punha a pessoa dela no envelope sem linha nenhuma no quadro; era a regra que, no VOR, deixou a
  // tela e o envio discordando. Lucas: *"todas assinaturas eu tenho que conseguir excluir e editar,
  // esse cadeado esta errado"*. Quem herdava virou linha gravada (migration 0191); sem a linha, o
  // envelope não tem ninguém no papel, e o papel novo ao lado continua fora do contrato.
  it("o representante legal da ficha não entra mais sozinho, nem com o papel novo ao lado", async () => {
    const estado = cadastroDeProducao();
    estado.tabelas.temis_assinantes = [
      linhaDoQuadro(
        COORDENADOR_COM_REPRESENTANTE,
        PAPEL_DE_TERMOS_DA_VENDEDORA,
        1,
        "Analista Do Juridico Exemplo",
      ),
    ];

    const { signatarios } = await envelopeDoContrato(estado, COORDENADOR_COM_REPRESENTANTE);

    expect(signatarios.map((s) => s.papel)).toEqual(["comprador", "conjuge"]);
    expect(signatarios.map((s) => s.nome)).not.toContain("Analista Do Juridico Exemplo");
    expect(signatarios.map((s) => s.email)).not.toContain("representante@exemplo.test");
  });

  // E a mesma pessoa, gravada no quadro como a 0191 grava, é quem vai.
  it("gravado no quadro como a 0191 grava, o representante volta ao envelope", async () => {
    const estado = cadastroDeProducao();
    estado.tabelas.temis_assinantes = [
      linhaDoQuadro(
        COORDENADOR_COM_REPRESENTANTE,
        "coordenador",
        1,
        "Pessoa Representante Da Coordenadora",
        { origem: "backfill_heranca_0191" },
      ),
    ];

    const { signatarios } = await envelopeDoContrato(estado, COORDENADOR_COM_REPRESENTANTE);

    expect(signatarios.map((s) => s.papel)).toEqual(["comprador", "conjuge", "coordenadora"]);
  });
});

describe("com o quadro cheio — o cenário do dia em que a casa cadastrar tudo", () => {
  const quadroCheio = () => {
    const estado = cadastroDeProducao();
    estado.tabelas.temis_assinantes = [
      linhaDoQuadro(FILHO_VOC, "vendedora", 1, "Socia Administradora Exemplo"),
      linhaDoQuadro(FILHO_VOC, "coordenador", 1, "Coordenador De Vendas Exemplo"),
      linhaDoQuadro(FILHO_VOC, "testemunha", 1, "Primeira Testemunha Exemplo"),
      linhaDoQuadro(FILHO_VOC, "testemunha", 2, "Segunda Testemunha Exemplo", {
        ordem_assinatura: 4,
      }),
    ];
    return estado;
  };

  it("nove linhas de termos não mexem em quem assina nem em que número cada um recebe", async () => {
    const antes = await envelopeDoContrato(quadroCheio(), FILHO_VOC);

    const comTermos = quadroCheio();
    for (let n = 1; n <= 9; n += 1) {
      (comTermos.tabelas.temis_assinantes as unknown[]).push(
        linhaDoQuadro(
          FILHO_VOC,
          PAPEL_DE_TERMOS_DA_VENDEDORA,
          n,
          `Apontado Para Termos ${n}`,
          // ⚠️ COM `ordem_assinatura` PREENCHIDA DE PROPÓSITO, e com 1: se a linha atravessasse,
          // ela não entraria só no envelope — entraria assinando ANTES do comprador.
          { ordem_assinatura: 1 },
        ),
      );
    }
    const depois = await envelopeDoContrato(comTermos, FILHO_VOC);

    expect(depois).toEqual(antes);
    expect(antes.signatarios.map((s) => s.papel)).toEqual([
      "comprador",
      "conjuge",
      "vendedora",
      "coordenadora",
      "testemunha",
      "testemunha",
    ]);
  });

  // ⚠️ A TENTATIVA MAIS BARATA DE QUEBRAR: gravar o papel à mão, com `origem` e `entity_id` de
  // gente de verdade, para ver se alguma leitura o confunde com a vendedora do contrato.
  it("gravado à mão, com origem e entidade, continua fora do contrato", async () => {
    const estado = quadroCheio();
    (estado.tabelas.temis_assinantes as unknown[]).push(
      linhaDoQuadro(FILHO_VOC, PAPEL_DE_TERMOS_DA_VENDEDORA, 3, "Apontado A Mao Exemplo", {
        entity_id: "pessoa-do-coordenador",
        origem: "representante",
      }),
    );

    const { signatarios } = await envelopeDoContrato(estado, FILHO_VOC);

    expect(signatarios.map((s) => s.nome)).not.toContain("Apontado A Mao Exemplo");
    expect(signatarios.filter((s) => s.papel === "vendedora")).toHaveLength(1);
  });
});

describe("pai com assinante de termos, filho sem", () => {
  const paiComTermos = () => {
    const estado = cadastroDeProducao();
    estado.tabelas.temis_assinantes = [
      linhaDoQuadro(PAI_VLO, PAPEL_DE_TERMOS_DA_VENDEDORA, 1, "Apontado Do Pai Exemplo"),
      linhaDoQuadro(PAI_VLO, "vendedora", 1, "Vendedora Do Pai Exemplo"),
    ];
    return estado;
  };

  it("o contrato do filho não herda nada do pai — nem o papel novo, nem a vendedora", async () => {
    const estado = paiComTermos();
    const doFilho = await envelopeDoContrato(estado, FILHO_VOC, UNIDADE_DO_FILHO);

    expect(doFilho.signatarios.map((s) => s.nome)).toEqual([
      "COMPRADOR TITULAR EXEMPLO",
      "CONJUGE DO TITULAR EXEMPLO",
    ]);
  });

  // A regra de herança APLICADA é "só empreendimento". Esta é a prova de que ela é mesmo essa: o
  // apontado do pai não aparece para o filho, e aparece para o pai.
  it("o apontado do pai vale só para o pai", async () => {
    const sb = cliente(paiComTermos());

    expect(await assinanteDeTermosDaVendedora(sb, FILHO_VOC)).toBeNull();
    expect(await assinanteDeTermosDaVendedora(sb, PAI_VLO)).toMatchObject({
      nome: "Apontado Do Pai Exemplo",
      papel: "vendedora",
    });
  });
});

describe("a ordem de assinatura do contrato", () => {
  // ⚠️ O FORMATO ANTIGO É O QUE ESTÁ GRAVADO EM PRODUÇÃO. A única `assinatura_ordem` da base (o
  // empreendimento 38) é uma LISTA de papéis, não o objeto `ordens`. Enfiar o papel novo nessa
  // lista é o caminho que um script ou uma rota nova teria para tentar introduzi-lo.
  it("o papel novo enfiado na lista gravada é descartado, e a fila não muda", async () => {
    const limpa = cadastroDeProducao();
    const antes = await envelopeDoContrato(limpa, "38");

    const suja = cadastroDeProducao();
    (suja.tabelas.apolo_enterprise_settings as Array<Record<string, unknown>>).find(
      (l) => l.enterprise_id === "38",
    )!.assinatura_ordem = [
      PAPEL_DE_TERMOS_DA_VENDEDORA,
      ...ORDEM_GRAVADA_EM_PRODUCAO,
    ];
    const depois = await envelopeDoContrato(suja, "38");

    expect(depois.regra).toEqual(antes.regra);
    expect(depois.origemDaRegra).toBe("empreendimento");
    expect(Object.keys(depois.regra.ordens)).not.toContain(PAPEL_DE_TERMOS_DA_VENDEDORA);
  });

  // ⚠️ E PELA CATEGORIA, que é o degrau que vence o empreendimento. A categoria do Vale do Ouro mora
  // no PAI e é lida pela unidade do filho: é o caminho por onde uma configuração do pai chega, sim,
  // ao contrato do filho — e por isso ele precisa ser testado com o papel novo dentro.
  it("a categoria com ordem própria também o descarta, sem deixar de mandar", async () => {
    const estado = cadastroDeProducao();
    estado.tabelas.temis_categorias = [
      {
        assinatura_ordem: [PAPEL_DE_TERMOS_DA_VENDEDORA, "comprador", "vendedora"],
        assinatura_ordenada: true,
        enterprise_id: PAI_VLO,
        id: CATEGORIA_DO_PAI,
        workspace_id: "careli",
      },
    ];
    (estado.tabelas.hercules_unidades as Array<Record<string, unknown>>)[0]!.categoria_id =
      CATEGORIA_DO_PAI;

    const { origemDaRegra, regra } = await envelopeDoContrato(
      estado,
      FILHO_VOC,
      UNIDADE_DO_FILHO,
    );

    expect(origemDaRegra).toBe("categoria");
    expect(Object.keys(regra.ordens)).not.toContain(PAPEL_DE_TERMOS_DA_VENDEDORA);
    // A lista que sobra é "comprador, vendedora e o resto atrás": o papel descartado não empurrou
    // ninguém para trás.
    expect(regra.ordens.comprador).toBe(1);
    expect(regra.ordens.vendedora).toBe(2);
  });

  it("nem pelo formato novo, um número por papel", () => {
    const regra = lerRegraDeOrdem({
      ordenada: true,
      ordens: { comprador: 1, [PAPEL_DE_TERMOS_DA_VENDEDORA]: 1, vendedora: 2 },
    });

    expect(Object.keys(regra.ordens)).not.toContain(PAPEL_DE_TERMOS_DA_VENDEDORA);
  });
});

describe("a fronteira, lida no código que roda", () => {
  const fonte = (caminho: string) => readFileSync(new URL(caminho, import.meta.url), "utf8");

  // ⚠️ O ENVIO DO CONTRATO NÃO CONHECE A FUNÇÃO NOVA. `lib/assinatura/envio-db.ts` é o arquivo que
  // monta o envelope da compra e venda; `lib/hades/acordo/envio-db.ts` é o do termo. Só o segundo
  // importa `assinanteDeTermosDaVendedora`. O dia em que o primeiro importar, este teste cai.
  it("o envio do contrato não importa o assinante de termos", () => {
    expect(fonte("./envio-db.ts")).not.toContain("assinanteDeTermosDaVendedora");
    expect(fonte("../hades/acordo/envio-db.ts")).toContain("assinanteDeTermosDaVendedora");
  });

  // O cartão da ORDEM de assinatura (o que numera os papéis do contrato) itera
  // `PAPEIS_DO_CONTRATO` e não sabe o que é o papel novo.
  it("o cartão de ordem do contrato não menciona o papel novo", () => {
    const card = fonte("../../modules/apolo/blocks/empreendimentos/ordem-de-assinatura-card.tsx");

    expect(card).not.toContain(PAPEL_DE_TERMOS_DA_VENDEDORA);
    expect(card).toContain("PAPEIS_DO_CONTRATO");
  });

  // ⚠️ E O PORTAL DA CECÍLIO CONTINUA SEM O CAMPO NA TELA, mas a porta quem fecha é o SERVIDOR
  // (corrigido em 20/09/2026). A rota `/api/incorporador/temis/assinantes` chama a MESMA
  // `incluirAssinante`, então a propriedade do React só governa o que se vê; a recusa do papel para
  // o ator do portal mora em `PAPEL_SO_DA_CARELI` (`lib/temis/estrutura-servico.ts`) e está medida
  // em `lib/temis/revisao-cartao-do-empreendimento.test.ts`.
  it("o portal renderiza o cartão sem o campo de termos", () => {
    const portal = fonte("../../modules/incorporador/hercules/MinutasDoProduto.tsx");

    expect(portal).toContain("<QuadroDeAssinaturaCard enterpriseId={enterpriseId} />");
    expect(portal).not.toContain("comAssinantesDeTermos");
  });
});

describe("a validação das categorias", () => {
  // A porta que grava a ordem da categoria mede por `PAPEIS_DO_CONTRATO`. O papel novo não está lá,
  // então ele é RECUSADO com nome — e não silenciosamente ignorado, que é o que deixaria alguém
  // acreditar que cadastrou.
  it("recusa o papel novo pelo nome, e não o oferece como válido", () => {
    const lida = lerOrdemDoCorpo({
      assinaturaOrdem: ["comprador", PAPEL_DE_TERMOS_DA_VENDEDORA],
      assinaturaOrdenada: true,
    });

    expect(lida.ok).toBe(false);
    if (lida.ok) return;
    expect(lida.erro).toContain(`"${PAPEL_DE_TERMOS_DA_VENDEDORA}"`);
    expect(lida.erro).toContain("Papel que não existe na ordem");
    // A frase que lista os papéis válidos não pode oferecê-lo.
    expect(lida.erro.split("Os válidos são")[1]).not.toContain(PAPEL_DE_TERMOS_DA_VENDEDORA);
  });

  it("e continua aceitando a ordem de sempre", () => {
    const lida = lerOrdemDoCorpo({
      assinaturaOrdem: ["comprador", "vendedora", "testemunha"],
      assinaturaOrdenada: true,
    });

    expect(lida).toEqual({
      mudancas: {
        assinatura_ordem: ["comprador", "vendedora", "testemunha"],
        assinatura_ordenada: true,
      },
      ok: true,
    });
  });
});
