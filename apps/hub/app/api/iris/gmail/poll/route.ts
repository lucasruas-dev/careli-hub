import { NextResponse, type NextRequest } from "next/server";

// A IMPORTAÇÃO DE E-MAIL DA IRIS ESTÁ DESLIGADA.
//
// Lucas (18/09/2026): *"pode cortar a conexão que registrávamos os e-mails no banco"*, junto com
// *"tira o canal e-mail da iris"*. Esta rota lia os não-lidos da caixa robô e criava ticket +
// mensagem no caredesk (canal kind=email), a cada 5 minutos pelo cron da Vercel.
//
// ⚠️ TIRAR O CRON NÃO BASTAVA, e por isso a rota também parou. `x-vercel-cron` é só um header, e
// qualquer um que chame esta URL com ele seria atendido (ver [[reference_cron_x_vercel_cron_spoofavel]]):
// o cron fora do vercel.json deixaria a importação a uma requisição de voltar. Agora nenhuma chamada
// lê a caixa nem grava no banco.
//
// ⚠️ PARA RELIGAR: a importação continua inteira em `lib/iris/gmail-inbound.ts` (`ingestGmailInbox`).
// Religar é devolver a chamada aqui, com a autorização de antes (x-vercel-cron ou Bearer CRON_SECRET),
// o cron no vercel.json e a aba/filtro de e-mail na Iris (lib/iris/canais-de-email.ts).
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_request: NextRequest) {
  return NextResponse.json(
    { error: "A importação de e-mail da Iris está desligada." },
    { headers: { "Cache-Control": "no-store" }, status: 410 },
  );
}
