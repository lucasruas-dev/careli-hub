import { describe, expect, it } from "vitest";

import { chaveDaLinhaDaCarteira } from "./chave-da-linha";

// Os dados são os da carteira real da Gurgel, lidos da sessão em 21/09/2026: a unidade REPC96
// (id 2646) tem DOIS contratos, um de LUCIMAR e outro de SIMONE — e era essa colisão que deixava
// linhas órfãs na tabela ao trocar o filtro de empreendimento.
const LUCIMAR = { client: "LUCIMAR TAVARES", contractCode: "REP3", id: "2646" };
const SIMONE = { client: "SIMONE FERNANDES DE SOUZA", contractCode: "REP2", id: "2646" };

describe("a chave de uma linha da carteira", () => {
  it("⚠️ duas linhas da MESMA unidade têm chaves diferentes", () => {
    // Com `key={unit.id}` as duas eram "2646": o React perdia a conta e sobravam linhas de outro
    // empreendimento no DOM depois de filtrar.
    expect(chaveDaLinhaDaCarteira(LUCIMAR)).not.toBe(chaveDaLinhaDaCarteira(SIMONE));
  });

  it("a mesma linha dá sempre a mesma chave, em qualquer ordenação", () => {
    expect(chaveDaLinhaDaCarteira(LUCIMAR)).toBe(chaveDaLinhaDaCarteira({ ...LUCIMAR }));
  });

  it("unidades diferentes não colidem", () => {
    expect(chaveDaLinhaDaCarteira({ client: "X", contractCode: "REP2", id: "2728" })).not.toBe(
      chaveDaLinhaDaCarteira({ client: "X", contractCode: "REP2", id: "2740" }),
    );
  });

  it("sem contrato e sem comprador, ainda sai chave da unidade", () => {
    expect(chaveDaLinhaDaCarteira({ id: 5534 })).toBe("5534||");
    expect(chaveDaLinhaDaCarteira({ client: null, contractCode: null, id: "5534" })).toBe("5534||");
  });

  // O comprador vem do C2X com caixa e espaços variando entre cargas; sem normalizar, a mesma linha
  // mudaria de chave entre uma consulta e outra e perderia o estado de expandida.
  it("caixa e espaço no nome não mudam a chave", () => {
    expect(chaveDaLinhaDaCarteira({ client: " Lucimar Tavares ", contractCode: "REP3", id: "2646" })).toBe(
      chaveDaLinhaDaCarteira(LUCIMAR),
    );
  });
});
