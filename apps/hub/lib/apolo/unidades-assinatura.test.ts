import { describe, expect, it } from "vitest";

import type { LinhaAssinatura } from "./painel-assinatura";
import { agruparUnidadesComCompradorAssinado } from "./unidades-assinatura";

const linha = (parcial: Partial<LinhaAssinatura>): LinhaAssinatura => ({
  assinadoEm: null,
  assinou: false,
  contrato: 1,
  degrau: 1,
  diasDesdeEnvio: 0,
  email: "a@b.com",
  emp: "VOC",
  envio: "2026-08-01",
  lote: "01",
  perfil: "Comprador",
  prazo: null,
  quadra: "1",
  situacao: "vez",
  un: "VOC0101",
  usuario: "FULANO",
  valor: 100,
  ...parcial,
});

const mapa = (...linhas: LinhaAssinatura[]) => {
  const m = new Map<string, LinhaAssinatura[]>();
  for (const l of linhas) {
    if (!m.has(l.un)) m.set(l.un, []);
    m.get(l.un)?.push(l);
  }
  return m;
};

describe("agruparUnidadesComCompradorAssinado", () => {
  it("só entra unidade em que TODOS os compradores assinaram", () => {
    const resultado = agruparUnidadesComCompradorAssinado(
      mapa(
        linha({ assinadoEm: "2026-08-05", assinou: true, un: "A", usuario: "MARIDO" }),
        linha({ assinou: false, un: "A", usuario: "ESPOSA" }),
        linha({ assinadoEm: "2026-08-05", assinou: true, un: "B", usuario: "SOZINHO" }),
      ),
    );
    expect(resultado.map((u) => u.un)).toEqual(["B"]);
  });

  it("unidade SEM comprador nenhum fica de fora", () => {
    // Não dá para dizer "o comprador assinou" quando não há comprador na lista.
    const resultado = agruparUnidadesComCompradorAssinado(
      mapa(linha({ assinadoEm: "2026-08-05", assinou: true, perfil: "Imobiliária", un: "A" })),
    );
    expect(resultado).toEqual([]);
  });

  it("o total é o contrato inteiro e o assinadas conta todos os perfis", () => {
    const resultado = agruparUnidadesComCompradorAssinado(
      mapa(
        linha({ assinadoEm: "2026-08-02", assinou: true, degrau: 1, perfil: "Imobiliária", un: "A" }),
        linha({ assinadoEm: "2026-08-03", assinou: true, degrau: 2, un: "A" }),
        linha({ assinou: false, degrau: 3, perfil: "Incorporador", un: "A" }),
        linha({ assinou: false, degrau: 4, perfil: "Backoffice", un: "A" }),
      ),
    );
    expect(resultado[0]?.total).toBe(4);
    expect(resultado[0]?.assinadas).toBe(2);
  });

  it("o degrau é o MENOR pendente — é ele que trava a fila", () => {
    const resultado = agruparUnidadesComCompradorAssinado(
      mapa(
        linha({ assinadoEm: "2026-08-03", assinou: true, degrau: 1, un: "A" }),
        linha({ assinou: false, degrau: 7, perfil: "Backoffice", un: "A", usuario: "TARDE" }),
        linha({ assinou: false, degrau: 4, perfil: "Incorporador", un: "A", usuario: "CEDO" }),
      ),
    );
    expect(resultado[0]?.degrau).toBe(4);
    expect(resultado[0]?.esperando).toEqual(["CEDO"]);
  });

  it("assinatura sem ordem (degrau 0) vai para o FIM, não trava a fila", () => {
    // ⚠️ degrau 0 seria o menor de todos: o contrato apareceria travado numa ordem inexistente.
    const resultado = agruparUnidadesComCompradorAssinado(
      mapa(
        linha({ assinadoEm: "2026-08-03", assinou: true, degrau: 1, un: "A" }),
        linha({ assinou: false, degrau: 0, perfil: "Backoffice", un: "A", usuario: "SEM ORDEM" }),
        linha({ assinou: false, degrau: 5, perfil: "Incorporador", un: "A", usuario: "COM ORDEM" }),
      ),
    );
    expect(resultado[0]?.degrau).toBe(5);
    expect(resultado[0]?.esperando).toEqual(["COM ORDEM"]);
  });

  it("contrato completo tem degrau null e ninguém esperando", () => {
    const resultado = agruparUnidadesComCompradorAssinado(
      mapa(
        linha({ assinadoEm: "2026-08-03", assinou: true, degrau: 1, un: "A" }),
        linha({ assinadoEm: "2026-08-04", assinou: true, degrau: 2, perfil: "Backoffice", un: "A" }),
      ),
    );
    expect(resultado[0]?.degrau).toBeNull();
    expect(resultado[0]?.esperando).toEqual([]);
    expect(resultado[0]?.assinadas).toBe(resultado[0]?.total);
  });

  it("mais de uma pessoa no mesmo degrau aparece junto em esperando, sem repetir", () => {
    const resultado = agruparUnidadesComCompradorAssinado(
      mapa(
        linha({ assinadoEm: "2026-08-03", assinou: true, degrau: 1, un: "A" }),
        linha({ assinou: false, degrau: 5, email: "x@y", perfil: "Incorporador", un: "A", usuario: "LINO" }),
        linha({ assinou: false, degrau: 5, email: "z@y", perfil: "Incorporador", un: "A", usuario: "LINO" }),
        linha({ assinou: false, degrau: 5, perfil: "Incorporador", un: "A", usuario: "RAFAEL" }),
      ),
    );
    expect(resultado[0]?.esperando).toEqual(["LINO", "RAFAEL"]);
  });

  it("os assinantes vêm na ordem da fila, com desempate pelo nome", () => {
    const resultado = agruparUnidadesComCompradorAssinado(
      mapa(
        linha({ assinou: false, degrau: 5, perfil: "Incorporador", un: "A", usuario: "ZEZE" }),
        linha({ assinadoEm: "2026-08-03", assinou: true, degrau: 2, un: "A", usuario: "COMPRADOR" }),
        linha({ assinou: false, degrau: 5, perfil: "Incorporador", un: "A", usuario: "ANA" }),
        linha({ assinadoEm: "2026-08-01", assinou: true, degrau: 1, perfil: "Imobiliária", un: "A" }),
      ),
    );
    expect(resultado[0]?.assinantes.map((a) => a.usuario)).toEqual([
      "FULANO",
      "COMPRADOR",
      "ANA",
      "ZEZE",
    ]);
  });

  it("dias conta do envio até a ÚLTIMA assinatura do comprador", () => {
    const resultado = agruparUnidadesComCompradorAssinado(
      mapa(
        linha({ assinadoEm: "2026-08-03", assinou: true, envio: "2026-08-01", un: "A", usuario: "M" }),
        linha({ assinadoEm: "2026-08-06", assinou: true, envio: "2026-08-01", un: "A", usuario: "E" }),
      ),
    );
    expect(resultado[0]?.dias).toBe(5);
    expect(resultado[0]?.ultima).toBe("2026-08-06");
  });

  it("ordena da assinatura mais recente para a mais antiga", () => {
    const resultado = agruparUnidadesComCompradorAssinado(
      mapa(
        linha({ assinadoEm: "2026-08-01", assinou: true, un: "ANTIGA" }),
        linha({ assinadoEm: "2026-08-20", assinou: true, un: "NOVA" }),
      ),
    );
    expect(resultado.map((u) => u.un)).toEqual(["NOVA", "ANTIGA"]);
  });
});
