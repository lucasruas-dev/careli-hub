import { describe, expect, it } from "vitest";

import {
  anexosDaConversa,
  chamadoParaOHelpDesk,
  dataSugeridaDeEntrega,
  transcricaoDoAtendimento,
} from "@/lib/hub-support/festo-chamado";

const CONTEXTO = {
  hoje: new Date("2026-09-11T14:30:00-03:00"),
  telaDaPessoa: "/hercules/venda",
};

describe("dataSugeridaDeEntrega", () => {
  it("propoe o prazo de cada prioridade", () => {
    const hoje = new Date("2026-09-11T14:30:00-03:00");

    expect(dataSugeridaDeEntrega("critica", hoje)).toBe("2026-09-12");
    expect(dataSugeridaDeEntrega("alta", hoje)).toBe("2026-09-13");
    expect(dataSugeridaDeEntrega("media", hoje)).toBe("2026-09-16");
    expect(dataSugeridaDeEntrega("baixa", hoje)).toBe("2026-09-21");
  });

  it("nao volta um dia em horario da manha no fuso de Brasilia", () => {
    // O erro clássico: montar a data no fuso local e serializar em UTC devolve o dia anterior.
    // Às 00h30 de Brasília ainda é dia 11 aqui, e o chamado tem que dizer 11 + o prazo.
    expect(dataSugeridaDeEntrega("critica", new Date("2026-09-11T00:30:00-03:00"))).toBe(
      "2026-09-12",
    );
  });

  it("atravessa a virada do mes", () => {
    expect(dataSugeridaDeEntrega("baixa", new Date("2026-09-25T10:00:00-03:00"))).toBe(
      "2026-10-05",
    );
  });
});

describe("chamadoParaOHelpDesk", () => {
  it("monta o chamado com o que o Festos ditou", () => {
    const chamado = chamadoParaOHelpDesk(
      {
        categoria: "bug",
        descricao_do_usuario: "Clico em salvar e nada acontece.",
        modulo: "Hercules",
        prioridade: "alta",
        resultado_esperado: "A proposta salva.",
        resultado_obtido: "A tela fica girando.",
        resumo_tecnico: "Salvar da proposta nao responde na tela de venda.",
        titulo: "Proposta nao salva",
      },
      CONTEXTO,
    );

    expect(chamado).toEqual({
      actualResult: "A tela fica girando.",
      category: "bug",
      expectedResult: "A proposta salva.",
      module: "Hercules",
      priority: "alta",
      requestedDeliveryDate: "2026-09-13",
      sourcePath: "/hercules/venda",
      technicalSummary: "Salvar da proposta nao responde na tela de venda.",
      title: "Proposta nao salva",
      userDescription: "Clico em salvar e nada acontece.",
    });
  });

  it("recusa o chamado sem titulo, relato ou leitura tecnica", () => {
    const base = {
      descricao_do_usuario: "Nao consigo entrar.",
      resumo_tecnico: "Login recusa a senha certa.",
      titulo: "Login travado",
    };

    expect(chamadoParaOHelpDesk({ ...base, titulo: "   " }, CONTEXTO)).toBeNull();
    expect(
      chamadoParaOHelpDesk({ ...base, descricao_do_usuario: undefined }, CONTEXTO),
    ).toBeNull();
    expect(chamadoParaOHelpDesk({ ...base, resumo_tecnico: 42 }, CONTEXTO)).toBeNull();
  });

  it("cai em categoria e prioridade padrao quando o modelo inventa o valor", () => {
    const chamado = chamadoParaOHelpDesk(
      {
        categoria: "urgentissimo",
        descricao_do_usuario: "A tela some.",
        prioridade: "altissima",
        resumo_tecnico: "Tela do Apolo desaparece ao filtrar.",
        titulo: "Tela some",
      },
      CONTEXTO,
    );

    expect(chamado?.category).toBe("outro");
    expect(chamado?.priority).toBe("media");
    // O prazo acompanha a prioridade que ficou valendo, nao a inventada.
    expect(chamado?.requestedDeliveryDate).toBe("2026-09-16");
  });

  it("usa a tela como modulo quando o Festos nao disse qual e", () => {
    const chamado = chamadoParaOHelpDesk(
      {
        descricao_do_usuario: "Nao acho o botao.",
        resumo_tecnico: "Pessoa nao encontra a acao de exportar.",
        titulo: "Botao sumido",
      },
      CONTEXTO,
    );

    expect(chamado?.module).toBe("/hercules/venda");
  });

  it("cai em Panteon quando nao ha modulo nem tela", () => {
    const chamado = chamadoParaOHelpDesk(
      {
        descricao_do_usuario: "Nao acho o botao.",
        resumo_tecnico: "Pessoa nao encontra a acao de exportar.",
        titulo: "Botao sumido",
      },
      { hoje: CONTEXTO.hoje, telaDaPessoa: null },
    );

    expect(chamado?.module).toBe("Panteon");
    expect(chamado?.sourcePath).toBeUndefined();
  });

  it("completa a leitura tecnica curta demais para a trava do HelpDesk", () => {
    // `normalizeCreateInput` exige 10 caracteres na leitura tecnica: um resumo de 5 seria aceito
    // aqui e explodiria la dentro, com o chamado ja perdido.
    const chamado = chamadoParaOHelpDesk(
      {
        descricao_do_usuario: "O relatorio sai sem as linhas do mes passado.",
        resumo_tecnico: "erro",
        titulo: "Relatorio incompleto",
      },
      CONTEXTO,
    );

    expect(chamado?.technicalSummary).toBe(
      "erro · O relatorio sai sem as linhas do mes passado.",
    );
  });
});

describe("anexosDaConversa", () => {
  const png = "data:image/png;base64,AAAABBBBCCCC";
  const jpeg = "data:image/jpeg;base64,DDDDEEEE";

  it("transforma os prints da conversa em anexos do chamado", () => {
    const anexos = anexosDaConversa(
      [{ imagens: [png] }, {}, { imagens: [jpeg] }],
      CONTEXTO.hoje,
    );

    expect(anexos).toHaveLength(2);
    expect(anexos[0]).toMatchObject({
      dataUrl: png,
      mimeType: "image/png",
      type: "image",
    });
    expect(anexos[0]?.fileName).toMatch(/^print-do-chat-2026-09-11-.+-1\.png$/);
    expect(anexos[1]?.mimeType).toBe("image/jpeg");
  });

  it("calcula o tamanho a partir do base64, e nao manda zero", () => {
    // Zero passaria por cima da trava de tamanho do HelpDesk.
    const [anexo] = anexosDaConversa([{ imagens: [png] }], CONTEXTO.hoje);

    expect(anexo?.sizeBytes).toBe(9);
  });

  it("recusa o que nao for imagem que a API aceita", () => {
    expect(
      anexosDaConversa(
        [
          { imagens: ["data:image/svg+xml;base64,PHN2Zz4="] },
          { imagens: ["https://exemplo.com/print.png"] },
          { imagens: ["data:application/pdf;base64,AAAA"] },
        ],
        CONTEXTO.hoje,
      ),
    ).toEqual([]);
  });

  it("fica nos quatro mais recentes, como o formulario", () => {
    const anexos = anexosDaConversa(
      [{ imagens: [png, png, png] }, { imagens: [jpeg, jpeg, jpeg] }],
      CONTEXTO.hoje,
    );

    expect(anexos).toHaveLength(4);
    // Os que sobrevivem sao os do fim da conversa.
    expect(anexos.filter((anexo) => anexo.mimeType === "image/jpeg")).toHaveLength(3);
  });

  it("devolve vazio quando a conversa foi so de texto", () => {
    expect(anexosDaConversa([{}, { imagens: [] }], CONTEXTO.hoje)).toEqual([]);
  });
});

describe("transcricaoDoAtendimento", () => {
  it("marca quem falou o que", () => {
    expect(
      transcricaoDoAtendimento([
        { de: "pessoa", texto: "nao consigo salvar" },
        { de: "festo", texto: "Em que tela?" },
        { de: "pessoa", texto: "na proposta" },
      ]),
    ).toBe("Pessoa: nao consigo salvar\n\nFestos: Em que tela?\n\nPessoa: na proposta");
  });
});
