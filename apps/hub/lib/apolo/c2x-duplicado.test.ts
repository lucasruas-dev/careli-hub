import { describe, expect, it } from "vitest";

import {
  msgC2xNaoConferido,
  situacaoNoC2x,
  type ConsultaC2xPorDocumento,
} from "./c2x-write-server";

// A REGRA QUE ESTE ARQUIVO PROTEGE: "não consegui perguntar" NUNCA pode virar "pode criar".
//
// O `POST /api/v1/users` do C2X é genérico: cria de novo a cada chamada, não olha o documento e
// não tem desfazer. Se um dia alguém achatar `indisponivel` em `nao_existe` para "destravar o
// envio", o resultado é cliente duplicado num sistema de CONTRATOS — e é aqui que quebra.
//
// Nenhum teste daqui toca o banco: todos passam uma consulta em bloco já resolvida, que é
// exatamente o caminho que o lote usa.

const consultaCom = (pares: [string, number][]): ConsultaC2xPorDocumento => ({
  candidatos: new Map(pares.map(([doc, id]) => [doc, [{ id, nome: "" }]])),
  consultados: new Set(pares.map(([doc]) => doc)),
  ids: new Map(pares),
  // Sem nome gravado: estes testes são sobre EXISTE/NÃO EXISTE/NÃO PERGUNTEI. Quem cuida de "é a
  // mesma pessoa?" é o c2x-nome-confere.test.ts.
  nomes: new Map(),
  ok: true,
});

describe("situacaoNoC2x", () => {
  it("acha quem já está lá e devolve o id", async () => {
    const consulta = consultaCom([["12345678901", 4321]]);
    await expect(situacaoNoC2x("12345678901", consulta)).resolves.toEqual({
      c2xUserId: 4321,
      nomeNoC2x: null,
      situacao: "existe",
    });
  });

  it("ignora a máscara dos dois lados", async () => {
    // No C2X o cpf pode estar com ou sem máscara, e no Apolo o `document_masked` vem formatado.
    const consulta = consultaCom([["12345678901", 4321]]);
    await expect(situacaoNoC2x("123.456.789-01", consulta)).resolves.toEqual({
      c2xUserId: 4321,
      nomeNoC2x: null,
      situacao: "existe",
    });
  });

  it("diz NÃO EXISTE só para quem foi realmente perguntado", async () => {
    // Perguntado (está em `consultados`) e sem id: aí sim é ausência de verdade.
    const consultada: ConsultaC2xPorDocumento = {
      candidatos: new Map(),
      consultados: new Set(["12345678901"]),
      ids: new Map(),
      nomes: new Map(),
      ok: true,
    };
    await expect(situacaoNoC2x("12345678901", consultada)).resolves.toEqual({
      situacao: "nao_existe",
    });
  });

  it("não envia quando a consulta ao C2X falhou", async () => {
    const quebrada: ConsultaC2xPorDocumento = { motivo: "connect ETIMEDOUT", ok: false };
    const situacao = await situacaoNoC2x("12345678901", quebrada);
    expect(situacao.situacao).toBe("indisponivel");
    // O motivo real viaja junto: envio adiado não pode virar silêncio.
    expect(situacao).toMatchObject({ motivo: "connect ETIMEDOUT" });
  });

  it("não envia ficha sem CPF/CNPJ: sem documento não há como perguntar", async () => {
    const consulta = consultaCom([["12345678901", 4321]]);
    for (const documento of [null, undefined, "", "   ", "---"]) {
      const situacao = await situacaoNoC2x(documento, consulta);
      expect(situacao.situacao).toBe("indisponivel");
    }
  });
});

describe("msgC2xNaoConferido", () => {
  it("diz que NADA foi enviado e carrega o motivo", () => {
    const msg = msgC2xNaoConferido("connect ETIMEDOUT");
    expect(msg).toContain("NADA foi enviado");
    expect(msg).toContain("connect ETIMEDOUT");
  });
});
