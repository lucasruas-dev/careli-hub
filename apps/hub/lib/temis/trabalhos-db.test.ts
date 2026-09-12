import { describe, expect, it } from "vitest";

import payloadReal from "@/lib/assinatura/__fixtures__/clicksign-sign-com-bounce.json";

import { lerEventosDoPayload } from "./trabalhos-db";

// O "1/5" DO CARD, PRESO AO PAYLOAD QUE O ORIGINOU.
//
// A fixture é o payload REAL do envelope 3e9a331d-ec2f-4eb5-9ae1-aafbeae8b395 (12/09/2026),
// ANONIMIZADO — a mesma que prende a lib do diário. Duas camadas leem o mesmo array
// `document.events[]` com propósitos diferentes: lá nasce a frase em português, aqui nasce o
// NÚMERO que o operador lê de relance no quadro. Um payload, duas provas.
//
// ⚠️ ESTE ARQUIVO NASCEU DE UM DEFEITO QUE PASSOU PELO TYPECHECK. A contagem existia e ninguém a
// tinha exercitado; o defeito não estava aqui dentro, estava na COLUNA por onde o evento era
// procurado (ver `historicoDosEnvelopes`). O teste da leitura pura não teria pego aquele — mas sem
// ele não há nem por onde começar a desconfiar do número.

const CHAVE_DE_QUEM_ASSINOU = "22222222-aaaa-4bbb-8ccc-000000000002";
const CHAVE_DE_QUEM_NAO_RECEBEU = "33333333-aaaa-4bbb-8ccc-000000000003";

describe("lerEventosDoPayload, no payload real", () => {
  it("conta UMA assinatura, e é a da pessoa que assinou", () => {
    const { assinaram } = lerEventosDoPayload(payloadReal);

    // 1 de 2 — exatamente o que a tela dizia como "Parcialmente assinado", agora em número.
    expect([...assinaram]).toEqual([CHAVE_DE_QUEM_ASSINOU]);
  });

  it("acha o convite que NÃO foi entregue", () => {
    const { naoEntregues } = lerEventosDoPayload(payloadReal);

    // ⚠️ SE ESTA LINHA FALHAR, O DEFEITO ORIGINAL VOLTOU: o `tracking_notification_error` está
    // dentro de `document.events[]` e não chega como webhook próprio. Era esta a notícia que o
    // Panteon recebia e jogava fora.
    expect([...naoEntregues]).toEqual([CHAVE_DE_QUEM_NAO_RECEBEU]);
  });

  it("não conta o fechamento do envelope como assinatura de alguém", () => {
    // `sign` é UMA pessoa; quem fecha o contrato é `close`/`auto_close`, e o fechamento é o
    // `estado` do envelope — somá-lo aqui faria "3/2".
    const { assinaram } = lerEventosDoPayload({
      document: {
        events: [
          { data: { signer: { key: "a" } }, name: "sign" },
          { data: { signer: { key: "a" } }, name: "auto_close" },
          { data: {}, name: "close" },
        ],
      },
    });

    expect(assinaram.size).toBe(1);
  });

  it("o mesmo webhook reenviado não conta a assinatura duas vezes", () => {
    // A Clicksign manda o histórico INTEIRO a cada evento, então o mesmo `sign` chega muitas vezes.
    // Conjunto de chaves, e não contador, é o que segura isso.
    const umaPessoaDuasVezes = {
      document: {
        events: [
          { data: { signer: { key: "a" } }, name: "sign" },
          { data: { signer: { key: "a" } }, name: "sign" },
        ],
      },
    };

    expect(lerEventosDoPayload(umaPessoaDuasVezes).assinaram.size).toBe(1);
  });

  it("acha o documento dentro de `data` e dentro de `event`, além da raiz", () => {
    const evento = { data: { signer: { key: "a" } }, name: "sign" };

    expect(lerEventosDoPayload({ data: { document: { events: [evento] } } }).assinaram.size).toBe(1);
    expect(lerEventosDoPayload({ event: { document: { events: [evento] } } }).assinaram.size).toBe(
      1,
    );
  });

  it("payload torto devolve vazio em vez de lançar", () => {
    // ⚠️ O CARD SEM SELO É A RESPOSTA CERTA PARA "NÃO SEI". Uma exceção aqui derrubaria o quadro
    // inteiro por causa de um enfeite.
    for (const torto of [null, undefined, "", 42, [], {}, { document: { events: "nada" } }]) {
      const lido = lerEventosDoPayload(torto);
      expect(lido.assinaram.size).toBe(0);
      expect(lido.naoEntregues.size).toBe(0);
    }
  });

  it("signatário sem identidade nenhuma não vira uma assinatura anônima", () => {
    const { assinaram } = lerEventosDoPayload({
      document: { events: [{ data: { signer: {} }, name: "sign" }] },
    });

    expect(assinaram.size).toBe(0);
  });
});
