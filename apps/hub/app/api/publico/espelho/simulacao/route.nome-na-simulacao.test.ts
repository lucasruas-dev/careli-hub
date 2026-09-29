import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PropostaParaPdf } from "@/lib/hercules/proposta-pdf";

// O NOME DE PARA QUEM A SIMULAÇÃO FOI FEITA, CHEGANDO AO PAPEL (27/09/2026).
//
// Lucas: *"faz uma coisa para mim, na parte do simulador do link do espelho, coloca a opção de
// inserir um nome na proposta simulada"*.
//
// ⚠️ A ENTRADA É PÚBLICA E SEM LOGIN, e este é o SEGUNDO texto livre que ela manda ao papel (o
// primeiro é a descrição do bem, com teto de 300 e recusa em `lib/hercules/bens-e-permutas.ts`).
// Medido em 27/09/2026 nos dois arquivos de revisão desta rota (`route.revisao-seguranca.test.ts` e
// `route.revisao3.test.ts`): NENHUM DOS DOIS testava texto livre — tudo ali é número, plano ou lote.
// A rede do texto é esta.
//
// ⚠️ E O CAMPO É OPCIONAL: sem ele, a folha sai exatamente como saía. Quem só quer ver o preço não
// digita nada.
//
// Mocks copiados de `route.desconto-no-espelho.test.ts`.

const estado = vi.hoisted(() => ({
  folhas: [] as unknown[],
  lotes: [] as Array<{ codigo: string; preco: null | number; situacao: "disponivel" | "indisponivel" }>,
  piso: 8 as null | number,
}));

const BASE_DO_PLANO = {
  indiceCorrecao: "IPCA_ANUAL",
  jurosConvencao: "equivalente",
  jurosPeriodicidade: "anual",
  sistemaAmortizacao: "sacoc",
} as const;

vi.mock("@/lib/hercules/espelho/abrir-espelho", () => {
  const cadeia = {
    eq: () => cadeia,
    in: () => cadeia,
    maybeSingle: async () => ({
      data: {
        area: 420,
        codigo: "GDN1110",
        lote: "10",
        preco_tabela: 435_000,
        quadra: "11",
        situacao: "disponivel",
      },
      error: null,
    }),
    select: () => cadeia,
  };
  const client = {
    from: () => cadeia,
    storage: { from: () => ({ download: async () => ({ data: null, error: { message: "sem logo" } }) }) },
  };
  return {
    abrirEspelho: async (token: null | string) =>
      token
        ? {
            espelho: {
              client,
              codigo: "garden",
              filhosC2xIds: [],
              masterplan: null,
              nome: "Garden",
              paiC2xId: "39",
            },
            ok: true,
          }
        : { erro: "sem_token", ok: false },
    ERRO_GENERICO: "Link inválido ou indisponível.",
  };
});

vi.mock("@/lib/hercules/espelho/estado-do-espelho", () => ({
  estadoDoEspelho: async () => ({
    atualizadoEm: "2026-09-27T12:00:00.000Z",
    contagem: { disponivel: 0, indisponivel: 0 },
    lotes: estado.lotes,
  }),
}));

vi.mock("@/lib/hercules/espelho/planos-publicos", () => ({
  pisoDeEntradaPublico: async () => estado.piso,
  planosPublicos: async () => [
    { ...BASE_DO_PLANO, anuaisQuantidade: 5, anuaisValor: 25_000, descontoPercentual: 0, entradaPercentual: 10, jurosTaxa: 6, nome: "NORMAL", parcelas: 60 },
  ],
}));

vi.mock("@/lib/hercules/proposta-pdf", () => ({
  montarPropostaPdf: async (folha: unknown) => {
    estado.folhas.push(folha);
    return new Uint8Array([37, 80, 68, 70]);
  },
}));

const { POST } = await import("./route");

function pedir(corpo: Record<string, unknown>) {
  return POST(
    new Request("https://c2x.app.br/api/publico/espelho/simulacao?e=tok", {
      body: JSON.stringify(corpo),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    }),
  );
}

const ultimaFolha = () =>
  estado.folhas.at(-1) as PropostaParaPdf & { simulacaoPara?: null | string };

/** O que a tela do espelho manda para o lote de R$ 435.000 no plano NORMAL. */
const DA_TELA = {
  anuaisQuantidade: 0,
  anuaisValor: 0,
  codigo: "GDN1110",
  entrada: 43_500,
  entradaVezes: 1,
  parcelas: 60,
  plano: "NORMAL",
  valor: 435_000,
};

beforeEach(() => {
  estado.folhas.length = 0;
  estado.lotes = [{ codigo: "GDN1110", preco: 435_000, situacao: "disponivel" }];
  estado.piso = 8;
});

describe("a folha da simulação diz para quem ela foi feita", () => {
  it("⚠️ SEM O CAMPO, A FOLHA SAI COMO SAÍA: nada de 'Simulação para' nenhum", async () => {
    const r = await pedir(DA_TELA);

    expect(r.status).toBe(200);
    expect(ultimaFolha().simulacaoPara ?? null).toBeNull();
  });

  it("o nome digitado chega à folha", async () => {
    const r = await pedir({ ...DA_TELA, simulacaoPara: "Maria Aparecida da Silva" });

    expect(r.status).toBe(200);
    expect(ultimaFolha().simulacaoPara).toBe("Maria Aparecida da Silva");
  });

  it("⚠️ E O NOME NÃO VIRA COMPRADOR: `compradores` continua VAZIO", async () => {
    // Simulação não tem comprador: ninguém foi qualificado, nada foi assinado. O nome é um rótulo
    // de para quem a conta foi feita, e a seção COMPRADORES continua fora do papel (a folha a
    // suprime quando `simulacao`).
    await pedir({ ...DA_TELA, simulacaoPara: "Maria Aparecida da Silva" });

    expect(ultimaFolha().compradores).toEqual([]);
    expect(ultimaFolha().simulacao).toBe(true);
  });

  it("⚠️ NOME SÓ COM ESPAÇOS É NOME NENHUM, e a folha não ganha rótulo pendurado", async () => {
    for (const bruto of ["", "   ", "\n\t", " \u00a0 "]) {
      await pedir({ ...DA_TELA, simulacaoPara: bruto });
      expect(ultimaFolha().simulacaoPara ?? null).toBeNull();
    }
  });

  it("⚠️ FRASE DA CASA NÃO SAI NO PAPEL DA CASA: a folha vem sem a linha, e o PDF vem", async () => {
    // ⚠️ AQUI ESTAVA O ERRO DA PRIMEIRA VERSÃO, MEDIDO EM 27/09/2026 COM pdf-lib: o teto de 60 foi
    // conferido contra UMA frase de 116 caracteres e o caso só olhava `length <= 60`. Mas a linha
    // útil tem 526,28pt, o rótulo "Simulação para " ocupa 61,96pt e sobram 464,32pt — e
    // "RESERVADO E PAGO - CONTRATO ASSINADO - DESCONTO 40% OK" tem 54 caracteres e mede 278,78pt:
    // passava pelo teto e saía IMPRESSA INTEIRA embaixo da logo do empreendimento. Quem a derruba
    // agora é a régua de FORMA de nome, e a folha simplesmente sai sem a linha.
    for (const frase of [
      "RESERVADO E PAGO - CONTRATO ASSINADO - DESCONTO 40% OK",
      "Lote garantido por 30 dias pela diretoria da Careli, assinado, com desconto aprovado de 40 por cento",
    ]) {
      const r = await pedir({ ...DA_TELA, simulacaoPara: frase });

      expect(r.status).toBe(200);
      expect(ultimaFolha().simulacaoPara ?? null).toBeNull();
    }
  });

  it("⚠️ O NOME COMPLETO DE 62 CARACTERES CHEGA INTEIRO, e não cortado no meio da palavra", async () => {
    // Medido: 311,72pt dos 464,32pt da linha. O teto de 60 o entregava como "...DOS SANTOS OLIVEI".
    const completo = "MARIA APARECIDA DA SILVA FERREIRA NOGUEIRA DOS SANTOS OLIVEIRA";
    const r = await pedir({ ...DA_TELA, simulacaoPara: completo });

    expect(r.status).toBe(200);
    expect(ultimaFolha().simulacaoPara).toBe(completo);
  });

  it("⚠️ QUEBRA DE LINHA E CARACTERE DE CONTROLE NÃO VIRAM UM PARÁGRAFO: viram espaço", async () => {
    await pedir({ ...DA_TELA, simulacaoPara: "Maria\nJosé\u0000\tSilva\u202e" });

    expect(ultimaFolha().simulacaoPara).toBe("Maria José Silva");
  });

  it("texto com cara de markup não vira rótulo, e o PDF sai de qualquer jeito", async () => {
    // A régua de FORMA de nome (letra, espaço, apóstrofo, hífen e ponto) derruba "<" e ">" — e o
    // PDF continua saindo, porque o rótulo é cortesia e não condição para ver o preço.
    const r = await pedir({ ...DA_TELA, simulacaoPara: "<b>Maria</b>" });

    expect(r.status).toBe(200);
    expect(ultimaFolha().simulacaoPara ?? null).toBeNull();
  });

  it("o que não é texto é ignorado, e a rota não cai", async () => {
    for (const bruto of [7, null, [], { nome: "Maria" }, true]) {
      const r = await pedir({ ...DA_TELA, simulacaoPara: bruto });
      expect(r.status).toBe(200);
      expect(ultimaFolha().simulacaoPara ?? null).toBeNull();
    }
  });

  it("⚠️ O NOME NÃO ENTRA NO NOME DO ARQUIVO: ele é o pedaço que viaja mais longe", async () => {
    // O arquivo fica na pasta de downloads, vira anexo de WhatsApp e é reenviado — tudo isso sem a
    // tarja que segura o resto do papel. E o saneamento do nome de arquivo existe em DUAS cópias
    // que já divergem (a da rota limpa a barra invertida, a da tela não), então dado de pessoa ali
    // passaria pela mais frouxa das duas.
    const r = await pedir({ ...DA_TELA, simulacaoPara: "Maria Aparecida da Silva" });

    expect(r.headers.get("Content-Disposition")).toBe(
      'attachment; filename="Garden - Quadra 11 - Lote 10.pdf"',
    );
  });
});
