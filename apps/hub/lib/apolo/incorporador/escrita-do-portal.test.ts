import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  COLISAO_NO_PORTAL,
  erroDaIdentidadeParaOPortal,
  pessoaSoNoRecorte,
  RECUSA_DA_IDENTIDADE_COMPARTILHADA,
  RECUSA_DA_IMOBILIARIA_COMPARTILHADA,
  RECUSA_DO_CONTATO_COMPARTILHADO,
  recusaDaEdicaoNoPortal,
  recusaDaIdentidadeNoPortal,
  vinculoDentroDoRecorte,
} from "./escrita-do-portal";

// O QUE O CECÍLIO PODE ESCREVER NUMA FICHA (revisão de 16/09/2026): a ficha da CAD dele, sim; o
// telefone que a cobrança de outro loteamento usa, a identidade de quem compra em outro produto e o
// cadastro da imobiliária que trabalha para outros clientes, não.

const HUB = join(__dirname, "..", "..", "..");
const recorte = new Set(["37", "39"]);

describe("pessoaSoNoRecorte", () => {
  it("todos os empreendimentos no recorte: sim", () => {
    expect(pessoaSoNoRecorte({ esteira: ["39"], vinculos: ["39", " 37 "] }, recorte)).toBe(true);
  });

  it("um vínculo ou CAD fora: não", () => {
    expect(pessoaSoNoRecorte({ esteira: ["39"], vinculos: ["33"] }, recorte)).toBe(false);
    expect(pessoaSoNoRecorte({ esteira: ["39", "35"], vinculos: [] }, recorte)).toBe(false);
  });

  it("nenhum empreendimento conhecido: não (não dá para provar)", () => {
    expect(pessoaSoNoRecorte({ esteira: [], vinculos: [] }, recorte)).toBe(false);
  });
});

describe("recusaDaEdicaoNoPortal", () => {
  const cad = (over: Partial<Parameters<typeof recusaDaEdicaoNoPortal>[0]> = {}) => ({
    campos: { rendaId: "3" },
    comercial: false,
    imobiliaria: false,
    pessoa: { esteira: ["39"], vinculos: ["39"] },
    recorte,
    ...over,
  });

  it("o comercial edita como sempre, até telefone de quem compra em outro produto", () => {
    expect(
      recusaDaEdicaoNoPortal(
        cad({ campos: { telefone: "(31) 90000-0000" }, comercial: true, pessoa: { esteira: ["33"], vinculos: [] } }),
      ),
    ).toBeNull();
  });

  it("campo da ficha da CAD: pode, mesmo com a pessoa em outro loteamento", () => {
    expect(recusaDaEdicaoNoPortal(cad({ pessoa: { esteira: ["39", "33"], vinculos: [] } }))).toBeNull();
  });

  it("telefone ou e-mail de quem só compra no produto: pode", () => {
    expect(recusaDaEdicaoNoPortal(cad({ campos: { email: "a@b.c", telefone: "1" } }))).toBeNull();
  });

  it("telefone de quem também paga boleto de outro loteamento: 409 com a explicação", () => {
    expect(
      recusaDaEdicaoNoPortal(
        cad({ campos: { telefone: "(31) 90000-0000" }, pessoa: { esteira: ["39"], vinculos: ["33"] } }),
      ),
    ).toBe(RECUSA_DO_CONTATO_COMPARTILHADO);
  });

  it("imobiliária que trabalha outro produto: nenhum campo passa", () => {
    expect(
      recusaDaEdicaoNoPortal(
        cad({ campos: { creci: "123" }, imobiliaria: true, pessoa: { esteira: [], vinculos: ["39", "33"] } }),
      ),
    ).toBe(RECUSA_DA_IMOBILIARIA_COMPARTILHADA);
  });

  it("imobiliária só do produto: pode", () => {
    expect(
      recusaDaEdicaoNoPortal(
        cad({ campos: { nomeFantasia: "X" }, imobiliaria: true, pessoa: { esteira: [], vinculos: ["39"] } }),
      ),
    ).toBeNull();
  });
});

describe("a correção de identidade", () => {
  it("fora do comercial, só com a pessoa inteira no recorte", () => {
    expect(
      recusaDaIdentidadeNoPortal({ comercial: false, pessoa: { esteira: ["39"], vinculos: [] }, recorte }),
    ).toBeNull();
    expect(
      recusaDaIdentidadeNoPortal({
        comercial: false,
        pessoa: { esteira: [], vinculos: ["39", "33"] },
        recorte,
      }),
    ).toBe(RECUSA_DA_IDENTIDADE_COMPARTILHADA);
  });

  it("o comercial corrige como sempre", () => {
    expect(
      recusaDaIdentidadeNoPortal({ comercial: true, pessoa: { esteira: ["33"], vinculos: [] }, recorte }),
    ).toBeNull();
  });

  it("a colisão sai sem o nome do dono do documento; os outros erros passam", () => {
    const colisao = { erro: "Este documento ja pertence a outra ficha (Fulano de Tal).", motivo: "colisao" };
    expect(erroDaIdentidadeParaOPortal(colisao)).toBe(COLISAO_NO_PORTAL);
    expect(COLISAO_NO_PORTAL).not.toMatch(/Fulano/);
    expect(erroDaIdentidadeParaOPortal({ erro: "Documento invalido.", motivo: "invalido" })).toBe(
      "Documento invalido.",
    );
  });
});

describe("vinculoDentroDoRecorte (indeferir/correção/reabrir a imobiliária)", () => {
  // O canonizador do catálogo: divisão vira o grupo; o que não é divisão fica como está.
  const GRUPO_DE: Record<string, string> = {
    "36": "group:Vale do Ouro",
    "37": "group:Vale do Ouro",
    "41": "group:Vale do Ouro",
  };
  const canon = (id: string) => GRUPO_DE[id] ?? id;

  it("sessão só com o 37: o vínculo no 36 (VOL, do Lino) é FORA", () => {
    expect(vinculoDentroDoRecorte("36", new Set(["37"]), canon)).toBe(false);
    expect(vinculoDentroDoRecorte("37", new Set(["37"]), canon)).toBe(true);
  });

  it("o espelho 35, linha própria do catálogo, é fora para quem tem só o 37", () => {
    expect(vinculoDentroDoRecorte("35", new Set(["37"]), canon)).toBe(false);
  });

  it("vínculo gravado como grupo: dentro só para quem tem o grupo inteiro no recorte", () => {
    expect(vinculoDentroDoRecorte("group:Vale do Ouro", new Set(["37"]), canon)).toBe(false);
    expect(
      vinculoDentroDoRecorte(
        "group:Vale do Ouro",
        new Set(["36", "37", "41", "group:Vale do Ouro"]),
        canon,
      ),
    ).toBe(true);
    expect(
      vinculoDentroDoRecorte("36", new Set(["37", "41", "group:Vale do Ouro"]), canon),
    ).toBe(true);
  });
});

// O QUE LIGA A REGRA ÀS ROTAS: sem isto a regra passaria verde com a rota gravando direto.
describe("as amarras nas rotas do board", () => {
  const ler = (caminho: string) => readFileSync(join(HUB, caminho), "utf8");

  it("o PATCH da ficha confere a recusa ANTES de salvar", () => {
    const rota = ler("app/api/incorporador/board/[id]/route.ts");
    const patch = rota.slice(rota.indexOf("export async function PATCH"));
    const recusa = patch.indexOf("recusaDaEdicaoNoPortal(");
    const salvar = patch.indexOf("salvarFichaDoBoard(");
    expect(recusa).toBeGreaterThan(-1);
    expect(salvar).toBeGreaterThan(recusa);
  });

  it("a identidade confere a recusa antes de gravar e nunca devolve o erro cru da colisão", () => {
    const rota = ler("app/api/incorporador/board/[id]/identidade/route.ts");
    const recusa = rota.indexOf("recusaDaIdentidadeNoPortal(");
    const gravar = rota.indexOf("atualizarIdentidade({");
    expect(recusa).toBeGreaterThan(-1);
    expect(gravar).toBeGreaterThan(recusa);
    expect(rota).toContain("erroDaIdentidadeParaOPortal(resultado)");
    expect(rota).not.toMatch(/error: resultado\.erro/);
  });

  // (16/09/2026, revisão do conjunto) Duas réguas: quem confecciona compara o vínculo CRU com o que
  // ele OPERA; o comercial volta à comparação canonizada de antes da onda 1 (a Gurgel decide sobre a
  // imobiliária credenciada no grupo a partir de uma gleba). O comportamento está em escritas.test.ts.
  it("o habilitar decide 'trabalha fora' pelo recorte cru do que opera (e canonizado só no comercial)", () => {
    const rota = ler("app/api/incorporador/board/[id]/habilitar/route.ts");
    expect(rota).toContain("!vinculoDentroDoRecorte(eid, operados, canon)");
    expect(rota).toContain("comercial ? !idsCanonicos.has(canon(eid))");
  });
});
