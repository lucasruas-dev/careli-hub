import { describe, expect, it } from "vitest";

import {
  anexosParaOMotor,
  filtroDaCadeia,
  type LinhaDeAnexo,
  somarAnexosDaCadeia,
} from "./anexos-da-venda";
import type { CadeiaDoContrato } from "./cadeia-do-contrato";

// OS ANEXOS SOMAM — a régua pura, sem banco.
//
// Lucas (21/09/2026): *"os anexos SOMAM os níveis. O contrato leva os anexos do pai MAIS os da
// divisão MAIS os da categoria, na ordem definida."*

const CADEIA: CadeiaDoContrato = {
  niveis: [
    { degrau: "unidade", id: "uni-1", minutaId: null, rotulo: "esta unidade" },
    { degrau: "categoria", id: "cat-1", minutaId: null, rotulo: "Condomínio" },
    { degrau: "divisao", id: "36", minutaId: null, rotulo: "VALE DO OURO VOL" },
    { degrau: "empreendimento", id: "35", minutaId: null, rotulo: "VALE DO OURO" },
  ],
};

function linha(campos: Partial<LinhaDeAnexo> & { id: string; posicao: number }): LinhaDeAnexo {
  return {
    arquivo_bytes: 1000,
    categoria_id: null,
    enterprise_id: null,
    nome: campos.nome ?? campos.id,
    storage_path: campos.storage_path ?? `temis-anexos/${campos.id}.pdf`,
    unidade_id: null,
    ...campos,
  };
}

describe("somarAnexosDaCadeia", () => {
  it("junta os quatro níveis e ordena pela POSIÇÃO, não pelo nível", () => {
    const r = somarAnexosDaCadeia(
      [
        linha({ enterprise_id: "35", id: "convencao", posicao: 4 }),
        linha({ unidade_id: "uni-1", id: "planta", posicao: 1 }),
        linha({ categoria_id: "cat-1", id: "regimento", posicao: 3 }),
        linha({ enterprise_id: "36", id: "memorial", posicao: 2 }),
      ],
      CADEIA,
    );

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.anexos.map((a) => a.id)).toEqual(["planta", "memorial", "regimento", "convencao"]);
    expect(r.anexos.map((a) => a.degrau)).toEqual([
      "unidade",
      "divisao",
      "categoria",
      "empreendimento",
    ]);
  });

  it("cada peça carrega o NOME do nível de onde veio, para a tela explicar", () => {
    const r = somarAnexosDaCadeia([linha({ enterprise_id: "35", id: "c", posicao: 1 })], CADEIA);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.anexos[0]?.rotuloDoNivel).toBe("VALE DO OURO");
  });

  it("o MESMO arquivo alcançado por dois degraus sai uma vez, pelo mais específico", () => {
    // O mesmo `storage_path` cadastrado no pai e na categoria: é o caso real de a mesma LINHA ser
    // alcançada por dois caminhos quando a divisão e o empreendimento da proposta coincidem.
    const r = somarAnexosDaCadeia(
      [
        linha({ enterprise_id: "35", id: "a", posicao: 1, storage_path: "temis-anexos/x.pdf" }),
        linha({ categoria_id: "cat-1", id: "b", posicao: 1, storage_path: "temis-anexos/x.pdf" }),
      ],
      CADEIA,
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.anexos).toHaveLength(1);
      expect(r.anexos[0]?.degrau).toBe("categoria");
    }
  });

  it("dois ARQUIVOS DIFERENTES na mesma posição recusam, nomeando as duas peças", () => {
    // ⚠️ É A CONSEQUÊNCIA DA SOMA. Os índices da 0156 são por nível, então pai e categoria podem,
    // os dois, gravar a posição 1 — e `[anexo_1]` na minuta apontaria para dois arquivos. Sortear
    // um deles seria escolher, calado, qual peça vai a cartório.
    const r = somarAnexosDaCadeia(
      [
        linha({ enterprise_id: "35", id: "a", nome: "Convenção do pai", posicao: 1 }),
        linha({ categoria_id: "cat-1", id: "b", nome: "Convenção da categoria", posicao: 1 }),
      ],
      CADEIA,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.erro).toContain("Convenção do pai");
      expect(r.erro).toContain("Convenção da categoria");
      expect(r.erro).toContain("posição 1");
    }
  });

  it("linha de fora da cadeia não entra, mesmo se a consulta a trouxer", () => {
    const r = somarAnexosDaCadeia([linha({ enterprise_id: "99", id: "de-outro", posicao: 1 })], CADEIA);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.anexos).toHaveLength(0);
  });

  it("posição inválida (zero, nula, texto) é descartada em vez de virar [anexo_0]", () => {
    const r = somarAnexosDaCadeia(
      [
        linha({ enterprise_id: "35", id: "zero", posicao: 0 }),
        { ...linha({ enterprise_id: "35", id: "nula", posicao: 1 }), posicao: null },
        { ...linha({ enterprise_id: "35", id: "sem-caminho", posicao: 2 }), storage_path: null },
      ],
      CADEIA,
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.anexos).toHaveLength(0);
  });
});

describe("filtroDaCadeia", () => {
  it("monta o .or() com a coluna certa de cada degrau", () => {
    expect(filtroDaCadeia(CADEIA)).toBe(
      "unidade_id.eq.uni-1,categoria_id.eq.cat-1,enterprise_id.eq.36,enterprise_id.eq.35",
    );
  });

  it("id com vírgula ou ponto NÃO entra no filtro", () => {
    // ⚠️ `.or()` é string concatenada. Um id sujo não vem da requisição (sai do cadastro), mas
    // quebraria a expressão inteira e mudaria o recorte em silêncio.
    const suja: CadeiaDoContrato = {
      niveis: [
        { degrau: "empreendimento", id: "35,categoria_id.not.is.null", minutaId: null, rotulo: "x" },
        { degrau: "divisao", id: "36", minutaId: null, rotulo: "VOL" },
      ],
    };
    expect(filtroDaCadeia(suja)).toBe("enterprise_id.eq.36");
  });

  it("o consolidado do catálogo (group:Lagoa Bonita) continua valendo como id", () => {
    const comGrupo: CadeiaDoContrato = {
      niveis: [{ degrau: "pai", id: "group:Lagoa Bonita", minutaId: null, rotulo: "LAGOA BONITA" }],
    };
    expect(filtroDaCadeia(comGrupo)).toBe("enterprise_id.eq.group:Lagoa Bonita");
  });

  it("cadeia vazia devolve filtro vazio, e quem chama não consulta", () => {
    expect(filtroDaCadeia({ niveis: [] })).toBe("");
  });
});

describe("anexosParaOMotor", () => {
  it("vira o Record<posicao, nome> que liga [inicio_tem_anexo_N] e responde [anexo_N_nome]", () => {
    const r = somarAnexosDaCadeia(
      [
        linha({ enterprise_id: "35", id: "a", nome: "Convenção", posicao: 1 }),
        linha({ categoria_id: "cat-1", id: "b", nome: "Memorial", posicao: 3 }),
      ],
      CADEIA,
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(anexosParaOMotor(r.anexos)).toEqual({ 1: "Convenção", 3: "Memorial" });
    }
  });
});
