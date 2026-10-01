import { describe, expect, it } from "vitest";

import { documentosFaltando } from "@/lib/apolo/cadastro-obrigatorios";
import { ehAutonomoPublico } from "@/lib/apolo/cadastro-tipos";

// O MODO DO LINK DO CORRETOR AUTÔNOMO NÃO VAZA PARA OS OUTROS FLUXOS (01/10/2026).
//
// O wizard é um só para o time, a CAD pública do cliente, o auto-cadastro da imobiliária, o portal do
// incorporador e agora o link do autônomo. O que o modo do autônomo muda (textos, sem certidão, sem
// cônjuge, sem consulta paga) só pode valer para ele.

describe("quem está no modo do link do autônomo", () => {
  it("só o formato corretor em modo público", () => {
    expect(ehAutonomoPublico({ publico: true, tipo: "corretor" })).toBe(true);
  });

  it("a CAD pública do cliente, a imobiliária pública e o cadastro interno ficam fora", () => {
    expect(ehAutonomoPublico({ publico: true, tipo: "prospect" })).toBe(false);
    expect(ehAutonomoPublico({ publico: true, tipo: undefined })).toBe(false);
    expect(ehAutonomoPublico({ publico: true, tipo: "imobiliaria" })).toBe(false);
    // O cadastro interno do autônomo e o portal do incorporador não passam `publico`.
    expect(ehAutonomoPublico({ publico: false, tipo: "corretor" })).toBe(false);
    expect(ehAutonomoPublico({ publico: false, tipo: "prospect" })).toBe(false);
  });
});

describe("os documentos obrigatórios", () => {
  it("fora do link, casado continua pedindo certidão e o documento do cônjuge", () => {
    const faltando = documentosFaltando({ estadoCivilId: "2", persona: "pf" }, [
      "identificacao",
      "comprovante_endereco",
    ]);
    expect(faltando).toEqual(["a certidão de estado civil", "o documento de identificação do cônjuge"]);
  });

  it("no link do autônomo, identidade e comprovante bastam", () => {
    expect(
      documentosFaltando({ estadoCivilId: "2", persona: "pf", semEstadoCivil: true }, [
        "identificacao",
        "comprovante_endereco",
      ]),
    ).toEqual([]);
  });
});
