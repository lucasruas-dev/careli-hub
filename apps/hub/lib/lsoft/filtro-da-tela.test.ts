import { describe, expect, it } from "vitest";

import {
  clientesDaTela,
  filtroDaExportacao,
  parametrosDaExportacao,
} from "@/lib/lsoft/filtro-da-tela";

// A regra dos dois checkboxes da LSoft Integração. A tela e a planilha chamam esta mesma função;
// se ela mudar, as duas mudam juntas, e é isso que estes testes prendem.

type Cliente = {
  codigo: string;
  patrimonioParcelasAbertas: number;
  statusValidacao: "dispensado" | "em_analise" | "pendente" | "validado";
};

const clientes: Cliente[] = [
  { codigo: "1", patrimonioParcelasAbertas: 0, statusValidacao: "validado" },
  { codigo: "2", patrimonioParcelasAbertas: 3, statusValidacao: "pendente" },
  { codigo: "3", patrimonioParcelasAbertas: 1, statusValidacao: "validado" },
  { codigo: "4", patrimonioParcelasAbertas: 0, statusValidacao: "em_analise" },
  { codigo: "5", patrimonioParcelasAbertas: 0, statusValidacao: "dispensado" },
];

const codigos = (lista: Cliente[]) => lista.map((c) => c.codigo);

describe("clientesDaTela", () => {
  it("sem checkbox marcado, devolve todos, na ordem em que vieram do servidor", () => {
    expect(codigos(clientesDaTela(clientes, { somentePatrimonio: false, somentePendentes: false }))).toEqual([
      "1",
      "2",
      "3",
      "4",
      "5",
    ]);
  });

  it("'Só o que falta validar' tira só o validado: dispensado e em análise ficam", () => {
    expect(codigos(clientesDaTela(clientes, { somentePatrimonio: false, somentePendentes: true }))).toEqual([
      "2",
      "4",
      "5",
    ]);
  });

  it("'Só patrimônio' deixa quem tem parcela de patrimônio em aberto", () => {
    expect(codigos(clientesDaTela(clientes, { somentePatrimonio: true, somentePendentes: false }))).toEqual([
      "2",
      "3",
    ]);
  });

  it("os dois juntos são E, não OU", () => {
    expect(codigos(clientesDaTela(clientes, { somentePatrimonio: true, somentePendentes: true }))).toEqual(["2"]);
  });
});

describe("parâmetros da exportação", () => {
  it("vão e voltam iguais: o que a tela manda é o que a rota lê", () => {
    const filtro = {
      busca: "Maria",
      empreendimento: "Vale do Ouro - 2",
      somentePatrimonio: true,
      somentePendentes: true,
    };
    const parametros = parametrosDaExportacao(filtro);

    expect(parametros.get("formato")).toBe("xlsx");
    // Os MESMOS nomes que a leitura da lista já usa nas duas rotas.
    expect(parametros.get("q")).toBe("Maria");
    expect(parametros.get("emp")).toBe("Vale do Ouro - 2");
    expect(filtroDaExportacao(new URLSearchParams(parametros.toString()))).toEqual(filtro);
  });

  it("checkbox desmarcado e busca vazia não viajam, e voltam como falso e vazio", () => {
    const parametros = parametrosDaExportacao({
      busca: "   ",
      empreendimento: "",
      somentePatrimonio: false,
      somentePendentes: false,
    });

    expect(parametros.toString()).toBe("formato=xlsx");
    expect(filtroDaExportacao(parametros)).toEqual({
      busca: "",
      empreendimento: "",
      somentePatrimonio: false,
      somentePendentes: false,
    });
  });
});
