import { authorizeApoloRead, authorizeApoloWrite } from "@/lib/apolo/auth";
import {
  confirmarUploadDeMidia,
  pedirUploadDeMidia,
  reassinarMidia,
} from "@/lib/temis/minutas-servico";

// MÍDIA DO EDITOR DE MINUTAS (Têmis). A PORTA DO HUB (Bearer do Apolo).
//
// Esta rota NÃO recebe bytes. Três verbos, o mesmo padrão do documento grande do CAD:
//   POST  { minutaId, fileName, contentType, size } → { bucket, path, token }  URL assinada de UPLOAD
//   PATCH { path }                                  → { url, path, size, type, name }  confirmação
//   GET   ?path=                                    → 302 para uma signed URL de leitura curta
//   GET   ?path=&json=1                             → { url, path } re-assinatura (a tela, ao abrir)
//
// ⚠️ A LÓGICA MORA EM `lib/temis/minutas-servico.ts`: o editor da Cecílio, no portal, sobe mídia
// pelas MESMAS funções (`/api/incorporador/temis/minutas/upload`, cookie em vez de Bearer). As notas
// sobre o prazo da URL assinada e o caminho escolhido pelo servidor estão lá.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export { TTL_LEITURA_MIDIA } from "@/lib/temis/minutas-servico";

export async function POST(request: Request) {
  const auth = await authorizeApoloWrite(request);
  if (!auth.ok) return auth.response;
  return pedirUploadDeMidia(
    { nome: auth.nome ?? "", papel: "escrita", tipo: "hub", userId: auth.userId },
    request,
  );
}

export async function PATCH(request: Request) {
  const auth = await authorizeApoloWrite(request);
  if (!auth.ok) return auth.response;
  return confirmarUploadDeMidia(
    { nome: auth.nome ?? "", papel: "escrita", tipo: "hub", userId: auth.userId },
    request,
  );
}

export async function GET(request: Request) {
  const auth = await authorizeApoloRead(request);
  if (!auth.ok) return auth.response;
  return reassinarMidia(
    { nome: auth.nome ?? "", papel: "leitura", tipo: "hub", userId: auth.userId },
    request,
  );
}
