// O QUE A TELA PRECISA SABER SOBRE DOCUMENTOS DO LSOFT — e nada além disso.
//
// ⚠️ ESTE ARQUIVO EXISTE PARA NÃO ARRASTAR O SERVIDOR PARA O NAVEGADOR. O módulo irmão
// (`documentos.ts`) importa `createApoloAdminClient`, que carrega a service role do Supabase;
// um componente client que importasse dali só para pegar o teto de tamanho puxaria a árvore
// inteira do servidor para o bundle. Aqui não há import nenhum, de propósito: são constantes e
// um tipo.

/** Teto por arquivo. O mesmo do Apolo, para o usuário não ter duas regras na cabeça. */
export const LSOFT_DOC_MAX_BYTES = 20 * 1024 * 1024;
export const LSOFT_DOC_MAX_LABEL = "20MB";

/**
 * Categorias sugeridas na tela.
 *
 * ⚠️ SUGESTÃO, NÃO VALIDAÇÃO. O CER está organizando uma base antiga e vai aparecer documento que
 * não cabe numa lista fechada; recusar o que não está aqui faria a pessoa desistir de anexar, que
 * é o oposto do que esta aba existe para conseguir.
 */
export const CATEGORIAS_SUGERIDAS = [
  "RG",
  "CPF",
  "Comprovante de endereço",
  "Comprovante de renda",
  "Certidão de casamento",
  "Contrato",
  "Ficha do LSoft",
  "Outros",
] as const;

export type DocumentoDoLsoft = {
  categoria: null | string;
  criadoEm: string;
  /** "interno" (time da Careli) ou "incorporador" (portal do CER). */
  enviadoOrigem: string;
  enviadoPor: string;
  id: string;
  mimeType: null | string;
  nomeArquivo: string;
  observacao: null | string;
  tamanhoBytes: null | number;
};
