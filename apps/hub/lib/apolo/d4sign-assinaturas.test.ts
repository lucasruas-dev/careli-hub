import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  AVISOS_DA_FONTE,
  avisoDoQuadro,
  conciliarDocumento,
  dataCurtaDaAssinatura,
  reconciliarAssinaturasComD4Sign,
  type ResumoDaReconciliacao,
} from "./d4sign-assinaturas";
import { limparDivergencias, lerDivergencias } from "./d4sign-divergencias";
import type { LinhaAssinatura } from "./painel-assinatura";
import {
  limparCacheD4Sign,
  type ConsultaD4Sign,
  type DocumentoD4Sign,
  type SignatarioD4Sign,
} from "@/lib/guardian/d4sign-consulta";

// As fixturas seguem a forma REAL da sondagem de 18/08/2026: `statusId` 4/6/3/2 como na D4Sign,
// `date_signed_atom` com fuso, e-mail em minúsculas, `key_signer` opaco. Pessoas são fictícias.
function documento(parcial: Partial<DocumentoD4Sign> = {}): DocumentoD4Sign {
  return {
    canceladoPor: null,
    cofre: "f1911d72-516e-429c-a0c9-fe00d670984d",
    nome: "VISTA ALEGRE-0101-CONTRATO.pdf",
    paginas: 27,
    situacao: "finalizado",
    statusId: 4,
    statusName: "Finalizado",
    uuidDoc: "5b797156-c96f-4699-9415-733bfbfe2648",
    ...parcial,
  };
}

function signatario(parcial: Partial<SignatarioD4Sign> = {}): SignatarioD4Sign {
  return {
    assinadoEm: "2024-05-27T15:48:06-03:00",
    assinou: true,
    chave: "KEY-1",
    convidadoEm: "2024-05-27 09:12:31",
    documento: "12345678901",
    email: "comprador@exemplo.com.br",
    entregaDoEmail: "Delivery",
    nome: "José da Silva",
    papel: "Assinar como parte",
    ...parcial,
  };
}

function linha(parcial: Partial<LinhaAssinatura> = {}): LinhaAssinatura {
  return {
    assinadoEm: null,
    assinou: false,
    contrato: 900,
    degrau: 1,
    diasDesdeEnvio: 30,
    email: "comprador@exemplo.com.br",
    emp: "VAL",
    envio: "2024-05-27",
    lote: "1",
    perfil: "Comprador",
    prazo: null,
    quadra: "A",
    situacao: "aguardando",
    un: "VALA1",
    usuario: "José da Silva",
    valor: 100000,
    ...parcial,
  };
}

const ok = (signatarios: SignatarioD4Sign[], doc = documento()): ConsultaD4Sign => ({
  documento: doc,
  ok: true,
  signatarios,
});

describe("dataCurtaDaAssinatura", () => {
  it("usa o dia escrito no atom, sem passar por UTC", () => {
    // O caso que o `new Date()` estragaria: assinatura às 21h no fuso -03:00 vira o dia SEGUINTE
    // em UTC. O dia certo é o que a D4Sign escreveu.
    expect(dataCurtaDaAssinatura("2024-05-27T21:48:06-03:00")).toBe("2024-05-27");
    expect(dataCurtaDaAssinatura("2024-05-27T15:48:06-03:00")).toBe("2024-05-27");
  });

  it("nulo quando não assinou ou quando o formato não é o esperado", () => {
    expect(dataCurtaDaAssinatura(null)).toBeNull();
    expect(dataCurtaDaAssinatura("27/05/2024")).toBeNull();
  });
});

describe("conciliarDocumento — a D4Sign manda no status", () => {
  it("corrige a assinatura que o C2X não registrou (o buraco do webhook)", () => {
    const resultado = conciliarDocumento({
      consulta: ok([signatario()]),
      csId: 900,
      linhas: [linha()],
      statusC2x: 7,
      uuidDoc: "5b797156",
    });

    expect(resultado.fonte).toBe("d4sign");
    expect(resultado.aviso).toBeNull();
    expect(resultado.linhas[0]?.assinou).toBe(true);
    expect(resultado.linhas[0]?.assinadoEm).toBe("2024-05-27");
    expect(resultado.divergencias.map((d) => d.tipo).sort()).toEqual([
      "assinatura-nao-registrada",
      "status-do-documento",
    ]);
  });

  it("a divergência registrada não carrega nome, e-mail nem CPF", () => {
    const resultado = conciliarDocumento({
      consulta: ok([signatario()]),
      csId: 900,
      linhas: [linha()],
      statusC2x: 7,
      uuidDoc: "5b797156",
    });

    const serializado = JSON.stringify(resultado.divergencias);
    expect(serializado).not.toContain("José");
    expect(serializado).not.toContain("comprador@exemplo.com.br");
    expect(serializado).not.toContain("12345678901");
    // O que sobra é o suficiente para achar a linha no banco.
    expect(serializado).toContain("900");
    expect(serializado).toContain("KEY-1");
  });

  it("derruba a assinatura fantasma: o C2X diz que assinou e a D4Sign diz que não", () => {
    const resultado = conciliarDocumento({
      consulta: ok([signatario({ assinadoEm: null, assinou: false })]),
      csId: 900,
      linhas: [linha({ assinadoEm: "2024-05-20", assinou: true })],
      uuidDoc: "5b797156",
    });

    expect(resultado.linhas[0]?.assinou).toBe(false);
    expect(resultado.linhas[0]?.assinadoEm).toBeNull();
    expect(resultado.divergencias[0]?.tipo).toBe("assinatura-fantasma");
  });

  it("zera situação e prazo para a fila e a régua serem recalculadas sobre o dado corrigido", () => {
    const resultado = conciliarDocumento({
      consulta: ok([signatario()]),
      csId: 900,
      linhas: [linha({ prazo: "Pendente e em atraso", situacao: "vez" })],
      uuidDoc: "5b797156",
    });

    expect(resultado.linhas[0]?.prazo).toBeNull();
    expect(resultado.linhas[0]?.situacao).toBe("aguardando");
  });

  it("registra a data divergente quando os dois dizem que assinou em dias diferentes", () => {
    const resultado = conciliarDocumento({
      consulta: ok([signatario()]),
      csId: 900,
      linhas: [linha({ assinadoEm: "2024-05-30", assinou: true })],
      uuidDoc: "5b797156",
    });

    expect(resultado.divergencias[0]?.tipo).toBe("data-divergente");
    // A da D4Sign é a que fica.
    expect(resultado.linhas[0]?.assinadoEm).toBe("2024-05-27");
  });

  it("'Em aberto' (7) com a D4Sign ainda aguardando NÃO é divergência de status", () => {
    // Senão o contador vira ruído: são 1.470 linhas em aberto, e a maioria está mesmo andando.
    const resultado = conciliarDocumento({
      consulta: ok([signatario({ assinadoEm: null, assinou: false })], documento({
        situacao: "aguardando-assinaturas",
        statusId: 3,
        statusName: "Aguardando Assinaturas",
      })),
      csId: 900,
      linhas: [linha()],
      statusC2x: 7,
      uuidDoc: "5b797156",
    });

    expect(resultado.divergencias).toEqual([]);
  });

  it("acusa o cancelamento que o C2X não soube", () => {
    const resultado = conciliarDocumento({
      consulta: ok([], documento({ situacao: "cancelado", statusId: 6, statusName: "Cancelado" })),
      csId: 900,
      linhas: [],
      statusC2x: 3,
      uuidDoc: "5b797156",
    });

    expect(resultado.situacao).toBe("cancelado");
    expect(resultado.divergencias[0]?.tipo).toBe("status-do-documento");
    expect(resultado.divergencias[0]?.c2x).toBe("Aguardando assinaturas (3)");
  });

  it("documento cancelado é MARCADO como cancelado, não devolvido como pendência viva", () => {
    // O caso do acervo: 1.161 cancelados, e o que chega até aqui é o que está com o status 7
    // furado no C2X — o filtro `contract_signature_status_id <> 6` não o pega. Sem a marca, as
    // linhas voltariam iguais às de um contrato vivo esperando assinatura.
    const resultado = conciliarDocumento({
      consulta: ok(
        [signatario({ assinadoEm: null, assinou: false })],
        documento({ situacao: "cancelado", statusId: 6, statusName: "Cancelado" }),
      ),
      csId: 900,
      linhas: [linha()],
      statusC2x: 7,
      uuidDoc: "5b797156",
    });

    expect(resultado.cancelado).toBe(true);
    expect(resultado.fonte).toBe("d4sign");
    expect(resultado.aviso).toBe(AVISOS_DA_FONTE.cancelado);
    // As linhas ficam intactas: quem quiser mostrar o histórico do contrato morto tem o que mostrar.
    expect(resultado.linhas).toHaveLength(1);
    // E não há enxurrada de divergência de signatário em documento morto: só o status.
    expect(resultado.divergencias.map((d) => d.tipo)).toEqual(["status-do-documento"]);
  });

  it("documento vivo não é marcado como cancelado", () => {
    const resultado = conciliarDocumento({
      consulta: ok([signatario()]),
      csId: 900,
      linhas: [linha()],
      uuidDoc: "5b797156",
    });

    expect(resultado.cancelado).toBe(false);
  });
});

describe("conciliarDocumento — casamento dos assinantes", () => {
  it("casa por e-mail mesmo com caixa e espaço diferentes no nome", () => {
    const resultado = conciliarDocumento({
      consulta: ok([signatario({ nome: "JOSE  DA  SILVA" })]),
      csId: 900,
      linhas: [linha({ usuario: "José da Silva" })],
      uuidDoc: "5b797156",
    });

    expect(resultado.linhas).toHaveLength(1);
    expect(resultado.linhas[0]?.assinou).toBe(true);
  });

  it("casa por nome sem acento quando o C2X está sem e-mail", () => {
    const resultado = conciliarDocumento({
      consulta: ok([signatario({ nome: "JOSÉ DA SILVA" })]),
      csId: 900,
      linhas: [linha({ email: "", usuario: "Jose da Silva" })],
      uuidDoc: "5b797156",
    });

    expect(resultado.linhas).toHaveLength(1);
    expect(resultado.linhas[0]?.assinou).toBe(true);
    // Casou: NÃO há divergência de casamento. A que sobra é a de conteúdo (a assinatura que o C2X
    // não registrou), que é justamente o que a troca de fonte existe para achar.
    expect(resultado.divergencias.map((d) => d.tipo)).toEqual(["assinatura-nao-registrada"]);
  });

  it("pareia por posição quando sobra exatamente um de cada lado, e REGISTRA o palpite", () => {
    const resultado = conciliarDocumento({
      consulta: ok([
        signatario({ chave: "K1" }),
        signatario({ chave: "K2", email: "outro@exemplo.com", nome: "Maria Testemunha" }),
      ]),
      csId: 900,
      linhas: [
        linha({ degrau: 1 }),
        linha({ degrau: 2, email: "", perfil: "Testemunha", usuario: "M. TESTEMUNHA" }),
      ],
      uuidDoc: "5b797156",
    });

    expect(resultado.linhas).toHaveLength(2);
    // O perfil e o degrau continuam vindo do C2X: a D4Sign não sabe nem um nem outro.
    expect(resultado.linhas[1]?.perfil).toBe("Testemunha");
    expect(resultado.linhas[1]?.degrau).toBe(2);
    expect(resultado.linhas[1]?.assinou).toBe(true);
    // O casamento adivinhado é CONTÁVEL: ele sobrescreve `assinou`, e errar em silêncio seria
    // dizer "Fulano assinou" sobre quem não assinou.
    const palpite = resultado.divergencias.find((d) => d.tipo === "pareado-por-posicao");
    expect(palpite?.degrau).toBe(2);
    expect(palpite?.referencia).toBe("K2");
  });

  it("NÃO adivinha por índice quando sobra mais de um de cada lado", () => {
    // As duas ordens não são a mesma: o C2X vem por `after_position, ss.id` e a D4Sign vem na
    // ordem do convite, sem campo de ordem nenhum. Com dois sobrando de cada lado, parear por
    // índice é chute — e chute que sobrescreve `assinou`.
    const resultado = conciliarDocumento({
      consulta: ok([
        signatario({ assinadoEm: null, assinou: false, chave: "K1", email: "a@x.com", nome: "Alfa" }),
        signatario({ chave: "K2", email: "b@x.com", nome: "Beta" }),
      ]),
      csId: 900,
      linhas: [
        linha({ degrau: 1, email: "", usuario: "Primeiro do C2X" }),
        linha({ degrau: 2, email: "", usuario: "Segundo do C2X" }),
      ],
      uuidDoc: "5b797156",
    });

    // Ninguém foi adivinhado: as duas linhas do C2X seguem com o dado do C2X (as duas que vêm
    // depois são os assinantes que só a D4Sign conhece, virando linha nova).
    expect(resultado.linhas.slice(0, 2).map((l) => l.assinou)).toEqual([false, false]);
    expect(resultado.linhas.slice(0, 2).map((l) => l.usuario)).toEqual([
      "Primeiro do C2X",
      "Segundo do C2X",
    ]);
    expect(resultado.divergencias.filter((d) => d.tipo === "pareado-por-posicao")).toHaveLength(0);
    // E os dois lados viram divergência, que é o "a gente não sabe" ficando visível.
    expect(resultado.divergencias.filter((d) => d.tipo === "signatario-so-no-c2x")).toHaveLength(2);
    expect(resultado.divergencias.filter((d) => d.tipo === "signatario-so-no-d4sign")).toHaveLength(2);
  });

  it("assinante só na D4Sign vira linha nova, no ÚLTIMO degrau, sem virar dono da fila", () => {
    const resultado = conciliarDocumento({
      consulta: ok([
        signatario({ chave: "K1" }),
        signatario({ assinadoEm: null, assinou: false, chave: "K2", email: "novo@exemplo.com", nome: "Novo Assinante" }),
        signatario({ assinadoEm: null, assinou: false, chave: "K3", email: "outro@exemplo.com", nome: "Outro Assinante" }),
      ]),
      csId: 900,
      linhas: [linha({ degrau: 3 })],
      uuidDoc: "5b797156",
    });

    expect(resultado.linhas).toHaveLength(3);
    expect(resultado.linhas[1]?.degrau).toBe(3);
    expect(resultado.linhas[1]?.usuario).toBe("Novo Assinante");
    expect(resultado.linhas[1]?.emp).toBe("VAL");
    expect(resultado.divergencias.filter((d) => d.tipo === "signatario-so-no-d4sign")).toHaveLength(2);
  });

  it("assinante só na D4Sign usa perfilDeTela — e-mail da Careli vira Backoffice", () => {
    const resultado = conciliarDocumento({
      consulta: ok([
        signatario({ chave: "K1" }),
        signatario({ assinadoEm: null, assinou: false, chave: "K2", email: "nivea@careli.adm.br", nome: "Nivea" }),
        signatario({ assinadoEm: null, assinou: false, chave: "K3", email: "x@exemplo.com", nome: "Xis" }),
      ]),
      csId: 900,
      linhas: [linha()],
      uuidDoc: "5b797156",
    });

    expect(resultado.linhas[1]?.perfil).toBe("Backoffice");
    expect(resultado.linhas[2]?.perfil).toBe("Sem perfil");
  });

  it("sem molde, o assinante só da D4Sign é registrado mas não vira linha órfã de unidade", () => {
    const resultado = conciliarDocumento({
      consulta: ok([signatario(), signatario({ chave: "K2", email: "b@x.com", nome: "Beta" })]),
      csId: 900,
      linhas: [],
      uuidDoc: "5b797156",
    });

    expect(resultado.linhas).toEqual([]);
    expect(resultado.divergencias.filter((d) => d.tipo === "signatario-so-no-d4sign")).toHaveLength(2);
  });

  it("com molde, o envio sem nenhum assinante no C2X ganha as linhas da D4Sign", () => {
    const resultado = conciliarDocumento({
      consulta: ok([signatario()]),
      csId: 900,
      linhas: [],
      molde: {
        contrato: 900,
        diasDesdeEnvio: 30,
        emp: "VAL",
        envio: "2024-05-27",
        lote: "1",
        quadra: "A",
        un: "VALA1",
        valor: 100000,
      },
      uuidDoc: "5b797156",
    });

    expect(resultado.linhas).toHaveLength(1);
    expect(resultado.linhas[0]?.un).toBe("VALA1");
    expect(resultado.linhas[0]?.assinou).toBe(true);
  });

  it("assinante que só o C2X conhece fica na tela com o dado dele, e vira divergência", () => {
    const resultado = conciliarDocumento({
      consulta: ok([signatario()]),
      csId: 900,
      linhas: [
        linha(),
        linha({ assinou: true, degrau: 2, email: "so-no-c2x@exemplo.com", usuario: "Só no C2X" }),
        linha({ degrau: 3, email: "outro-so-no-c2x@exemplo.com", usuario: "Outro só no C2X" }),
      ],
      uuidDoc: "5b797156",
    });

    // Some ninguém: tirar a linha seria trocar dado velho por nenhum dado.
    expect(resultado.linhas).toHaveLength(3);
    expect(resultado.linhas[1]?.assinou).toBe(true);
    expect(resultado.divergencias.filter((d) => d.tipo === "signatario-so-no-c2x")).toHaveLength(2);
  });
});

describe("fallback honesto", () => {
  it("D4Sign fora do ar: mantém as linhas do C2X e devolve o aviso", () => {
    const original = [linha()];
    const resultado = conciliarDocumento({
      consulta: { motivo: "indisponivel", ok: false },
      csId: 900,
      linhas: original,
      uuidDoc: "5b797156",
    });

    expect(resultado.fonte).toBe("c2x-legado");
    expect(resultado.linhas).toEqual(original);
    expect(resultado.aviso).toBe(AVISOS_DA_FONTE.indisponivel);
    expect(resultado.situacao).toBeNull();
    // Indisponibilidade não é discordância: ninguém discordou de ninguém.
    expect(resultado.divergencias).toEqual([]);
  });

  it("credencial ausente tem aviso próprio: o problema é de configuração, não da D4Sign", () => {
    const resultado = conciliarDocumento({
      consulta: { motivo: "credencial-ausente", ok: false },
      csId: 900,
      linhas: [linha()],
      uuidDoc: "5b797156",
    });

    expect(resultado.aviso).toBe(AVISOS_DA_FONTE.credencialAusente);
    expect(resultado.fonte).toBe("c2x-legado");
  });

  it("uuid que a D4Sign não conhece: cai no legado E registra divergência", () => {
    const resultado = conciliarDocumento({
      consulta: { motivo: "documento-desconhecido", ok: false },
      csId: 900,
      linhas: [linha()],
      statusC2x: 7,
      uuidDoc: "fantasma",
    });

    expect(resultado.aviso).toBe(AVISOS_DA_FONTE.documentoAusente);
    expect(resultado.divergencias[0]?.tipo).toBe("documento-ausente-no-d4sign");
    expect(resultado.divergencias[0]?.c2x).toBe("Em aberto (7)");
  });

  it("envio sem uuid nenhum não vira erro: é contrato que nunca saiu para assinar", () => {
    const resultado = conciliarDocumento({
      consulta: { motivo: "indisponivel", ok: false },
      csId: 900,
      linhas: [linha()],
      uuidDoc: null,
    });

    expect(resultado.aviso).toBe(AVISOS_DA_FONTE.semDocumento);
    expect(resultado.divergencias).toEqual([]);
  });

  it("o aviso do quadro só grita quando TUDO QUE FOI TENTADO caiu", () => {
    const resumo = (parcial: Partial<ResumoDaReconciliacao>): ResumoDaReconciliacao => ({
      assinaturasCorrigidas: 0,
      cancelados: 0,
      confirmados: 0,
      emFallback: 0,
      envios: 0,
      semDocumento: 0,
      somenteStatus: 0,
      ...parcial,
    });

    expect(avisoDoQuadro(resumo({ confirmados: 10, envios: 10 }))).toBeNull();
    expect(avisoDoQuadro(resumo({ emFallback: 3, envios: 3 }))).toBe(AVISOS_DA_FONTE.indisponivel);
    expect(avisoDoQuadro(resumo({ confirmados: 9, emFallback: 1, envios: 10 }))).toContain("1 de 10");
  });

  it("recorte só de contratos sem documento NÃO acende o banner de indisponibilidade", () => {
    // Nenhuma chamada foi feita: não houve queda nenhuma para avisar. Banner que vive aceso não é
    // acreditado no dia em que a D4Sign cair de verdade.
    const so = { assinaturasCorrigidas: 0, cancelados: 0, confirmados: 0, emFallback: 0, envios: 7, semDocumento: 7, somenteStatus: 0 };
    expect(avisoDoQuadro(so)).toBeNull();
  });
});

describe("reconciliarAssinaturasComD4Sign", () => {
  const fetchOriginal = globalThis.fetch;

  beforeEach(() => {
    limparCacheD4Sign();
    limparDivergencias();
    process.env.D4SIGN_TOKEN_API = "token-de-teste";
    process.env.D4SIGN_CRYPT_KEY = "chave-de-teste";
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    globalThis.fetch = fetchOriginal;
    limparCacheD4Sign();
    limparDivergencias();
    vi.restoreAllMocks();
  });

  it("uma chamada por documento, e o dado corrigido volta na mesma forma que entrou", async () => {
    const espiao = vi.fn(async () => ({
      json: async () => [
        {
          list: [
            {
              email: "comprador@exemplo.com.br",
              key_signer: "KEY-1",
              nomenclatura: "Assinar como parte",
              sign_info: { date_signed_atom: "2024-05-27T15:48:06-03:00" },
              signed: "1",
              user_document: "12345678901",
              user_name: "José da Silva",
            },
          ],
          statusId: "4",
          statusName: "Finalizado",
          uuidDoc: "doc-a",
        },
      ],
      ok: true,
      status: 200,
    }));
    globalThis.fetch = espiao as unknown as typeof fetch;

    const resultado = await reconciliarAssinaturasComD4Sign(
      [linha({ contrato: 900 })],
      [{ csId: 900, statusC2x: 7, uuidDoc: "doc-a" }],
    );

    expect(espiao).toHaveBeenCalledTimes(1);
    expect(resultado.linhas[0]?.assinou).toBe(true);
    expect(resultado.fontePorEnvio.get(900)).toBe("d4sign");
    expect(resultado.situacaoPorEnvio.get(900)).toBe("finalizado");
    expect(resultado.resumo).toEqual({
      assinaturasCorrigidas: 1,
      cancelados: 0,
      confirmados: 1,
      emFallback: 0,
      envios: 1,
      semDocumento: 0,
      // `somenteStatus` conta o envio cujo status veio da listagem em lote sem o detalhe por
      // assinante (o caminho barato). Aqui a conciliação foi completa, então é zero.
      somenteStatus: 0,
    });
    expect(resultado.aviso).toBeNull();
    // A divergência ficou registrada para o time cobrar o webhook.
    expect(lerDivergencias().porTipo["assinatura-nao-registrada"]).toBe(1);
  });

  it("com a D4Sign fora, nada quebra: linhas do C2X, fonte marcada e aviso no quadro", async () => {
    globalThis.fetch = (async () => {
      throw new Error("fora do ar");
    }) as unknown as typeof fetch;

    const resultado = await reconciliarAssinaturasComD4Sign(
      [linha({ contrato: 900 }), linha({ contrato: 901 })],
      [
        { csId: 900, uuidDoc: "doc-a" },
        { csId: 901, uuidDoc: "doc-b" },
      ],
    );

    expect(resultado.linhas).toHaveLength(2);
    expect(resultado.fontePorEnvio.get(900)).toBe("c2x-legado");
    expect(resultado.avisoPorEnvio.get(901)).toBe(AVISOS_DA_FONTE.indisponivel);
    expect(resultado.aviso).toBe(AVISOS_DA_FONTE.indisponivel);
    expect(resultado.resumo.emFallback).toBe(2);
  });

  it("linha de envio que ninguém pediu para conciliar não desaparece", async () => {
    globalThis.fetch = (async () => {
      throw new Error("fora do ar");
    }) as unknown as typeof fetch;

    const resultado = await reconciliarAssinaturasComD4Sign(
      [linha({ contrato: 900 }), linha({ contrato: 999 })],
      [{ csId: 900, uuidDoc: "doc-a" }],
    );

    expect(resultado.linhas.map((l) => l.contrato).sort()).toEqual([900, 999]);
  });

  it("envio SEM documento não conta como queda do D4Sign, e nem chama a D4Sign", async () => {
    const espiao = vi.fn(async () => {
      throw new Error("não era para tocar na rede");
    });
    globalThis.fetch = espiao as unknown as typeof fetch;

    const resultado = await reconciliarAssinaturasComD4Sign(
      [linha({ contrato: 900 })],
      [{ csId: 900, uuidDoc: null }],
    );

    expect(espiao).not.toHaveBeenCalled();
    expect(resultado.resumo.semDocumento).toBe(1);
    expect(resultado.resumo.emFallback).toBe(0);
    // O banner do quadro fica APAGADO: não houve queda nenhuma para avisar.
    expect(resultado.aviso).toBeNull();
    // O aviso certo continua na linha.
    expect(resultado.avisoPorEnvio.get(900)).toBe(AVISOS_DA_FONTE.semDocumento);
  });

  it("documento cancelado sai das linhas e vai para o balde de cancelados", async () => {
    globalThis.fetch = (async () => ({
      json: async () => [
        { list: [], statusId: "6", statusName: "Cancelado", uuidDoc: "doc-morto" },
      ],
      ok: true,
      status: 200,
    })) as unknown as typeof fetch;

    const resultado = await reconciliarAssinaturasComD4Sign(
      [linha({ contrato: 900 }), linha({ contrato: 901 })],
      [
        { csId: 900, statusC2x: 7, uuidDoc: "doc-morto" },
        { csId: 901, uuidDoc: null },
      ],
    );

    expect(resultado.enviosCancelados.has(900)).toBe(true);
    expect(resultado.linhas.map((l) => l.contrato)).toEqual([901]);
    expect(resultado.linhasCanceladas.map((l) => l.contrato)).toEqual([900]);
    expect(resultado.resumo.cancelados).toBe(1);
    // A D4Sign respondeu: isto é confirmação, não fallback.
    expect(resultado.resumo.confirmados).toBe(1);
    expect(resultado.resumo.emFallback).toBe(0);
    // E o time fica sabendo que o C2X não soube do cancelamento.
    expect(lerDivergencias().porTipo["status-do-documento"]).toBe(1);
  });
});
