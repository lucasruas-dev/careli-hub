import { authorizeApoloRead, authorizeApoloWrite } from "@/lib/apolo/auth";
import { desativarAnexo, gravarAnexo, lerAnexos } from "@/lib/temis/estrutura-servico";

// OS ANEXOS E A CAPA DO CONTRATO. Tabela e coluna na migration 0156. A PORTA DO HUB.
//
//   POST { acao: "upload", ...alcance, fileName, contentType, size } → { bucket, path, token }
//   POST { acao: "confirmar", ...alcance, posicao, nome, path }      → { anexo }
//   POST { acao: "capa", minutaId, path, nome }                      → { ok: true }
//   GET  ?enterpriseId=&categoriaId=&unidadeId=                      → { anexos }
//   DELETE ?id=                                                      → desativa (não apaga)
//
// ⚠️ A LÓGICA MORA EM `lib/temis/estrutura-servico.ts`: o portal da Cecílio sobe e desativa os
// anexos dos produtos dela pelas MESMAS funções (`/api/incorporador/temis/anexos`).
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const auth = await authorizeApoloRead(request);
  if (!auth.ok) return auth.response;
  return lerAnexos({ nome: auth.nome ?? "", papel: "leitura", tipo: "hub", userId: auth.userId }, request);
}

export async function POST(request: Request) {
  const auth = await authorizeApoloWrite(request);
  if (!auth.ok) return auth.response;
  return gravarAnexo({ nome: auth.nome ?? "", papel: "escrita", tipo: "hub", userId: auth.userId }, request);
}

export async function DELETE(request: Request) {
  const auth = await authorizeApoloWrite(request);
  if (!auth.ok) return auth.response;
  return desativarAnexo(
    { nome: auth.nome ?? "", papel: "escrita", tipo: "hub", userId: auth.userId },
    request,
  );
}
