// O cadastro VALENDO de uma entidade: `metadata.cadastro` com `metadata.cadastroEditado` por cima.
//
// ⚠️ POR QUE ISTO EXISTE (incidente de 15/08/2026, Beatriz Teodora de Araujo): a edição da ficha
// da imobiliária grava numa camada própria, `cadastroEditado`, para que a correção humana não seja
// encoberta pelo C2X ao vivo na leitura da tela. Só que TODO O RESTO do sistema continuou lendo
// `metadata.cadastro` direto — inclusive `representanteDaImobiliaria`, que escolhe o telefone do
// disparo. Resultado: o Lucas corrigiu o telefone do representante, a tela passou a mostrar o
// número novo, e a mensagem de indeferimento saiu duas vezes para o número ANTIGO, que nem existe
// no WhatsApp. A tela dizia uma coisa e o disparo fazia outra — exatamente o desenho que a camada
// nova deveria ter evitado.
//
// Quem lê ficha para DECIDIR ou ENVIAR alguma coisa tem que passar por aqui.

type MetadataDeEntidade = null | {
  cadastro?: unknown;
  cadastroEditado?: unknown;
};

function objeto(valor: unknown): Record<string, unknown> {
  return typeof valor === "object" && valor !== null && !Array.isArray(valor)
    ? (valor as Record<string, unknown>)
    : {};
}

/**
 * Mescla as duas camadas. A edição humana ganha CAMPO A CAMPO, e não substitui o cadastro inteiro:
 * quem corrigiu só o telefone não pode perder o resto da ficha.
 *
 * Arrays (`socios`, `corretores`) são substituídos por inteiro quando editados, porque é assim que
 * a tela os grava — ela reenvia a lista completa já corrigida.
 */
export function cadastroEfetivo(metadata: MetadataDeEntidade): Record<string, unknown> {
  return { ...objeto(metadata?.cadastro), ...objeto(metadata?.cadastroEditado) };
}
