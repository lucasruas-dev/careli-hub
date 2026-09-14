import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// A ROTA DO BLOQUEIO, LIDA COMO TEXTO.
//
// ⚠️ ISTO EXISTE PORQUE OS 28 TESTES DA LIB PASSAVAM COM A ROTA MORTA. A primeira versão desta rota
// filtrava por `workspace_id = "00000000-0000-0000-0000-000000000001"` — um uuid que não existe em
// lugar nenhum do banco. Como a coluna é TEXT com o valor `'careli'` nas 5.541 linhas, a comparação
// não dava erro de tipo: casava zero linhas, em silêncio, e TODO bloqueio respondia 404 "Unidade
// não encontrada". A suíte inteira continuava verde, porque nada tocava na constante.
//
// ⚠️ LER O ARQUIVO É GROSSEIRO, E É DE PROPÓSITO. Importar a rota exigiria subir o cliente do
// Supabase, o cookie assinado e o escopo — um teste que precisa de banco não roda no pre-commit, e
// o que não roda não protege. O que estas asserções cobrem é a classe de defeito que já aconteceu:
// constante trocada, guarda apagada, `select` sem `where`. Todas elas são visíveis no texto, e
// todas passariam despercebidas por um typecheck.
const ROTA = readFileSync(join(__dirname, "route.ts"), "utf8");

describe("o workspace", () => {
  it("é `careli`, como nas nove rotas irmãs", () => {
    expect(ROTA).toContain('const WORKSPACE = "careli"');
  });

  it("não é um uuid", () => {
    // O defeito exato de 14/09/2026.
    expect(ROTA).not.toMatch(/const WORKSPACE = "[0-9a-f]{8}-/);
  });
});

describe("a autorização", () => {
  // ⚠️ `autorizar` NÃO OLHA O TIPO DO PORTAL, e o furo já foi pago em produção: um usuário de
  // portal de INCORPORADOR chegou a cancelar proposta do comercial. São 35 portais de incorporador
  // contra 3 do comercial.
  it("é a comercial, e não a genérica", () => {
    expect(ROTA).toContain("autorizarComercial(request)");
    expect(ROTA).not.toMatch(/\bautorizar\(request\)/);
  });

  it("vale nos dois verbos", () => {
    const chamadas = ROTA.match(/autorizarComercial\(request\)/g) ?? [];
    expect(chamadas.length).toBe(2);
  });
});

describe("as travas do bloqueio", () => {
  it("recusa a linha espelho", () => {
    // Bloquear o registro antigo não tira o lote da venda: quem vende é a gleba.
    expect(ROTA).toContain("unidade.espelho_de");
  });

  it("pergunta pelo TERRENO, e não só pela linha", () => {
    // ⚠️ VOC0305 está `disponivel` com zero propostas, e o gêmeo VLO0305 tem reserva viva. Sem o
    // `.in`, a rota bloqueia o lote com a reserva ativa por baixo.
    expect(ROTA).toContain('.eq("espelho_de", unidade.id)');
    expect(ROTA).toContain('.in("unidade_id", ');
  });

  it("descarta as propostas mortas pela ETAPA, não por `aberta`", () => {
    // `aberta` nunca volta para false: 20 propostas mortas seguem marcadas.
    expect(ROTA).toContain('"cancelado","distrato"');
    expect(ROTA).not.toContain('.eq("aberta"');
  });

  it("grava com UPDATE condicional e confere o que casou", () => {
    // Sem isto, `.update()` devolve sucesso casando zero linhas, e a corrida com uma reserva
    // simultânea passaria calada.
    expect(ROTA).toContain('.eq("situacao", "disponivel")');
    expect(ROTA).toContain('.select("id")');
  });

  it("carimba autor, nome e data", () => {
    for (const coluna of ["bloqueado_em", "bloqueado_por", "bloqueado_por_nome"]) {
      expect(ROTA).toContain(coluna);
    }
  });
});

describe("o desbloqueio", () => {
  it("existe", () => {
    expect(ROTA).toContain("export async function DELETE");
  });

  it("só desfaz bloqueio feito no Panteon", () => {
    // Desfazer os 1.554 herdados do C2X criaria divergência que a próxima carga reverte sozinha.
    expect(ROTA).toContain("!unidade.bloqueado_em");
  });

  it("limpa o carimbo junto", () => {
    // Sem limpar, a unidade seguiria protegida da carga como se ainda estivesse bloqueada.
    expect(ROTA).toMatch(/bloqueado_em: null/);
    expect(ROTA).toMatch(/bloqueio_motivo: null/);
  });

  it("também é condicional", () => {
    expect(ROTA).toContain('.eq("situacao", "bloqueada")');
  });
});
