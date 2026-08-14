import { redirect } from "next/navigation";

// ROTA ANTIGA do dashboard de CADs. Virou uma porta para o Painel do coordenador (14/08).
//
// Ela continua existindo porque o link já circula com os coordenadores e com as imobiliárias —
// quebrar um link que está no WhatsApp de alguém é o jeito mais rápido de fazer a tela nova
// parecer defeito. O slug do empreendimento é o mesmo, então `/publico/cads/vale-do-ouro` cai
// direto na aba CAD do Vale do Ouro no painel novo.

export const dynamic = "force-dynamic";

export default async function CadPublicRoute({
  params,
}: {
  params: Promise<{ empreendimento: string }>;
}) {
  const { empreendimento } = await params;

  redirect(`/publico/painel?emp=${encodeURIComponent(empreendimento)}&aba=cad`);
}
