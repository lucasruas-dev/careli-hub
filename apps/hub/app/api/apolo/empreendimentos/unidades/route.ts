import { NextResponse } from "next/server";

import { authorizeApoloRead } from "@/lib/apolo/auth";
import {
  type ApoloEnterpriseUnit,
  loadApoloEnterpriseUnits,
  situacaoDaLinhaDoPanteon,
  situacaoNaAbaUnidades,
} from "@/lib/apolo/empreendimentos";
import { lerUnidadesDoPanteon, unidadeDoPanteonNaTela } from "@/lib/apolo/incorporador/unidades-do-panteon";
import { createApoloAdminClient } from "@/lib/apolo/server";
import { ehIdDoPanteon } from "@/lib/hercules/produto-novo";
import { lerSituacaoDasUnidades } from "@/lib/hercules/situacao-da-unidade";
import { createPrometeuClient, eventoOperavelId } from "@/lib/prometeu/data";
import { topicoDaFila } from "@/lib/prometeu/fila-topic";

// Unidades de um empreendimento. Aceita N códigos (?codes=LBR,LBP,LBF) porque a linha da
// tela pode ser um produto consolidado (regra ENTERPRISE_GROUPS).
//
// ⚠️ PRODUTO NASCIDO NO PANTEON (`?id=100000`, 16/09/2026). Ele não existe no C2X, e ler as unidades
// dele por código no legado devolvia a tabela vazia com 200: parecia produto sem estoque. Com o id do
// Panteon (`ehIdDoPanteon`), as unidades saem de `hercules_unidades`, pela MESMA leitura e o MESMO
// formato de tela que a ficha do portal usa (lib/apolo/incorporador/unidades-do-panteon.ts). Id do
// C2X (ou sem id) segue o caminho de sempre, pelos códigos.
//
// ⚠️ NOS DOIS RAMOS, A SITUAÇÃO É A DO PANTEON (18/09/2026): lib/hercules/situacao-da-unidade.ts,
// a mesma régua da tela Venda. Do C2X vem o resto da linha, nunca o livre/reservado/vendido.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Leitura = { error: string; ok: false } | { ok: true; units: ApoloEnterpriseUnit[] };

async function unidadesDoPanteon(enterpriseId: string, codigo: string): Promise<Leitura> {
  const admin = createApoloAdminClient();
  if (!admin) return { error: "Cadastro de unidades indisponível.", ok: false };

  try {
    // ⚠️ A SITUAÇÃO NÃO SAI DE `hercules_unidades.situacao` CRU (18/09/2026, Lucas: *"esses status
    // tem que morar em um so lugar"*). O cadastro não sabe da proposta nem da reserva do Hércules:
    // o lote em contrato aparecia "Disponível" aqui e "Contrato" na tela Venda. A linha continua
    // vindo de `lerUnidadesDoPanteon` (quadra, lote, área, preço, matrícula); a situação vem da
    // régua única, pelo id da linha (`porLinha`), e é escrita do MESMO jeito que o ramo do C2X
    // escreve (`situacaoNaAbaUnidades`). Falha em qualquer das duas leituras cai no `catch`: erro
    // na tela, nunca lote pintado de livre.
    const [linhas, situacoes] = await Promise.all([
      lerUnidadesDoPanteon(admin, [enterpriseId]),
      lerSituacaoDasUnidades(admin, [enterpriseId]),
    ]);
    return {
      ok: true,
      units: linhas.map((linha) => ({
        ...unidadeDoPanteonNaTela(linha, codigo),
        ...situacaoNaAbaUnidades(situacaoDaLinhaDoPanteon(linha.id, situacoes)),
      })),
    };
  } catch (erro) {
    // ⚠️ Erro NUNCA vira "zero unidades": a tela mostraria o produto vazio como se fosse verdade.
    console.error("[apolo][empreendimentos] unidades do Panteon indisponíveis", erro);
    return { error: "Não foi possível carregar as unidades agora. Tente de novo em instantes.", ok: false };
  }
}

export async function GET(request: Request) {
  const authorization = await authorizeApoloRead(request);

  if (!authorization.ok) {
    return authorization.response;
  }

  const params = new URL(request.url).searchParams;
  const codes = (params.get("codes") ?? "")
    .split(",")
    .map((code) => code.trim())
    .filter(Boolean);
  const enterpriseId = (params.get("id") ?? "").trim();
  const doPanteon = ehIdDoPanteon(enterpriseId);

  if (!codes.length && !doPanteon) {
    return NextResponse.json(
      { error: "Informe ao menos um código de empreendimento." },
      { status: 400 },
    );
  }

  try {
    const result = doPanteon
      ? // O código só rotula a unidade na tela; sem ele, o id segura o lugar.
        await unidadesDoPanteon(enterpriseId, (codes[0] ?? enterpriseId).toUpperCase())
      : await loadApoloEnterpriseUnits(codes);

    // EM QUAL CANAL A TELA ESCUTA para saber que uma reserva aconteceu no salão.
    //
    // ⚠️ Realtime, e não poll: a regra de custo do Panteon é explícita depois do incidente de
    // fatura do Hermes — não aumentar polling, preferir broadcast. Uma tela de backoffice fica
    // aberta o dia inteiro; um poll de minuto nela custaria uma consulta ao C2X por minuto por
    // pessoa, o dia todo, para uma mudança que acontece algumas vezes por hora e só durante o
    // evento.
    //
    // Sem evento operável, não há canal e a tela simplesmente não escuta nada.
    const topico = await (async (): Promise<null | string> => {
      try {
        const prometeu = createPrometeuClient();
        if (!prometeu) return null;
        const eventoId = await eventoOperavelId(prometeu);
        return eventoId ? topicoDaFila(eventoId) : null;
      } catch {
        return null;
      }
    })();

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 503 });
    }

    return NextResponse.json(
      { data: { realtime: { topico }, units: result.units } },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("[apolo][empreendimentos] falha ao carregar unidades", error);

    return NextResponse.json(
      { error: "Não foi possível carregar as unidades." },
      { status: 500 },
    );
  }
}
