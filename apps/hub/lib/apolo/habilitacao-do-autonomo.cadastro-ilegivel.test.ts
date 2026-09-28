import { describe, expect, it, vi } from "vitest";

// A RÉGUA QUE AUTORIZA NÃO USA EXPANSOR TOLERANTE (revisão de 28/09/2026).
//
// `conferirHabilitacaoDoAutonomo` se declara FAIL-CLOSED no cabeçalho do módulo, mas expandia pai e
// grupo com `expansorDeEmpreendimentos` (lib/apolo/habilitacao-pelo-cadastro.ts:147-158), que devolve a
// IDENTIDADE quando a leitura do cadastro do Panteon falha. A justificativa está escrita lá e vale para
// o uso ORIGINAL dela, que é decidir se AVISA o coordenador: *"pior caso, um aviso repetido, nunca um
// salvamento derrubado"*.
//
// ⚠️ NUMA RÉGUA DE AUTORIZAÇÃO ELA ERRA PARA O OUTRO LADO. Com a identidade, a habilitação no PAI 35
// deixa de cobrir a divisão 37 e a porta recusava um autônomo habilitado DE VERDADE, com a frase que
// manda o operador pedir habilitação à coordenação, que já existe. É o erro que o corretor não tem como
// discutir com a tela (foi o caso DANY CASTRO), e o diagnóstico sai errado: o problema é leitura, não
// autorização. Agora a leitura falhada vira `motivo: "falha"` (503, "tente de novo"), que é o que a
// própria régua já faz nas outras duas leituras e o que `cadastro-salvar.ts` traduz em 503.
//
// Arquivo separado do `habilitacao-do-autonomo.test.ts` de propósito: lá todo teste injeta `expandir`, e
// o mock do cadastro do Panteon precisa valer para o arquivo inteiro.

const m = vi.hoisted(() => ({
  cadastro: vi.fn(async () => [] as unknown[]),
}));

vi.mock("@/lib/hercules/cadastro", () => ({
  carregarCadastroDeEmpreendimentos: m.cadastro,
}));

import {
  conferirHabilitacaoDoAutonomo,
  FONTE_DA_HABILITACAO_DO_AUTONOMO,
  MENSAGEM_FALHA_AO_LER_HABILITACAO,
} from "./habilitacao-do-autonomo";

const AUTONOMO = "aaaaaaaa-1111-4111-8111-111111111111";
const OPERADOR = "766e2df4-c404-472e-9c33-bd65cbf150d8";

type Linha = Record<string, unknown>;

function bancoFalso(tabelas: Record<string, Linha[]>) {
  const from = (tabela: string) => {
    let linhas = [...(tabelas[tabela] ?? [])];
    const q: Record<string, unknown> = {};
    q.select = () => q;
    q.eq = (coluna: string, valor: unknown) => {
      linhas = linhas.filter((linha) => String(linha[coluna] ?? null) === String(valor));
      return q;
    };
    for (const metodo of ["in", "limit", "not", "order", "range"]) q[metodo] = () => q;
    q.maybeSingle = async () => ({ data: linhas[0] ?? null, error: null });
    q.then = (resolver: (r: unknown) => unknown) =>
      Promise.resolve({ data: linhas, error: null }).then(resolver);
    return q;
  };
  return { from } as never;
}

/** O autônomo habilitado no PAI 35, que é como o wizard grava o Vale do Ouro. */
const banco = () =>
  bancoFalso({
    apolo_entities: [
      {
        broker_code: "CA-0001",
        display_name: "JOAO AUTONOMO",
        entity_kind: "pf",
        id: AUTONOMO,
        legal_name: null,
      },
    ],
    apolo_entity_profiles: [{ entity_id: AUTONOMO, profile: "corretor", status: "active" }],
    apolo_relationships: [
      {
        created_at: "2026-09-28T12:00:00+00:00",
        entity_id: AUTONOMO,
        metadata: {
          createdBy: OPERADOR,
          enterpriseId: "35",
          source: FONTE_DA_HABILITACAO_DO_AUTONOMO,
        },
        relationship_type: "empreendimento",
        status: "verified",
      },
    ],
  });

/** O cadastro do Panteon como medido em 24/09/2026: o 35 é o pai das divisões 36, 37 e 41. */
const PANTEON = [
  { c2xEnterpriseId: "35", codigo: "VLO", id: "h-vlo", nome: "Vale do Ouro", paiId: null },
  { c2xEnterpriseId: "37", codigo: "VOC", id: "h-voc", nome: "Vale do Ouro · VOC", paiId: "h-vlo" },
  { c2xEnterpriseId: "36", codigo: "VOL", id: "h-vol", nome: "Vale do Ouro · VOL", paiId: "h-vlo" },
  { c2xEnterpriseId: "41", codigo: "VOR", id: "h-vor", nome: "Vale do Ouro · VOR", paiId: "h-vlo" },
];

describe("conferirHabilitacaoDoAutonomo quando o cadastro do Panteon não pode ser lido", () => {
  it("habilitado no PAI 35, a CAD na divisão 37 passa quando o cadastro é legível", async () => {
    m.cadastro.mockResolvedValueOnce(PANTEON);
    const r = await conferirHabilitacaoDoAutonomo(banco(), {
      enterpriseId: "37",
      entityId: AUTONOMO,
    });
    expect(r).toMatchObject({ ok: true });
  });

  it("⚠️ leitura do cadastro que FALHA devolve `falha` (503), e NUNCA 'não está habilitado'", async () => {
    const aviso = vi.spyOn(console, "error").mockImplementation(() => undefined);
    m.cadastro.mockRejectedValueOnce(new Error("hercules_empreendimentos: timeout"));
    const r = await conferirHabilitacaoDoAutonomo(banco(), {
      enterpriseId: "37",
      entityId: AUTONOMO,
    });
    expect(r).toEqual({
      mensagem: MENSAGEM_FALHA_AO_LER_HABILITACAO,
      motivo: "falha",
      ok: false,
    });
    expect(aviso).toHaveBeenCalled();
    aviso.mockRestore();
  });
});
