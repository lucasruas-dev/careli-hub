import { describe, expect, it } from "vitest";

import type { LinhaAssinatura } from "./painel-assinatura";
import { agruparUnidadesDeAssinatura, contarParadoPorPerfil } from "./unidades-assinatura";

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

describe("agruparUnidadesDeAssinatura", () => {
  it("inclui unidade cujo comprador AINDA NÃO assinou", () => {
    // ⚠️ O recorte antigo só trazia quem já tinha o comprador assinado, e escondia justamente as
    // mais urgentes. Foi o "cadê a barrinha desse aí?" do Lucas na VOC0305.
    const resultado = agruparUnidadesDeAssinatura(
      mapa(
        linha({ assinou: false, un: "VOC0305", usuario: "DALTON" }),
        linha({ assinou: false, degrau: 3, perfil: "Incorporador", un: "VOC0305" }),
      ),
    );
    expect(resultado.map((u) => u.un)).toEqual(["VOC0305"]);
    expect(resultado[0]?.compradorAssinou).toBe(false);
  });

  it("marca compradorAssinou só quando TODOS os compradores assinaram", () => {
    const resultado = agruparUnidadesDeAssinatura(
      mapa(
        linha({ assinadoEm: "2026-08-05", assinou: true, un: "A", usuario: "MARIDO" }),
        linha({ assinou: false, un: "A", usuario: "ESPOSA" }),
        linha({ assinadoEm: "2026-08-05", assinou: true, un: "B", usuario: "SOZINHO" }),
      ),
    );
    const porUn = Object.fromEntries(resultado.map((u) => [u.un, u.compradorAssinou]));
    expect(porUn).toEqual({ A: false, B: true });
  });

  it("uma barra por PERFIL, na ordem em que cada um é chamado", () => {
    const resultado = agruparUnidadesDeAssinatura(
      mapa(
        linha({ assinadoEm: "2026-08-02", assinou: true, degrau: 1, perfil: "Imobiliária", un: "A" }),
        linha({ assinadoEm: "2026-08-03", assinou: true, degrau: 2, un: "A" }),
        linha({ assinou: false, degrau: 5, perfil: "Incorporador", un: "A", usuario: "X" }),
        linha({ assinou: false, degrau: 5, perfil: "Incorporador", un: "A", usuario: "Y" }),
        linha({ assinou: false, degrau: 7, perfil: "Backoffice", un: "A" }),
      ),
    );
    expect(resultado[0]?.grupos.map((g) => `${g.perfil} ${g.assinadas}/${g.total}`)).toEqual([
      "Imobiliária 1/1",
      "Comprador 1/1",
      "Incorporador 0/2",
      "Backoffice 0/1",
    ]);
  });

  it("só o perfil da VEZ recebe naVez — os de trás não", () => {
    // É o destaque que faz a linha ler "falta o Incorporador" sem ninguém somar de cabeça.
    const resultado = agruparUnidadesDeAssinatura(
      mapa(
        linha({ assinadoEm: "2026-08-02", assinou: true, degrau: 1, perfil: "Imobiliária", un: "A" }),
        linha({ assinou: false, degrau: 5, perfil: "Incorporador", un: "A" }),
        linha({ assinou: false, degrau: 7, perfil: "Backoffice", un: "A" }),
      ),
    );
    const naVez = Object.fromEntries(resultado[0]!.grupos.map((g) => [g.perfil, g.naVez]));
    expect(naVez).toEqual({ Backoffice: false, Imobiliária: false, Incorporador: true });
    expect(resultado[0]?.perfisNaVez).toEqual(["Incorporador"]);
  });

  it("perfil que NÃO assina o contrato não vira barra vazia", () => {
    // Barra vazia diria "falta alguém" de quem nunca foi chamado.
    const resultado = agruparUnidadesDeAssinatura(
      mapa(linha({ assinadoEm: "2026-08-02", assinou: true, un: "A" })),
    );
    expect(resultado[0]?.grupos.map((g) => g.perfil)).toEqual(["Comprador"]);
  });

  it("o degrau é o MENOR pendente — é ele que trava a fila", () => {
    const resultado = agruparUnidadesDeAssinatura(
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
    const resultado = agruparUnidadesDeAssinatura(
      mapa(
        linha({ assinadoEm: "2026-08-03", assinou: true, degrau: 1, un: "A" }),
        linha({ assinou: false, degrau: 0, perfil: "Backoffice", un: "A", usuario: "SEM ORDEM" }),
        linha({ assinou: false, degrau: 5, perfil: "Incorporador", un: "A", usuario: "COM ORDEM" }),
      ),
    );
    expect(resultado[0]?.degrau).toBe(5);
    expect(resultado[0]?.esperando).toEqual(["COM ORDEM"]);
  });

  it("contrato completo: concluida, degrau null e ninguém esperando", () => {
    const resultado = agruparUnidadesDeAssinatura(
      mapa(
        linha({ assinadoEm: "2026-08-03", assinou: true, degrau: 1, un: "A" }),
        linha({ assinadoEm: "2026-08-04", assinou: true, degrau: 2, perfil: "Backoffice", un: "A" }),
      ),
    );
    expect(resultado[0]?.concluida).toBe(true);
    expect(resultado[0]?.degrau).toBeNull();
    expect(resultado[0]?.esperando).toEqual([]);
  });

  it("mais de uma pessoa no mesmo degrau aparece junto, sem repetir nome", () => {
    const resultado = agruparUnidadesDeAssinatura(
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
    const resultado = agruparUnidadesDeAssinatura(
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
    const resultado = agruparUnidadesDeAssinatura(
      mapa(
        linha({ assinadoEm: "2026-08-03", assinou: true, envio: "2026-08-01", un: "A", usuario: "M" }),
        linha({ assinadoEm: "2026-08-06", assinou: true, envio: "2026-08-01", un: "A", usuario: "E" }),
      ),
    );
    expect(resultado[0]?.dias).toBe(5);
    expect(resultado[0]?.ultima).toBe("2026-08-06");
  });

  it("comprador incompleto não tem data nem dias, mesmo com um deles assinado", () => {
    // Metade do casal assinou: a unidade ainda não passou do comprador.
    const resultado = agruparUnidadesDeAssinatura(
      mapa(
        linha({ assinadoEm: "2026-08-03", assinou: true, un: "A", usuario: "M" }),
        linha({ assinou: false, un: "A", usuario: "E" }),
      ),
    );
    expect(resultado[0]?.ultima).toBeNull();
    expect(resultado[0]?.dias).toBeNull();
  });

  it("o mais parado vem primeiro; contrato completo vai para o fim", () => {
    const resultado = agruparUnidadesDeAssinatura(
      mapa(
        linha({ assinadoEm: "2026-08-20", assinou: true, envio: "2026-08-20", un: "PRONTA" }),
        linha({ assinou: false, envio: "2026-08-10", un: "RECENTE" }),
        linha({ assinou: false, envio: "2026-08-01", un: "ANTIGA" }),
      ),
    );
    expect(resultado.map((u) => u.un)).toEqual(["ANTIGA", "RECENTE", "PRONTA"]);
  });
});

describe("contarParadoPorPerfil", () => {
  it("conta unidades por perfil que trava, do maior para o menor", () => {
    const unidades = agruparUnidadesDeAssinatura(
      mapa(
        linha({ assinou: false, degrau: 7, perfil: "Backoffice", un: "A" }),
        linha({ assinou: false, degrau: 7, perfil: "Backoffice", un: "B" }),
        linha({ assinou: false, degrau: 4, perfil: "Incorporador", un: "C" }),
      ),
    );
    expect(contarParadoPorPerfil(unidades)).toEqual([
      { perfil: "Backoffice", quantas: 2 },
      { perfil: "Incorporador", quantas: 1 },
    ]);
  });

  it("contrato completo não conta para ninguém", () => {
    const unidades = agruparUnidadesDeAssinatura(
      mapa(linha({ assinadoEm: "2026-08-03", assinou: true, un: "A" })),
    );
    expect(contarParadoPorPerfil(unidades)).toEqual([]);
  });

  it("unidade parada em DOIS perfis ao mesmo tempo conta nos dois", () => {
    // Acontece quando duas pessoas de perfis diferentes dividem o mesmo degrau.
    const unidades = agruparUnidadesDeAssinatura(
      mapa(
        linha({ assinou: false, degrau: 6, perfil: "Coordenadora de venda", un: "A" }),
        linha({ assinou: false, degrau: 6, perfil: "Backoffice", un: "A", usuario: "OUTRO" }),
      ),
    );
    expect(contarParadoPorPerfil(unidades)).toEqual([
      { perfil: "Backoffice", quantas: 1 },
      { perfil: "Coordenadora de venda", quantas: 1 },
    ]);
  });
});
