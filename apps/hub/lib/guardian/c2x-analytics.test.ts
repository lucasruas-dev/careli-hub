import { describe, expect, it } from "vitest";

import { ENTERPRISES_DO_C2X_EM_25_09_2026 as C2X } from "@/lib/apolo/c2x-pelo-id.fixture";

import {
  ANALYTICS_EXCLUDED_ENTERPRISE_CODES,
  ANALYTICS_EXCLUDED_ENTERPRISE_IDS,
  displayEnterprise,
  ENTERPRISE_GROUPS,
  ENTERPRISE_MIRRORS,
  ENTERPRISE_SUB_ALIASES,
  EXCLUDED_ENTERPRISE_CODES,
  EXCLUDED_ENTERPRISE_IDS,
  findEnterpriseMirror,
  isMirrorEnterprise,
  MIRROR_ENTERPRISE_CODES,
  MIRROR_ENTERPRISE_IDS,
} from "./c2x-analytics";

// O id de cada sigla na tabela do C2X medida em 25/09/2026 (PAN-124).
const idDaSigla = (code: string): number | undefined => C2X.find((l) => l.code === code)?.id;

describe("PAN-124: os ids ao lado das siglas", () => {
  it("🔴 a exclusão pelo id devolve as mesmas linhas que a exclusão pela sigla, hoje", () => {
    const linhas = (fora: (l: { code: string; id: number }) => boolean) =>
      C2X.filter((l) => !fora(l)).map((l) => l.id);
    expect(linhas((l) => EXCLUDED_ENTERPRISE_IDS.includes(l.id))).toEqual(
      linhas((l) => EXCLUDED_ENTERPRISE_CODES.includes(l.code)),
    );
    expect(linhas((l) => ANALYTICS_EXCLUDED_ENTERPRISE_IDS.includes(l.id))).toEqual(
      linhas((l) => ANALYTICS_EXCLUDED_ENTERPRISE_CODES.includes(l.code)),
    );
  });

  it("os excluídos são o 2 (SDT), o 31 (LAB) e o 34 (TSC); o 30 (ex-LAG, hoje ACT) fica", () => {
    expect([...EXCLUDED_ENTERPRISE_IDS].sort((a, b) => a - b)).toEqual([2, 31, 34]);
    expect(EXCLUDED_ENTERPRISE_IDS).not.toContain(30);
    expect(EXCLUDED_ENTERPRISE_IDS.map((id) => C2X.find((l) => l.id === id)?.code).sort()).toEqual([
      "LAB",
      "SDT",
      "TSC",
    ]);
  });

  it("o espelho continua fora de EXCLUDED e dentro de ANALYTICS, pelo id também", () => {
    expect(MIRROR_ENTERPRISE_IDS).toEqual([35]);
    for (const id of MIRROR_ENTERPRISE_IDS) expect(EXCLUDED_ENTERPRISE_IDS).not.toContain(id);
    expect(ANALYTICS_EXCLUDED_ENTERPRISE_IDS).toEqual([...EXCLUDED_ENTERPRISE_IDS, ...MIRROR_ENTERPRISE_IDS]);
  });

  it("🔴 cada grupo, espelho e gleba tem o id certo, na mesma posição da sigla", () => {
    for (const grupo of ENTERPRISE_GROUPS) {
      expect(grupo.ids, grupo.display).toEqual(grupo.codes.map(idDaSigla));
    }
    for (const mirror of ENTERPRISE_MIRRORS) {
      expect(mirror.id).toBe(idDaSigla(mirror.code));
      expect(mirror.divisionIds).toEqual(mirror.divisions.map(idDaSigla));
    }
    for (const sub of ENTERPRISE_SUB_ALIASES) {
      expect(sub.id, sub.alias).toBe(idDaSigla(sub.code));
    }
  });
});

// A REGRA DO ESPELHO, medida no C2X em 18/08/2026:
//   VLO (35) = registro do Vale do Ouro antes da divisão. 298 unidades, TODAS com gêmeo por
//   quadra/lote em VOC (37, 157 un) + VOL (36, 141 un). Somar os três conta o loteamento duas
//   vezes; o espelho, porém, não pode sumir do sistema (masterplan, CADs da esteira, painel do
//   coordenador vivem nele).
// Remedido em 08/09/2026, já com a terceira carteira: VLO 298 · VOC 157 · VOL 141 · VOR 3. O
// cruzamento do espelho com as três, por quadra+lote, dá 301 pares, NENHUM com o mesmo id no C2X
// e 63 com situação divergente — o espelho está parado, e por isso nunca entra em soma.

describe("ENTERPRISE_MIRRORS", () => {
  it("o VLO é espelho e aponta para as divisões vivas", () => {
    const vlo = findEnterpriseMirror("VLO");

    expect(vlo).not.toBeNull();
    // ⚠️ O VOR ENTROU EM 08/09/2026. `divisions` é quem responde "quem está vivo no lugar do
    // espelho" — o filtro do motor da CACÁ (`filtroEmpreendimento`) traduz "VLO" nesta lista —,
    // e sem o VOR a resposta escondia as 3 unidades da carteira de extras.
    expect(vlo?.divisions).toEqual(["VOC", "VOL", "VOR"]);
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
    //
    // ⚠️ AS TRÊS VIVAS PASSARAM A COLAPSAR ENTRE SI EM 08/09/2026, e isso é o pedido: com o Vale
    // do Ouro em ENTERPRISE_GROUPS elas devolvem o `display` do grupo ("Vale do Ouro"), então o
    // ranking e as vendas por empreendimento mostram UMA linha em vez de três — o mesmo que já
    // fazem com Lagoa Bonita e Lavra do Ouro. Não é soma dobrada: as três são carteiras
    // diferentes, e o espelho continua com chave própria.
    const espelho = displayEnterprise("VLO", "VALE DO OURO");
    const voc = displayEnterprise("VOC", "VALE DO OURO");
    const vol = displayEnterprise("VOL", "VALE DO OURO");
    const vor = displayEnterprise("VOR", "VALE DO OURO - EXTRAS");

    expect(voc).toBe("Vale do Ouro");
    expect(vol).toBe("Vale do Ouro");
    // ⚠️ O VOR MUDOU DE RÓTULO: solto, ele saía como "VALE DO OURO - EXTRAS" e virava uma linha
    // separada em toda agregação por nome. Agora é a mesma do Vale do Ouro.
    expect(vor).toBe("Vale do Ouro");
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
