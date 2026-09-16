import { authorizeApoloRead, authorizeApoloWrite } from "@/lib/apolo/auth";
import {
  arquivarMinuta,
  criarMinuta,
  lerMinutas,
  salvarMinuta,
} from "@/lib/temis/minutas-servico";

// MINUTAS DO TEMIS — subir, editar, publicar. A PORTA DO HUB (Bearer do Apolo).
//
//   GET    → lista as minutas do empreendimento (sem conteúdo), ou UMA com o conteúdo (`?id=`)
//   POST   → cria uma minuta (do zero ou a partir de um arquivo importado)
//   PATCH  → salva o rascunho; em minuta PUBLICADA, cria a próxima versão
//   PATCH ?acao=publicar → publica, conferindo antes o que quebraria o contrato
//   DELETE → arquiva
//
// ⚠️ A LÓGICA MORA EM `lib/temis/minutas-servico.ts`, e não aqui. Decisão do Lucas (16/09/2026): a
// equipe da Cecílio *"também cria e edita os modelos"* pelo portal, e a regra "um código só" pede
// que `/api/incorporador/temis/minutas` chame as MESMAS funções. Esta rota só confere o papel no
// hub (o mesmo portão de sempre) e monta o ator do hub, que enxerga todo empreendimento por desenho.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const auth = await authorizeApoloRead(request);
  if (!auth.ok) return auth.response;
  return lerMinutas({ nome: auth.nome ?? "", papel: "leitura", tipo: "hub", userId: auth.userId }, request);
}

export async function POST(request: Request) {
  const auth = await authorizeApoloWrite(request);
  if (!auth.ok) return auth.response;
  return criarMinuta({ nome: auth.nome ?? "", papel: "escrita", tipo: "hub", userId: auth.userId }, request);
}

export async function PATCH(request: Request) {
  const auth = await authorizeApoloWrite(request);
  if (!auth.ok) return auth.response;
  return salvarMinuta({ nome: auth.nome ?? "", papel: "escrita", tipo: "hub", userId: auth.userId }, request);
}

export async function DELETE(request: Request) {
  const auth = await authorizeApoloWrite(request);
  if (!auth.ok) return auth.response;
  return arquivarMinuta({ nome: auth.nome ?? "", papel: "escrita", tipo: "hub", userId: auth.userId }, request);
}
