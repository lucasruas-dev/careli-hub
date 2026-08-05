// E-mails da pré-venda: os MESMOS avisos do WhatsApp (cobrança do PIX e recibo), em e-mail.
//
// Enquadramento (regra do Lucas, 22/jul): o PIX é ETAPA DA FICHA DE CADASTRO (CAD), NÃO uma
// "confirmação de participação" — quem não paga também pode comprar e ir ao evento. Nada de
// "garanta sua vaga"/"participação confirmada".
//
// Saem pela caixa da Iris (Gmail, `sendGmailMessage`). A cobrança leva a ficha (CAD) em PDF
// anexada, igual ao WhatsApp. Ver [[project_asaas_prevenda]].

export type EmailMontado = {
  bodyHtml: string;
  bodyText: string;
  subjectLine: string;
};

// HTML de e-mail: estilo INLINE e tabela de largura fixa — é o que sobrevive no Gmail/Outlook.
function moldura(conteudo: string): string {
  return `<!doctype html>
<html lang="pt-BR">
<body style="margin:0;padding:24px 12px;background:#f4f6fa;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;color:#151b26;">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:600px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:12px;">
    <tr>
      <td style="padding:28px 32px;">
${conteudo}
        <p style="margin:28px 0 0;padding-top:18px;border-top:1px solid #e9edf3;font-size:12px;line-height:1.6;color:#8592a6;">
          Careli · este e-mail é sobre o seu cadastro no lançamento. Em caso de dúvida, é só responder esta mensagem.
        </p>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function escapar(valor: string): string {
  return valor
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function montarEmailCobranca(dados: {
  empreendimento: string;
  link: string;
  nome: string;
  valor: string; // já formatado, ex.: "1.000,00"
}): EmailMontado {
  const { empreendimento, link, nome, valor } = dados;

  const bodyText = `Olá, ${nome}!

Estamos finalizando a sua ficha de cadastro para o lançamento do empreendimento ${empreendimento}.

Para concluir o seu cadastro, realize o PIX de R$ ${valor} pelo link abaixo:
${link}

Sobre este valor:
- Será abatido caso você adquira uma ou mais unidades no empreendimento durante o evento de lançamento.
- Será restituído em até 10 dias úteis após o evento, caso não adquira nenhuma unidade.
- Não garante a reserva de nenhuma unidade.

Estamos enviando junto a sua ficha de cadastro, para que você possa validar as informações. Se algo estiver diferente, é só responder este e-mail.

Careli`;

  const bodyHtml = moldura(`        <p style="margin:0 0 16px;font-size:16px;">Olá, <strong>${escapar(nome)}</strong>!</p>
        <p style="margin:0 0 16px;font-size:15px;line-height:1.6;">
          Estamos finalizando a sua <strong>ficha de cadastro</strong> para o lançamento do empreendimento
          <strong>${escapar(empreendimento)}</strong>.
        </p>
        <p style="margin:0 0 20px;font-size:15px;line-height:1.6;">
          Para <strong>concluir o seu cadastro</strong>, realize o PIX de <strong>R$ ${escapar(valor)}</strong>:
        </p>
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 22px;">
          <tr>
            <td style="border-radius:8px;background:#151b26;">
              <a href="${escapar(link)}" style="display:inline-block;padding:13px 26px;font-size:15px;font-weight:700;color:#ffffff;text-decoration:none;">
                Pagar o PIX
              </a>
            </td>
          </tr>
        </table>
        <p style="margin:0 0 8px;font-size:13px;color:#59657a;">Se o botão não abrir, use este link:</p>
        <p style="margin:0 0 22px;font-size:13px;word-break:break-all;"><a href="${escapar(link)}" style="color:#2f66e0;">${escapar(link)}</a></p>
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#f7f9fc;border:1px solid #e9edf3;border-radius:10px;">
          <tr>
            <td style="padding:16px 18px;">
              <p style="margin:0 0 10px;font-size:13px;font-weight:700;color:#59657a;text-transform:uppercase;letter-spacing:.04em;">Sobre este valor</p>
              <p style="margin:0 0 8px;font-size:14px;line-height:1.6;">· Será <strong>abatido</strong> caso você adquira uma ou mais unidades no empreendimento durante o evento de lançamento.</p>
              <p style="margin:0 0 8px;font-size:14px;line-height:1.6;">· Será <strong>restituído em até 10 dias úteis</strong> após o evento, caso não adquira nenhuma unidade.</p>
              <p style="margin:0;font-size:14px;line-height:1.6;">· <strong>Não garante a reserva de nenhuma unidade.</strong></p>
            </td>
          </tr>
        </table>
        <p style="margin:20px 0 0;font-size:14px;line-height:1.6;">
          Estamos enviando junto a sua <strong>ficha de cadastro</strong>, para que você possa <strong>validar as informações</strong>. Se algo estiver diferente, é só responder este e-mail.
        </p>`);

  return {
    bodyHtml,
    bodyText,
    subjectLine: `Sua ficha de cadastro — lançamento ${empreendimento}`,
  };
}

export function montarEmailRecibo(dados: {
  empreendimento: string;
  nome: string;
  valor: string;
}): EmailMontado {
  const { empreendimento, nome, valor } = dados;

  const bodyText = `Olá, ${nome}!

Recebemos o seu PIX de R$ ${valor}, referente à sua ficha de cadastro para o lançamento do empreendimento ${empreendimento}. Com isso, o seu cadastro está concluído.

Este valor será abatido na compra de uma ou mais unidades, ou restituído em até 10 dias úteis após o evento, caso você não adquira nenhuma.

Para agilizar uma eventual devolução, responda este e-mail com a sua chave PIX. Importante: a conta precisa estar no seu nome (conta nominal).

Careli`;

  const bodyHtml = moldura(`        <p style="margin:0 0 16px;font-size:16px;">Olá, <strong>${escapar(nome)}</strong>!</p>
        <p style="margin:0 0 16px;font-size:15px;line-height:1.6;">
          Recebemos o seu PIX de <strong>R$ ${escapar(valor)}</strong>, referente à sua <strong>ficha de cadastro</strong>
          para o lançamento do empreendimento <strong>${escapar(empreendimento)}</strong>.
        </p>
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#eefbf4;border:1px solid #c8ecd9;border-radius:10px;margin:0 0 20px;">
          <tr>
            <td style="padding:14px 18px;font-size:15px;font-weight:700;color:#1c8b5f;">
              Seu cadastro está concluído.
            </td>
          </tr>
        </table>
        <p style="margin:0 0 16px;font-size:14px;line-height:1.6;">
          Este valor será abatido na compra de uma ou mais unidades, ou restituído em até 10 dias úteis após o evento, caso você não adquira nenhuma.
        </p>
        <p style="margin:0;font-size:14px;line-height:1.6;">
          Para agilizar uma eventual devolução, responda este e-mail com a sua <strong>chave PIX</strong>.
          Importante: a conta precisa estar <strong>no seu nome</strong> (conta nominal).
        </p>`);

  return {
    bodyHtml,
    bodyText,
    subjectLine: `Recebemos o seu PIX — ficha de cadastro do lançamento ${empreendimento}`,
  };
}
