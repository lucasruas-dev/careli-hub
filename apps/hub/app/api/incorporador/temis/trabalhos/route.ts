import { autorizarTemisDoPortal } from "@/lib/temis/portao-do-portal";
import { agirNosTrabalhos, listarTrabalhosDoBoard } from "@/lib/temis/trabalho-servico";

// OS TRABALHOS DA TÊMIS DO PORTAL — o espelho de `/api/temis/trabalhos` para o incorporador que
// confecciona a própria venda (hoje só `cecilio-rocha`).
//
// Decisões do Lucas (16/09/2026): a venda feita pelo time da Cecílio vai para a confecção DELA, no
// portal; a da Gurgel continua na Têmis da Careli. Mesmo formato de requisição e de resposta da rota
// do hub, para o TemisKanban só trocar a base e a credencial (cookie `apolo_inc` same-origin).
//
// ⚠️ UM CÓDIGO SÓ. Listar, abrir e marcar atividade são as MESMAS funções da rota do hub
// (`lib/temis/trabalho-servico.ts`); o que muda é o ator. Com ele:
//   • o board lista SÓ `operado_por = incorporador` dentro dos empreendimentos da sessão
//     (`?empreendimento=` só reduz; fora da lista é 404; `?incluir=` não existe aqui);
//   • marcar atividade exige o card no alcance, conferido antes de ler;
//   • abrir solicitação é de QUALQUER conta do portal que confecciona (o time inteiro opera), nasce
//     com `operado_por` do incorporador, e o empreendimento e o contrato de origem passam pelo
//     alcance antes do insert.
//
// ⚠️ A PORTA É `autorizarTemisDoPortal`: sem sessão 401; comercial (Gurgel) e `cer` 404 sem tocar
// no banco; cadastro inativo ou divergente 404.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const auth = await autorizarTemisDoPortal(request);
  if (!auth.ok) return auth.response;

  return listarTrabalhosDoBoard(auth.ator, request);
}

export async function POST(request: Request) {
  const auth = await autorizarTemisDoPortal(request);
  if (!auth.ok) return auth.response;

  return agirNosTrabalhos(auth.ator, request);
}
