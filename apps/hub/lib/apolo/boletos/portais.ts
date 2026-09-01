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
// ⚠️ ENTRA AQUI SÓ O QUE FOI CONFIRMADO. Jade, Rubi, Cristal e Esmeralda são da CER — está no
// print que o Lucas mandou ("EDIFICIO JADE - CER") e na conta única que os quatro dividem. On Sky,
// Guaimbé e Giant Towers ficam de fora até alguém dizer de quem são: supor o dono de uma carteira
// e mostrá-la num portal externo é vazamento, e o silêncio custa menos que o palpite.
//
// ⚠️ GARDEN E VALE DO SOL TAMBÉM FICAM DE FORA, apesar de a base do LSoft da Cecílio ter os dois.
// Ali o portal LÊ e valida cadastro; aqui ele EMITE cobrança. São permissões diferentes e o Lucas
// pediu a CER primeiro — acrescentar carteira é uma linha, e é decisão dele, não consequência de
// eu ter achado parecido.
const CARTEIRAS_DO_PORTAL: Record<string, string[]> = {
  cer: ["ed-jade", "ed-rubi", "ed-cristal", "ed-esmeralda"],
  "cecilio-rocha": ["ed-jade", "ed-rubi", "ed-cristal", "ed-esmeralda"],
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
