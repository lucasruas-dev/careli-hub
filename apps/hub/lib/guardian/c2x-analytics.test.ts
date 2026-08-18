import { describe, expect, it } from "vitest";

import {
  ANALYTICS_EXCLUDED_ENTERPRISE_CODES,
  displayEnterprise,
  ENTERPRISE_MIRRORS,
  EXCLUDED_ENTERPRISE_CODES,
  findEnterpriseMirror,
  isMirrorEnterprise,
  MIRROR_ENTERPRISE_CODES,
} from "./c2x-analytics";

// A REGRA DO ESPELHO, medida no C2X em 18/08/2026:
//   VLO (35) = registro do Vale do Ouro antes da divisão. 298 unidades, TODAS com gêmeo por
//   quadra/lote em VOC (37, 157 un) + VOL (36, 141 un). Somar os três conta o loteamento duas
//   vezes; o espelho, porém, não pode sumir do sistema (masterplan, CADs da esteira, painel do
//   coordenador vivem nele).

describe("ENTERPRISE_MIRRORS", () => {
  it("o VLO é espelho e aponta para as divisões vivas", () => {
    const vlo = findEnterpriseMirror("VLO");

    expect(vlo).not.toBeNull();
    expect(vlo?.divisions).toEqual(["VOC", "VOL"]);
    expect(MIRROR_ENTERPRISE_CODES).toContain("VLO");
  });

  it("as divisões vivas NÃO são espelho (senão o Vale do Ouro sumiria da conta)", () => {
    expect(isMirrorEnterprise("VOC")).toBe(false);
    expect(isMirrorEnterprise("VOL")).toBe(false);
    // VOR = "VALE DO OURO - EXTRAS" (id 41): empreendimento de verdade, não cópia.
    expect(isMirrorEnterprise("VOR")).toBe(false);
  });

  it("reconhece o código com espaço e em caixa baixa, e aguenta nulo", () => {
    expect(isMirrorEnterprise(" vlo ")).toBe(true);
    expect(isMirrorEnterprise(null)).toBe(false);
    expect(isMirrorEnterprise("")).toBe(false);
  });

  it("todo espelho traz rótulo e explicação — a linha continua na tela, marcada", () => {
    for (const mirror of ENTERPRISE_MIRRORS) {
      expect(mirror.label.trim().length).toBeGreaterThan(0);
      expect(mirror.note.trim().length).toBeGreaterThan(0);
      expect(mirror.divisions.length).toBeGreaterThan(0);
    }
  });

  it("🔴 espelho NÃO entra em EXCLUDED_ENTERPRISE_CODES", () => {
    // EXCLUDED tira o empreendimento de TUDO (carteira, cobrança, extrato, credenciamento,
    // catálogo, ficha). Botar o VLO ali quebraria de uma vez: o espelho do masterplan
    // (lib/apolo/espelho-masterplan.ts, MASTERPLAN = 35), as CADs da esteira (apolo_esteira é
    // 100% enterprise_id 35) e o painel do coordenador (GRUPOS_C2X). Este teste é a trava.
    for (const code of MIRROR_ENTERPRISE_CODES) {
      expect(EXCLUDED_ENTERPRISE_CODES).not.toContain(code);
    }
  });

  it("ANALYTICS_EXCLUDED = os excluídos de sempre + os espelhos", () => {
    for (const code of EXCLUDED_ENTERPRISE_CODES) {
      expect(ANALYTICS_EXCLUDED_ENTERPRISE_CODES).toContain(code);
    }

    for (const code of MIRROR_ENTERPRISE_CODES) {
      expect(ANALYTICS_EXCLUDED_ENTERPRISE_CODES).toContain(code);
    }

    expect(ANALYTICS_EXCLUDED_ENTERPRISE_CODES).toHaveLength(
      EXCLUDED_ENTERPRISE_CODES.length + MIRROR_ENTERPRISE_CODES.length,
    );
  });
});

describe("displayEnterprise", () => {
  it("o espelho NÃO colapsa com as divisões: os quatro têm o mesmo nome no C2X", () => {
    // Era aqui que o motor da CACÁ perdia a conta: `return name` dava a MESMA chave para os
    // quatro "VALE DO OURO", e a agregação por rótulo somava o loteamento duas vezes.
    const espelho = displayEnterprise("VLO", "VALE DO OURO");
    const voc = displayEnterprise("VOC", "VALE DO OURO");
    const vol = displayEnterprise("VOL", "VALE DO OURO");

    expect(voc).toBe("VALE DO OURO");
    expect(vol).toBe("VALE DO OURO");
    expect(espelho).not.toBe(voc);
    expect(espelho).toContain("histórico");
  });

  it("continua consolidando os grupos e devolvendo o nome dos demais", () => {
    expect(displayEnterprise("LBF", "LAGOA BONITA")).toBe("Lagoa Bonita");
    expect(displayEnterprise("LOU", "LAVRA DO OURO")).toBe("Lavra do Ouro");
    expect(displayEnterprise("JDG", "JARDIM DAS GERAIS")).toBe(
      "JARDIM DAS GERAIS",
    );
  });
});
