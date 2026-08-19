// QUAIS PORTAIS DE INCORPORADOR ENXERGAM A BASE DO LSOFT.
//
// Decisão do Lucas (19/08/2026): *"no portal personalizado da Cecílio, no CER é para ter, pois são
// eles que vão atualizar essa base para depois a gente subir"*.
//
// ⚠️ LISTA PRÓPRIA, E NÃO `ehPortalPersonalizado`. Existem DOIS portais do Cecílio no banco:
// `cecilio-rocha` (10/08, o personalizado e congelado, com a aba Produtos) e `cer` (18/08, o que
// ele usa hoje, que roda no PADRÃO). Amarrar esta aba ao "personalizado" deixaria o `cer` de fora
// — justamente o portal do pedido; amarrá-la ao padrão daria a aba a Vista Alegre e Lagoa Bonita,
// que não têm nada com a carteira do Garden.
//
// ⚠️ ESTA É A ÚNICA PORTA DE ESCRITA EXTERNA DO PANTEON. Até aqui o portal do incorporador era
// leitura pura; a base do LSoft é a primeira coisa que gente de fora da Careli altera. Por isso
// toda edição feita por aqui é gravada com `autor_origem: 'incorporador'`, e a lista é explícita:
// nenhum portal ganha escrita por consequência de refactor.
const PORTAIS_COM_BASE_LSOFT = new Set(["cecilio-rocha", "cer"]);

/** Este portal enxerga (e edita) a base do LSoft? */
export function portalVeBaseLsoft(slug: null | string | undefined): boolean {
  return PORTAIS_COM_BASE_LSOFT.has(String(slug ?? "").trim().toLowerCase());
}
