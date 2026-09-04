import { describe, expect, it } from "vitest";

import {
  avisosDaReserva,
  conferirReserva,
  mascararCpf,
  type PedidoDeReserva,
  PRAZO_MAXIMO_EM_DIAS,
  reservaComoLinhaDoFluxo,
  telefoneParecePossivel,
  vencimentoEmDias,
} from "./reserva";

const AGORA = "2026-09-03T17:00:00.000Z";

const PEDIDO: PedidoDeReserva = {
  corretorEntityId: "cor-1",
  imobiliariaEntityId: "imo-1",
  proponente: { cpf: "529.982.247-25", nome: "Maria da Silva", telefone: "(62) 99123-4567" },
  unidadeId: "uni-1",
  validadeEm: "2026-09-06T23:59:59.000Z",
};

describe("conferirReserva", () => {
  it("aceita o pedido completo", () => {
    expect(conferirReserva(PEDIDO, AGORA)).toEqual([]);
  });

  it("⚠️ devolve TODOS os erros de uma vez, não o primeiro", () => {
    // Um formulário que reclama de um campo por vez faz a pessoa clicar quatro vezes para
    // descobrir quatro problemas.
    const erros = conferirReserva(
      {
        ...PEDIDO,
        imobiliariaEntityId: "",
        proponente: { cpf: "111", nome: "Ana", telefone: "999" },
      },
      AGORA,
    );
    expect(erros.map((e) => e.campo).sort()).toEqual(["cpf", "imobiliaria", "nome", "telefone"]);
  });

  it("a reserva pode sair só no nome da imobiliária", () => {
    // Lucas: *"o ideal é o corretor"* — ideal, não obrigatório.
    expect(conferirReserva({ ...PEDIDO, corretorEntityId: null }, AGORA)).toEqual([]);
  });

  it("exige nome completo, não só o primeiro", () => {
    const erros = conferirReserva(
      { ...PEDIDO, proponente: { ...PEDIDO.proponente, nome: "Maria" } },
      AGORA,
    );
    expect(erros.map((e) => e.campo)).toEqual(["nome"]);
  });

  it("recusa CPF que não fecha o dígito verificador", () => {
    const erros = conferirReserva(
      { ...PEDIDO, proponente: { ...PEDIDO.proponente, cpf: "529.982.247-26" } },
      AGORA,
    );
    expect(erros.map((e) => e.campo)).toEqual(["cpf"]);
  });

  it("recusa vencimento no passado e no presente", () => {
    for (const quando of ["2026-09-02T10:00:00.000Z", AGORA]) {
      const erros = conferirReserva({ ...PEDIDO, validadeEm: quando }, AGORA);
      expect(erros.map((e) => e.campo)).toEqual(["validade"]);
    }
  });

  it(`recusa prazo acima de ${PRAZO_MAXIMO_EM_DIAS} dias`, () => {
    const erros = conferirReserva({ ...PEDIDO, validadeEm: "2026-10-31T23:59:59.000Z" }, AGORA);
    expect(erros.map((e) => e.campo)).toEqual(["validade"]);
  });
});

describe("telefoneParecePossivel", () => {
  it("aceita celular e fixo com DDD, com e sem DDI", () => {
    for (const t of ["62991234567", "(62) 3212-3456", "5562991234567", "+55 62 99123-4567"]) {
      expect(telefoneParecePossivel(t)).toBe(true);
    }
  });

  it("⚠️ recusa o que não tem para onde ir", () => {
    // A reserva DISPARA mensagem para esse número: aceitar lixo grava reserva cujo aviso nunca
    // chega, e ninguém descobre até o cliente ligar cobrando.
    for (const t of ["", "9999", "991234567", "0299123456", "5562991234567890"]) {
      expect(telefoneParecePossivel(t)).toBe(false);
    }
  });
});

describe("vencimentoEmDias", () => {
  it("⚠️ vence no FIM do dia, não na hora do clique", () => {
    // Reserva feita às 14h com "3 dias" que morresse às 14h do terceiro dia surpreenderia o
    // corretor no meio do expediente.
    const fim = vencimentoEmDias("2026-09-03T17:00:00.000Z", 3);
    // 06/09 23:59:59 em Brasília = 07/09 02:59:59 UTC.
    expect(fim).toBe("2026-09-07T02:59:59.000Z");
  });

  it("zero dias é hoje até a meia-noite", () => {
    expect(vencimentoEmDias("2026-09-03T17:00:00.000Z", 0)).toBe("2026-09-04T02:59:59.000Z");
  });

  it("⚠️ a virada do dia em Brasília não empurra a data", () => {
    // 03/09 às 23:00 de Brasília já é 04/09 em UTC. Contar em UTC daria um dia a mais.
    expect(vencimentoEmDias("2026-09-04T02:00:00.000Z", 1)).toBe("2026-09-05T02:59:59.000Z");
  });
});

describe("mascararCpf", () => {
  it("mostra o miolo e esconde as pontas", () => {
    expect(mascararCpf("529.982.247-25")).toBe("***.982.247-**");
  });

  it("não estoura com documento curto", () => {
    expect(mascararCpf("123")).toBe("documento");
    expect(mascararCpf("1234567")).toBe("***4567");
  });
});

describe("avisosDaReserva", () => {
  const DADOS = {
    cliente: "Maria da Silva",
    codigo: "000123",
    corretor: "João Souza",
    cpf: "529.982.247-25",
    empreendimento: "Vale do Ouro",
    imobiliaria: "Gurgel Imóveis",
    unidade: "Quadra 12 · Lote 06",
    validadeEm: "2026-09-07T02:59:59.000Z",
  };

  it("manda um texto por destinatário", () => {
    const avisos = avisosDaReserva(DADOS);
    expect(avisos.map((a) => a.papel)).toEqual(["corretor", "imobiliaria", "coordenador"]);
  });

  it("⚠️ o CPF vai MASCARADO nos três", () => {
    // Ele está na mensagem para o corretor reconhecer o cliente, não para circular em grupo de
    // WhatsApp — e mensagem enviada não volta.
    for (const aviso of avisosDaReserva(DADOS)) {
      expect(aviso.texto).toContain("***.982.247-**");
      expect(aviso.texto).not.toContain("529.982.247-25");
      expect(aviso.texto).not.toContain("52998224725");
    }
  });

  it("⚠️ negrito de WhatsApp é UM asterisco", () => {
    // Dois é Markdown, e chega literal na conversa. A máscara do CPF sai da comparação: os
    // asteriscos dela são conteúdo, não formatação.
    for (const aviso of avisosDaReserva(DADOS)) {
      const semMascara = aviso.texto.split(mascararCpf(DADOS.cpf)).join("");
      expect(semMascara).not.toContain("**");
    }
  });

  it("a data sai no fuso de Brasília", () => {
    // 07/09 02:59 UTC é 06/09 23:59 em Brasília: escrever "07/09" daria um dia a mais de reserva.
    for (const aviso of avisosDaReserva(DADOS)) expect(aviso.texto).toContain("06/09/2026");
  });

  it("sem corretor, cada texto diz isso do seu jeito", () => {
    const avisos = avisosDaReserva({ ...DADOS, corretor: null });
    const porPapel = new Map(avisos.map((a) => [a.papel, a.texto]));
    expect(porPapel.get("imobiliaria")).toContain("Reserva no nome da imobiliária");
    expect(porPapel.get("coordenador")).toContain("Corretor: não informado");
  });

  it("⚠️ o COD vai nas TRÊS mensagens", () => {
    // Lucas, 04/09/2026: *"isso tem que ir na mensagem também"*. É ali que ele serve: o corretor
    // anota o número que chegou no WhatsApp e liga com ele na mão. Código que só existe na tela
    // obriga a abrir a tela para descobrir o código.
    for (const aviso of avisosDaReserva(DADOS)) {
      expect(aviso.texto).toContain("000123");
      expect(aviso.texto).toContain("COD");
    }
  });

  it("sem código, a frase não fica com buraco onde ele estaria", () => {
    // O COD é interpolado no fim de uma frase pronta; sem ele não pode sobrar espaço dobrado nem
    // linha terminando em branco, que é como um texto montado por concatenação denuncia a falta.
    for (const aviso of avisosDaReserva({ ...DADOS, codigo: "" })) {
      expect(aviso.texto).not.toContain("COD");
      for (const linha of aviso.texto.split("\n")) {
        expect(linha).not.toMatch(/ {2}/u);
        expect(linha).toBe(linha.trimEnd());
      }
    }
  });

  it("o coordenador vê imobiliária, corretor e vencimento", () => {
    const texto = avisosDaReserva(DADOS).find((a) => a.papel === "coordenador")?.texto ?? "";
    expect(texto).toContain("Gurgel Imóveis");
    expect(texto).toContain("João Souza");
    expect(texto).toContain("06/09/2026");
  });
});

describe("reservaComoLinhaDoFluxo", () => {
  const RESERVA = {
    criado_em: "2026-09-03T18:00:00.000Z",
    id: "res-1",
    imobiliaria_nome: "Gurgel Imóveis",
    proponentes: [{ cpf: "529.982.247-25", nome: "Maria da Silva", telefone: "62991234567" }],
    unidade_id: "uni-1",
    validade_em: "2026-09-07T02:59:59.000Z",
  };
  const UNIDADE = { codigo: "VOC1206", lote: "06", preco_tabela: 136_521, quadra: "12" };

  it("entra no fluxo como etapa reservado", () => {
    // ⚠️ `reservado` (a etapa do fluxo), e não `reservada` (o par de "vendida sem proposta"): a
    // reserva do Panteon tem dono, prazo e quem criou — é passo do caminho, e conta no funil.
    const linha = reservaComoLinhaDoFluxo(RESERVA, UNIDADE, "VOC");
    expect(linha.etapa).toBe("reservado");
  });

  it("⚠️ o id ganha prefixo para não colidir com o da proposta", () => {
    // São dois uuids de tabelas diferentes; sem prefixo, um clique na lista abriria a errada.
    expect(reservaComoLinhaDoFluxo(RESERVA, UNIDADE, "VOC").id).toBe("reserva:res-1");
  });

  it("traz o titular, a unidade e o preço de tabela", () => {
    const linha = reservaComoLinhaDoFluxo(RESERVA, UNIDADE, "VOC");
    expect(linha.cliente_nome).toBe("Maria da Silva");
    expect(linha.unidade_nome).toBe("12 06");
    expect(linha.valor).toBe(136_521);
    expect(linha.imobiliaria_nome).toBe("Gurgel Imóveis");
  });

  it("não estoura com proponentes vazio nem sem unidade", () => {
    const linha = reservaComoLinhaDoFluxo({ ...RESERVA, proponentes: [] }, null, null);
    expect(linha.cliente_nome).toBeNull();
    expect(linha.unidade_nome).toBeNull();
    expect(linha.valor).toBeNull();
  });

  it("proponentes que não é lista não derruba a conversão", () => {
    // O jsonb aceita qualquer forma; a carga do salão pode gravar diferente.
    const linha = reservaComoLinhaDoFluxo({ ...RESERVA, proponentes: null }, UNIDADE, "VOC");
    expect(linha.cliente_nome).toBeNull();
  });
});
