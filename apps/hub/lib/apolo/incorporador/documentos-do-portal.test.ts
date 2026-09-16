import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import type { ApoloDocumentItem } from "@/lib/apolo/documentos";

import {
  documentoVisivelNoPortal,
  filtrarDocumentosParaPortal,
  TIPOS_DE_CREDITO,
  TIPOS_DE_EMPREENDIMENTO,
  TIPOS_INTERNOS_DA_CARELI,
  type ContextoDoPortal,
  type MarcaDoDocumento,
} from "./documentos-do-portal";

// O QUE SAI DE `apolo_documents` PELO PORTAL (16/09/2026, o Cecílio passa a entrar pela porta do
// board). Os casos são os vazamentos que estavam abertos: o comprovante do Serasa, a CAD de outro
// loteamento e o nome de quem da Careli anexou. E o que NÃO pode sumir: o documento pessoal.

const HUB = join(__dirname, "..", "..", "..");

// O Cecílio: VOC (37) e Garden (39).
const recorteCecilio = new Set(["37", "39"]);

const contexto = (over: Partial<ContextoDoPortal> = {}): ContextoDoPortal => ({
  esteira: ["37"],
  imobiliaria: false,
  recorte: recorteCecilio,
  vinculos: ["37"],
  ...over,
});

const marca = (over: Partial<MarcaDoDocumento>): MarcaDoDocumento => ({
  documentType: "identificacao",
  enterpriseId: null,
  id: "doc-1",
  ...over,
});

const item = (over: Partial<ApoloDocumentItem>): ApoloDocumentItem => ({
  createdAt: "2026-09-01T10:00:00Z",
  documentType: "identificacao",
  fileName: "rg.pdf",
  hasFile: true,
  id: "doc-1",
  label: "RG",
  sizeBytes: 1000,
  status: "ready",
  uploadedBy: "Fulana da Careli <fulana@careli.adm.br>",
  ...over,
});

describe("documentoVisivelNoPortal: análise de crédito nunca sai", () => {
  it("comprovante do Serasa: fora, mesmo com a pessoa só no produto do portal", () => {
    expect(documentoVisivelNoPortal(marca({ documentType: "comprovante-credito" }), contexto())).toBe(
      false,
    );
  });

  it("comprovante do Serasa marcado com empreendimento DO recorte: fora mesmo assim", () => {
    expect(
      documentoVisivelNoPortal(
        marca({ documentType: "comprovante-credito", enterpriseId: "37" }),
        contexto(),
      ),
    ).toBe(false);
  });

  it("evidência da aprovação com restrição (tem enterpriseId no recorte): fora", () => {
    expect(
      documentoVisivelNoPortal(
        marca({ documentType: "aprovacao-credito-restricao", enterpriseId: "37" }),
        contexto(),
      ),
    ).toBe(false);
  });

  it("tipo novo com 'credito' ou 'serasa' como palavra: fora (a rede para o esquecido)", () => {
    for (const tipo of ["consulta-serasa", "serasa", "laudo_credito", "Comprovante-Credito "]) {
      expect(documentoVisivelNoPortal(marca({ documentType: tipo }), contexto())).toBe(false);
    }
  });

  it("dossiê jurídico da cobrança (comissão e score da Careli): fora", () => {
    expect(documentoVisivelNoPortal(marca({ documentType: "dossie-juridico" }), contexto())).toBe(
      false,
    );
  });

  // (16/09/2026, revisão) A regra "o incorporador não sabe do Serasa" é do incorporador. O comercial
  // move a CAD até crédito e revisão e sempre abriu o comprovante.
  it("no COMERCIAL, o comprovante e a aprovação com restrição continuam abrindo", () => {
    expect(
      documentoVisivelNoPortal(
        marca({ documentType: "comprovante-credito" }),
        contexto({ comercial: true }),
      ),
    ).toBe(true);
    expect(
      documentoVisivelNoPortal(
        marca({ documentType: "aprovacao-credito-restricao", enterpriseId: "37" }),
        contexto({ comercial: true }),
      ),
    ).toBe(true);
  });

  it("no comercial a marca ainda manda: a aprovação de OUTRO produto fica fora", () => {
    expect(
      documentoVisivelNoPortal(
        marca({ documentType: "aprovacao-credito-restricao", enterpriseId: "12" }),
        contexto({ comercial: true }),
      ),
    ).toBe(false);
  });

  it("no comercial o dossiê continua fora (peça interna, decisão pendente do Lucas)", () => {
    expect(
      documentoVisivelNoPortal(marca({ documentType: "dossie-juridico" }), contexto({ comercial: true })),
    ).toBe(false);
  });

  it("sem dizer o tipo do portal, o crédito fica fora (fechado por padrão)", () => {
    const { comercial: _ignorado, ...semTipo } = contexto();
    expect(documentoVisivelNoPortal(marca({ documentType: "comprovante-credito" }), semTipo)).toBe(
      false,
    );
  });
});

// (16/09/2026, crédito no portal) Decisão do Lucas: *"A Cecílio, no portal"* faz a análise de crédito
// dos clientes dela. O comprovante do Serasa e a evidência da aprovação com restrição saem para o
// portal que opera sozinho, mas SÓ DAS CADs DO ESCOPO. O incorporador padrão segue sem ver (os casos
// do bloco acima, sem `operaSozinho`) e o comercial segue como era.
describe("documentoVisivelNoPortal: portal que opera sozinho vê o crédito das CADs do escopo", () => {
  const sozinho = (over: Partial<ContextoDoPortal> = {}) => contexto({ operaSozinho: true, ...over });

  // (16/09/2026, revisão do conjunto) O comprovante que o portal paga nasce marcado; o sem marca é
  // sempre da Careli, e com a ficha compartilhada (D5) ele não sai para a Cecílio.
  it("comprovante do Serasa MARCADO com o produto do portal: sai; SEM marca (da Careli): fora", () => {
    expect(
      documentoVisivelNoPortal(marca({ documentType: "comprovante-credito", enterpriseId: "37" }), sozinho()),
    ).toBe(true);
    expect(documentoVisivelNoPortal(marca({ documentType: "comprovante-credito" }), sozinho())).toBe(
      false,
    );
  });

  it("comprovante sem marca de quem tem CAD em OUTRO loteamento: fora (pode ser a análise de lá)", () => {
    expect(
      documentoVisivelNoPortal(
        marca({ documentType: "comprovante-credito" }),
        sozinho({ esteira: ["37", "12"], vinculos: ["37"] }),
      ),
    ).toBe(false);
    expect(
      documentoVisivelNoPortal(
        marca({ documentType: "comprovante-credito" }),
        sozinho({ esteira: ["37"], vinculos: ["37", "12"] }),
      ),
    ).toBe(false);
  });

  it("aprovação com restrição marcada: só a do empreendimento do recorte", () => {
    expect(
      documentoVisivelNoPortal(
        marca({ documentType: "aprovacao-credito-restricao", enterpriseId: "39" }),
        sozinho({ esteira: ["37", "39"] }),
      ),
    ).toBe(true);
    expect(
      documentoVisivelNoPortal(
        marca({ documentType: "aprovacao-credito-restricao", enterpriseId: "12" }),
        sozinho({ esteira: ["37", "12"] }),
      ),
    ).toBe(false);
  });

  it("pela porta da imobiliária, ou sem CAD na esteira: fora (não há CAD do escopo)", () => {
    expect(
      documentoVisivelNoPortal(
        marca({ documentType: "comprovante-credito" }),
        sozinho({ esteira: [], imobiliaria: true, vinculos: ["37"] }),
      ),
    ).toBe(false);
    expect(
      documentoVisivelNoPortal(
        marca({ documentType: "aprovacao-credito-restricao", enterpriseId: "37" }),
        sozinho({ esteira: [], vinculos: ["37"] }),
      ),
    ).toBe(false);
  });

  it("a rede do tipo novo de crédito segue a mesma régua (sai no escopo, some fora)", () => {
    expect(
      documentoVisivelNoPortal(marca({ documentType: "consulta-serasa", enterpriseId: "37" }), sozinho()),
    ).toBe(true);
    expect(
      documentoVisivelNoPortal(
        marca({ documentType: "consulta-serasa", enterpriseId: "12" }),
        sozinho({ esteira: ["12"] }),
      ),
    ).toBe(false);
  });

  it("o dossiê jurídico continua fora, e o documento pessoal da pessoa só do produto sai", () => {
    expect(documentoVisivelNoPortal(marca({ documentType: "dossie-juridico" }), sozinho())).toBe(false);
    expect(documentoVisivelNoPortal(marca({ documentType: "identificacao" }), sozinho())).toBe(true);
  });

  it("o comercial não muda com o campo: o comprovante sem marca continua abrindo", () => {
    expect(
      documentoVisivelNoPortal(
        marca({ documentType: "comprovante-credito" }),
        contexto({ comercial: true, esteira: ["37", "12"] }),
      ),
    ).toBe(true);
  });
});

// (16/09/2026, D5) Decisão do Lucas: o cliente que já tem ficha na Careli, cadastrado pelo portal que
// opera sozinho, APROVEITA a ficha (uma por pessoa), SEM devolver nada do que a Careli já tem. O RG e
// o comprovante que a Careli guardou para a CAD de outro produto nascem sem marca: para esse portal,
// o documento pessoal sem marca segue a régua do passo 6. O que o portal sobe sai com a marca dele.
describe("documentoVisivelNoPortal: documento pessoal da ficha compartilhada no portal que opera sozinho", () => {
  const sozinho = (over: Partial<ContextoDoPortal> = {}) =>
    contexto({ operaSozinho: true, recorte: new Set(["39"]), ...over });

  it("pessoa de DOIS produtos (a Careli no 12, a Cecílio no 39): o RG e o comprovante sem marca não saem", () => {
    const pessoaDeDois = { esteira: ["12", "39"], vinculos: ["12", "39"] };
    for (const tipo of ["identificacao", "comprovante_endereco", "anexo", "comprovante_renda_extrato"]) {
      expect(documentoVisivelNoPortal(marca({ documentType: tipo }), sozinho(pessoaDeDois))).toBe(false);
    }
  });

  it("a mesma pessoa de dois produtos: o documento que o portal subiu (marcado com o 39) sai", () => {
    expect(
      documentoVisivelNoPortal(
        marca({ documentType: "identificacao", enterpriseId: "39" }),
        sozinho({ esteira: ["12", "39"], vinculos: ["12", "39"] }),
      ),
    ).toBe(true);
    // E o marcado com o produto da Careli, não.
    expect(
      documentoVisivelNoPortal(
        marca({ documentType: "identificacao", enterpriseId: "12" }),
        sozinho({ esteira: ["12", "39"], vinculos: ["12", "39"] }),
      ),
    ).toBe(false);
  });

  it("só o vínculo em outro produto (rastro de ficha mesclada) também fecha", () => {
    expect(
      documentoVisivelNoPortal(
        marca({ documentType: "identificacao" }),
        sozinho({ esteira: ["39"], vinculos: ["39", "12"] }),
      ),
    ).toBe(false);
  });

  it("cliente só do produto do portal: o documento pessoal sem marca sai", () => {
    expect(
      documentoVisivelNoPortal(
        marca({ documentType: "identificacao" }),
        sozinho({ esteira: ["39"], vinculos: ["39"] }),
      ),
    ).toBe(true);
  });

  it("pessoa sem empreendimento conhecido: fora (nada prova que é do portal)", () => {
    expect(
      documentoVisivelNoPortal(marca({ documentType: "identificacao" }), sozinho({ esteira: [], vinculos: [] })),
    ).toBe(false);
  });

  it("pela porta da imobiliária, com vínculo em produto de fora: fora (sem exceção, fechado)", () => {
    expect(
      documentoVisivelNoPortal(
        marca({ documentType: "identificacao" }),
        sozinho({ esteira: [], imobiliaria: true, vinculos: ["39", "12"] }),
      ),
    ).toBe(false);
    expect(
      documentoVisivelNoPortal(
        marca({ documentType: "identificacao" }),
        sozinho({ esteira: [], imobiliaria: true, vinculos: ["39"] }),
      ),
    ).toBe(true);
  });

  it("o comercial e os portais padrão não mudam: a mesma pessoa de dois produtos vê o RG", () => {
    const pessoaDeDois = { esteira: ["12", "39"], recorte: new Set(["39"]), vinculos: ["12", "39"] };
    expect(documentoVisivelNoPortal(marca({ documentType: "identificacao" }), contexto(pessoaDeDois))).toBe(true);
    expect(
      documentoVisivelNoPortal(marca({ documentType: "identificacao" }), contexto({ ...pessoaDeDois, comercial: true })),
    ).toBe(true);
  });

  it("filtrarDocumentosParaPortal: na ficha aproveitada sai só o que é do portal", () => {
    const documentos = [
      item({ documentType: "identificacao", id: "rg-da-careli" }),
      item({ documentType: "identificacao", id: "rg-do-portal" }),
      item({ documentType: "comprovante_endereco", id: "endereco-da-careli" }),
    ];
    const marcas = [
      marca({ documentType: "identificacao", id: "rg-da-careli" }),
      marca({ documentType: "identificacao", enterpriseId: "39", id: "rg-do-portal" }),
      marca({ documentType: "comprovante_endereco", id: "endereco-da-careli" }),
    ];
    const saida = filtrarDocumentosParaPortal(
      documentos,
      marcas,
      sozinho({ esteira: ["12", "39"], vinculos: ["12", "39"] }),
    );
    expect(saida.map((doc) => doc.id)).toEqual(["rg-do-portal"]);
  });
});

describe("documentoVisivelNoPortal: documento pessoal continua visível", () => {
  it.each(["identificacao", "identity", "comprovante_endereco", "certidao", "anexo", "outro"])(
    "%s sem marca: sai",
    (tipo) => {
      expect(documentoVisivelNoPortal(marca({ documentType: tipo }), contexto())).toBe(true);
    },
  );

  it("comprovante de renda não é análise de crédito: sai", () => {
    expect(
      documentoVisivelNoPortal(marca({ documentType: "comprovante_renda_extrato" }), contexto()),
    ).toBe(true);
  });

  it("documento pessoal de quem tem CAD em outro loteamento também: o RG é da pessoa", () => {
    expect(
      documentoVisivelNoPortal(
        marca({ documentType: "identificacao" }),
        contexto({ esteira: ["37", "12"], vinculos: ["37", "12"] }),
      ),
    ).toBe(true);
  });
});

describe("documentoVisivelNoPortal: CAD e PA de outro empreendimento", () => {
  it("CAD marcada com empreendimento FORA do recorte: fora", () => {
    expect(
      documentoVisivelNoPortal(marca({ documentType: "cad", enterpriseId: "12" }), contexto()),
    ).toBe(false);
  });

  it("CAD marcada com empreendimento do recorte: sai (também quando a pessoa tem CAD em outro)", () => {
    expect(
      documentoVisivelNoPortal(
        marca({ documentType: "cad", enterpriseId: "39" }),
        contexto({ esteira: ["39", "12"] }),
      ),
    ).toBe(true);
  });

  it("documento qualquer marcado com empreendimento fora: fora (a marca manda)", () => {
    expect(
      documentoVisivelNoPortal(marca({ documentType: "anexo", enterpriseId: " 12 " }), contexto()),
    ).toBe(false);
  });

  it("CAD sem marca, pessoa só com CAD no produto do portal: sai (não há outra de onde vir)", () => {
    expect(documentoVisivelNoPortal(marca({ documentType: "cad" }), contexto())).toBe(true);
  });

  it("CAD sem marca, pessoa com CAD em outro loteamento também: fora (pode ser a do outro)", () => {
    expect(
      documentoVisivelNoPortal(
        marca({ documentType: "cad" }),
        contexto({ esteira: ["37", "12"], vinculos: ["37"] }),
      ),
    ).toBe(false);
  });

  it("CAD sem marca, pessoa só com CAD em OUTRO loteamento: fora", () => {
    expect(
      documentoVisivelNoPortal(
        marca({ documentType: "cad" }),
        contexto({ esteira: ["12"], vinculos: ["12"] }),
      ),
    ).toBe(false);
  });

  it("o vínculo de outro produto (rastro de ficha mesclada) também fecha a CAD sem marca", () => {
    expect(
      documentoVisivelNoPortal(
        marca({ documentType: "cad" }),
        contexto({ esteira: ["37"], vinculos: ["37", "12"] }),
      ),
    ).toBe(false);
  });

  it("CAD sem marca e pessoa sem empreendimento conhecido: fora (nada prova de onde é)", () => {
    expect(
      documentoVisivelNoPortal(marca({ documentType: "cad" }), contexto({ esteira: [], vinculos: [] })),
    ).toBe(false);
  });

  it("CAD gravada no GRUPO quando o portal cobre só uma divisão: fora", () => {
    expect(
      documentoVisivelNoPortal(
        marca({ documentType: "cad" }),
        contexto({ esteira: ["group:Lagoa Bonita"], recorte: new Set(["33"]), vinculos: [] }),
      ),
    ).toBe(false);
  });

  it("PA do Prometeu segue a mesma régua da CAD", () => {
    expect(documentoVisivelNoPortal(marca({ documentType: "pa" }), contexto())).toBe(true);
    expect(
      documentoVisivelNoPortal(marca({ documentType: "pa" }), contexto({ esteira: ["37", "12"] })),
    ).toBe(false);
  });

  it("ficha em PDF da IMOBILIÁRIA (sem esteira, entrou pelo vínculo): sai mesmo com vínculos em vários produtos", () => {
    expect(
      documentoVisivelNoPortal(
        marca({ documentType: "cad" }),
        contexto({ esteira: [], imobiliaria: true, vinculos: ["37", "12", "33"] }),
      ),
    ).toBe(true);
  });

  it("imobiliária que TEM esteira em outro produto (comprou lote): a CAD sem marca volta à régua e fica fora", () => {
    expect(
      documentoVisivelNoPortal(
        marca({ documentType: "cad" }),
        contexto({ esteira: ["12"], imobiliaria: true, vinculos: ["37"] }),
      ),
    ).toBe(false);
  });

  it("sem a marca lida do banco: fora", () => {
    expect(documentoVisivelNoPortal(undefined, contexto())).toBe(false);
  });
});

describe("filtrarDocumentosParaPortal", () => {
  const documentos = [
    item({ documentType: "identificacao", id: "rg" }),
    item({ documentType: "comprovante-credito", id: "serasa", label: "Comprovante de credito SR-1" }),
    item({ documentType: "cad", id: "cad-voc", label: "CAD - Fulano" }),
    item({ documentType: "cad", id: "cad-outro", label: "CAD - Fulano" }),
    item({ documentType: "comprovante_endereco", id: "endereco" }),
    item({ documentType: "outro", id: "sem-marca-lida" }),
  ];
  const marcas: MarcaDoDocumento[] = [
    marca({ documentType: "identificacao", id: "rg" }),
    marca({ documentType: "comprovante-credito", id: "serasa" }),
    marca({ documentType: "cad", enterpriseId: "37", id: "cad-voc" }),
    marca({ documentType: "cad", enterpriseId: "12", id: "cad-outro" }),
    marca({ documentType: "comprovante_endereco", id: "endereco" }),
  ];

  it("tira o Serasa, a CAD do outro loteamento e o que chegou sem marca; mantém o pessoal e a CAD do produto", () => {
    const saida = filtrarDocumentosParaPortal(
      documentos,
      marcas,
      contexto({ esteira: ["37", "12"], vinculos: ["37", "12"] }),
    );
    expect(saida.map((doc) => doc.id)).toEqual(["rg", "cad-voc", "endereco"]);
  });

  it("uploadedBy sai nulo (nome ou e-mail de quem da Careli anexou); o resto do item fica igual", () => {
    const [rg] = filtrarDocumentosParaPortal(documentos, marcas, contexto());
    expect(rg).toEqual({ ...documentos[0], uploadedBy: null });
  });

  it("D4 (16/09/2026): no comercial o uploadedBy fica como veio", () => {
    const [rg] = filtrarDocumentosParaPortal(documentos, marcas, contexto({ comercial: true }));
    expect(rg?.uploadedBy).toBe("Fulana da Careli <fulana@careli.adm.br>");
  });

  it("não altera a lista recebida", () => {
    filtrarDocumentosParaPortal(documentos, marcas, contexto());
    expect(documentos[0]?.uploadedBy).toBe("Fulana da Careli <fulana@careli.adm.br>");
  });
});

// A MARCA TEM QUE SER A MESMA DO LUGAR QUE GRAVA. Os literais moram na regra pura para não puxar
// PDF, token e Supabase para dentro dela; se alguém renomear o tipo lá, este teste acusa antes de o
// comprovante do Serasa voltar a sair pelo portal.
describe("os tipos batem com quem grava", () => {
  const ler = (caminho: string) => readFileSync(join(HUB, caminho), "utf8");

  it("comprovante-credito é o COMPROVANTE_DOC_TYPE do Serasa", () => {
    expect(ler("lib/serasa/comprovante.ts")).toMatch(
      /export const COMPROVANTE_DOC_TYPE = "comprovante-credito";/,
    );
    expect(TIPOS_DE_CREDITO.has("comprovante-credito")).toBe(true);
  });

  it("aprovacao-credito-restricao é o tipo da evidência gravada pela aprovação com restrição", () => {
    // (16/09/2026) A gravação saiu da rota para o serviço das duas portas (hub e portal que opera
    // sozinho); o literal mora lá.
    expect(ler("lib/serasa/aprovar-restricao-servico.ts")).toMatch(
      /documentType: "aprovacao-credito-restricao"/,
    );
    expect(TIPOS_DE_CREDITO.has("aprovacao-credito-restricao")).toBe(true);
  });

  it("dossie-juridico é o DOSSIE_DOC_TYPE do Hades", () => {
    expect(ler("lib/hades/dossie/gerar.ts")).toMatch(
      /export const DOSSIE_DOC_TYPE = "dossie-juridico";/,
    );
    expect(TIPOS_INTERNOS_DA_CARELI.has("dossie-juridico")).toBe(true);
  });

  it("cad e pa são os tipos da CAD automática e da PA do Prometeu", () => {
    expect(ler("lib/apolo/salvar-cad.ts")).toMatch(/export const CAD_DOC_TYPE = "cad";/);
    expect(ler("lib/prometeu/pa-para-apolo.ts")).toMatch(/export const PA_DOCUMENT_TYPE = "pa";/);
    expect([...TIPOS_DE_EMPREENDIMENTO].sort()).toEqual(["cad", "pa"]);
  });
});

// TODA PORTA DO PORTAL PASSA PELO FILTRO. Uma rota que voltasse a chamar `listApoloDocuments`
// direto reabriria o vazamento sem nenhum teste de regra acusar.
describe("as portas do portal usam a lista filtrada", () => {
  const portas = [
    "app/api/incorporador/board/[id]/documentos/route.ts",
    "app/api/incorporador/board/[id]/documentos/[docId]/route.ts",
    "lib/apolo/incorporador/documentos.ts",
  ];

  it.each(portas)("%s chama documentosDoApoloParaPortal e não listApoloDocuments", (caminho) => {
    const texto = readFileSync(join(HUB, caminho), "utf8");
    expect(texto).toMatch(/documentosDoApoloParaPortal\(/);
    expect(texto).not.toMatch(/listApoloDocuments\(/);
  });

  // (16/09/2026, crédito no portal) As duas portas do board (a lista e a abertura) dizem se a sessão
  // opera sozinha pela MESMA régua da etapa e do Serasa: `portalConfeccionaContrato`. Esquecer numa
  // das duas seria listar o comprovante e responder 404 ao abrir (ou o contrário).
  it.each(portas.slice(0, 2))("%s passa operaSozinho por portalConfeccionaContrato", (caminho) => {
    const texto = readFileSync(join(HUB, caminho), "utf8");
    expect(texto).toMatch(
      /operaSozinho: portalConfeccionaContrato\(auth\.sessao\.slug, auth\.sessao\.tipo\)/,
    );
    expect(texto).toMatch(/comercial: ehPortalComercial\(auth\.sessao\.tipo\)/);
  });

  it("a abertura do CRM confere o id contra a lista filtrada antes de gerar a URL", () => {
    const texto = readFileSync(join(HUB, "lib/apolo/incorporador/documentos.ts"), "utf8");
    const ramoApolo = texto.slice(texto.indexOf('if (fonte === "apolo")'));
    const conferencia = ramoApolo.indexOf("documentosDoApoloParaPortal(");
    const url = ramoApolo.indexOf("createSignedUrl(");
    expect(conferencia).toBeGreaterThan(-1);
    expect(url).toBeGreaterThan(conferencia);
  });
});
