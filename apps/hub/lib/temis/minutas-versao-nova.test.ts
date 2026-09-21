import { beforeEach, describe, expect, it, vi } from "vitest";

// O QUE A VERSÃO NOVA DA MINUTA LEVA CONSIGO — e o que ela deixava para trás.
//
// ⚠️ A CAPA É DA MINUTA, E MORRIA A CADA PUBLICAÇÃO. O insert da versão nova copiava 13 campos
// (conteúdo, descrição, enterprise_id, nome, origem do arquivo, tipo, variáveis, versão…) e NÃO
// copiava `capa_path` nem `capa_nome`. Medido em produção (bxgukywoxgivlrhjkwjx, 21/09/2026): das
// 11 minutas, 3 têm capa e as 3 estão ARQUIVADAS (VOL v1, VOL v4, RVP v1); as 3 PUBLICADAS não têm
// nenhuma. O rastro do dado casa com o código: no VOL a capa foi enviada, perdida na v2, enviada de
// novo na v4 e perdida de novo na v5. Consequência: o ramo da capa do montador NUNCA rodou em
// produção, e quem subiu a capa achava que ela estava lá.
//
// ⚠️ E A CATEGORIA PRECISA SEGUIR COMO OS PLANOS SEGUEM. `temis_categorias.minuta_id` é o PRIMEIRO
// degrau da cadeia do contrato (`cadeia-do-contrato.ts`). Sem o repasse, publicar a v2 deixaria a
// categoria apontando para a v1 recém-arquivada — e aí não é "texto antigo", é RECUSA, porque
// `escolherMinutaDaCadeia` se nega a usar minuta arquivada e não herda por cima dela.

const estado = vi.hoisted(() => ({ banco: null as unknown }));

vi.mock("@/lib/apolo/server", async () => {
  const { clienteEmMemoria } = await import("@/lib/temis/fixtures/supabase-em-memoria");
  return {
    createApoloAdminClient: () =>
      clienteEmMemoria(estado.banco as Parameters<typeof clienteEmMemoria>[0]),
  };
});

import { type EstadoDoBanco, novoEstado } from "@/lib/temis/fixtures/supabase-em-memoria";

import { salvarMinuta } from "./minutas-servico";

const ATOR = { nome: "Zeus", papel: "escrita", tipo: "hub", userId: "user-1" } as const;

const V1 = "aaaaaaaa-0000-4000-8000-000000000001";
const CATEGORIA = "cccccccc-0000-4000-8000-000000000001";
const PLANO = "pppppppp-0000-4000-8000-000000000001";

const banco = () => estado.banco as EstadoDoBanco;

const pedir = (query: string, corpo?: unknown) =>
  new Request(`https://c2x.app.br/api/temis/minutas${query}`, {
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
    headers: { Authorization: "Bearer token", "Content-Type": "application/json" },
    method: "PATCH",
  });

beforeEach(() => {
  estado.banco = novoEstado();
  banco().tabelas.temis_minutas = [
    {
      capa_nome: "Capa do Canva.pdf",
      capa_path: "temis-capas/empreendimento/36/abc-capa.pdf",
      conteudo: [{ children: [{ text: "oi" }], type: "p" }],
      conteudo_html: "<p>oi</p>",
      criado_por_nome: "Maria do Jurídico",
      descricao: null,
      enterprise_id: "36",
      id: V1,
      nome: "VOL-COMPRA-E-VENDA",
      origem_arquivo_nome: "modelo.docx",
      situacao: "publicada",
      tipo: "contrato",
      versao: 1,
      workspace_id: "careli",
    },
  ];
  banco().tabelas.temis_categorias = [
    { enterprise_id: "36", id: CATEGORIA, minuta_id: V1, nome: "Condomínio", workspace_id: "careli" },
  ];
  banco().tabelas.temis_planos = [
    { enterprise_id: "36", id: PLANO, minuta_id: V1, workspace_id: "careli" },
  ];
});

const nova = () =>
  (banco().tabelas.temis_minutas ?? []).find((m) => m.id !== V1) as
    | Record<string, unknown>
    | undefined;

describe("salvar em cima de uma minuta PUBLICADA abre a próxima versão", () => {
  it("a capa acompanha a versão nova, com o nome do arquivo", async () => {
    const r = await salvarMinuta(ATOR, pedir(`?id=${V1}`, { conteudoHtml: "<p>outro</p>" }));
    expect(r.status).toBe(200);

    expect(nova()).toMatchObject({
      capa_nome: "Capa do Canva.pdf",
      capa_path: "temis-capas/empreendimento/36/abc-capa.pdf",
      situacao: "rascunho",
      versao: 2,
    });
  });

  it("a v1 continua com a capa dela: nada é movido, só copiado", async () => {
    await salvarMinuta(ATOR, pedir(`?id=${V1}`, { conteudoHtml: "<p>outro</p>" }));
    const v1 = (banco().tabelas.temis_minutas ?? []).find((m) => m.id === V1);
    expect(v1?.capa_path).toBe("temis-capas/empreendimento/36/abc-capa.pdf");
  });
});

describe("publicar a versão nova repassa quem apontava para a anterior", () => {
  it("a categoria e o plano passam a apontar para a versão publicada agora", async () => {
    await salvarMinuta(ATOR, pedir(`?id=${V1}`, { conteudoHtml: "<p>outro</p>" }));
    const v2 = nova()!;

    const r = await salvarMinuta(ATOR, pedir(`?id=${String(v2.id)}&acao=publicar`));
    expect(r.status).toBe(200);
    const corpo = (await r.json()) as { data: { categoriasMigradas: number; planosMigrados: number } };

    expect(corpo.data.planosMigrados).toBe(1);
    expect(corpo.data.categoriasMigradas).toBe(1);
    expect(banco().tabelas.temis_categorias?.[0]?.minuta_id).toBe(v2.id);
    expect(banco().tabelas.temis_planos?.[0]?.minuta_id).toBe(v2.id);
    // E a v1 sai de cena: quem aponta para minuta arquivada é recusado na geração, não herdado.
    expect((banco().tabelas.temis_minutas ?? []).find((m) => m.id === V1)?.situacao).toBe("arquivada");
  });
});
