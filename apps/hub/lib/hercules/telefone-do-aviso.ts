// PARA QUAL NÚMERO O AVISO DA VENDA VAI.
//
// ⚠️ ISTO É UM MÓDULO SEPARADO PORQUE É CONTA, E CONTA SE TESTA. `avisos-da-venda.ts` conversa com
// o Supabase e com o gateway do WhatsApp; a decisão de qual contato de uma pessoa recebe a mensagem
// é pura, e foi justamente ela que estava errada em produção sem ninguém ver.
//
// ⚠️ O DEFEITO QUE ISTO CONSERTA, MEDIDO NO BANCO. Nas cinco reservas já disparadas, corretor e
// coordenador receberam e a imobiliária falhou nas CINCO, sempre com "sem telefone": a RAIANE
// IMOBILIARIA tem contato cadastrado como `whatsapp` e `email`, e nunca teve `phone` — e a consulta
// filtrava `contact_type = 'phone'` e só isso. Das 5.745 entidades com algum contato, 3.941 têm
// APENAS `whatsapp`: 69% invisíveis para um disparo que sai justamente por WhatsApp.

export type ContatoDoAviso = {
  contact_type: string;
  entity_id: string;
  is_primary: boolean | null;
  value: null | string;
};

/** Os tipos de contato que servem de destino, para a consulta pedir os dois. */
export const TIPOS_DE_CONTATO_DO_AVISO = ["whatsapp", "phone"] as const;

/**
 * A força de um contato como destino de WhatsApp. Maior ganha.
 *
 * ⚠️ `whatsapp` VENCE `phone` MESMO SENDO SECUNDÁRIO. Quem cadastrou os dois declarou qual deles
 * recebe mensagem; o `phone` pode ser um fixo, que o gateway aceita e nunca entrega. Entre dois do
 * mesmo tipo, o primário desempata.
 */
export function forcaDoContato(c: Pick<ContatoDoAviso, "contact_type" | "is_primary">): number {
  return (c.contact_type === "whatsapp" ? 2 : 0) + (c.is_primary === true ? 1 : 0);
}

/**
 * O número escolhido por entidade.
 *
 * ⚠️ VALOR VAZIO NÃO VIRA DESTINATÁRIO. Um contato em branco escolhido como destino manda a
 * mensagem para lugar nenhum e ainda esconde o número bom que viria depois na mesma lista.
 */
export function telefonesPorEntidade(contatos: ContatoDoAviso[]): Map<string, string> {
  const escolhido = new Map<string, string>();
  const forca = new Map<string, number>();

  for (const c of contatos) {
    const valor = (c.value ?? "").trim();
    if (!valor) continue;
    const f = forcaDoContato(c);
    if (!escolhido.has(c.entity_id) || f > (forca.get(c.entity_id) ?? -1)) {
      escolhido.set(c.entity_id, valor);
      forca.set(c.entity_id, f);
    }
  }

  return escolhido;
}
