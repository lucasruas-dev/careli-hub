import { createHmac } from "node:crypto";

import { describe, expect, it } from "vitest";

import { conferirAssinaturaDoWebhook, lerEventoDoWebhook } from "./webhook";

// ⚠️ O QUE ESTE TESTE PROTEGE. `/api/publico/clicksign/webhook` é uma rota PÚBLICA: sem conferência,
// um POST de fora diz que o contrato foi assinado, o card da Têmis vai para "finalizado" e o
// documento segue sem ninguém ter assinado nada. A URL não é segredo — ela aparece em log de proxy,
// em print de tela e no painel do próprio provedor.

const SEGREDO = "973d92ca80c2206a0e65b35d2371d595";

function assinar(corpo: string, segredo = SEGREDO): string {
  return createHmac("sha256", segredo).update(corpo, "utf8").digest("hex");
}

describe("a conferência da assinatura", () => {
  const corpo = JSON.stringify({ event: { name: "sign" } });

  it("aceita o HMAC certo", () => {
    const r = conferirAssinaturaDoWebhook({
      corpoCru: corpo,
      headers: new Headers({ "content-hmac": `sha256=${assinar(corpo)}` }),
      segredo: SEGREDO,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.cabecalho).toBe("content-hmac");
  });

  it("aceita o valor sem o prefixo sha256=", () => {
    const r = conferirAssinaturaDoWebhook({
      corpoCru: corpo,
      headers: new Headers({ "content-hmac": assinar(corpo) }),
      segredo: SEGREDO,
    });
    expect(r.ok).toBe(true);
  });

  // ⚠️ O NOME DO CABEÇALHO NÃO ESTÁ DOCUMENTADO na v3 (a doc lista os 30 eventos e não diz como o
  // callback é assinado), e nenhum evento real chegou ainda. Por isso os candidatos, e por isso a
  // resposta diz QUAL chegou — é assim que o nome verdadeiro se descobre no primeiro evento.
  it("aceita o HMAC em qualquer um dos cabeçalhos candidatos, e diz qual foi", () => {
    const r = conferirAssinaturaDoWebhook({
      corpoCru: corpo,
      headers: new Headers({ "x-clicksign-signature": assinar(corpo) }),
      segredo: SEGREDO,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.cabecalho).toBe("x-clicksign-signature");
  });

  // ── AS RECUSAS ───────────────────────────────────────────────────────────

  it("RECUSA o HMAC calculado com outro segredo", () => {
    const r = conferirAssinaturaDoWebhook({
      corpoCru: corpo,
      headers: new Headers({ "content-hmac": assinar(corpo, "segredo-de-outra-pessoa") }),
      segredo: SEGREDO,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.porQue).toBe("nao-bate");
  });

  // ⚠️ É O ATAQUE ÓBVIO: o corpo é trocado por um que diz "assinado" e a assinatura antiga é
  // repetida. O HMAC é sobre o CORPO, então ele muda junto.
  it("RECUSA quando o corpo foi trocado depois de assinado", () => {
    const assinatura = assinar(corpo);
    const outro = JSON.stringify({ event: { name: "auto_close" } });
    const r = conferirAssinaturaDoWebhook({
      corpoCru: outro,
      headers: new Headers({ "content-hmac": assinatura }),
      segredo: SEGREDO,
    });
    expect(r.ok).toBe(false);
  });

  it("RECUSA o evento sem assinatura nenhuma", () => {
    const r = conferirAssinaturaDoWebhook({
      corpoCru: corpo,
      headers: new Headers({ "content-type": "application/json" }),
      segredo: SEGREDO,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.porQue).toBe("sem-assinatura");
  });

  // ⚠️ `timingSafeEqual` LANÇA com buffers de tamanhos diferentes — que é justamente o caso do lixo
  // digitado. Sem a checagem de tamanho, a rota devolveria 500 em vez de 401.
  it("RECUSA um valor de tamanho errado sem explodir", () => {
    const r = conferirAssinaturaDoWebhook({
      corpoCru: corpo,
      headers: new Headers({ "content-hmac": "abc" }),
      segredo: SEGREDO,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.porQue).toBe("nao-bate");
  });

  // ⚠️ SEM SEGREDO NÃO SE PROVA NADA, e isso é problema NOSSO de configuração — a variável pode
  // estar marcada "Sensitive" na Vercel e chegar VAZIA, sem erro
  // ([[reference_vercel_env_sensitive]]). O motivo é separado porque a rota responde diferente:
  // 200 (para a Clicksign não reenviar por horas) com o log gritando, em vez de 401.
  it("distingue 'não configurado' de 'não bate'", () => {
    for (const segredo of [null, "", "   "]) {
      const r = conferirAssinaturaDoWebhook({
        corpoCru: corpo,
        headers: new Headers({ "content-hmac": assinar(corpo) }),
        segredo,
      });
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.porQue).toBe("sem-segredo");
    }
  });

  it("recusa corpo vazio", () => {
    const r = conferirAssinaturaDoWebhook({
      corpoCru: "",
      headers: new Headers({ "content-hmac": assinar("") }),
      segredo: SEGREDO,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.porQue).toBe("corpo-vazio");
  });
});

describe("a leitura do evento", () => {
  // ⚠️ TOLERANTE DE PROPÓSITO: a doc da v3 lista os 30 eventos e NÃO mostra um único exemplo do
  // corpo entregue ao endpoint. Escrever o leitor a partir do que a doc "deve" mandar é o erro do
  // D4Sign, onde a doc mostra JSON e o webhook chega em form-data.
  it("acha o nome do evento em event.name", () => {
    const lido = lerEventoDoWebhook(
      JSON.stringify({ document: { id: "doc_9" }, event: { name: "sign" } }),
    );
    expect(lido.evento).toBe("sign");
    expect(lido.documentoId).toBe("doc_9");
  });

  it("acha o nome do evento na raiz, quando vier assim", () => {
    expect(lerEventoDoWebhook(JSON.stringify({ event: "auto_close" })).evento).toBe("auto_close");
  });

  // ⚠️ `event.name` VEM ANTES DE `type`: num corpo JSON:API a raiz também tem um `type`, que é o
  // tipo do RECURSO ("envelopes"), e não o nome do evento. Ler `type` antes faria TODO evento ser
  // traduzido como desconhecido.
  it("não confunde o `type` do JSON:API com o nome do evento", () => {
    const lido = lerEventoDoWebhook(
      JSON.stringify({ event: { name: "refusal" }, type: "envelopes" }),
    );
    expect(lido.evento).toBe("refusal");
  });

  it("lê o metadata que nós mesmos gravamos no documento", () => {
    const lido = lerEventoDoWebhook(
      JSON.stringify({
        document: { id: "doc_9", metadata: { proposta_id: "prop-1", teste: "true" } },
        event: { name: "sign" },
      }),
    );
    expect(lido.metadados).toEqual({ proposta_id: "prop-1", teste: "true" });
  });

  it("lê form-data quando o corpo não é JSON", () => {
    const lido = lerEventoDoWebhook("event=sign&document_id=doc_7");
    expect(lido.evento).toBe("sign");
    expect(lido.documentoId).toBe("doc_7");
  });

  it("devolve vazio, e não explode, com corpo ilegível", () => {
    expect(lerEventoDoWebhook("{{{").evento).toBe("");
    expect(lerEventoDoWebhook("").documentoId).toBeNull();
  });
});
