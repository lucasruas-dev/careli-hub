import { contratosGuardados, gerarContratoDaProposta } from "@/lib/temis/contrato-servico";
import { autorizarTemisDoPortal } from "@/lib/temis/portao-do-portal";

// GERAR E ABRIR O CONTRATO NO PORTAL — o espelho de `/api/temis/contrato/gerar`.
//
// Decisão do Lucas (16/09/2026): *"a Cecilio quem vai fazer é o proprio time deles"* — a equipe da
// Cecílio gera o contrato das vendas que ela confecciona. O papel vai para a MESMA gaveta
// (`hercules_documentos`, pasta da unidade), com versão, e o card anda para "Contrato", como no hub.
//
// ⚠️ UM CÓDIGO SÓ: `gerarContratoDaProposta` e `contratosGuardados` (`lib/temis/contrato-servico.ts`)
// são as funções da rota do hub. O que o ator do portal muda nelas:
//   • POST e GET `?proposta=`: a proposta precisa ter todos os cards deste incorporador, no escopo
//     da sessão — conferido ANTES de montar, de abrir o Chromium e de tocar o bucket;
//   • GET `?documento=`: o documento é traduzido na proposta dele antes de virar link assinado;
//   • o autor gravado na gaveta e na passagem de etapa é o usuário do portal, com a origem escrita
//     no nome (nunca lido de `hub_users`).
//
// ⚠️ NÃO HÁ RÉGUA DE PAPEL NO PORTAL. No hub, emitir é de admin e leader; no portal, quem passa por
// `autorizarTemisDoPortal` é do time que confecciona, e todo ele gera (a sessão do portal não tem
// papel por usuário).
//
// ⚠️ ESTA ROTA ABRE O CHROMIUM E PRECISA DA PRÓPRIA LINHA NO `next.config.ts`
// (`outputFileTracingIncludes`): a entrada é por rota, e sem ela a função sobe sem o binário e só
// falha em produção.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: Request) {
  const auth = await autorizarTemisDoPortal(request);
  if (!auth.ok) return auth.response;

  return gerarContratoDaProposta(auth.ator, request);
}

export async function GET(request: Request) {
  const auth = await autorizarTemisDoPortal(request);
  if (!auth.ok) return auth.response;

  return contratosGuardados(auth.ator, request);
}
