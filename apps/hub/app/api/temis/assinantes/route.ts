import { authorizeApoloRead, authorizeApoloWrite } from "@/lib/apolo/auth";
import {
  incluirAssinante,
  lerQuadroDeAssinatura,
  removerAssinante,
} from "@/lib/temis/estrutura-servico";

// O QUADRO DE ASSINATURA DO EMPREENDIMENTO. Tabela na migration 0158. A PORTA DO HUB.
//
// ⚠️ A LÓGICA MORA EM `lib/temis/estrutura-servico.ts`: o portal da Cecílio mantém o quadro dos
// produtos dela pelas MESMAS funções (`/api/incorporador/temis/assinantes`). Os três papéis e a
// linha herdada do representante legal estão explicados lá.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// A tela do quadro importa os papéis e o tipo daqui desde que a rota nasceu.
export {
  type AssinanteDoQuadro,
  PAPEIS_DO_QUADRO,
  type PapelDoQuadro,
} from "@/lib/temis/estrutura-servico";

export async function GET(request: Request) {
  const auth = await authorizeApoloRead(request);
  if (!auth.ok) return auth.response;
  return lerQuadroDeAssinatura(
    { nome: auth.nome ?? "", papel: "leitura", tipo: "hub", userId: auth.userId },
    request,
  );
}

export async function POST(request: Request) {
  const auth = await authorizeApoloWrite(request);
  if (!auth.ok) return auth.response;
  return incluirAssinante(
    { nome: auth.nome ?? "", papel: "escrita", tipo: "hub", userId: auth.userId },
    request,
  );
}

// ⚠️ DESATIVA, NÃO APAGA. Um contrato já enviado carrega o nome no envelope e o diário da assinatura
// aponta para esta linha.
export async function DELETE(request: Request) {
  const auth = await authorizeApoloWrite(request);
  if (!auth.ok) return auth.response;
  return removerAssinante(
    { nome: auth.nome ?? "", papel: "escrita", tipo: "hub", userId: auth.userId },
    request,
  );
}
