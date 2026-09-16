import { desativarAnexo, gravarAnexo, lerAnexos } from "@/lib/temis/estrutura-servico";
import { autorizarTemisDoPortal } from "@/lib/temis/portao-do-portal";

// OS ANEXOS E A CAPA DO CONTRATO PELO PORTAL — o espelho de `/api/temis/anexos`.
//
// CRUD completo, só no alcance, pelas MESMAS funções do hub (`lib/temis/estrutura-servico.ts`):
//   • ler: cada nível pedido (empreendimento, categoria, unidade) precisa ser do ator;
//   • subir e registrar: o alcance do corpo precisa ser do ator INTEIRO (a categoria do consolidado
//     só com todas as divisões), e o arquivo registrado precisa estar na pasta desse alcance;
//   • capa: a minuta e a pasta do arquivo, as duas no alcance;
//   • desativar: o anexo gravado precisa ser do ator.
// Fora disso, 404 antes de assinar, ler ou gravar qualquer coisa.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const auth = await autorizarTemisDoPortal(request);
  if (!auth.ok) return auth.response;
  return lerAnexos(auth.ator, request);
}

export async function POST(request: Request) {
  const auth = await autorizarTemisDoPortal(request);
  if (!auth.ok) return auth.response;
  return gravarAnexo(auth.ator, request);
}

export async function DELETE(request: Request) {
  const auth = await autorizarTemisDoPortal(request);
  if (!auth.ok) return auth.response;
  return desativarAnexo(auth.ator, request);
}
