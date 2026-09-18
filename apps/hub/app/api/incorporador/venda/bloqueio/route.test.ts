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
  // contra 3 do comercial. Desde 16/09/2026 a porta é a de quem OPERA A VENDA (o comercial e o
  // Cecílio); o 404 dos demais portais está provado em lib/apolo/incorporador/board-do-portal.test.ts.
  it("é a de quem opera a venda, e não a genérica", () => {
    expect(ROTA).toContain("autorizarOperacaoDeVenda(request)");
    expect(ROTA).not.toMatch(/\bautorizar\(request\)/);
    expect(ROTA).not.toContain("autorizarComercial");
  });

  it("vale nos dois verbos", () => {
    const chamadas = ROTA.match(/autorizarOperacaoDeVenda\(request\)/g) ?? [];
    expect(chamadas.length).toBe(2);
  });
});

describe("as travas do bloqueio", () => {
  it("recusa a linha espelho", () => {
    // Bloquear o registro antigo não tira o lote da venda: quem vende é a gleba.
    expect(ROTA).toContain("unidade.espelho_de");
  });

  it("⚠️ \"está livre?\" é a régua ÚNICA, a mesma que pinta a grade (Lucas, 18/09/2026)", () => {
    // A régua pergunta pelo TERRENO (VOC0305 livre com o gêmeo VLO0305 em proposta), pela ETAPA (e
    // não por `aberta`, que nunca volta para false) e pela RESERVA do Hércules e do evento. O
    // comportamento está provado em route.comportamento.test.ts; aqui, que a rota não voltou a
    // fazer a conta dela.
    expect(ROTA).toContain('from "@/lib/hercules/situacao-da-unidade"');
    expect(ROTA).toContain("lerSituacaoDasUnidades(admin, ");
    expect(ROTA).toContain("estaLivre(situacao)");
    expect(ROTA).not.toContain('.from("hercules_propostas")');
    expect(ROTA).not.toContain('.eq("aberta"');
    expect(ROTA).not.toContain('unidade.situacao !== "disponivel"');
  });

  it("⚠️ situação que não se leu não é livre", () => {
    expect(ROTA).toContain("if (!situacao)");
  });

  it("a conferência vem ANTES da escrita, nos dois verbos", () => {
    const [post, del] = ROTA.split("export async function DELETE");
    for (const verbo of [post ?? "", del ?? ""]) {
      const conferencia = verbo.indexOf("await situacaoCanonica(admin, unidade)");
      const escrita = verbo.indexOf(".update(");
      expect(conferencia).toBeGreaterThan(-1);
      expect(escrita).toBeGreaterThan(conferencia);
    }
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

describe("quem opera o produto decide a escrita (Lucas, 16/09/2026)", () => {
  // No portal que confecciona (o Cecílio) bloquear e desbloquear só valem no produto operado por ele;
  // no VOC e no VOR a resposta é 403 só consulta. A régua é a única, de `operacao-do-produto-servidor`.
  it("os dois verbos passam pela régua, com o enterprise da unidade lida", () => {
    const chamadas =
      ROTA.match(/autorizarEscritaNoProduto\(request, auth\.sessao, \[unidade\.enterprise_id\]\)/g) ?? [];
    expect(chamadas.length).toBe(2);
  });

  it("a régua vem ANTES da escrita, nos dois verbos", () => {
    const [post, del] = ROTA.split("export async function DELETE");
    for (const verbo of [post ?? "", del ?? ""]) {
      const regua = verbo.indexOf("autorizarEscritaNoProduto(");
      const escrita = verbo.indexOf(".update(");
      expect(regua).toBeGreaterThan(-1);
      expect(escrita).toBeGreaterThan(regua);
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
