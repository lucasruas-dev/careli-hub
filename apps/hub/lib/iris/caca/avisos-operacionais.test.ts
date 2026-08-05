import { describe, expect, it } from "vitest";

import { filtrarVigentes } from "./avisos-operacionais";

// O risco aqui e' a CACA repetir pro cliente um aviso que deixou de ser verdade (dizer em
// setembro que "os boletos de julho atrasaram"). Cada caso abaixo cuida disso.
const AGORA = new Date("2026-07-26T12:00:00.000Z");

const avisoIpca = {
  assunto: "boleto",
  ativo: true,
  texto:
    "A emissão das parcelas de julho atrasou por causa da correção pelo IPCA. Assim que sair, o boleto é enviado automaticamente.",
  titulo: "Boletos de julho",
  vale_ate: "2026-08-05T00:00:00.000Z",
};

describe("filtrarVigentes", () => {
  it("mantem aviso ativo dentro do prazo", () => {
    expect(filtrarVigentes([avisoIpca], AGORA)).toHaveLength(1);
  });

  it("DESCARTA aviso vencido: contexto datado nao pode sobreviver ao proprio prazo", () => {
    expect(
      filtrarVigentes(
        [{ ...avisoIpca, vale_ate: "2026-07-20T00:00:00.000Z" }],
        AGORA,
      ),
    ).toHaveLength(0);
  });

  it("descarta aviso desligado na mao", () => {
    expect(filtrarVigentes([{ ...avisoIpca, ativo: false }], AGORA)).toHaveLength(
      0,
    );
  });

  it("mantem aviso sem prazo (vale ate' alguem desligar)", () => {
    expect(
      filtrarVigentes([{ ...avisoIpca, vale_ate: null }], AGORA),
    ).toHaveLength(1);
  });

  it("data quebrada nao faz o recado sumir", () => {
    expect(
      filtrarVigentes([{ ...avisoIpca, vale_ate: "amanha" }], AGORA),
    ).toHaveLength(1);
  });

  it("descarta aviso sem texto (linha criada e nunca preenchida)", () => {
    expect(filtrarVigentes([{ ...avisoIpca, texto: "   " }], AGORA)).toHaveLength(
      0,
    );
  });

  it("aviso que vence exatamente agora ainda vale", () => {
    expect(
      filtrarVigentes([{ ...avisoIpca, vale_ate: AGORA.toISOString() }], AGORA),
    ).toHaveLength(1);
  });

  it("normaliza: titulo vazio vira 'Aviso' e assunto em branco vira nulo", () => {
    const [aviso] = filtrarVigentes(
      [{ ...avisoIpca, assunto: "  ", titulo: "  " }],
      AGORA,
    );

    expect(aviso?.titulo).toBe("Aviso");
    expect(aviso?.assunto).toBeNull();
  });
});
