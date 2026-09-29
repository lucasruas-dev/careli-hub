import { describe, expect, it } from "vitest";

// OS GRUPOS DO CATÁLOGO SEM PERGUNTAR AO C2X.
//
// ⚠️ ESTE ARQUIVO EXISTE PORQUE O CATÁLOGO NUNCA LANÇA. `lerDoC2x` devolve `cache?.valor ?? []` quando
// o pool do C2X não abre (`catalogo-empreendimentos.ts:93`) e quando a query falha (`:113`): numa
// instância de cache frio isso é catálogo VAZIO, e quem monta escopo com `comIdsDoGrupo` perde os ids
// de grupo calado. `GRUPOS_DO_CATALOGO` é a terceira saída — o mapa de grupo é CONSTANTE DE CÓDIGO
// (`ENTERPRISE_GROUPS`), não dado do legado.
//
// ⚠️ E O QUE ELE PROVA É A IGUALDADE COM O `agrupar` DE VERDADE. Se as duas regras divergirem (o `id`
// montado de outro jeito, ou `ids` fora da ordem de `codes`), o grupo deixa de casar com
// `apolo_esteira.enterprise_id`, e o efeito é uma recusa falsa numa CAD credenciada — silenciosa.
//
// ⚠️ MEDIDO EM 26/09/2026 (`bxgukywoxgivlrhjkwjx`, só SELECT):
//   select enterprise_id, etapa, count(*) from apolo_esteira where enterprise_id like 'group:%'
//    group by 1,2;  → 2 linhas, as duas `group:Lagoa Bonita`, as duas `credenciado`.

import { ENTERPRISE_GROUPS } from "@/lib/guardian/c2x-analytics";

import { agrupar, GRUPOS_DO_CATALOGO } from "./catalogo-empreendimentos";

describe("GRUPOS_DO_CATALOGO entrega os grupos sem tocar no C2X", () => {
  it("tem um grupo para cada ENTERPRISE_GROUPS, nenhum a mais", () => {
    expect(GRUPOS_DO_CATALOGO).toHaveLength(ENTERPRISE_GROUPS.length);
    expect(GRUPOS_DO_CATALOGO.map((g) => g.id)).toContain("group:Lagoa Bonita");
    expect(GRUPOS_DO_CATALOGO.map((g) => g.id)).toContain("group:Vale do Ouro");
  });

  // ⚠️ O TESTE QUE PEGA A DIVERGÊNCIA: `agrupar` roda sobre as linhas que o C2X devolveria, com os
  // mesmos ids e códigos da constante. O `id` e os `stageIds` de cada grupo têm de sair iguais.
  it("casa id por id e divisão por divisão com o `agrupar` de verdade", () => {
    const linhasComoOC2xDevolveria = ENTERPRISE_GROUPS.flatMap((grupo) =>
      grupo.codes.map((code, i) => ({ code, id: grupo.ids[i] ?? 0, name: code })),
    );

    const doAgrupar = agrupar(linhasComoOC2xDevolveria)
      .filter((emp) => emp.id.startsWith("group:"))
      .map((emp) => ({ id: emp.id, stageIds: [...emp.stageIds].sort() }));
    const daConstante = GRUPOS_DO_CATALOGO.map((emp) => ({
      id: emp.id,
      stageIds: [...emp.stageIds].sort(),
    }));

    expect([...daConstante].sort((a, b) => a.id.localeCompare(b.id))).toEqual(
      [...doAgrupar].sort((a, b) => a.id.localeCompare(b.id)),
    );
  });

  // O caso que a barra da CAD precisa: a Lagoa Bonita com as três glebas medidas no C2X (PAN-124).
  it("a Lagoa Bonita traz as três glebas (33 LBF, 27 LBR, 32 LBP)", () => {
    const lagoa = GRUPOS_DO_CATALOGO.find((g) => g.id === "group:Lagoa Bonita");
    expect([...(lagoa?.stageIds ?? [])].sort()).toEqual(["27", "32", "33"]);
  });
});
