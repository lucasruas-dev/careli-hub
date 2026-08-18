import { describe, expect, it } from "vitest";

import {
  COMPROVANTE_RENDA_LABELS,
  COMPROVANTE_RENDA_OPCOES,
  categoriasComArquivo,
  documentosFaltando,
  documentosFaltandoCurto,
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

// ---------------------------------------------------------------------------
// COMPROVANTE DE RENDA (etapa por empreendimento — Setup > Comprovante de renda)
// ---------------------------------------------------------------------------
//
// A regra que estes testes protegem é a do pedido do Lucas (18/08/2026), e ela tem DOIS lados que
// quebram de formas opostas:
//   • ligada e faltando o comprovante → tem que RECUSAR (senão a etapa não existe de fato);
//   • DESLIGADA → tem que passar exatamente como hoje (senão a migration muda o comportamento de
//     todos os empreendimentos existentes de uma vez, que é o que o default `false` evita).
describe("comprovante de renda — etapa por empreendimento", () => {
  const PF_COMPLETO = [arquivo("identificacao"), arquivo("comprovante_endereco")];

  it("etapa DESLIGADA: CAD sem comprovante de renda passa (comportamento de hoje)", () => {
    const r = validarDocumentosObrigatorios({
      documentos: PF_COMPLETO,
      perfil: { estadoCivilId: "1" },
      persona: "pf",
    });
    expect(r.ok).toBe(true);
  });

  it("flag ausente é igual a desligada (default da coluna é false)", () => {
    const req = requisitosDocumentos({ persona: "pf", estadoCivilId: "1" });
    expect(req.some((r) => r.match("comprovante_renda_extrato"))).toBe(false);
  });

  it("etapa LIGADA e sem comprovante: RECUSA com mensagem que lista as três formas", () => {
    const r = validarDocumentosObrigatorios({
      documentos: PF_COMPLETO,
      exigeComprovanteRenda: true,
      perfil: { estadoCivilId: "1" },
      persona: "pf",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.faltando).toEqual([
        "o comprovante de renda (extrato bancário dos últimos 3 meses, contracheque ou declaração de imposto de renda)",
      ]);
      expect(r.mensagem).toBe(
        "Anexe o comprovante de renda (extrato bancário dos últimos 3 meses, contracheque ou declaração de imposto de renda) para enviar o cadastro.",
      );
    }
  });

  // O cliente entrega UM dos três: qualquer um satisfaz. Se algum dia só o extrato passar, a etapa
  // vira "traga o extrato", que não foi o que o dono pediu.
  it.each(COMPROVANTE_RENDA_OPCOES.map((opcao) => opcao.categoria))(
    "etapa LIGADA: %s sozinho já satisfaz a exigência",
    (categoria) => {
      const r = validarDocumentosObrigatorios({
        documentos: [...PF_COMPLETO, arquivo(categoria)],
        exigeComprovanteRenda: true,
        perfil: { estadoCivilId: "1" },
        persona: "pf",
      });
      expect(r.ok).toBe(true);
    },
  );

  // A trava conta o ARQUIVO anexado, nunca leitura — e o comprovante de renda não passa nem por
  // OCR. Categoria certa sem arquivo é o caso do payload forjado/estado parcial.
  it("etapa LIGADA: categoria de renda SEM arquivo não conta", () => {
    const r = validarDocumentosObrigatorios({
      documentos: [...PF_COMPLETO, { categoria: "comprovante_renda_contracheque", fileBase64: "" }],
      exigeComprovanteRenda: true,
      perfil: { estadoCivilId: "1" },
      persona: "pf",
    });
    expect(r.ok).toBe(false);
  });

  // Documento grande sobe direto pro Storage e viaja como CAMINHO (a Vercel corta o corpo em
  // ~4,5MB). Extrato de 3 meses em PDF é justamente o candidato a esse caminho: se só o base64
  // contasse, a CAD seria recusada por "falta comprovante" com o arquivo já gravado no bucket.
  it("etapa LIGADA: comprovante que subiu direto (storagePath) conta", () => {
    const r = validarDocumentosObrigatorios({
      documentos: [
        ...PF_COMPLETO,
        {
          categoria: "comprovante_renda_extrato",
          storagePath: "entidade/_pendente/s-abc/1234-extrato.pdf",
        },
      ],
      exigeComprovanteRenda: true,
      perfil: { estadoCivilId: "1" },
      persona: "pf",
    });
    expect(r.ok).toBe(true);
  });

  // Categoria fora das três (nome inventado num payload forjado, ou resíduo de versão antiga) NÃO
  // pode satisfazer a exigência: o que vale é a família fechada.
  it("etapa LIGADA: categoria parecida mas fora das três não satisfaz", () => {
    const r = validarDocumentosObrigatorios({
      documentos: [...PF_COMPLETO, arquivo("comprovante_renda"), arquivo("renda")],
      exigeComprovanteRenda: true,
      perfil: { estadoCivilId: "1" },
      persona: "pf",
    });
    expect(r.ok).toBe(false);
  });

  it("etapa LIGADA no PJ: exige o comprovante junto do resto", () => {
    const pjCompleto = [
      arquivo("identificacao"),
      arquivo("contrato_social"),
      arquivo("identificacao_socio_1"),
      arquivo("comprovante_socio_1"),
    ];
    const sem = validarDocumentosObrigatorios({
      documentos: pjCompleto,
      exigeComprovanteRenda: true,
      persona: "pj",
    });
    expect(sem.ok).toBe(false);

    const com = validarDocumentosObrigatorios({
      documentos: [...pjCompleto, arquivo("comprovante_renda_irpf")],
      exigeComprovanteRenda: true,
      persona: "pj",
    });
    expect(com.ok).toBe(true);
  });

  // Ligar a etapa não pode apagar nenhuma exigência antiga: o pedido é "ALÉM dos documentos que
  // são necessários".
  it("etapa LIGADA no casado: soma ao conjunto de sempre, não substitui", () => {
    const r = validarDocumentosObrigatorios({
      documentos: [arquivo("identificacao")],
      exigeComprovanteRenda: true,
      perfil: { estadoCivilId: "2" },
      persona: "pf",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.faltando).toContain("o comprovante de endereço");
      expect(r.faltando).toContain("a certidão de estado civil");
      expect(r.faltando).toContain("o documento de identificação do cônjuge");
      expect(r.faltando).toContain(
        "o comprovante de renda (extrato bancário dos últimos 3 meses, contracheque ou declaração de imposto de renda)",
      );
    }
  });

  it("a lista do wizard (forma curta) mostra 'comprovante de renda'", () => {
    const faltando = documentosFaltandoCurto(
      { estadoCivilId: "1", exigeComprovanteRenda: true, persona: "pf" },
      ["identificacao", "comprovante_endereco"],
    );
    expect(faltando).toEqual(["comprovante de renda"]);
  });

  // O rótulo é o que vira o NOME do documento na aba Documentos da ficha: sem a forma entre
  // parênteses, o validador teria que abrir o arquivo para saber o que recebeu.
  it("cada forma tem rótulo próprio, com o tipo identificado", () => {
    expect(COMPROVANTE_RENDA_LABELS).toEqual({
      comprovante_renda_contracheque: "Comprovante de renda (contracheque)",
      comprovante_renda_extrato: "Comprovante de renda (extrato bancário)",
      comprovante_renda_irpf: "Comprovante de renda (imposto de renda)",
    });
  });
});
