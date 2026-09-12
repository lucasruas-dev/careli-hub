import { describe, expect, it } from "vitest";

import {
  type CardDoHistorico,
  historicoDeEtapas,
  type PassagemGravada,
} from "./historico-de-etapas";

// O que este teste protege é a FRASE. A linha do tempo de um contrato é lida por quem está
// auditando, e cada palavra dela é a resposta a uma pergunta feita meses depois.

function passagem(campos: Partial<PassagemGravada>): PassagemGravada {
  return {
    de: "analise",
    motivo: null,
    observacao: null,
    origem: "atividade",
    para: "contrato",
    proposta_id: "p1",
    quando: "2026-09-11T12:00:00.000Z",
    quem_nome: null,
    trabalho_id: "t1",
    trabalho_tipo: "contrato",
    ...campos,
  };
}

const card: CardDoHistorico = {
  estagio: "contrato",
  estagio_desde: "2026-09-10T09:00:00.000Z",
  id: "t1",
  proposta_id: "p1",
  tipo: "contrato",
};

describe("histórico de etapas da Têmis", () => {
  it("no contrato, a frase é só a passagem", () => {
    const [evento] = historicoDeEtapas([passagem({})], card);
    expect(evento?.fato).toBe("Análise → Contrato");
    expect(evento?.fonte).toBe("temis");
    // ⚠️ `tipo` continua sendo a natureza do fato, e não a origem do registro: é ele que manda na
    // cor da borda, e um quarto valor competiria com as três cores que já significam coisa.
    expect(evento?.tipo).toBe("etapa");
  });

  // ⚠️ UMA PROPOSTA PODE TER DOIS CARDS (a venda e o pedido de cancelamento dela, medido em
  // 10/09/2026). Sem o tipo na frente, as duas linhas de trabalhos diferentes ficam
  // indistinguíveis na mesma lista.
  it("fora do contrato, o tipo vai na frente", () => {
    const [evento] = historicoDeEtapas(
      [passagem({ trabalho_tipo: "cancelamento" })],
      card,
    );
    expect(evento?.fato).toBe("Cancelamento · Análise → Contrato");
  });

  it("`de` nulo é o nascimento do card, e não uma transição pela metade", () => {
    const [evento] = historicoDeEtapas(
      [passagem({ de: null, origem: "abertura", para: "analise" })],
      card,
    );
    expect(evento?.fato).toBe("Trabalho aberto na Têmis");
  });

  // ⚠️ O BANCO GUARDA `prazo_legal` E A TELA CHAMA DE "Pré-faturamento" desde 11/09/2026. O valor cru não
  // aparece em nenhuma outra tela do módulo.
  it("prazo_legal se escreve Pré-faturamento", () => {
    const [evento] = historicoDeEtapas(
      [passagem({ de: "assinatura", origem: "webhook_assinatura", para: "prazo_legal" })],
      card,
    );
    expect(evento?.fato).toBe("Em assinatura → Pré-faturamento");
  });

  // ⚠️ "Faturado" SÓ FAZ SENTIDO NO CONTRATO. Cessão, distrato e cancelamento não faturam nada:
  // eles se assinam e se arquivam. O valor gravado é o mesmo; o que muda é a palavra.
  it("faturado vira Concluído fora do contrato", () => {
    const [evento] = historicoDeEtapas(
      [passagem({ de: "contrato", para: "faturado", trabalho_tipo: "distrato" })],
      card,
    );
    expect(evento?.fato).toBe("Distrato · Contrato → Concluído");
  });

  it("no contrato, faturado continua Faturado", () => {
    const [evento] = historicoDeEtapas([passagem({ de: "prazo_legal", para: "faturado" })], card);
    expect(evento?.fato).toBe("Pré-faturamento → Faturado");
  });

  // ⚠️ O PASSADO FICA HONESTO: os cards vivos andaram antes de existir onde gravar, e a 0153 ainda
  // espera OK do Lucas. Sem a derivada, a aba diria "Nada registrado" sobre um contrato que
  // atravessou três etapas na semana.
  it("sem nenhuma linha, deriva UMA do próprio card e avisa", () => {
    const eventos = historicoDeEtapas([], card);
    expect(eventos).toHaveLength(1);
    expect(eventos[0]?.fato).toBe("Em Contrato");
    expect(eventos[0]?.quando).toBe(card.estagio_desde);
    expect(eventos[0]?.observacao).toContain("não foi gravado");
    // ⚠️ NADA DE BACKFILL SINTÉTICO: uma única linha, e nenhuma transição inventada.
    expect(eventos[0]?.id).toBe("temis-etapa:t1:derivada");
  });

  it("a derivada também leva o tipo na frente fora do contrato", () => {
    const [evento] = historicoDeEtapas([], { ...card, estagio: "analise", tipo: "cessao" });
    expect(evento?.fato).toBe("Cessão · Em Análise");
  });

  // ⚠️ A 0150 RENOMEOU TRÊS ESTÁGIOS, e as linhas antigas guardam a palavra que valia no dia. O
  // check de vocabulário ficou de fora da 0153 justamente por isso.
  it("palavra fora do vocabulário de hoje sai como foi gravada", () => {
    const [evento] = historicoDeEtapas(
      [passagem({ de: "entrada", para: "confeccao" })],
      card,
    );
    expect(evento?.fato).toBe("entrada → confeccao");
  });

  // ⚠️ ESTE TESTE CONGELAVA O DEFEITO: ele exigia `documento_faltando` na tela, que é o CÓDIGO do
  // catálogo. O código existe para não mudar nunca e poder ser contado; quem aparece para quem lê é
  // o rótulo (`rotuloDoMotivo`), a mesma palavra que a tela de indeferir e a mensagem do corretor
  // mostram. O código foi consertado primeiro, e a asserção depois.
  it("motivo e observação entram juntos, e o motivo sai pelo rótulo", () => {
    const [evento] = historicoDeEtapas(
      [
        passagem({
          motivo: "documento_faltando",
          observacao: "falta o RG do cônjuge",
          origem: "indeferimento",
          para: "indeferido",
        }),
      ],
      card,
    );
    expect(evento?.observacao).toBe("Documento faltando · falta o RG do cônjuge");
  });

  // ⚠️ MOTIVO QUE SAIU DO CATÁLOGO NÃO PODE SUMIR NEM VIRAR VAZIO. A linha antiga guarda o código
  // que valia no dia; o cru é pior que o rótulo e MUITO melhor que nada.
  it("código de motivo desconhecido sai cru, e não vazio", () => {
    const [evento] = historicoDeEtapas(
      [passagem({ motivo: "motivo_que_nao_existe_mais", origem: "indeferimento", para: "indeferido" })],
      card,
    );
    expect(evento?.observacao).toBe("motivo_que_nao_existe_mais");
  });

  it("os ids não colidem com os do Hércules e a ordem é a data, do mais novo para o mais antigo", () => {
    const eventos = historicoDeEtapas(
      [
        passagem({ quando: "2026-09-09T10:00:00.000Z" }),
        passagem({ de: "contrato", para: "assinatura", quando: "2026-09-11T10:00:00.000Z" }),
      ],
      card,
    );
    expect(eventos.map((e) => e.quando)).toEqual([
      "2026-09-11T10:00:00.000Z",
      "2026-09-09T10:00:00.000Z",
    ]);
    for (const e of eventos) expect(e.id.startsWith("temis-etapa:")).toBe(true);
  });
});
