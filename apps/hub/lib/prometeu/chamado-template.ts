// Template Meta WhatsApp do CHAMADO do Prometeu: dispara quando o operador chama o cliente. É o
// reforço confiável do alerta da tela (a tela só grita com a aba aberta; o WhatsApp grita em
// qualquer celular, tela bloqueada, app fechado). Espelha lib/prometeu/boas-vindas-template.ts.
// O disparo (chamado-disparo.ts) e a rota de criação (app/api/prometeu/chamado-template) leem daqui.
// Ver [[project_prometeu_tela_cliente]].

// Nome do template registrado na Meta.
export const NOME_TEMPLATE_CHAMADO = "prometeu_chamado";

// Categoria: UTILITY (transacional — dispara no chamado). Mais barato e aprova mais rápido.
export const CATEGORIA_CHAMADO = "UTILITY";

// A base do botão URL. O `{{1}}` é o TOKEN assinado da fila (um por cliente), preenchido no envio.
export const URL_BASE_FILA = "https://c2x.app.br/publico/fila?t=";
export const TEXTO_BOTAO_CHAMADO = "Ver minha chamada";

// BODY. {{1}} = primeiro nome, {{2}} = destino ("o salão de vendas", "a secretaria"...). Termina em
// TEXTO real (a Meta recusa body que fecha numa {{n}}). Sem travessão; negrito com 1 asterisco.
// SEM header de imagem de propósito: é urgência, quanto mais direto melhor (e evita o logo grande).
export const TXT_CHAMADO =
  "*{{1}}, chegou a sua vez!* Dirija-se a {{2}} agora. A nossa equipe já está te esperando. " +
  "Toque no botão abaixo para ver os detalhes do seu atendimento.";

// Os componentes do template para a CRIAÇÃO na Meta.
export function componentesDoTemplateChamado(): unknown[] {
  return [
    {
      example: { body_text: [["Maria", "o salão de vendas"]] },
      text: TXT_CHAMADO,
      type: "BODY",
    },
    {
      buttons: [
        {
          example: [`${URL_BASE_FILA}exemplo`],
          text: TEXTO_BOTAO_CHAMADO,
          type: "URL",
          url: `${URL_BASE_FILA}{{1}}`,
        },
      ],
      type: "BUTTONS",
    },
  ];
}

// Texto do destino a partir da zona do chamado (server-side; a versão da tela do cliente é
// fraseDoDestino em AcompanharFila). Sem o número da mesa: o cliente vê o detalhe exato no botão.
export function descreverDestinoChamado(zona: string | null): string {
  if (zona === "salao") return "o salão de vendas";
  if (zona === "secretaria") return "a secretaria";
  if (zona === "recepcao") return "a recepção";

  return "o atendimento";
}

// Preview amigável do corpo (pra tela de criação mostrar como vai ficar).
export function renderChamadoPreview(input: {
  destino: string;
  primeiroNome: string;
}): string {
  return TXT_CHAMADO.replace("{{1}}", input.primeiroNome || "tudo bem").replace(
    "{{2}}",
    input.destino || "o atendimento",
  );
}
