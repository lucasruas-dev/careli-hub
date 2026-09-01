import type { RowDataPacket } from "mysql2";
import { NextResponse } from "next/server";

import { authorizeApoloRead } from "@/lib/apolo/auth";
import { getHadesDbPool } from "@/lib/guardian/db";

// TRAZER A MINUTA QUE JÁ EXISTE NO C2X.
//
// ⚠️ ESTA ROTA É A PORTA QUE FALTAVA. O editor só sabia importar `.docx`, e as 85 minutas vivas do
// legado estão em HTML dentro do MySQL — nenhuma delas entrava no Temis por caminho nenhum. Sem
// isto, "rodar o Jardim das Gerais hoje" significaria alguém redigitar 41 mil caracteres.
//
//   GET                → lista as minutas do C2X daquele empreendimento (sem o texto)
//   GET ?draftId=85    → devolve o HTML de UMA minuta
//
// ⚠️ SOMENTE LEITURA, e não é só uma boa prática: o C2X é read-only por regra do projeto. Esta rota
// faz SELECT e nada mais. O que o Temis criar a partir daqui é um documento NOVO, no Panteon — o
// original continua onde está, servindo os contratos que o legado ainda gera.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const LIMITE_DE_TEXTO = 4_000_000;

export async function GET(request: Request) {
  const auth = await authorizeApoloRead(request);
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const draftId = Number(url.searchParams.get("draftId") ?? "");
  const enterpriseId = url.searchParams.get("enterpriseId")?.trim();

  const poolResult = getHadesDbPool();
  if (!poolResult.ok) {
    return NextResponse.json(
      { error: "O banco do C2X não está configurado ou não respondeu." },
      { status: 503 },
    );
  }

  try {
    // ── UMA MINUTA, COM O TEXTO ──────────────────────────────────────────────
    if (Number.isInteger(draftId) && draftId > 0) {
      const [linhas] = await poolResult.pool.query<RowDataPacket[]>(
        "SELECT id, name, enterprise_id, text FROM draft_contracts WHERE id = ? LIMIT 1",
        [draftId],
      );
      const linha = linhas[0];
      if (!linha) {
        return NextResponse.json({ error: "Minuta não encontrada no C2X." }, { status: 404 });
      }

      const html = String(linha.text ?? "");

      // ⚠️ MINUTA VAZIA EXISTE, E É O CASO DO ACP. Medido em 01/09/2026: a
      // `ACP-MINUTA-COMPRA-VENDA` (#83) tem ZERO caracteres no C2X, e os três planos do Aldeia da
      // Cachoeira apontam para ela. Importar em silêncio criaria um rascunho em branco e a pessoa
      // levaria um tempo até entender que o problema não é o Temis.
      if (!html.trim()) {
        return NextResponse.json(
          {
            error: `A minuta "${String(linha.name ?? draftId)}" está VAZIA no C2X (zero caracteres). Não há o que importar — o texto precisa vir do loteador.`,
          },
          { status: 409 },
        );
      }

      if (html.length > LIMITE_DE_TEXTO) {
        return NextResponse.json(
          { error: "Esta minuta passa de 4 MB, provavelmente por imagens embutidas." },
          { status: 413 },
        );
      }

      return NextResponse.json({
        data: {
          minuta: {
            html,
            id: Number(linha.id),
            nome: String(linha.name ?? `Minuta ${draftId}`),
          },
        },
      });
    }

    // ── A LISTA DO EMPREENDIMENTO ────────────────────────────────────────────
    if (!enterpriseId) {
      return NextResponse.json({ error: "Informe o empreendimento." }, { status: 400 });
    }

    // O agrupamento (`group:Nome`) não tem correspondente numérico no legado; só id de divisão.
    const numerico = Number(enterpriseId);
    if (!Number.isInteger(numerico) || numerico <= 0) {
      return NextResponse.json({ data: { minutas: [] } });
    }

    const [linhas] = await poolResult.pool.query<RowDataPacket[]>(
      `SELECT id, name, CHAR_LENGTH(text) AS tamanho, updated_at
         FROM draft_contracts
        WHERE enterprise_id = ?
        ORDER BY name`,
      [numerico],
    );

    return NextResponse.json({
      data: {
        minutas: linhas.map((linha) => ({
          atualizadaEm: linha.updated_at ? String(linha.updated_at) : null,
          id: Number(linha.id),
          nome: String(linha.name ?? ""),
          // A tela mostra o tamanho porque é ele que denuncia a minuta vazia ANTES do clique.
          tamanho: Number(linha.tamanho ?? 0),
        })),
      },
    });
  } catch {
    // ⚠️ A MENSAGEM NÃO CARREGA O ERRO DO BANCO. Ele traz host, usuário e o SQL — nada disso
    // atravessa para a tela.
    return NextResponse.json({ error: "Não consegui ler as minutas do C2X." }, { status: 502 });
  }
}
