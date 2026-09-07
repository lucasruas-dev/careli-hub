import { describe, expect, it } from "vitest";

import {
  aplicarPropostas,
  motivoDaRecusa,
  type Proposta,
  triarPropostas,
} from "./marcar-variaveis";

// ⚠️ O QUE ESTES TESTES PROTEGEM. Aqui uma IA propõe mudanças num CONTRATO. Cada recusa que falhar
// vira um defeito no papel que o cliente assina — e nenhum deles dá erro em tempo de execução.

const TEXTO =
  "COMPRADOR: JOÃO DA SILVA, de nacionalidade brasileira, casado, portador do CPF n.º " +
  "123.456.789-00, residente na Rua das Flores, 100. Quadra 12 - Lote 07.";

describe("triagem das propostas", () => {
  it("aceita o que existe no catálogo e aparece uma vez só", () => {
    const { aceitas, recusadas } = triarPropostas(TEXTO, [
      { motivo: "nome do comprador", nome: "nome_cliente", trecho: "JOÃO DA SILVA" },
      { motivo: "CPF", nome: "cpf_cliente", trecho: "123.456.789-00" },
    ]);
    expect(aceitas.map((a) => a.nome)).toEqual(["cpf_cliente", "nome_cliente"]); // ordem decrescente
    expect(recusadas).toEqual([]);
  });

  // ⚠️ O DEFEITO MAIS PROVÁVEL DE TODOS: o modelo vê "CPF do fiador" e propõe `[cpf_fiador]`, que
  // não existe. Aplicado, imprimiria `[cpf_fiador]` no contrato assinado.
  it("recusa variável que a IA inventou", () => {
    const { aceitas, recusadas } = triarPropostas(TEXTO, [
      { motivo: "inventada", nome: "cpf_fiador", trecho: "JOÃO DA SILVA" },
    ]);
    expect(aceitas).toEqual([]);
    expect(recusadas[0]?.motivo).toBe("fora_do_catalogo");
  });

  // ⚠️ Num contrato com cinco compradores, "CPF n.º" aparece cinco vezes. Trocar a primeira
  // ocorrência marcaria o comprador errado — em silêncio, porque o resultado parece certo.
  it("recusa trecho que aparece mais de uma vez", () => {
    const doisIguais = "CPF n.º 111 e depois CPF n.º 222";
    const { aceitas, recusadas } = triarPropostas(doisIguais, [
      { motivo: "ambíguo", nome: "cpf_cliente", trecho: "CPF n.º" },
    ]);
    expect(aceitas).toEqual([]);
    expect(recusadas[0]?.motivo).toBe("trecho_ambiguo");
  });

  // A IA parafraseia, corrige acento, muda espaço. Substituir pelo aproximado mexeria no texto
  // jurídico — que é justamente o que este desenho existe para não fazer.
  it("recusa trecho que não está no texto exatamente assim", () => {
    const { recusadas } = triarPropostas(TEXTO, [
      { motivo: "parafraseado", nome: "nome_cliente", trecho: "Joao da Silva" },
    ]);
    expect(recusadas[0]?.motivo).toBe("trecho_nao_encontrado");
  });

  it("recusa marcar o que já é variável", () => {
    const jaMarcado = "COMPRADOR: [nome_cliente], casado";
    const { recusadas } = triarPropostas(jaMarcado, [
      { motivo: "duplo", nome: "nome_cliente", trecho: "[nome_cliente]" },
    ]);
    expect(recusadas[0]?.motivo).toBe("ja_marcado");
  });

  it("aceita o nome com ou sem colchetes", () => {
    const { aceitas } = triarPropostas(TEXTO, [
      { motivo: "com colchete", nome: "[nome_cliente]", trecho: "JOÃO DA SILVA" },
    ]);
    expect(aceitas[0]?.nome).toBe("nome_cliente");
  });

  it("recusa trecho vazio", () => {
    const { recusadas } = triarPropostas(TEXTO, [
      { motivo: "vazio", nome: "nome_cliente", trecho: "   " },
    ]);
    expect(recusadas[0]?.motivo).toBe("trecho_nao_encontrado");
  });

  it("ordena as aceitas da última posição para a primeira", () => {
    const { aceitas } = triarPropostas(TEXTO, [
      { motivo: "a", nome: "nome_cliente", trecho: "JOÃO DA SILVA" },
      { motivo: "b", nome: "numero_lote", trecho: "07" },
    ]);
    expect(aceitas[0]?.posicao).toBeGreaterThan(aceitas[1]?.posicao ?? 0);
  });
});

describe("aplicar as propostas", () => {
  it("troca o trecho pela variável", () => {
    const { aceitas } = triarPropostas(TEXTO, [
      { motivo: "nome", nome: "nome_cliente", trecho: "JOÃO DA SILVA" },
    ]);
    expect(aplicarPropostas(TEXTO, aceitas)).toContain("COMPRADOR: [nome_cliente], de nacionalidade");
  });

  // ⚠️ DE TRÁS PARA A FRENTE. Aplicar da primeira para a última muda o comprimento do texto e
  // invalida as posições seguintes — o clássico que produz marcação no lugar errado.
  it("aplica várias sem embaralhar as posições", () => {
    const { aceitas } = triarPropostas(TEXTO, [
      { motivo: "nome", nome: "nome_cliente", trecho: "JOÃO DA SILVA" },
      { motivo: "cpf", nome: "cpf_cliente", trecho: "123.456.789-00" },
      { motivo: "lote", nome: "numero_lote", trecho: "Lote 07" },
    ]);
    const saida = aplicarPropostas(TEXTO, aceitas);
    expect(saida).toContain("[nome_cliente]");
    expect(saida).toContain("[cpf_cliente]");
    expect(saida).toContain("[numero_lote]");
    // E o resto do texto jurídico intacto.
    expect(saida).toContain("de nacionalidade brasileira, casado, portador do");
  });

  // ⚠️ ESTE CASO SAIU DE UM TESTE MEU QUE FALHOU, e ele é a razão de a triagem existir. Propor a
  // quadra com o trecho "12" parece óbvio — e "12" também está DENTRO de "123.456.789-00". Aplicar
  // a primeira ocorrência marcaria o CPF como número da quadra, e o contrato sairia com a quadra no
  // meio do documento do comprador. Não daria erro nenhum: só sairia errado no papel.
  it("recusa o número curto que também vive dentro do CPF", () => {
    const { aceitas, recusadas } = triarPropostas(TEXTO, [
      { motivo: "quadra", nome: "numero_quadra", trecho: "12" },
    ]);
    expect(aceitas).toEqual([]);
    expect(recusadas[0]?.motivo).toBe("trecho_ambiguo");
  });

  it("aplica SÓ o que foi escolhido", () => {
    const { aceitas } = triarPropostas(TEXTO, [
      { motivo: "nome", nome: "nome_cliente", trecho: "JOÃO DA SILVA" },
      { motivo: "cpf", nome: "cpf_cliente", trecho: "123.456.789-00" },
    ]);
    const soUma = aceitas.filter((a) => a.nome === "cpf_cliente");
    const saida = aplicarPropostas(TEXTO, soUma);
    expect(saida).toContain("[cpf_cliente]");
    expect(saida).toContain("JOÃO DA SILVA"); // a outra não foi aplicada
  });

  it("não aplica nada quando a lista está vazia", () => {
    expect(aplicarPropostas(TEXTO, [])).toBe(TEXTO);
  });

  // Rede de segurança: se duas propostas se sobrepuserem, a segunda não corrompe o texto.
  it("ignora a proposta cujo trecho já não está mais no lugar", () => {
    const { aceitas } = triarPropostas(TEXTO, [
      { motivo: "nome", nome: "nome_cliente", trecho: "JOÃO DA SILVA" },
    ]);
    const forjada = [...aceitas, { ...aceitas[0]!, nome: "nome_conjuge" }];
    const saida = aplicarPropostas(TEXTO, forjada);
    // Só uma das duas entrou — a outra achou o texto mudado e desistiu.
    expect(saida.match(/\[nome_(cliente|conjuge)\]/g)).toHaveLength(1);
  });
});

describe("a mensagem da recusa", () => {
  const dizer = (p: Proposta, texto = TEXTO) =>
    motivoDaRecusa(triarPropostas(texto, [p]).recusadas[0]!);

  it("diz que a variável não existe", () => {
    expect(dizer({ motivo: "x", nome: "cpf_fiador", trecho: "JOÃO DA SILVA" })).toContain(
      "não existe no catálogo",
    );
  });

  it("diz que o trecho se repete", () => {
    const m = motivoDaRecusa(
      triarPropostas("CPF n.º 1 e CPF n.º 2", [
        { motivo: "x", nome: "cpf_cliente", trecho: "CPF n.º" },
      ]).recusadas[0]!,
    );
    expect(m).toContain("mais de uma vez");
  });

  it("corta trecho longo, para a mensagem caber na tela", () => {
    const longo = "A".repeat(200);
    const m = motivoDaRecusa(
      triarPropostas(TEXTO, [{ motivo: "x", nome: "nome_cliente", trecho: longo }]).recusadas[0]!,
    );
    expect(m).toContain("…");
    expect(m.length).toBeLessThan(120);
  });
});
