import { describe, expect, it } from "vitest";

// O PLANO ESCOLHIDO SE RESOLVE PELA POSIÇÃO, NUNCA PELO NOME.
//
// ⚠️ ESTE ARQUIVO EXISTE POR UM DEFEITO MUDO QUE ESTAVA NO AR. O `SimuladorDeProposta` resolvia o
// MESMO plano por dois caminhos opostos:
//
//   planoBase = planosDaConta.find(p => p.nome === planoAtivo)   → o PRIMEIRO com aquele nome
//   crus      = new Map(planos.map(p => [p.nome, p]))            → num Map, o ÚLTIMO VENCE
//
// Do primeiro saíam parcelas, entrada e taxa (o que a tela mostra). Do segundo saíam índice de
// correção, sistema de amortização e convenção de juros (o que vai para o cronograma, o PDF e o
// contrato). Com nomes repetidos na lista, eram DOIS PLANOS DIFERENTES na mesma simulação.
//
// ⚠️ E OS NOMES SE REPETEM EM PRODUÇÃO: medido em 15/09/2026, o VLO (pai, 35) e o VOC (filho, 37)
// têm cada um CURTO, INVESTIDOR e NORMAL. Para um lote do VOC a lista chegava com seis planos e
// três nomes. Os valores coincidiam, então nada aparecia errado — o defeito esperava alguém editar
// o plano de um dos lados.
//
// O teste é sobre a MECÂNICA da escolha, não sobre o componente: é ela que estava errada, e é ela
// que precisa continuar certa quando alguém mexer no simulador de novo.

type Plano = {
  indiceCorrecao: string;
  nome: string;
  parcelas: number;
};

/** O que a tela fazia ANTES: números pelo primeiro, cadastro pelo último. */
function comoEraAntes(planos: Plano[], escolhido: string) {
  const numeros = planos.find((p) => p.nome === escolhido) ?? planos[0] ?? null;
  const porNome = new Map(planos.map((p) => [p.nome, p]));
  const cadastro = numeros ? porNome.get(numeros.nome) : undefined;
  return { cadastro, numeros };
}

/** O que a tela faz AGORA: os dois saem do mesmo índice. */
function comoEAgora(planos: Plano[], escolhido: string) {
  const achado = planos.findIndex((p) => p.nome === escolhido);
  const i = achado >= 0 ? achado : planos.length > 0 ? 0 : -1;
  return {
    cadastro: i >= 0 ? planos[i] : undefined,
    numeros: i >= 0 ? (planos[i] ?? null) : null,
  };
}

// A lista como ela chega para um lote do VOC quando pai e filho têm planos: mesmos nomes, ordem
// do banco. O do PAI vem depois neste exemplo — é o que o `Map` elegeria.
const LISTA: Plano[] = [
  { indiceCorrecao: "IPCA_ANUAL", nome: "NORMAL", parcelas: 156 },
  { indiceCorrecao: "SEM_CORRECAO", nome: "CURTO", parcelas: 36 },
  { indiceCorrecao: "INCC_M_MENSAL", nome: "NORMAL", parcelas: 120 },
];

describe("o defeito que existia", () => {
  it("dava números de um plano e cadastro de OUTRO", () => {
    const antes = comoEraAntes(LISTA, "NORMAL");

    // Os números vieram do primeiro NORMAL…
    expect(antes.numeros?.parcelas).toBe(156);
    // …e o índice de correção, do último. Dois planos na mesma simulação.
    expect(antes.cadastro?.indiceCorrecao).toBe("INCC_M_MENSAL");
    expect(antes.numeros?.indiceCorrecao).not.toBe(antes.cadastro?.indiceCorrecao);
  });
});

describe("como está agora", () => {
  it("os dois saem do MESMO plano", () => {
    const agora = comoEAgora(LISTA, "NORMAL");

    expect(agora.numeros?.parcelas).toBe(156);
    expect(agora.cadastro?.indiceCorrecao).toBe("IPCA_ANUAL");
    expect(agora.cadastro).toBe(agora.numeros);
  });

  it("vale para qualquer nome da lista", () => {
    const agora = comoEAgora(LISTA, "CURTO");
    expect(agora.numeros?.parcelas).toBe(36);
    expect(agora.cadastro).toBe(agora.numeros);
  });

  // ⚠️ O PADRÃO CONTINUA SENDO O PRIMEIRO DA LISTA: é o que a tela mostra antes de alguém escolher.
  it("nome desconhecido cai no primeiro, e os dois continuam casados", () => {
    const agora = comoEAgora(LISTA, "QUE NÃO EXISTE");
    expect(agora.numeros?.parcelas).toBe(156);
    expect(agora.cadastro).toBe(agora.numeros);
  });

  it("lista vazia não quebra", () => {
    const agora = comoEAgora([], "NORMAL");
    expect(agora.numeros).toBeNull();
    expect(agora.cadastro).toBeUndefined();
  });

  // Com a hierarquia de `recorte-da-unidade.ts` no lugar, a lista deixa de trazer pai e filho
  // juntos — mas a mecânica tem de continuar correta, porque nomes repetidos podem existir DENTRO
  // do mesmo degrau (dois "Normal", um Price e outro SACOC, é caso legítimo desde a 0143).
  it("dois planos de mesmo nome no MESMO empreendimento continuam distinguíveis", () => {
    const mesmoNivel: Plano[] = [
      { indiceCorrecao: "IPCA_ANUAL", nome: "Normal", parcelas: 120 },
      { indiceCorrecao: "SEM_CORRECAO", nome: "Normal", parcelas: 60 },
    ];
    const agora = comoEAgora(mesmoNivel, "Normal");
    expect(agora.cadastro).toBe(agora.numeros);
    expect(agora.numeros?.parcelas).toBe(120);
  });
});
