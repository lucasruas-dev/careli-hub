import { authorizeApoloRead } from "@/lib/apolo/auth";
import {
  agirNosTrabalhos,
  atorDoHub,
  listarTrabalhosDoBoard,
} from "@/lib/temis/trabalho-servico";

// OS TRABALHOS DO BOARD DA TÊMIS — listar, abrir e marcar atividade.
//
// ⚠️ ESTA ROTA É SÓ A PORTA DO HUB. A lógica (o catálogo que viaja com os cards, o "1/5" das
// assinaturas, a abertura, a atividade que faz o card andar) mora em `lib/temis/trabalho-servico.ts`,
// e é a MESMA função que `/api/incorporador/temis/trabalhos` chama com o ator do portal. Aqui só se
// confere o Bearer do Apolo (a régua de leitura, como sempre foi) e se monta o ator do hub.
//
// ⚠️ O BOARD DA CARELI MOSTRA SÓ O QUE A CARELI CONFECCIONA. Decisão do Lucas (16/09/2026): a venda
// do time da Cecílio é confeccionada pela Cecílio, no portal, e sai desta fila (o padrão de
// `trabalhosDoBoard` é `operadoPor: "careli"`). `?incluir=incorporadores` é a SUPERVISÃO: devolve
// também os trabalhos operados por incorporador. O card continua abrindo pelo id nos dois casos.
// A tradução dos parâmetros está em `filtroDoBoard`.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const auth = await authorizeApoloRead(request);
  if (!auth.ok) return auth.response;

  return listarTrabalhosDoBoard(atorDoHub(auth, "leitura"), request);
}

export async function POST(request: Request) {
  const auth = await authorizeApoloRead(request);
  if (!auth.ok) return auth.response;

  return agirNosTrabalhos(atorDoHub(auth, "leitura"), request);
}
