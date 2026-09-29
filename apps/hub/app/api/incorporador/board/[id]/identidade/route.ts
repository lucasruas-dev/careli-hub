import { NextResponse } from "next/server";

import { atualizarIdentidade } from "@/lib/apolo/identidade-persist";
import {
  adminOu503,
  autorizarOperacaoDeVenda,
  cadNoEscopo,
  recorteDoProduto,
} from "@/lib/apolo/incorporador/board-do-portal";
import { lerEmpreendimentosDaPessoa } from "@/lib/apolo/incorporador/documentos-do-portal";
import {
  erroDaIdentidadeParaOPortal,
  recusaDaIdentidadeNoPortal,
} from "@/lib/apolo/incorporador/escrita-do-portal";
import {
  conferirTrocaDeDocumentoConsultado,
  idsDaEscritaNoBoard,
} from "@/lib/apolo/incorporador/escrita-no-board";
import {
  autorizarEscritaNoProduto,
  recorteQueOPortalOpera,
} from "@/lib/apolo/incorporador/operacao-do-produto-servidor";
import {
  ehPortalComercial,
  portalConfeccionaContrato,
} from "@/lib/apolo/incorporador/perfis-de-portal";

// Correção de IDENTIDADE da ficha pelo portal que opera a venda — POST /api/incorporador/board/[id]/identidade?emp=
//
// Mesmas regras da rota do hub (`atualizarIdentidade`: valida CPF/CNPJ, recusa documento
// repetido, exige motivo, é auditada), com o escopo conferido antes: a pessoa tem que ter CAD (ou
// vínculo de imobiliária) no produto do coordenador. Fora dele: 404.
//
// ⚠️ A RECUSA DE FICHA ESPELHO DO C2X SAIU (28/09/2026): ela vivia de "o resync desfaria em até 6
// horas", premissa que morreu em 04/08/2026 com as 7 tabelas de identidade do sync em ON CONFLICT DO
// NOTHING (`lib/apolo/server.ts:3917-3949`). Lucas, 28/09/2026: *"TUDO PRECISA MORAR DENTRO DO
// PANTEON, não tem mais cadastro vindo do c2x"*. Os guardas DESTE portal não têm relação com isso e
// continuam todos: escopo, pessoa inteira no recorte, 403 do produto que só confecciona e a frase
// neutra da colisão (`erroDaIdentidadeParaOPortal`, que não é sobre o sync e sim sobre não virar um
// oráculo CPF para nome).
//
// Autor = a conta do portal. `atualizarIdentidade` grava o uuid em `actor_user_id` (sem FK) e,
// desde 16/09/2026, o nome em `metadata.autorNome` e a CAD do recorte em `metadata.enterpriseId`.
//
// (16/09/2026, D1) SÓ NO PRODUTO QUE O PORTAL OPERA. No portal que confecciona (o Cecílio), a ficha
// do VOC (37) ou do VOR (41) é só consulta: 403 com `soConsulta`. O comercial segue como hoje.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = autorizarOperacaoDeVenda(request);
  if (!auth.ok) return auth.response;

  const rec = await recorteDoProduto(request, auth.sessao);
  if (!rec.ok) return rec.response;

  const admin = adminOu503();
  if (!admin.ok) return admin.response;

  const { id } = await context.params;

  const escopo = await cadNoEscopo(admin.client, id, rec.recorte);
  if (!escopo.ok) return escopo.response;

  // (16/09/2026, D1) Só no produto que o portal opera. O comercial passa sem ida ao banco.
  const escrita = await autorizarEscritaNoProduto(
    request,
    auth.sessao,
    idsDaEscritaNoBoard(escopo.escopo, rec.recorte),
  );
  if (!escrita.ok) return escrita.response;

  const body = (await request.json().catch(() => ({}))) as {
    documento?: string;
    motivo?: string;
    nome?: string;
    nomeFantasia?: string | null;
    tipo?: "pf" | "pj";
  };

  // ⚠️ Documento OPCIONAL no corpo desde 29/09/2026, pelo mesmo motivo da rota do hub: a PJ sem
  // CNPJ gravado manda string vazia e a correção do NOME era recusada por causa disso.
  if (!body.nome || !body.tipo) {
    return NextResponse.json({ error: "Nome e tipo sao obrigatorios." }, { status: 400 });
  }
  if (body.tipo !== "pf" && body.tipo !== "pj") {
    return NextResponse.json({ error: "Tipo invalido." }, { status: 400 });
  }

  // (16/09/2026, revisão) ⚠️ FORA DO COMERCIAL, SÓ COM A PESSOA INTEIRA NO RECORTE. A correção
  // reescreve a identidade da ENTIDADE (documento, identificadores que a CACÁ usa, índice de busca)
  // e grava o motivo em todas as CADs dela: com CAD ou vínculo em produto de outro cliente, quem
  // corrige é a Careli (lib/apolo/incorporador/escrita-do-portal.ts). Sem conseguir ler os
  // empreendimentos da pessoa, não corrige.
  //
  // (16/09/2026, revisão do conjunto) ⚠️ O RECORTE É O QUE O PORTAL OPERA (`recorteQueOPortalOpera`),
  // e não o do cookie: com o VOC (37) e o VOR (41) só consulta, a CAD da pessoa num deles recusa a
  // correção. Sem conferir, 503.
  const comercial = ehPortalComercial(auth.sessao.tipo);
  if (!comercial) {
    let recusa: null | string;
    try {
      const operados = await recorteQueOPortalOpera(escrita.sessao, rec.recorte.ids);
      if (!operados) {
        return NextResponse.json(
          { error: "Não foi possível conferir esta ficha agora." },
          { status: 503 },
        );
      }
      recusa = recusaDaIdentidadeNoPortal({
        comercial,
        pessoa: await lerEmpreendimentosDaPessoa(admin.client, id),
        recorte: operados,
      });
    } catch (erro) {
      console.error("[incorporador][board][identidade] sem os empreendimentos da pessoa", erro);
      return NextResponse.json(
        { error: "Não foi possível conferir esta ficha agora." },
        { status: 503 },
      );
    }
    if (recusa) return NextResponse.json({ error: recusa, motivo: "compartilhada" }, { status: 409 });
  }

  // (16/09/2026) ⚠️ O DOCUMENTO DO TITULAR JÁ CONSULTADO NÃO MUDA PELO PORTAL QUE OPERA SOZINHO. A
  // consulta guardada é do documento antigo: trocá-lo faria a CAD carregar (e o reaproveitamento
  // aplicar) o crédito de outra pessoa. Com consulta do titular nesta ficha, documento diferente é
  // 409 e a correção é da Careli; corrigir só o nome, com o mesmo documento, segue. Sem ler, 503.
  if (portalConfeccionaContrato(auth.sessao.slug, auth.sessao.tipo)) {
    const recusaDoDocumento = await conferirTrocaDeDocumentoConsultado(admin.client, {
      alvo: "titular",
      // Sem documento no corpo não há troca a conferir: `trocaDeDocumentoConsultado` só reage a
      // dígitos, e o corpo vazio significa "não mexi no documento".
      documentoNovo: body.documento ?? "",
      entityId: id,
    });
    if (recusaDoDocumento) return recusaDoDocumento;
  }

  const resultado = await atualizarIdentidade({
    // (16/09/2026) Nome e CAD do portal no evento: o histórico do portal passa a mostrar a correção
    // com o autor certo (antes saía com traço e, sem a marca, nem aparecia).
    autorNome: auth.sessao.usuarioNome,
    autorUserId: auth.sessao.usuarioId,
    client: admin.client,
    documento: body.documento,
    enterpriseId: escopo.escopo.enterpriseId,
    entityId: id,
    motivo: body.motivo ?? "",
    nome: body.nome,
    // `undefined` atravessa: sem o campo no corpo, `trade_name` não é tocado (ver a rota do hub).
    nomeFantasia: body.nomeFantasia,
    tipo: body.tipo,
  });

  if (!resultado.ok) {
    // 409 para colisão: é conflito de estado, não erro de entrada. (O 409 de "ficha espelho do C2X"
    // não existe mais desde 28/09/2026.)
    // ⚠️ 500 para `parcial`: a ficha já foi gravada e o que falhou veio depois. Ver a rota do hub.
    const status =
      resultado.motivo === "colisao"
        ? 409
        : resultado.motivo === "nao_encontrada"
          ? 404
          : resultado.motivo === "parcial"
            ? 500
            : 400;
    // A colisão sai com a frase neutra: a da lib traz o nome do dono do documento, de qualquer ficha.
    return NextResponse.json(
      { error: erroDaIdentidadeParaOPortal(resultado), motivo: resultado.motivo },
      { status },
    );
  }

  return NextResponse.json({ data: { ok: true } });
}
