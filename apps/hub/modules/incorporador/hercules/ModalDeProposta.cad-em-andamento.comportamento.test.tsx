// @vitest-environment jsdom

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// A TELA NÃO PODE MENTIR: TRÊS ESTADOS DO SELO, E O DO MEIO NASCEU EM 26/09/2026.
//
// Lucas (26/09/2026): *"pode deixar os coordenadores emitirem proposta sem a cad esta credenciada.
// ela pode estar em validacao ou em qualquer outro estagio"*. Sobre o print da CAD do MATEUS COTTA
// SACCHETTO em `validacao` (lote EIRETAMA-14, Aldeia das Cachoeiras das Pedras, empreendimento 42):
// *"essa devia passar"*.
//
// ⚠️ O RISCO QUE ESTE ARQUIVO TRAVA É A TELA MENTIR. Se o afrouxamento tivesse virado
// `credenciado: true`, o selo passaria a escrever "CAD credenciada neste empreendimento / A reserva
// pode virar proposta" em cima de uma CAD em validação — e o coordenador deixaria de saber que o
// cadastro ainda está com a coordenação. A decisão foi outra: `credenciado` continua dizendo a
// verdade sobre a CAD, `podeGerarProposta` decide a porta, e a tela mostra OS DOIS.
//
// ⚠️ E O RODAPÉ É METADE DA MENTIRA. A frase "Sem a CAD credenciada neste empreendimento a proposta
// não pode ser gerada" embaixo de um botão ACESO diz ao coordenador o contrário do que a rota
// responde. Ela só pode aparecer para quem está de fato barrado.
//
// O andaime (React no global, `IS_REACT_ACT_ENVIRONMENT`, simulador dublê) é o mesmo de
// `ModalDeProposta.comportamento.test.tsx`, e está explicado lá.

(globalThis as unknown as { React: typeof React }).React = React;
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("./SimuladorDeProposta", async () => {
  const react = await import("react");
  return {
    SimuladorDeProposta: () => react.createElement("div", null, "simulador"),
  };
});

const { ModalDeProposta } = await import("./ModalDeProposta");

const CPF_DO_TITULAR = "52998224725";

/**
 * O credenciamento como o GET o entrega — a MESMA forma de `CredenciamentoNaTela`.
 *
 * ⚠️ NOMEADO, e não inferido de um dos fixtures: `typeof CREDENCIADA` daria `motivo: null` e o
 * fixture com frase nem compilaria. O tipo é o CONTRATO da rota, e os fixtures são casos dele.
 */
type CredenciamentoNoGet = {
  /** (26/09/2026) A porta da carteira foi o contrato lido AGORA, ou a CAD que ela já abriu. */
  contratoAtivo?: boolean;
  /** (26/09/2026) A barra do contrato recusa o comprador da carteira? Espelho de `A_CARTEIRA_VALE_PARA_O_CONTRATO`. */
  contratoExigeCad?: boolean;
  credenciado: boolean;
  desde: null | string;
  etapa: null | string;
  motivo: null | string;
  /** (26/09/2026) Por qual porta passou. É o campo que a junção das duas réguas trouxe para cá. */
  origem?: null | "cad" | "comprador_da_carteira";
  podeGerarProposta: boolean;
};

/** O portão do GET, com o credenciamento que cada teste pedir. */
function portaoCom(credenciamento: CredenciamentoNoGet) {
  return {
    credenciamento,
    entradaMinimaPercentual: 10,
    planos: [
      {
        entradaPercentual: 10,
        id: "plano-1",
        indiceCorrecao: "IPCA",
        jurosConvencao: "nominal",
        jurosPeriodicidade: "mensal",
        jurosTaxa: 0.008,
        nome: "PRICE 120x",
        parcelas: 120,
        sistemaAmortizacao: "PRICE",
        slot: null,
      },
    ],
    reserva: {
      codigo: "RES-0042",
      corretor: null,
      criadoEm: "2026-09-26T12:00:00.000Z",
      id: "reserva-1",
      imobiliaria: null,
      titular: {
        cpf: CPF_DO_TITULAR,
        nome: "MATEUS COTTA SACCHETTO",
        telefone: "62999990000",
      },
      validadeEm: null,
    },
    unidade: {
      enterpriseId: "42",
      id: "unidade-1",
      nome: "EIRETAMA 14",
      preco: 200_000,
      produto: "Aldeia das Cachoeiras das Pedras",
    },
  };
}

/** A CAD em validação: a porta abre, e a CAD continua não credenciada. O estado do print. */
const EM_VALIDACAO: CredenciamentoNoGet = {
  credenciado: false,
  desde: "2026-09-26T17:11:31.401Z",
  etapa: "validacao",
  motivo: "A CAD deste cliente está em validação de cadastro desde 26/09/2026.",
  podeGerarProposta: true,
};

/** A CAD indeferida: continua barrada, e é a decisão do Lucas de manter essa recusa. */
const INDEFERIDA: CredenciamentoNoGet = {
  credenciado: false,
  desde: "2026-09-26T17:11:31.401Z",
  etapa: "indeferido",
  motivo: "A CAD deste cliente está com o cadastro indeferido desde 26/09/2026.",
  podeGerarProposta: false,
};

const CREDENCIADA: CredenciamentoNoGet = {
  credenciado: true,
  desde: "2026-09-01T12:00:00.000Z",
  etapa: "credenciado",
  motivo: null,
  podeGerarProposta: true,
};

const RODAPE_QUE_BARRA =
  "Sem a CAD credenciada neste empreendimento a proposta não pode ser gerada.";

let alvo: HTMLDivElement;
let raiz: Root;

function botao(texto: string): HTMLButtonElement {
  const achado = [...alvo.querySelectorAll("button")].find(
    (b) => b.textContent?.trim() === texto,
  );
  if (!achado) throw new Error(`Botão "${texto}" não está na tela.`);
  return achado;
}

async function abrirCom(credenciamento: CredenciamentoNoGet) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      text: async () => JSON.stringify({ data: portaoCom(credenciamento) }),
    })),
  );
  await act(async () => {
    raiz.render(
      <ModalDeProposta
        onFechar={vi.fn()}
        onGerada={vi.fn()}
        unidade={{ id: "unidade-1", nome: "EIRETAMA 14", produto: "Aldeia" }}
      />,
    );
  });
}

beforeEach(() => {
  alvo = document.createElement("div");
  document.body.appendChild(alvo);
  raiz = createRoot(alvo);
});

afterEach(() => {
  act(() => raiz.unmount());
  alvo.remove();
  vi.unstubAllGlobals();
});

describe("o selo da CAD na modal de proposta", () => {
  it("CAD em andamento: o coordenador LÊ a etapa e o botão fica LIBERADO", async () => {
    await abrirCom(EM_VALIDACAO);

    // O terceiro estado, que não é o verde nem o vermelho.
    expect(alvo.textContent).toContain("CAD em andamento");
    // ⚠️ A FRASE DA ETAPA CONTINUA NA TELA. É ela que diz ao coordenador a quem cobrar.
    expect(alvo.textContent).toContain(
      "A CAD deste cliente está em validação de cadastro desde 26/09/2026.",
    );
    // ⚠️ E O SELO NÃO MENTE: não pode dizer que a CAD está credenciada.
    expect(alvo.textContent).not.toContain("CAD credenciada neste empreendimento");
    // ⚠️ NEM O RODAPÉ: a frase que barra não aparece por baixo de um botão aceso.
    expect(alvo.textContent).not.toContain(RODAPE_QUE_BARRA);
    expect(botao("Montar as condições").disabled).toBe(false);
  });

  it("CAD indeferida: o botão TRAVA e o rodapé volta a dizer que a proposta não sai", async () => {
    await abrirCom(INDEFERIDA);

    expect(alvo.textContent).toContain("CAD não credenciada");
    expect(alvo.textContent).toContain(
      "A CAD deste cliente está com o cadastro indeferido desde 26/09/2026.",
    );
    expect(alvo.textContent).toContain(RODAPE_QUE_BARRA);
    expect(alvo.textContent).not.toContain("CAD em andamento");
    expect(botao("Montar as condições").disabled).toBe(true);
  });

  it("CAD credenciada: o selo verde de sempre, sem virar o estado novo", async () => {
    await abrirCom(CREDENCIADA);

    expect(alvo.textContent).toContain("CAD credenciada neste empreendimento");
    expect(alvo.textContent).toContain("A reserva pode virar proposta.");
    expect(alvo.textContent).not.toContain("CAD em andamento");
    expect(alvo.textContent).not.toContain(RODAPE_QUE_BARRA);
    expect(botao("Montar as condições").disabled).toBe(false);
  });

  it("o botão obedece a PORTA que o servidor mandou, e não a etapa que a tela vê", async () => {
    // ⚠️ É O PORTAL DO CECÍLIO: a MESMA CAD em validação, com a porta FECHADA pelo servidor (Lucas,
    // 26/09/2026: o afrouxamento é do coordenador). Se a tela recalculasse a regra a partir da
    // etapa, ela acenderia o botão aqui e ofereceria um clique que a rota responde com 403.
    await abrirCom({ ...EM_VALIDACAO, podeGerarProposta: false });

    expect(alvo.textContent).toContain(
      "A CAD deste cliente está em validação de cadastro desde 26/09/2026.",
    );
    expect(alvo.textContent).not.toContain("CAD em andamento");
    expect(alvo.textContent).toContain(RODAPE_QUE_BARRA);
    expect(botao("Montar as condições").disabled).toBe(true);
  });
});

// ── A JUNÇÃO: OS DOIS TEXTOS NA MESMA TELA (26/09/2026) ──────────────────────
//
// Duas decisões do mesmo dia se encontram aqui, e este describe existe porque o merge das duas podia
// fazer a tela esquecer uma delas:
//   • o COMPRADOR DA CARTEIRA (*"temos que aproveitar esses cadastros de comprador"*) — o chip;
//   • a CAD EM ANDAMENTO com a barra do contrato no fim (*"faz uma barra, para enviar para contrato
//     precisa da cad validada"*) — o selo âmbar e o aviso.
//
// ⚠️ OS DOIS TÊM DE CONVIVER. A CAD que NASCE da carteira nasce `credenciado`
// (`cad-do-comprador.ts`), mas ela pode ser mexida no Board e cair em `revisao`: aí o coordenador
// precisa ler as duas coisas ao mesmo tempo — de onde aquela CAD veio E que o contrato só sai depois
// da aprovação. MEDIDO em produção (`bxgukywoxgivlrhjkwjx`, só SELECT, 26/09/2026):
//   select etapa, origem, count(*) from apolo_esteira group by 1,2;
//     → 1 linha com `origem = 'comprador_da_carteira'`, e ela está `credenciado`. Ninguém cai neste
//       estado hoje; a tela está pronta para o primeiro Board que mexer nessa CAD.
describe("o comprador da carteira e a CAD em andamento, na mesma tela", () => {
  /** A porta da carteira sem CAD nenhuma: passa pelo contrato antigo. */
  const PELA_CARTEIRA: CredenciamentoNoGet = {
    contratoAtivo: true,
    credenciado: true,
    desde: null,
    etapa: null,
    motivo: null,
    origem: "comprador_da_carteira",
    podeGerarProposta: true,
  };

  it("só a carteira: a caixa da carteira, sem selo de CAD e sem o aviso do contrato", async () => {
    await abrirCom(PELA_CARTEIRA);

    expect(alvo.textContent).toContain("Comprador da carteira");
    expect(alvo.textContent).toContain("Contrato ativo neste empreendimento.");
    // ⚠️ NÃO HÁ CAD, então não há selo de CAD para escrever — nem verde nem âmbar.
    expect(alvo.textContent).not.toContain("CAD credenciada neste empreendimento");
    expect(alvo.textContent).not.toContain("CAD em andamento");
    // ⚠️ E NÃO HÁ PAREDE NO FIM: esta pessoa passa pela barra do contrato
    // (`A_CARTEIRA_VALE_PARA_O_CONTRATO`, cad-para-contrato.ts), então avisar seria mentir.
    expect(alvo.textContent).not.toContain("O contrato só sai depois que a CAD for aprovada.");
    expect(alvo.textContent).not.toContain("a carteira vale para a proposta, não para o contrato");
    expect(alvo.textContent).not.toContain(RODAPE_QUE_BARRA);
    expect(botao("Montar as condições").disabled).toBe(false);
  });

  it("⚠️ se a barra do contrato passar a RECUSAR a carteira, a caixa avisa AQUI, não num 409", async () => {
    // ⚠️ ESTE TESTE É A SAÍDA DE EMERGÊNCIA DE VERDADE. A decisão da barra é um booleano do servidor
    // (`A_CARTEIRA_VALE_PARA_O_CONTRATO`), e ele chega à tela em `contratoExigeCad`. Enquanto ele
    // morava só no servidor, invertê-lo NÃO alcançava esta caixa: o comprador da carteira chega com
    // `credenciado: true`, logo `cadEmAndamento` é `false`, o aviso da CAD em andamento não renderiza,
    // e a caixa continuava prometendo *"A reserva pode virar proposta"* para quem receberia 409 no
    // envio para contrato — a mesma incoerência GET/POST que este arquivo existe para impedir.
    await abrirCom({ ...PELA_CARTEIRA, contratoExigeCad: true });

    expect(alvo.textContent).toContain("Comprador da carteira");
    expect(alvo.textContent).toContain("Contrato ativo neste empreendimento.");
    expect(alvo.textContent).toContain("a carteira vale para a proposta, não para o contrato");
    // ⚠️ E O BOTÃO CONTINUA ACESO: a PROPOSTA está liberada (é o pedido do Lucas de aproveitar o
    // cadastro de comprador). O que a frase avisa é a parede do CONTRATO, lá na frente.
    expect(alvo.textContent).not.toContain(RODAPE_QUE_BARRA);
    expect(botao("Montar as condições").disabled).toBe(false);
  });

  it("⚠️ a CAD DA CARTEIRA em revisão: o chip E o selo âmbar E o aviso do contrato, juntos", async () => {
    await abrirCom({
      ...EM_VALIDACAO,
      etapa: "revisao",
      motivo: "A CAD deste cliente está em revisão desde 26/09/2026.",
      origem: "comprador_da_carteira",
    });

    // 1) O fato da carteira não se perde: é ele que explica a CAD que não passou pela esteira.
    expect(alvo.textContent).toContain("Comprador da carteira");
    // 2) O selo âmbar continua dizendo a verdade sobre a CAD de agora.
    expect(alvo.textContent).toContain("CAD em andamento");
    expect(alvo.textContent).toContain("A CAD deste cliente está em revisão desde 26/09/2026.");
    // 3) E a parede do fim do caminho continua dita aqui no começo.
    expect(alvo.textContent).toContain("O contrato só sai depois que a CAD for aprovada.");
    // ⚠️ E A TELA NÃO MENTE PARA O OUTRO LADO: sem CAD aprovada, nada de "CAD credenciada", e sem
    // a caixa da carteira afirmar que a reserva pode virar proposta por contrato ativo.
    expect(alvo.textContent).not.toContain("CAD credenciada neste empreendimento");
    expect(alvo.textContent).not.toContain("Contrato ativo neste empreendimento.");
    expect(alvo.textContent).not.toContain(RODAPE_QUE_BARRA);
    expect(botao("Montar as condições").disabled).toBe(false);
  });

  it("⚠️ a CAD da carteira INDEFERIDA: o chip fica, e o botão TRAVA", async () => {
    // O caso perigoso do cruzamento, visto da tela: a pessoa tem compra antiga E foi reprovada. A
    // carteira não passa por cima do indeferimento (`cliente-credenciado.ts`), e o chip continua na
    // tela porque ele explica de onde a CAD veio — ele nunca foi um passe livre.
    await abrirCom({ ...INDEFERIDA, origem: "comprador_da_carteira" });

    expect(alvo.textContent).toContain("Comprador da carteira");
    expect(alvo.textContent).toContain("CAD não credenciada");
    expect(alvo.textContent).toContain(RODAPE_QUE_BARRA);
    expect(alvo.textContent).not.toContain("Contrato ativo neste empreendimento.");
    expect(botao("Montar as condições").disabled).toBe(true);
  });

  it("a CAD de sempre em andamento NÃO ganha o chip da carteira", async () => {
    await abrirCom({ ...EM_VALIDACAO, origem: "cad" });

    expect(alvo.textContent).toContain("CAD em andamento");
    expect(alvo.textContent).not.toContain("Comprador da carteira");
  });
});
