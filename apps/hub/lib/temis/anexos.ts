// OS ANEXOS E A CAPA DO CONTRATO — as constantes e as funções puras, sem servidor e sem React.
//
// Pedido do Lucas (13/09/2026): *"eu não vi onde vamos subir os anexos, a capa dos contratos, acho
// que isso não foi construído"* e, logo depois, *"tem que fazer o upload hoje / estamos montando os
// contratos hoje"*.
//
// O desenho é o de 07/09/2026: o contrato é CAPA + CORPO + ANEXOS, e só o corpo é texto. A tabela
// está na migration 0156; aqui ficam as regras que a tela e a rota compartilham.
//
// ⚠️ A POSIÇÃO É ESCOLHIDA, NUNCA A ORDEM DE UPLOAD. É a decisão do Lucas de 07/09: *"à medida que
// eu vou importando os anexos vai fazendo essa conta"*. Se a posição viesse da ordem de envio,
// anexar uma peça nova empurraria as outras, e toda minuta já publicada que diga `[anexo_2]`
// passaria a imprimir a peça errada — sem erro, sem log, sem ninguém perceber.
//
// ⚠️ E DESDE 21/09/2026 A POSIÇÃO É GLOBAL NA CADEIA, não por nível. Os anexos passaram a SOMAR os
// níveis (pai + divisão + categoria + unidade), e os índices da 0156 são por nível: o pai e a
// categoria podem, os dois, gravar a posição 1, e somando o `[anexo_1]` apontaria para dois
// arquivos. O banco não alcança essa regra — a hierarquia mora em `hercules_empreendimentos`, não
// na linha do anexo —, então quem a aplica é `somarAnexosDaCadeia`, recusando a montagem e
// nomeando as duas peças.
//
// ⚠️ SÓ PDF. As outras peças do contrato são texto; o anexo é página pronta que o montador costura
// no PDF final. Aceitar .docx ou imagem aqui empurraria a conversão para o montador, que é
// justamente onde ela fica cara e falha calada. Quem tem .docx converte antes.

/** O alcance de um anexo. Exatamente um por linha — o banco recusa o resto (0156). */
export type AlcanceDoAnexo =
  | { categoriaId: string; enterpriseId?: never; unidadeId?: never }
  | { enterpriseId: string; categoriaId?: never; unidadeId?: never }
  | { unidadeId: string; categoriaId?: never; enterpriseId?: never };

export type AnexoDoContrato = {
  arquivoBytes: null | number;
  arquivoNome: null | string;
  categoriaId: null | string;
  enterpriseId: null | string;
  id: string;
  nome: string;
  posicao: number;
  storagePath: string;
  unidadeId: null | string;
};

export const PREFIXO_ANEXO = "temis-anexos/";
export const PREFIXO_CAPA = "temis-capas/";

// Mesmo teto da mídia do editor ("deixa o padrão 20MB para documentos"). O servidor confere de novo
// com o tamanho REAL do objeto; a checagem do cliente é só para o arquivo grande nem sair daqui.
export const LIMITE_ANEXO_BYTES = 20 * 1024 * 1024;
export const LIMITE_ANEXO_ROTULO = "20MB";

/** ⚠️ 99 é sanidade de FORMATO, não teto de negócio: é o que `acharVariavel` lê de volta. */
export const POSICAO_MAXIMA = 99;

export const TIPO_DO_ANEXO = "application/pdf";

/** A capa pode ser PDF ou imagem: ela é desenhada fora (Canva) e exportada como um ou outro. */
export const TIPOS_DA_CAPA = ["application/pdf", "image/jpeg", "image/png"] as const;

export function posicaoValida(valor: unknown): valor is number {
  return (
    typeof valor === "number" &&
    Number.isInteger(valor) &&
    valor >= 1 &&
    valor <= POSICAO_MAXIMA
  );
}

/**
 * O nome do arquivo, domado para virar chave de objeto.
 *
 * ⚠️ MESMA REGRA DA MÍDIA DO EDITOR (`upload-midia.ts`): acento, espaço e barra no nome viram
 * caminho quebrado no Storage, e a barra em particular criaria pasta onde não devia.
 */
export function sanitizarNomeDeAnexo(nome: string): string {
  const limpo = String(nome ?? "")
    .normalize("NFD")
    .replaceAll(/[̀-ͯ]/g, "")
    .replaceAll(/[^A-Za-z0-9._-]+/g, "-")
    .replaceAll(/-{2,}/g, "-")
    .replace(/^[-.]+/, "")
    .slice(0, 120);
  return limpo || "anexo.pdf";
}

/** O caminho pertence ao prefixo dos anexos (ou das capas)? Trava de path traversal. */
export function caminhoDeAnexoValido(caminho: string): boolean {
  const p = String(caminho ?? "");
  if (p.includes("..") || p.startsWith("/")) return false;
  return p.startsWith(PREFIXO_ANEXO) || p.startsWith(PREFIXO_CAPA);
}

/**
 * O rótulo do alcance, para a tela dizer de onde o anexo vem sem o operador precisar decorar ids.
 *
 * ⚠️ ISTO NÃO É MAIS PRECEDÊNCIA, É PROCEDÊNCIA (21/09/2026). Até esta data o rótulo existia para
 * explicar que "unidade vence categoria, que vence empreendimento" — um nível só valia, e duas
 * peças na posição 2 não brigavam porque uma anulava a outra. O Lucas inverteu a regra: os anexos
 * dos níveis SOMAM (*"o contrato leva os anexos do pai MAIS os da divisão MAIS os da categoria"*).
 * Agora o rótulo serve para o operador saber de onde cada peça do PDF veio — e duas peças na mesma
 * posição BRIGAM, e a montagem recusa nomeando as duas. Ver `anexos-da-venda.ts`.
 *
 * ⚠️ A PRECEDÊNCIA CONTINUA VALENDO PARA A MINUTA, e só para ela: dois contratos não somam. Ver
 * `minuta-da-cadeia.ts`.
 */
export function rotuloDoAlcance(anexo: {
  categoriaId: null | string;
  enterpriseId: null | string;
  unidadeId: null | string;
}): string {
  if (anexo.unidadeId) return "Unidade";
  if (anexo.categoriaId) return "Categoria";
  return "Empreendimento";
}

/** As variáveis que uma lista de anexos oferece à minuta, na ordem da posição. */
export function nomesParaVariaveis(
  anexos: readonly { nome: string; posicao: number }[],
): string[] {
  return [...anexos]
    .sort((a, b) => a.posicao - b.posicao)
    .map((a) => a.nome);
}
