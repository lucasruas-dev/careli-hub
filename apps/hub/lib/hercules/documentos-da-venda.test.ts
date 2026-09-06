import { describe, expect, it } from "vitest";

import { codigoDaVenda } from "./codigo-da-venda";
import {
  agruparPorProtocolo,
  caminhoDaUnidadeValido,
  conferirArquivo,
  type DocumentoDaVenda,
  nomeSeguroDeArquivo,
  TAMANHO_MAXIMO,
  tamanhoEscrito,
  textoDaMensagem,
} from "./documentos-da-venda";

const doc = (p: Partial<DocumentoDaVenda> & { id: string }): DocumentoDaVenda => ({
  criado_em: "2026-09-06T12:00:00Z",
  enviado_por_nome: "Lucas Ruas",
  mime: "application/pdf",
  nome: "arquivo.pdf",
  protocolo_numero: 6,
  tamanho_bytes: 1024,
  tipo: "documento",
  ...p,
});

describe("agruparPorProtocolo", () => {
  it("⚠️ separa vendas diferentes no MESMO lote", () => {
    // O 01 04 do Portal dos Vales teve proposta de sete clientes em quatro dias. O RG de quem
    // desistiu não pode aparecer junto com o do comprador seguinte.
    const grupos = agruparPorProtocolo(
      [
        doc({ id: "a", protocolo_numero: 6 }),
        doc({ id: "b", protocolo_numero: 1 }),
        doc({ id: "c", protocolo_numero: 6 }),
      ],
      codigoDaVenda,
    );

    expect(grupos).toHaveLength(2);
    expect(grupos[0]?.protocolo).toBe(6);
    expect(grupos[0]?.codigo).toBe("000006");
    expect(grupos[0]?.documentos.map((d) => d.id).sort()).toEqual(["a", "c"]);
    expect(grupos[1]?.protocolo).toBe(1);
  });

  it("o mais recente primeiro, dentro e fora do grupo", () => {
    const grupos = agruparPorProtocolo(
      [
        doc({ criado_em: "2026-09-01T10:00:00Z", id: "velho", protocolo_numero: 6 }),
        doc({ criado_em: "2026-09-06T10:00:00Z", id: "novo", protocolo_numero: 6 }),
      ],
      codigoDaVenda,
    );
    expect(grupos[0]?.documentos.map((d) => d.id)).toEqual(["novo", "velho"]);
  });

  it("⚠️ o que veio SEM protocolo não some — vai para o fim", () => {
    // Esconder faria um documento desaparecer da tela sem ninguém ter apagado nada.
    const grupos = agruparPorProtocolo(
      [doc({ id: "solto", protocolo_numero: null }), doc({ id: "com", protocolo_numero: 6 })],
      codigoDaVenda,
    );
    expect(grupos.map((g) => g.protocolo)).toEqual([6, null]);
    expect(grupos[1]?.codigo).toBeNull();
  });

  it("lista vazia devolve nada, e não um grupo vazio", () => {
    expect(agruparPorProtocolo([], codigoDaVenda)).toEqual([]);
  });
});

describe("conferirArquivo", () => {
  it("aceita PDF, imagem, Word e Excel", () => {
    for (const nome of ["proposta.pdf", "rg.JPG", "contrato.docx", "planilha.xlsx", "foto.heic"]) {
      expect(conferirArquivo({ nome, tamanho: 2048 }).ok).toBe(true);
    }
  });

  it("⚠️ o teto é 20 MB, o mesmo do Apolo e do LSoft", () => {
    // O primeiro número aqui era 4 MB — regressão autoinfligida por mandar o arquivo PELA function.
    // Com o upload direto, o teto de 4,5 MB da Vercel não se aplica: medido no Apolo, 24 documentos
    // guardados passam de 4 MB (o maior tem 13,5). Três réguas para o mesmo gesto é que seria o erro.
    expect(conferirArquivo({ nome: "contrato.pdf", tamanho: 15 * 1024 * 1024 }).ok).toBe(true);

    const r = conferirArquivo({ nome: "planta.pdf", tamanho: TAMANHO_MAXIMO + 1 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toContain("20 MB");
  });

  it("⚠️ o caminho que volta do navegador é conferido contra a pasta da unidade", () => {
    // Sem isso, um caminho forjado registra na venda A um arquivo da pasta da venda B — e a
    // abertura confia na linha, entregando o documento errado com cara de certo.
    expect(caminhoDaUnidadeValido("hercules/documentos/u1/abc-rg.pdf", "u1")).toBe(true);
    expect(caminhoDaUnidadeValido("hercules/documentos/u2/abc-rg.pdf", "u1")).toBe(false);
    expect(caminhoDaUnidadeValido("hercules/documentos/u1/../u2/x.pdf", "u1")).toBe(false);
    expect(caminhoDaUnidadeValido("", "u1")).toBe(false);
  });

  it("recusa formato de fora da lista", () => {
    const r = conferirArquivo({ nome: "script.exe", tamanho: 2048 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toContain("Formato não aceito");
  });

  it("recusa arquivo sem extensão e arquivo vazio", () => {
    expect(conferirArquivo({ nome: "contrato", tamanho: 10 }).ok).toBe(false);
    expect(conferirArquivo({ nome: "a.pdf", tamanho: 0 }).ok).toBe(false);
    expect(conferirArquivo({ nome: "", tamanho: 10 }).ok).toBe(false);
  });
});

describe("nomeSeguroDeArquivo", () => {
  it("⚠️ tira acento e espaço: eles quebram o caminho do bucket", () => {
    // O erro apareceria só na hora de baixar, com o registro já criado apontando para o nada.
    expect(nomeSeguroDeArquivo("Certidão de Ônus.pdf")).toBe("Certidao-de-Onus.pdf");
  });

  it("não deixa o nome começar nem terminar com ponto ou traço", () => {
    expect(nomeSeguroDeArquivo("...arquivo...")).toBe("arquivo");
    expect(nomeSeguroDeArquivo("   ")).toBe("arquivo");
  });

  it("corta nome quilométrico", () => {
    expect(nomeSeguroDeArquivo("a".repeat(300)).length).toBe(80);
  });
});

describe("tamanhoEscrito", () => {
  it("escreve em B, KB e MB", () => {
    expect(tamanhoEscrito(900)).toBe("900 B");
    expect(tamanhoEscrito(2048)).toBe("2 KB");
    expect(tamanhoEscrito(1_500_000)).toBe("1,4 MB");
  });

  it("sem tamanho, não inventa", () => {
    expect(tamanhoEscrito(null)).toBe("");
    expect(tamanhoEscrito(0)).toBe("");
  });
});

describe("textoDaMensagem", () => {
  it("apara e recusa o vazio", () => {
    expect(textoDaMensagem("  combinado com o corretor  ")).toBe("combinado com o corretor");
    expect(textoDaMensagem("   ")).toBeNull();
    expect(textoDaMensagem(null)).toBeNull();
  });

  it("⚠️ corta em 4.000: mensagem de dez páginas é documento disfarçado", () => {
    expect(textoDaMensagem("x".repeat(5000))?.length).toBe(4000);
  });
});
