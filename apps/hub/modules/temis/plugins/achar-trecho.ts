// ONDE O TRECHO ESTÁ, DENTRO DOS NÓS — a ponte entre o que a IA leu e o documento do editor.
//
// O super agente da minuta (`/api/temis/minutas/marcar`) recebe o TEXTO PURO e devolve pares
// {trecho, variável}. Mas a marcação tem de acontecer no DOCUMENTO, não no texto: aplicar no texto e
// reconstruir o documento perderia negrito, tabela, alinhamento e quebra de cláusula — tudo o que o
// jurídico ajustou.
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

/** Um nó de texto do documento e onde ele fica. */
type Pedaco = {
  caminho: number[];
  /** Onde o texto deste nó começa, no texto concatenado do documento. */
  inicio: number;
  texto: string;
};

export type PontoNoDocumento = { offset: number; path: number[] };
export type FaixaNoDocumento = { fim: PontoNoDocumento; inicio: PontoNoDocumento };

function ehTexto(no: unknown): no is { text: string } {
  return typeof no === "object" && no !== null && typeof (no as { text?: unknown }).text === "string";
}

function filhos(no: unknown): unknown[] {
  const c = (no as { children?: unknown })?.children;
  return Array.isArray(c) ? c : [];
}

/**
 * Percorre o documento em ordem e devolve os nós de texto com a posição onde cada um começa.
 *
 * É a base de tudo aqui: o texto concatenado destes pedaços é EXATAMENTE o que a IA leu.
 */
export function pedacosDeTexto(nos: readonly unknown[]): { pedacos: Pedaco[]; texto: string } {
  const pedacos: Pedaco[] = [];
  let texto = "";

  const andar = (lista: readonly unknown[], caminhoPai: number[]) => {
    for (const [indice, no] of lista.entries()) {
      const caminho = [...caminhoPai, indice];
      if (ehTexto(no)) {
        pedacos.push({ caminho, inicio: texto.length, texto: no.text });
        texto += no.text;
        continue;
      }
      andar(filhos(no), caminho);
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
  for (const p of pedacos) {
    const fim = p.inicio + p.texto.length;
    const dentro =
      lado === "inicio"
        ? offset >= p.inicio && offset < fim
        : offset > p.inicio && offset <= fim;
    if (dentro) return { offset: offset - p.inicio, path: p.caminho };
  }

  // Nenhum pedaço "contém" o offset: ele está no extremo do documento (começo com tudo vazio, ou o
  // fim exato do último nó). Cai no pedaço da ponta, que é a única posição possível.
  const ponta = lado === "inicio" ? pedacos[0] : pedacos.at(-1);
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
 */
export function faixaDoTrecho(
  nos: readonly unknown[],
  trecho: string,
): FaixaNoDocumento | null {
  if (!trecho) return null;

  const { pedacos, texto } = pedacosDeTexto(nos);
  const primeira = texto.indexOf(trecho);
  if (primeira < 0) return null;
  if (texto.indexOf(trecho, primeira + 1) >= 0) return null;

  const inicio = pontoDoOffset(pedacos, primeira, "inicio");
  const fim = pontoDoOffset(pedacos, primeira + trecho.length, "fim");
  if (!inicio || !fim) return null;

  return { fim, inicio };
}

/** O texto do documento, como a IA vai lê-lo. */
export function textoDoDocumento(nos: readonly unknown[]): string {
  return pedacosDeTexto(nos).texto;
}
