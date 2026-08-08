import { describe, expect, it } from "vitest";

import {
  categoriasComArquivo,
  documentosFaltando,
  requisitosDocumentos,
  validarCamposMinimos,
  validarDocumentosObrigatorios,
} from "./cadastro-obrigatorios";

// Um "arquivo anexado" é qualquer documento com fileBase64 presente — NUNCA depende de OCR.
const arquivo = (categoria: string, fileBase64 = "QkFTRTY0") => ({ categoria, fileBase64 });

// CPFs com dígito verificador válido/ inválido (mesmos de documento.test.ts).
const CPF_VALIDO = "139.544.576-10";
const CPF_INVALIDO = "139.544.576-11";
const CNPJ_QUALQUER = "11.222.333/0001-81"; // 14 dígitos
// Naturalidade no formato que o documento devolve (cidade / UF). É dela que sai a nacionalidade.
const NATURALIDADE = "Goiânia / GO";

describe("requisitosDocumentos", () => {
  it("PF solteiro exige identificação + comprovante de endereço", () => {
    const req = requisitosDocumentos({ persona: "pf", estadoCivilId: "1" });
    const casa = (categoria: string) => req.some((r) => r.match(categoria));
    expect(casa("identificacao")).toBe(true);
    expect(casa("comprovante_endereco")).toBe(true);
    expect(casa("certidao")).toBe(false);
    expect(casa("identificacao_conjuge")).toBe(false);
  });

  it("PF casado (2) acrescenta certidão e identificação do cônjuge", () => {
    const req = requisitosDocumentos({ persona: "pf", estadoCivilId: "2" });
    const casa = (categoria: string) => req.some((r) => r.match(categoria));
    expect(casa("certidao")).toBe(true);
    expect(casa("identificacao_conjuge")).toBe(true);
  });

  it("PF divorciado (3) exige certidão mas NÃO cônjuge", () => {
    const req = requisitosDocumentos({ persona: "pf", estadoCivilId: "3" });
    const casa = (categoria: string) => req.some((r) => r.match(categoria));
    expect(casa("certidao")).toBe(true);
    expect(casa("identificacao_conjuge")).toBe(false);
  });

  it("PJ exige cartão CNPJ + contrato social + documentos de sócio", () => {
    const req = requisitosDocumentos({ persona: "pj" });
    const casa = (categoria: string) => req.some((r) => r.match(categoria));
    expect(casa("identificacao")).toBe(true); // cartão CNPJ chega nesta categoria
    expect(casa("contrato_social")).toBe(true);
    expect(casa("identificacao_socio_1")).toBe(true);
    expect(casa("comprovante_socio_2")).toBe(true);
  });
});

describe("categoriasComArquivo", () => {
  it("conta só documentos com fileBase64 presente (ignora anexo vazio)", () => {
    const cats = categoriasComArquivo([
      arquivo("identificacao"),
      { categoria: "comprovante_endereco", fileBase64: "" }, // sem arquivo → não conta
      { categoria: "certidao" }, // sem fileBase64 → não conta
    ]);
    expect(cats).toEqual(["identificacao"]);
  });

  it("aceita document_type como alternativa a categoria", () => {
    const cats = categoriasComArquivo([{ document_type: "COMPROVANTE_ENDERECO", fileBase64: "x" }]);
    expect(cats).toEqual(["comprovante_endereco"]);
  });

  // Documento GRANDE sobe direto pro Storage e viaja como CAMINHO, sem base64 no corpo. Se a trava
  // só olhasse fileBase64, a CAD completa passaria a ser recusada por "falta documento".
  it("conta o documento que subiu direto (storagePath, sem base64)", () => {
    const cats = categoriasComArquivo([
      { categoria: "comprovante_endereco", storagePath: "entidade/_pendente/s-1/abc-conta.pdf" },
      { categoria: "certidao", storagePath: "  " }, // caminho vazio → não conta
    ]);
    expect(cats).toEqual(["comprovante_endereco"]);
  });
});

describe("validarDocumentosObrigatorios — PF", () => {
  it("sem identificação → 400 acionável", () => {
    const r = validarDocumentosObrigatorios({
      persona: "pf",
      perfil: { estadoCivilId: "1" },
      documentos: [arquivo("comprovante_endereco")],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.faltando).toContain("o documento de identificação");
      expect(r.mensagem).toBe("Anexe o documento de identificação para enviar o cadastro.");
    }
  });

  it("sem comprovante de endereço → 400 acionável", () => {
    const r = validarDocumentosObrigatorios({
      persona: "pf",
      perfil: { estadoCivilId: "1" },
      documentos: [arquivo("identificacao")],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.faltando).toContain("o comprovante de endereço");
      expect(r.mensagem).toBe("Anexe o comprovante de endereço para enviar o cadastro.");
    }
  });

  it("faltando os dois → mensagem lista os dois", () => {
    const r = validarDocumentosObrigatorios({
      persona: "pf",
      perfil: { estadoCivilId: "1" },
      documentos: [],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.mensagem).toBe(
        "Anexe o documento de identificação e o comprovante de endereço para enviar o cadastro.",
      );
    }
  });

  it("completo (identificação + comprovante) → passa, sem depender de OCR", () => {
    const r = validarDocumentosObrigatorios({
      persona: "pf",
      perfil: { estadoCivilId: "1" },
      // Documentos anexados sem NENHUM payload de OCR — só o arquivo. Tem que passar.
      documentos: [arquivo("identificacao"), arquivo("comprovante_endereco")],
    });
    expect(r.ok).toBe(true);
  });

  it("casado sem certidão e sem cônjuge → barra e lista os dois", () => {
    const r = validarDocumentosObrigatorios({
      persona: "pf",
      perfil: { estadoCivilId: "2" },
      documentos: [arquivo("identificacao"), arquivo("comprovante_endereco")],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.faltando).toContain("a certidão de estado civil");
      expect(r.faltando).toContain("o documento de identificação do cônjuge");
    }
  });

  // Mistura dos DOIS caminhos: identificação pequena veio em base64, comprovante grande subiu
  // direto pro Storage. A trava tem que aceitar as duas formas na mesma CAD.
  it("identificação em base64 + comprovante por caminho no Storage → passa", () => {
    const r = validarDocumentosObrigatorios({
      persona: "pf",
      perfil: { estadoCivilId: "1" },
      documentos: [
        arquivo("identificacao"),
        {
          categoria: "comprovante_endereco",
          storagePath: "entidade/_pendente/u-abc/1234-conta-de-luz.pdf",
        },
      ],
    });
    expect(r.ok).toBe(true);
  });

  it("casado completo (id + comprovante + certidão + cônjuge) → passa", () => {
    const r = validarDocumentosObrigatorios({
      persona: "pf",
      perfil: { estadoCivilId: "2" },
      documentos: [
        arquivo("identificacao"),
        arquivo("comprovante_endereco"),
        arquivo("certidao"),
        arquivo("identificacao_conjuge"),
      ],
    });
    expect(r.ok).toBe(true);
  });
});

describe("validarDocumentosObrigatorios — PJ", () => {
  it("só o cartão CNPJ → barra contrato social + sócios", () => {
    const r = validarDocumentosObrigatorios({
      persona: "pj",
      documentos: [arquivo("identificacao")],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.faltando).toContain("o contrato social");
      expect(r.faltando).toContain("o documento de identificação de ao menos um sócio");
      expect(r.faltando).toContain("o comprovante de endereço de ao menos um sócio");
    }
  });

  it("completo (cartão CNPJ + contrato + sócio id + sócio comprovante) → passa", () => {
    const r = validarDocumentosObrigatorios({
      persona: "pj",
      documentos: [
        arquivo("identificacao"),
        arquivo("contrato_social"),
        arquivo("identificacao_socio_1"),
        arquivo("comprovante_socio_1"),
      ],
    });
    expect(r.ok).toBe(true);
  });
});

describe("validarCamposMinimos", () => {
  it("PF sem nome → barra", () => {
    const r = validarCamposMinimos({
      persona: "pf",
      identidade: { cpf: CPF_VALIDO, naturalidade: NATURALIDADE, nome: "  " },
    });
    expect(r.ok).toBe(false);
  });

  it("PF com CPF inválido (dígito verificador) → barra", () => {
    const r = validarCamposMinimos({
      persona: "pf",
      identidade: { cpf: CPF_INVALIDO, naturalidade: NATURALIDADE, nome: "Fulano" },
    });
    expect(r.ok).toBe(false);
  });

  // Incidente 05/08: 8 CADs recusadas pelo C2X por "Naturalidade/Nacionalidade não pode ficar em
  // branco". A nacionalidade é derivada da naturalidade, então basta cobrar a cidade de nascimento.
  it("PF sem naturalidade → barra com mensagem acionável", () => {
    const r = validarCamposMinimos({
      persona: "pf",
      identidade: { cpf: CPF_VALIDO, nome: "Fulano de Tal" },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.mensagem).toBe(
        "Informe a naturalidade (a cidade de nascimento do cliente) para enviar o cadastro.",
      );
    }
  });

  it("PF com naturalidade só de espaços → barra", () => {
    const r = validarCamposMinimos({
      persona: "pf",
      identidade: { cpf: CPF_VALIDO, naturalidade: "   ", nome: "Fulano de Tal" },
    });
    expect(r.ok).toBe(false);
  });

  it("PF com nome + CPF válido + naturalidade → passa", () => {
    const r = validarCamposMinimos({
      persona: "pf",
      identidade: { cpf: CPF_VALIDO, naturalidade: NATURALIDADE, nome: "Fulano de Tal" },
    });
    expect(r.ok).toBe(true);
  });

  // A naturalidade digitada à mão (OCR não leu) vale igual: a trava é de DADO, não de leitura
  // (v1.105.0 — o MOST nunca trava o cadastro).
  it("PF com naturalidade só de cidade, sem UF → passa", () => {
    const r = validarCamposMinimos({
      persona: "pf",
      identidade: { cpf: CPF_VALIDO, naturalidade: "Anápolis", nome: "Fulano de Tal" },
    });
    expect(r.ok).toBe(true);
  });

  it("PJ sem razão social → barra", () => {
    const r = validarCamposMinimos({ persona: "pj", empresa: { cnpj: CNPJ_QUALQUER } });
    expect(r.ok).toBe(false);
  });

  it("PJ com razão social + CNPJ de 14 dígitos → passa", () => {
    const r = validarCamposMinimos({
      persona: "pj",
      empresa: { cnpj: CNPJ_QUALQUER, razaoSocial: "Empresa X LTDA" },
    });
    expect(r.ok).toBe(true);
  });
});

describe("documentosFaltando (forma de frase)", () => {
  it("tudo presente → lista vazia", () => {
    const faltando = documentosFaltando({ persona: "pf", estadoCivilId: "1" }, [
      "identificacao",
      "comprovante_endereco",
    ]);
    expect(faltando).toEqual([]);
  });
});
