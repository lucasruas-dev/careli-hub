import { NextResponse } from "next/server";

import { authorizeApoloRead, authorizeApoloWrite } from "@/lib/apolo/auth";
import { lerUnidadesParaCategoria } from "@/lib/temis/estrutura-servico";

// VINCULAR UNIDADES A UMA CATEGORIA — a segunda metade do pedido do Lucas (15/09/2026). A PORTA DO
// HUB.
//
// *"eu criei umas categorias mas não tem como eu vincular a unidade aquela categoria, não temos a
// tela de cadastro da unidade a qual eu posso vincular aquela unidade ao filho, categoria"*.
//
// ⚠️ O GET CONTINUA: ele lista as unidades para a tela de categorias, e a lógica mora em
// `lib/temis/estrutura-servico.ts`. O portal da Cecílio LÊ pela mesma função
// (`/api/incorporador/temis/categorias/unidades`) e nunca vinculou.
//
// ⚠️ O PATCH FOI APOSENTADO EM 21/09/2026, e o motivo é que duas portas com RÉGUAS OPOSTAS não
// podem decidir a mesma coisa. Desde a cadeia do contrato, a categoria escolhe a MINUTA e os
// ANEXOS do lote (`lib/temis/cadeia-do-contrato.ts`) — e esta porta só conferia que a categoria
// EXISTE, sem olhar de que empreendimento ela é. Medido naquele dia: um lote do VOC (37, família
// Vale do Ouro) recebia com 200 a categoria cadastrada no Lagoa Bonita (31), e o teto de 500 por
// chamada fazia disso 500 lotes com a minuta errada num pedido só. O gate era `authorizeApoloWrite`,
// ou seja, admin, leader e operator.
//
// A porta nova — `/api/apolo/empreendimentos/unidades/vinculo` — recusa o mesmo pedido com 404 e
// frase, carimba o gêmeo do terreno pela identidade da 0161, trava a mudança de divisão com venda
// viva e grava o carimbo de quem vinculou. Nenhum `.tsx` chamava mais esta aqui (grep por
// "categorias/unidades" em 21/09/2026: só testes), então o 410 não tira nada de ninguém — ele
// fecha a porta antes de alguém voltar a usá-la.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** A rota que responde no lugar desta. Vai na resposta, para quem chamar saber para onde ir. */
const PORTA_NOVA = "/api/apolo/empreendimentos/unidades/vinculo";

export async function PATCH(request: Request) {
  // ⚠️ AUTORIZA ANTES DE RECUSAR. Um 410 respondido sem portão diria a qualquer um na internet que
  // esta rota existiu e para onde ela se mudou.
  const auth = await authorizeApoloWrite(request);
  if (!auth.ok) return auth.response;

  return NextResponse.json(
    {
      error:
        "Esta porta de vínculo de categoria foi aposentada porque não conferia de que empreendimento a categoria era. " +
        `Use ${PORTA_NOVA}, que confere a família, alcança o registro antigo do terreno e registra quem vinculou.`,
      porta: PORTA_NOVA,
    },
    { status: 410 },
  );
}

export async function GET(request: Request) {
  const auth = await authorizeApoloRead(request);
  if (!auth.ok) return auth.response;
  return lerUnidadesParaCategoria(
    { nome: auth.nome ?? "", papel: "leitura", tipo: "hub", userId: auth.userId },
    request,
  );
}
