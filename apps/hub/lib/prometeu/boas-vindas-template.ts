// Template Meta WhatsApp de BOAS-VINDAS no check-in do Prometeu. Centraliza nome, texto e o botão
// num lugar só (espelha lib/apolo/acao-template.ts). O disparo (boas-vindas-disparo.ts) e a rota de
// criação (app/api/prometeu/boas-vindas-template) leem daqui. Ver [[project_prometeu_tela_cliente]].

// Nome do template registrado na Meta.
export const NOME_TEMPLATE_BOAS_VINDAS = "prometeu_boas_vindas";

// Categoria: UTILITY (transacional — dispara no check-in). Mais barato e costuma aprovar mais
// rápido que MARKETING; a Meta confirma a categoria na revisão.
export const CATEGORIA_BOAS_VINDAS = "UTILITY";

// A base do botão URL. O `{{1}}` é o TOKEN assinado da fila (um por cliente), preenchido no envio.
export const URL_BASE_FILA = "https://c2x.app.br/publico/fila?t=";
export const TEXTO_BOTAO_FILA = "Acompanhar minha vez";

// Logo do HEADER (imagem). URL pública direta e leve; a Meta baixa por ela na criação e no envio.
export const URL_LOGO_HEADER = "https://c2x.app.br/c2x-logo.png";

// BODY. {{1}} = primeiro nome, {{2}} = lançamento, {{3}} = posição na fila. Termina em TEXTO real
// (a Meta recusa body que fecha numa {{n}}). Sem travessão; negrito com 1 asterisco.
export const TXT_BOAS_VINDAS =
  "Olá {{1}}! Você entrou na fila do lançamento *{{2}}*. Sua posição agora é a *{{3}}*. " +
  "Toque no botão abaixo para acompanhar seu lugar na fila e a estimativa de atendimento em tempo real.";

// Os componentes do template para a CRIAÇÃO na Meta. `headerHandle` vem do upload da logo C2X.
export function componentesDoTemplateBoasVindas(headerHandle: string): unknown[] {
  return [
    { example: { header_handle: [headerHandle] }, format: "IMAGE", type: "HEADER" },
    { example: { body_text: [["Maria", "Vale do Ouro", "3"]] }, text: TXT_BOAS_VINDAS, type: "BODY" },
    {
      buttons: [
        {
          example: [`${URL_BASE_FILA}exemplo`],
          text: TEXTO_BOTAO_FILA,
          type: "URL",
          url: `${URL_BASE_FILA}{{1}}`,
        },
      ],
      type: "BUTTONS",
    },
  ];
}

// Preview amigável do corpo (pra tela de criação mostrar como vai ficar).
export function renderBoasVindasPreview(input: {
  lancamento: string;
  posicao: number | string;
  primeiroNome: string;
}): string {
  return TXT_BOAS_VINDAS.replace("{{1}}", input.primeiroNome || "tudo bem")
    .replace("{{2}}", input.lancamento || "nosso lançamento")
    .replace("{{3}}", String(input.posicao ?? "—"));
}
