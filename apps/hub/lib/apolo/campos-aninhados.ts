/**
 * Converte campos com CAMINHO (`socios.0.telefone`) no array completo que o servidor sabe gravar.
 *
 * ⚠️ POR QUE ISTO EXISTE: a ficha grava chave→valor num objeto plano, mas sócio e corretor moram
 * dentro de arrays. Sem chave, o campo nasce só de leitura — era por isso que o telefone do
 * representante legal da imobiliária não podia ser corrigido. E mandar a chave com ponto seria
 * pior: o servidor criaria um campo literal chamado "socios.0.telefone" ao lado do array de
 * verdade, a tela seguiria mostrando o telefone velho, e o operador teria visto "salvo".
 *
 * Parte SEMPRE do array atual e altera só o que foi digitado, então quem ninguém tocou continua
 * idêntico — inclusive as chaves que a tela nem exibe.
 */
export function expandirCamposComCaminho(
  campos: Record<string, unknown>,
  cadastro: Record<string, unknown>,
): Record<string, unknown> {
  const saida: Record<string, unknown> = { ...campos };

  for (const chave of Object.keys(campos)) {
    if (!chave.includes(".")) continue;

    const [raiz, indice, ...resto] = chave.split(".");
    if (!raiz || !indice || resto.length === 0) continue;

    const base = cadastro[raiz];
    if (!Array.isArray(base)) continue;

    // Índice que não existe é DESCARTADO, não repassado: deixar a chave passar faria o servidor
    // gravar um campo literal chamado "socios.9.telefone" no cadastro. E também não inventa
    // sócio — o array só tem quem o cadastro declarou.
    const posicao = Number(indice);
    if (!Number.isInteger(posicao) || posicao < 0 || posicao >= base.length) {
      delete saida[chave];
      continue;
    }

    // Da segunda chave do mesmo array em diante, continua no array já em construção — senão o
    // segundo campo do sócio recomeçaria do original e apagaria o primeiro.
    const lista = Array.isArray(saida[raiz])
      ? (saida[raiz] as Record<string, unknown>[])
      : base.map((item) => ({ ...(item as Record<string, unknown>) }));

    const alvo = lista[posicao];
    if (alvo) {
      const [primeiro, segundo] = resto as [string, string | undefined];
      if (segundo === undefined) {
        alvo[primeiro] = campos[chave];
      } else {
        // um nível a mais: o endereço do sócio (`socios.0.endereco.cep`)
        const aninhado = { ...((alvo[primeiro] ?? {}) as Record<string, unknown>) };
        aninhado[segundo] = campos[chave];
        alvo[primeiro] = aninhado;
      }
    }

    saida[raiz] = lista;
    delete saida[chave];
  }

  return saida;
}
