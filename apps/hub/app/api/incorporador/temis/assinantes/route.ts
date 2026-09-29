import {
  editarAssinante,
  incluirAssinante,
  lerQuadroDeAssinatura,
  removerAssinante,
} from "@/lib/temis/estrutura-servico";
import { autorizarTemisDoPortal } from "@/lib/temis/portao-do-portal";

// O QUADRO DE ASSINATURA PELO PORTAL — o espelho de `/api/temis/assinantes`.
//
// CRUD completo (ler, incluir, editar, remover), só no empreendimento do alcance, pelas MESMAS
// funções do hub (`lib/temis/estrutura-servico.ts`). O quadro traz nome, CPF mascarado e e-mail de
// quem assina: fora do alcance é 404 antes de ler a tabela.
//
// ⚠️ COM UMA EXCEÇÃO, E ELA É DO SERVIDOR: `termos_vendedora`, quem assina os TERMOS que a CARELI
// emite sobre a carteira, não se aponta, não se edita nem se remove por aqui. A recusa mora em
// `PAPEL_SO_DA_CARELI` (estrutura-servico.ts), e não nesta rota, justamente porque são as mesmas
// funções dos dois lados: uma guarda escrita aqui deixaria a porta do hub e a do portal com duas
// réguas para manter. O CONTRATO inteiro (vendedora, coordenador, testemunha) continua sendo do
// portal, que é o que aquela equipe confecciona.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const auth = await autorizarTemisDoPortal(request);
  if (!auth.ok) return auth.response;
  return lerQuadroDeAssinatura(auth.ator, request);
}

export async function POST(request: Request) {
  const auth = await autorizarTemisDoPortal(request);
  if (!auth.ok) return auth.response;
  return incluirAssinante(auth.ator, request);
}

export async function PATCH(request: Request) {
  const auth = await autorizarTemisDoPortal(request);
  if (!auth.ok) return auth.response;
  return editarAssinante(auth.ator, request);
}

export async function DELETE(request: Request) {
  const auth = await autorizarTemisDoPortal(request);
  if (!auth.ok) return auth.response;
  return removerAssinante(auth.ator, request);
}
