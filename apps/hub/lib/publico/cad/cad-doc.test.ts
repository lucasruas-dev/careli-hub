import { describe, expect, it } from "vitest";

import { montarFichaCad, type FichaPublica } from "@/lib/publico/cad/cad-doc";
import { montarCadPdf } from "@/modules/apolo/blocks/cadastro/cad-pdf";

// A CAD é o entregável final do corretor. Estes testes cobrem as duas mudanças pedidas pelo
// Lucas (logo do C2X + nome do corretor) e, principalmente, garantem que o PDF continua sendo
// GERADO: o gerador roda no servidor, no fim de um fluxo longo, e falha ali significa o
// corretor perder o preenchimento inteiro.

const FICHA: FichaPublica = {
  endereco: {
    bairro: "Centro",
    cep: "35500-000",
    cidade: "Divinópolis",
    complemento: "Apto 302",
    logradouro: "Rua das Flores",
    numero: "120",
    uf: "MG",
  },
  identidade: {
    cpf: "52998224725",
    dataNascimento: "10/03/1985",
    nacionalidade: "Brasileira",
    naturalidade: "Divinópolis",
    nome: "Maria Aparecida da Silva",
    nomeMae: "Joana da Silva",
    nomePai: "",
    orgaoEmissor: "SSP/MG",
    rg: "12.345.678",
    sexo: "F",
  },
  perfil: { email: "maria@exemplo.com", estadoCivil: "Solteira", telefone: "37999569096" },
};

const CONTEXTO = {
  corretorNome: "Ana Souza",
  empreendimentoNome: "Vale do Ouro",
  imobiliariaNome: "Imob Alfa",
};

describe("montagem da ficha", () => {
  it("leva imobiliária e corretor em campos PRÓPRIOS, não concatenados", () => {
    const cad = montarFichaCad(FICHA, CONTEXTO);
    expect(cad.imobiliaria).toBe("Imob Alfa");
    expect(cad.corretor).toBe("Ana Souza");
  });

  it("formata o CPF do cliente no padrão completo (é como o Apolo indexa)", () => {
    const cad = montarFichaCad(FICHA, CONTEXTO);
    const identificacao = cad.secoes.find((s) => s.title === "Identificacao");
    expect(identificacao?.fields.find((f) => f.label === "CPF")?.value).toBe("529.982.247-25");
  });

  it("registra o empreendimento na ficha: a CAD não nasce sem origem", () => {
    const cad = montarFichaCad(FICHA, CONTEXTO);
    const origem = cad.secoes.find((s) => s.title === "Origem do envio");
    expect(origem?.fields[0]?.value).toBe("Vale do Ouro");
  });

  it("o nome do arquivo carrega o nome do cliente", () => {
    expect(montarFichaCad(FICHA, CONTEXTO).arquivo).toContain("Maria Aparecida da Silva");
  });
});

describe("geração do PDF", () => {
  it("gera um PDF válido com logo, imobiliária e corretor", async () => {
    const cad = montarFichaCad(FICHA, CONTEXTO);
    const bytes = await montarCadPdf({ ...cad, autenticacao: "CAD-2026-AB12CD34" });

    // %PDF- no começo: é PDF de verdade, não string de erro.
    expect(Buffer.from(bytes.slice(0, 5)).toString()).toBe("%PDF-");
    // Com a logo embutida o arquivo passa folgado de 5KB; um PDF sem imagem fica bem abaixo.
    expect(bytes.byteLength).toBeGreaterThan(5000);
  });

  it("a CAD da IMOBILIÁRIA (sem vínculo) continua gerando: era o comportamento a preservar", async () => {
    const bytes = await montarCadPdf({
      arquivo: "CAD - Imob Alfa",
      autenticacao: "CAD-2026-ZZ99ZZ99",
      data: "20/07/2026",
      hora: "10:30",
      nome: "Imob Alfa LTDA",
      papel: "Imobiliaria",
      secoes: [{ fields: [{ label: "CNPJ", value: "11.222.333/0001-81" }], title: "Empresa" }],
      titulo: "Cadastro de imobiliaria",
    });
    expect(Buffer.from(bytes.slice(0, 5)).toString()).toBe("%PDF-");
  });

  it("aceita o `vinculo` legado do wizard interno sem quebrar", async () => {
    const bytes = await montarCadPdf({
      arquivo: "CAD - Fulano",
      data: "20/07/2026",
      hora: "10:30",
      nome: "Fulano de Tal",
      papel: "Prospect",
      secoes: [{ fields: [{ label: "CPF", value: "529.982.247-25" }], title: "Identificacao" }],
      vinculo: "Imob Legado",
    });
    expect(Buffer.from(bytes.slice(0, 5)).toString()).toBe("%PDF-");
  });
});
