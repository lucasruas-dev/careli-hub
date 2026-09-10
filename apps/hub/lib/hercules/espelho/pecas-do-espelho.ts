// ONDE MORAM AS PEÇAS DO ESPELHO — os caminhos dos derivados no bucket, num lugar só.
//
// O script `scripts/hercules/preparar-espelho.mts` GRAVA nestes caminhos e as rotas públicas LEEM
// deles. Um caminho montado à mão nos dois lados diverge no dia em que alguém mudar um; aqui há
// uma função e dois usos.
//
// ⚠️ O BUCKET É PRIVADO. `apolo-documents` não responde a leitura anônima — o que é certo, porque
// ele guarda documento de cliente. As rotas públicas do espelho leem com credencial de servidor e
// devolvem os bytes; nunca devolvem uma URL do storage, assinada ou não.

/** O bucket dos documentos do Apolo, onde os masterplans já vivem. */
export const BUCKET_DO_ESPELHO = "apolo-documents";

const PREFIXO = "hercules-masterplans";

/**
 * ⚠️ A VERSÃO ESTÁ NO CAMINHO, E É ISSO QUE TORNA O CACHE SEGURO. Publicar um masterplan novo
 * gera `v2`, com caminho novo — então a arte e a geometria podem ser servidas como `immutable`
 * por um ano sem nunca servir mapa velho. Sem a versão no caminho, um cache longo prenderia o
 * cliente no desenho antigo e a única saída seria trocar de URL na mão.
 */
export function caminhoDaArte(codigo: string, versao: number): string {
  return `${PREFIXO}/${codigo.toUpperCase()}/v${versao}-arte.webp`;
}

export function caminhoDaGeometria(codigo: string, versao: number): string {
  return `${PREFIXO}/${codigo.toUpperCase()}/v${versao}-geometria.json`;
}

/** O SVG original — a fonte que o preparo lê. Não é servido ao público. */
export function caminhoDoSvg(codigo: string, versao: number): string {
  return `${PREFIXO}/${codigo.toUpperCase()}/v${versao}.svg`;
}

/**
 * O `Cache-Control` das peças imutáveis.
 *
 * Um ano, `immutable`: o navegador nem revalida. É seguro porque a versão está no caminho.
 */
export const CACHE_IMUTAVEL = "public, max-age=31536000, immutable";

/**
 * ⚠️ E O DA SITUAÇÃO É `no-store`, SEM EXCEÇÃO. A rota de situação já teve cache de CDN no telão
 * do Prometeu (`s-maxage=10, stale-while-revalidate=30`) e a projeção mostrou lote VERDE depois
 * de reservado, por 40 segundos, na frente do salão — `cache: "no-store"` no fetch do navegador
 * não alcança a CDN. Aqui o estrago seria o mesmo: um cliente escolhendo lote que já tem dono.
 */
export const SEM_CACHE = "no-store";
