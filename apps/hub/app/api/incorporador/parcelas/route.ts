import { NextResponse } from "next/server";

import { loadApoloUnitInstallments } from "@/lib/apolo/carteira";
import { autorizar, foraDoEscopo, unidadeNoEscopo } from "@/lib/apolo/incorporador/escopo";
import { parcelaParaOPortal } from "@/lib/apolo/incorporador/parcelas-portal";

// AS PARCELAS DE UMA UNIDADE, para o modal de carteira detalhada do portal do incorporador.
//
// É a versão escopada da leitura que a tela interna já usa (`loadApoloUnitInstallments`), e o
// PRIMEIRO chamador de produção de `unidadeNoEscopo` — de propósito. A leitura interna recebe só
// um `unitId` e não filtra empreendimento nenhum, porque nasceu para o Apolo interno, onde o gate
// é o papel no Hub. Aqui quem chama é o CLIENTE: sem a conferência, trocar o número na barra de
// endereço devolveria as parcelas de um comprador de outro loteamento.
//
// A ORDEM É FIXA E NÃO SE INVERTE:
//   1. `autorizar`        — sem sessão assinada, 401 e nada mais roda;
//   2. `unidadeNoEscopo`  — a unidade pertence a um empreendimento DESTA sessão? Roda ANTES da
//      leitura de dados, nunca depois: conferir com o dado já em mãos é o mesmo que não conferir;
//   3. `foraDoEscopo`     — unidade de outro loteador responde 404, o mesmo que uma unidade
//      inexistente. Para quem não tem o empreendimento, ele não existe; 403 confirmaria que o id
//      é de alguém.
//
// ⚠️ O PAYLOAD É ALLOWLIST, CAMPO A CAMPO (`parcelaParaOPortal`). Até 18/08/2026 o link de boleto
// era OMITIDO de propósito, porque a decisão de expô-lo ao incorporador estava em aberto. A ordem
// do Lucas (18/08/2026) liberou: *"temos que trazer o contrato e nas parcelas dentro de carteira o
// link do boleto do asaas"* — agora `boletoUrl` (a fatura Asaas) atravessa, e SÓ ela: a escolha de
// qual dos dois campos do C2X vai (e por quê) está documentada em
// lib/apolo/incorporador/parcelas-portal.ts. Repassar o objeto inteiro segue proibido — campo novo
// na leitura interna não pode nascer vazando no portal.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET(request: Request) {
  const auth = autorizar(request);
  if (!auth.ok) return auth.response;

  const cru = new URL(request.url).searchParams.get("unitId")?.trim() ?? "";
  const unitId = Number(cru);

  // Id que nem é um id responde como unidade que não existe: nada de 400 explicando o formato
  // para quem está tateando a rota.
  if (!Number.isInteger(unitId) || unitId <= 0) {
    return foraDoEscopo();
  }

  // A conferência de escopo, ANTES de qualquer leitura de dados. Fail-closed: se o C2X não provar
  // que a unidade é deste incorporador, ela não é.
  const pertence = await unidadeNoEscopo(unitId, auth.sessao);
  if (!pertence) {
    return foraDoEscopo();
  }

  const resultado = await loadApoloUnitInstallments(String(unitId));
  if (!resultado.ok) {
    // O detalhe do loader NÃO atravessa para o cliente EXTERNO: ele pode citar nome de env
    // interna ("Configuração C2X ausente: …"). Fica no log do servidor; o portal recebe genérico.
    console.error("[incorporador/parcelas] falha ao carregar as parcelas:", resultado.error);
    return NextResponse.json(
      { error: "Não foi possível carregar as parcelas agora." },
      { status: 503 },
    );
  }

  return NextResponse.json(
    {
      data: {
        // Allowlist explícita (ver o aviso no topo): `boletoUrl` entra por ordem do Lucas
        // (18/08/2026); o resto do objeto interno continua NÃO atravessando.
        installments: resultado.installments.map(parcelaParaOPortal),
      },
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
