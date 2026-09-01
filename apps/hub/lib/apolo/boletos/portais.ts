// QUAIS CARTEIRAS DE BOLETO CADA PORTAL DE INCORPORADOR ENXERGA.
//
// Pedido do Lucas (01/09/2026): *"essa tela vai somente no perfil da CER e Cecilio"*, com o print
// dos dois portais, e logo depois: *"vamos fazer o CER primeiro, depois fazermos as demais"*.
//
// ⚠️ LISTA EXPLÍCITA, E NÃO O VÍNCULO DE `apolo_incorporador_empreendimentos`. É o vínculo que
// recorta todas as outras leituras do portal, mas ele não serve aqui: nenhum destes nove
// empreendimentos existe no Panteon — *"não tem empreendimento para essas empresas ainda dentro o
// panteon"* (Lucas, 01/09/2026). Sem cadastro não há vínculo, e um escopo que consulta uma tabela
// vazia não devolve "nada": devolve o que o código de fallback resolver, e num portal externo isso
// é a carteira de outra empresa aberta para quem não deveria ver.
//
// ⚠️ AS NOVE CARTEIRAS ENTRARAM POR DECISÃO EXPLÍCITA, e em duas etapas. Primeiro só os quatro
// edifícios da CER (*"vamos fazer o CER primeiro"*, 01/09/2026), porque eram os únicos cujo dono
// estava provado — o print que o Lucas mandou dizia "EDIFICIO JADE - CER" e os quatro dividem uma
// conta. Garden, Vale do Sol, On Sky, Guaimbé e Giant Towers ficaram de fora até ele autorizar:
// *"pode subir os demais empreendimentos que vamos fazer"* (01/09/2026), na mesma mensagem em que
// pediu os nomes das variáveis das outras contas.
//
// ⚠️ NÃO ACRESCENTE CARTEIRA POR SEMELHANÇA. Cada linha aqui é uma cobrança que um portal externo
// passa a poder criar em nome de uma empresa. Mostrar a carteira errada num portal é vazamento;
// deixar emitir nela é dívida no CNPJ de outro.
const TODAS_AS_CARTEIRAS = [
  "ed-jade",
  "ed-rubi",
  "ed-cristal",
  "ed-esmeralda",
  "garden",
  "vale-do-sol",
  "on-sky",
  "guaimbe",
  "giant-towers",
  // ⚠️ AS CARTEIRAS DE TESTE, uma por conta do Asaas (ver `empreendimentos.ts`). O Lucas as mantém
  // para validar cada chave antes do primeiro envio real: *"quero testar todas as contas antes de
  // enviar"* (01/09/2026). Saem juntas quando servirem.
  "teste",
  "teste-garden",
  "teste-vale-do-sol",
  "teste-on-sky",
  "teste-guaimbe",
  "teste-giant-towers",
];

const CARTEIRAS_DO_PORTAL: Record<string, string[]> = {
  cer: TODAS_AS_CARTEIRAS,
  "cecilio-rocha": TODAS_AS_CARTEIRAS,
};

/** Os empreendimentos de boleto que este portal pode ver e emitir. Vazio = não tem a aba. */
export function carteirasDoPortal(slug: null | string | undefined): string[] {
  return CARTEIRAS_DO_PORTAL[String(slug ?? "").trim().toLowerCase()] ?? [];
}

/** O portal tem a aba de boletos? */
export function portalEmiteBoletos(slug: null | string | undefined): boolean {
  return carteirasDoPortal(slug).length > 0;
}

/**
 * O portal pode mexer neste empreendimento?
 *
 * ⚠️ CHECADO A CADA CHAMADA, e não só na hora de montar a aba. A aba some da tela, mas a rota
 * continua no ar: quem souber o endereço emitiria boleto na carteira do vizinho.
 */
export function portalPodeEmitir(slug: null | string | undefined, empreendimento: string): boolean {
  return carteirasDoPortal(slug).includes(String(empreendimento ?? "").trim().toLowerCase());
}
