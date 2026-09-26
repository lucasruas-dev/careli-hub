// O DOCUMENTO DO COMPRADOR — a peça única que diz se é pessoa física ou pessoa jurídica.
//
// Lucas (26/09/2026): *"na hora da reserva, dentro do hercules, temos que habilitar pessoa fisica e
// pessoa juridica, hoje só atende pessoa fisica, olha isso por favor"*.
//
// ⚠️ O DOCUMENTO DECIDE O TIPO. Não um seletor na tela, não um `entity_kind` do cadastro: o
// documento. Essa não é uma opinião nova — é o que o CONTRATO já faz em
// `lib/temis/dados-do-contrato.ts:1739-1744`, e o comentário de :1726-1737 registra o motivo
// MEDIDO em 08/09/2026: SEIS ENTIDADES `entity_kind = 'pj'` carregavam CPF no cadastro. Confiar no
// campo declarado imprimia qualificação de empresa em cima de uma pessoa física.
//
// ⚠️ ESTA É A ÚNICA CASA DOS IFS DE 11 E 14 DÍGITOS NO CAMINHO DA VENDA. Antes deste lote a
// pergunta "é PF ou PJ?" estava respondida em nove lugares, cada um com o seu if de tamanho, e três
// deles erravam em silêncio: `hashIdentifier("cpf", ...)` com um CNPJ dentro gera uma chave que
// JAMAIS casa com a CAD da empresa (o hash é `apolo-identifier:TIPO:valor`), e o documento anexado
// desaparece da ficha do cliente sem erro nenhum no log. A varredura de
// `documento-do-comprador.varredura.test.ts` é quem impede a nona casa de voltar.
//
// ⚠️ NÃO TOCA BANCO NEM GATEWAY, E A TELA IMPORTA DAQUI. É vocabulário: tipo, validade, rótulo,
// máscara e o NOME do namespace do hash. O hash em si mora em `hash-do-documento.ts`, porque
// calculá-lo exige `lib/apolo/server.ts`, que arrasta o mysql2 do legado para o bundle do
// navegador — `lib/cliente-sem-mysql.varredura.test.ts` é quem cobra isso.

import { cnpjValido, cpfValido, soDigitos, tipoDoDocumento } from "@/lib/apolo/documento";

export type TipoDePessoa = "pf" | "pj";

/**
 * Pessoa física ou pessoa jurídica, pelo documento.
 *
 * ⚠️ O DÍGITO VERIFICADOR MANDA, E O TAMANHO É A REDE. Decidir só pelo tamanho erraria num
 * documento de 14 dígitos que não é CNPJ; devolver `null` quando o DV não fecha faria a tela
 * escrever "CPF" em cima de um CNPJ que o banco JÁ GUARDA (medido em 26/09/2026: 136 propostas de
 * `hercules_propostas` têm `cliente_documento` com 14 dígitos, todas vindas da carga do C2X, e uma
 * delas tem 12). Para EXIBIR, o tamanho basta; para ACEITAR, ver `documentoDeCompradorValido`.
 */
export function tipoDePessoa(documento: null | string): null | TipoDePessoa {
  const tipo = tipoDoDocumento(String(documento ?? ""));
  if (tipo === "cpf") return "pf";
  if (tipo === "cnpj") return "pj";

  const digitos = soDigitos(String(documento ?? ""));
  if (digitos.length === 11) return "pf";
  if (digitos.length === 14) return "pj";
  return null;
}

/**
 * Este documento pode entrar numa reserva ou numa proposta?
 *
 * ⚠️ É AQUI QUE A PORTA CONTINUA APERTADA. Habilitar PJ é aceitar CNPJ, não é aceitar qualquer
 * número: o dígito verificador é o que impede um documento digitado errado de virar dono de lote e,
 * depois, parte de um contrato.
 */
export function documentoDeCompradorValido(documento: null | string): boolean {
  const valor = String(documento ?? "");
  return cpfValido(valor) || cnpjValido(valor);
}

/** Como o documento se chama na frase que sai para gente. */
export function rotuloDoDocumento(documento: null | string): "CNPJ" | "CPF" | "Documento" {
  const tipo = tipoDePessoa(documento);
  if (tipo === "pf") return "CPF";
  if (tipo === "pj") return "CNPJ";
  return "Documento";
}

/**
 * O suficiente para conferir, insuficiente para vazar.
 *
 * `***.982.247-**` para CPF e `**.345.678/0001-**` para CNPJ.
 *
 * ⚠️ O CNPJ TAMBÉM VAI MASCARADO. Ele é dado público na Receita, mas as mensagens da reserva e da
 * proposta circulam em GRUPO DE WHATSAPP e mensagem enviada não volta: manter o mesmo grau de
 * cuidado custa nada e evita a conversa de por que um documento saiu inteiro e o outro não. A raiz
 * e a filial ficam legíveis, que é o que o corretor usa para reconhecer a empresa do cliente dele.
 *
 * ⚠️ O RAMO DE SOBRA (`***4567`) NÃO MUDOU. Ele existe porque o banco tem documento de tamanho
 * inesperado, e `lib/hercules/reserva.test.ts` o cobre desde 03/09/2026.
 */
export function mascararDocumento(documento: null | string): string {
  const so = soDigitos(String(documento ?? ""));
  if (so.length === 11) return `***.${so.slice(3, 6)}.${so.slice(6, 9)}-**`;
  if (so.length === 14) return `**.${so.slice(2, 5)}.${so.slice(5, 8)}/${so.slice(8, 12)}-**`;
  return so.length > 4 ? `***${so.slice(-4)}` : "documento";
}

/**
 * O namespace com que este documento é hasheado no Apolo.
 *
 * ⚠️ O TIPO ESTÁ DENTRO DO HASH. `hashIdentifier` (lib/apolo/server.ts:5273) concatena
 * `apolo-identifier:TIPO:valor`: um CNPJ hasheado como "cpf" gera uma chave que não existe em lugar
 * nenhum do banco. MEDIDO em 26/09/2026 (produção, só SELECT): as 11 CADs de entidade `pj` da
 * esteira têm identificador `cnpj` cujo `value_hash` é igual ao `document_hash` da entidade em 11 de
 * 11 casos, e ZERO delas casa com um hash de namespace `cpf`.
 *
 * ⚠️ O PASSADO FICA COMO ESTÁ. Para 11 dígitos a resposta continua sendo "cpf", byte por byte: as
 * linhas já gravadas continuam achando o que sempre acharam. Este lote não faz backfill nenhum.
 */
export function namespaceDoHash(documento: null | string): "cnpj" | "cpf" {
  return tipoDePessoa(documento) === "pj" ? "cnpj" : "cpf";
}

/** Só os dígitos, com a mesma normalização que o resto da peça usa. */
export function soDigitosDoDocumento(documento: null | string): string {
  return soDigitos(String(documento ?? ""));
}
