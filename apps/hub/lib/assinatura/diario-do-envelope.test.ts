import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";

import { juntarComOsCongelados, payloadMaisRecente } from "./diario-do-envelope-db";
import {
  diarioDoEnvelope,
  quemAssinou,
  recadastrosDepoisDoEnvio,
  type SignatarioDoEnvelope,
  vencimentoDoPayload,
} from "./diario-do-envelope";
import {
  RECUSA_DE_QUEM_NAO_ESTA_NO_QUADRO,
  RECUSA_DE_REENVIO_SEM_ID,
} from "./recusa-de-reenvio";

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

// ── A CHAVE QUE O REENVIO USA ───────────────────────────────────────────────
//
// ⚠️ CORREÇÃO DE 01/10/2026: A `signer.key` DO WEBHOOK É O SIGNER ID DA API v3. Este cabeçalho
// afirmava o contrário ("a `signer.key` do webhook NÃO é o signer id... o id que serve ali é o que a
// Clicksign devolveu no passo 3 do envio"), e a afirmação era dedução, não medição. Medido em
// produção em 01/10/2026 (só SELECT, projeto bxgukywoxgivlrhjkwjx), cruzando a `chave` congelada com
// `temis_assinatura_eventos.payload->document->signers[].key` por envelope e e-mail:
//
//   pares: 54 | identicas: 54 | diferentes: 0 | envelopes: 8
//
// E nos 18 envelopes VIVOS sem nenhuma `chave` congelada as 104 `signer.key` do payload têm forma de
// uuid e TODAS trazem e-mail. Lucas, no mesmo dia: *"Nao consigo reenviar os contratos."*
//
// ⚠️ O 422 DE 24/09/2026 ERA DO OUTRO CASO, E É ELE QUE SOBRA: quem só existe na lista congelada não
// tem `signer.key`, e `juntarComOsCongelados` põe o PRÓPRIO E-MAIL na `chave` da tela — e-mail nunca
// é id. Os motivos de bloqueio são TRÊS (envelope encerrado, chave que não é id, pessoa fora do
// quadro), cada um com a SUA frase: um booleano com uma frase só afirmava, no `fora_do_quadro`, o
// inverso do que acontecia.
describe("juntarComOsCongelados: quem pode ser reenviado", () => {
  const doPayload = (patch: Partial<SignatarioDoEnvelope> = {}): SignatarioDoEnvelope => ({
    assinouEm: null,
    chave: "key-do-webhook",
    comecouEm: null,
    convite: "sem_noticia",
    conviteDetalhe: null,
    conviteQuando: null,
    email: "comprador@exemplo.test",
    nome: "Iago Barbosa Ferreira Mesquita",
    ...patch,
  });

  it("a chave do signatário é a congelada no envio quando ela existe, e nunca o e-mail", () => {
    const juntos = juntarComOsCongelados(
      [doPayload()],
      [
        {
          chave: "sig-clicksign-1",
          email: "Comprador@Exemplo.test",
          nome: "Iago Barbosa Ferreira Mesquita",
          papel: "comprador",
        },
      ],
    );

    expect(juntos[0]?.chave).toBe("sig-clicksign-1");
    expect(juntos[0]?.reenvioIndisponivel).toBeNull();
  });

  // ⚠️ SEM CHAVE CONGELADA O BOTÃO VOLTOU A VALER (01/10/2026), PORQUE A `signer.key` DO WEBHOOK É O
  // ID. Medido em produção em 01/10/2026 (só SELECT, projeto bxgukywoxgivlrhjkwjx): a chave que o
  // envio congela e a `signer.key` do webhook são o MESMO valor em 54 de 54 pares (8 envelopes, zero
  // diferenças), e nos 18 envelopes vivos sem nenhuma chave congelada as 70 pessoas sem a marca de
  // assinatura no quadro TODAS
  // têm `signer.key` no payload. Com o botão desabilitado esses 18 (14 termos de acordo do Hades e 4
  // contratos da Têmis) não tinham caminho nenhum pelo Panteon. Lucas, no mesmo dia: *"Nao consigo
  // reenviar os contratos."*
  it("sem chave congelada, a key do webhook destrava o botão: ela É o id", () => {
    // É o caso medido do AC-000051 e dos 4 contratos de 23/09.
    const juntos = juntarComOsCongelados(
      [doPayload()],
      [{ chave: null, email: "comprador@exemplo.test", nome: "Iago", papel: "comprador" }],
    );

    expect(juntos[0]?.reenvioIndisponivel).toBeNull();
    expect(juntos[0]?.chave).toBe("key-do-webhook");
  });

  // ⚠️ QUEM NÃO ESTÁ NO NOSSO QUADRO FICA DESABILITADO, porque o servidor recusa esse pedido: sem a
  // linha congelada não se sabe se a pessoa já assinou, e a marca de assinatura mora no quadro. A
  // régua da tela é a MESMA do servidor de propósito — tela que oferece o gesto que o servidor
  // recusa é o que faz o operador clicar três vezes na mesma faixa vermelha.
  //
  // ⚠️ E A FRASE TEM DE SER A DESTE MOTIVO. Era `RECUSA_DE_REENVIO_SEM_ID` que aparecia aqui, e ela
  // afirma que a pessoa "só aparece na lista que o envio congelou, e a Clicksign ainda não avisou nada
  // sobre ela" — o INVERSO exato: aqui ela aparece no payload do webhook e NÃO está na lista
  // congelada. Prender só o booleano era o que deixava a frase errada passar.
  it("quem aparece só no payload, sem linha no quadro, fica indisponível, com a frase DESSE motivo", () => {
    const juntos = juntarComOsCongelados([doPayload()], []);

    expect(juntos[0]?.chave).toBe("key-do-webhook");
    expect(juntos[0]?.reenvioIndisponivel?.motivo).toBe("fora_do_quadro");
    expect(juntos[0]?.reenvioIndisponivel?.frase).toBe(RECUSA_DE_QUEM_NAO_ESTA_NO_QUADRO);
    expect(juntos[0]?.reenvioIndisponivel?.frase).not.toBe(RECUSA_DE_REENVIO_SEM_ID);
  });

  // ⚠️ SEM E-MAIL A LINHA NÃO CASA COM O QUADRO, e aí o botão continua desabilitado: o casamento
  // entre o payload e a lista congelada é por e-mail.
  it("sem chave E sem e-mail continua indisponível", () => {
    const juntos = juntarComOsCongelados(
      [doPayload({ chave: "key-do-webhook", email: "" })],
      [{ chave: null, email: "", nome: "Sem Endereço", papel: "comprador" }],
    );

    expect(juntos[0]?.reenvioIndisponivel?.motivo).toBe("fora_do_quadro");
  });

  // ⚠️ E-MAIL NÃO É SIGNER ID, E ESTE É O 422 DE 24/09/2026 QUE SOBRA. Quem só existe na lista
  // congelada não tem linha no payload, então a `chave` da tela é o PRÓPRIO E-MAIL — e
  // `POST /envelopes/{id}/signers/{signer_id}/notifications` devolve 422 para e-mail. Medido em
  // 01/10/2026 (só SELECT): das 55 chaves congeladas e das 160 `signer.key` dos envelopes da
  // Clicksign, ZERO têm "@". O botão fica desabilitado, e NÃO some.
  it("quem só existe na lista congelada, sem chave, fica indisponível: a chave é o e-mail", () => {
    const juntos = juntarComOsCongelados(
      [],
      [{ chave: null, email: "vendedora@exemplo.test", nome: "Fulana", papel: "vendedora" }],
    );

    expect(juntos[0]?.chave).toBe("vendedora@exemplo.test");
    expect(juntos[0]?.reenvioIndisponivel?.motivo).toBe("sem_id_na_clicksign");
    expect(juntos[0]?.reenvioIndisponivel?.frase).toBe(RECUSA_DE_REENVIO_SEM_ID);
  });

  // ⚠️ ENVELOPE ENCERRADO BLOQUEIA TODAS AS LINHAS, E ISSO ERA UMA REGRESSÃO DA TELA. `reenviarConvite`
  // passou a recusar envelope terminal com 409 e a régua da tela não olhava estado nenhum: nos
  // envelopes `cancelado` sem chave congelada, as linhas que antes vinham desabilitadas voltavam
  // HABILITADAS, porque a `signer.key` do payload passa a régua da chave. Medido em produção em
  // 01/10/2026 (só SELECT, projeto bxgukywoxgivlrhjkwjx): são 3 envelopes `cancelado` sem nenhuma
  // `chave` no quadro e, cruzando o payload conferido com o quadro por e-mail, 16 linhas com
  // `signer.key` em forma de uuid, com linha no quadro e `assinado_em` nulo — 16 botões habilitados
  // para dar faixa vermelha. A casa já escreveu a regra no painel do Hades: *"O BOTÃO QUE TENTA E
  // FALHA É PIOR DO QUE O BOTÃO DESABILITADO"*.
  it("envelope cancelado bloqueia o reenvio de QUEM TEM a key e linha no quadro", () => {
    const juntos = juntarComOsCongelados(
      [doPayload({ chave: "11111111-1111-4111-8111-111111111111" })],
      [{ chave: null, email: "comprador@exemplo.test", nome: "Iago", papel: "comprador" }],
      { envelopeId: "env-cancelado", estado: "cancelado" },
    );

    expect(juntos[0]?.reenvioIndisponivel?.motivo).toBe("envelope_encerrado");
    expect(juntos[0]?.reenvioIndisponivel?.frase).toContain("foi cancelado");
    expect(juntos[0]?.reenvioIndisponivel?.frase).toContain("env-cancelado");
  });

  it("envelope assinado também bloqueia, e o vivo não bloqueia nada", () => {
    const pessoa = [doPayload({ chave: "11111111-1111-4111-8111-111111111111" })];
    const quadro = [
      { chave: null, email: "comprador@exemplo.test", nome: "Iago", papel: "comprador" },
    ];

    expect(
      juntarComOsCongelados(pessoa, quadro, { envelopeId: "e", estado: "assinado" })[0]
        ?.reenvioIndisponivel?.motivo,
    ).toBe("envelope_encerrado");
    expect(
      juntarComOsCongelados(pessoa, quadro, { envelopeId: "e", estado: "parcial" })[0]
        ?.reenvioIndisponivel,
    ).toBeNull();
    // ⚠️ `desconhecido` NÃO É TERMINAL: o que não se sabe não pode virar recusa.
    expect(
      juntarComOsCongelados(pessoa, quadro, { envelopeId: "e", estado: "desconhecido" })[0]
        ?.reenvioIndisponivel,
    ).toBeNull();
  });

  it("quem só existe na lista congelada, COM chave, pode ser reenviado antes do primeiro webhook", () => {
    const juntos = juntarComOsCongelados(
      [],
      [{ chave: "sig-clicksign-9", email: "vendedora@exemplo.test", nome: "Fulana", papel: "vendedora" }],
    );

    expect(juntos[0]?.chave).toBe("sig-clicksign-9");
    expect(juntos[0]?.reenvioIndisponivel).toBeNull();
  });
});

// ── O PAYLOAD QUE NARRA (revisão da F1, 28/09/2026) ─────────────────────────
//
// ⚠️ O QUE ERA: o diário lia o evento mais recente do documento sem olhar a conferência. Desde a F1
// o não conferido é gravado como ESQUELETO, e um só deles como o mais recente (um POST forjado com a
// chave do documento, ou o segredo do HMAC faltando na Vercel) deixava o diário em "0 de N" ao lado
// do "1/2" do card, que já filtra o conferido.
describe("payloadMaisRecente lê só o evento conferido", () => {
  it("pede assinatura_conferida = true, pelo documento", async () => {
    const filtros: Array<[string, unknown]> = [];
    const builder: Record<string, unknown> = {};
    Object.assign(builder, {
      eq: (coluna: string, valor: unknown) => {
        filtros.push([coluna, valor]);
        return builder;
      },
      limit: () => builder,
      maybeSingle: () => Promise.resolve({ data: { payload: { document: { key: "doc-1" } } }, error: null }),
      order: () => builder,
      select: () => builder,
    });
    const sb = { from: () => builder } as unknown as SupabaseClient;

    const payload = await payloadMaisRecente(sb, { envelope_id: "env-1", provedor_documento_id: "doc-1" });

    expect(payload).toEqual({ document: { key: "doc-1" } });
    expect(filtros).toContainEqual(["provedor_documento_id", "doc-1"]);
    expect(filtros).toContainEqual(["assinatura_conferida", true]);
  });
});

// ── A FILA DE ASSINATURA NA TELA (02/10/2026) ───────────────────────────────
//
// ⚠️ O QUE ISTO PRENDE FOI MEDIDO EM PRODUÇÃO (só SELECT, os 29 envelopes da Clicksign): 163
// `add_signer`, 159 do lote do envio, todos até 1,1 s antes do nosso `enviado_em`, e 4 tardios, que
// são exatamente a Maura (VOC0306) e as três Ritas (VOL). Quem tem `add_signer` depois do envio foi
// recadastrado, e a Clicksign o pôs no FIM da fila. Lucas: *"vamos informar (na ordem da tela) que
// aquele cadastro foi para ultima posição"*.
describe("quem foi recadastrado depois do envio", () => {
  const ENVIO = "2026-09-29T16:06:51.729Z";
  const add = (key: string, quando: string) => ({
    data: { signers: [{ email: `${key}@x.test`, key }] },
    name: "add_signer",
    occurred_at: quando,
  });

  it("o lote do envio não marca ninguém; o recadastro de dois dias depois marca, com a data", () => {
    const payload = {
      document: {
        events: [
          add("coord", "2026-09-29T13:06:51.052-03:00"),
          add("maura-antiga", "2026-09-29T13:06:51.412-03:00"),
          add("maura-nova", "2026-10-01T15:18:15.332-03:00"),
        ],
      },
    };

    const mapa = recadastrosDepoisDoEnvio(payload, ENVIO);

    expect([...mapa.keys()]).toEqual(["maura-nova"]);
    expect(mapa.get("maura-nova")).toBeTruthy();
  });

  it("30 segundos depois do envio não marca: é a folga do relógio", () => {
    const payload = { document: { events: [add("k", "2026-09-29T16:07:21.000Z")] } };
    expect(recadastrosDepoisDoEnvio(payload, ENVIO).size).toBe(0);
  });

  it("sem enviado_em, ou sem histórico, não marca ninguém", () => {
    const payload = { document: { events: [add("k", "2026-10-01T15:18:15.332-03:00")] } };
    expect(recadastrosDepoisDoEnvio(payload, null).size).toBe(0);
    expect(recadastrosDepoisDoEnvio(payload, "lixo").size).toBe(0);
    expect(recadastrosDepoisDoEnvio({}, ENVIO).size).toBe(0);
  });
});

describe("a lista na ordem de assinatura", () => {
  const pendente = (key: string, nome: string, patch: Partial<SignatarioDoEnvelope> = {}): SignatarioDoEnvelope => ({
    assinouEm: null,
    chave: key,
    comecouEm: null,
    convite: "sem_noticia",
    conviteDetalhe: null,
    conviteQuando: null,
    email: `${key}@x.test`,
    nome,
    ...patch,
  });
  const assinou = (key: string, nome: string) => pendente(key, nome, { assinouEm: "2026-10-01T13:54:00-03:00" });
  const noQuadro = (key: string, nome: string, ordem: number, papel: string) => ({
    chave: key,
    email: `${key}@x.test`,
    nome,
    ordem,
    papel,
  });

  // O VOC0306 como ele está: a Maura recadastrada em 01/10, as testemunhas e as vendedoras pendentes.
  const VOC0306 = {
    payload: [
      pendente("maura", "Maura P."),
      assinou("nivea", "Nivea A."),
      assinou("huber", "Huber J."),
      assinou("fabricio", "Fabricio G."),
      assinou("romulo", "Romulo G."),
      assinou("rafael", "Rafael O."),
      pendente("yasmin", "Yasmin L."),
      pendente("northon", "Northon N."),
      pendente("vitor", "Vitor A."),
      pendente("helena", "Helena A."),
      pendente("marcos", "Marcos P."),
    ],
    quadro: [
      noQuadro("maura", "Maura P.", 3, "comprador"),
      noQuadro("nivea", "Nivea A.", 1, "coordenadora"),
      noQuadro("huber", "Huber J.", 1, "coordenadora"),
      noQuadro("fabricio", "Fabricio G.", 1, "coordenadora"),
      noQuadro("romulo", "Romulo G.", 2, "corretor"),
      noQuadro("rafael", "Rafael O.", 4, "testemunha"),
      noQuadro("yasmin", "Yasmin L.", 4, "testemunha"),
      noQuadro("northon", "Northon N.", 4, "testemunha"),
      noQuadro("vitor", "Vitor A.", 5, "vendedora"),
      noQuadro("helena", "Helena A.", 5, "vendedora"),
      noQuadro("marcos", "Marcos P.", 5, "vendedora"),
    ],
  };

  it("a Maura recadastrada aparece por último, com a marca; o resto por degrau e nome", () => {
    const juntos = juntarComOsCongelados(
      VOC0306.payload,
      VOC0306.quadro,
      { envelopeId: "0384000d", estado: "parcial" },
      new Map([["maura", "2026-10-01T15:18:15.332-03:00"]]),
    );

    expect(juntos.map((s) => s.nome)).toEqual([
      "Fabricio G.",
      "Huber J.",
      "Nivea A.",
      "Romulo G.",
      "Northon N.",
      "Rafael O.",
      "Yasmin L.",
      "Helena A.",
      "Marcos P.",
      "Vitor A.",
      "Maura P.",
    ]);
    expect(juntos.at(-1)?.foiParaOFimEm).toBe("2026-10-01T15:18:15.332-03:00");
    expect(juntos.filter((s) => s.foiParaOFimEm !== null)).toHaveLength(1);
  });

  it("o aviso antes de corrigir: a testemunha passaria a esperar os 5 pendentes que viriam depois dela", () => {
    const juntos = juntarComOsCongelados(
      VOC0306.payload,
      VOC0306.quadro,
      { envelopeId: "0384000d", estado: "parcial" },
      new Map([["maura", "2026-10-01T15:18:15.332-03:00"]]),
    );
    const de = (nome: string) => juntos.find((s) => s.nome === nome);

    // Yasmin (degrau 4): Northon (4), Helena, Marcos e Vitor (5) e a Maura (6) estão sem assinar.
    expect(de("Yasmin L.")?.trocaVaiParaOFim).toContain("5 pessoas que ainda não assinaram");
    // A Maura já é a última: corrigir de novo não passa ninguém na frente dela.
    expect(de("Maura P.")?.trocaVaiParaOFim).toBeNull();
    // Quem já assinou não tem troca.
    expect(de("Rafael O.")?.trocaVaiParaOFim).toBeNull();
    // Dividir o último degrau com alguém pendente também conta: a pessoa passaria a esperar por ele.
    expect(de("Vitor A.")?.trocaVaiParaOFim).toContain("Vitor A.");

    // ⚠️ A TROCA DE PESSOA (03/10/2026) USA A MESMA CONTA, COM OUTRO SUJEITO: quem vai para o fim é
    // quem entra no lugar. Nasce junto com o aviso da correção de e-mail, e só nele.
    expect(de("Yasmin L.")?.trocaDePessoaVaiParaOFim).toBe(
      "Quem entrar no lugar de Yasmin L. vai para o fim da fila de assinatura (a Clicksign põe quem entra depois do envio atrás de todos) e passa a esperar 5 pessoas que ainda não assinaram.",
    );
    expect(de("Maura P.")?.trocaDePessoaVaiParaOFim ?? null).toBeNull();
    expect(de("Rafael O.")?.trocaDePessoaVaiParaOFim ?? null).toBeNull();
  });

  it("envelope encerrado não avisa nada", () => {
    const juntos = juntarComOsCongelados(VOC0306.payload, VOC0306.quadro, { envelopeId: "x", estado: "cancelado" });
    expect(juntos.every((s) => s.trocaVaiParaOFim === null)).toBe(true);
    expect(juntos.every((s) => (s.trocaDePessoaVaiParaOFim ?? null) === null)).toBe(true);
  });

  it("envelope sem ordem sai em ordem alfabética, e o recadastrado depois de todos", () => {
    const juntos = juntarComOsCongelados(
      [pendente("c", "Carla"), pendente("a", "Ana"), pendente("b", "Bruno")],
      [noQuadro("c", "Carla", 0, "comprador"), noQuadro("a", "Ana", 0, "comprador"), noQuadro("b", "Bruno", 0, "conjuge")],
      {},
      new Map([["a", "2026-10-02T09:00:00-03:00"]]),
    );

    expect(juntos.map((s) => s.nome)).toEqual(["Bruno", "Carla", "Ana"]);
  });

  it("dois recadastros saem na ordem em que entraram, e quem não está no quadro fica no fim", () => {
    const juntos = juntarComOsCongelados(
      [pendente("x", "Xavier"), pendente("r2", "Rita"), pendente("r1", "Beatriz"), pendente("fora", "Ana Fora")],
      [noQuadro("x", "Xavier", 1, "comprador"), noQuadro("r1", "Beatriz", 2, "vendedora"), noQuadro("r2", "Rita", 2, "vendedora")],
      {},
      new Map([
        ["r1", "2026-10-02T09:00:00-03:00"],
        ["r2", "2026-10-02T10:00:00-03:00"],
      ]),
    );

    expect(juntos.map((s) => s.nome)).toEqual(["Xavier", "Beatriz", "Rita", "Ana Fora"]);
  });

  it("sem recadastros, vale a ordem do quadro mesmo que o payload venha em outra", () => {
    const juntos = juntarComOsCongelados(
      [pendente("v", "Vendedora"), pendente("c", "Compradora")],
      [noQuadro("v", "Vendedora", 2, "vendedora"), noQuadro("c", "Compradora", 1, "comprador")],
    );

    expect(juntos.map((s) => s.nome)).toEqual(["Compradora", "Vendedora"]);
    expect(juntos.every((s) => s.foiParaOFimEm === null)).toBe(true);
  });
});

// O NÚMERO DO DEGRAU QUE A TELA AGRUPA (02/10/2026, mockup aprovado da etapa "Em assinatura"). A tela
// vira uma fila de degraus, e quem numera é o servidor: a mesma conta que ordena.
describe("a posição de cada pessoa na fila", () => {
  const pendente = (key: string, nome: string): SignatarioDoEnvelope => ({
    assinouEm: null,
    chave: key,
    comecouEm: null,
    convite: "sem_noticia",
    conviteDetalhe: null,
    conviteQuando: null,
    email: `${key}@x.test`,
    nome,
  });
  const noQuadro = (key: string, nome: string, ordem: number, papel: string) => ({
    chave: key,
    email: `${key}@x.test`,
    nome,
    ordem,
    papel,
  });

  it("o VOC0306: cada um no degrau do envio, e a Maura recadastrada no 6, com o 3 vazio", () => {
    const juntos = juntarComOsCongelados(
      [
        pendente("maura", "Maura P."),
        pendente("nivea", "Nivea A."),
        pendente("romulo", "Romulo G."),
        pendente("rafael", "Rafael O."),
        pendente("vitor", "Vitor A."),
      ],
      [
        noQuadro("maura", "Maura P.", 3, "comprador"),
        noQuadro("nivea", "Nivea A.", 1, "coordenadora"),
        noQuadro("romulo", "Romulo G.", 2, "corretor"),
        noQuadro("rafael", "Rafael O.", 4, "testemunha"),
        noQuadro("vitor", "Vitor A.", 5, "vendedora"),
      ],
      { envelopeId: "0384000d", estado: "parcial" },
      new Map([["maura", "2026-10-01T15:18:15.332-03:00"]]),
    );

    expect(juntos.map((s) => [s.nome, s.posicao])).toEqual([
      ["Nivea A.", 1],
      ["Romulo G.", 2],
      ["Rafael O.", 4],
      ["Vitor A.", 5],
      ["Maura P.", 6],
    ]);
  });

  it("quem já assinou também leva o degrau: a tela precisa dele para fechar o degrau concluído", () => {
    const assinou = { ...pendente("a", "Ana"), assinouEm: "2026-10-01T10:00:00-03:00" };
    const juntos = juntarComOsCongelados([assinou, pendente("b", "Bia")], [
      noQuadro("a", "Ana", 1, "coordenadora"),
      noQuadro("b", "Bia", 2, "comprador"),
    ]);

    expect(juntos.map((s) => s.posicao)).toEqual([1, 2]);
  });

  it("envelope sem ordem deixa todo mundo no degrau 1", () => {
    const juntos = juntarComOsCongelados(
      [pendente("c", "Carla"), pendente("a", "Ana")],
      [noQuadro("c", "Carla", 0, "comprador"), noQuadro("a", "Ana", 0, "testemunha")],
    );

    expect(juntos.map((s) => s.posicao)).toEqual([1, 1]);
  });

  // ⚠️ "DEPOIS DO MAIOR" É O MAIOR DE QUEM NÃO FOI RECADASTRADO (`naOrdemDaFila`): aqui o Xavier, no 1.
  // O número absoluto pode não bater com o `group` da Clicksign, e não precisa: a tela só agrupa e
  // numera em sequência, e o que importa é cada recadastro num degrau seu, na ordem em que entrou.
  it("dois recadastros ganham um degrau cada, depois do maior; quem está fora do quadro fica sem degrau", () => {
    const juntos = juntarComOsCongelados(
      [pendente("x", "Xavier"), pendente("r2", "Rita"), pendente("r1", "Beatriz"), pendente("fora", "Ana Fora")],
      [noQuadro("x", "Xavier", 1, "comprador"), noQuadro("r1", "Beatriz", 2, "vendedora"), noQuadro("r2", "Rita", 2, "vendedora")],
      {},
      new Map([
        ["r1", "2026-10-02T09:00:00-03:00"],
        ["r2", "2026-10-02T10:00:00-03:00"],
      ]),
    );

    expect(juntos.map((s) => [s.nome, s.posicao])).toEqual([
      ["Xavier", 1],
      ["Beatriz", 2],
      ["Rita", 3],
      ["Ana Fora", null],
    ]);
  });

  it("envelope encerrado continua numerado: a fila de quem não assinou ainda se lê", () => {
    const juntos = juntarComOsCongelados(
      [pendente("a", "Ana"), pendente("b", "Bia")],
      [noQuadro("a", "Ana", 1, "comprador"), noQuadro("b", "Bia", 2, "testemunha")],
      { envelopeId: "x", estado: "cancelado" },
    );

    expect(juntos.map((s) => s.posicao)).toEqual([1, 2]);
  });
});

describe("quando o envelope vence", () => {
  it("lê o `document.deadline_at` e devolve em ISO", () => {
    expect(vencimentoDoPayload({ document: { deadline_at: "2026-10-29T16:25:39.934-03:00" } })).toBe(
      "2026-10-29T19:25:39.934Z",
    );
  });

  it("acha a data também no documento dentro de `data`", () => {
    expect(vencimentoDoPayload({ data: { document: { deadline_at: "2026-11-01T15:54:04.858-03:00" } } })).toBe(
      "2026-11-01T18:54:04.858Z",
    );
  });

  it("sem a data, ou com data ilegível, devolve nulo, e nunca o texto cru", () => {
    expect(vencimentoDoPayload({ document: {} })).toBeNull();
    expect(vencimentoDoPayload({ document: { deadline_at: "amanhã" } })).toBeNull();
    expect(vencimentoDoPayload(null)).toBeNull();
  });

  it("o payload real do bounce traz a data, e ela é lida", () => {
    expect(vencimentoDoPayload(payloadReal)).toBe("2026-10-12T02:23:56.603Z");
  });
});
