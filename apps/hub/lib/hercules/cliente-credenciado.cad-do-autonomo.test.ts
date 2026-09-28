import { describe, expect, it } from "vitest";

import { hashIdentifier } from "@/lib/apolo/server";

import { credenciadoParaVender } from "./cliente-credenciado";

// A RESERVA DO CLIENTE DO CORRETOR AUTÔNOMO VIRA PROPOSTA — o outro lado da fatia 2.
//
// Lucas (04/09/2026): *"para virar proposta, a CAD do titular tem que estar credenciada naquele
// empreendimento"*. A fatia 2 existe porque, até 27/09/2026, o cliente do autônomo NÃO CONSEGUIA TER
// CAD: `lib/apolo/cadastro-salvar.ts` só gravava `apolo_esteira` quando havia imobiliária, e sem CAD
// a régua respondia *"Este cliente não tem CAD neste empreendimento"* e a reserva nunca andava.
//
// ⚠️ A RÉGUA NÃO LÊ IMOBILIÁRIA, E ISSO ESTÁ MEDIDO NO CÓDIGO: o SELECT dela é
// `"atualizado_em, chegou_em, created_at, enterprise_id, entity_id, etapa, origem"`
// (lib/hercules/cliente-credenciado.ts:764) e a palavra `imobiliaria` não aparece em nenhuma coluna
// consultada nas 871 linhas do arquivo. Logo, a CAD do cliente do autônomo — que nasce com
// `imobiliaria` e `imobiliaria_entity_id` NULOS — passa pela MESMA porta, sem nenhum afrouxamento.
//
// O que este arquivo prova, e é por isso que ele existe separado:
//   • a CAD sem imobiliária, em `credenciado`, LIBERA a proposta;
//   • o cliente do autônomo NÃO HABILITADO não tem CAD (a porta do cadastro recusa antes de gravar,
//     ver lib/apolo/habilitacao-do-autonomo.test.ts), e sem CAD a régua recusa com a frase de sempre;
//   • nada disso muda para quem tem imobiliária.

type EntidadeFake = { document_hash: null | string; id: string };
type IdentificadorFake = { entity_id: string; value_hash: string };
type LinhaEsteiraFake = Record<string, unknown>;

// Client falso no mesmo espírito do de `cliente-credenciado.test.ts`: encadeável, "thenable", e
// TODA tabela respeita os filtros de verdade — um fixture que os ignorasse passaria com a função
// quebrada.
function clienteFake(cfg: {
  entidades?: EntidadeFake[];
  esteira?: LinhaEsteiraFake[];
  identificadores?: IdentificadorFake[];
}) {
  const colunasLidasDaEsteira: string[] = [];
  const client = {
    from(tabela: string) {
      const filtros: Array<{ coluna: string; valores: unknown[] }> = [];
      const valorDe = (linha: Record<string, unknown>, coluna: string): unknown =>
        coluna.split(".").reduce<unknown>(
          (atual, parte) =>
            atual && typeof atual === "object" ? (atual as Record<string, unknown>)[parte] : undefined,
          linha,
        );
      const filtrar = (linhas: object[]) =>
        linhas.filter((linha) =>
          filtros.every((f) => f.valores.includes(valorDe(linha as Record<string, unknown>, f.coluna))),
        );
      const resultado = () => {
        if (tabela === "apolo_entities") return { data: filtrar(cfg.entidades ?? []), error: null };
        if (tabela === "apolo_entity_identifiers") {
          return { data: filtrar(cfg.identificadores ?? []), error: null };
        }
        if (tabela === "apolo_esteira") return { data: filtrar(cfg.esteira ?? []), error: null };
        return { data: [], error: null };
      };
      const builder: Record<string, unknown> = {
        eq: (coluna: string, valor: unknown) => {
          filtros.push({ coluna, valores: [valor] });
          return builder;
        },
        in: (coluna: string, valores: unknown[]) => {
          filtros.push({ coluna, valores });
          return builder;
        },
        is: (coluna: string, valor: unknown) => {
          filtros.push({ coluna, valores: [valor] });
          return builder;
        },
        order: () => builder,
        range: () => builder,
        select: (colunas?: string) => {
          if (tabela === "apolo_esteira" && colunas) colunasLidasDaEsteira.push(colunas);
          return builder;
        },
        then: (resolver: (valor: unknown) => unknown) => Promise.resolve(resolver(resultado())),
      };
      return builder;
    },
  };
  return { client: client as never, colunasLidasDaEsteira };
}

const CPF = "529.982.247-25";
const CLIENTE_DO_AUTONOMO = "ent-maria-do-autonomo";
const AUTONOMO = "aaaaaaaa-1111-4111-8111-111111111111";
const VALE_DO_OURO = "37";
const HASH_DO_CPF = hashIdentifier("cpf", "52998224725");

/** A CAD como a fatia 2 a grava para o cliente do autônomo: sem imobiliária nenhuma. */
function cadDoAutonomo(parcial: LinhaEsteiraFake = {}): LinhaEsteiraFake {
  return {
    atualizado_em: "2026-09-28T12:00:00.000Z",
    chegou_em: "2026-09-28T12:00:00.000Z",
    corretor: "JOAO AUTONOMO",
    corretor_entity_id: AUTONOMO,
    created_at: "2026-09-28T12:00:00.000Z",
    enterprise_id: VALE_DO_OURO,
    entity_id: CLIENTE_DO_AUTONOMO,
    etapa: "credenciado",
    imobiliaria: null,
    imobiliaria_entity_id: null,
    origem: "cadastro-manual",
    ...parcial,
  };
}

describe("credenciadoParaVender: a CAD sem imobiliária", () => {
  it("⚠️ a CAD do cliente do autônomo, credenciada no 37, LIBERA a proposta", async () => {
    const { client } = clienteFake({
      esteira: [cadDoAutonomo()],
      identificadores: [{ entity_id: CLIENTE_DO_AUTONOMO, value_hash: HASH_DO_CPF }],
    });

    const resposta = await credenciadoParaVender(client, {
      documento: CPF,
      enterpriseIds: [VALE_DO_OURO],
    });

    expect(resposta.credenciado).toBe(true);
    expect(resposta.podeGerarProposta).toBe(true);
    expect(resposta.entityId).toBe(CLIENTE_DO_AUTONOMO);
    expect(resposta.etapa).toBe("credenciado");
    expect(resposta.motivo).toBeNull();
  });

  it("⚠️ a régua não pede imobiliária em coluna nenhuma (é o que faz a CAD sem ela passar)", async () => {
    const { client, colunasLidasDaEsteira } = clienteFake({
      esteira: [cadDoAutonomo()],
      identificadores: [{ entity_id: CLIENTE_DO_AUTONOMO, value_hash: HASH_DO_CPF }],
    });
    await credenciadoParaVender(client, { documento: CPF, enterpriseIds: [VALE_DO_OURO] });

    expect(colunasLidasDaEsteira.length).toBeGreaterThan(0);
    for (const colunas of colunasLidasDaEsteira) {
      expect(colunas).not.toContain("imobiliaria");
    }
  });

  it("a CAD do autônomo em validação NÃO libera sozinha (só o coordenador, como em qualquer CAD)", async () => {
    const { client } = clienteFake({
      esteira: [cadDoAutonomo({ etapa: "validacao" })],
      identificadores: [{ entity_id: CLIENTE_DO_AUTONOMO, value_hash: HASH_DO_CPF }],
    });

    const apertado = await credenciadoParaVender(client, {
      documento: CPF,
      enterpriseIds: [VALE_DO_OURO],
    });
    expect(apertado.credenciado).toBe(false);
    expect(apertado.podeGerarProposta).toBe(false);
  });

  it("⚠️ cliente de autônomo NÃO habilitado: sem CAD, a régua recusa com a frase de sempre", async () => {
    // A porta do cadastro recusa o vínculo antes de gravar a esteira (fail-closed), então aqui não
    // existe linha nenhuma. É este o estado que a fatia 2 deixa para quem não foi habilitado.
    const { client } = clienteFake({
      esteira: [],
      identificadores: [{ entity_id: CLIENTE_DO_AUTONOMO, value_hash: HASH_DO_CPF }],
    });

    const resposta = await credenciadoParaVender(client, {
      compradorDaCarteira: false,
      documento: CPF,
      enterpriseIds: [VALE_DO_OURO],
    });

    expect(resposta.credenciado).toBe(false);
    expect(resposta.podeGerarProposta).toBe(false);
    expect(resposta.etapa).toBeNull();
    expect(resposta.motivo).toContain("não tem CAD");
  });

  it("⚠️ a CAD gravada em OUTRO empreendimento não libera o 37 (o escopo continua valendo)", async () => {
    const { client } = clienteFake({
      esteira: [cadDoAutonomo({ enterprise_id: "39" })],
      identificadores: [{ entity_id: CLIENTE_DO_AUTONOMO, value_hash: HASH_DO_CPF }],
    });

    const resposta = await credenciadoParaVender(client, {
      compradorDaCarteira: false,
      documento: CPF,
      enterpriseIds: [VALE_DO_OURO],
    });
    expect(resposta.credenciado).toBe(false);
  });
});
