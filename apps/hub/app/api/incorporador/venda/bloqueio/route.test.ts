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
//
// ⚠️ DESDE 18/09/2026 A REGRA MORA EM lib/hercules/bloquear-unidade-server.ts, e as duas portas (o
// portal e o Apolo) a chamam. Por isso o texto lido aqui são DOIS arquivos: a ROTA, que só pode ter a
// porta do portal (sessão, escopo, quem opera o produto), e a REGRA, que tem as travas.
const ROTA = readFileSync(join(__dirname, "route.ts"), "utf8");
const REGRA = readFileSync(
  join(__dirname, "../../../../../lib/hercules/bloquear-unidade-server.ts"),
  "utf8",
);
const [REGRA_DO_BLOQUEIO = "", REGRA_DO_DESBLOQUEIO = ""] = REGRA.split(
  "export async function desbloquearUnidade",
);

describe("o workspace", () => {
  it("é `careli`, como nas nove rotas irmãs", () => {
    expect(REGRA).toContain('const WORKSPACE = "careli"');
  });

  it("não é um uuid", () => {
    // O defeito exato de 14/09/2026.
    expect(REGRA).not.toMatch(/const WORKSPACE = "[0-9a-f]{8}-/);
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

  it("o escopo vem da sessão, nos dois verbos", () => {
    const chamadas = ROTA.match(/idsDaSessao\(auth\.sessao\)/g) ?? [];
    expect(chamadas.length).toBe(2);
  });
});

describe("a rota não refaz a regra: chama a de um lugar só", () => {
  it("os dois verbos chamam a regra compartilhada", () => {
    expect(ROTA).toContain('from "@/lib/hercules/bloquear-unidade-server"');
    expect(ROTA).toContain("await bloquearUnidade(admin, ");
    expect(ROTA).toContain("await desbloquearUnidade(admin, ");
  });

  it("⚠️ e não grava nada por conta própria", () => {
    // Um `.update(` aqui seria uma segunda régua de bloqueio, a que o Apolo não veria.
    expect(ROTA).not.toContain(".update(");
    expect(ROTA).not.toContain('.from("hercules_unidades")');
    expect(ROTA).not.toContain('.from("hercules_propostas")');
  });
});

describe("as travas do bloqueio (na regra)", () => {
  it("recusa a linha espelho", () => {
    // Bloquear o registro antigo não tira o lote da venda: quem vende é a gleba.
    expect(REGRA_DO_BLOQUEIO).toContain("unidade.espelho_de");
  });

  it("⚠️ \"está livre?\" é a régua ÚNICA, a mesma que pinta a grade (Lucas, 18/09/2026)", () => {
    // A régua pergunta pelo TERRENO (VOC0305 livre com o gêmeo VLO0305 em proposta), pela ETAPA (e
    // não por `aberta`, que nunca volta para false) e pela RESERVA do Hércules e do evento. O
    // comportamento está provado em route.comportamento.test.ts; aqui, que ninguém voltou a fazer a
    // conta na mão.
    expect(REGRA).toContain('from "./situacao-da-unidade"');
    expect(REGRA).toContain("lerSituacaoDasUnidades(client, ");
    expect(REGRA_DO_BLOQUEIO).toContain("estaLivre(situacao)");
    expect(REGRA).not.toContain('.from("hercules_propostas")');
    expect(REGRA).not.toContain('.eq("aberta"');
    expect(REGRA).not.toContain('unidade.situacao !== "disponivel"');
  });

  it("⚠️ situação que não se leu não é livre", () => {
    expect(REGRA_DO_BLOQUEIO).toContain("if (!situacao)");
  });

  it("a conferência vem ANTES da escrita, nos dois verbos", () => {
    for (const verbo of [REGRA_DO_BLOQUEIO, REGRA_DO_DESBLOQUEIO]) {
      const conferencia = verbo.indexOf("await situacaoDoTerreno(client, unidade)");
      const escrita = verbo.indexOf(".update(");
      expect(conferencia).toBeGreaterThan(-1);
      expect(escrita).toBeGreaterThan(conferencia);
    }
  });

  it("grava com UPDATE condicional e confere o que casou", () => {
    // Sem isto, `.update()` devolve sucesso casando zero linhas, e a corrida com uma reserva
    // simultânea passaria calada.
    expect(REGRA_DO_BLOQUEIO).toContain('.eq("situacao", "disponivel")');
    expect(REGRA_DO_BLOQUEIO).toContain('.select("id")');
  });

  it("carimba autor, nome e data", () => {
    for (const coluna of ["bloqueado_em", "bloqueado_por", "bloqueado_por_nome", "bloqueio_motivo"]) {
      expect(REGRA_DO_BLOQUEIO).toContain(coluna);
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
    for (const [verbo, chamada] of [
      [post ?? "", "bloquearUnidade(admin"],
      [del ?? "", "desbloquearUnidade(admin"],
    ] as const) {
      const regua = verbo.indexOf("autorizarEscritaNoProduto(");
      const escrita = verbo.indexOf(chamada);
      expect(regua).toBeGreaterThan(-1);
      expect(escrita).toBeGreaterThan(regua);
    }
  });
});

describe("o desbloqueio (na regra)", () => {
  it("existe nas duas pontas", () => {
    expect(ROTA).toContain("export async function DELETE");
    expect(REGRA).toContain("export async function desbloquearUnidade");
  });

  it("só desfaz bloqueio feito no Panteon", () => {
    // Desfazer os 1.554 herdados do C2X criaria divergência que a próxima carga reverte sozinha.
    expect(REGRA_DO_DESBLOQUEIO).toContain("!ehBloqueioNativo(unidade)");
  });

  it("⚠️ e só com a régua dizendo `bloqueada` e sem outro dono no terreno", () => {
    expect(REGRA_DO_DESBLOQUEIO).toContain('situacao !== "bloqueada"');
    expect(REGRA_DO_DESBLOQUEIO).toContain("outrosDonosDoLote(client, situacoes, unidade.id");
    const donos = REGRA_DO_DESBLOQUEIO.indexOf("outrosDonosDoLote(");
    const escrita = REGRA_DO_DESBLOQUEIO.indexOf(".update(");
    expect(escrita).toBeGreaterThan(donos);
  });

  it("limpa o carimbo junto", () => {
    // Sem limpar, a unidade seguiria protegida da carga como se ainda estivesse bloqueada.
    expect(REGRA_DO_DESBLOQUEIO).toMatch(/bloqueado_em: null/);
    expect(REGRA_DO_DESBLOQUEIO).toMatch(/bloqueio_motivo: null/);
  });

  it("também é condicional", () => {
    expect(REGRA_DO_DESBLOQUEIO).toContain('.eq("situacao", "bloqueada")');
  });
});
