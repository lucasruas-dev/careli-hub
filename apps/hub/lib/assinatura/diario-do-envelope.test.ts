import { describe, expect, it } from "vitest";

import { diarioDoEnvelope, quemAssinou } from "./diario-do-envelope";

import payloadReal from "./__fixtures__/clicksign-sign-com-bounce.json";

// O CASO QUE DEU ORIGEM A ESTE ARQUIVO, PRESO NUM TESTE.
//
// A fixture é o payload REAL do envelope 3e9a331d-ec2f-4eb5-9ae1-aafbeae8b395, medido em produção em
// 12/09/2026 e ANONIMIZADO (nomes, e-mails, IP, coordenadas, chaves e a URL assinada da S3 trocados
// por valores fictícios; a ESTRUTURA e os nomes de campo estão intactos — dado de cliente não entra
// no repo).
//
// O que aconteceu: o contrato foi para dois signatários, a compradora assinou, e a tela disse só
// "Parcialmente assinado". O convite do segundo NUNCA CHEGOU — bounce por e-mail inexistente, quatro
// segundos depois do envio, dentro de `document.events[]`. Se algum dia este teste passar a falhar
// porque "o bounce não aparece", é o defeito original voltando.

const CHAVE_QUEM_ASSINOU = "22222222-aaaa-4bbb-8ccc-000000000002";
const CHAVE_DO_BOUNCE = "33333333-aaaa-4bbb-8ccc-000000000003";

describe("quemAssinou, no payload real", () => {
  it("acha os dois signatários e casa cada um pela `signer.key`", () => {
    const pessoas = quemAssinou(payloadReal);

    expect(pessoas).toHaveLength(2);
    expect(pessoas.map((p) => p.chave).sort()).toEqual([CHAVE_QUEM_ASSINOU, CHAVE_DO_BOUNCE].sort());
  });

  it("quem assinou tem a hora da assinatura e a hora em que abriu", () => {
    const assinante = quemAssinou(payloadReal).find((p) => p.chave === CHAVE_QUEM_ASSINOU);

    expect(assinante?.nome).toBe("Mariana Torres Bandeira");
    expect(assinante?.assinouEm).toBe("2026-09-12T02:24:44.972Z");
    expect(assinante?.comecouEm).toBe("2026-09-12T02:24:26.803Z");
  });

  it("⚠️ quem assinou fica em `sem_noticia`, NUNCA em `entregue`", () => {
    // A Clicksign só avisa quando algo dá errado. Ela nunca disse que o convite da compradora
    // chegou — o que sabemos é que ela ASSINOU, que é outra informação. Dizer "entregue" aqui seria
    // afirmar, na tela de um contrato, uma coisa que ninguém disse.
    const assinante = quemAssinou(payloadReal).find((p) => p.chave === CHAVE_QUEM_ASSINOU);

    expect(assinante?.convite).toBe("sem_noticia");
    expect(assinante?.conviteDetalhe).toBeNull();
    expect(assinante?.conviteQuando).toBeNull();
  });

  it("o segundo signatário sai como `nao_entregue`, com o motivo em português e a hora", () => {
    // ESTA é a resposta à pergunta do Lucas ("por que não está pegando as assinaturas?"): ele não
    // recebeu o convite. Sem esta linha, a operação cobra para sempre uma assinatura impossível.
    const semConvite = quemAssinou(payloadReal).find((p) => p.chave === CHAVE_DO_BOUNCE);

    expect(semConvite?.nome).toBe("Otávio Peixoto Lima");
    expect(semConvite?.assinouEm).toBeNull();
    expect(semConvite?.comecouEm).toBeNull();
    expect(semConvite?.convite).toBe("nao_entregue");
    expect(semConvite?.conviteDetalhe).toContain("E-mail inexistente");
    expect(semConvite?.conviteQuando).toBe("2026-09-12T02:24:00.891Z");
  });

  it("o card consegue montar o \"1/2\" a partir daqui", () => {
    const pessoas = quemAssinou(payloadReal);

    expect(pessoas.filter((p) => p.assinouEm !== null)).toHaveLength(1);
    expect(pessoas).toHaveLength(2);
  });
});

describe("diarioDoEnvelope, no payload real", () => {
  it("conta a história inteira, do mais recente para o mais antigo", () => {
    const diario = diarioDoEnvelope(payloadReal);

    expect(diario.map((f) => f.fato)).toEqual([
      "Mariana Torres Bandeira assinou",
      "Mariana Torres Bandeira abriu para assinar",
      "Convite NÃO entregue para Otávio Peixoto Lima",
      "Mariana Torres Bandeira entrou como signatário",
      "Otávio Peixoto Lima entrou como signatário",
      "Contrato enviado para a Clicksign",
    ]);
  });

  it("⚠️ ordena por DATA, e o empate de milésimos não embaralha os dois `add_signer`", () => {
    // Os dois `add_signer` do envio real estão a 6 MILÉSIMOS um do outro (02:23:58.634 e .628), e o
    // `event` da raiz chega em `-03:00` enquanto os de `document.events[]` chegam em `Z`. Ordenar
    // como texto misturaria a linha do tempo de um contrato.
    const quandos = diarioDoEnvelope(payloadReal).map((f) => Date.parse(f.quando));

    for (let i = 1; i < quandos.length; i += 1) {
      expect(quandos[i - 1]).toBeGreaterThanOrEqual(quandos[i] ?? 0);
    }
  });

  it("o convite não entregue é o único `erro`, e traz o motivo no detalhe", () => {
    const diario = diarioDoEnvelope(payloadReal);
    const erros = diario.filter((f) => f.gravidade === "erro");

    expect(erros).toHaveLength(1);
    expect(erros[0]?.fato).toBe("Convite NÃO entregue para Otávio Peixoto Lima");
    expect(erros[0]?.quem).toBe("Otávio Peixoto Lima");
    expect(erros[0]?.detalhe).toContain("E-mail inexistente");
  });

  it("a assinatura é um marco; abrir o documento e o envio são normais", () => {
    const porFato = new Map(diarioDoEnvelope(payloadReal).map((f) => [f.fato, f.gravidade]));

    expect(porFato.get("Mariana Torres Bandeira assinou")).toBe("marco");
    expect(porFato.get("Mariana Torres Bandeira abriu para assinar")).toBe("normal");
    expect(porFato.get("Contrato enviado para a Clicksign")).toBe("normal");
  });

  it("⚠️ o `event` da raiz NÃO vira uma linha a mais", () => {
    // O evento que disparou o webhook é o mesmo do `events[0]` (o `sign`, 23:24:44.972-03:00 lá e
    // 02:24:44.972Z aqui). Somar os dois duplicaria a última linha de todo diário.
    const assinaturas = diarioDoEnvelope(payloadReal).filter((f) => f.fato.endsWith("assinou"));

    expect(assinaturas).toHaveLength(1);
  });
});

describe("⚠️ evento que não conhecemos não some", () => {
  // Sumir com ele faria o diário mentir por omissão justamente no dia em que a Clicksign criasse um
  // evento novo — e este é o diário de um CONTRATO.
  const comEventoNovo = comEventosExtras([
    {
      data: { signer: { key: CHAVE_DO_BOUNCE, name: "Otávio Peixoto Lima" } },
      name: "aceite_por_carta_pombo_correio",
      occurred_at: "2026-09-12T03:00:00.000Z",
    },
  ]);

  it("sai com o nome cru e gravidade normal", () => {
    const diario = diarioDoEnvelope(comEventoNovo);

    expect(diario[0]?.fato).toBe("aceite_por_carta_pombo_correio");
    expect(diario[0]?.gravidade).toBe("normal");
    expect(diario[0]?.quem).toBe("Otávio Peixoto Lima");
  });

  it("e não come nenhuma das linhas que já existiam", () => {
    expect(diarioDoEnvelope(comEventoNovo)).toHaveLength(
      diarioDoEnvelope(payloadReal).length + 1,
    );
  });

  it("falha de autenticação do signatário sai como erro, reusando o catálogo de `traduzir.ts`", () => {
    // `facematch_refused` não está no `switch` das frases; quem o reconhece é
    // `ehFalhaDeAutenticacao`, que já é a lista da casa. Um segundo dicionário aqui divergiria.
    const diario = diarioDoEnvelope(
      comEventosExtras([
        {
          data: { signer: { key: CHAVE_DO_BOUNCE, name: "Otávio Peixoto Lima" } },
          name: "facematch_refused",
          occurred_at: "2026-09-12T03:10:00.000Z",
        },
      ]),
    );

    expect(diario[0]?.fato).toBe("Otávio Peixoto Lima não passou na autenticação");
    expect(diario[0]?.gravidade).toBe("erro");
  });
});

describe("⚠️ payload torto devolve vazio, e nunca lança", () => {
  // Isto é enfeite de tela. Derrubar a etapa do contrato porque um webhook veio num formato novo
  // seria trocar uma informação a mais por uma tela a menos.
  const tortos: Array<[string, unknown]> = [
    ["nulo", null],
    ["indefinido", undefined],
    ["texto", "não sou um payload"],
    ["número", 42],
    ["objeto vazio", {}],
    ["sem `document`", { event: { name: "sign" } }],
    ["`document` que não é objeto", { document: "a5fa6721" }],
    ["sem `events`", { document: { key: "a5fa6721", signers: [] } }],
    ["`events` que não é array", { document: { events: { name: "sign" } } }],
    ["`events` com lixo dentro", { document: { events: [null, 7, "sign", []] } }],
  ];

  for (const [caso, payload] of tortos) {
    it(`${caso}: diário vazio`, () => {
      expect(() => diarioDoEnvelope(payload)).not.toThrow();
      expect(diarioDoEnvelope(payload)).toEqual([]);
    });

    it(`${caso}: nenhum signatário`, () => {
      expect(() => quemAssinou(payload)).not.toThrow();
      expect(quemAssinou(payload)).toEqual([]);
    });
  }

  it("evento sem `occurred_at` não some do diário: fica sem data, no fim da lista", () => {
    // Apagar o fato porque a data veio ilegível seria esconder exatamente o evento mais estranho.
    const diario = diarioDoEnvelope({
      document: { events: [{ data: {}, name: "cancel" }], signers: [] },
    });

    expect(diario).toHaveLength(1);
    expect(diario[0]?.fato).toBe("Envelope cancelado");
    expect(diario[0]?.gravidade).toBe("erro");
    expect(diario[0]?.quando).toBe("");
  });
});


// ── OS TRES CONSERTOS DOS REVISORES DA v1.320.0 ───────────────────────────────────────────────

describe("⚠️ o documento é lido nas TRÊS formas, e não só na raiz", () => {
  // O card do quadro já procurava em `raiz.document`, `data.document` e `event.document`; esta lib
  // olhava só a primeira. A Clicksign REENVIA o webhook que não recebeu 200, e todo POST grava linha
  // nova: bastava uma retentativa chegar noutra forma para o painel dizer "0 de 2 assinaram" ao
  // lado de um card dizendo "1/2". Duas telas, duas verdades, sobre o mesmo envelope.
  it("acha o documento dentro de `data`", () => {
    const embrulhado = { data: { document: payloadReal.document } };
    expect(quemAssinou(embrulhado)).toHaveLength(2);
    expect(diarioDoEnvelope(embrulhado).length).toBeGreaterThan(0);
  });

  it("acha o documento dentro de `event`", () => {
    const embrulhado = { event: { document: payloadReal.document } };
    expect(quemAssinou(embrulhado)).toHaveLength(2);
  });
});

describe("⚠️ quem está no envelope é `document.signers`, e não quem apareceu em evento", () => {
  // O Panteon corrige e-mail que quicou REMOVENDO o signatário e recriando com o endereço certo.
  // Depois disso os eventos citam três pessoas num envelope de duas: contar os eventos faria a tela
  // dizer "1 de 3 assinaram", com um fantasma cobrando um conserto já feito.
  const fantasma = {
    data: {
      signer: {
        email: "endereco.errado@exemplo.test",
        key: "ffffffff-0000-0000-0000-000000000000",
        name: "Otávio Peixoto Lima",
      },
    },
    name: "remove_signer",
    occurred_at: "2026-09-12T02:23:59.000Z",
  };

  it("o signatário removido não entra na lista nem no denominador", () => {
    const pessoas = quemAssinou(comEventosExtras([fantasma]));
    expect(pessoas).toHaveLength(2);
    expect(pessoas.map((p) => p.chave)).not.toContain("ffffffff-0000-0000-0000-000000000000");
  });

  it("mas o fato continua no diário: sumir com ele seria mentir por omissão", () => {
    const diario = diarioDoEnvelope(comEventosExtras([fantasma]));
    expect(diario.length).toBeGreaterThan(0);
  });

  it("sem lista oficial, quem apareceu nos eventos é tudo o que temos", () => {
    // O `upload` chega com `signers` VAZIO (medido em produção). Mostrar vazio seria pior.
    const semLista = { document: { ...payloadReal.document, signers: [] } };
    expect(quemAssinou(semLista).length).toBeGreaterThan(0);
  });
});

describe("⚠️ assinatura sem data não conta", () => {
  // `emIso` devolve "" quando o evento chega sem `occurred_at`. O contador olhava `!== null` e a
  // linha da tela olhava o valor: o cabeçalho dizia "1 de 2" e a lista mostrava DOIS não-assinantes,
  // sem ninguém conseguir dizer quem era o 1.
  it("`sign` sem `occurred_at` não vira assinatura contada", () => {
    const semData = {
      document: {
        ...payloadReal.document,
        events: [
          { data: { signer: payloadReal.document.signers[0] }, name: "sign" },
          ...payloadReal.document.events.filter(
            (e: { name?: string }) => e.name !== "sign",
          ),
        ],
      },
    };
    expect(quemAssinou(semData).filter((p) => p.assinouEm !== null)).toHaveLength(0);
  });
});

/** O payload real com eventos a mais, sem tocar na fixture. */
function comEventosExtras(extras: unknown[]): unknown {
  const documento = payloadReal.document;
  return {
    ...payloadReal,
    document: { ...documento, events: [...extras, ...documento.events] },
  };
}
