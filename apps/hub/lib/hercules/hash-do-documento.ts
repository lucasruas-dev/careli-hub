// O HASH DO DOCUMENTO DO COMPRADOR — só servidor.
//
// ⚠️ SEPARADO DE `documento-do-comprador.ts` DE PROPÓSITO. `hashIdentifier` mora em
// `lib/apolo/server.ts`, que arrasta `lib/guardian/db.ts` e o mysql2 do legado: uma tela que
// importasse dali levaria o driver de MySQL para o bundle do navegador, e
// `lib/cliente-sem-mysql.varredura.test.ts` recusa. O vocabulário (tipo, rótulo, máscara, nome do
// namespace) fica lá, onde a tela pode ler; a conta fica aqui.

import { hashIdentifier } from "@/lib/apolo/server";

import { namespaceDoHash, soDigitosDoDocumento, tipoDePessoa } from "./documento-do-comprador";

/**
 * O documento do comprador como o Apolo o guarda: HASH, nunca texto.
 *
 * `null` quando não há documento de comprador para hashear.
 *
 * ⚠️ UMA PEÇA SÓ DECIDE O NAMESPACE, e é por isso que esta função mora aqui e não em cada rota.
 * Até 26/09/2026 três lugares do caminho da venda faziam
 * `digitos.length >= 11 ? hashIdentifier("cpf", digitos) : null`: o `>= 11` DEIXAVA o CNPJ passar,
 * o hash saía no namespace errado e o documento anexado numa venda de PJ desaparecia da ficha do
 * cliente, sem erro nenhum no log.
 *
 * ⚠️ ACEITA DOCUMENTO QUE NÃO FECHA O DÍGITO VERIFICADOR, de propósito: aqui não se valida nada,
 * só se calcula a chave do que JÁ existe no banco (a carga do C2X tem documento torto). A porta de
 * entrada é `documentoDeCompradorValido`, na régua da reserva e da proposta.
 */
export function hashDoDocumentoDoComprador(bruto: null | string): null | string {
  const digitos = soDigitosDoDocumento(bruto);
  if (tipoDePessoa(digitos) === null) return null;
  return hashIdentifier(namespaceDoHash(digitos), digitos);
}
