import { casarTrecho } from "@/lib/temis/casar-trecho";

// ONDE O TRECHO ESTÁ, DENTRO DOS NÓS — a ponte entre o que a IA leu e o documento do editor.
//
// O super agente da minuta (`/api/temis/minutas/marcar`) recebe o TEXTO PURO e devolve propostas
// {trecho, o que fazer}. Mas a marcação tem de acontecer no DOCUMENTO, não no texto: aplicar no
// texto e reconstruir o documento perderia negrito, tabela, alinhamento e quebra de cláusula — tudo
// o que o jurídico ajustou.
//
// Esta camada faz a volta: dado o trecho, diz em que nó e em que posição ele começa e termina.
//
// ⚠️ O TRECHO PODE ATRAVESSAR NÓS, e é o caso comum, não a exceção. "JOÃO DA SILVA" pode estar
// partido em três nós porque alguém deixou metade em negrito — é o mesmo fenômeno que fez
// `[nome_cl</strong>iente]` sair impresso no primeiro contrato de teste do JDG. Por isso a busca é
// feita sobre o texto CONCATENADO de todos os nós, e o resultado é convertido de volta em
// (caminho, posição).
//
// ⚠️ E O NÓ DE VARIÁVEL NÃO ENTRA NA CONCATENAÇÃO COM O SEU NOME. Ele é um void cujo texto é vazio;
// se contássemos `[nome_cliente]` como texto, os offsets de tudo que vem depois sairiam errados e a
// marcação cairia deslocada. Ele conta como comprimento ZERO — que é o que ele é na folha.
//
// ⚠️ E OS PARÁGRAFOS SÃO SEPARADOS POR QUEBRA DE LINHA. Até 08/09/2026 não eram, e esse era o maior
// defeito do agente: o texto que ele lia chegava com o fim de uma cláusula colado no começo da
// seguinte ("…deste instrumento.II – INTERMEDIADORES…"). O modelo lia palavras que não existem, e
// citava trechos com o espaço que ele "consertava" na leitura — que depois não casavam com o texto.
// Lucas viu o efeito no painel: *"11 propostas… 17 não casou com o texto e ficou de fora"*.
//
// ⚠️ O SEPARADOR NÃO EXISTE EM NÓ NENHUM, e é por isso que ele é um pedaço VIRTUAL aqui. Um ponto
// que caia dentro dele não tem caminho no Slate — ele é dobrado para o fim do nó anterior, que é a
// mesma posição na tela.

/** Um nó de texto do documento e onde ele fica. `virtual` marca o separador entre parágrafos. */
type Pedaco = {
  caminho: number[];
  /** Onde o texto deste nó começa, no texto concatenado do documento. */
  inicio: number;
  texto: string;
  /** Separador de parágrafo: existe no texto, não existe no documento. */
  virtual?: boolean;
};

export type PontoNoDocumento = { offset: number; path: number[] };
export type FaixaNoDocumento = { fim: PontoNoDocumento; inicio: PontoNoDocumento };

/**
 * Os tipos que vivem DENTRO de um parágrafo. Tudo o que não está aqui é bloco, e bloco termina em
 * quebra de linha.
 *
 * ⚠️ A LISTA É DE INLINES, e não de blocos, de propósito. Um tipo novo desconhecido é tratado como
 * bloco: no pior caso sobra uma quebra de linha no texto que a IA lê, o que é inofensivo. Se fosse
 * lista de blocos, o tipo novo viraria inline e voltaria a colar dois parágrafos.
 */
const INLINES = new Set([
  "a",
  "date",
  "footnoteReference",
  "inline_equation",
  "mention",
  "mention_input",
  "smart_variable",
  "variavel",
  "variavel_input",
]);

function ehTexto(no: unknown): no is { text: string } {
  return typeof no === "object" && no !== null && typeof (no as { text?: unknown }).text === "string";
}

function filhos(no: unknown): unknown[] {
  const c = (no as { children?: unknown })?.children;
  return Array.isArray(c) ? c : [];
}

function ehInline(no: unknown): boolean {
  const tipo = (no as { type?: unknown })?.type;
  return typeof tipo === "string" && INLINES.has(tipo);
}

/**
 * Percorre o documento em ordem e devolve os nós de texto com a posição onde cada um começa.
 *
 * É a base de tudo aqui: o texto concatenado destes pedaços é EXATAMENTE o que a IA lê.
 */
export function pedacosDeTexto(nos: readonly unknown[]): { pedacos: Pedaco[]; texto: string } {
  const pedacos: Pedaco[] = [];
  let texto = "";

  // ⚠️ O SEPARADOR SÓ ENTRA QUANDO VEM TEXTO DEPOIS. Emiti-lo assim que um bloco fecha deixaria um
  // "\n" pendurado no fim do documento, e outro entre cada parágrafo vazio — o texto que a IA lê
  // ficaria diferente do que a tela mostra. Aqui o bloco fechado só ANOTA que precisa separar; quem
  // paga a conta é o próximo texto de verdade.
  let precisaSeparar = false;
  let jaTeveTexto = false;

  const andar = (lista: readonly unknown[], caminhoPai: number[]) => {
    for (const [indice, no] of lista.entries()) {
      const caminho = [...caminhoPai, indice];

      if (ehTexto(no)) {
        if (no.text !== "" && precisaSeparar && jaTeveTexto) {
          pedacos.push({ caminho: [], inicio: texto.length, texto: "\n", virtual: true });
          texto += "\n";
          precisaSeparar = false;
        }
        // Texto vazio (o filho obrigatório de um void, por exemplo) continua no mapa: o Slate
        // precisa dele como destino de seleção.
        pedacos.push({ caminho, inicio: texto.length, texto: no.text });
        texto += no.text;
        if (no.text !== "") jaTeveTexto = true;
        continue;
      }

      andar(filhos(no), caminho);
      if (!ehInline(no)) precisaSeparar = true;
    }
  };

  andar(nos, []);
  return { pedacos, texto };
}

/**
 * De um offset no texto concatenado para (caminho, posição dentro do nó).
 *
 * ⚠️ O LIMITE ENTRE DOIS NÓS É AMBÍGUO, e início e fim querem lados opostos dele. Com "Eu, " seguido
 * de "JOÃO", o offset 4 é ao mesmo tempo "o fim do primeiro" e "o começo do segundo" — a mesma
 * posição na tela, dois pontos diferentes para o Slate. Uma seleção que COMEÇA ali tem de começar no
 * segundo nó (senão ela abrange zero caracteres do primeiro e o editor a normaliza de um jeito que
 * não é o esperado); uma que TERMINA ali tem de terminar no primeiro.
 */
function pontoDoOffset(
  pedacos: Pedaco[],
  offset: number,
  lado: "fim" | "inicio",
): null | PontoNoDocumento {
  for (const [indice, p] of pedacos.entries()) {
    const fim = p.inicio + p.texto.length;
    const dentro =
      lado === "inicio"
        ? offset >= p.inicio && offset < fim
        : offset > p.inicio && offset <= fim;
    if (!dentro) continue;

    // ⚠️ O SEPARADOR NÃO É UM LUGAR. Ele não existe no documento: um ponto que caia nele é dobrado
    // para o vizinho real do lado certo — o fim do parágrafo anterior, ou o começo do próximo.
    if (p.virtual) {
      if (lado === "fim") {
        const anterior = [...pedacos.slice(0, indice)].reverse().find((x) => !x.virtual);
        return anterior ? { offset: anterior.texto.length, path: anterior.caminho } : null;
      }
      const seguinte = pedacos.slice(indice + 1).find((x) => !x.virtual);
      return seguinte ? { offset: 0, path: seguinte.caminho } : null;
    }

    return { offset: offset - p.inicio, path: p.caminho };
  }

  // Nenhum pedaço "contém" o offset: ele está no extremo do documento (começo com tudo vazio, ou o
  // fim exato do último nó). Cai no pedaço da ponta, que é a única posição possível.
  const reais = pedacos.filter((p) => !p.virtual);
  const ponta = lado === "inicio" ? reais[0] : reais.at(-1);
  if (!ponta) return null;
  const fim = ponta.inicio + ponta.texto.length;
  if (offset < ponta.inicio || offset > fim) return null;
  return { offset: offset - ponta.inicio, path: ponta.caminho };
}

/**
 * A faixa do trecho dentro do documento, ou null.
 *
 * ⚠️ NULL QUANDO O TRECHO SE REPETE. Se aparece mais de uma vez, não há como saber qual é — e marcar
 * a primeira ocorrência é como o CPF viraria número de quadra. A rota já recusa trecho ambíguo antes
 * de chegar aqui; esta é a segunda barreira, para o caso de o documento ter mudado desde a proposta.
 *
 * ⚠️ A BUSCA É TOLERANTE A FORMA (espaço duro, espaço dobrado, aspas curvas), e só a ela — ver
 * `lib/temis/casar-trecho.ts`. É a MESMA função que a rota usa para triar, e isso não é coincidência:
 * se as duas divergissem, a rota mostraria propostas que o clique não conseguiria aplicar.
 *
 * ⚠️ O `contexto` DESAMBIGUA SEM ALARGAR. Numa minuta de lacunas ("inscrito no CPF sob o n.º
 * ________________"), o trecho a trocar aparece dezenas de vezes; o contexto diz QUAL delas, e a
 * substituição continua sendo só da lacuna.
 */
export function faixaDoTrecho(
  nos: readonly unknown[],
  trecho: string,
  contexto?: string,
): FaixaNoDocumento | null {
  if (!trecho) return null;

  const { pedacos, texto } = pedacosDeTexto(nos);
  const achado = casarTrecho(texto, trecho, contexto);
  if (achado.situacao !== "achou") return null;

  const inicio = pontoDoOffset(pedacos, achado.casamento.inicio, "inicio");
  const fim = pontoDoOffset(pedacos, achado.casamento.fim, "fim");
  if (!inicio || !fim) return null;

  return { fim, inicio };
}

/** O texto do documento, como a IA vai lê-lo. */
export function textoDoDocumento(nos: readonly unknown[]): string {
  return pedacosDeTexto(nos).texto;
}
