import { NextResponse } from "next/server";

import { carregarPainelAssinatura, VALE_DO_OURO } from "@/lib/apolo/painel-assinatura";

// BI PÚBLICO DE ASSINATURA — o mesmo painel de /apolo/assinaturas, sem exigir login.
//
// Decisão do Lucas (17/08/2026), depois de eu levantar o que a tela expõe: "só deixa público,
// somente isso". Ou seja, sai como está, com os nomes e e-mails de quem assina e os dados das
// unidades. Fica REGISTRADO aqui para quem vier depois não achar que foi descuido: quem tiver o
// link vê e-mail de sócio do incorporador e nome de comprador.
//
// A página que consome esta rota é `noindex`, mesmo padrão do painel do coordenador: link que
// circula entre pessoas é uma coisa, link que o Google indexa é outra bem diferente.
//
// ⚠️ SEM PARÂMETRO DE EMPREENDIMENTO, e é de propósito. O escopo é fixo no servidor (Vale do
// Ouro). Aceitar `codes` da query numa rota anônima deixaria qualquer um pedir a carteira de
// qualquer loteamento — a mesma regra que a rota interna já segue.
//
// O cache de 5 minutos mora na lib e vale para os dois chamadores: um link público que circula
// não pode virar uma consulta ao legado por pessoa que abre.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const resultado = await carregarPainelAssinatura(VALE_DO_OURO);

  if (!resultado.ok) {
    return NextResponse.json({ error: resultado.erro }, { status: 503 });
  }

  return NextResponse.json(
    { data: resultado.dados },
    { headers: { "Cache-Control": "no-store" } },
  );
}
