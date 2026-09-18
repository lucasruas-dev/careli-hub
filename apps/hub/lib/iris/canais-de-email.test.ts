import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { idsDosCanaisDeEmail, semOsCanaisDeEmail } from "./canais-de-email";

// O E-MAIL SAIU DA IRIS (Lucas, 18/09/2026): *"tira o canal e-mail da iris por favor, não precisa
// mais ter eles na iris, pode tirar a aba e não mostrar"* e *"pode cortar a conexão que
// registrávamos os e-mails no banco"*.

describe("idsDosCanaisDeEmail", () => {
  it("devolve só os canais de e-mail", () => {
    expect(
      idsDosCanaisDeEmail([
        { id: "c-financeiro", kind: "email" },
        { id: "c-4143", kind: "whatsapp" },
        { id: "c-contato", kind: "email" },
        { id: "c-interno", kind: "internal" },
      ]),
    ).toEqual(["c-financeiro", "c-contato"]);
  });

  it("aguenta lista vazia ou nula", () => {
    expect(idsDosCanaisDeEmail([])).toEqual([]);
    expect(idsDosCanaisDeEmail(null)).toEqual([]);
  });
});

describe("semOsCanaisDeEmail", () => {
  function consultaQueAnota() {
    const chamadas: unknown[][] = [];
    const consulta = {
      chamadas,
      not(...args: unknown[]) {
        chamadas.push(args);
        return consulta;
      },
    };
    return consulta;
  }

  it("tira da consulta os tickets dos canais de e-mail", () => {
    const consulta = consultaQueAnota();
    semOsCanaisDeEmail(consulta, ["c-financeiro", "c-contato"]);
    expect(consulta.chamadas).toEqual([["channel_id", "in", "(c-financeiro,c-contato)"]]);
  });

  it("sem canal de e-mail, a consulta segue intacta (um `in ()` vazio seria erro de sintaxe)", () => {
    const consulta = consultaQueAnota();
    expect(semOsCanaisDeEmail(consulta, [])).toBe(consulta);
    expect(consulta.chamadas).toEqual([]);
  });
});

// ⚠️ AS PONTAS QUE FARIAM O E-MAIL VOLTAR, lidas como texto: nenhuma delas é tipo, e cada uma
// devolveria o e-mail à Iris sem erro nenhum.
describe("o e-mail fora da Iris", () => {
  const ler = (caminho: string) => readFileSync(join(__dirname, "..", "..", caminho), "utf8");

  it("as duas cargas de tickets da Iris tiram os canais de e-mail", () => {
    const dados = ler("modules/caredesk/data/iris-data-client.ts");
    expect(dados.match(/semOsCanaisDeEmail\(/g)?.length).toBe(2);
  });

  it("o Board não tem mais a aba E-mail", () => {
    const board = ler("modules/caredesk/blocks/board/iris-board-kanban.tsx");
    expect(board).not.toContain('{ chave: "email", rotulo: "E-mail" }');
    expect(board).not.toMatch(/\["atendimento", "email"/);
  });

  it("a lista de conversas não oferece mais o filtro E-mail", () => {
    const lista = ler("modules/caredesk/blocks/conversation/iris-conversation-readonly.tsx");
    expect(lista).not.toMatch(/key: "email",\s*label: "E-mail"/);
  });

  it("a rota de importação não importa mais nada", () => {
    const rota = ler("app/api/iris/gmail/poll/route.ts");
    expect(rota).not.toContain("ingestGmailInbox(");
  });

  it("a rotina agendada da importação saiu da Vercel", () => {
    const vercel = readFileSync(join(__dirname, "..", "..", "..", "..", "vercel.json"), "utf8");
    expect(vercel).not.toContain("/api/iris/gmail/poll");
  });
});
