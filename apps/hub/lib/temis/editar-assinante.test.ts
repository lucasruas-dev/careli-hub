import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  type EstadoDoBanco,
  gravacoesEm,
  novoEstado,
} from "./fixtures/supabase-em-memoria";

// EDITAR E EXCLUIR UMA LINHA DO QUADRO DE ASSINATURA, NA FUNÇÃO DE PRODUÇÃO.
//
// Lucas (25/09/2026): *"todas assinaturas eu tenho que conseguir excluir e editar, esse cadeado esta
// errado"*. Até esta data a linha do quadro só nascia e era desativada: corrigir um e-mail era
// excluir e incluir de novo, e escolher a linha de alguém depois de gravado era impossível. No VOR a
// Nívea chegou a gravar o número dentro do nome ("1 FABRICIO ...") tentando pôr o Fabricio na linha 1.
//
// ⚠️ O QUE ESTE ARQUIVO TRAVA, na porta do HUB (o portal está em
// `app/api/incorporador/temis/estrutura-do-portal.test.ts`):
//   • editar grava nome, CPF, e-mail, Linha e Assina em, com quem editou (`atualizado_por_nome`,
//     0191) e sem trocar o papel;
//   • as mesmas checagens do incluir: nome completo, e-mail, CPF válido, linha de 1 a 9, e a linha
//     ocupada responde 409 dizendo de quem ela é, sem gravar;
//   • o que não vem no corpo fica, e o CPF mascarado não apaga o gravado;
//   • sem a 0191 no banco, a edição grava assim mesmo, só sem o nome de quem editou;
//   • excluir só desativa linha ATIVA, e id que não está no quadro é 404.
//
// ⚠️ SEM `vi.mock` DO QUADRO: o único duplo é o Supabase em memória.

const estado = vi.hoisted(() => ({ banco: null as unknown }));

vi.mock("@/lib/apolo/server", async () => {
  const { clienteEmMemoria } = await import("./fixtures/supabase-em-memoria");
  return {
    createApoloAdminClient: () =>
      clienteEmMemoria(estado.banco as Parameters<typeof clienteEmMemoria>[0]),
  };
});

const { editarAssinante, lerQuadroDeAssinatura, removerAssinante } = await import(
  "./estrutura-servico"
);

const HUB = { nome: "Nivea Exemplo", papel: "escrita", tipo: "hub", userId: "user-1" } as const;

const FABRICIO = "11111111-1111-4111-8111-000000000004";
const NIVEA = "11111111-1111-4111-8111-000000000002";
const HUBER = "11111111-1111-4111-8111-000000000003";
const TESTEMUNHA = "11111111-1111-4111-8111-000000000009";
const EXCLUIDA = "11111111-1111-4111-8111-000000000010";

const linha = (
  id: string,
  papel: string,
  posicao: number,
  nome: string,
  extra: Record<string, unknown> = {},
) => ({
  ativo: true,
  cpf: null,
  email: `${id.slice(-2)}@exemplo.test`,
  enterprise_id: "41",
  entity_id: null,
  id,
  nome,
  observacao: null,
  ordem_assinatura: null,
  origem: null,
  papel,
  posicao,
  workspace_id: "careli",
  ...extra,
});

/** O VOR como a Nívea deixou em 25/09/2026: coordenadores nas linhas 2, 3 e 4, a linha 1 livre. */
function quadroDoVor(): EstadoDoBanco {
  const banco = novoEstado();
  banco.tabelas.temis_assinantes = [
    linha(NIVEA, "coordenador", 2, "NIVEA EXEMPLO CARELI"),
    linha(HUBER, "coordenador", 3, "HUBER EXEMPLO GURGEL"),
    linha(FABRICIO, "coordenador", 4, "FABRICIO EXEMPLO GURGEL", {
      cpf: "529.982.247-25",
      email: "contrato@fgurgel.com.br",
    }),
    linha(TESTEMUNHA, "testemunha", 1, "TESTEMUNHA EXEMPLO SILVA", { ordem_assinatura: 9 }),
    linha(EXCLUIDA, "coordenador", 1, "LINHA JA EXCLUIDA", { ativo: false }),
  ];
  return banco;
}

const noQuadro = (id: string) =>
  ((estado.banco as EstadoDoBanco).tabelas.temis_assinantes ?? []).find((l) => l.id === id);

const editar = (id: string, corpo: unknown) =>
  editarAssinante(
    HUB,
    new Request(`https://c2x.app.br/api/temis/assinantes?id=${id}`, {
      body: JSON.stringify(corpo),
      headers: { "Content-Type": "application/json" },
      method: "PATCH",
    }),
  );

const excluir = (id: string) =>
  removerAssinante(
    HUB,
    new Request(`https://c2x.app.br/api/temis/assinantes?id=${id}`, { method: "DELETE" }),
  );

beforeEach(() => {
  estado.banco = quadroDoVor();
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("editar pelo lápis", () => {
  it("⚠️ o Fabricio vai para a linha 1 do VOR, com quem editou gravado", async () => {
    const r = await editar(FABRICIO, {
      cpf: "529.982.247-25",
      email: "contrato@fgurgel.com.br",
      nome: "FABRICIO EXEMPLO GURGEL",
      ordemAssinatura: "",
      posicao: "1",
    });

    expect(r.status).toBe(200);
    const corpo = (await r.json()) as { assinante: { id: string; posicao: number } };
    expect(corpo.assinante).toMatchObject({ id: FABRICIO, posicao: 1 });
    expect(noQuadro(FABRICIO)).toMatchObject({
      atualizado_por_nome: "Nivea Exemplo",
      ativo: true,
      papel: "coordenador",
      posicao: 1,
    });
    expect(typeof noQuadro(FABRICIO)?.atualizado_em).toBe("string");
  });

  it("corrige o e-mail em minúsculas, e o que não veio no corpo fica", async () => {
    const r = await editar(TESTEMUNHA, { email: "  Nova.Testemunha@Exemplo.TEST " });

    expect(r.status).toBe(200);
    expect(noQuadro(TESTEMUNHA)).toMatchObject({
      email: "nova.testemunha@exemplo.test",
      nome: "TESTEMUNHA EXEMPLO SILVA",
      ordem_assinatura: 9,
      posicao: 1,
    });
  });

  it("Linha em branco mantém a linha que a pessoa já tem", async () => {
    const r = await editar(HUBER, { nome: "HUBER EXEMPLO GURGEL", posicao: "" });

    expect(r.status).toBe(200);
    expect(noQuadro(HUBER)?.posicao).toBe(3);
  });

  it("'Assina em' que chega como número é gravado, e não vira em branco calado", async () => {
    const r = await editar(HUBER, { ordemAssinatura: 2 });

    expect(r.status).toBe(200);
    expect(noQuadro(HUBER)?.ordem_assinatura).toBe(2);
  });

  it("'Assina em' apagado volta a seguir o papel", async () => {
    const r = await editar(TESTEMUNHA, { ordemAssinatura: "" });

    expect(r.status).toBe(200);
    expect(noQuadro(TESTEMUNHA)?.ordem_assinatura).toBeNull();
  });
});

describe("o CPF na edição", () => {
  // ⚠️ O PORTAL RECEBE O CPF MASCARADO e a tela devolve o que mostrou. Lido como CPF, os dois
  // dígitos recusariam a edição inteira por "O CPF nao confere".
  it("CPF mascarado mantém o gravado", async () => {
    const r = await editar(FABRICIO, { cpf: "***.***.***-25", nome: "FABRICIO EXEMPLO GURGEL" });

    expect(r.status).toBe(200);
    expect(noQuadro(FABRICIO)?.cpf).toBe("529.982.247-25");
  });

  it("CPF em branco limpa, e CPF inválido é recusado sem gravar", async () => {
    expect((await editar(FABRICIO, { cpf: "" })).status).toBe(200);
    expect(noQuadro(FABRICIO)?.cpf).toBeNull();

    const recusa = await editar(FABRICIO, { cpf: "111.222.333-00" });
    expect(recusa.status).toBe(400);
    expect(((await recusa.json()) as { error: string }).error).toContain("CPF nao confere");
  });

  it("CPF digitado sem pontos é gravado no formato do quadro", async () => {
    const r = await editar(NIVEA, { cpf: "52998224725" });

    expect(r.status).toBe(200);
    expect(noQuadro(NIVEA)?.cpf).toBe("529.982.247-25");
  });
});

describe("as mesmas checagens do incluir", () => {
  // ⚠️ A LINHA OCUPADA DIZ DE QUEM ELA É. Trocar duas pessoas de linha são três passos: o índice
  // único da 0158 vale a cada gravação.
  it("linha ocupada: 409 com o nome de quem está lá, e nada gravado", async () => {
    const r = await editar(FABRICIO, { posicao: "2" });

    expect(r.status).toBe(409);
    const { error } = (await r.json()) as { error: string };
    expect(error).toContain("A linha 2 de Coordenador de Vendas ja e de NIVEA EXEMPLO CARELI");
    expect(error).toContain("use outra linha");
    expect(noQuadro(FABRICIO)?.posicao).toBe(4);
    expect(gravacoesEm(estado.banco as EstadoDoBanco, "temis_assinantes")).toHaveLength(0);
  });

  it("a linha de uma pessoa EXCLUÍDA está livre", async () => {
    // A linha 1 do coordenador tem uma linha desativada: o índice único é só entre as ativas.
    const r = await editar(HUBER, { posicao: "1" });

    expect(r.status).toBe(200);
    expect(noQuadro(HUBER)?.posicao).toBe(1);
  });

  it("nome de uma palavra só, e-mail ausente e linha fora de 1 a 9 são recusados", async () => {
    expect((await editar(NIVEA, { nome: "Nivea" })).status).toBe(400);
    expect((await editar(NIVEA, { email: "" })).status).toBe(400);
    expect((await editar(NIVEA, { posicao: "10" })).status).toBe(400);
    expect(gravacoesEm(estado.banco as EstadoDoBanco, "temis_assinantes")).toHaveLength(0);
  });

  // ⚠️ O PAPEL NÃO SE TROCA: mudar de papel é pôr a pessoa em outra linha do contrato.
  it("o papel não se troca pela edição", async () => {
    const r = await editar(NIVEA, { papel: "testemunha" });

    expect(r.status).toBe(400);
    expect(noQuadro(NIVEA)?.papel).toBe("coordenador");
  });

  it("linha excluída ou inexistente não se edita: 404 dizendo para recarregar", async () => {
    const excluida = await editar(EXCLUIDA, { nome: "OUTRO NOME EXEMPLO" });
    expect(excluida.status).toBe(404);
    expect(((await excluida.json()) as { error: string }).error).toContain("Recarregue");

    expect((await editar("nao-e-uuid", { nome: "OUTRO NOME EXEMPLO" })).status).toBe(404);
    expect(noQuadro(EXCLUIDA)?.nome).toBe("LINHA JA EXCLUIDA");
  });
});

describe("sem a migration 0191 no banco", () => {
  it("a edição grava assim mesmo, só sem o nome de quem editou", async () => {
    (estado.banco as EstadoDoBanco).colunasAusentes = ["atualizado_por_nome"];

    const r = await editar(NIVEA, { email: "nivea@exemplo.test" });

    expect(r.status).toBe(200);
    expect(noQuadro(NIVEA)?.email).toBe("nivea@exemplo.test");
    expect(noQuadro(NIVEA)).not.toHaveProperty("atualizado_por_nome");
  });
});

describe("excluir pela lixeira", () => {
  it("desativa, não apaga, e grava quem excluiu", async () => {
    const r = await excluir(HUBER);

    expect(r.status).toBe(200);
    expect(noQuadro(HUBER)).toMatchObject({ ativo: false, desativado_por_nome: "Nivea Exemplo" });
  });

  // ⚠️ ANTES, EXCLUIR DE NOVO RESPONDIA OK e reescrevia quem tinha excluído de verdade.
  it("linha já excluída: 404, e quem excluiu primeiro continua registrado", async () => {
    const banco = estado.banco as EstadoDoBanco;
    const ja = banco.tabelas.temis_assinantes?.find((l) => l.id === EXCLUIDA);
    if (ja) ja.desativado_por_nome = "Quem Excluiu Primeiro";

    const r = await excluir(EXCLUIDA);

    expect(r.status).toBe(404);
    expect(noQuadro(EXCLUIDA)?.desativado_por_nome).toBe("Quem Excluiu Primeiro");
  });

  it("id que não é uuid: 404, e não 500", async () => {
    expect((await excluir("nao-e-uuid")).status).toBe(404);
  });
});

describe("a leitura do quadro, depois", () => {
  it("toda linha devolvida tem id: não há linha que não se edite", async () => {
    const r = await lerQuadroDeAssinatura(
      HUB,
      new Request("https://c2x.app.br/api/temis/assinantes?enterpriseId=41"),
    );
    const { assinantes } = (await r.json()) as { assinantes: Array<{ id: unknown }> };

    expect(assinantes).toHaveLength(4);
    expect(assinantes.every((a) => typeof a.id === "string" && a.id !== "")).toBe(true);
  });
});
