import { describe, expect, it } from "vitest";

import {
  ETIQUETA_DA_CARGA,
  type CarteiraDoEscopo,
  type ClienteLsoft,
  type EntradaDoPlano,
  type FichaExistente,
  type LinhaDeBoleto,
  hashDoIdentificador,
  lerContato,
  linhaDaFichaNova,
  linhaDeBusca,
  montarPlano,
  perfisDaPessoa,
  tipoDoDocumento,
  uuidDeterministico,
} from "./carga-comprador-cecilio";
import { deterministicUuid, hashIdentifier } from "./server";

// AS REGRAS DA CARGA DOS COMPRADORES DA CECÍLIO (02/10/2026).
//
// Os CPFs abaixo são GERADOS (dígito verificador válido, nenhum é de cliente), e os telefones são de
// mentira. ⚠️ O que este arquivo trava, cada um com um incidente ou armadilha medida por trás:
//   • a ficha é achada pelo DOCUMENTO e nunca por nome; documento com duas fichas ativas fica fora;
//   • o par cruzado (boleto e LSoft trocando os titulares) fica FORA;
//   • telefone dividido entre pessoas, ou já de outra ficha, vira 'attention' e NÃO vira identificador
//     (a Iris pega a primeira ficha que casa: incidente da Lavra do Ouro);
//   • a origem é 'cecilio', nunca 'apolo' (lote do C2X e MOST), e a fonte nunca é 'users';
//   • a ficha que já existe só ganha o que falta.

const CPF_A = "52998224725";
const CPF_B = "11144477735";
const CPF_C = "39053344705";
const CPF_D = "15350946056";
const CNPJ_E = "11222333000181";

const ESCOPO: CarteiraDoEscopo[] = [
  { chaveLsoft: "Garden", nome: "Garden", slug: "garden" },
  { chaveLsoft: "Ed. Rubi", nome: "Ed. Rubi", slug: "ed-rubi" },
];

function boleto(parcial: Partial<LinhaDeBoleto> & { id: string }): LinhaDeBoleto {
  return { contato: null, documento: null, empreendimento: "garden", nome: null, unidade: "Q01 L01", ...parcial };
}

function lsoft(parcial: Partial<ClienteLsoft> & { codigo: string }): ClienteLsoft {
  return {
    bairro: null, celular: null, cep: null, cidade: null, complemento: null, conjuge: null, cpf: null,
    email: null, endereco: null, escolaridade: null, estado: null, estado_civil: null, faixa_renda: null,
    mae: null, nacionalidade: null, nascimento: null, naturalidade: null, nome: null, nome_pai: null,
    numero: null, pai: null, profissao: null, regime_bens: null, rg: null, sexo: null, telefone: null,
    ...parcial,
  };
}

function entrada(parcial: Partial<EntradaDoPlano>): EntradaDoPlano {
  return {
    boletos: [],
    carteirasLsoft: [],
    clientesLsoft: [],
    data: "2026-10-02",
    escopo: ESCOPO,
    fichasPorDocumento: new Map(),
    identificadoresExistentes: new Map(),
    telefonesEntregues: new Set(),
    ...parcial,
  };
}

describe("as peças que precisam bater com o servidor", () => {
  it("o hash e o id determinístico são os mesmos de lib/apolo/server.ts", () => {
    expect(hashDoIdentificador("cpf", CPF_A)).toBe(hashIdentifier("cpf", CPF_A));
    expect(hashDoIdentificador("email", "Fulano@Teste.com")).toBe(hashIdentifier("email", "Fulano@Teste.com"));
    expect(uuidDeterministico("apolo:cecilio:lsoft:00000348")).toBe(deterministicUuid("apolo:cecilio:lsoft:00000348"));
  });

  it("só aceita documento com dígito verificador válido", () => {
    expect(tipoDoDocumento(CPF_A)).toBe("cpf");
    expect(tipoDoDocumento(CNPJ_E)).toBe("cnpj");
    expect(tipoDoDocumento("52998224724")).toBeNull();
    expect(tipoDoDocumento("11111111111")).toBeNull();
  });
});

describe("lerContato", () => {
  it("põe o nono dígito no celular antigo e reconhece e-mail e recado", () => {
    expect(lerContato("21 9876-0001")).toEqual({ normalizado: "21998760001", tipo: "telefone", valor: "(21) 99876-0001" });
    expect(lerContato(" Fulano@Teste.com ")).toEqual({ tipo: "email", valor: "fulano@teste.com" });
    expect(lerContato("PAGA AQUI - NÃO FAZER")).toEqual({ tipo: "recado", valor: "PAGA AQUI - NÃO FAZER" });
    expect(lerContato("")).toEqual({ tipo: "vazio" });
  });

  it("fixo continua fixo", () => {
    expect(lerContato("(31) 3222-1100")).toMatchObject({ normalizado: "3132221100", tipo: "telefone" });
  });
});

describe("montarPlano: quem entra", () => {
  it("entra quem tem boleto no escopo; carteira de teste e código do LSoft na unidade ficam fora", () => {
    const plano = montarPlano(
      entrada({
        boletos: [
          boleto({ documento: CPF_A, id: "b1", nome: "ANA TESTE" }),
          boleto({ documento: CPF_B, empreendimento: "teste-garden", id: "b2", nome: "BIA TESTE" }),
          boleto({ documento: CPF_C, id: "b3", nome: "CAIO TESTE", unidade: "00000348" }),
          boleto({ documento: "12345678900", id: "b4", nome: "DOC ERRADO" }),
        ],
      }),
    );

    expect(plano.pessoas.map((p) => p.documento)).toEqual([CPF_A]);
    expect(plano.listas.unidadeComCodigo).toHaveLength(1);
    expect(plano.listas.documentoInvalido).toHaveLength(1);
  });

  it("do LSoft, entra quem tem parcela ABERTA numa carteira do escopo, com a carteira e sem unidade", () => {
    const plano = montarPlano(
      entrada({
        carteirasLsoft: [
          { codigo: "001", empreendimento: "Ed. Rubi", parcelas_abertas: 3 },
          { codigo: "002", empreendimento: "Garden", parcelas_abertas: 0 },
          { codigo: "003", empreendimento: "A classificar", parcelas_abertas: 5 },
          { codigo: "004", empreendimento: "Garden", parcelas_abertas: 2 },
        ],
        clientesLsoft: [
          lsoft({ codigo: "001", cpf: CPF_A, nome: "ANA TESTE" }),
          lsoft({ codigo: "002", cpf: CPF_B, nome: "BIA TESTE" }),
          lsoft({ codigo: "003", cpf: CPF_C, nome: "CAIO TESTE" }),
          lsoft({ codigo: "004", cpf: null, nome: "SEM DOCUMENTO" }),
        ],
      }),
    );

    expect(plano.pessoas.map((p) => p.documento)).toEqual([CPF_A]);
    expect(plano.pessoas[0]?.unidades).toEqual([{ carteira: "Ed. Rubi", unidade: null }]);
    expect(plano.listas.semDocumento).toEqual([{ carteiras: ["Garden"], codigo: "004", nome: "SEM DOCUMENTO" }]);
  });

  it("o par CRUZADO fica fora e vai para a lista; o nome só diferente fica e é listado", () => {
    const plano = montarPlano(
      entrada({
        boletos: [
          boleto({ documento: CPF_A, id: "b1", nome: "BRUNO TROCADO", unidade: "Q01 L01" }),
          boleto({ documento: CPF_B, id: "b2", nome: "ANA TROCADA", unidade: "Q01 L02" }),
          boleto({ documento: CPF_C, id: "b3", nome: "MARIA DA SILVA", unidade: "Q02 L01" }),
        ],
        clientesLsoft: [
          lsoft({ codigo: "001", cpf: CPF_A, nome: "ANA TROCADA" }),
          lsoft({ codigo: "002", cpf: CPF_B, nome: "BRUNO TROCADO" }),
          lsoft({ codigo: "003", cpf: CPF_C, nome: "JOSE DA SILVA" }),
        ],
      }),
    );

    expect(plano.listas.cruzados).toEqual([{ carteiras: ["Garden"], documentos: [CPF_B, CPF_A].sort() }]);
    expect(plano.pessoas.map((p) => p.documento)).toEqual([CPF_C]);
    expect(plano.listas.nomeDiferente).toEqual([
      { documento: CPF_C, grafia: false, kind: "pf", nomeBoleto: "MARIA DA SILVA", nomeLsoft: "JOSE DA SILVA" },
    ]);
  });

  it("acha o par cruzado mesmo quando o boleto ABREVIA o nome", () => {
    const plano = montarPlano(
      entrada({
        boletos: [
          boleto({ documento: CPF_A, id: "b1", nome: "OTAVIO MÁRIO PRADO", unidade: "Q01 L01" }),
          boleto({ documento: CPF_B, id: "b2", nome: "CELSO BRANDÃO", unidade: "Q01 L02" }),
        ],
        clientesLsoft: [
          lsoft({ codigo: "001", cpf: CPF_A, nome: "CELSO BRANDAO DE ARAUJO" }),
          lsoft({ codigo: "002", cpf: CPF_B, nome: "OTAVIO MARIO PRADO" }),
        ],
      }),
    );

    expect(plano.listas.cruzados).toHaveLength(1);
    expect(plano.pessoas).toEqual([]);
  });

  it("só a grafia do primeiro nome mudando: listado, mas o telefone do boleto NÃO fica em atenção", () => {
    const plano = montarPlano(
      entrada({
        boletos: [boleto({ contato: "21 9876-0001", documento: CPF_A, id: "b1", nome: "TIAGO MOURA PESSANHA" })],
        clientesLsoft: [lsoft({ codigo: "001", cpf: CPF_A, nome: "THIAGO MOURA PESSANHA" })],
      }),
    );

    expect(plano.listas.nomeDiferente[0]?.grafia).toBe(true);
    expect(plano.pessoas[0]?.contatos[0]).toMatchObject({ identificar: true, status: "pending" });
  });
});

describe("montarPlano: em que ficha", () => {
  const ficha = (id: string, parcial: Partial<FichaExistente> = {}): FichaExistente => ({
    contatos: [], displayName: "FICHA", id, identificadores: [], metadata: {}, perfis: ["usuario"],
    status: "active", temEndereco: false, ...parcial,
  });

  it("ficha nova ganha id determinístico pelo código do LSoft, ou pelo boleto quando não há LSoft", () => {
    const plano = montarPlano(
      entrada({
        boletos: [boleto({ documento: CPF_A, id: "b1", nome: "ANA" }), boleto({ documento: CPF_B, id: "b2", nome: "BIA" })],
        clientesLsoft: [lsoft({ codigo: "00000348", cpf: CPF_A, nome: "ANA COMPLETA" })],
      }),
    );
    // O plano sai ordenado pelo documento; cada pessoa é achada pelo dela.
    const a = plano.pessoas.find((p) => p.documento === CPF_A);
    const b = plano.pessoas.find((p) => p.documento === CPF_B);

    expect(a?.acao).toBe("nova");
    expect(a?.entityId).toBe(uuidDeterministico("apolo:cecilio:lsoft:00000348"));
    expect(a?.nome).toBe("ANA COMPLETA");
    expect(b?.entityId).toBe(uuidDeterministico("apolo:cecilio:boleto:b2"));
    expect(b?.nome).toBe("BIA");
  });

  it("documento com DUAS fichas ativas fica fora, e a lista diz quais", () => {
    const plano = montarPlano(
      entrada({
        boletos: [boleto({ documento: CNPJ_E, id: "b1", nome: "EMPRESA" })],
        fichasPorDocumento: new Map([[CNPJ_E, [ficha("f1"), ficha("f2")]]]),
      }),
    );

    expect(plano.pessoas).toEqual([]);
    expect(plano.listas.fichasAmbiguas).toEqual([{ documento: CNPJ_E, fichas: ["f1", "f2"] }]);
  });

  it("a ficha que já existe só ganha o que falta: nem o documento, nem o contato que ela já tem", () => {
    const plano = montarPlano(
      entrada({
        boletos: [boleto({ contato: "(21) 99876-0001", documento: CPF_A, id: "b1", nome: "ANA" })],
        clientesLsoft: [lsoft({ celular: "37 98888-7777", codigo: "001", cpf: CPF_A, nome: "ANA" })],
        fichasPorDocumento: new Map([
          [
            CPF_A,
            [
              ficha("f1", {
                contatos: [{ contact_type: "phone", normalized_value: "5521998760001", value: "+55 21 99876-0001" }],
                identificadores: [{ identifier_type: "cpf", value_hash: hashDoIdentificador("cpf", CPF_A) }],
                temEndereco: true,
              }),
            ],
          ],
        ]),
        identificadoresExistentes: new Map([[hashDoIdentificador("phone", "21998760001"), new Set(["f1"])]]),
      }),
    );
    const [p] = plano.pessoas;

    expect(p?.acao).toBe("reaproveitar");
    expect(p?.entityId).toBe("f1");
    expect(p?.contatos.map((c) => c.normalizado)).toEqual(["37988887777"]);
    expect(p?.identificadores.map((i) => i.identifier_type)).toEqual(["phone", "legacy_id"]);
    expect(p && perfisDaPessoa(p)).toEqual(["comprador_cecilio"]);
  });
});

describe("montarPlano: os contatos", () => {
  it("WhatsApp do boleto entregue vira 'verified' e primário; celular do LSoft vira 'phone' pendente", () => {
    const plano = montarPlano(
      entrada({
        boletos: [boleto({ contato: "21 9876-0001", documento: CPF_A, id: "b1", nome: "ANA" })],
        clientesLsoft: [lsoft({ celular: "37 98888-7777", codigo: "001", cpf: CPF_A, nome: "ANA" })],
        telefonesEntregues: new Set(["21998760001"]),
      }),
    );

    expect(plano.pessoas[0]?.contatos).toEqual([
      expect.objectContaining({ identificar: true, normalizado: "21998760001", primario: true, status: "verified", tipo: "whatsapp" }),
      expect.objectContaining({ identificar: true, normalizado: "37988887777", primario: false, status: "pending", tipo: "phone" }),
    ]);
  });

  it("telefone dividido entre duas pessoas vira 'attention' e não vira identificador", () => {
    const plano = montarPlano(
      entrada({
        boletos: [
          boleto({ contato: "(21) 99876-0001", documento: CPF_A, id: "b1", nome: "ANA" }),
          boleto({ contato: "(21) 99876-0001", documento: CPF_B, id: "b2", nome: "BRUNO", unidade: "Q01 L02" }),
        ],
      }),
    );

    for (const p of plano.pessoas) {
      expect(p.contatos[0]).toMatchObject({ compartilhado: true, identificar: false, status: "attention" });
      expect(p.identificadores.some((i) => i.identifier_type === "phone")).toBe(false);
    }
    expect(plano.listas.telefonesCompartilhados).toHaveLength(1);
  });

  it("telefone que já é identificador de OUTRA ficha do Apolo também vira 'attention', em qualquer formato", () => {
    const plano = montarPlano(
      entrada({
        boletos: [boleto({ contato: "21 9876-0001", documento: CPF_A, id: "b1", nome: "ANA" })],
        identificadoresExistentes: new Map([[hashDoIdentificador("phone", "5521998760001"), new Set(["outra-ficha"])]]),
      }),
    );

    expect(plano.pessoas[0]?.contatos[0]).toMatchObject({ identificar: false, status: "attention" });
    expect(plano.listas.telefonesCompartilhados[0]?.outrasFichas).toEqual(["outra-ficha"]);
  });

  it("nome divergente em pessoa física: o telefone do boleto pode ser de outra pessoa", () => {
    const plano = montarPlano(
      entrada({
        boletos: [boleto({ contato: "21 9876-0001", documento: CPF_C, id: "b1", nome: "MARIA DA SILVA" })],
        clientesLsoft: [lsoft({ celular: "37 98888-7777", codigo: "003", cpf: CPF_C, nome: "JOSE DA SILVA" })],
      }),
    );

    expect(plano.pessoas[0]?.contatos).toEqual([
      expect.objectContaining({ origem: "boleto", status: "attention" }),
      expect.objectContaining({ origem: "lsoft", status: "pending" }),
    ]);
  });

  it("recado no lugar do contato não vira contato, e o e-mail do boleto vira e-mail", () => {
    const plano = montarPlano(
      entrada({
        boletos: [
          boleto({ contato: "PAGA AQUI - NÃO FAZER", documento: CPF_A, empreendimento: "ed-rubi", id: "b1", nome: "ANA", unidade: "201" }),
          boleto({ contato: "Ana@Teste.com", documento: CPF_D, id: "b2", nome: "DANI" }),
        ],
      }),
    );
    const [ana, dani] = plano.pessoas.sort((x, y) => x.documento.localeCompare(y.documento));

    expect(plano.listas.recados).toEqual([{ carteira: "Ed. Rubi", unidade: "201" }]);
    expect([...(ana?.contatos ?? []), ...(dani?.contatos ?? [])].map((c) => [c.tipo, c.normalizado])).toEqual([
      ["email", "ana@teste.com"],
    ]);
  });
});

describe("as linhas gravadas", () => {
  const plano = montarPlano(
    entrada({
      boletos: [
        boleto({ contato: "21 9876-0001", documento: CPF_A, id: "b1", nome: "ANA", unidade: "Q01 L01" }),
        boleto({ documento: CPF_A, empreendimento: "ed-rubi", id: "b2", nome: "ANA", unidade: "201" }),
      ],
      clientesLsoft: [lsoft({ cidade: "Pará de Minas", codigo: "001", cpf: CPF_A, estado: "MG", nascimento: "1980-05-04", nome: "ANA COMPLETA" })],
    }),
  );
  const [p] = plano.pessoas;
  if (!p) throw new Error("a pessoa de teste não entrou no plano");

  it("a origem é 'cecilio', nunca 'apolo', e a ficha nasce ativa, fora da fila do Board", () => {
    const ficha = linhaDaFichaNova(p, "2026-10-02");
    expect(ficha.metadata.source).toBe("cecilio");
    expect(ficha.metadata.carga).toBe(ETIQUETA_DA_CARGA);
    expect(ficha.status).toBe("active");
    expect(ficha.metadata.cecilio.unidades).toEqual([
      { carteira: "Garden", unidade: "Q01 L01" },
      { carteira: "Ed. Rubi", unidade: "201" },
    ]);
    expect(ficha.metadata.cadastro).toEqual({ dataNascimento: "1980-05-04" });
  });

  it("a fonte nunca é 'users' (o mapeamento do C2X leria o código do LSoft como usuário do legado)", () => {
    expect(p.fontes.map((f) => f.source_table).sort()).toEqual(["boletos_documentos", "boletos_documentos", "lsoft_clientes"]);
  });

  it("a linha de busca tem os NOT NULL preenchidos e acha por carteira, unidade e telefone", () => {
    const busca = linhaDeBusca(p);
    expect(busca.status).toBe("active");
    expect(busca.display_name).toBe("ANA COMPLETA");
    expect(busca.normalized_text).toContain("ed. rubi");
    expect(busca.normalized_text).toContain("q01 l01");
    expect(busca.normalized_text).toContain("(21) 99876-0001");
    expect(busca.normalized_text).toContain("comprador cecilio");
    expect(perfisDaPessoa(p)).toEqual(["comprador_cecilio", "pessoa_fisica"]);
  });
});
