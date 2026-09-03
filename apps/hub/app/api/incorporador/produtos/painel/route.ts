import { NextResponse } from "next/server";

import { loadApoloEnterprises } from "@/lib/apolo/empreendimentos";
import { idsDaSessao } from "@/lib/apolo/incorporador/escopo";
import {
  montarPainelDeProdutos,
  type PainelDeProdutos,
} from "@/lib/apolo/incorporador/painel-de-produtos";
import { sessaoDoRequest } from "@/lib/apolo/incorporador/sessao";
import {
  carregarCadastroDeEmpreendimentos,
  type LinhaDoCadastro,
} from "@/lib/hercules/cadastro";

// O PAINEL DE PRODUTOS DO HÉRCULES: os seis cards e a tabela pai/filhos da aba Produtos.
//
// Lucas (02/09/2026): *"queria trazer aquela tela que temos no empreendimento (...) vendas tem que
// morar dentro da tela de produtos"*. Mesma tela de Empreendimentos do Apolo, mas agrupada pelo
// CADASTRO DO PANTEON (hercules_empreendimentos) e recortada pela sessão do portal.
//
// O recorte NÃO vem da query string: sai do cookie assinado (mesma regra de ../route.ts). Os
// números vêm do C2X pelo mesmo caminho da aba Produtos (`loadApoloEnterprises`), e o cadastro
// diz quem é pai de quem. A montagem é pura (`montarPainelDeProdutos`) e coberta por teste.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export type PainelDeProdutosDoIncorporador = PainelDeProdutos;

export async function GET(request: Request) {
  const sessao = sessaoDoRequest(request);

  if (!sessao) {
    return NextResponse.json({ error: "Sessão ausente." }, { status: 401 });
  }

  // As três leituras não dependem uma da outra: C2X (números), sessão expandida (escopo) e
  // cadastro (agrupamento) correm juntas.
  //
  // ⚠️ O CADASTRO É ENRIQUECIMENTO, O ESCOPO NÃO. Cadastro fora do ar degrada: todo
  // empreendimento vira linha simples com o nome do C2X (é a tela antiga, sem pai/filho) — melhor
  // que um 503 no painel inteiro. Já o C2X é a fonte dos números: sem ele não há painel.
  const [c2x, permitidos, cadastro] = await Promise.all([
    loadApoloEnterprises(),
    idsDaSessao(sessao),
    carregarCadastroDeEmpreendimentos().catch((): LinhaDoCadastro[] => []),
  ]);

  if (!c2x.ok) {
    return NextResponse.json(
      { error: "Não foi possível carregar os empreendimentos agora." },
      { status: 503 },
    );
  }

  const painel = montarPainelDeProdutos({
    cadastro,
    linhasDoC2x: c2x.data.rows,
    permitidos: new Set(permitidos),
  });

  return NextResponse.json(
    { data: painel },
    { headers: { "Cache-Control": "no-store" } },
  );
}
