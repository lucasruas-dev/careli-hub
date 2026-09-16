import { beforeEach, describe, expect, it, vi } from "vitest";

// A ROTA /api/incorporador/venda/contrato — quem pode mandar para contrato, e de quem é o card.
//
// Decisão do Lucas (16/09/2026):
//   • no portal que confecciona (o Cecílio) a escrita só vale no produto operado por ele: no VOC (37,
//     da Careli) é só consulta;
//   • o trabalho da Têmis nasce com o DONO de quem confecciona: a venda do Cecílio abre o card na
//     fila dele (`operado_por` = id do incorporador), a da Gurgel continua na da Careli (nulo).
//
// A régua de escrita roda de verdade (`operacao-do-produto-servidor.ts`); o que é trocado são as
// peças que tocam banco, cookie e a Têmis.

const estado = vi.hoisted(() => ({
  abertos: [] as Array<Record<string, unknown>>,
  aberturaFalha: false,
  atualizados: [] as Array<{ linha: unknown; tabela: string }>,
  inseridos: [] as Array<{ linha: unknown; tabela: string }>,
  com0170: true,
  leuCadastroDeOperacao: 0,
  opcoes: [] as unknown[],
  sessao: {} as Record<string, unknown>,
  unidade: {} as Record<string, unknown>,
}));

const CADASTRO = vi.hoisted(() => [
  { c2xEnterpriseId: "37", codigo: "VOC", id: "voc", nome: "VOC", operadoPor: null, paiId: null },
  { c2xEnterpriseId: "39", codigo: "GDN", id: "gdn", nome: "Garden", operadoPor: "inc-cecilio", paiId: null },
]);

const CECILIO = {
  incorporadorId: "inc-cecilio",
  slug: "cecilio-rocha",
  tipo: "incorporador",
  usuarioId: "u-cecilio",
  usuarioNome: "Maria do Cecílio",
};

const GURGEL = {
  incorporadorId: "inc-gurgel",
  slug: "gurgel",
  tipo: "comercial",
  usuarioId: "u-gurgel",
  usuarioNome: "Nivea",
};

vi.mock("@/lib/apolo/incorporador/board-do-portal", () => ({
  autorizarOperacaoDeVenda: () => ({ ok: true, sessao: estado.sessao }),
  autorizarPortalQueOperaSozinho: async (_request: Request, sessao: unknown) => ({ ok: true, sessao }),
}));

vi.mock("@/lib/apolo/incorporador/escopo", async () => {
  const { NextResponse } = await import("next/server");
  return {
    foraDoEscopo: () => NextResponse.json({ error: "Não encontrado." }, { status: 404 }),
    idsDaSessao: async () => ["37", "39"],
  };
});

vi.mock("@/lib/hercules/cadastro", () => ({
  carregarCadastroDeEmpreendimentos: async () => CADASTRO,
  lerCadastroDeEmpreendimentos: async () => {
    estado.leuCadastroDeOperacao += 1;
    return { com0170: estado.com0170, linhas: CADASTRO };
  },
}));

vi.mock("@/lib/temis/trabalhos-db", () => ({
  abrirTrabalho: async (novo: Record<string, unknown>, opcoes?: unknown) => {
    estado.abertos.push(novo);
    estado.opcoes.push(opcoes);
    return estado.aberturaFalha
      ? { erro: "a coluna do dono ainda não existe", ok: false }
      : { id: "trab-1", ok: true };
  },
}));

vi.mock("@/lib/apolo/server", () => {
  const consulta = (tabela: string) => {
    let atualizando = false;
    const resposta = () => {
      if (atualizando) return { data: [{ id: "prop-1" }], error: null };
      if (tabela === "hercules_unidades") return { data: estado.unidade, error: null };
      if (tabela === "hercules_propostas") {
        return {
          data: {
            cliente_documento: "52998224725",
            cliente_nome: "MARIA DA SILVA",
            codigo: null,
            empreendimento_codigo: "GDN",
            empreendimento_id: "gdn",
            etapa_desde: "2026-09-15T10:00:00.000Z",
            etapa_por: "Maria do Cecílio",
            id: "prop-1",
            protocolo_numero: 12,
          },
          error: null,
        };
      }
      if (tabela === "temis_minutas") return { data: [{ tipo: "contrato" }], error: null };
      return { data: null, error: null };
    };
    const cadeia: Record<string, unknown> = {
      then: (ok: (r: unknown) => unknown, falha?: (e: unknown) => unknown) =>
        Promise.resolve(resposta()).then(ok, falha),
    };
    for (const metodo of ["eq", "in", "maybeSingle", "select"]) cadeia[metodo] = () => cadeia;
    cadeia.insert = (linha: unknown) => {
      estado.inseridos.push({ linha, tabela });
      return cadeia;
    };
    cadeia.update = (linha: unknown) => {
      atualizando = true;
      estado.atualizados.push({ linha, tabela });
      return cadeia;
    };
    return cadeia;
  };
  return { createApoloAdminClient: () => ({ from: consulta }) };
});

import { POST } from "./route";

const enviar = () =>
  POST(
    new Request("https://c2x.app.br/api/incorporador/venda/contrato", {
      body: JSON.stringify({ propostaId: "prop-1", unidadeId: "u-1" }),
      method: "POST",
    }),
  );

const unidadeEm = (enterpriseId: string) => ({
  codigo: "GDN0107",
  enterprise_id: enterpriseId,
  id: "u-1",
  lote: "07",
  quadra: "01",
});

beforeEach(() => {
  estado.abertos = [];
  estado.aberturaFalha = false;
  estado.atualizados = [];
  estado.inseridos = [];
  estado.com0170 = true;
  estado.leuCadastroDeOperacao = 0;
  estado.opcoes = [];
  estado.sessao = CECILIO;
  estado.unidade = unidadeEm("39");
});

describe("POST /api/incorporador/venda/contrato", () => {
  it("⚠️ Cecílio no produto que ele opera (39): o card da Têmis nasce com o dono do Cecílio", async () => {
    const resposta = await enviar();
    expect(resposta.status).toBe(200);
    expect(estado.abertos).toHaveLength(1);
    expect(estado.abertos[0]).toMatchObject({
      abertoPor: "u-cecilio",
      operadoPor: "inc-cecilio",
      propostaId: "prop-1",
      tipo: "contrato",
    });
  });

  it("a Gurgel (comercial) abre o card na fila da Careli (dono nulo), sem ler quem opera", async () => {
    estado.sessao = GURGEL;
    const resposta = await enviar();
    expect(resposta.status).toBe(200);
    expect(estado.abertos[0]?.operadoPor).toBeNull();
    expect(estado.leuCadastroDeOperacao).toBe(0);
  });

  it("⚠️ Cecílio no VOC (37): 403 só consulta, a etapa não anda e nenhum card abre", async () => {
    estado.unidade = unidadeEm("37");
    const resposta = await enviar();
    expect(resposta.status).toBe(403);
    expect(await resposta.json()).toMatchObject({ soConsulta: true });
    expect(estado.atualizados).toHaveLength(0);
    expect(estado.abertos).toHaveLength(0);
  });

  it("⚠️ Cecílio: a Têmis recusa o card (sem a 0172) → a etapa volta para proposta e a resposta é erro", async () => {
    estado.aberturaFalha = true;
    const resposta = await enviar();
    expect(resposta.status).toBe(503);
    expect((await resposta.json()).error).toContain("A proposta continua em proposta");
    // Duas escritas na proposta: a que moveu para contrato e a que desfez, com o carimbo de antes.
    expect(estado.atualizados.map((a) => (a.linha as { etapa?: string }).etapa)).toEqual(["contrato", "proposta"]);
    expect(estado.atualizados[1]?.linha).toMatchObject({
      etapa_desde: "2026-09-15T10:00:00.000Z",
      etapa_por: "Maria do Cecílio",
    });
    // O histórico não ganha um passo que não aconteceu.
    expect(estado.inseridos.filter((i) => i.tabela === "hercules_proposta_etapas")).toHaveLength(0);
  });

  it("Gurgel: a Têmis recusa o card → a venda segue em contrato com o aviso (a Careli reabre à mão)", async () => {
    estado.sessao = GURGEL;
    estado.aberturaFalha = true;
    const resposta = await enviar();
    expect(resposta.status).toBe(200);
    expect((await resposta.json()).data).toMatchObject({ avisoDaTemis: "a coluna do dono ainda não existe", trabalhoId: null });
    expect(estado.atualizados).toHaveLength(1);
    expect(estado.inseridos.filter((i) => i.tabela === "hercules_proposta_etapas")).toHaveLength(1);
  });

  it("a abertura não pede o atalho que jogaria o card do Cecílio na fila da Careli sem a 0172", async () => {
    await enviar();
    expect(estado.abertos).toHaveLength(1);
    // Sem a opção `semDonoSeFaltarColuna`, a Têmis recusa o card com dono quando falta a coluna.
    expect((estado.opcoes[0] as undefined | { semDonoSeFaltarColuna?: boolean })?.semDonoSeFaltarColuna).not.toBe(true);
  });
});
