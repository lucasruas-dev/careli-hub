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
  /**
   * Casado ou em união estável — o que liga `[inicio_dados_casado]` e o que decide se a oração do
   * regime de bens sai no papel. Ver `semOracaoDoRegime`.
   *
   * ⚠️ INDEFINIDO NÃO É "NÃO CASADO". Quem não informa fica com a cláusula LIGADA, pela mesma regra
   * de `condicaoLigada`: cláusula a mais alguém vê e tira; cláusula a menos vai a cartório calada.
   */
  ehCasado?: boolean;
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

    // ⚠️ O LAÇO DA MINUTA REAL NÃO É NENHUM DOS CASOS FÁCEIS. Medido na minuta publicada do Veredas
    // do Ouro em 08/09/2026: `[inicio_cada_comprador]` está DENTRO do parágrafo 5 e
    // `[fim_cada_comprador]` DENTRO do parágrafo 8 — ele não envolve blocos inteiros (o primeiro
    // caso, acima) nem cabe num parágrafo só. Ele ATRAVESSA parágrafos, começando e terminando no
    // meio de dois deles, com três parágrafos inteiros entre os dois.
    //
    // Enquanto isto não existia, `vezesDoLaco` saía ZERO na minuta de verdade: o par nunca era
    // achado, o marcador de fim era impresso no contrato e um segundo comprador simplesmente não
    // aparecia. O contrato de um casal saía com uma pessoa só.
    const filhos = no.children;
    if (Array.isArray(filhos) && filhos.some((f) => abreLaco(f))) {
      // Os dois no MESMO parágrafo: repete o trecho ali dentro.
      if (filhos.some((f) => fechaLaco(f))) {
        const dentro = expandirInline(filhos, dados);
        vezes += dentro.vezes;
        saida.push({ ...no, children: dentro.filhos });
        continue;
      }

      // Atravessa parágrafos: acha onde ele fecha, mais adiante.
      const ondeFecha = acharBlocoQueFecha(nos, i);
      if (ondeFecha < 0) {
        // Par quebrado: o marcador some e o texto fica, como no caso de blocos irmãos.
        saida.push({ ...no, children: filhos.filter((f) => !abreLaco(f)) });
        continue;
      }

      const antesDoInicio = filhos.slice(0, filhos.findIndex((f) => abreLaco(f)));
      const depoisDoInicio = filhos.slice(filhos.findIndex((f) => abreLaco(f)) + 1);

      const doFim = nos[ondeFecha];
      const filhosDoFim = (doFim?.children ?? []) as (NoDeTexto | NoDoDocumento)[];
      const posicaoDoFim = filhosDoFim.findIndex((f) => fechaLaco(f));
      const antesDoFim = filhosDoFim.slice(0, posicaoDoFim);
      const depoisDoFim = filhosDoFim.slice(posicaoDoFim + 1);

      const doMeio = nos.slice(i + 1, ondeFecha);

      // ⚠️ O QUE VEM ANTES DO MARCADOR FICA FORA DO LAÇO. No Veredas é o "I. CONTRATANTE(S):" do
      // começo do parágrafo — um título que não pode ser repetido uma vez por comprador.
      if (antesDoInicio.length > 0) saida.push({ ...no, children: antesDoInicio });

      for (const [indice, comprador] of dados.compradores.entries()) {
        vezes += 1;
        if (depoisDoInicio.length > 0) {
          saida.push(
            marcarDono({ ...no, children: depoisDoInicio } as NoDoDocumento, indice, comprador),
          );
        }
        for (const doCorpo of doMeio) saida.push(marcarDono(doCorpo, indice, comprador));
        if (antesDoFim.length > 0 && doFim) {
          saida.push(marcarDono({ ...doFim, children: antesDoFim } as NoDoDocumento, indice, comprador));
        }
      }

      if (depoisDoFim.length > 0 && doFim) saida.push({ ...doFim, children: depoisDoFim });

      i = ondeFecha;
      continue;
    }

    // Sem laço aqui: desce nos filhos, que podem ter um mais abaixo (célula de tabela, item de lista).
    if (Array.isArray(filhos) && filhos.some((f) => !ehTexto(f) && Array.isArray((f as NoDoDocumento).children))) {
      const filhosNovos: (NoDeTexto | NoDoDocumento)[] = [];
      for (const f of filhos) {
        if (ehTexto(f)) {
          filhosNovos.push(f);
          continue;
        }
        const um = expandirLaco([f as NoDoDocumento], dados);
        vezes += um.vezes;
        filhosNovos.push(...um.nos);
      }
      saida.push({ ...no, children: filhosNovos });
      continue;
    }

    saida.push(no);
  }

  return { nos: saida, vezes };
}

/**
 * O bloco, mais adiante, que contém o `[fim_cada_comprador]` deste laço.
 *
 * ⚠️ CONTA OS ANINHADOS pelos marcadores que cada bloco carrega, e não pelos blocos: um laço dentro
 * de outro (uma lista de compradores dentro de uma cláusula repetida) fecharia no lugar errado.
 */
function acharBlocoQueFecha(nos: readonly NoDoDocumento[], inicio: number): number {
  let profundidade = 0;
  for (let i = inicio + 1; i < nos.length; i += 1) {
    const filhos = nos[i]?.children;
    if (abreLaco(nos[i])) profundidade += 1;
    else if (fechaLaco(nos[i])) {
      if (profundidade === 0) return i;
      profundidade -= 1;
    }
    if (!Array.isArray(filhos)) continue;
    for (const f of filhos) {
      if (abreLaco(f)) profundidade += 1;
      else if (fechaLaco(f)) {
        if (profundidade === 0) return i;
        profundidade -= 1;
      }
    }
  }
  return -1;
}

/**
 * O laço quando ele vive DENTRO de um parágrafo.
 *
 * ⚠️ AQUI SE REPETE O TRECHO, NÃO O PARÁGRAFO. A minuta do Veredas escreve a qualificação inteira num
 * `<p>` só, com `[inicio_cada_comprador]` logo no começo e `[fim_cada_comprador]` depois do ponto
 * final — repetir o parágrafo produziria um bloco por comprador (o que também seria aceitável), mas
 * repetir o TRECHO mantém a diagramação que o jurídico escolheu, que é uma qualificação seguida da
 * outra no mesmo parágrafo. Quem quiser um parágrafo por comprador põe os marcadores FORA do `<p>`,
 * e cai no outro ramo.
 *
 * ⚠️ E O TEXTO ENTRE OS MARCADORES VIAJA JUNTO. A primeira versão deste ramo filtrava os nós de
 * texto para poder recursar, e com isso apagava as vírgulas, os "e" e os "residente e domiciliado
 * na" — tudo que não fosse variável sumia da qualificação.
 */
function expandirInline(
  filhos: readonly (NoDeTexto | NoDoDocumento)[],
  dados: DadosDoContrato,
): { filhos: (NoDeTexto | NoDoDocumento)[]; vezes: number } {
  const saida: (NoDeTexto | NoDoDocumento)[] = [];
  let vezes = 0;

  for (let i = 0; i < filhos.length; i += 1) {
    const f = filhos[i];
    if (f === undefined) continue;

    if (!abreLaco(f)) {
      // ⚠️ O `[fim_]` ÓRFÃO NÃO SAI IMPRESSO. Um par quebrado (ou um fim que sobrou de uma edição)
      // vira nada, e não `[fim_cada_comprador]` no meio do contrato do cliente.
      if (!fechaLaco(f)) saida.push(f);
      continue;
    }

    const fim = acharFimInline(filhos, i);
    if (fim < 0) continue;

    const corpo = filhos.slice(i + 1, fim);
    for (const [indice, comprador] of dados.compradores.entries()) {
      vezes += 1;
      // ⚠️ UM ESPAÇO ENTRE AS CÓPIAS, quando o texto não o traz. A qualificação costuma terminar em
      // ponto final, e sem isto o contrato de dois compradores imprime "…CPF nº 137.MARIA SOUZA,
      // brasileira…" — coladas. Só entra quando falta: se a minuta já termina o trecho com espaço,
      // ponto-e-vírgula ou " e ", nada é acrescentado, e a diagramação escolhida pelo jurídico é
      // respeitada.
      if (indice > 0 && precisaDeEspaco(saida, corpo)) saida.push({ text: " " });
      for (const doCorpo of corpo) {
        saida.push(
          ehTexto(doCorpo) ? doCorpo : marcarDono(doCorpo as NoDoDocumento, indice, comprador),
        );
      }
    }
    i = fim;
  }

  return { filhos: saida, vezes };
}

/**
 * A cópia anterior terminou colada na próxima?
 *
 * Olha o último caractere já emitido e o primeiro do trecho que vem. Um nó de VARIÁVEL nas pontas
 * conta como "não é espaço": o valor dela é um nome ou um número, nunca um separador.
 */
function precisaDeEspaco(
  jaEmitido: readonly (NoDeTexto | NoDoDocumento)[],
  corpo: readonly (NoDeTexto | NoDoDocumento)[],
): boolean {
  const ultimo = jaEmitido[jaEmitido.length - 1];
  const fimAnterior = ehTexto(ultimo) ? ultimo.text : "";
  if (/\s$/.test(fimAnterior)) return false;

  const primeiro = corpo[0];
  const comecoSeguinte = ehTexto(primeiro) ? primeiro.text : "";
  return !/^\s/.test(comecoSeguinte);
}

/** ⚠️ CONTA OS ANINHADOS, como a versão de bloco. */
function acharFimInline(filhos: readonly (NoDeTexto | NoDoDocumento)[], inicio: number): number {
  let profundidade = 0;
  for (let i = inicio + 1; i < filhos.length; i += 1) {
    const f = filhos[i];
    if (abreLaco(f)) profundidade += 1;
    else if (fechaLaco(f)) {
      if (profundidade === 0) return i;
      profundidade -= 1;
    }
  }
  return -1;
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

  const resolvidos = semOracaoDoRegime(aplicarPares(filhos, dados, dono), dados, dono);
  const finais: (NoDeTexto | NoDoDocumento)[] = [];

  // ⚠️ TINHA CONTEÚDO ANTES? É o que separa "esvaziou no corte" de "já nascia vazio". Ver
  // `VAZIO_POR_CORTE` abaixo.
  const tinhaConteudo = filhos.some((f) => (ehTexto(f) ? f.text !== "" : true));

  for (const filho of resolvidos) {
    if (ehTexto(filho)) {
      finais.push(filho);
      continue;
    }
    const alvo = filho as NoDoDocumento;
    const nome = nomeDaVariavel(alvo);
    if (nome) {
      finais.push(textoDaVariavel(alvo, nome, dados, semValor, donoDoNo(alvo) ?? dono));
      continue;
    }
    const resolvido = resolverNo(alvo, dados, semValor, donoDoNo(alvo) ?? dono);
    // O filho que esvaziou no corte não entra: um `<td>` ou um `<li>` vazio abre o mesmo vão que o
    // parágrafo, e aqui é o único lugar que sabe que ele existiu.
    if (!esvaziouNoCorte(resolvido)) finais.push(resolvido);
  }

  const pronto = limpar({ ...no, children: finais });
  const ficouVazio = finais.every((f) => ehTexto(f) && f.text === "");
  return tinhaConteudo && ficouVazio ? marcarVazioPorCorte(pronto) : pronto;
}

const REGIME = "regime_casamento_cliente";

/**
 * O texto que ANUNCIA o regime de bens: "casado sob o regime de", "sob o regime da comunhão".
 * É o gatilho do corte — sem ele, nada é apagado.
 */
const ANUNCIA_O_REGIME = /regime|casad/i;

/**
 * Quem não é casado não leva a oração do regime de bens.
 *
 * ⚠️ O PROBLEMA NÃO É O CAMPO VAZIO, É A ORAÇÃO QUE SOBRA. A minuta do Lucas escreve, em texto
 * corrido, `[estado_civil_cliente]`, casado sob o regime de `[regime_casamento_cliente]` — e num
 * comprador solteiro o motor imprimia "Solteiro (a), casado sob o regime de
 * [regime_casamento_cliente]". Esconder só a variável não resolve: sobraria "Solteiro (a), casado
 * sob o regime de ,", que é pior, porque parece redação e não erro. Some a oração inteira.
 *
 * ⚠️ E O CORTE É ANTES DAS VARIÁVEIS VIRAREM TEXTO, de propósito. Depois disso o nó anterior pode
 * ser o VALOR de outra variável — o "Solteiro (a)" do estado civil — e recortar ali comeria o dado
 * do cadastro em vez da redação da minuta.
 *
 * ⚠️ O GATILHO É DUPLO: o comprador não ser casado E o texto anterior anunciar o regime. Sem a
 * segunda condição, uma minuta que escrevesse a variável sozinha perderia a vírgula do vizinho.
 *
 * A forma CERTA de escrever isto numa minuta nova é o par `[inicio_dados_casado]` … `[fim_dados_
 * casado]`, que já existe. Isto aqui é o conserto de quem já foi escrito sem ele — e as 41 minutas
 * a migrar do legado estão todas nesse caso.
 */
function semOracaoDoRegime(
  filhos: readonly (NoDeTexto | NoDoDocumento)[],
  dados: DadosDoContrato,
  dono: null | number,
): (NoDeTexto | NoDoDocumento)[] {
  const saida = [...filhos];

  // De trás para frente: remover um item não desloca os índices que ainda faltam olhar.
  for (let i = saida.length - 1; i >= 0; i -= 1) {
    const filho = saida[i];
    if (!filho || ehTexto(filho) || nomeDaVariavel(filho) !== REGIME) continue;

    const comprador = dados.compradores[donoDoNo(filho) ?? dono ?? 0];
    if (comprador?.ehCasado !== false) continue;

    saida.splice(i, 1);

    const anterior = i > 0 ? saida[i - 1] : undefined;
    if (!anterior || !ehTexto(anterior)) continue;
    saida[i - 1] = { ...anterior, text: semAOracao(anterior.text) };
  }

  return saida;
}

/** Corta da última vírgula até o fim, quando o que vem depois dela anuncia o regime. */
function semAOracao(bruto: string): string {
  const corte = Math.max(bruto.lastIndexOf(","), bruto.lastIndexOf(";"));
  const oracao = corte >= 0 ? bruto.slice(corte) : bruto;
  if (!ANUNCIA_O_REGIME.test(oracao)) return bruto;
  return corte >= 0 ? bruto.slice(0, corte) : "";
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

    // ⚠️ O DONO SAI DO MARCADOR, e não do parágrafo. Ver `donoDoNo`: num laço inline os nós de dois
    // compradores são irmãos no mesmo `<p>`, e é o `[inicio_dados_conjuge]` copiado que sabe de quem
    // ele é. Usar o dono do pai fazia o cônjuge do primeiro comprador aparecer na qualificação de
    // todos — o defeito do legado, reencenado.
    const doMarcador = donoDoNo(filho) ?? dono;
    if (condicaoLigada(chave, dados, doMarcador)) {
      saida.push(...aplicarPares(filhos.slice(i + 1, fim), dados, doMarcador));
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
  if (chave === "dados_casado") return comprador?.ehCasado !== false;

  // Os sufixados do legado: `dados_cliente_3` sai só quando existe um terceiro comprador.
  const legado = /^dados_cliente_([2-5])$/.exec(chave);
  if (legado?.[1]) return dados.compradores.length >= Number(legado[1]);

  const conjugeLegado = /^dados_conjuge_([2-5])$/.exec(chave);
  if (conjugeLegado?.[1]) {
    return dados.compradores[Number(conjugeLegado[1]) - 1]?.temConjuge === true;
  }

  const casadoLegado = /^dados_casado_([2-5])$/.exec(chave);
  if (casadoLegado?.[1]) {
    return dados.compradores[Number(casadoLegado[1]) - 1]?.ehCasado !== false;
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

  // ⚠️ MARCADOR DE BLOCO ÓRFÃO VIRA NADA, e nunca `[fim_cada_comprador]` no papel. Ele chega aqui
  // quando o par está quebrado — uma edição que apagou metade, um `[fim_]` colado sem o `[inicio_]`.
  // É a única família de nomes que some em silêncio, e a razão é que ela nunca foi conteúdo: é
  // instrução para este motor, e instrução impressa no contrato do cliente é pior do que instrução
  // perdida. Todo o resto que falta continua saindo visível, como manda a nota do topo.
  if (nome.startsWith(PREFIXO_INICIO) || nome.startsWith(PREFIXO_FIM)) {
    return { ...marcas, text: "" };
  }

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
 * O carimbo de "este nó esvaziou por causa do corte".
 *
 * ⚠️ É UM SÍMBOLO, E NÃO UMA CHAVE DE TEXTO, exatamente ao contrário do `DONO`. Símbolo não
 * atravessa `JSON.stringify` nem aparece no serializador, então ele não pode vazar para o
 * documento gravado nem virar atributo no HTML — e por isso não precisa ser apagado depois, que é
 * o cuidado que o `DONO` exige em `limpar`.
 */
const VAZIO_POR_CORTE = Symbol("vazioPorCorte");

function marcarVazioPorCorte(no: NoDoDocumento): NoDoDocumento {
  return { ...no, [VAZIO_POR_CORTE]: true } as NoDoDocumento;
}

function esvaziouNoCorte(no: unknown): boolean {
  return (no as Record<symbol, unknown>)?.[VAZIO_POR_CORTE] === true;
}

/**
 * Remove o parágrafo que ficou completamente vazio depois do corte.
 *
 * ⚠️ SÓ O QUE FICOU VAZIO POR CAUSA DO CORTE, e nunca o que já era vazio na minuta: linha em branco
 * entre cláusulas é diagramação, e o jurídico as coloca de propósito. O sinal é ter tido filho
 * ANTES: um parágrafo que só continha `[inicio_dados_conjuge]…[fim_dados_conjuge]` de um solteiro
 * fica sem nada, e imprimi-lo abriria um vão no contrato que ninguém sabe explicar.
 *
 * ⚠️ E "SEM NADA" QUASE NUNCA É ZERO FILHOS, que era o buraco desta função. Medido no contrato do
 * Otávio (viúvo) em 08/09/2026: o parágrafo do cônjuge guarda `[{text:""}, [inicio_dados_conjuge],
 * …, [fim_dados_conjuge], {text:""}]` — os dois textos vazios estão FORA do par, então sobrevivem
 * ao corte e o parágrafo termina com DOIS filhos. A contagem dizia "não está vazio", ele passava
 * inteiro e saía no papel como `<p><br /></p>`: uma linha em branco no lugar exato da qualificação
 * do cônjuge, no contrato de quem não tem cônjuge. Agora quem decide é o carimbo, posto por
 * `resolverNo`, que é o único ponto que viu o antes e o depois.
 */
function podarVazios(nos: readonly NoDoDocumento[]): NoDoDocumento[] {
  return nos.filter((no) => {
    if (esvaziouNoCorte(no)) return false;
    if (!Array.isArray(no.children)) return true;
    if (no.children.length > 0) return true;
    // Chegou aqui com zero filhos: ou nasceu assim (o serializador emite `<p></p>`, que é a linha em
    // branco) ou perdeu todos no corte. Nos dois casos um nó sem filho nenhum quebra o Slate, então
    // ele vira um parágrafo com texto vazio em vez de sumir.
    return false;
  });
}

// ── AJUDANTES ───────────────────────────────────────────────────────────────

/**
 * De quem é este nó.
 *
 * ⚠️ O DONO VIAJA NO NÓ, e quem o lê tem de olhar o NÓ, não o pai. Num laço inline os nós de dois
 * compradores viram irmãos dentro do MESMO parágrafo — o parágrafo não tem dono nenhum, e cada
 * filho carrega o seu. Ler só o do pai fazia o contrato de dois compradores sair com o primeiro
 * repetido duas vezes, que foi o defeito pego pelo teste do laço inline em 08/09/2026.
 */
function donoDoNo(no: unknown): null | number {
  const v = (no as Record<string, unknown>)?.[DONO];
  return typeof v === "number" ? v : null;
}

function ehTexto(no: unknown): no is NoDeTexto {
  return typeof (no as NoDeTexto)?.text === "string";
}

function nomeDaVariavel(no: unknown): null | string {
  const alvo = no as { nome?: unknown; type?: unknown };
  if (alvo?.type !== "variavel") return null;
  return typeof alvo.nome === "string" ? alvo.nome : null;
}

const MARCAS_DE_TEXTO = [
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
] as const;

/**
 * As marcas de texto que o valor da variável herda, para ele sair com a mesma cara do parágrafo.
 *
 * ⚠️ NO PLATE, A CARA DO CHIP MORA NO FILHO, e era essa a metade que faltava. O nó `variavel` é um
 * elemento void INLINE: ele guarda `type`, `nome`, `id` e um `children` de um texto vazio — e é
 * NESSE filho que o editor grava `bold`, `color` e `fontFamily`. Medido na minuta do ZZ TESTE em
 * 08/09/2026: dos 102 nós de variável, ZERO têm marca no próprio nó e 48 têm no filho. Lendo só o
 * nó, todo valor saía sem negrito e sem a fonte da minuta — num parágrafo em Lucida Sans o nome do
 * comprador voltava para a serifa padrão do documento, e o "COMPRADOR" que a minuta pediu em
 * negrito saía leve.
 *
 * O nó continua vindo primeiro: se um dia ele carregar marca própria, ela vence a do filho.
 */
function marcasDoNo(no: NoDoDocumento): Omit<NoDeTexto, "text"> {
  const doFilho = (no.children ?? []).find((f) => ehTexto(f));
  return {
    ...soAsMarcas(doFilho as unknown as Record<string, unknown> | undefined),
    ...soAsMarcas(no as unknown as Record<string, unknown>),
  } as Omit<NoDeTexto, "text">;
}

function soAsMarcas(cru: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!cru) return {};
  const marcas: Record<string, unknown> = {};
  for (const chave of MARCAS_DE_TEXTO) {
    if (cru[chave] !== undefined) marcas[chave] = cru[chave];
  }
  return marcas;
}
