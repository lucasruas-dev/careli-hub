import { describe, expect, it, vi } from "vitest";

// O REGISTRO DO SILÊNCIO NÃO ACUSA UMA IMOBILIÁRIA QUE NÃO EXISTE (revisão de 28/09/2026).
//
// Os três avisos ao parceiro (`avisarImobReprovado`, `avisarImobPixEnviado`, `avisarImobPixPago`) passam
// por `contatoDaImobiliariaDaCad`, que resolve pelo vínculo `imobili%`. A CAD do cliente do corretor
// autônomo não tem esse vínculo, por regra (fatia 2): a função devolvia `nome: "a imobiliária"`,
// `email: null`, `telefone: null`, e `dispararParaImobiliaria` gravava DUAS linhas `falhou` na ficha do
// cliente dele dizendo "erro: imobiliária sem telefone" e "erro: imobiliária sem e-mail". Lucas
// (27/09/2026): *"nao quero ter a informacao que pode ter pessoa fisica como imobiliaria, isso sera bem
// restrito"*.
//
// ⚠️ MEDIDO EM PRODUÇÃO (bxgukywoxgivlrhjkwjx, 28/09/2026): `select tipo, status, count(*) from
// apolo_disparos where tipo like 'imob_%' group by 1,2;` → imob_relatorio 435 enviado / 37 falhou,
// imob_pix_enviado 178 falhou / 10 enviado, imob_credito_reprovado 111 enviado / 81 falhou,
// imob_pix_pago 39 enviado / 49 falhou. O `tipo` aparece no painel de disparos do Board, e é por isso que
// ele não pode mentir.
//
// ⚠️ O QUE ESTE ARQUIVO NÃO PROVA, E NÃO EXISTE AINDA: o autônomo sendo AVISADO. O WhatsApp destes três
// avisos é template Meta aprovado (`imob_credito_reprovado` e irmãos), e template novo é pedido à Meta,
// não código. Esta fatia para no ponto honesto: não mente no registro, e não manda o operador vincular
// uma imobiliária.

const m = vi.hoisted(() => ({
  gmailConfigurado: vi.fn(() => true),
  mandarEmail: vi.fn(async () => ({ ok: true })),
  mandarWhats: vi.fn(async () => ({ ok: true })),
}));

vi.mock("@/lib/iris/gmail", () => ({
  getCacaSender: () => "caca@careli.adm.br",
  isGmailConfigured: m.gmailConfigurado,
  sendGmailMessage: m.mandarEmail,
}));
vi.mock("@/lib/iris/meta-whatsapp", () => ({
  MetaWhatsAppSendError: class extends Error {},
  getMetaWhatsAppOutboundConfig: () => ({}),
  sendMetaWhatsAppTemplateMessage: m.mandarWhats,
}));

import { avisarImobPixPago, avisarImobReprovado, contatoDaImobiliariaDaCad } from "./disparo-imobiliaria";

const CLIENTE = "11111111-1111-4111-8111-111111111111";
const AUTONOMO = "aaaaaaaa-1111-4111-8111-111111111111";
const IMOBILIARIA = "dddddddd-4444-4444-8444-444444444444";

type Linha = Record<string, unknown>;

function bancoFalso(tabelas: Record<string, Linha[]>) {
  const disparos: Linha[] = [];
  const from = (tabela: string) => {
    let linhas = [...(tabelas[tabela] ?? [])];
    const q: Record<string, unknown> = {};
    q.select = () => q;
    q.eq = (coluna: string, valor: unknown) => {
      linhas = linhas.filter((linha) => String(linha[coluna] ?? null) === String(valor));
      return q;
    };
    q.neq = (coluna: string, valor: unknown) => {
      linhas = linhas.filter((linha) => String(linha[coluna] ?? null) !== String(valor));
      return q;
    };
    q.ilike = (coluna: string, padrao: string) => {
      const prefixo = String(padrao).replace(/%/g, "").toLowerCase();
      linhas = linhas.filter((linha) =>
        String(linha[coluna] ?? "").toLowerCase().startsWith(prefixo),
      );
      return q;
    };
    q.not = (coluna: string) => {
      linhas = linhas.filter((linha) => linha[coluna] !== null && linha[coluna] !== undefined);
      return q;
    };
    q.insert = async (valores: Linha) => {
      if (tabela === "apolo_disparos") disparos.push(valores);
      return { data: null, error: null };
    };
    for (const metodo of ["in", "limit", "order", "range"]) q[metodo] = () => q;
    q.maybeSingle = async () => ({ data: linhas[0] ?? null, error: null });
    q.then = (resolver: (r: unknown) => unknown) =>
      Promise.resolve({ data: linhas, error: null }).then(resolver);
    return q;
  };
  return { client: { from } as never, disparos };
}

const esteira = (extra: Linha = {}): Linha => ({
  atualizado_em: "2026-09-28T12:00:00+00:00",
  corretor: "JOAO AUTONOMO",
  corretor_entity_id: AUTONOMO,
  created_at: "2026-09-28T10:00:00+00:00",
  empreendimento: "VALE DO OURO",
  entity_id: CLIENTE,
  enterprise_id: "35",
  ...extra,
});

/** A CAD do cliente do autônomo: nenhum vínculo `imobili%`, o autônomo em `corretor_entity_id`. */
function bancoDoAutonomo(comCodigo = true) {
  return bancoFalso({
    apolo_contacts: [],
    apolo_disparos: [],
    apolo_entities: [
      { display_name: "MARIA CLIENTE", id: CLIENTE, legal_name: "MARIA CLIENTE" },
      {
        broker_code: comCodigo ? "CA-0001" : null,
        display_name: "JOAO AUTONOMO",
        entity_kind: "pf",
        id: AUTONOMO,
        legal_name: null,
      },
    ],
    apolo_entity_profiles: [{ entity_id: AUTONOMO, profile: "corretor", status: "active" }],
    apolo_esteira: [esteira()],
    apolo_relationships: [],
  });
}

describe("os avisos ao parceiro numa CAD de corretor autônomo", () => {
  it("⚠️ contatoDaImobiliariaDaCad devolve o código do autônomo, e não 'a imobiliária'", async () => {
    const b = bancoDoAutonomo();
    const contato = await contatoDaImobiliariaDaCad(b.client, CLIENTE);
    expect(contato.autonomo).toBe("CA-0001");
    expect(contato.entityId).toBeNull();
    expect(contato.nome).not.toContain("imobiliária");
  });

  it("⚠️ crédito reprovado: UMA linha, tipo `autonomo_credito_reprovado`, e nada é enviado", async () => {
    const b = bancoDoAutonomo();
    await avisarImobReprovado(b.client, CLIENTE);

    expect(b.disparos).toHaveLength(1);
    const linha = b.disparos[0]!;
    expect(linha.tipo).toBe("autonomo_credito_reprovado");
    expect(linha.status).toBe("falhou");
    expect(String(linha.erro)).toContain("CA-0001");
    expect(String(linha.erro)).toContain("NADA foi enviado");
    // As duas frases que acusavam uma imobiliária inexistente não podem sobrar.
    expect(String(linha.erro)).not.toContain("imobiliária sem telefone");
    expect(String(linha.erro)).not.toContain("imobiliária sem e-mail");
    expect(m.mandarWhats).not.toHaveBeenCalled();
    expect(m.mandarEmail).not.toHaveBeenCalled();
  });

  it("⚠️ o mesmo vale para o PIX pago (o outro gatilho automático)", async () => {
    const b = bancoDoAutonomo();
    await avisarImobPixPago(b.client, CLIENTE, "WhatsApp: enviado 10:12");
    expect(b.disparos.map((d) => d.tipo)).toEqual(["autonomo_pix_pago"]);
  });

  it("corretor SEM código (resíduo do C2X) cai no caminho antigo: não é autônomo da casa", async () => {
    const b = bancoDoAutonomo(false);
    await avisarImobReprovado(b.client, CLIENTE);
    expect(b.disparos.map((d) => d.tipo)).toEqual([
      "imob_credito_reprovado",
      "imob_credito_reprovado",
    ]);
  });

  it("a CAD de cliente de IMOBILIÁRIA continua idêntica: dois canais, com o contato dela", async () => {
    const b = bancoFalso({
      apolo_contacts: [
        { contact_type: "whatsapp", entity_id: IMOBILIARIA, is_primary: true, value: "31999990000" },
        { contact_type: "email", entity_id: IMOBILIARIA, is_primary: true, value: "imob@x.com" },
      ],
      apolo_disparos: [],
      apolo_entities: [
        { display_name: "MARIA CLIENTE", id: CLIENTE, legal_name: "MARIA CLIENTE" },
        { display_name: "RR SOLUCOES LTDA", id: IMOBILIARIA, legal_name: "RR SOLUCOES LTDA" },
      ],
      apolo_entity_profiles: [],
      apolo_esteira: [esteira({ corretor: "IGOR", corretor_entity_id: "corretor-1" })],
      apolo_relationships: [
        {
          created_at: "2026-09-01T12:00:00+00:00",
          entity_id: CLIENTE,
          label: "RR SOLUCOES LTDA",
          related_entity_id: IMOBILIARIA,
          relationship_type: "imobiliaria",
          status: "verified",
        },
      ],
    });
    await avisarImobReprovado(b.client, CLIENTE);
    expect(b.disparos.map((d) => d.tipo)).toEqual([
      "imob_credito_reprovado",
      "imob_credito_reprovado",
    ]);
    expect(b.disparos.every((d) => d.status === "enviado")).toBe(true);
    expect(m.mandarWhats).toHaveBeenCalled();
    expect(m.mandarEmail).toHaveBeenCalled();
  });
});
