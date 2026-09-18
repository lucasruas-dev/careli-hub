import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";

import { estadoDoEspelho } from "./estado-do-espelho";

// O QUE ESTE TESTE PROTEGE: o espelho público de um PRÉDIO (Lucas, 16/09/2026: apartamento nunca é
// quadra/lote), o de um loteamento, e a COR, que desde 18/09/2026 vem da régua única
// (`situacao-da-unidade.ts`): verde se e só se a unidade está livre para a tela Venda.
//
// O cliente é falso, mas responde de verdade às leituras dos dois lados: o cadastro do desenho
// (`hercules_unidades` com preço e área) e a régua única (unidades, linhas antigas por `espelho_de`,
// propostas vivas, reservas do Hércules e do evento). Filtra por `eq`, `in`, `is null` e
// `not is null`, e pagina por `range`, como o PostgREST.

type Linha = Record<string, unknown>;

type Tabelas = {
  hercules_propostas?: Linha[];
  hercules_reservas?: Linha[];
  hercules_unidades: Linha[];
  prometeu_reservas?: Linha[];
};

type Opcoes = {
  /** Erro para a PRIMEIRA leitura de unidades que pedir as colunas do prédio. */
  erroComColunasDoPredio?: { code: string; message: string };
  /** Tabela cuja leitura falha, para provar que falha não vira verde. */
  tabelaQueFalha?: keyof Tabelas;
};

function clienteFalso(tabelas: Tabelas, opcoes: Opcoes = {}) {
  const selects: { colunas: string; tabela: string }[] = [];
  const client = {
    from(tabela: keyof Tabelas) {
      return {
        select(colunas: string) {
          selects.push({ colunas, tabela });
          const filtros: Array<(l: Linha) => boolean> = [];
          let faixa: null | [number, number] = null;
          const executar = () => {
            if (opcoes.tabelaQueFalha === tabela) {
              return { data: null, error: { message: `falha lendo ${tabela}` } };
            }
            if (
              tabela === "hercules_unidades" &&
              opcoes.erroComColunasDoPredio &&
              colunas.includes("apartamento")
            ) {
              return { data: null, error: opcoes.erroComColunasDoPredio };
            }
            // Sem as colunas pedidas, a linha volta sem elas, como o PostgREST devolveria.
            const pedidas = colunas.split(",").map((c) => c.trim());
            let linhas = (tabelas[tabela] ?? []).filter((l) => filtros.every((f) => f(l)));
            if (faixa) linhas = linhas.slice(faixa[0], faixa[1] + 1);
            return {
              data: linhas.map((l) => Object.fromEntries(Object.entries(l).filter(([k]) => pedidas.includes(k)))),
              error: null,
            };
          };
          const cadeia = {
            eq: (coluna: string, valor: unknown) => {
              filtros.push((l) => l[coluna] === valor);
              return cadeia;
            },
            in: (coluna: string, valores: readonly unknown[]) => {
              filtros.push((l) => valores.includes(l[coluna]));
              return cadeia;
            },
            // A régua única lê as glebas irmãs que o espelho não pediu com `.is("espelho_de", null)`.
            is: (coluna: string, valor: unknown) => {
              if (valor !== null) throw new Error("filtro não previsto no falso");
              filtros.push((l) => l[coluna] === null || l[coluna] === undefined);
              return cadeia;
            },
            not: (coluna: string, operador: string, valor: unknown) => {
              if (operador !== "is" || valor !== null) throw new Error("filtro não previsto no falso");
              filtros.push((l) => l[coluna] !== null && l[coluna] !== undefined);
              return cadeia;
            },
            order: () => cadeia,
            range: (de: number, ate: number) => {
              faixa = [de, ate];
              return Promise.resolve(executar());
            },
            // A leitura em blocos da régua única espera a consulta sem `range`.
            then: <T>(resolver: (valor: ReturnType<typeof executar>) => T, rejeitar?: (motivo: unknown) => T) =>
              Promise.resolve(executar()).then(resolver, rejeitar),
          };
          return cadeia;
        },
      };
    },
  };
  return { client: client as unknown as SupabaseClient, selects };
}

/** Só as leituras do cadastro do desenho (as que trazem preço), e não as da régua única. */
const doDesenho = (selects: { colunas: string; tabela: string }[]) =>
  selects.filter((s) => s.tabela === "hercules_unidades" && s.colunas.includes("preco_tabela"));

const lote = (u: Linha): Linha => ({
  area: "300.00",
  codigo: "VOC0105",
  enterprise_id: "37",
  espelho_de: null,
  lote: "05",
  origem_c2x_id: null,
  preco_tabela: "150000.00",
  quadra: "01",
  situacao: "disponivel",
  workspace_id: "careli",
  ...u,
  id: String(u.id ?? u.codigo ?? "VOC0105"),
});

const apto = (u: Linha): Linha => ({
  andar: null,
  area: "68.45",
  enterprise_id: "100001",
  espelho_de: null,
  lote: null,
  origem_c2x_id: null,
  preco_tabela: "480000.00",
  quadra: null,
  situacao: "disponivel",
  tipologia: null,
  torre: null,
  vagas: null,
  workspace_id: "careli",
  ...u,
  id: String(u.codigo),
});

const proposta = (unidadeId: string, etapa: string, extra: Linha = {}): Linha => ({
  aberta: true,
  criado_em_c2x: "2026-09-01T12:00:00Z",
  etapa,
  etapa_desde: "2026-09-10T12:00:00Z",
  id: `P-${unidadeId}-${etapa}`,
  unidade_id: unidadeId,
  workspace_id: "careli",
  ...extra,
});

const reserva = (unidadeId: string, situacao: string): Linha => ({
  id: `R-${unidadeId}-${situacao}`,
  situacao,
  unidade_id: unidadeId,
  workspace_id: "careli",
});

describe("estadoDoEspelho: loteamento continua igual", () => {
  it("pai e filho viram um lote só, com o código do pai, e o rótulo de quadra e lote", async () => {
    const { client } = clienteFalso({
      hercules_unidades: [
        // A linha antiga do pai aponta para a viva da gleba (migration 0161).
        lote({ codigo: "VLO0105", enterprise_id: "1", espelho_de: "VOC0105", situacao: "vendida" }),
        lote({ codigo: "VOC0105", enterprise_id: "37" }),
        lote({ codigo: "VOC0210", enterprise_id: "37", lote: "10", quadra: "02" }),
        lote({ codigo: "VOC0102", enterprise_id: "37", lote: "02", quadra: "01" }),
      ],
    });

    const estado = await estadoDoEspelho(client, {
      enterpriseIdDoPai: "1",
      enterpriseIdsDosFilhos: ["37"],
    });

    expect(estado.lotes.map((l) => l.codigo)).toEqual(["VOC0102", "VLO0105", "VOC0210"]);
    // Quem vende é a gleba: o pai parado dizendo "vendida" não esconde o lote.
    expect(estado.contagem).toEqual({ disponivel: 3, indisponivel: 0 });
    expect(estado.lotes[1]).toMatchObject({
      andar: null,
      apartamento: null,
      area: 300,
      grupo: "01",
      lote: "05",
      numero: "05",
      preco: 150000,
      quadra: "01",
      rotulo: "Quadra 01 · Lote 05",
      tipoProduto: "loteamento",
      torre: null,
    });
  });

  it("lote sem quadra cai no grupo 'Sem quadra', o mesmo que a grade pública já usava", async () => {
    const { client } = clienteFalso({
      hercules_unidades: [lote({ codigo: "AVULSA", lote: null, quadra: null })],
    });
    const estado = await estadoDoEspelho(client, { enterpriseIdDoPai: null, enterpriseIdsDosFilhos: ["37"] });
    expect(estado.lotes[0]).toMatchObject({ grupo: "Sem quadra", numero: "", rotulo: "AVULSA" });
  });
});

// ⚠️ O PEDIDO DO LUCAS, 18/09/2026: *"tem unidades que estão com reserva, proposta no hercules, que
// dentro de unidade do apolo não estão com o mesmo status"*. O espelho público era uma das réguas
// que discordavam. Estes casos provam que ele pinta pelo que a tela Venda enxerga.
describe("estadoDoEspelho: a cor vem da régua única", () => {
  const vale = (extra: Partial<Tabelas> = {}): Tabelas => ({
    hercules_unidades: [
      lote({
        codigo: "VLO0305",
        enterprise_id: "35",
        espelho_de: "VOC0305",
        lote: "05",
        quadra: "03",
        situacao: "vendida",
      }),
      lote({ codigo: "VOC0305", enterprise_id: "37", lote: "05", quadra: "03" }),
    ],
    ...extra,
  });
  const abrir = (tabelas: Tabelas, filhos: string[] = ["37"]) =>
    estadoDoEspelho(clienteFalso(tabelas).client, { enterpriseIdDoPai: "35", enterpriseIdsDosFilhos: filhos });

  it("sem processo, o lote do desenho sai verde com o código do pai", async () => {
    const estado = await abrir(vale());
    expect(estado.lotes).toHaveLength(1);
    expect(estado.lotes[0]).toMatchObject({ codigo: "VLO0305", situacao: "disponivel" });
  });

  // ⚠️ O DEFEITO QUE MOTIVOU A TROCA: a régua antiga procurava `situacao = 'reservada'`, e a reserva
  // viva do Hércules é `ativa`. Reserva nenhuma do Hércules pintava o lote de azul.
  it("reserva ATIVA do Hércules na gleba: azul", async () => {
    const estado = await abrir(vale({ hercules_reservas: [reserva("VOC0305", "ativa")] }));
    expect(estado.lotes[0]?.situacao).toBe("indisponivel");
  });

  it("reserva nascida na linha antiga do pai trava o terreno inteiro", async () => {
    const estado = await abrir(vale({ hercules_reservas: [reserva("VLO0305", "ativa")] }));
    expect(estado.lotes[0]?.situacao).toBe("indisponivel");
  });

  it("reserva que já não está viva não trava", async () => {
    const estado = await abrir(
      vale({ hercules_reservas: [reserva("VOC0305", "cancelada"), reserva("VOC0305", "expirada")] }),
    );
    expect(estado.lotes[0]?.situacao).toBe("disponivel");
  });

  it("reserva do evento de lançamento (Prometeu) também trava", async () => {
    const estado = await abrir({
      hercules_unidades: [
        lote({ codigo: "VOC0305", enterprise_id: "37", lote: "05", origem_c2x_id: 9305, quadra: "03" }),
      ],
      prometeu_reservas: [{ id: "E1", situacao: "reservada", unidade_c2x_id: 9305 }],
    });
    expect(estado.lotes[0]?.situacao).toBe("indisponivel");
  });

  // ⚠️ O OUTRO DEFEITO: `hercules_propostas.aberta` nunca volta a falso. Proposta cancelada seguia
  // escondendo o lote do público.
  it("proposta morta (cancelada), mesmo com aberta = true, não trava", async () => {
    const estado = await abrir(vale({ hercules_propostas: [proposta("VOC0305", "cancelado", { aberta: true })] }));
    expect(estado.lotes[0]?.situacao).toBe("disponivel");
  });

  it("proposta viva em qualquer etapa do fluxo: azul, e a etapa não sai no link público", async () => {
    for (const etapa of ["proposta", "contrato", "assinatura", "faturado"]) {
      const estado = await abrir(vale({ hercules_propostas: [proposta("VOC0305", etapa, { aberta: false })] }));
      expect(estado.lotes[0]?.situacao).toBe("indisponivel");
      // ⚠️ Etapa do processo não viaja num link sem login.
      expect(JSON.stringify(estado)).not.toContain(etapa);
    }
  });

  it("cadastro bloqueado na gleba, sem processo: azul", async () => {
    const estado = await abrir({
      hercules_unidades: [
        lote({ codigo: "VLO0305", enterprise_id: "35", espelho_de: "VOC0305", lote: "05", quadra: "03" }),
        lote({ codigo: "VOC0305", enterprise_id: "37", lote: "05", quadra: "03", situacao: "bloqueada" }),
      ],
    });
    expect(estado.lotes[0]?.situacao).toBe("indisponivel");
  });

  // ⚠️ OS LOTES QUE VOC E VOR DISPUTAM (migration 0162): o pai aponta para a carteira que vende, e a
  // linha bloqueada da outra carteira não apaga o verde.
  it("dois filhos no mesmo quadrado: responde a gleba para onde o pai aponta", async () => {
    const disputa = (vor: Linha = {}): Tabelas => ({
      hercules_unidades: [
        lote({
          codigo: "VLO0410",
          enterprise_id: "35",
          espelho_de: "VOR0410",
          lote: "10",
          quadra: "04",
          situacao: "vendida",
        }),
        lote({ codigo: "VOC0410", enterprise_id: "37", lote: "10", quadra: "04", situacao: "bloqueada" }),
        lote({ codigo: "VOR0410", enterprise_id: "41", lote: "10", quadra: "04", ...vor }),
      ],
    });

    const livre = await abrir(disputa(), ["37", "41"]);
    expect(livre.lotes).toHaveLength(1);
    expect(livre.lotes[0]).toMatchObject({ codigo: "VLO0410", situacao: "disponivel" });

    const reservado = await abrir(
      { ...disputa(), hercules_reservas: [reserva("VOR0410", "ativa")] },
      ["37", "41"],
    );
    expect(reservado.lotes[0]?.situacao).toBe("indisponivel");
  });

  // ⚠️ SEM O PONTEIRO, pai e filho no mesmo quadrado são terrenos que o Panteon não liga. Processo em
  // qualquer um deles não pode ser apagado pelo "disponível" do outro.
  it("pai sem ponteiro e filho com proposta viva no mesmo quadrado: azul", async () => {
    const estado = await abrir({
      hercules_propostas: [proposta("VOC0305", "proposta")],
      hercules_unidades: [
        lote({ codigo: "VLO0305", enterprise_id: "35", lote: "05", quadra: "03" }),
        lote({ codigo: "VOC0305", enterprise_id: "37", lote: "05", quadra: "03" }),
      ],
    });
    expect(estado.lotes[0]?.situacao).toBe("indisponivel");
  });

  // Linha que a régua única não conhece (aqui, de outro workspace) não recebe verde por omissão.
  it("linha que a régua única não trouxe: azul", async () => {
    const estado = await abrir({
      hercules_unidades: [lote({ codigo: "VOC0305", enterprise_id: "37", workspace_id: "outro" })],
    });
    expect(estado.lotes[0]?.situacao).toBe("indisponivel");
  });

  // ⚠️ FAIL-CLOSED: sem conseguir ler a situação, não há mapa. A rota responde 503 e a página mostra
  // o erro; nunca o desenho certo com as cores adivinhadas.
  it("falha lendo o processo derruba o estado inteiro, em vez de pintar verde", async () => {
    for (const tabela of ["hercules_propostas", "hercules_reservas", "prometeu_reservas"] as const) {
      const { client } = clienteFalso(vale(), { tabelaQueFalha: tabela });
      await expect(
        estadoDoEspelho(client, { enterpriseIdDoPai: "35", enterpriseIdsDosFilhos: ["37"] }),
      ).rejects.toThrow(`falha lendo ${tabela}`);
    }
  });
});

// ⚠️ O LOTE QUE EXISTE EM DUAS GLEBAS. Medido em 18/09/2026: 12-06, 13-01, 13-02 e 14-01 do Vale do
// Ouro têm linha na VOC E na VOR. O pai aponta (0162) para a VOR, que vende; a VOC segue com a linha
// dela, e é nela que pode nascer uma proposta. Lucas, 18/09/2026: *"eu não posso vender dois lotes
// para pessoas diferentes"*. O quadrado do desenho é UM terreno: dono em qualquer das duas, azul.
describe("estadoDoEspelho: o lote de duas glebas", () => {
  const duasGlebas = (extra: Partial<Tabelas> = {}, voc: Linha = {}): Tabelas => ({
    hercules_unidades: [
      // Um lote comum, cujo pai aponta para a VOC: é por linhas assim que a régua única sabe que a
      // VOC é gleba do VLO (a "família do pai").
      lote({
        codigo: "VLO0305",
        enterprise_id: "35",
        espelho_de: "VOC0305",
        lote: "05",
        quadra: "03",
        situacao: "vendida",
      }),
      lote({ codigo: "VOC0305", enterprise_id: "37", lote: "05", quadra: "03" }),
      // O lote que migrou de gleba: o pai aponta para a VOR livre; a VOC ficou bloqueada (0162).
      lote({
        codigo: "VLO0410",
        enterprise_id: "35",
        espelho_de: "VOR0410",
        lote: "10",
        quadra: "04",
        situacao: "vendida",
      }),
      lote({
        codigo: "VOC0410",
        enterprise_id: "37",
        lote: "10",
        origem_c2x_id: 9410,
        quadra: "04",
        situacao: "bloqueada",
        ...voc,
      }),
      lote({ codigo: "VOR0410", enterprise_id: "41", lote: "10", quadra: "04" }),
    ],
    ...extra,
  });
  const abrir = (tabelas: Tabelas, filhos: string[] = ["37", "41"]) =>
    estadoDoEspelho(clienteFalso(tabelas).client, { enterpriseIdDoPai: "35", enterpriseIdsDosFilhos: filhos });
  const corDe = (estado: Awaited<ReturnType<typeof abrir>>, codigo: string) =>
    estado.lotes.find((l) => l.codigo === codigo)?.situacao;

  it("sem processo em nenhuma das duas: verde, e a VOC bloqueada não apaga o verde da VOR", async () => {
    const estado = await abrir(duasGlebas());
    expect(estado.lotes.map((l) => l.codigo)).toEqual(["VLO0305", "VLO0410"]);
    expect(corDe(estado, "VLO0410")).toBe("disponivel");
  });

  it("⚠️ proposta viva na VOC, o pai apontando para a VOR livre: AZUL", async () => {
    for (const etapa of ["proposta", "contrato", "assinatura", "faturado"]) {
      const estado = await abrir(duasGlebas({ hercules_propostas: [proposta("VOC0410", etapa)] }));
      expect(corDe(estado, "VLO0410")).toBe("indisponivel");
      // O vizinho sem processo continua verde: a trava é do terreno, não do empreendimento.
      expect(corDe(estado, "VLO0305")).toBe("disponivel");
      expect(estado.contagem).toEqual({ disponivel: 1, indisponivel: 1 });
    }
  });

  it("reserva viva na VOC (do Hércules ou do evento): azul", async () => {
    const doHercules = await abrir(duasGlebas({ hercules_reservas: [reserva("VOC0410", "ativa")] }));
    expect(corDe(doHercules, "VLO0410")).toBe("indisponivel");

    const doEvento = await abrir(
      duasGlebas({ prometeu_reservas: [{ id: "E9", situacao: "reservada", unidade_c2x_id: 9410 }] }),
    );
    expect(corDe(doEvento, "VLO0410")).toBe("indisponivel");
  });

  // ⚠️ A PROVA DE QUE O ESPELHO USA O TERRENO DA RÉGUA ÚNICA. Aqui a árvore do espelho não traz a VOC:
  // o quadrado do desenho só tem a linha do pai e a da VOR, e nenhuma delas tem processo. O único
  // jeito de o lote sair azul é a régua ter somado a proposta da VOC no terreno para onde o pai
  // aponta, e o espelho ter perguntado a ela.
  it("a proposta da VOC chega pelo terreno da régua, mesmo sem a VOC no quadrado", async () => {
    const estado = await abrir(duasGlebas({ hercules_propostas: [proposta("VOC0410", "proposta")] }), ["41"]);
    expect(estado.lotes.map((l) => l.codigo)).toEqual(["VLO0305", "VLO0410"]);
    expect(JSON.stringify(estado)).not.toContain("VOC0410");
    expect(corDe(estado, "VLO0410")).toBe("indisponivel");
  });

  it("proposta morta na VOC não trava: verde", async () => {
    const estado = await abrir(duasGlebas({ hercules_propostas: [proposta("VOC0410", "cancelado")] }));
    expect(corDe(estado, "VLO0410")).toBe("disponivel");
  });

  // O cinto do espelho: se a régua não reconhecer a VOC como gleba do pai (nenhuma linha do pai
  // aponta para ela), o quadrado ainda junta as duas linhas pela quadra e lote.
  it("gleba fora da família do pai, com proposta viva, no mesmo quadrado: azul", async () => {
    const semPonteiroParaVoc = duasGlebas({ hercules_propostas: [proposta("VOC0410", "proposta")] });
    semPonteiroParaVoc.hercules_unidades = semPonteiroParaVoc.hercules_unidades.filter(
      (l) => l.codigo !== "VLO0305",
    );
    const estado = await abrir(semPonteiroParaVoc);
    expect(corDe(estado, "VLO0410")).toBe("indisponivel");
  });

  it("VOC vendida ou reservada no cadastro, sem processo, e VOR livre: azul (na dúvida, ocupado)", async () => {
    for (const situacao of ["vendida", "reservada"]) {
      const estado = await abrir(duasGlebas({}, { situacao }));
      expect(corDe(estado, "VLO0410")).toBe("indisponivel");
    }
  });

  // Lucas, 18/09/2026: *"eu posso por exemplo, bloquear uma unidade dentro do apolo e isso tem que
  // refletir no hercules"*. Bloquear a unidade que vende (a VOR, para onde o pai aponta) tira o lote
  // do ar no espelho.
  it("VOR bloqueada no cadastro (Apolo): azul", async () => {
    const tabelas = duasGlebas();
    tabelas.hercules_unidades = tabelas.hercules_unidades.map((l) =>
      l.codigo === "VOR0410" ? { ...l, situacao: "bloqueada" } : l,
    );
    const estado = await abrir(tabelas);
    expect(corDe(estado, "VLO0410")).toBe("indisponivel");
  });
});

// O CONTORNO DO MASTERPLAN CASA COM O LOTE PELO CÓDIGO, na tela (`EspelhoPublico.tsx`:
// `porCodigo.get(codigo)?.situacao === "disponivel" ? VERDE : AZUL`). Contorno sem lote no payload
// sai azul lá; aqui se garante que o payload não deixa um código ambíguo nem inventa um código.
describe("estadoDoEspelho: o código que o contorno procura", () => {
  it("contorno sem unidade do pai no Panteon: o código do desenho não sai no payload (e a tela pinta azul)", async () => {
    const { client } = clienteFalso({
      hercules_unidades: [lote({ codigo: "VOC0305", enterprise_id: "37", lote: "05", quadra: "03" })],
    });
    const estado = await estadoDoEspelho(client, { enterpriseIdDoPai: "35", enterpriseIdsDosFilhos: ["37"] });
    expect(estado.lotes.map((l) => l.codigo)).toEqual(["VOC0305"]);
    expect(estado.lotes.some((l) => l.codigo === "VLO0305")).toBe(false);
  });

  // ⚠️ A tela indexa os lotes num Map pelo código, e o último ganha. Dois quadrados com o mesmo
  // código e cores diferentes pintariam o contorno pela ordem da lista.
  it("código repetido em dois quadrados: os dois saem azuis", async () => {
    const { client } = clienteFalso({
      hercules_propostas: [proposta("VOC0305-A", "proposta")],
      hercules_unidades: [
        lote({ codigo: "VOC0305", enterprise_id: "37", id: "VOC0305-A", lote: "05", quadra: "03" }),
        lote({ codigo: "VOC0305", enterprise_id: "37", id: "VOC0305-B", lote: "06", quadra: "03" }),
        lote({ codigo: "VOC0307", enterprise_id: "37", lote: "07", quadra: "03" }),
      ],
    });
    const estado = await estadoDoEspelho(client, { enterpriseIdDoPai: null, enterpriseIdsDosFilhos: ["37"] });
    expect(estado.lotes.map((l) => [l.codigo, l.situacao])).toEqual([
      ["VOC0305", "indisponivel"],
      ["VOC0305", "indisponivel"],
      ["VOC0307", "disponivel"],
    ]);
    expect(estado.contagem).toEqual({ disponivel: 1, indisponivel: 2 });
  });
});

describe("estadoDoEspelho: o prédio", () => {
  it("com torre: agrupa por torre, do andar mais alto para o mais baixo, e escreve Torre e Apto", async () => {
    const { client } = clienteFalso({
      hercules_reservas: [reserva("JAD-A-1201", "ativa")],
      hercules_unidades: [
        apto({ andar: 1, apartamento: "101", codigo: "JAD-B-101", torre: "B" }),
        apto({ andar: 1, apartamento: "102", codigo: "JAD-A-102", torre: "A" }),
        apto({ andar: 12, apartamento: "1202", codigo: "JAD-A-1202", torre: "A", vagas: 2 }),
        apto({ andar: 12, apartamento: "1201", codigo: "JAD-A-1201", tipologia: "3 quartos", torre: "A" }),
      ],
    });

    const estado = await estadoDoEspelho(client, {
      enterpriseIdDoPai: "100001",
      enterpriseIdsDosFilhos: [],
    });

    expect(estado.lotes.map((l) => [l.grupo, l.numero])).toEqual([
      ["Torre A", "1201"],
      ["Torre A", "1202"],
      ["Torre A", "102"],
      ["Torre B", "101"],
    ]);
    expect(estado.lotes[0]).toMatchObject({
      andar: 12,
      apartamento: "1201",
      area: 68.45,
      lote: null,
      quadra: null,
      rotulo: "Torre A · Apto 1201",
      // Reserva viva: indisponível, como no loteamento.
      situacao: "indisponivel",
      tipologia: "3 quartos",
      tipoProduto: "vertical",
      torre: "A",
    });
    expect(estado.lotes[1]?.vagas).toBe(2);
    expect(estado.contagem).toEqual({ disponivel: 3, indisponivel: 1 });
    // ⚠️ Nenhum apartamento escrito como quadra e lote.
    expect(estado.lotes.some((l) => l.rotulo.includes("Quadra"))).toBe(false);
  });

  it("sem torre (torre única): grupo Unidades e só o apartamento", async () => {
    const { client } = clienteFalso({
      hercules_unidades: [
        apto({ andar: 3, apartamento: "304", codigo: "RUB-304", enterprise_id: "100002" }),
        apto({ andar: 0, apartamento: "1", codigo: "RUB-1", enterprise_id: "100002" }),
        apto({ andar: 3, apartamento: "303", codigo: "RUB-303", enterprise_id: "100002", situacao: "bloqueada" }),
      ],
    });

    const estado = await estadoDoEspelho(client, { enterpriseIdDoPai: "100002", enterpriseIdsDosFilhos: [] });

    expect(estado.lotes.map((l) => [l.grupo, l.rotulo, l.situacao])).toEqual([
      ["Unidades", "Apto 303", "indisponivel"],
      ["Unidades", "Apto 304", "disponivel"],
      ["Unidades", "Apto 1", "disponivel"],
    ]);
  });

  it("⚠️ o mesmo apartamento no pai e no filho vira um só, pela torre e pelo apartamento", async () => {
    const { client } = clienteFalso({
      hercules_unidades: [
        apto({
          andar: 3,
          apartamento: "304",
          codigo: "GTX-A-304",
          enterprise_id: "100010",
          espelho_de: "GT1-A-304",
          situacao: "vendida",
          torre: "A",
        }),
        apto({ andar: 3, apartamento: "0304", codigo: "GT1-A-304", enterprise_id: "100011", torre: "a" }),
      ],
    });
    const estado = await estadoDoEspelho(client, {
      enterpriseIdDoPai: "100010",
      enterpriseIdsDosFilhos: ["100011"],
    });
    expect(estado.lotes).toHaveLength(1);
    expect(estado.lotes[0]).toMatchObject({ codigo: "GTX-A-304", situacao: "disponivel" });
  });

  it("produto vertical informado por quem chama, unidade sem as colunas: decompõe o código", async () => {
    const { client } = clienteFalso({
      hercules_unidades: [apto({ codigo: "JAD-C-501" })],
    });
    const estado = await estadoDoEspelho(client, {
      enterpriseIdDoPai: "100001",
      enterpriseIdsDosFilhos: [],
      tipoProduto: "vertical",
    });
    expect(estado.lotes[0]).toMatchObject({ grupo: "Unidades", rotulo: "Torre C · Apto 501", tipoProduto: "vertical" });
  });
});

describe("estadoDoEspelho sem a migration 0171", () => {
  it("⚠️ repete a leitura sem as colunas do prédio, e o loteamento sai igual", async () => {
    const { client, selects } = clienteFalso(
      { hercules_unidades: [lote({ codigo: "VOC0105" })] },
      {
        erroComColunasDoPredio: {
          code: "42703",
          message: "column hercules_unidades.andar does not exist",
        },
      },
    );

    const estado = await estadoDoEspelho(client, { enterpriseIdDoPai: null, enterpriseIdsDosFilhos: ["37"] });

    const leituras = doDesenho(selects);
    expect(leituras).toHaveLength(2);
    expect(leituras[0]?.colunas).toContain("apartamento");
    expect(leituras[1]?.colunas).not.toContain("apartamento");
    expect(estado.lotes[0]).toMatchObject({ rotulo: "Quadra 01 · Lote 05", tipoProduto: "loteamento" });
  });

  it("erro que não é das colunas do prédio continua derrubando, sem repetir", async () => {
    const { client, selects } = clienteFalso(
      { hercules_unidades: [] },
      { erroComColunasDoPredio: { code: "42501", message: "permission denied for table hercules_unidades" } },
    );
    await expect(
      estadoDoEspelho(client, { enterpriseIdDoPai: "37", enterpriseIdsDosFilhos: [] }),
    ).rejects.toThrow("permission denied");
    expect(doDesenho(selects)).toHaveLength(1);
  });
});
