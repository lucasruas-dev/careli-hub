import type { NoDeTexto, NoDoDocumento } from "./documento-html";

// O MOTOR DO CONTRATO — a minuta vira documento preenchido.
//
// Lucas, 08/09/2026: *"garante então a construção para a gente emitir contratos, precisamos testar
// isso hoje"*. E, sobre o primeiro entregável: *"eu havia falado que deveria ter um campo para
// visualização do contrato preenchido, tipo uma prévia antes de enviar"*.
//
// ⚠️ ISTO NÃO EXISTIA. Até hoje as ~280 variáveis do catálogo eram lidas SÓ por auditoria e pelo
// editor: nada substituía `[nome_cliente]` por um nome. No board da Têmis, "Gerar o contrato pela
// minuta do empreendimento" era uma CAIXINHA que alguém marcava à mão. Este arquivo é o que faltava.
//
// ⚠️ ELE TRABALHA SOBRE OS NÓS, NÃO SOBRE O HTML, e essa é a decisão que faz o resto ser simples.
// No documento do editor a variável já é um NÓ (`{ type: "variavel", nome }`) — inclusive os
// marcadores de bloco, que também estão no catálogo. Trabalhar no HTML exigiria achar
// `[inicio_dados_conjuge]` no meio das tags e adivinhar quais `<p>` remover junto; um bloco que
// começa num parágrafo e termina em outro deixaria tag órfã, e tag órfã num contrato é uma cláusula
// que some ou dobra. Aqui o corte é numa árvore, e a árvore continua válida por construção.
//
// A ORDEM DAS ETAPAS É O CONTRATO DESTE ARQUIVO, e ela não é arbitrária:
//
//   1. O LAÇO   `[inicio_cada_comprador]…[fim_cada_comprador]` é repetido, um por comprador. Só
//               depois disso existe "o comprador desta cópia" para as etapas seguintes resolverem.
//   2. OS PARES `[inicio_dados_conjuge]`, `_pf`, `_pj`, `tem_anexo_3`… ficam ou somem, cada um
//               perguntando ao dado da SUA cópia. Antes do laço, "o cônjuge" seria ambíguo.
//   3. AS VARIÁVEIS  o que sobrou vira texto.
//
// Inverter 1 e 2 faria o contrato de um casal sair com o cônjuge do primeiro comprador repetido em
// todas as qualificações — que é exatamente o defeito que o legado produzia.

/** Um comprador, já com tudo que as variáveis daquele grupo pedem. Chaves = nomes SEM colchetes. */
export type DadosDoComprador = {
  /** `[inicio_dados_conjuge]` só imprime quando isto é verdadeiro. */
  temConjuge: boolean;
  /** `[inicio_dados_cliente_pj]` quando falso; `_pf` quando verdadeiro. */
  ehPessoaFisica: boolean;
  valores: Record<string, string>;
};

export type DadosDoContrato = {
  /** Anexos que EXISTEM, por posição (1, 2, 3…). É o que liga `[inicio_tem_anexo_2]`. */
  anexos?: Record<number, string>;
  /** Na ordem do contrato. O primeiro é o titular. */
  compradores: DadosDoComprador[];
  /** Ligado/desligado de pares que não são por comprador (`tem_anuais`, e o que vier). */
  condicoes?: Record<string, boolean>;
  /** Tudo que não é por comprador: unidade, empreendimento, valores, plano, vendedora, corretagem. */
  gerais: Record<string, string>;
};

export type ResultadoDoPreenchimento = {
  /** O documento pronto, para serializar em HTML e virar PDF. */
  nos: NoDoDocumento[];
  /** Nomes que o texto pedia e o preenchimento não soube responder. É o que a prévia precisa avisar. */
  semValor: string[];
  /** Quantas vezes o laço de comprador rodou. Zero significa minuta sem laço, o que é legítimo. */
  vezesDoLaco: number;
};

const PREFIXO_INICIO = "inicio_";
const PREFIXO_FIM = "fim_";
const LACO = "cada_comprador";

/**
 * Preenche a minuta.
 *
 * ⚠️ O QUE NÃO TEM VALOR **NÃO SOME** — vira `[nome]` de novo, em texto, e entra em `semValor`. É a
 * decisão mais importante daqui. Um contrato que imprime `[cpf_cliente]` no papel é constrangedor e
 * salta aos olhos; um contrato onde o CPF simplesmente NÃO ESTÁ passa pela conferência de todo mundo
 * e chega ao cartório. Some quem escolheu sumir: o bloco condicional.
 */
export function preencherContrato(
  minuta: readonly NoDoDocumento[],
  dados: DadosDoContrato,
): ResultadoDoPreenchimento {
  const semValor = new Set<string>();

  const comLaco = expandirLaco(minuta, dados);
  const nos = comLaco.nos.map((no) => resolverNo(no, dados, semValor, null));

  return {
    nos: podarVazios(nos),
    semValor: [...semValor].sort(),
    vezesDoLaco: comLaco.vezes,
  };
}

// ── 1. O LAÇO ───────────────────────────────────────────────────────────────
//
// ⚠️ O LAÇO É A RAZÃO DE ESTE MÓDULO EXISTIR EM VEZ DE UM `replace`. A minuta escreve a qualificação
// UMA vez; a venda tem de um a cinco compradores, cada um com cônjuge próprio. É a decisão de
// 07/09/2026 que aposentou os sufixos `_2`…`_5` — que escreviam a mesma qualificação cinco vezes e
// ainda assim paravam no quinto.
//
// ⚠️ ELE É PLANO, NÃO ANINHADO. O trecho entre os marcadores é copiado inteiro, N vezes, na mesma
// altura da árvore em que estava. Aninhar (um nó "grupo" por comprador) mudaria a estrutura do
// documento e quebraria a numeração de páginas e o alinhamento herdado do parágrafo de fora.

function expandirLaco(
  nos: readonly NoDoDocumento[],
  dados: DadosDoContrato,
): { nos: NoDoDocumento[]; vezes: number } {
  const saida: NoDoDocumento[] = [];
  let vezes = 0;

  for (let i = 0; i < nos.length; i += 1) {
    const no = nos[i];
    if (!no) continue;

    if (abreLaco(no)) {
      const fim = acharFimDoLaco(nos, i);
      // ⚠️ ABERTURA SEM FECHAMENTO NÃO ENGOLE O RESTO DO CONTRATO. Se o par está quebrado (o defeito
      // que `conferirBlocos` acusa antes de publicar, e que já saiu impresso no Villa Paris), o
      // marcador é descartado e o texto segue — perder um contrato inteiro por causa de um colchete
      // é pior do que imprimir uma qualificação a mais.
      if (fim < 0) continue;

      const corpo = nos.slice(i + 1, fim);
      for (const [indice, comprador] of dados.compradores.entries()) {
        vezes += 1;
        for (const doCorpo of corpo) {
          saida.push(marcarDono(doCorpo, indice, comprador));
        }
      }
      i = fim;
      continue;
    }

    // O laço pode estar DENTRO de um parágrafo (marcadores inline), não só entre eles.
    const filhos = no.children;
    if (Array.isArray(filhos) && filhos.some((f) => !ehTexto(f) && abreLaco(f as NoDoDocumento))) {
      const dentro = expandirLaco(filhos.filter((f): f is NoDoDocumento => !ehTexto(f)), dados);
      vezes += dentro.vezes;
      saida.push({ ...no, children: dentro.nos });
      continue;
    }

    if (Array.isArray(filhos) && filhos.some((f) => !ehTexto(f))) {
      const dentro = expandirLaco(
        filhos.map((f) => (ehTexto(f) ? ({ children: [f], type: "__texto__" } as NoDoDocumento) : f)),
        dados,
      );
      vezes += dentro.vezes;
      saida.push({
        ...no,
        children: dentro.nos.flatMap((n) =>
          n.type === "__texto__" ? ((n.children ?? []) as (NoDeTexto | NoDoDocumento)[]) : [n],
        ),
      });
      continue;
    }

    saida.push(no);
  }

  return { nos: saida, vezes };
}

function abreLaco(no: unknown): boolean {
  return nomeDaVariavel(no) === `${PREFIXO_INICIO}${LACO}`;
}

function fechaLaco(no: unknown): boolean {
  return nomeDaVariavel(no) === `${PREFIXO_FIM}${LACO}`;
}

/** ⚠️ CONTA OS ANINHADOS. Um laço dentro de outro não deve fechar no `[fim_]` do de dentro. */
function acharFimDoLaco(nos: readonly NoDoDocumento[], inicio: number): number {
  let profundidade = 0;
  for (let i = inicio + 1; i < nos.length; i += 1) {
    const no = nos[i];
    if (abreLaco(no)) profundidade += 1;
    else if (fechaLaco(no)) {
      if (profundidade === 0) return i;
      profundidade -= 1;
    }
  }
  return -1;
}

/**
 * Carimba, em cada nó copiado, de quem ele é.
 *
 * ⚠️ O DONO VIAJA NO NÓ, e não numa variável do laço. Depois da expansão os nós de dois compradores
 * são irmãos na mesma lista, indistinguíveis: sem o carimbo, `[nome_cliente]` na segunda cópia não
 * teria como saber que é do segundo. O campo sai do documento antes de virar HTML (ver `limpar`).
 */
const DONO = "__comprador__";

function marcarDono(no: NoDoDocumento, indice: number, _c: DadosDoComprador): NoDoDocumento {
  const filhos = no.children;
  return {
    ...no,
    [DONO]: indice,
    ...(Array.isArray(filhos)
      ? {
          children: filhos.map((f) =>
            ehTexto(f) ? f : marcarDono(f as NoDoDocumento, indice, _c),
          ),
        }
      : {}),
  } as NoDoDocumento;
}

// ── 2 e 3. OS PARES E AS VARIÁVEIS ──────────────────────────────────────────

function resolverNo(
  no: NoDoDocumento,
  dados: DadosDoContrato,
  semValor: Set<string>,
  donoHerdado: null | number,
): NoDoDocumento {
  const dono = typeof (no as Record<string, unknown>)[DONO] === "number"
    ? ((no as Record<string, unknown>)[DONO] as number)
    : donoHerdado;

  const filhos = no.children;
  if (!Array.isArray(filhos)) return limpar(no);

  const resolvidos = aplicarPares(filhos, dados, dono);
  const finais: (NoDeTexto | NoDoDocumento)[] = [];

  for (const filho of resolvidos) {
    if (ehTexto(filho)) {
      finais.push(filho);
      continue;
    }
    const alvo = filho as NoDoDocumento;
    const nome = nomeDaVariavel(alvo);
    if (nome) {
      finais.push(textoDaVariavel(alvo, nome, dados, semValor, dono));
      continue;
    }
    finais.push(resolverNo(alvo, dados, semValor, dono));
  }

  return limpar({ ...no, children: finais });
}

/**
 * Mantém ou remove cada trecho entre `[inicio_x]` e `[fim_x]`.
 *
 * ⚠️ OS MARCADORES SOMEM SEMPRE, o trecho é que fica ou não. Foi o defeito que saiu impresso no
 * contrato real do Villa Paris: o bloco de pessoa jurídica apareceu num comprador pessoa física
 * porque o motor do legado não respeitou o par.
 */
function aplicarPares(
  filhos: readonly (NoDeTexto | NoDoDocumento)[],
  dados: DadosDoContrato,
  dono: null | number,
): (NoDeTexto | NoDoDocumento)[] {
  const saida: (NoDeTexto | NoDoDocumento)[] = [];

  for (let i = 0; i < filhos.length; i += 1) {
    const filho = filhos[i];
    if (!filho) continue;

    const nome = ehTexto(filho) ? null : nomeDaVariavel(filho);
    if (!nome?.startsWith(PREFIXO_INICIO)) {
      saida.push(filho);
      continue;
    }

    const chave = nome.slice(PREFIXO_INICIO.length);
    if (chave === LACO) {
      // Laço já foi expandido; um marcador solto aqui é resíduo e não deve sair impresso.
      continue;
    }

    const fim = acharFim(filhos, i, chave);
    if (fim < 0) {
      // Par quebrado: o marcador some, o texto fica. Ver a nota do laço.
      continue;
    }

    if (condicaoLigada(chave, dados, dono)) {
      saida.push(...aplicarPares(filhos.slice(i + 1, fim), dados, dono));
    }
    i = fim;
  }

  return saida;
}

function acharFim(
  filhos: readonly (NoDeTexto | NoDoDocumento)[],
  inicio: number,
  chave: string,
): number {
  let profundidade = 0;
  for (let i = inicio + 1; i < filhos.length; i += 1) {
    const f = filhos[i];
    const nome = f && !ehTexto(f) ? nomeDaVariavel(f) : null;
    if (nome === `${PREFIXO_INICIO}${chave}`) profundidade += 1;
    else if (nome === `${PREFIXO_FIM}${chave}`) {
      if (profundidade === 0) return i;
      profundidade -= 1;
    }
  }
  return -1;
}

/**
 * O par está ligado?
 *
 * ⚠️ O QUE NÃO SE CONHECE FICA LIGADO. Um par novo, que este motor ainda não sabe interpretar, é
 * tratado como verdadeiro: a cláusula sai no contrato e alguém percebe. Tratá-lo como falso faria a
 * cláusula desaparecer em silêncio — e cláusula que some de contrato assinado é o pior defeito que
 * este módulo pode ter.
 */
function condicaoLigada(chave: string, dados: DadosDoContrato, dono: null | number): boolean {
  const comprador = dono === null ? dados.compradores[0] : dados.compradores[dono];

  if (chave === "dados_conjuge") return comprador?.temConjuge === true;
  if (chave === "dados_cliente_pf") return comprador?.ehPessoaFisica !== false;
  if (chave === "dados_cliente_pj") return comprador?.ehPessoaFisica === false;

  // Os sufixados do legado: `dados_cliente_3` sai só quando existe um terceiro comprador.
  const legado = /^dados_cliente_([2-5])$/.exec(chave);
  if (legado?.[1]) return dados.compradores.length >= Number(legado[1]);

  const conjugeLegado = /^dados_conjuge_([2-5])$/.exec(chave);
  if (conjugeLegado?.[1]) {
    return dados.compradores[Number(conjugeLegado[1]) - 1]?.temConjuge === true;
  }

  const pfLegado = /^dados_cliente_pf_([2-5])$/.exec(chave);
  if (pfLegado?.[1]) return dados.compradores[Number(pfLegado[1]) - 1]?.ehPessoaFisica !== false;

  const pjLegado = /^dados_cliente_pj_([2-5])$/.exec(chave);
  if (pjLegado?.[1]) return dados.compradores[Number(pjLegado[1]) - 1]?.ehPessoaFisica === false;

  const anexo = /^tem_anexo_([1-9][0-9]?)$/.exec(chave);
  if (anexo?.[1]) return Boolean(dados.anexos?.[Number(anexo[1])]);

  if (dados.condicoes && chave in dados.condicoes) return dados.condicoes[chave] === true;

  return true;
}

/**
 * A variável vira texto.
 *
 * ⚠️ O NÓ VIRA TEXTO SIMPLES, e não some. Ele é void e inline no editor; deixá-lo no documento final
 * faria o serializador emitir de volta `[nome_cliente]` com o estilo de chip. Aqui ele é substituído
 * pelo VALOR, herdando as marcas do próprio nó (negrito, fonte) — que é o que faz o nome do
 * comprador sair em negrito quando a minuta pediu negrito.
 */
function textoDaVariavel(
  no: NoDoDocumento,
  nome: string,
  dados: DadosDoContrato,
  semValor: Set<string>,
  dono: null | number,
): NoDeTexto {
  const marcas = marcasDoNo(no);
  const valor = valorDaVariavel(nome, dados, dono);

  if (valor === null) {
    semValor.add(nome);
    // Ver a nota de `preencherContrato`: o que falta VOLTA a aparecer, para saltar aos olhos.
    return { ...marcas, text: `[${nome}]` };
  }
  return { ...marcas, text: valor };
}

function valorDaVariavel(
  nome: string,
  dados: DadosDoContrato,
  dono: null | number,
): null | string {
  const indice = dono ?? 0;

  // Do comprador desta cópia.
  const doComprador = dados.compradores[indice]?.valores?.[nome];
  if (doComprador !== undefined) return doComprador;

  // Os sufixados do legado apontam para o comprador N.
  const sufixado = /^(.+)_([2-5])$/.exec(nome);
  if (sufixado?.[1] && sufixado[2]) {
    const daquele = dados.compradores[Number(sufixado[2]) - 1]?.valores?.[sufixado[1]];
    if (daquele !== undefined) return daquele;
  }

  const geral = dados.gerais[nome];
  if (geral !== undefined) return geral;

  // O nome do anexo (`anexo_2_nome`) sai do cadastro, não do catálogo estático.
  const nomeDeAnexo = /^anexo_([1-9][0-9]?)_nome$/.exec(nome);
  if (nomeDeAnexo?.[1]) return dados.anexos?.[Number(nomeDeAnexo[1])] ?? null;

  return null;
}

// ── LIMPEZA ─────────────────────────────────────────────────────────────────

/**
 * Tira o carimbo do dono e junta textos vizinhos iguais.
 *
 * ⚠️ O CARIMBO NÃO PODE CHEGAR AO HTML. Ele é andaime deste módulo; um `__comprador__: 1` que
 * sobrevivesse viraria atributo no documento gravado e apareceria em qualquer diff de versão.
 */
function limpar(no: NoDoDocumento): NoDoDocumento {
  const copia = { ...no } as Record<string, unknown>;
  delete copia[DONO];
  return copia as NoDoDocumento;
}

/**
 * Remove o parágrafo que ficou completamente vazio depois do corte.
 *
 * ⚠️ SÓ O QUE FICOU VAZIO POR CAUSA DO CORTE, e nunca o que já era vazio na minuta: linha em branco
 * entre cláusulas é diagramação, e o jurídico as coloca de propósito. O sinal é ter tido filho
 * ANTES: um parágrafo que só continha `[inicio_dados_conjuge]…[fim_dados_conjuge]` de um solteiro
 * fica sem nada, e imprimi-lo abriria um vão no contrato que ninguém sabe explicar.
 */
function podarVazios(nos: readonly NoDoDocumento[]): NoDoDocumento[] {
  return nos.filter((no) => {
    if (!Array.isArray(no.children)) return true;
    if (no.children.length > 0) return true;
    // Chegou aqui com zero filhos: ou nasceu assim (o serializador emite `<p></p>`, que é a linha em
    // branco) ou perdeu todos no corte. Nos dois casos um nó sem filho nenhum quebra o Slate, então
    // ele vira um parágrafo com texto vazio em vez de sumir.
    return false;
  });
}

// ── AJUDANTES ───────────────────────────────────────────────────────────────

function ehTexto(no: unknown): no is NoDeTexto {
  return typeof (no as NoDeTexto)?.text === "string";
}

function nomeDaVariavel(no: unknown): null | string {
  const alvo = no as { nome?: unknown; type?: unknown };
  if (alvo?.type !== "variavel") return null;
  return typeof alvo.nome === "string" ? alvo.nome : null;
}

/** As marcas de texto que o nó de variável carrega, para o valor sair com a mesma cara. */
function marcasDoNo(no: NoDoDocumento): Omit<NoDeTexto, "text"> {
  const cru = no as unknown as Record<string, unknown>;
  const marcas: Record<string, unknown> = {};
  for (const chave of [
    "backgroundColor",
    "bold",
    "color",
    "fontFamily",
    "fontSize",
    "italic",
    "strikethrough",
    "subscript",
    "superscript",
    "underline",
  ]) {
    if (cru[chave] !== undefined) marcas[chave] = cru[chave];
  }
  return marcas as Omit<NoDeTexto, "text">;
}
