import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { emitirTokenDoTelao } from "@/lib/prometeu/link-do-telao";

import {
  apelidoDoEspelho,
  emitirTokenDoEspelho,
  linkDoEspelho,
  partirLinkCurto,
  seloConfere,
  seloDoEspelho,
  validarTokenDoEspelho,
} from "./link-do-espelho";

// O QUE ESTE TESTE PROTEGE: o espelho publico autoriza pelo TOKEN, e o token do espelho e assinado
// com a MESMA SESSAO_CAD_SECRET de todos os outros links publicos da casa. Sem o discriminante
// `k`, um token do telao do Prometeu — que ja circula fora do hub, num link que nunca expira —
// teria assinatura valida aqui e abriria o espelho de um empreendimento qualquer.
const SEGREDO = "segredo-de-teste";

beforeEach(() => {
  vi.stubEnv("SESSAO_CAD_SECRET", SEGREDO);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("link do espelho publico", () => {
  it("emite e valida, devolvendo o codigo do empreendimento", () => {
    const token = emitirTokenDoEspelho("VLO");

    expect(token).not.toBeNull();
    expect(validarTokenDoEspelho(token)).toBe("VLO");
  });

  it("normaliza o codigo para maiusculo, para o link ser o mesmo", () => {
    expect(validarTokenDoEspelho(emitirTokenDoEspelho(" vlo "))).toBe("VLO");
  });

  // ⚠️ O PONTO DO ARQUIVO. O link e feito para ser copiado, mandado no WhatsApp e reencontrado
  // depois na aba de Links — se cada abertura da tela gerasse um token novo, o Lucas veria um
  // link diferente do que ja circula e nao saberia qual vale.
  it("e DETERMINISTICO: o mesmo empreendimento devolve sempre o mesmo link", () => {
    expect(emitirTokenDoEspelho("VLO")).toBe(emitirTokenDoEspelho("VLO"));
    expect(linkDoEspelho("VLO", "Vale do Ouro")).toBe(
      linkDoEspelho("VLO", "Vale do Ouro"),
    );
  });

  it("da links diferentes para empreendimentos diferentes", () => {
    expect(emitirTokenDoEspelho("VLO")).not.toBe(emitirTokenDoEspelho("LAB"));
  });

  // ⚠️ A ARMADILHA QUE ESTE ARQUIVO EXISTE PARA FECHAR.
  it("RECUSA um token do telao, que tem assinatura valida no mesmo segredo", () => {
    const doTelao = emitirTokenDoTelao("evento-qualquer");

    // Assinatura boa, segredo certo, formato identico — e mesmo assim nao abre espelho nenhum.
    expect(doTelao).not.toBeNull();
    expect(validarTokenDoEspelho(doTelao)).toBeNull();
  });

  it("recusa assinatura forjada", () => {
    const token = emitirTokenDoEspelho("VLO");
    const [corpo] = String(token).split(".");

    expect(validarTokenDoEspelho(`${corpo}.assinaturaInventada`)).toBeNull();
  });

  it("recusa troca do empreendimento mantendo a assinatura", () => {
    const [, assinatura] = String(emitirTokenDoEspelho("VLO")).split(".");
    const outro = Buffer.from(JSON.stringify({ e: "LAB", k: "esp" })).toString(
      "base64url",
    );

    expect(validarTokenDoEspelho(`${outro}.${assinatura}`)).toBeNull();
  });

  it("recusa lixo e vazio sem estourar", () => {
    expect(validarTokenDoEspelho("")).toBeNull();
    expect(validarTokenDoEspelho(null)).toBeNull();
    expect(validarTokenDoEspelho("sem-ponto")).toBeNull();
    expect(validarTokenDoEspelho("nao.base64url!!")).toBeNull();
  });

  // Falha FECHADA: sem segredo nao sai link, e a tela avisa em vez de mostrar um link morto.
  it("nao emite nem valida quando falta o segredo", () => {
    const token = emitirTokenDoEspelho("VLO");
    vi.stubEnv("SESSAO_CAD_SECRET", "");

    expect(emitirTokenDoEspelho("VLO")).toBeNull();
    expect(linkDoEspelho("VLO", "Vale do Ouro")).toBeNull();
    expect(seloDoEspelho("VLO")).toBeNull();
    expect(validarTokenDoEspelho(token)).toBeNull();
  });

  // ⚠️ O LINK E CURTO E LEGIVEL. Lucas (10/09/2026): *"o url tem que ser mais personalizada,
  // esta longa, pode encurtar ela"*. Ele e lido em voz alta e as vezes digitado.
  it("monta a URL curta com apelido e selo", () => {
    expect(linkDoEspelho("VLO", "Vale do Ouro")).toBe(
      `https://c2x.app.br/e/vale-do-ouro-${seloDoEspelho("VLO")}`,
    );
  });

  it("o apelido tira acento e pontuacao", () => {
    expect(apelidoDoEspelho("Veredas do Ouro")).toBe("veredas-do-ouro");
    expect(apelidoDoEspelho("Vale do Ouro · VOC")).toBe("vale-do-ouro-voc");
    expect(apelidoDoEspelho("Aldeia das Cachoeiras das Pedras")).toBe(
      "aldeia-das-cachoeiras-das-pedras",
    );
  });

  it("parte o link curto em apelido e selo", () => {
    expect(partirLinkCurto("vale-do-ouro-3f9c2a7b")).toEqual({
      apelido: "vale-do-ouro",
      selo: "3f9c2a7b",
    });
    // Sem selo do tamanho certo nao vale nem consultar o banco.
    expect(partirLinkCurto("vale-do-ouro")).toBeNull();
    expect(partirLinkCurto("vale-do-ouro-abc")).toBeNull();
    expect(partirLinkCurto("semhifen")).toBeNull();
    expect(partirLinkCurto("")).toBeNull();
  });

  // ⚠️ O APELIDO SOZINHO NAO ABRE NADA: quem autoriza e o selo.
  it("o selo confere so para o codigo certo", () => {
    const selo = String(seloDoEspelho("VLO"));

    expect(seloConfere("VLO", selo)).toBe(true);
    expect(seloConfere("LAB", selo)).toBe(false);
    expect(seloConfere("VLO", "00000000")).toBe(false);
    expect(seloConfere("VLO", "")).toBe(false);
  });
});
