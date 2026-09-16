import { autorizarLeituraDeContrato } from "@/lib/temis/autorizacao";
import { atorDoHub, lerDocumentosDoTrabalho } from "@/lib/temis/trabalho-servico";

// OS DOCUMENTOS DA VENDA, VISTOS PELA TÊMIS — a segunda aba da coluna fixa.
//
// Lucas (09/09/2026): *"chat - documentos - (trazer os documentos dos propronentes) historico"*.
//
// ⚠️ ESTA ROTA É SÓ A PORTA DO HUB. Listar as duas fontes (`hercules_documentos` da venda e
// `apolo_documents` do proponente, pela peça canônica `listApoloDocuments`) e abrir por
// `?abrir=<id>` com URL assinada de 10 minutos moram em `lerDocumentosDoTrabalho`
// (`lib/temis/trabalho-servico.ts`), a mesma que `/api/incorporador/temis/trabalho/documentos`
// chama com o ator do portal — lá sem o comprovante do Serasa e sem peça interna da Careli.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const auth = await autorizarLeituraDeContrato(request);
  if (!auth.ok) return auth.response;

  return lerDocumentosDoTrabalho(atorDoHub(auth, "leitura"), request);
}
