import { describe, expect, it } from "vitest";

import { eventoDoDia } from "./evento-do-dia";
import type { PrometeuEvento, PrometeuEventoStatus } from "./types";

const evento = (id: string, status: PrometeuEventoStatus): PrometeuEvento => ({
  arquivadoEm: null,
  config: {},
  dataEvento: null,
  enterpriseCode: null,
  enterpriseId: null,
  id,
  iniciadoEm: null,
  nome: id,
  status,
});

describe("qual lançamento a tela de operação abre", () => {
  it("EM ANDAMENTO ganha de tudo — é o dia acontecendo", () => {
    const lista = [evento("ativo", "ativo"), evento("rodando", "em_andamento")];
    expect(eventoDoDia(lista)?.id).toBe("rodando");
  });

  it("sem nenhum em andamento, abre o ativo", () => {
    const lista = [evento("rascunho", "rascunho"), evento("pronto", "ativo")];
    expect(eventoDoDia(lista)?.id).toBe("pronto");
  });

  it("NUNCA abre um encerrado — era o bug que fazia tudo mostrar o Vale do Ouro", () => {
    // Até 21/08/2026 o último fallback era `?? eventos[0]`, o mais recente da lista. Com o Vale
    // do Ouro (encerrado em 01/08) sendo o ÚNICO evento do banco, era exatamente ele que voltava:
    // check-in, atendente e gestão mobile abriam num lançamento morto enquanto as rotas de
    // servidor recusavam com "sem evento ativo".
    expect(eventoDoDia([evento("vale-do-ouro", "encerrado")])).toBeUndefined();
  });

  it("lista só com encerrados devolve nada, mesmo com vários", () => {
    const lista = [evento("a", "encerrado"), evento("b", "encerrado")];
    expect(eventoDoDia(lista)).toBeUndefined();
  });

  it("rascunho serve de último recurso — é o lançamento sendo montado antes do dia", () => {
    const lista = [evento("velho", "encerrado"), evento("montando", "rascunho")];
    expect(eventoDoDia(lista)?.id).toBe("montando");
  });

  it("lista vazia não quebra", () => {
    expect(eventoDoDia([])).toBeUndefined();
  });
});
