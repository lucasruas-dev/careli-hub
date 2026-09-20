import { describe, expect, it } from "vitest";

/**
 * A fila de papéis que a regra descreve, do primeiro ao último.
 *
 * ⚠️ A REGRA DEIXOU DE SER UMA LISTA. Desde 13/09/2026 ela guarda um NÚMERO por papel, porque
 * "comprador 1 e todo o resto 2" é o caso comum da casa e uma permutação não sabe dizer isso.
 * `gruposDaRegra` devolve os papéis agrupados por número; achatar dá a mesma fila que os testes
 * antigos conferiam, e por isso eles continuam valendo palavra por palavra.
 */
const fila = (r: { ordens: Record<string, number> }) =>
  gruposDaRegra(r as never).flat();


import { descreverRegra, lerRegraDeOrdem, ordenarSignatarios, ORDEM_PADRAO, gruposDaRegra } from "./ordem";
import { rotuloDoPapel, type Signatario } from "./tipos";

// ⚠️ O QUE ESTES TESTES PROTEGEM. A ordem de assinatura é feita HOJE na mão, contrato a contrato
// (Lucas, 07/09/2026: *"isso hoje traz um trabalho enorme para gente, pois fazemos isso de forma
// manual"*). Errar aqui não trava nada — o contrato sai, o cliente assina antes da vendedora, e só
// se descobre quando o jurídico confere. É o tipo de defeito que precisa de teste, não de revisão.

const pessoa = (papel: Signatario["papel"], nome: string): Omit<Signatario, "ordem"> => ({
  email: `${nome.toLowerCase()}@exemplo.com.br`,
  nome,
  papel,
});

describe("a ordem padrão", () => {
  // ⚠️ NASCE DESLIGADA. Ligar a ordem na carteira inteira mudaria o comportamento de contratos que
  // hoje saem em paralelo, sem ninguém ter pedido — e o sintoma seria contrato "parado" esperando
  // alguém que antes assinava a qualquer hora.
  it("deixa todos assinando ao mesmo tempo", () => {
    const saida = ordenarSignatarios([
      pessoa("comprador", "João"),
      pessoa("vendedora", "Praia"),
      pessoa("testemunha", "Valério"),
    ]);
    expect(saida.map((s) => s.ordem)).toEqual([0, 0, 0]);
  });

  it("descreve isso em português", () => {
    expect(descreverRegra(ORDEM_PADRAO, rotuloDoPapel)).toBe("Todos assinam ao mesmo tempo.");
  });
});

describe("a ordem por papel", () => {
  const regra = { ...ORDEM_PADRAO, ordenada: true };

  it("põe o comprador antes da vendedora e a testemunha por último", () => {
    const saida = ordenarSignatarios(
      [pessoa("testemunha", "Valério"), pessoa("vendedora", "Praia"), pessoa("comprador", "João")],
      regra,
    );
    const por = Object.fromEntries(saida.map((s) => [s.nome, s.ordem]));
    expect(por.João).toBeLessThan(por.Praia as number);
    expect(por.Praia).toBeLessThan(por.Valério as number);
  });

  // ⚠️ TRÊS COMPRADORES NÃO FAZEM FILA ENTRE SI. Pôr um para esperar o outro transforma uma venda de
  // casal numa fila de dois dias. Número repetido = "ao mesmo tempo" nos dois provedores.
  it("dá o mesmo número a quem tem o mesmo papel", () => {
    const saida = ordenarSignatarios(
      [pessoa("comprador", "João"), pessoa("comprador", "Maria"), pessoa("comprador", "Ana")],
      regra,
    );
    expect(new Set(saida.map((s) => s.ordem)).size).toBe(1);
  });

  it("o cônjuge assina junto com o comprador? não — mas logo depois, e antes da vendedora", () => {
    const saida = ordenarSignatarios(
      [pessoa("vendedora", "Praia"), pessoa("conjuge", "Maria"), pessoa("comprador", "João")],
      regra,
    );
    const por = Object.fromEntries(saida.map((s) => [s.nome, s.ordem]));
    expect(por.João).toBeLessThan(por.Maria as number);
    expect(por.Maria).toBeLessThan(por.Praia as number);
  });

  // ⚠️ SEM BURACOS NA NUMERAÇÃO. A Clicksign aceita 1, 3, 6; o D4Sign se confunde, e a tela mostraria
  // degraus que não significam nada.
  it("compacta os números quando faltam papéis", () => {
    const saida = ordenarSignatarios(
      [pessoa("comprador", "João"), pessoa("testemunha", "Valério")],
      regra,
    );
    expect(saida.map((s) => s.ordem).sort()).toEqual([1, 2]);
  });

  it("um signatário só recebe ordem 1, não 0", () => {
    expect(ordenarSignatarios([pessoa("comprador", "João")], regra)[0]?.ordem).toBe(1);
  });

  it("escreve a regra em uma linha", () => {
    const r = lerRegraDeOrdem({ ordenada: true, papeis: ["comprador", "vendedora"] });
    expect(descreverRegra(r, rotuloDoPapel)).toBe(
      "Comprador → Vendedora → Cônjuge → Coordenador de Vendas → Corretor / imobiliária → Testemunha",
    );
  });

  // ⚠️ VÍRGULA DENTRO DO GRUPO, SETA ENTRE GRUPOS. A frase precisa distinguir "assinam juntos" de
  // "um espera o outro" — uma seta entre todos diria que a coordenadora espera a vendedora, que é
  // outra operação.
  it("escreve quem assina junto com vírgula, e quem espera com seta", () => {
    const r = lerRegraDeOrdem({
      ordenada: true,
      ordens: { comprador: 1, conjuge: 1, coordenadora: 2, corretor: 2, testemunha: 2, vendedora: 2 },
    });
    expect(descreverRegra(r, rotuloDoPapel)).toBe(
      "Comprador, Cônjuge → Vendedora, Coordenador de Vendas, Corretor / imobiliária, Testemunha",
    );
  });

  // ⚠️ A CARELI NÃO ENTRA NA FRASE DO CONTRATO. Ela é papel do TERMO DE ACORDO do Hades (Lucas,
  // 20/09/2026: *"Assina como careli"*) e entrou em `PAPEIS` no fim, para não renumerar ninguém —
  // mas `descreverRegra` e `gruposDaRegra` descrevem a fila de uma VENDA, e iterar a lista inteira
  // faria todo empreendimento da casa exibir "... → Careli" numa frase sobre um documento que ela
  // não assina.
  it("a Careli fica fora da fila do contrato", () => {
    const r = lerRegraDeOrdem({ ordenada: true, papeis: ["comprador"] });

    expect(descreverRegra(r, rotuloDoPapel)).not.toContain("Careli");
    expect(gruposDaRegra(r).flat()).not.toContain("careli");
  });

  // ⚠️ MAS ELA CONTINUA TENDO NÚMERO CANÔNICO, e é o ÚLTIMO. É isso que faz o termo de acordo sair
  // na ordem que o Lucas pediu (comprador, incorporador, Careli) sem uma segunda tabela de números.
  it("mas ela tem número canônico, e assina por último", () => {
    const { ordens } = ORDEM_PADRAO;

    expect(ordens.careli).toBeGreaterThan(ordens.comprador);
    expect(ordens.careli).toBeGreaterThan(ordens.vendedora);
    expect(ordens.careli).toBeGreaterThan(ordens.testemunha);
  });

  // Os dois papéis que o contrato de CORRETAGEM traz, e que não existiam antes de 08/09/2026.
  it("conhece a coordenadora de vendas e o corretor", () => {
    const saida = ordenarSignatarios(
      [pessoa("corretor", "Imobiliária"), pessoa("coordenadora", "Careli"), pessoa("comprador", "João")],
      regra,
    );
    const por = Object.fromEntries(saida.map((s) => [s.nome, s.ordem]));
    expect(por.João).toBeLessThan(por.Careli as number);
    expect(por.Careli).toBeLessThan(por.Imobiliária as number);
  });
});

describe("ler a regra gravada", () => {
  it("nulo e lixo caem no padrão", () => {
    expect(lerRegraDeOrdem(null)).toEqual(ORDEM_PADRAO);
    expect(lerRegraDeOrdem("qualquer coisa")).toEqual(ORDEM_PADRAO);
    expect(lerRegraDeOrdem(42)).toEqual(ORDEM_PADRAO);
  });

  it("respeita a ordem que foi gravada", () => {
    const r = lerRegraDeOrdem({ ordenada: true, papeis: ["vendedora", "comprador"] });
    expect(r.ordenada).toBe(true);
    expect(fila(r).slice(0, 2)).toEqual(["vendedora", "comprador"]);
  });

  // ⚠️ JSONB SUJO NÃO DERRUBA A REGRA. Um papel renomeado no código continuaria gravado no banco;
  // recusar a regra inteira faria o contrato voltar ao paralelo em silêncio — que é justamente o
  // trabalho manual que isto veio eliminar.
  it("descarta papel que não existe mais e completa o que falta", () => {
    const r = lerRegraDeOrdem({ ordenada: true, papeis: ["comprador", "avalista", "vendedora"] });
    expect(fila(r)).not.toContain("avalista");
    expect(fila(r).slice(0, 2)).toEqual(["comprador", "vendedora"]);
    // Os que não foram listados continuam existindo, no fim, na ordem canônica.
    expect(fila(r)).toContain("testemunha");
  });

  it("não repete papel listado duas vezes", () => {
    const r = lerRegraDeOrdem({ ordenada: true, papeis: ["comprador", "comprador"] });
    expect(fila(r).filter((p) => p === "comprador")).toHaveLength(1);
  });

  // ⚠️ O CASO COMUM DA CASA, e a razão de o modelo ter mudado. Lucas (13/09/2026): *"eu posso
  // colocar o comprador como 1 e o resto como 2"* e *"essa personalização é bem comum para
  // gente"*. Com a permutação anterior isto era impossível de expressar: seis papéis viravam seis
  // degraus, sempre.
  it("comprador 1 e todo o resto 2: sai 1 e 2, e nunca uma fila de seis", () => {
    const regra = lerRegraDeOrdem({
      ordenada: true,
      ordens: { comprador: 1, conjuge: 2, coordenadora: 2, corretor: 2, testemunha: 2, vendedora: 2 },
    });

    const ordens = ordenarSignatarios(
      [
        pessoa("comprador", "Ana Comprador"),
        pessoa("conjuge", "Bruno Conjuge"),
        pessoa("vendedora", "Vendedora SPE"),
        pessoa("coordenadora", "Coordenadora Vendas"),
        pessoa("corretor", "Carlos Corretor"),
        pessoa("testemunha", "Dina Testemunha"),
      ],
      regra,
    ).map((s) => s.ordem);

    expect(ordens[0]).toBe(1);
    expect(ordens.slice(1)).toEqual([2, 2, 2, 2, 2]);
  });

  // ⚠️ A COMPACTAÇÃO NÃO PODE DESEMPATAR. Se ela renumerasse pessoa a pessoa, o caso de cima
  // viraria 1,2,3,4,5,6 — a fila que o cadastro existe para evitar. Aqui os números cadastrados
  // têm buraco (1 e 7) e o resultado tem de fechar em 1 e 2, mantendo o empate.
  it("compacta os números sem desfazer o empate", () => {
    const regra = lerRegraDeOrdem({
      ordenada: true,
      ordens: { comprador: 1, vendedora: 7, coordenadora: 7 },
    });

    const ordens = ordenarSignatarios(
      [pessoa("comprador", "Ana Comprador"), pessoa("vendedora", "Vendedora SPE"), pessoa("coordenadora", "Coordenadora Vendas")],
      regra,
    ).map((s) => s.ordem);

    expect(ordens).toEqual([1, 2, 2]);
  });

  // ⚠️ A TESTEMUNHA TEM NÚMERO PRÓPRIO. Lucas: *"dentro das testemunha eu posso colocar uma
  // testemunha assina na ordem 1 e outra na ordem 4"*. É o único papel cujas pessoas são
  // cadastradas uma a uma, então é o único onde a ordem por PESSOA não envelhece.
  it("a ordem da pessoa vence a do papel", () => {
    const regra = lerRegraDeOrdem({ ordenada: true, ordens: { comprador: 1, testemunha: 3 } });

    const ordens = ordenarSignatarios(
      [
        pessoa("comprador", "Ana Comprador"),
        { ...pessoa("testemunha", "Dina Testemunha"), ordemPropria: 1 },
        { ...pessoa("testemunha", "Elias Testemunha"), ordemPropria: 4 },
      ],
      regra,
    ).map((s) => s.ordem);

    // A primeira testemunha empata com o comprador; a segunda fica depois das duas.
    expect(ordens).toEqual([1, 1, 2]);
  });

  it("ordenada só é true quando é true de verdade", () => {
    expect(lerRegraDeOrdem({ ordenada: "sim", papeis: [] }).ordenada).toBe(false);
    expect(lerRegraDeOrdem({ papeis: ["comprador"] }).ordenada).toBe(false);
  });
});
