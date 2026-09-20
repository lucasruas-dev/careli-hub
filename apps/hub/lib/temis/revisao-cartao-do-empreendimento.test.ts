import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  assinanteDeTermosDaVendedora,
  assinantesDoQuadro,
  PAPEL_DE_TERMOS_DA_VENDEDORA,
} from "@/lib/assinatura/quadro-db";

import { type EstadoDoBanco, novoEstado } from "./fixtures/supabase-em-memoria";

// REVISÃO INDEPENDENTE (20/09/2026) — O CARTÃO DO EMPREENDIMENTO, MEDIDO NA FUNÇÃO REAL.
//
// `lerQuadroDeAssinatura` é a ÚNICA leitura por trás do cartão, tanto no Apolo quanto no portal da
// Cecílio (`MinutasDoProduto`). Ela mudou: passou a pedir ao cadastro um terceiro representante
// herdado, agora para o papel `termos_vendedora`. A pergunta desta revisão é uma só — o que o
// operador vê nos TRÊS papéis do contrato continua igual?
//
// ⚠️ SEM `vi.mock` DO QUADRO. O único duplo aqui é o Supabase em memória (o mesmo que a porta do
// portal já usa) e o cliente admin. A função medida é a de produção, inteira.
//
// Medido em produção em 20/09/2026: ZERO das 23 incorporadoras tem representante legal, então o
// bloco novo nasce VAZIO em todos os 35 empreendimentos com vendedora. O cenário "com
// representante" abaixo é o dia seguinte ao primeiro cadastro, e é ele que revela o que o cartão
// passa a mostrar.

const estado = vi.hoisted(() => ({ banco: null as unknown }));

vi.mock("@/lib/apolo/server", async () => {
  const { clienteEmMemoria: emMemoria } = await import("./fixtures/supabase-em-memoria");
  return {
    createApoloAdminClient: () =>
      emMemoria(estado.banco as Parameters<typeof emMemoria>[0]),
  };
});

const { incluirAssinante, lerQuadroDeAssinatura, removerAssinante } = await import(
  "./estrutura-servico"
);

const EMPREENDIMENTO = "37";
const INCORPORADORA = "pj-37";
const ATOR = { nome: "Jurídico Careli", papel: "leitura", tipo: "hub", userId: "user-1" } as const;

type Assinante = {
  cpf: null | string;
  email: null | string;
  id: null | string;
  nome: string;
  ordemAssinatura: null | number;
  origem: null | string;
  papel: string;
  posicao: number;
};

function cadastro(comRepresentanteNaIncorporadora: boolean): EstadoDoBanco {
  const novo = novoEstado();
  novo.tabelas.apolo_enterprise_settings = [
    {
      coordenador_entity_id: null,
      enterprise_id: EMPREENDIMENTO,
      vendedor_entity_id: INCORPORADORA,
    },
  ];
  novo.tabelas.apolo_relationships = comRepresentanteNaIncorporadora
    ? [
        {
          entity_id: INCORPORADORA,
          related_entity_id: "pessoa-socia",
          relationship_type: "representante_legal",
        },
      ]
    : [];
  novo.tabelas.apolo_entities = [
    {
      display_name: "Socia Administradora Exemplo",
      document_masked: "529.982.247-25",
      id: "pessoa-socia",
    },
  ];
  novo.tabelas.apolo_contacts = [
    { contact_type: "email", entity_id: "pessoa-socia", value: "socia@exemplo.test" },
  ];
  novo.tabelas.temis_assinantes = [
    {
      ativo: true,
      cpf: "529.982.247-25",
      email: "testemunha@exemplo.test",
      enterprise_id: EMPREENDIMENTO,
      id: "99999999-9999-4999-8999-999999999999",
      nome: "Primeira Testemunha Exemplo",
      ordem_assinatura: null,
      origem: null,
      papel: "testemunha",
      posicao: 1,
      workspace_id: "careli",
    },
  ];
  return novo;
}

async function cartao(banco: EstadoDoBanco): Promise<Assinante[]> {
  estado.banco = banco;
  const resposta = await lerQuadroDeAssinatura(
    ATOR,
    new Request(`https://c2x.app.br/api/temis/assinantes?enterpriseId=${EMPREENDIMENTO}`),
  );
  const corpo = (await resposta.json()) as { assinantes: Assinante[] };
  return corpo.assinantes;
}

const doContrato = (lista: Assinante[]) =>
  lista.filter((a) => a.papel !== PAPEL_DE_TERMOS_DA_VENDEDORA);

beforeEach(() => {
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("o cartão do empreendimento, como está a base hoje", () => {
  // Sem representante legal na incorporadora — o estado dos 35 empreendimentos com vendedora —,
  // o bloco novo não acrescenta NADA à resposta: ela é idêntica à de antes.
  it("sem representante na incorporadora, a resposta não ganha linha nenhuma", async () => {
    const lista = await cartao(cadastro(false));

    expect(lista.map((a) => [a.papel, a.nome])).toEqual([
      ["testemunha", "Primeira Testemunha Exemplo"],
    ]);
  });

  // Uma linha `termos_vendedora` gravada à mão (o que a migration 0180 vai permitir) não mexe em
  // nenhum dos três papéis do contrato: ela sai à parte, no papel dela.
  it("a linha de termos sai só no papel dela, sem tocar nos três do contrato", async () => {
    const banco = cadastro(false);
    const semTermos = doContrato(await cartao(banco));

    const comTermos = cadastro(false);
    (comTermos.tabelas.temis_assinantes as unknown[]).push({
      ativo: true,
      cpf: "529.982.247-25",
      email: "juridico@exemplo.test",
      enterprise_id: EMPREENDIMENTO,
      id: "98989898-9898-4898-8898-989898989898",
      nome: "Analista Do Juridico Exemplo",
      ordem_assinatura: null,
      origem: null,
      papel: PAPEL_DE_TERMOS_DA_VENDEDORA,
      posicao: 1,
      workspace_id: "careli",
    });
    const lista = await cartao(comTermos);

    expect(doContrato(lista)).toEqual(semTermos);
    expect(lista.filter((a) => a.papel === PAPEL_DE_TERMOS_DA_VENDEDORA)).toHaveLength(1);
  });
});

describe("o cartão no dia em que a incorporadora tiver representante legal", () => {
  // ⚠️ ESTE É O ACHADO QUE ESTE ARQUIVO REGISTRA, E ELE NÃO É DO CONTRATO — É DA TELA. Com o
  // representante legal cadastrado, a MESMA pessoa passa a ocupar DUAS linhas do cartão: a herdada
  // do bloco "Vendedora (quem assina o contrato)" e a herdada do bloco "Assinatura de termos
  // (vendedora)". As duas vêm de `vendedor_entity_id`, e nenhuma delas tem id (não se apaga).
  //
  // O contrato não muda por causa disso: o bloco de termos não vai para o envelope. Mas o operador
  // que abrir a tela vai ver o nome repetido, e a única diferença entre as duas linhas é o título
  // da seção em que elas aparecem.
  it("a mesma pessoa aparece nos dois blocos, herdada duas vezes", async () => {
    const lista = await cartao(cadastro(true));

    const herdadas = lista.filter((a) => a.id === null);
    expect(herdadas.map((a) => a.papel).sort()).toEqual([
      PAPEL_DE_TERMOS_DA_VENDEDORA,
      "vendedora",
    ]);
    expect(new Set(herdadas.map((a) => a.nome)).size).toBe(1);
  });

  // E os TRÊS papéis do contrato continuam com exatamente as mesmas linhas de antes da mudança.
  it("mas os papéis do contrato continuam com as mesmas linhas", async () => {
    const lista = doContrato(await cartao(cadastro(true)));

    expect(lista.map((a) => [a.papel, a.nome, a.posicao])).toEqual([
      ["vendedora", "Socia Administradora Exemplo", 1],
      ["testemunha", "Primeira Testemunha Exemplo", 1],
    ]);
  });
});

describe("a fronteira na direção contrária: quem assina o CONTRATO assinando um TERMO", () => {
  // A cadeia do envio do acordo, copiada linha a linha de `lib/hades/acordo/envio-db.ts`:
  //
  //     incorporador: apontadoParaTermos ?? doQuadro.find((p) => p.papel === "vendedora") ?? null
  //
  // Ou seja: o degrau do meio é a VENDEDORA DO CONTRATO — a pessoa cujo nome sai na qualificação da
  // compra e venda e que o jurídico confere contra a procuração.
  async function incorporadorDoAcordo(banco: EstadoDoBanco) {
    const { clienteEmMemoria: emMemoria } = await import("./fixtures/supabase-em-memoria");
    const sb = emMemoria(banco) as unknown as SupabaseClient;
    const apontado = await assinanteDeTermosDaVendedora(sb, EMPREENDIMENTO);
    const doQuadro = await assinantesDoQuadro(sb, {
      enterpriseId: EMPREENDIMENTO,
      vendedoraEntityId: INCORPORADORA,
    });
    return apontado ?? doQuadro.find((p) => p.papel === "vendedora") ?? null;
  }

  const comVendedoraDoContrato = () => {
    const banco = cadastro(false);
    (banco.tabelas.temis_assinantes as unknown[]).push({
      ativo: true,
      cpf: "529.982.247-25",
      email: "socia@exemplo.test",
      enterprise_id: EMPREENDIMENTO,
      id: "97979797-9797-4797-8797-979797979797",
      nome: "Socia Que Assina O Contrato",
      ordem_assinatura: null,
      origem: null,
      papel: "vendedora",
      posicao: 1,
      workspace_id: "careli",
    });
    return banco;
  };

  it("sem ninguém apontado, o termo vai para a vendedora do contrato", async () => {
    const quem = await incorporadorDoAcordo(comVendedoraDoContrato());

    expect(quem?.nome).toBe("Socia Que Assina O Contrato");
  });

  it("e o apontado, quando existe, vence a vendedora do contrato", async () => {
    const banco = comVendedoraDoContrato();
    (banco.tabelas.temis_assinantes as unknown[]).push({
      ativo: true,
      cpf: "529.982.247-25",
      email: "juridico@exemplo.test",
      enterprise_id: EMPREENDIMENTO,
      id: "96969696-9696-4696-8696-969696969696",
      nome: "Analista Do Juridico Exemplo",
      ordem_assinatura: null,
      origem: null,
      papel: PAPEL_DE_TERMOS_DA_VENDEDORA,
      posicao: 1,
      workspace_id: "careli",
    });

    const quem = await incorporadorDoAcordo(banco);

    expect(quem?.nome).toBe("Analista Do Juridico Exemplo");
  });

  // ⚠️ O TEXTO DO CARTÃO CITA OS TRÊS DEGRAUS (corrigido em 20/09/2026). Neste cenário (vendedora
  // cadastrada no quadro, ninguém apontado para termos, empresa sem representante legal) o bloco
  // "Assinatura de termos (vendedora)" dizia que o termo "tenta o representante legal cadastrado na
  // empresa e, se ela não tiver um, o envio fica bloqueado".
  //
  // As duas afirmações eram falsas aqui: o envio NÃO fica bloqueado e NÃO procura representante
  // nenhum — ele manda o termo para a pessoa que assina a COMPRA E VENDA, medido no teste acima. O
  // operador lia a tela, concluía que ninguém ia assinar, e o acordo saía assinado por quem ele não
  // apontou. Era o cruzamento contrato/termo na direção contrária à que o campo novo veio desfazer.
  //
  // A frase de impedimento do envio (`signatarios-do-acordo.ts`) já citava os três degraus; a do
  // cartão citava dois.
  it("o texto do bloco vazio menciona a vendedora do contrato, que é quem vai assinar", async () => {
    const { readFileSync } = await import("node:fs");
    const card = readFileSync(
      new URL(
        "../../modules/apolo/blocks/empreendimentos/quadro-de-assinatura-card.tsx",
        import.meta.url,
      ),
      "utf8",
    );
    const vazio = card.slice(
      card.indexOf("Ninguém apontado."),
      card.indexOf("Ninguém apontado.") + 320,
    );

    const quem = await incorporadorDoAcordo(comVendedoraDoContrato());
    expect(quem?.nome).toBe("Socia Que Assina O Contrato");

    // O texto precisa dizer que, sem ninguém apontado, quem assina é a vendedora cadastrada no
    // quadro — e só depois dela o representante legal.
    expect(vazio).toContain("cadastrada como vendedora");
  });
});

describe("a porta de escrita: a mesma função, com um papel que só a Careli aponta", () => {
  // ⚠️ ESCONDER O CAMPO NA TELA NÃO ERA FECHAR A PORTA (revisão de 20/09/2026, corrigido no mesmo
  // dia). `conferirAssinante` media o papel contra `PAPEIS_DO_QUADRO` e não olhava quem era o ator;
  // `incluirAssinante` é literalmente a mesma função por trás de `/api/temis/assinantes` (hub) e de
  // `/api/incorporador/temis/assinantes` (portal da Cecílio). Quem operasse o produto pelo portal
  // conseguia apontar, por chamada direta, quem assina um TERMO que a Careli emite — sem que isso
  // aparecesse em contrato nenhum, que é o que tornava a coisa silenciosa.
  it("o hub aponta quem assina os termos", async () => {
    const banco = cadastro(false);
    estado.banco = banco;

    const resposta = await incluirAssinante(
      { nome: "Jurídico Careli", papel: "escrita", tipo: "hub", userId: "user-1" },
      new Request("https://c2x.app.br/api/temis/assinantes", {
        body: JSON.stringify({
          cpf: "529.982.247-25",
          email: "juridico@exemplo.test",
          enterpriseId: EMPREENDIMENTO,
          nome: "Analista Do Juridico Exemplo",
          papel: PAPEL_DE_TERMOS_DA_VENDEDORA,
          posicao: 1,
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      }),
    );

    expect(resposta.status).toBe(200);
    const gravadas = (banco.tabelas.temis_assinantes ?? []).filter(
      (l) => l.papel === PAPEL_DE_TERMOS_DA_VENDEDORA,
    );
    expect(gravadas).toHaveLength(1);
  });

  // ⚠️ E O PORTAL LEVA 404, NÃO 403: para ele este papel não existe. A recusa vem ANTES de qualquer
  // consulta, então a resposta também não conta se aquele empreendimento é dele.
  it("o portal não aponta: 404, e nada é gravado", async () => {
    const banco = cadastro(false);
    estado.banco = banco;

    const resposta = await incluirAssinante(
      {
        enterpriseIds: [EMPREENDIMENTO],
        incorporadorId: "inc-1",
        nome: "Equipe do Incorporador",
        slug: "cecilio-rocha",
        tipo: "portal",
        usuarioId: "usuario-1",
      },
      new Request("https://c2x.app.br/api/incorporador/temis/assinantes", {
        body: JSON.stringify({
          email: "juridico@exemplo.test",
          enterpriseId: EMPREENDIMENTO,
          nome: "Analista Do Incorporador",
          papel: PAPEL_DE_TERMOS_DA_VENDEDORA,
          posicao: 1,
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      }),
    );

    expect(resposta.status).toBe(404);
    expect(
      (banco.tabelas.temis_assinantes ?? []).filter(
        (l) => l.papel === PAPEL_DE_TERMOS_DA_VENDEDORA,
      ),
    ).toHaveLength(0);
  });

  // ⚠️ E O DELETE TAMBÉM. Era o caminho mais silencioso dos dois: a linha apontada pela Careli está
  // num empreendimento que É do incorporador, então o alcance dizia sim.
  it("o portal não remove o apontado pela Careli", async () => {
    const banco = cadastro(false);
    const apontado = {
      ativo: true,
      cpf: null,
      email: "juridico@exemplo.test",
      enterprise_id: EMPREENDIMENTO,
      id: "95959595-9595-4595-8595-959595959595",
      nome: "Analista Do Juridico Exemplo",
      ordem_assinatura: null,
      origem: null,
      papel: PAPEL_DE_TERMOS_DA_VENDEDORA,
      posicao: 1,
      workspace_id: "careli",
    };
    (banco.tabelas.temis_assinantes as unknown[]).push(apontado);
    estado.banco = banco;

    const resposta = await removerAssinante(
      {
        enterpriseIds: [EMPREENDIMENTO],
        incorporadorId: "inc-1",
        nome: "Equipe do Incorporador",
        slug: "cecilio-rocha",
        tipo: "portal",
        usuarioId: "usuario-1",
      },
      new Request(
        `https://c2x.app.br/api/incorporador/temis/assinantes?id=${apontado.id}`,
        { method: "DELETE" },
      ),
    );

    expect(resposta.status).toBe(404);
    expect(apontado.ativo).toBe(true);
  });

  // ⚠️ E O CONTRATO CONTINUA SENDO DO PORTAL: vendedora, coordenador e testemunha são o que aquela
  // equipe confecciona, e a recusa é só do papel dos termos.
  it("a recusa é só do papel dos termos: a rota do portal segue chamando as mesmas funções", async () => {
    const { readFileSync } = await import("node:fs");
    const rota = readFileSync(
      new URL("../../app/api/incorporador/temis/assinantes/route.ts", import.meta.url),
      "utf8",
    );

    expect(rota).toContain("incluirAssinante(auth.ator, request)");
    expect(rota).toContain("removerAssinante(auth.ator, request)");
  });
});

describe("o custo da leitura", () => {
  // ⚠️ O CARTÃO PASSOU A PERGUNTAR A MESMA COISA DUAS VEZES. `representanteDoCadastro` é chamado
  // agora três vezes, e duas delas ("vendedora" e "termos_vendedora") leem a MESMA coluna
  // (`vendedor_entity_id`) e percorrem a MESMA cadeia até o e-mail da MESMA pessoa. A medição
  // abaixo é o número de consultas que a tela dispara, para que ninguém precise contar de novo.
  it("conta as consultas que o cartão dispara", async () => {
    const banco = cadastro(true);
    await cartao(banco);

    const porTabela = banco.consultas.reduce<Record<string, number>>((acc, c) => {
      acc[c.tabela] = (acc[c.tabela] ?? 0) + 1;
      return acc;
    }, {});

    // Antes da mudança eram 2 consultas a `apolo_enterprise_settings` e 1 de cada uma das outras
    // três (o coordenador deste empreendimento é nulo e para na primeira). Agora a cadeia inteira
    // do representante da INCORPORADORA roda duas vezes, com o mesmo resultado.
    expect(porTabela).toEqual({
      apolo_contacts: 2,
      apolo_enterprise_settings: 3,
      apolo_entities: 2,
      apolo_relationships: 2,
      temis_assinantes: 1,
    });
  });
});
