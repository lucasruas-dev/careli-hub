// O PROPONENTE DA RESERVA — o leitor único do jsonb `hercules_reservas.proponentes`.
//
// Lucas (26/09/2026): *"na hora da reserva, dentro do hercules, temos que habilitar pessoa fisica e
// pessoa juridica, hoje só atende pessoa fisica"*.
//
// ⚠️ A CHAVE NOVA É `documento`, E ELA NÃO É INVENÇÃO. MEDIDO em 26/09/2026 (produção, só SELECT):
// `hercules_propostas.compradores` já usa a chave `documento` em 4.889 itens de titular vindos da
// carga do C2X — e é exatamente ela que as 137 linhas de documento com 14 dígitos usam. A forma
// NATIVA (a que a tela grava) usa `cpf` em 23 itens, todos de 11 dígitos. Ou seja: `documento` é o
// vocabulário que a casa já usa justamente onde PJ existe.
//
// ⚠️ E A FORMA ANTIGA CONTINUA SENDO LIDA. MEDIDO: as 30 reservas de `hercules_reservas` têm SÓ TRÊS
// CHAVES em 30 de 30 (`cpf`, `nome`, `telefone`) e todos os 30 titulares têm 11 dígitos. Nenhuma
// delas pode parar de funcionar, e este lote não escreve uma linha de UPDATE em dado antigo: quem
// concilia as duas formas é este leitor.
//
// ⚠️ O TIPO SAI DO DOCUMENTO, NUNCA DE UM CAMPO GRAVADO — o mesmo motivo pelo qual o contrato ignora
// o `entity_kind` (ver `documento-do-comprador.ts`).
//
// ⚠️ UM LEITOR, E NÃO TRÊS. Antes deste lote a mesma leitura estava escrita em
// `lib/hercules/reserva.ts` (a linha do fluxo de venda), em
// `app/api/incorporador/venda/proposta/route.ts` (o titular que decide se a proposta nasce) e em
// `app/api/incorporador/venda/cliente/route.ts` (o card Cliente da ficha), cada uma com nome
// diferente e nenhuma enxergando `documento`.

import { tipoDePessoa, type TipoDePessoa } from "./documento-do-comprador";

/** Quem vai comprar, como o jsonb o guarda depois de conciliado. */
export type ProponenteLido = {
  documento: string;
  nome: string;
  telefone: string;
  tipoPessoa: TipoDePessoa;
};

/**
 * Um item de `hercules_reservas.proponentes`, seja na forma antiga (`cpf`) ou na nova (`documento`).
 *
 * ⚠️ PROPONENTE SÓ COM NOME NÃO É `null`. Existe reserva gravada sem documento, e
 * `app/api/incorporador/venda/proposta/route.ts` usa `null` para dizer "esta reserva está sem o
 * cliente titular. Cancele e reserve de novo" (409). Devolver `null` aqui faria uma reserva boa
 * passar a receber essa frase, e a unidade ficaria travada por uma linha que ninguém destrava.
 */
export function lerProponente(bruto: unknown): null | ProponenteLido {
  if (!bruto || typeof bruto !== "object" || Array.isArray(bruto)) return null;
  const p = bruto as Record<string, unknown>;

  // `documento` ganha de `cpf`: quem grava a chave nova é a rota de hoje, e ela é a mais específica.
  const documento =
    typeof p.documento === "string" && p.documento
      ? p.documento
      : typeof p.cpf === "string"
        ? p.cpf
        : "";
  const nome = typeof p.nome === "string" ? p.nome.trim() : "";
  const telefone = typeof p.telefone === "string" ? p.telefone : "";

  if (!documento && !nome) return null;

  return {
    documento,
    nome,
    telefone,
    // Sem documento não há o que deduzir, e a casa inteira é de pessoa física: `pf` é o padrão que
    // mantém a frase e o rótulo iguais ao que sempre foram nas 30 reservas vivas.
    tipoPessoa: tipoDePessoa(documento) ?? "pf",
  };
}

/** O primeiro proponente é o titular — o nome que a lista, a ficha e a proposta mostram. */
export function titularDosProponentes(proponentes: unknown): null | ProponenteLido {
  const lista = Array.isArray(proponentes) ? proponentes : [];
  return lerProponente(lista[0]);
}
