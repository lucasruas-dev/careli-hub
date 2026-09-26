import { beforeEach, describe, expect, it, vi } from "vitest";

// O ANEXO DA VENDA SOB RESERVA — o ELO com a ficha do cliente no Apolo.
//
// Lucas (26/09/2026): *"na hora da reserva, dentro do hercules, temos que habilitar pessoa fisica e
// pessoa juridica, hoje só atende pessoa fisica"*.
//
// ⚠️ ESTA ROTA NÃO TINHA TESTE NENHUM, e era ela o QUARTO leitor ad-hoc de
// `hercules_reservas.proponentes`: lia SÓ a chave `cpf` (`typeof primeiro?.cpf === "string" ? ... :
// ""`). Como a rota da reserva passou a espelhar `cpf` apenas quando o documento é um CPF, numa
// reserva de PJ aquela leitura devolvia string vazia, `hashDoDocumentoDoComprador("")` devolvia
// `null` e a linha de `hercules_documentos` nascia com `cliente_documento_hash` NULO. No ramo da
// reserva `cliente_entity_id` também é nulo (não há entidade nessa fase), então o hash é o ÚNICO elo
// com a ficha: os dois ficavam nulos de uma vez, e o contrato social anexado desaparecia da ficha da
// empresa no CRM e na esteira, sem erro nenhum no log.
//
// ⚠️ `lib/apolo/incorporador/documentos.ts` acha o documento por `cliente_entity_id` OU por
// `.in("cliente_documento_hash", hashesDaPessoa(...))`, e `hashesDaPessoa` devolve o hash REAL da
// entidade — namespace `cnpj` em 11 de 11 CADs de PJ (medido em 26/09/2026, produção, só SELECT).
// Um hash nulo, ou um hash de namespace `cpf`, nunca casa.
//
// MEDIDO em 26/09/2026 (produção, só SELECT): `hercules_documentos` tem 51 linhas e ZERO com
// `reserva_id`, ou seja o defeito nasceria na PRIMEIRA reserva de PJ que anexasse documento.

type Linha = Record<string, unknown>;

const estado = vi.hoisted(() => ({
  inserido: [] as Array<{ linha: Linha; tabela: string }>,
  /** O jsonb de `hercules_reservas.proponentes` como o banco o guarda. */
  proponentes: [] as unknown[],
  /** Quando há proposta viva do lote, o ramo da reserva nem é alcançado. */
  propostas: [] as Linha[],
}));

vi.mock("@/lib/apolo/incorporador/board-do-portal", () => ({
  autorizarOperacaoDeVenda: () => ({
    ok: true,
    sessao: { slug: null, tipo: "comercial", usuarioId: "user-1", usuarioNome: "Lucas Ruas" },
  }),
}));

vi.mock("@/lib/apolo/incorporador/escopo", () => ({
  idsDaSessao: async () => ["39"],
}));

vi.mock("@/lib/apolo/incorporador/operacao-do-produto-servidor", () => ({
  autorizarEscritaNoProduto: async (_r: Request, sessao: unknown) => ({ ok: true, sessao }),
}));

vi.mock("@/lib/apolo/server", () => {
  const consulta = (tabela: string) => {
    // ⚠️ O INSERT MUDA O QUE O `.maybeSingle()` DEVOLVE: `insert().select("id").maybeSingle()` volta
    // com a linha CRIADA, e é dela que a rota tira o id da resposta. Sem distinguir, o dublê
    // devolveria `null` e a rota cairia em 503 — um erro que parece do documento e é do mock.
    let inseriu = false;
    const alvo: Record<string, unknown> = {
      then: (aceitar: (r: unknown) => unknown) => Promise.resolve(responder(tabela)).then(aceitar),
    };
    for (const metodo of ["eq", "in", "is", "limit", "order", "select"]) alvo[metodo] = () => alvo;
    for (const metodo of ["maybeSingle", "single"]) {
      alvo[metodo] = () => ({
        then: (aceitar: (r: unknown) => unknown) =>
          Promise.resolve({
            data: inseriu ? { id: "doc-1" } : umaLinha(tabela),
            error: null,
          }).then(aceitar),
      });
    }
    alvo.insert = (linha: Linha) => {
      inseriu = true;
      estado.inserido.push({ linha, tabela });
      return alvo;
    };
    return alvo;
  };

  const umaLinha = (tabela: string): Linha | null => {
    if (tabela === "hercules_unidades") return { enterprise_id: "39", id: "uni-1" };
    if (tabela === "hercules_propostas") return estado.propostas[0] ?? null;
    if (tabela === "hercules_reservas") {
      return { id: "res-1", proponentes: estado.proponentes, protocolo_numero: 123 };
    }
    return null;
  };

  const responder = (tabela: string) => {
    if (tabela === "hercules_documentos") return { data: [{ id: "doc-1" }], error: null };
    return { data: [], error: null };
  };

  return {
    createApoloAdminClient: () => ({
      from: (tabela: string) => consulta(tabela),
      storage: {
        from: () => ({
          // O arquivo EXISTE e mede 1 KB: é o `.info()` que autoriza o registro.
          info: async () => ({ data: { size: 1024 }, error: null }),
          remove: async () => ({ data: null, error: null }),
        }),
      },
    }),
    hashIdentifier: (tipo: string, valor: string) => `hash:${tipo}:${valor}`,
  };
});

import { POST } from "./route";

const CNPJ_DIGITOS = "12345678000195";
const CPF_DIGITOS = "52998224725";

const registrar = () =>
  POST(
    new Request("https://c2x.app.br/api/incorporador/venda/documentos", {
      body: JSON.stringify({
        acao: "registrar",
        // A pasta é a da UNIDADE, e a rota confere o caminho contra ela.
        caminho: "hercules/documentos/uni-1/abc-contrato-social.pdf",
        nome: "Contrato social.pdf",
        tipoDoArquivo: "application/pdf",
        unidadeId: "uni-1",
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    }),
  );

const gravado = () =>
  estado.inserido.find((i) => i.tabela === "hercules_documentos")?.linha ?? {};

beforeEach(() => {
  estado.inserido = [];
  estado.propostas = [];
  estado.proponentes = [];
});

describe("POST /api/incorporador/venda/documentos — o elo com a ficha", () => {
  it("⚠️ reserva de PJ: o hash sai no namespace CNPJ, e NÃO nulo", async () => {
    // A forma CANÔNICA que `proponenteParaGravar` grava para PJ: a chave `documento` e NENHUMA
    // `cpf`. É exatamente aqui que a leitura antiga devolvia "" e o hash saía nulo.
    estado.proponentes = [
      {
        documento: CNPJ_DIGITOS,
        nome: "ACME CONSTRUTORA LTDA",
        telefone: "62991234567",
        tipoPessoa: "pj",
      },
    ];

    const r = await registrar();
    expect(r.status).toBe(200);
    expect(gravado().reserva_id).toBe("res-1");
    expect(gravado().cliente_documento_hash).toBe(`hash:cnpj:${CNPJ_DIGITOS}`);
    // ⚠️ E NÃO O DE CPF: hasheado como "cpf", um CNPJ gera uma chave que não existe no banco.
    expect(gravado().cliente_documento_hash).not.toBe(`hash:cpf:${CNPJ_DIGITOS}`);
  });

  it("reserva de PF continua achando o mesmo hash de sempre, byte por byte", async () => {
    // Este lote não faz backfill nenhum: as linhas já gravadas têm de continuar achando o que
    // sempre acharam. MEDIDO em 26/09/2026 (produção `bxgukywoxgivlrhjkwjx`, só SELECT): as 32
    // reservas de `hercules_reservas` têm SÓ as chaves `cpf`, `nome` e `telefone` em 32 de 32, e os
    // 32 titulares têm 11 dígitos, com 0 de 32 falhando o dígito verificador. (Eram 30 quando o lote
    // começou: a coluna é dado vivo, e por isso este teste fixa a FORMA, não a contagem.)
    estado.proponentes = [
      { cpf: CPF_DIGITOS, nome: "MARIA DA SILVA", telefone: "62991234567" },
    ];

    await registrar();
    expect(gravado().cliente_documento_hash).toBe(`hash:cpf:${CPF_DIGITOS}`);
  });

  it("⚠️ a forma NOVA de PF espelha a chave `cpf`, e as duas dão o mesmo hash", async () => {
    estado.proponentes = [
      {
        cpf: CPF_DIGITOS,
        documento: CPF_DIGITOS,
        nome: "MARIA DA SILVA",
        telefone: "62991234567",
        tipoPessoa: "pf",
      },
    ];

    await registrar();
    expect(gravado().cliente_documento_hash).toBe(`hash:cpf:${CPF_DIGITOS}`);
  });

  it("reserva sem documento nenhum grava hash nulo, e isso é o certo", async () => {
    // Existe reserva gravada só com nome; inventar um hash de string vazia poria o documento na
    // ficha de quem não tem documento.
    estado.proponentes = [{ nome: "MARIA DA SILVA", telefone: "62991234567" }];

    await registrar();
    expect(gravado().cliente_documento_hash).toBeNull();
    expect(gravado().cliente_entity_id).toBeNull();
  });

  it("com proposta viva, o elo vem da PROPOSTA — inclusive o CNPJ dela", async () => {
    // A entidade vem da proposta e não de uma busca por documento: é a CAD que DECIDIU o
    // credenciamento. E o documento dela também hasheia no namespace certo.
    estado.propostas = [
      {
        cliente_documento: CNPJ_DIGITOS,
        cliente_entity_id: "ent-acme",
        empreendimento_codigo: "JDG",
        id: "prop-1",
        protocolo_numero: 456,
      },
    ];

    await registrar();
    expect(gravado().proposta_id).toBe("prop-1");
    expect(gravado().cliente_entity_id).toBe("ent-acme");
    expect(gravado().cliente_documento_hash).toBe(`hash:cnpj:${CNPJ_DIGITOS}`);
  });
});
