// @vitest-environment jsdom

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// OS TRÊS DEFEITOS DA MODAL DE PROPOSTA, TRAVADOS.
//
// ⚠️ POR QUE UM TESTE DE TELA, E NÃO DE LIB. Os três são de COMPORTAMENTO da modal, e nenhum
// aparece numa função pura: um é a árvore que troca de ramo e mata o simulador, outro é a régua que
// falta antes de a lista de compradores existir, o terceiro é um ouvinte de teclado que dispara no
// meio de um POST. Testar a lib de baixo passaria nos três com o bug em pé.
//
// ⚠️ ESTE É O PRIMEIRO TESTE DE COMPONENTE DO REPO, e por isso ele monta o React na mão. Duas
// ginásticas explicam o que parece firula:
//
//  1. `globalThis.React` — o vitest.config não tem plugin de React, então o esbuild compila o JSX
//     no formato CLÁSSICO (`React.createElement`) e nenhum arquivo do app importa `React` por nome.
//     Publicar o namespace no global é o que faz o componente real renderizar sem tocar na config
//     compartilhada (mexer nela mudaria a compilação de TODOS os testes do hub).
//  2. `IS_REACT_ACT_ENVIRONMENT` — sem ele o `act` avisa a cada render que o ambiente não o suporta.
//
// ⚠️ O SIMULADOR É DUBLÊ, DE PROPÓSITO. O de verdade tem cockpit, planos e composições próprias;
// aqui o que importa é UMA coisa: ele tem estado local, e esse estado tem que sobreviver ao
// "Voltar". O dublê é um campo de texto com `useState` — se a modal desmontar o filho, o campo
// volta vazio, que é exatamente o defeito.

(globalThis as unknown as { React: typeof React }).React = React;
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * Os dados fixos precisam existir ANTES dos imports, porque a fábrica do `vi.mock` roda na hora em
 * que o módulo mockado é importado — antes do corpo deste arquivo. Sem `vi.hoisted` a constante
 * ainda estaria na zona morta e o dublê explodiria ao montar.
 */
const fixo = vi.hoisted(() => {
  const daqui30Dias = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  return {
    condicoes: {
      anuaisQuantidade: 0,
      anuaisValor: 0,
      diaDeVencimento: 10,
      entradaValor: 20_000,
      entradaVezes: 2,
      parcela: 1_000,
      parcelasMensais: 120,
      planoNome: "PRICE 120x",
      primeiraParcelaEm: daqui30Dias,
      valorNegociado: 200_000,
    },
    daqui30Dias,
  };
});

vi.mock("./SimuladorDeProposta", async () => {
  const react = await import("react");
  return {
    SimuladorDeProposta: ({
      aoMudarCondicoes,
    }: {
      aoMudarCondicoes?: (condicoes: unknown) => void;
    }) => {
      const [rascunho, setRascunho] = react.useState("");
      react.useEffect(() => {
        aoMudarCondicoes?.(fixo.condicoes);
      }, [aoMudarCondicoes]);
      return react.createElement("input", {
        "data-teste": "rascunho-do-simulador",
        onChange: (e: { target: { value: string } }) => setRascunho(e.target.value),
        value: rascunho,
      });
    },
  };
});

// ⚠️ SÓ `montarCronograma` É DUBLÊ, E O RESTO DO MÓDULO É O DE VERDADE. Ele é o motor de
// amortização inteiro e tem os próprios testes (`cronograma.test.ts`); aqui só precisa devolver uma
// série qualquer para o botão "Gerar proposta" deixar de ser impossível. O `importOriginal` não é
// capricho: `proposta-na-tela.ts` importa `repartirEmPartesIguais` daqui, e um mock cego derruba a
// divisão de participações — que é justamente o que o portão faz ao adicionar proponente.
vi.mock("@/lib/hercules/cronograma", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  montarCronograma: () => ({
    anuais: [],
    entrada: [
      { numero: 1, total: 2, valor: 10_000, vencimento: fixo.daqui30Dias },
      { numero: 2, total: 2, valor: 10_000, vencimento: fixo.daqui30Dias },
    ],
    mensais: [{ numero: 1, total: 120, valor: 1_000, vencimento: fixo.daqui30Dias }],
    reajustes: [
      {
        ate: fixo.daqui30Dias,
        ciclo: 1,
        de: fixo.daqui30Dias,
        parcelaFinal: 120,
        parcelaInicial: 1,
        indiceCorrecao: null,
        valor: 1_000,
      },
    ],
    totais: {
      anuais: 0,
      entrada: 20_000,
      financiado: 180_000,
      geral: 200_000,
      mensais: 180_000,
    },
  }),
}));

const { ModalDeProposta } = await import("./ModalDeProposta");

/** O CPF do titular, cru como o GET entrega. Válido de verdade — `cpfValido` confere o dígito. */
const CPF_DO_TITULAR = "52998224725";
/** Outro CPF válido, o da esposa que o coordenador deveria ter digitado. */
const CPF_DA_ESPOSA = "11144477735";

const portao = {
  credenciamento: {
    credenciado: true,
    desde: "2026-01-10",
    etapa: null,
    motivo: null,
    // (26/09/2026) A PORTA VIROU CAMPO PRÓPRIO: o botão segue `podeGerarProposta`, e não
    // `credenciado` (o coordenador gera com a CAD EM ANDAMENTO). Aqui a CAD está credenciada,
    // então os dois andam juntos; o terceiro estado da tela está em
    // ModalDeProposta.cad-em-andamento.comportamento.test.tsx.
    podeGerarProposta: true,
  },
  entradaMinimaPercentual: 10,
  planos: [
    {
      entradaPercentual: 10,
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
    codigo: "RES-0001",
    corretor: { id: "c1", nome: "Corretor Teste" },
    criadoEm: "2026-09-01T12:00:00.000Z",
    id: "reserva-1",
    imobiliaria: { id: "i1", nome: "Imobiliária Teste" },
    titular: { cpf: CPF_DO_TITULAR, nome: "João da Silva", telefone: "62999990000" },
    validadeEm: null,
  },
  unidade: {
    enterpriseId: "emp-1",
    id: "unidade-1",
    nome: "Q1 L2",
    preco: 200_000,
    produto: "Garden",
  },
};

const unidade = { id: "unidade-1", nome: "Q1 L2", produto: "Garden" };

let alvo: HTMLDivElement;
let raiz: Root;

/**
 * O QUE A BUSCA DE PROPONENTE ENCONTRA — cada teste arma antes de digitar.
 *
 * ⚠️ O NOME DO SEGUNDO COMPRADOR DEIXOU DE SER DIGITADO (Lucas, 05/09/2026: *"os demais
 * proponentes têm que ser buscados; eu digitei o nome da Larissa, deveria puxar a CAD dela"*).
 * Quem entra na proposta vem da base, com a CAD conferida — por isso o CPF não é mais um campo de
 * texto e sim o que veio junto da pessoa escolhida.
 */
type EncontradoNaBusca = {
  credenciado: boolean;
  cpf: string;
  etapa: null | string;
  id: string;
  motivo: null | string;
  nome: string;
  /** Por qual porta o candidato passou (26/09/2026). Ausente = CAD. */
  origem?: null | "cad" | "comprador_da_carteira";
  /**
   * A PORTA do candidato, e é ela que a tela lê desde 26/09/2026 — não `credenciado`.
   *
   * ⚠️ OPCIONAL SÓ NO FIXTURE, e ausente significa "igual a `credenciado`": é como a rota respondia
   * antes deste lote, e deixa os testes antigos dizendo o que já diziam.
   */
  podeGerarProposta?: boolean;
};
let daBusca: EncontradoNaBusca[] = [];

/** O candidato como a rota o entrega: com a porta explícita. */
function comAPorta(c: EncontradoNaBusca) {
  return { ...c, podeGerarProposta: c.podeGerarProposta ?? c.credenciado };
}

/** Responde ao GET do portão e ao da busca; o POST cada teste arma como precisa. */
function fetchDoPortao(aoPostar?: () => Promise<{ corpo: string; ok: boolean }>) {
  return vi.fn(async (url: string, opcoes?: { method?: string }) => {
    if (opcoes?.method === "POST") {
      const r = aoPostar
        ? await aoPostar()
        : { corpo: JSON.stringify({ data: { avisos: [], codigo: "PRP-1" } }), ok: true };
      return { ok: r.ok, text: async () => r.corpo };
    }
    // ⚠️ A BUSCA LÊ POR `json()`, o portão por `text()`. Os dois vêm no mesmo dublê porque a modal
    // dispara os dois GETs na mesma sessão, e responder o portão à busca era o que fazia a lista de
    // candidatos receber um corpo de outro formato.
    if (String(url).includes("/venda/proponentes")) {
      return {
        // ⚠️ A PORTA VEM PREENCHIDA quando o fixture não a informa: a rota SEMPRE manda
        // `podeGerarProposta`, e um dublê que o omitisse faria a tela desabilitar todo mundo por
        // um defeito do fixture, não do código.
        json: async () => ({ data: { encontrados: daBusca.map(comAPorta) } }),
        ok: true,
        text: async () => JSON.stringify({ data: { encontrados: daBusca.map(comAPorta) } }),
      };
    }
    return { ok: true, text: async () => JSON.stringify({ data: portao }) };
  });
}

/** O clique como o React o recebe: evento borbulhando até a raiz, dentro de `act`. */
function clicar(elemento: Element) {
  act(() => {
    elemento.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

/**
 * Digitar num `input` controlado do React.
 *
 * ⚠️ O `value` VAI PELO SETTER NATIVO. Atribuir `input.value = "x"` direto faz o React não perceber
 * a mudança (ele guarda o último valor no nó) e o `onChange` roda com o texto velho.
 */
function digitar(input: HTMLInputElement, valor: string) {
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value",
  )?.set;
  act(() => {
    setter?.call(input, valor);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function botao(texto: string): HTMLButtonElement {
  const achado = [...alvo.querySelectorAll("button")].find(
    (b) => b.textContent?.trim() === texto,
  );
  if (!achado) throw new Error(`Botão "${texto}" não está na tela.`);
  return achado;
}

function campoDoSimulador(): HTMLInputElement | null {
  return alvo.querySelector<HTMLInputElement>('[data-teste="rascunho-do-simulador"]');
}

/** Monta a modal e espera o GET do portão pousar. */
async function abrir(aoFechar = vi.fn(), aoGerar = vi.fn()) {
  await act(async () => {
    raiz.render(<ModalDeProposta onFechar={aoFechar} onGerada={aoGerar} unidade={unidade} />);
  });
  return { aoFechar, aoGerar };
}

beforeEach(() => {
  alvo = document.createElement("div");
  document.body.appendChild(alvo);
  raiz = createRoot(alvo);
  daBusca = [];
  vi.stubGlobal("fetch", fetchDoPortao());
});

afterEach(() => {
  act(() => raiz.unmount());
  alvo.remove();
  vi.unstubAllGlobals();
});

describe("voltar ao portão", () => {
  it("guarda a montagem: o simulador não é desmontado, é escondido", async () => {
    await abrir();

    clicar(botao("Montar as condições"));
    const campo = campoDoSimulador();
    expect(campo).not.toBeNull();
    digitar(campo as HTMLInputElement, "condição montada em dez minutos");

    clicar(botao("Voltar"));

    // ⚠️ O NÓ TEM QUE SER O MESMO. Se a modal trocasse de ramo, aqui viria `null` (desmontado) ou
    // um `<input>` novo e vazio — e com ele iriam plano, valor negociado, entrada, vezes, prazo,
    // reforços, dia de vencimento e a data da primeira parcela.
    expect(campoDoSimulador()).toBe(campo);
    expect((campo as HTMLInputElement).value).toBe("condição montada em dez minutos");
    // Escondido, e não removido: o portão é quem está à vista.
    expect(alvo.textContent).toContain("O cliente da reserva");

    clicar(botao("Montar as condições"));
    expect(campoDoSimulador()).toBe(campo);
    expect((campo as HTMLInputElement).value).toBe("condição montada em dez minutos");
  });

  it("não monta o simulador antes de o portão liberar", async () => {
    await abrir();

    // Antes do primeiro "Montar as condições" ele nem existe — nada de rodar os efeitos do
    // simulador por trás de um portão que ainda pode recusar a CAD.
    expect(campoDoSimulador()).toBeNull();
  });
});

describe("adicionar proponente", () => {
  /** O campo que virou busca. O CPF ao lado é só leitura: ele vem da CAD escolhida. */
  function campoDaBusca(): HTMLInputElement {
    const campo = alvo.querySelector<HTMLInputElement>(
      'input[placeholder="Buscar por nome, CPF ou CNPJ na base"]',
    );
    if (!campo) throw new Error("O campo de busca do proponente não está na tela.");
    return campo;
  }

  /**
   * A linha da pessoa na lista de candidatos.
   *
   * ⚠️ PELO NOME EM NEGRITO, e não pelo texto do botão inteiro: a linha traz nome E CPF (e o motivo
   * de quem não passa), então comparar o `textContent` todo nunca casaria.
   */
  function candidato(nome: string): HTMLButtonElement {
    const achado = [...alvo.querySelectorAll("button")].find(
      (b) => b.querySelector("b")?.textContent?.trim() === nome,
    );
    if (!achado) throw new Error(`"${nome}" não apareceu na busca.`);
    return achado;
  }

  /**
   * Espera o debounce de 300ms e o GET pousarem.
   *
   * ⚠️ TEMPO DE VERDADE, e não relógio falso. Ligar `vi.useFakeTimers` aqui congelaria também o
   * `Date.now` de que a modal tira a validade da proposta, e o teste passaria a medir a data errada
   * — 320ms de espera real custam menos que essa confusão.
   */
  async function esperarABusca() {
    await act(async () => {
      await new Promise((pronto) => setTimeout(pronto, 320));
    });
  }

  /**
   * O caminho que o coordenador faz: digita, a base responde, ele escolhe e informa a %.
   *
   * ⚠️ A % É OBRIGATÓRIA desde 05/09/2026: ela vai escrita no contrato, e a tela parou de escolher
   * por omissão. O helper preenche um valor porque quase todo teste daqui quer o proponente NA
   * LISTA; quem testa a régua da % passa outro valor (ou vazio) de propósito.
   */
  async function escolherProponente(nome: string, cpf: string, participacao = "40") {
    daBusca = [{ credenciado: true, cpf, etapa: null, id: `cad-${cpf}`, motivo: null, nome }];
    digitar(campoDaBusca(), nome);
    await esperarABusca();
    clicar(candidato(nome));
    const pctInput = alvo.querySelector<HTMLInputElement>('input[placeholder="% no contrato"]');
    if (participacao) digitar(pctInput as HTMLInputElement, participacao);
    clicar(botao("Adicionar"));
  }

  it("recusa o CPF que já está na lista, mesmo formatado diferente", async () => {
    await abrir();

    // O cenário real: a reserva é do João, o coordenador vai adicionar a esposa e cola o CPF do
    // próprio João — formatado, porque o campo formata enquanto ele digita.
    await escolherProponente("Maria da Silva", "529.982.247-25");

    expect(alvo.textContent).toContain("Este documento já está entre os compradores.");
    // Sem a régua, a lista ficaria "João 50% / João 50%", somando 100% redondos, e o PDF sairia
    // com o mesmo comprador duas vezes.
    expect(alvo.textContent).not.toContain("Maria da Silva");
    expect(alvo.textContent).toContain("100%");
  });

  it("⚠️ candidato sem CPF utilizável nem chega a ser escolhido", async () => {
    // O campo de CPF ao lado é só leitura: escolher alguém cujo documento não veio (ou veio
    // quebrado) deixaria o proponente sem CPF e sem como digitá-lo — um beco. A rota monta o CPF a
    // partir do documento da entidade, que pode chegar vazio.
    await abrir();

    daBusca = [
      {
        credenciado: true,
        cpf: "111.111.111-11",
        etapa: null,
        id: "cad-3",
        motivo: null,
        nome: "Maria da Silva",
      },
    ];
    digitar(campoDaBusca(), "Maria da Silva");
    await esperarABusca();

    expect(candidato("Maria da Silva").disabled).toBe(true);
    expect(alvo.textContent).toContain("sem documento no cadastro");
  });

  it("⚠️ candidato PJ credenciado fica CLICÁVEL, com o CNPJ", async () => {
    // Lucas (26/09/2026): *"temos que habilitar pessoa fisica e pessoa juridica, hoje só atende
    // pessoa fisica"*.
    //
    // ⚠️ ERA ESTA A QUEIXA. A régua do `disabled` era `cpfValido`, então a empresa credenciada
    // aparecia CINZA com a frase "sem CPF no cadastro" — que MENTIA: ela tem CNPJ, e o coordenador
    // concluía que a CAD não existe. É o caso simétrico do teste acima, com o documento trocado.
    await abrir();

    daBusca = [
      {
        credenciado: true,
        cpf: "12.345.678/0001-95",
        etapa: "credenciado",
        id: "cad-pj",
        motivo: null,
        nome: "ACME Construtora",
      },
    ];
    digitar(campoDaBusca(), "ACME");
    await esperarABusca();

    expect(candidato("ACME Construtora").disabled).toBe(false);
    expect(alvo.textContent).not.toContain("sem documento no cadastro");
    expect(alvo.textContent).not.toContain("sem CPF no cadastro");
  });

  it("aceita o proponente novo com CPF válido, e o titular fica com o que sobra", async () => {
    await abrir();

    // 40% para a esposa: o titular vai a 60%, e a soma fecha sem pedir dois números.
    await escolherProponente("Maria de Souza", CPF_DA_ESPOSA, "40");

    expect(alvo.textContent).toContain("Maria de Souza");
    expect(alvo.textContent).toContain("Soma 100%");
  });

  it("⚠️ sem a %, não adiciona — ela vai escrita no contrato", async () => {
    // Lucas (05/09/2026): *"% não é opcional, ela é uma informação que vai estar no contrato"*.
    // Antes, em branco, a tela dividia igualmente por conta própria — decidindo a partilha por
    // omissão, num número que vai para a minuta e para o cartório.
    await abrir();

    await escolherProponente("Maria de Souza", CPF_DA_ESPOSA, "");

    expect(alvo.textContent).toContain("Informe a % de participação");
    expect(alvo.textContent).not.toContain("Maria de Souza");
  });

  it("recusa participação de 100% para o proponente: sobraria zero para o titular", async () => {
    await abrir();

    await escolherProponente("Maria de Souza", CPF_DA_ESPOSA, "100");

    expect(alvo.textContent).toContain("menor que 100%");
  });

  it("⚠️ o segundo proponente não pode zerar o titular em silêncio", async () => {
    // Com um proponente de 70% na lista, digitar 50% para o próximo levava o titular a −20%, e a
    // tela grampeava em zero sem dizer nada: a soma ia a 120% num número que vai escrito na minuta.
    await abrir();

    await escolherProponente("Maria de Souza", CPF_DA_ESPOSA, "70");
    expect(alvo.textContent).toContain("Maria de Souza");

    await escolherProponente("Carlos Souza", "12345678909", "50");

    expect(alvo.textContent).toContain("já somam 70%");
    expect(alvo.textContent).not.toContain("Carlos Souza");
  });

  it("⚠️ o CPF não se digita: ele vem da CAD escolhida", async () => {
    // Um campo livre aqui seria a porta que a busca acabou de fechar — bastaria digitar onze
    // dígitos para pôr no contrato alguém que o Apolo nunca viu.
    await abrir();

    const cpf = alvo.querySelector<HTMLInputElement>('input[placeholder="CPF ou CNPJ (vem da CAD)"]');
    expect(cpf?.disabled).toBe(true);
  });

  it("sem CAD no empreendimento, diz o que fazer em vez de 'nada encontrado'", async () => {
    // Lucas (05/09/2026): *"se não estiver credenciada, fala que CAD não encontrada"*. A frase
    // precisa dizer o passo seguinte: "nada encontrado" deixa o coordenador sem saber se digitou
    // errado ou se falta a CAD, e a resposta muda o que ele faz agora.
    await abrir();

    daBusca = [];
    digitar(campoDaBusca(), "Larissa");
    await esperarABusca();

    expect(alvo.textContent).toContain("CAD não encontrada neste empreendimento");
  });

  it("⚠️ quem não está credenciado aparece com o motivo, e não pode ser escolhido", async () => {
    // Sumir da lista faria o coordenador concluir que a pessoa não tem cadastro, quando ela tem e
    // está em análise de crédito — e ele abriria uma CAD duplicada por cima da que já existe.
    await abrir();

    daBusca = [
      {
        credenciado: false,
        cpf: CPF_DA_ESPOSA,
        etapa: "analise_credito",
        id: "cad-2",
        motivo: "CAD em análise de crédito",
        nome: "Larissa Andrade",
      },
    ];
    digitar(campoDaBusca(), "Larissa");
    await esperarABusca();

    expect(alvo.textContent).toContain("CAD em análise de crédito");
    expect(candidato("Larissa Andrade").disabled).toBe(true);
  });

  // ⚠️ O CO-PROPONENTE EM CAD EM ANDAMENTO PODE SER ESCOLHIDO — E A LINHA DIZ A ETAPA.
  //
  // Lucas (26/09/2026): *"pode deixar os coordenadores emitirem proposta sem a cad esta credenciada.
  // ela pode estar em validacao ou em qualquer outro estagio"*. Enquanto o `disabled` desta linha
  // lia `c.credenciado`, o coordenador passava o titular e travava na esposa: casal comprando junto
  // chega com as DUAS CADs em andamento no mesmo dia, e sobravam esperar a CAD ou gravar 100% no
  // titular, que muda quem assina o contrato.
  //
  // ⚠️ MEDIDO EM PRODUÇÃO (`bxgukywoxgivlrhjkwjx`, só SELECT, 26/09/2026):
  //   select count(*) as propostas,
  //          count(*) filter (where jsonb_array_length(compradores) > 1) as com_dois
  //     from hercules_propostas where compradores is not null;
  //     → 97 de 4.946 propostas têm dois ou mais compradores.
  it("⚠️ a CAD EM ANDAMENTO do cônjuge é escolhível, e a linha continua dizendo a etapa", async () => {
    await abrir();

    daBusca = [
      {
        // A verdade sobre a CAD não muda de lado: é ela que faz a frase aparecer ao lado do nome.
        credenciado: false,
        cpf: CPF_DA_ESPOSA,
        etapa: "validacao",
        id: "cad-3",
        motivo: "A CAD deste cliente está em validação de cadastro desde 26/09/2026.",
        nome: "Zilda Andrade",
        podeGerarProposta: true,
      },
    ];
    digitar(campoDaBusca(), "Zilda");
    await esperarABusca();

    // A porta abre...
    expect(candidato("Zilda Andrade").disabled).toBe(false);
    // ...e a tela NÃO MENTE POR OMISSÃO: o coordenador lê em que etapa a CAD do cônjuge está.
    expect(alvo.textContent).toContain(
      "A CAD deste cliente está em validação de cadastro desde 26/09/2026.",
    );
  });

  it("⚠️ a CAD INDEFERIDA do cônjuge continua sem poder ser escolhida", async () => {
    // Segunda decisão do Lucas em 26/09/2026: `indeferido` é uma decisão já tomada de reprovar, e
    // gerar proposta em cima dela é vender para quem a coordenação recusou.
    await abrir();

    daBusca = [
      {
        credenciado: false,
        cpf: CPF_DA_ESPOSA,
        etapa: "indeferido",
        id: "cad-4",
        motivo: "A CAD deste cliente está com o cadastro indeferido desde 26/09/2026.",
        nome: "Zeca Andrade",
        podeGerarProposta: false,
      },
    ];
    digitar(campoDaBusca(), "Zeca");
    await esperarABusca();

    expect(candidato("Zeca Andrade").disabled).toBe(true);
    expect(alvo.textContent).toContain("com o cadastro indeferido");
  });

  it("⚠️ resposta fora do formato não derruba a modal: a lista fica vazia", async () => {
    // Um 200 com outro corpo (proxy, rota que mudou de contrato) guardava `undefined` na lista, e o
    // render seguinte quebrava a modal inteira — levando junto as condições já montadas.
    await abrir();

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        String(url).includes("/venda/proponentes")
          ? { json: async () => ({ data: { outraCoisa: true } }), ok: true }
          : { ok: true, text: async () => JSON.stringify({ data: portao }) },
      ),
    );
    digitar(campoDaBusca(), "Larissa");
    await esperarABusca();

    // ⚠️ E A FRASE É A DA FALHA, não a da ausência: "abra a CAD" num servidor fora do ar manda o
    // corretor abrir uma CAD duplicada para quem já tem a dele credenciada.
    expect(alvo.textContent).toContain("Não foi possível consultar a base agora");
    expect(alvo.textContent).not.toContain("CAD não encontrada neste empreendimento");
    // A modal continua de pé: o portão segue à vista.
    expect(alvo.textContent).toContain("O cliente da reserva");
  });
});

describe("enquanto a proposta está sendo enviada", () => {
  it("o Escape não fecha a modal", async () => {
    let soltarOPost: (() => void) | null = null;
    const post = new Promise<{ corpo: string; ok: boolean }>((resolva) => {
      soltarOPost = () =>
        resolva({
          corpo: JSON.stringify({
            data: { avisos: [{ ok: true, para: "coordenador" }], codigo: "PRP-77" },
          }),
          ok: true,
        });
    });
    vi.stubGlobal("fetch", fetchDoPortao(() => post));

    const { aoFechar, aoGerar } = await abrir();
    clicar(botao("Montar as condições"));
    clicar(botao("Gerar proposta"));

    // O POST está no ar: a tela avisa, e o Esc não vale.
    expect(alvo.textContent).toContain("Não feche esta janela");
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Escape" }));
    });
    // ⚠️ FECHAR AQUI ERA O ESTRAGO: o POST não é cancelado, a proposta grava, a reserva vira
    // proposta e os três WhatsApps saem — mas `onGerada` nunca roda, ninguém avisa o coordenador,
    // e ele clica de novo.
    expect(aoFechar).not.toHaveBeenCalled();
    expect(botao("Fechar").disabled).toBe(true);

    await act(async () => {
      soltarOPost?.();
      await post;
    });

    expect(aoGerar).toHaveBeenCalledTimes(1);
    expect(aoGerar.mock.calls[0]?.[0]).toContain("PRP-77");

    // Terminado o envio, a tecla volta a valer.
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Escape" }));
    });
    expect(aoFechar).toHaveBeenCalledTimes(1);
  });
});

// ── O COMPRADOR DA CARTEIRA (26/09/2026) ─────────────────────────────────────
//
// Quem passa pela porta da carteira (contrato ativo no empreendimento, sem CAD) aparece com o selo
// grafite "Comprador da carteira", e não com o verde "CAD credenciada": passa, mas por outra porta,
// e o coordenador precisa ver a diferença sem ler a frase.
describe("o comprador da carteira", () => {
  function comOrigem(origem: null | string, contratoAtivo = origem === "comprador_da_carteira") {
    (portao as { credenciamento: Record<string, unknown> }).credenciamento = {
      contratoAtivo,
      credenciado: true,
      desde: null,
      etapa: null,
      motivo: null,
      origem,
      // ⚠️ A PORTA TAMBÉM (junção de 26/09/2026). Quem entra pela carteira volta com
      // `credenciado: true`, e a tela lê o BOTÃO em `podeGerarProposta`: sem este campo o rodapé
      // escrevia "Sem a CAD credenciada neste empreendimento a proposta não pode ser gerada" embaixo
      // de um selo que diz "Comprador da carteira".
      podeGerarProposta: true,
    };
  }

  afterEach(() => {
    (portao as { credenciamento: Record<string, unknown> }).credenciamento = {
      credenciado: true,
      desde: "2026-01-10",
      etapa: null,
      motivo: null,
      podeGerarProposta: true,
    };
  });

  it("o selo diz 'Comprador da carteira' no lugar de 'CAD credenciada', e o portão abre", async () => {
    comOrigem("comprador_da_carteira");
    await abrir();

    expect(alvo.textContent).toContain("Comprador da carteira");
    expect(alvo.textContent).toContain("Contrato ativo neste empreendimento");
    expect(alvo.textContent).not.toContain("CAD credenciada neste empreendimento");
    expect(alvo.querySelector('[aria-label="Comprador da carteira"] svg')).not.toBeNull();
    expect(botao("Montar as condições").disabled).toBe(false);
  });

  it("⚠️ pela CAD que a carteira JÁ abriu, o selo não afirma contrato ativo: fala da CAD", async () => {
    // A CAD da carteira continua credenciada mesmo depois de um distrato; afirmar "contrato ativo"
    // aí seria mentir. O servidor diz qual das duas portas foi (`contratoAtivo`).
    comOrigem("comprador_da_carteira", false);
    await abrir();

    expect(alvo.textContent).toContain("Comprador da carteira");
    expect(alvo.textContent).toContain("CAD aberta como comprador da carteira");
    expect(alvo.textContent).not.toContain("Contrato ativo neste empreendimento");
    expect(botao("Montar as condições").disabled).toBe(false);
  });

  it("CAD de sempre continua com o selo de sempre", async () => {
    comOrigem("cad");
    await abrir();

    expect(alvo.textContent).toContain("CAD credenciada neste empreendimento");
    expect(alvo.textContent).not.toContain("Comprador da carteira");
  });

  it("a busca vazia por nome ensina que o comprador da carteira se acha pelo documento inteiro", async () => {
    // (26/09/2026, junção com a v1.384.0) A porta da carteira vale para CPF e CNPJ, e a dica diz os
    // dois: dizer só "CPF" mandaria o coordenador procurar a empresa pelo CPF do sócio.
    await abrir();
    daBusca = [];
    const campo = alvo.querySelector<HTMLInputElement>('input[placeholder="Buscar por nome, CPF ou CNPJ na base"]');
    digitar(campo as HTMLInputElement, "Bia");
    await act(async () => {
      await new Promise((pronto) => setTimeout(pronto, 320));
    });
    expect(alvo.textContent).toContain("digite o CPF ou o CNPJ inteiro");

    digitar(campo as HTMLInputElement, "529.982.247-25");
    await act(async () => {
      await new Promise((pronto) => setTimeout(pronto, 320));
    });
    expect(alvo.textContent).toContain("CAD não encontrada neste empreendimento");
    expect(alvo.textContent).not.toContain("digite o CPF ou o CNPJ inteiro");

    // O CNPJ inteiro também é o termo que a rota responde com a carteira: a dica some igual.
    digitar(campo as HTMLInputElement, "12.345.678/0001-95");
    await act(async () => {
      await new Promise((pronto) => setTimeout(pronto, 320));
    });
    expect(alvo.textContent).toContain("CAD não encontrada neste empreendimento");
    expect(alvo.textContent).not.toContain("digite o CPF ou o CNPJ inteiro");
  });

  // ⚠️ O CHIP DO CANDIDATO CONVIVE COM A FRASE DA ETAPA (junção de 26/09/2026). A linha da lista
  // mostrava o chip só para quem estava `credenciado`; se a CAD que nasceu da carteira for mexida no
  // Board e cair em `revisao`, o chip era o único lugar que explicava por que aquela pessoa tem CAD
  // sem ter passado pela esteira, e ele desaparecia justo aí.
  it("⚠️ na lista de candidatos, o chip da carteira e a frase da etapa aparecem juntos", async () => {
    await abrir();
    daBusca = [
      {
        credenciado: false,
        cpf: "111.444.777-35",
        etapa: "revisao",
        id: "cad-bia",
        motivo: "A CAD deste cliente está em revisão desde 26/09/2026.",
        nome: "Bia da Carteira",
        origem: "comprador_da_carteira",
        podeGerarProposta: true,
      },
    ];
    const campo = alvo.querySelector<HTMLInputElement>('input[placeholder="Buscar por nome, CPF ou CNPJ na base"]');
    digitar(campo as HTMLInputElement, "111.444.777-35");
    await act(async () => {
      await new Promise((pronto) => setTimeout(pronto, 320));
    });

    const linha = [...alvo.querySelectorAll("button")].find(
      (b) => b.querySelector("b")?.textContent?.trim() === "Bia da Carteira",
    );
    expect(linha).toBeDefined();
    expect(linha?.textContent).toContain("Comprador da carteira");
    expect(linha?.textContent).toContain("em revisão desde 26/09/2026");
    // ⚠️ E ELA CONTINUA ESCOLHÍVEL: a porta é `podeGerarProposta`, não `credenciado`.
    expect(linha?.disabled).toBe(false);
  });

  it("⚠️ a CAD do CO-comprador da carteira que não nasceu também vira recado", async () => {
    vi.stubGlobal(
      "fetch",
      fetchDoPortao(async () => ({
        corpo: JSON.stringify({
          data: {
            avisos: [{ ok: true, para: "coordenador" }],
            cadsDosCoCompradores: [{ estado: "erro" }],
            codigo: "PRP-10",
          },
        }),
        ok: true,
      })),
    );

    const { aoGerar } = await abrir();
    clicar(botao("Montar as condições"));
    await act(async () => {
      clicar(botao("Gerar proposta"));
      await new Promise((pronto) => setTimeout(pronto, 0));
    });

    const recado = String(aoGerar.mock.calls[0]?.[0]);
    expect(recado).toContain("A CAD de comprador da carteira não foi registrada");
  });

  it("na busca de proponentes, o comprador da carteira vem com o selo e pode ser escolhido", async () => {
    await abrir();
    daBusca = [
      {
        credenciado: true,
        cpf: CPF_DA_ESPOSA,
        etapa: null,
        id: "ent-bia",
        motivo: null,
        nome: "Bia da Carteira",
        origem: "comprador_da_carteira",
      } as EncontradoNaBusca,
    ];
    const campo = alvo.querySelector<HTMLInputElement>('input[placeholder="Buscar por nome, CPF ou CNPJ na base"]');
    // Pelo CPF inteiro: é o único termo que a rota responde com o comprador da carteira.
    digitar(campo as HTMLInputElement, CPF_DA_ESPOSA);
    await act(async () => {
      await new Promise((pronto) => setTimeout(pronto, 320));
    });

    const linha = [...alvo.querySelectorAll("button")].find(
      (b) => b.querySelector("b")?.textContent?.trim() === "Bia da Carteira",
    );
    expect(linha?.disabled).toBe(false);
    expect(linha?.querySelector('[aria-label="Comprador da carteira"]')).not.toBeNull();
  });

  it("⚠️ a proposta saiu mas a CAD da carteira não: o recado diz, para alguém abrir à mão", async () => {
    comOrigem("comprador_da_carteira");
    vi.stubGlobal(
      "fetch",
      fetchDoPortao(async () => ({
        corpo: JSON.stringify({
          data: { avisos: [{ ok: true, para: "coordenador" }], cadDoComprador: { estado: "erro" }, codigo: "PRP-9" },
        }),
        ok: true,
      })),
    );

    const { aoGerar } = await abrir();
    clicar(botao("Montar as condições"));
    await act(async () => {
      clicar(botao("Gerar proposta"));
      await new Promise((pronto) => setTimeout(pronto, 0));
    });

    expect(aoGerar).toHaveBeenCalledTimes(1);
    const recado = String(aoGerar.mock.calls[0]?.[0]);
    expect(recado).toContain("PRP-9");
    expect(recado).toContain("A CAD de comprador da carteira não foi registrada");
    expect(recado).not.toMatch(/[—–]/);
  });
});
