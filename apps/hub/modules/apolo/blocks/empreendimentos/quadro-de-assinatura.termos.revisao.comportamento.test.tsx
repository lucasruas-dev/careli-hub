// @vitest-environment jsdom

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SupabaseClient } from "@supabase/supabase-js";

import { assinanteDeTermosDaVendedora, assinantesDoQuadro } from "@/lib/assinatura/quadro-db";
import { signatariosDoAcordo } from "@/lib/hades/acordo/signatarios-do-acordo";

// REVISÃO DA TELA DO CAMPO NOVO: quem assina os TERMOS pela vendedora.
//
// Lucas (20/09/2026): *"essa tela determina os assinantes (...) nessa tela vc pode abrir mais um
// campo para assinatura de termos vendedora, ae eu posso apontar quem vai assinar os termos, não
// precisa necessariamente ser os representantes legais, pode ser o juridico, analista, enfim"*.
//
// ⚠️ ESTE ARQUIVO NASCEU DE REVISÃO, e os testes que tinham DEFEITO no nome mediam a distância
// entre o que a TELA prometia ao operador e o que o ENVIO fazia de verdade. Os cinco foram
// corrigidos em 20/09/2026 e continuam aqui, verdes, com o nome do comportamento certo: são eles
// que impedem as duas leituras de voltarem a divergir.
//
// Mesma montagem manual dos outros testes de componente da casa
// (ContratosDaCecilio.comportamento, EdicaoDaUnidade.comportamento).

(globalThis as unknown as { React: typeof React }).React = React;
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const simulado = vi.hoisted(() => ({
  getApoloAccessToken: vi.fn<() => Promise<null | string>>(),
}));

vi.mock("@/lib/supabase/client", () => ({
  getHubSupabaseClient: () => null,
  hubSupabaseConfig: { anonKey: "chave-publica", url: "https://projeto.supabase.co" },
}));

vi.mock("@/modules/apolo/data/apolo-operations", () => ({
  getApoloAccessToken: () => simulado.getApoloAccessToken(),
}));

const { QuadroDeAssinaturaCard } = await import(
  "@/modules/apolo/blocks/empreendimentos/quadro-de-assinatura-card"
);

type Chamada = { corpo: null | unknown; method: string; url: string };

type LinhaDaTela = {
  cpf: null | string;
  email: null | string;
  id: null | string;
  nome: string;
  ordemAssinatura: null | number;
  origem: null | string;
  papel: string;
  posicao: number;
};

const EMPREENDIMENTO = "4";

/** O que o GET do quadro devolve nesta rodada. */
let assinantes: LinhaDaTela[] = [];
/** A frase com que o servidor recusa a gravação nesta rodada. `null` = grava. */
let recusa: null | string = null;
let chamadas: Chamada[];
let raiz: Root;
let hospedeiro: HTMLDivElement;

const APONTADO_1: LinhaDaTela = {
  cpf: "111.222.333-44",
  email: "primeiro.apontado@incorporadora.test",
  id: "aaaaaaaa-0000-4000-8000-000000000001",
  nome: "Primeiro Apontado",
  ordemAssinatura: null,
  origem: null,
  papel: "termos_vendedora",
  posicao: 1,
};

const APONTADO_2: LinhaDaTela = {
  cpf: null,
  email: "segundo.apontado@incorporadora.test",
  id: "aaaaaaaa-0000-4000-8000-000000000002",
  nome: "Segundo Apontado",
  ordemAssinatura: null,
  origem: null,
  papel: "termos_vendedora",
  posicao: 2,
};

/** A pessoa que alguém digitou no bloco Vendedora — a que assina a COMPRA E VENDA. */
const VENDEDORA_DIGITADA: LinhaDaTela = {
  cpf: "555.666.777-88",
  email: "socio@incorporadora.test",
  id: "bbbbbbbb-0000-4000-8000-000000000001",
  nome: "Socio Administrador",
  ordemAssinatura: null,
  origem: null,
  papel: "vendedora",
  posicao: 1,
};


function instalarFetch() {
  chamadas = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init?: RequestInit) => {
      chamadas.push({
        corpo: init?.body ? JSON.parse(String(init.body)) : null,
        method: init?.method ?? "GET",
        url,
      });
      const leitura = init?.method === "GET" || !init?.method;
      if (!leitura && recusa) {
        return Promise.resolve(
          new Response(JSON.stringify({ error: recusa }), {
            headers: { "content-type": "application/json" },
            status: 400,
          }),
        );
      }
      return Promise.resolve(
        new Response(JSON.stringify(leitura ? { assinantes } : { ok: true }), {
          headers: { "content-type": "application/json" },
          status: 200,
        }),
      );
    }),
  );
}

async function esperarPromessas() {
  await act(async () => {
    for (let i = 0; i < 10; i += 1) await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function montar(elemento: React.ReactElement) {
  act(() => {
    raiz.render(elemento);
  });
  await esperarPromessas();
}

async function clicar(botao: HTMLButtonElement | undefined) {
  expect(botao).toBeTruthy();
  await act(async () => {
    botao?.click();
  });
  await esperarPromessas();
}

/** Digita como o operador digita: o setter nativo mais o evento que o React escuta. */
async function digitar(campo: HTMLInputElement | undefined, valor: string) {
  expect(campo).toBeTruthy();
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(campo, valor);
    campo?.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

/** A seção do quadro cujo título é este. Cada papel é uma `<section>`. */
function secao(titulo: string): HTMLElement {
  const achada = Array.from(hospedeiro.querySelectorAll("section")).find(
    (s) => s.querySelector("p")?.textContent?.trim() === titulo,
  );
  expect(achada, `seção "${titulo}" não está na tela`).toBeTruthy();
  return achada as HTMLElement;
}

const TERMOS = "Assinatura de termos (vendedora)";

/** O campo daquele rótulo, dentro daquela seção. */
function campo(dentro: HTMLElement, rotulo: string): HTMLInputElement | undefined {
  return Array.from(dentro.querySelectorAll("label")).find(
    (l) => l.querySelector("span")?.textContent?.trim() === rotulo,
  )?.querySelector("input") as HTMLInputElement | undefined;
}

function botaoDentro(dentro: HTMLElement, rotulo: string): HTMLButtonElement | undefined {
  return Array.from(dentro.querySelectorAll<HTMLButtonElement>("button")).find(
    (b) => b.textContent?.trim() === rotulo,
  );
}

/** Quantas vezes esta etiqueta aparece dentro da seção. */
function etiquetas(dentro: HTMLElement, texto: string): number {
  return Array.from(dentro.querySelectorAll("span")).filter(
    (s) => s.textContent?.trim() === texto,
  ).length;
}

beforeEach(() => {
  assinantes = [];
  recusa = null;
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
  simulado.getApoloAccessToken.mockReset();
  simulado.getApoloAccessToken.mockResolvedValue("token-do-hub");
  instalarFetch();
});

afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
  vi.unstubAllGlobals();
});

describe("a caixa dos termos: onde ela aparece e o que ela diz", () => {
  it("sem a propriedade (tela de minutas do portal) ela não existe", async () => {
    await montar(<QuadroDeAssinaturaCard enterpriseId={EMPREENDIMENTO} />);

    expect(hospedeiro.textContent).not.toContain("Termos da carteira");
    expect(hospedeiro.textContent).not.toContain(TERMOS);
    // Os três papéis do contrato seguem lá.
    expect(hospedeiro.textContent).toContain("Vendedora");
    expect(hospedeiro.textContent).toContain("Testemunhas");
  });

  it("na tela do empreendimento ela aparece e separa termo de contrato, em português", async () => {
    await montar(<QuadroDeAssinaturaCard comAssinantesDeTermos enterpriseId={EMPREENDIMENTO} />);

    const texto = hospedeiro.textContent ?? "";
    expect(texto).toContain("Termos da carteira");
    expect(texto).toContain(TERMOS);
    expect(texto).toContain("Não entra no contrato de venda");
    expect(texto).toContain("Não precisa ser o representante legal");
    // Sem travessão no texto visível da caixa nova.
    expect(secao(TERMOS).textContent ?? "").not.toContain("—");
  });

  it("a caixa dos termos não oferece Linha nem Assina em", async () => {
    await montar(<QuadroDeAssinaturaCard comAssinantesDeTermos enterpriseId={EMPREENDIMENTO} />);

    const termos = secao(TERMOS);
    expect(campo(termos, "Nome completo")).toBeTruthy();
    expect(campo(termos, "CPF")).toBeTruthy();
    expect(campo(termos, "E-mail")).toBeTruthy();
    expect(campo(termos, "Linha")).toBeUndefined();
    expect(campo(termos, "Assina em")).toBeUndefined();

    // E o bloco do contrato continua com os dois.
    expect(campo(secao("Vendedora"), "Linha")).toBeTruthy();
  });
});

describe("salvar, apagar e trocar a pessoa", () => {
  it("incluir manda o papel novo e numera a linha sozinho", async () => {
    await montar(<QuadroDeAssinaturaCard comAssinantesDeTermos enterpriseId={EMPREENDIMENTO} />);
    const termos = secao(TERMOS);

    await digitar(campo(termos, "Nome completo"), "Analista Do Juridico");
    await digitar(campo(termos, "E-mail"), "juridico@incorporadora.test");
    await clicar(botaoDentro(termos, "Incluir"));

    const gravacao = chamadas.find((c) => c.method === "POST");
    expect(gravacao?.url).toBe("/api/temis/assinantes");
    expect(gravacao?.corpo).toEqual({
      cpf: "",
      email: "juridico@incorporadora.test",
      enterpriseId: EMPREENDIMENTO,
      nome: "Analista Do Juridico",
      ordemAssinatura: "",
      papel: "termos_vendedora",
      posicao: "1",
    });
  });

  it("apagar chama a rota com o id daquela linha", async () => {
    assinantes = [APONTADO_1];
    await montar(<QuadroDeAssinaturaCard comAssinantesDeTermos enterpriseId={EMPREENDIMENTO} />);

    const remover = Array.from(
      secao(TERMOS).querySelectorAll<HTMLButtonElement>("button"),
    ).find((b) => b.getAttribute("aria-label") === "Remover Primeiro Apontado");
    await clicar(remover);

    expect(chamadas.find((c) => c.method === "DELETE")?.url).toBe(
      `/api/temis/assinantes?id=${APONTADO_1.id}`,
    );
  });

  // ⚠️ ESTE TESTE SE CHAMAVA "a linha herdada do cadastro não oferece lixeira" e travava o cadeado
  // "do cadastro" na linha do representante legal. A linha herdada deixou de existir em 25/09/2026
  // (Lucas: *"todas assinaturas eu tenho que conseguir excluir e editar, esse cadeado esta
  // errado"*). O que continua sem lápis e sem lixeira NA CAIXA DOS TERMOS é a linha EMPRESTADA do
  // bloco Vendedora: ela é gravada, se edita e se exclui lá em cima, e mexer nela por aqui mudaria
  // quem assina a compra e venda a partir de uma caixa que diz não entrar no contrato.
  it("a linha emprestada do bloco Vendedora aparece sem cadeado e diz onde editar", async () => {
    assinantes = [VENDEDORA_DIGITADA];
    await montar(<QuadroDeAssinaturaCard comAssinantesDeTermos enterpriseId={EMPREENDIMENTO} />);

    const termos = secao(TERMOS);
    expect(etiquetas(termos, "edite no bloco Vendedora")).toBe(1);
    expect(etiquetas(termos, "do cadastro")).toBe(0);
    expect(termos.querySelector("svg.lucide-lock")).toBeNull();
    const rotulos = Array.from(termos.querySelectorAll("button")).map(
      (b) => b.getAttribute("aria-label") ?? "",
    );
    expect(rotulos.some((r) => r.startsWith("Remover") || r.startsWith("Editar"))).toBe(false);

    // E no bloco Vendedora a mesma pessoa tem lápis e lixeira.
    const vendedora = secao("Vendedora");
    const rotulosDaVendedora = Array.from(vendedora.querySelectorAll("button")).map(
      (b) => b.getAttribute("aria-label") ?? "",
    );
    expect(rotulosDaVendedora).toContain("Editar Socio Administrador");
    expect(rotulosDaVendedora).toContain("Remover Socio Administrador");
  });

  // ⚠️ SÓ A PRIMEIRA ASSINA, E A TELA DIZ ISSO (corrigido em 20/09/2026). Quem quer TROCAR a pessoa
  // inclui a nova e não apaga a antiga, porque a caixa não tem campo Linha; com a mesma etiqueta nas
  // duas, nada dizia que o termo continuava indo para a primeira.
  it("com dois apontados, só a primeira leva a etiqueta de quem assina", async () => {
    assinantes = [APONTADO_1, APONTADO_2];
    await montar(<QuadroDeAssinaturaCard comAssinantesDeTermos enterpriseId={EMPREENDIMENTO} />);

    const termos = secao(TERMOS);
    expect(termos.textContent).toContain("Primeiro Apontado");
    expect(termos.textContent).toContain("Segundo Apontado");

    // Quem assina de verdade: o envio leva UM, o de menor posição (`.order().limit(1)`).
    const quemAssina = await assinanteDeTermosDaVendedora(
      bancoDoQuadro([
        linhaDoBanco(APONTADO_1),
        linhaDoBanco(APONTADO_2),
      ]),
      EMPREENDIMENTO,
    );
    expect(quemAssina?.nome).toBe("Primeiro Apontado");

    // O operador que quis TROCAR a pessoa incluiu a segunda e não apagou a primeira. A etiqueta de
    // quem assina fica só na de menor posição; a outra diz que não assina.
    expect(etiquetas(termos, "assina os termos")).toBe(1);
    expect(etiquetas(termos, "não assina, remova ou reordene")).toBe(1);
  });
});

describe("o que a caixa promete quando ninguém foi apontado", () => {
  // ⚠️ A CAIXA CONTA A QUEDA INTEIRA (corrigido em 20/09/2026). Ela dizia que o termo tenta o
  // representante legal e, sem ele, o envio fica bloqueado — e as duas coisas viram mentira no
  // instante em que alguém preenche o bloco Vendedora.
  it("com vendedora digitada, a caixa mostra quem assina e não promete bloqueio", async () => {
    // O caso comum: a Careli cadastrou quem assina o CONTRATO (bloco Vendedora) e ainda não apontou
    // ninguém para os termos. Medição de 20/09/2026: das 35 configurações com vendedora, ZERO têm
    // representante legal na PJ, então é a linha digitada que sustenta o envio.
    assinantes = [VENDEDORA_DIGITADA];
    await montar(<QuadroDeAssinaturaCard comAssinantesDeTermos enterpriseId={EMPREENDIMENTO} />);

    const termos = secao(TERMOS);
    expect(termos.textContent).toContain("Ninguém apontado.");

    // O envio, no mesmo cenário, NÃO fica bloqueado: `envio-db.ts` do acordo faz
    // `apontado ?? doQuadro.find((p) => p.papel === "vendedora")`, e essa pessoa existe.
    const doQuadro = await assinantesDoQuadro(
      bancoDoQuadro([linhaDoBanco(VENDEDORA_DIGITADA)]),
      { enterpriseId: EMPREENDIMENTO },
    );
    expect(doQuadro.find((p) => p.papel === "vendedora")?.nome).toBe("Socio Administrador");

    // E a caixa nomeia a pessoa e de onde ela veio, em vez de prometer bloqueio.
    expect(termos.textContent).toContain("Socio Administrador");
    expect(termos.textContent).toContain("cadastrada como vendedora no quadro");
    expect(termos.textContent).not.toContain("o envio fica bloqueado");
  });

  // ⚠️ ATÉ 25/09/2026 ESTE TESTE TINHA UM REPRESENTANTE HERDADO NA LISTA (linha sem id, mandada
  // pelo servidor), e provava que a caixa o descartava quando havia vendedora digitada. A herança
  // saiu das duas pontas: o servidor não manda mais essa linha e o envio não a leva. O que continua
  // valendo é a caixa mostrar quem o envio leva, dizendo de onde a pessoa veio.
  it("com vendedora digitada, a caixa mostra ela e diz onde editar", async () => {
    assinantes = [VENDEDORA_DIGITADA];
    await montar(<QuadroDeAssinaturaCard comAssinantesDeTermos enterpriseId={EMPREENDIMENTO} />);

    const termos = secao(TERMOS);
    expect(etiquetas(termos, "assina os termos")).toBe(1);

    // Quem o envio leva é a VENDEDORA digitada, e só ela: o quadro não lê mais a ficha da PJ.
    const doQuadro = await assinantesDoQuadro(
      bancoDoQuadro([linhaDoBanco(VENDEDORA_DIGITADA)]),
      { enterpriseId: EMPREENDIMENTO },
    );
    expect(doQuadro.map((p) => [p.papel, p.nome])).toEqual([["vendedora", "Socio Administrador"]]);

    // E é esse o nome que a caixa mostra, dizendo onde ele se edita.
    expect(termos.textContent).toContain("Socio Administrador");
    expect(termos.textContent).toContain("edite no bloco Vendedora");
    expect(termos.textContent).not.toContain("representante legal cadastrado");
  });

  it("sem ninguém em lugar nenhum, a caixa diz que o envio fica bloqueado, sem citar a ficha", async () => {
    await montar(<QuadroDeAssinaturaCard comAssinantesDeTermos enterpriseId={EMPREENDIMENTO} />);

    const termos = secao(TERMOS);
    expect(termos.textContent).toContain("o envio fica bloqueado");
    expect(termos.textContent).not.toContain("representante legal da empresa");
    expect(termos.textContent ?? "").not.toContain("—");
  });
});

describe("sem e-mail e sem CPF", () => {
  it("sem CPF a tela grava assim mesmo (o envelope sai com has_documentation falso)", async () => {
    await montar(<QuadroDeAssinaturaCard comAssinantesDeTermos enterpriseId={EMPREENDIMENTO} />);
    const termos = secao(TERMOS);

    await digitar(campo(termos, "Nome completo"), "Analista Do Juridico");
    await digitar(campo(termos, "E-mail"), "juridico@incorporadora.test");
    await clicar(botaoDentro(termos, "Incluir"));

    const gravacao = chamadas.find((c) => c.method === "POST");
    expect((gravacao?.corpo as { cpf: string }).cpf).toBe("");
    // `conferirAssinante` aceita CPF vazio de propósito, e a Clicksign recebe
    // `has_documentation: false` (clicksign/envelope.ts). Nada trava.
  });

  // ⚠️ A RECUSA APARECE NO BLOCO EM QUE SE CLICOU (corrigido em 20/09/2026). A caixa dos termos é a
  // última das quatro e a frase saía lá em cima, fora da vista de quem acabou de clicar Incluir.
  it("a recusa do servidor aparece dentro do bloco em que se clicou", async () => {
    // Sem e-mail o servidor recusa. A caixa dos termos é a ÚLTIMA do cartão, e a frase de erro é
    // renderizada acima dos quatro blocos: quem clicou Incluir lá embaixo não vê o motivo.
    recusa = "Informe o e-mail: sem ele a pessoa nao recebe o convite para assinar.";
    await montar(<QuadroDeAssinaturaCard comAssinantesDeTermos enterpriseId={EMPREENDIMENTO} />);
    const termos = secao(TERMOS);

    await digitar(campo(termos, "Nome completo"), "Analista Sem Email");
    await clicar(botaoDentro(termos, "Incluir"));

    expect(hospedeiro.textContent).toContain("Informe o e-mail");
    expect(secao(TERMOS).textContent).toContain("Informe o e-mail");
  });
});

describe("a frase que o operador lê quando ninguém foi apontado", () => {
  const CARELI = {
    cpf: null,
    email: "financeiro@careli.test",
    nome: "Careli Administradora",
    papel: "careli",
    telefone: null,
  } as const;
  const COMPRADOR = {
    cpf: null,
    email: "comprador@teste.test",
    nome: "Comprador De Teste",
    papel: "comprador",
    telefone: null,
  } as const;

  it("nomeia o campo e diz que não precisa ser o representante legal", () => {
    const { impedimento } = signatariosDoAcordo({
      careli: { ...CARELI },
      comprador: { ...COMPRADOR },
      incorporador: null,
    });

    expect(impedimento).toContain(TERMOS);
    expect(impedimento).toContain("não precisa ser o representante legal");
    expect(impedimento).not.toContain("—");
  });

  // ⚠️ O CAMINHO É O DE VERDADE (corrigido em 20/09/2026). A frase mandava para uma "aba Assinatura"
  // que não existe no primeiro nível: a Assinatura é sub-aba de dentro do Setup.
  it("manda para a aba Setup, sub-aba Assinatura", () => {
    // O caminho de verdade: Apolo → Empreendimentos → o empreendimento → aba **Setup** → sub-aba
    // Assinatura. No primeiro nível de abas (`empreendimentos-view.tsx`, a lista com Visão geral,
    // Unidades, Carteira, …, Setup) não existe nenhuma chamada "Assinatura", e esta frase é hoje a
    // única instrução que os 18 acordos aprovados entregam ao operador.
    const { impedimento } = signatariosDoAcordo({
      careli: { ...CARELI },
      comprador: { ...COMPRADOR },
      incorporador: null,
    });

    expect(impedimento).toContain("Setup");
  });
});

describe("quem pode editar", () => {
  it("a tela não olha o papel do usuário: os campos e a lixeira saem para qualquer um", async () => {
    assinantes = [APONTADO_1];
    await montar(<QuadroDeAssinaturaCard comAssinantesDeTermos enterpriseId={EMPREENDIMENTO} />);

    // Medição, não defeito: o cartão não recebe `podeEditar` (como `ArquivosDoProduto` recebe). Quem
    // recusa é o servidor (`authorizeApoloWrite`: admin, leader, operator; `viewer` não passa).
    const termos = secao(TERMOS);
    expect(botaoDentro(termos, "Incluir")).toBeTruthy();
    expect(
      Array.from(termos.querySelectorAll("button")).some((b) =>
        b.getAttribute("aria-label")?.startsWith("Remover"),
      ),
    ).toBe(true);
  });
});

// ── O DUPLO DO BANCO ────────────────────────────────────────────────────────
//
// ⚠️ ELE HONRA `order` E `limit`, ao contrário do duplo de `quadro-termos.test.ts`. É exatamente
// isso que se quer provar aqui: que o envio leva UMA pessoa, a de menor posição, enquanto a tela
// mostra todas com a mesma etiqueta.

function linhaDoBanco(l: LinhaDaTela) {
  return {
    ativo: true,
    cpf: l.cpf,
    email: l.email,
    enterprise_id: EMPREENDIMENTO,
    nome: l.nome,
    ordem_assinatura: l.ordemAssinatura,
    papel: l.papel,
    posicao: l.posicao,
    telefone: null,
  };
}

function bancoDoQuadro(linhas: Record<string, unknown>[]): SupabaseClient {
  const construir = () => {
    const filtros: Record<string, unknown> = {};
    let coluna: string | null = null;
    let teto: null | number = null;

    const resultado = () => {
      const casadas = linhas.filter((l) =>
        Object.entries(filtros).every(
          ([nome, valor]) => nome === "workspace_id" || l[nome] === valor,
        ),
      );
      const ordenadas = coluna
        ? [...casadas].sort((a, b) => Number(a[coluna as string]) - Number(b[coluna as string]))
        : casadas;
      return { data: teto === null ? ordenadas : ordenadas.slice(0, teto), error: null };
    };

    const builder: Record<string, unknown> = {};
    Object.assign(builder, {
      eq: (nome: string, valor: unknown) => {
        filtros[nome] = valor;
        return builder;
      },
      // ⚠️ DEVOLVE O BUILDER, E NÃO A PROMESSA: o quadro chama `.limit(1).maybeSingle()` num
      // caminho e `await ...limit(1)` no outro. O builder é `thenable`, então serve aos dois.
      limit: (n: number) => {
        teto = n;
        return builder;
      },
      maybeSingle: () => Promise.resolve({ data: resultado().data[0] ?? null, error: null }),
      order: (nome: string) => {
        coluna = nome;
        return builder;
      },
      select: () => builder,
      then: (resolver: (r: unknown) => unknown) => Promise.resolve(resolver(resultado())),
    });
    return builder;
  };

  return { from: () => construir() } as unknown as SupabaseClient;
}
