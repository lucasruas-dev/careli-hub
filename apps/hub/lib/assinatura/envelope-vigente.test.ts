import { describe, expect, it } from "vitest";

import {
  envelopeQueSegura,
  type EnvelopeParaEscolher,
  envelopeVigente,
  ESTADOS_QUE_LIBERAM_REENVIO,
  seguraOEnvio,
} from "./envelope-vigente";
import * as envioDb from "./envio-db";

// A RÉGUA DO ENVELOPE VIGENTE (F2 da fonte única, plano, seção 4).
//
// ⚠️ O QUE ESTÁ EM JOGO: até aqui o portal tinha uma cópia própria ("o mais recente que não morreu"),
// que discordava da guarda do envio no rascunho e no contrato assinado seguido de outro envio. Agora
// as duas perguntas ("qual segura?" e "qual vale?") saem da mesma folha pura.

let n = 0;
function linha(p: Partial<EnvelopeParaEscolher> = {}): EnvelopeParaEscolher {
  n += 1;
  return {
    criado_em: "2026-09-20T12:00:00.000Z",
    enviado_em: "2026-09-20T12:01:00.000Z",
    envelope_id: `env-${n}`,
    estado: "aguardando",
    falha: null,
    id: `reg-${n}`,
    provedor: "clicksign",
    ...p,
  };
}

describe("envelopeVigente", () => {
  it("⚠️ o assinado vence um vivo mais novo, e os dois viram o aviso de dois contratos", () => {
    const assinado = linha({ criado_em: "2026-09-10T12:00:00.000Z", estado: "assinado" });
    const vivoNovo = linha({ criado_em: "2026-09-20T12:00:00.000Z", estado: "parcial" });
    const r = envelopeVigente([vivoNovo, assinado]);
    expect(r.vigente).toBe(assinado);
    expect(r.doisContratosVivos).toBe(true);
    expect(r.vivos).toEqual([vivoNovo, assinado]);
  });

  it("sem assinado, o vivo enviado mais recente vale; o morto não conta", () => {
    const velho = linha({ criado_em: "2026-09-10T12:00:00.000Z", estado: "aguardando" });
    const novo = linha({ criado_em: "2026-09-15T12:00:00.000Z", estado: "parcial" });
    const morto = linha({ criado_em: "2026-09-25T12:00:00.000Z", estado: "cancelado" });
    const r = envelopeVigente([velho, morto, novo]);
    expect(r.vigente).toBe(novo);
    expect(r.doisContratosVivos).toBe(true);
  });

  it("⚠️ compara criado_em como DATA: `-03:00` do espelho contra `Z` do PostgREST", () => {
    // 10:00-03:00 é 13:00Z: mais NOVO que 12:30Z, embora "10" venha antes de "12" no texto.
    const doEspelho = linha({ criado_em: "2026-09-20T10:00:00.000-03:00", provedor: "d4sign" });
    const daTemis = linha({ criado_em: "2026-09-20T12:30:00.000Z" });
    expect(envelopeVigente([daTemis, doEspelho]).vigente).toBe(doEspelho);
  });

  it("rascunho sem envelope_id e sem falha segura o envio, mas NÃO é vigente: envio em curso", () => {
    const rascunho = linha({ envelope_id: null, enviado_em: null, estado: "rascunho" });
    const r = envelopeVigente([rascunho]);
    expect(seguraOEnvio(rascunho)).toBe(true);
    expect(envelopeQueSegura([rascunho])).toBe(rascunho);
    expect(r).toEqual({ doisContratosVivos: false, envioEmCurso: true, vigente: null, vivos: [] });
  });

  it("rascunho COM envelope_id conta como enviado (diferença aceita: é o que a guarda diz dele)", () => {
    const morreuNoMeio = linha({ enviado_em: null, estado: "rascunho" });
    expect(envelopeVigente([morreuNoMeio]).vigente).toBe(morreuNoMeio);
  });

  it("falha sem envelope_id libera: nem segura, nem vale", () => {
    const falhou = linha({ envelope_id: null, enviado_em: null, estado: "rascunho", falha: "upload" });
    expect(seguraOEnvio(falhou)).toBe(false);
    expect(envelopeVigente([falhou])).toEqual({
      doisContratosVivos: false,
      envioEmCurso: false,
      vigente: null,
      vivos: [],
    });
  });

  it("⚠️ Clicksign parcial + D4Sign aguardando: dois contratos vivos, de provedores diferentes", () => {
    const clicksign = linha({ criado_em: "2026-09-21T12:00:00.000Z", estado: "parcial" });
    const d4sign = linha({ criado_em: "2026-09-20T12:00:00.000Z", estado: "aguardando", provedor: "d4sign" });
    const r = envelopeVigente([d4sign, clicksign]);
    expect(r.doisContratosVivos).toBe(true);
    expect(r.vigente).toBe(clicksign);
  });

  it("nenhuma linha: nada vale, nada em curso", () => {
    expect(envelopeVigente([])).toEqual({ doisContratosVivos: false, envioEmCurso: false, vigente: null, vivos: [] });
  });
});

describe("a guarda de sempre, agora morando aqui", () => {
  it("liberam o reenvio só cancelado, expirado e recusado; assinado segura", () => {
    expect([...ESTADOS_QUE_LIBERAM_REENVIO].sort()).toEqual(["cancelado", "expirado", "recusado"]);
    expect(seguraOEnvio(linha({ estado: "assinado" }))).toBe(true);
    expect(seguraOEnvio(linha({ estado: "expirado" }))).toBe(false);
  });

  it("⚠️ envio-db.ts reexporta a MESMA régua (os leitores de antes não mudam de import)", () => {
    expect(envioDb.envelopeQueSegura).toBe(envelopeQueSegura);
    expect(envioDb.seguraOEnvio).toBe(seguraOEnvio);
    expect(envioDb.ESTADOS_QUE_LIBERAM_REENVIO).toBe(ESTADOS_QUE_LIBERAM_REENVIO);
  });
});
