import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { buildQueueClientsFromSources, type HadesAttendanceSourceClient } from "./data";

// A FILA DE ATENDIMENTO NÃO INVENTA SIGLA (PAN-124, F1).
//
// ⚠️ data.ts tem a diretiva ts-nocheck: o typecheck não o cobre ([[reference_typecheck_nao_cobre_ts_nocheck]]).
// Este teste é a prova de que a matrícula sai certa.
//
// Até 26/09/2026, sem matrícula do servidor, o código da unidade saía de um mapa NOME -> SIGLA escrito
// à mão ou das iniciais do nome. A fila compacta (`loadHadesAttendanceQueueSummary`) nunca manda
// matrícula, então toda linha dela ganhava um código inventado: "Lagoa Bonita" virava LAB (a sigla do
// 31, o masterplan excluído), "Lavra do Ouro" virava LDO (que não existe), "Vale do Ouro" virava VOV.

// A fonte como `mapSummaryRowToSourceClient` (lib/guardian/attendance.ts) monta: sem `matricula`, sem
// `c2xUnits`, quadra e lote vazios.
function daFilaCompacta(empreendimento: string, extra: Partial<HadesAttendanceSourceClient> = {}) {
  return {
    area: "-",
    atrasoDias: 40,
    c2xInstallments: [],
    c2xInstallmentsLoaded: false,
    cidade: "-",
    cpf: "-",
    empreendimento,
    escolaridade: "-",
    estadoCivil: "-",
    id: "c2x-client-1",
    idade: "-",
    imobiliariaCorretor: "-",
    lote: "-",
    nome: "Cliente de teste",
    parcelasAVencer: 10,
    parcelasLiquidadas: 5,
    parcelasTotal: 17,
    parcelasVencidas: 2,
    perfilParcela: "Parcela",
    prioridade: "Alta",
    profissao: "-",
    quadra: "-",
    recuperado: 0,
    renda: "-",
    responsavel: "-",
    saldoAtraso: 900,
    scoreRisco: 60,
    sexo: "-",
    status: "Em atraso",
    telefone: "-",
    unidadeLote: "Q3 L4",
    valorUnidade: 0,
    vencimento: "2026-08-10",
    ...extra,
  } as HadesAttendanceSourceClient;
}

function matriculas(fonte: HadesAttendanceSourceClient): string[] {
  const [cliente] = buildQueueClientsFromSources([fonte]);
  return (cliente?.carteira.unidades ?? []).map((unidade) => unidade.matricula);
}

describe("matrícula da unidade na fila de atendimento", () => {
  it("sem matrícula do servidor, sai vazia ('-'), e nunca a sigla de outro empreendimento", () => {
    const nomes = [
      // Os nomes que o mapa antigo traduzia à mão.
      "Lagoa Bonita",
      "Lavra do Ouro",
      "Recanto do Pará",
      "Morada da Serra",
      "Veredas do Ouro",
      "Vista Alegre",
      // Os que a fila compacta manda de verdade (enterpriseDisplayExpression + formatName).
      "Lagoa Bonita - LBF",
      "Recanto do Para",
      "Rio de Pedras",
      "Portal dos Vales",
      "Vale do Ouro",
    ];

    for (const nome of nomes) {
      expect(matriculas(daFilaCompacta(nome)), nome).toEqual(["-"]);
    }
  });

  it("o cadastro do C2X sem contrato (empreendimento '-') também sai '-', e não XXX", () => {
    expect(matriculas(daFilaCompacta("-", { c2xUnits: [] }))).toEqual(["-"]);
  });

  it("a matrícula que o servidor manda passa como está", () => {
    expect(matriculas(daFilaCompacta("Lagoa Bonita - LBF", { matricula: "LBF0304" }))).toEqual(["LBF0304"]);

    const comUnidades = daFilaCompacta("Vale do Ouro", {
      c2xUnits: [
        {
          area: "360 m²",
          empreendimento: "Vale do Ouro",
          id: "u1",
          lote: "L4",
          matricula: "VOC0104",
          quadra: "Q1",
          unidadeLote: "Q1 · Lote 4",
          valorUnidade: 1,
        },
        {
          area: "360 m²",
          empreendimento: "Vale do Ouro",
          id: "u2",
          lote: "L5",
          matricula: "VOL0105",
          quadra: "Q1",
          unidadeLote: "Q1 · Lote 5",
          valorUnidade: 1,
        },
      ],
    });
    expect(matriculas(comUnidades)).toEqual(["VOC0104", "VOL0105"]);
  });

  it("o mapa nome -> sigla saiu do arquivo", () => {
    const fonte = readFileSync(fileURLToPath(new URL("./data.ts", import.meta.url)), "utf8");
    expect(fonte).not.toMatch(/enterpriseCodeFor|deriveEnterpriseCode|buildUnitCode/);
    expect(fonte).not.toMatch(/"Lagoa Bonita":\s*"LAB"/);
  });
});
