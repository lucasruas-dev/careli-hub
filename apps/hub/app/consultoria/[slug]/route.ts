import fs from "node:fs";
import path from "node:path";

import { ehProjetoConhecido } from "@/lib/consultoria/projeto";

// A TELA DA CONSULTORIA (c2x.app.br/consultoria/cr).
//
// É o mockup aprovado pelo Lucas em 29/09/2026, entregue byte a byte: a rota não redesenha nada.
// O arquivo não tem dado nenhum dentro. Ele busca o documento na API, com a sessão do consultor
// (edita) ou com o token do link (o cliente só lê). Sem um dos dois, a tela mostra a porta fechada.
//
// Mora fora de `public/` pelo mesmo motivo das telas do masterplan interno: aqui ele é servido com
// noindex e sem cache, e o endereço é o limpo, sem `.html`.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// ⚠️ O `process.cwd()` muda entre o dev (apps/hub) e o build da Vercel (raiz do monorepo).
const PASTAS = [
  path.join(process.cwd(), "consultoria-telas"),
  path.join(process.cwd(), "apps", "hub", "consultoria-telas"),
];

type Contexto = { params: Promise<{ slug: string }> };

export async function GET(_request: Request, { params }: Contexto) {
  const { slug } = await params;
  const alvo = PASTAS.map((pasta) => path.join(pasta, "projeto.html")).find((c) => fs.existsSync(c));

  if (!ehProjetoConhecido(slug) || !alvo) {
    return new Response("Não encontrado.", { status: 404 });
  }

  return new Response(fs.readFileSync(alvo, "utf8"), {
    headers: {
      "cache-control": "no-store",
      "content-type": "text/html; charset=utf-8",
      // O link do cliente leva o token na URL: a página não pode vazar o endereço para fora.
      "referrer-policy": "no-referrer",
      "x-robots-tag": "noindex, nofollow",
    },
  });
}
