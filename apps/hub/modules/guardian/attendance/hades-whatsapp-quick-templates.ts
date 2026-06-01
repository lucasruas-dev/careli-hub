export type HadesWhatsAppQuickTemplate = {
  id: string;
  title: string;
  body: string;
};

export const hadesWhatsAppQuickTemplates: HadesWhatsAppQuickTemplate[] = [
  {
    id: "friendly",
    title: "Cobrança amigável",
    body: "Olá, tudo bem? Identificamos parcelas em aberto e queremos ajudar a regularizar da forma mais confortável possível. Podemos avaliar juntos uma alternativa?",
  },
  {
    id: "due",
    title: "Lembrete de vencimento",
    body: "Passando para lembrar do vencimento combinado. Se precisar, posso reenviar o boleto original do C2X por aqui.",
  },
  {
    id: "boleto",
    title: "Enviar boleto C2X",
    body: "Estou enviando o boleto original do C2X para conferência e pagamento. O ideal é compensar até o vencimento informado.",
  },
  {
    id: "agreement",
    title: "Proposta de acordo",
    body: "Conseguimos simular uma composição com entrada reduzida e parcelamento do saldo vencido. Quer que eu formalize a proposta para sua análise?",
  },
  {
    id: "promise",
    title: "Confirmação de promessa",
    body: "Perfeito, vou registrar a promessa de pagamento para a data combinada e acompanhar a compensação. Qual valor você consegue confirmar?",
  },
  {
    id: "broken",
    title: "Quebra de promessa",
    body: "Não localizamos a compensação da promessa anterior. Podemos reagendar uma nova data ou montar um acordo mais aderente ao seu momento?",
  },
];
