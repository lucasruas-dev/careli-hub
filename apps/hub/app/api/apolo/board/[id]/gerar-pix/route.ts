import { NextResponse } from "next/server";

import {
  emitirCobrancaPix,
  enviarCobrancaPrevenda,
  moedaBR,
  VALOR_PREVENDA,
} from "@/lib/apolo/cobranca-prevenda";
import { authorizeApoloWrite } from "@/lib/apolo/auth";
import { getValorPix } from "@/lib/apolo/enterprise-settings";
import { lerCadDaEsteira, normalizarEnterpriseId } from "@/lib/apolo/esteira-cad";
import { resolverPrevendaHabilitada } from "@/lib/apolo/limite-credito";
import { createApoloAdminClient } from "@/lib/apolo/server";

// GERAR PIX de UMA ficha, direto do Board (botão da etapa Pré-venda).
//
// Percorre o MESMO caminho do disparo em massa — mesma lib, mesma cobrança, mesmos dois canais —,
// só que para uma pessoa: emite a cobrança no Asaas e já dispara a cobrança no WhatsApp e no
// e-mail, com a ficha (CAD) anexada. É o "gerar o PIX e começar o fluxo de disparo" num clique.
//
// IDEMPOTENTE: se a ficha já tem cobrança emitida (pagamento_ref), NÃO cria outra — devolve a
// existente. Sem isso, dois cliques gerariam duas cobranças de R$ 1.000 para a mesma pessoa.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await authorizeApoloWrite(request);
  if (!auth.ok) return auth.response;

  const client = createApoloAdminClient();
  if (!client) {
    return NextResponse.json({ error: "Sem acesso à base do Apolo." }, { status: 503 });
  }

  const { id: entityId } = await context.params;

  // ⚠️ O PIX É DE UMA **CAD**, NÃO DE UMA PESSOA. `[id]` é a pessoa, e desde a 0080 ela pode ter
  // uma CAD por empreendimento — cada uma com o seu PIX de R$ 1.000. `?enterpriseId=` diz qual;
  // sem ele, a mais recente. Toda escrita abaixo é presa nesta CAD: sem isso a RESERVA
  // anti-cobrança-dupla travaria (ou liberaria) as CADs da pessoa em outros loteamentos.
  const esteira = await lerCadDaEsteira<{
    empreendimento: string | null;
    enterprise_id: string | null;
    etapa: string | null;
    pagamento_ref: string | null;
    pago_em: string | null;
  }>(client, entityId, "etapa, empreendimento, enterprise_id, pago_em, pagamento_ref", {
    enterpriseId: new URL(request.url).searchParams.get("enterpriseId"),
  });

  if (!esteira) {
    return NextResponse.json({ error: "Ficha não encontrada na esteira." }, { status: 404 });
  }

  const enterpriseId = normalizarEnterpriseId(esteira.enterprise_id);
  if (!enterpriseId) {
    return NextResponse.json(
      { error: "Esta CAD está sem empreendimento; não dá para emitir o PIX com segurança." },
      { status: 409 },
    );
  }
  if (esteira.pago_em) {
    return NextResponse.json(
      { error: "Esta ficha JÁ ESTÁ PAGA. Não gere o PIX de novo." },
      { status: 409 },
    );
  }
  // GUARD DE ETAPA — só a pré-venda tem PIX. Sem isto, chamar a rota para uma ficha em validação
  // (crédito ainda em análise) ou em revisão (reprovada) cobraria R$ 1.000 de quem não foi
  // aprovado. O disparo em massa filtra por etapa='prevenda'; aqui a checagem faz o mesmo papel.
  if (esteira.etapa !== "prevenda") {
    const onde =
      esteira.etapa === "revisao"
        ? "está em revisão de crédito"
        : esteira.etapa === "credito"
          ? "ainda está em análise de crédito"
          : esteira.etapa === "credenciado"
            ? "já passou da pré-venda"
            : "ainda está em validação";
    return NextResponse.json(
      { error: `Esta ficha ${onde}. O PIX só é gerado na etapa de pré-venda.` },
      { status: 409 },
    );
  }
  // Já tem cobrança de verdade (não uma reserva pendente): não cria outra.
  if (esteira.pagamento_ref && !esteira.pagamento_ref.startsWith("reservado:")) {
    return NextResponse.json({
      data: {
        jaExistia: true,
        mensagem: "Esta ficha já tinha o PIX emitido. Nada foi cobrado de novo.",
        paymentId: esteira.pagamento_ref,
      },
    });
  }
  // Reserva presa por uma tentativa que morreu no meio (timeout/crash). Uma reserva recente é um
  // disparo em andamento (bloqueia); uma ANTIGA é lixo e pode ser retomada — senão a ficha ficaria
  // travada para sempre, invisível a este botão e ao disparo em massa.
  const reservaAntiga = esteira.pagamento_ref?.startsWith("reservado:")
    ? esteira.pagamento_ref
    : null;
  if (reservaAntiga) {
    const carimbo = Number(reservaAntiga.split(":")[1] ?? 0);
    const idadeMs = Date.now() - carimbo;
    if (Number.isFinite(carimbo) && idadeMs >= 0 && idadeMs < 90_000) {
      return NextResponse.json(
        { error: "O PIX desta ficha já está sendo gerado. Aguarde e atualize a tela." },
        { status: 409 },
      );
    }
  }

  const { data: entidade } = await client
    .from("apolo_entities")
    .select("display_name, legal_name, document_masked")
    .eq("id", entityId)
    .maybeSingle<{
      display_name: string | null;
      document_masked: string | null;
      legal_name: string | null;
    }>();

  const nome = (entidade?.legal_name || entidade?.display_name || "").trim();
  if (!nome) {
    return NextResponse.json({ error: "A ficha não tem nome." }, { status: 422 });
  }

  // Documento em claro: sem CPF/CNPJ o Asaas não cria a cobrança.
  let documento = (entidade?.document_masked ?? "").replace(/\D/g, "");
  if (documento.length !== 11 && documento.length !== 14) {
    const { data: ids } = await client
      .from("apolo_entity_identifiers")
      .select("value_masked")
      .eq("entity_id", entityId)
      .in("identifier_type", ["cpf", "cnpj", "document"]);
    for (const i of (ids ?? []) as { value_masked: string | null }[]) {
      const d = (i.value_masked ?? "").replace(/\D/g, "");
      if (d.length === 11 || d.length === 14) {
        documento = d;
        break;
      }
    }
  }
  if (documento.length !== 11 && documento.length !== 14) {
    return NextResponse.json(
      { error: "A ficha não tem um CPF/CNPJ utilizável para gerar a cobrança." },
      { status: 422 },
    );
  }

  const empreendimento = (esteira.empreendimento || "Vale do Ouro").trim();

  // ⚠️ PRÉ-VENDA DESLIGADA NÃO COBRA (regra do Lucas, 10/08). Esta é a última porta antes do
  // Asaas: mesmo que sobre uma ficha residual na coluna Pré-venda, ou que alguém chame a rota
  // direto, não se emite cobrança de R$ 1.000 num empreendimento que não tem pré-venda. A regra é a
  // mesma do resto do sistema (flag ligada + valor definido), lida de uma fonte só.
  const prevendaHabilitada = await resolverPrevendaHabilitada(client, entityId, enterpriseId);
  if (!prevendaHabilitada) {
    return NextResponse.json(
      {
        error:
          "A pré-venda está desligada neste empreendimento, então não há cobrança a gerar. " +
          "Se ela deveria estar ativa, ligue o PIX em Empreendimentos (com o valor) antes.",
      },
      { status: 409 },
    );
  }

  // VALOR do PIX deste empreendimento (config no Board do empreendimento). Sem config, o padrão
  // da ação (R$ 1.000). É o que deixa o botão gerar o valor certo quando há mais de um
  // empreendimento ativo, cada um com o seu.
  const valor = (await getValorPix(client, enterpriseId)) ?? VALOR_PREVENDA;

  // TRAVA: reserva a ficha antes de tocar no Asaas. Só segue quem conseguir marcar — dois cliques
  // simultâneos, só um gera. Casa com `pagamento_ref IS NULL` OU com a reserva ANTIGA específica
  // (retomada de uma tentativa morta); a igualdade pelo valor exato mantém a corrida atômica.
  const reserva = `reservado:${Date.now()}`;
  let reservaQuery = client
    .from("apolo_esteira")
    .update({ pagamento_ref: reserva })
    .eq("entity_id", entityId)
    .eq("enterprise_id", enterpriseId);
  reservaQuery = reservaAntiga
    ? reservaQuery.eq("pagamento_ref", reservaAntiga)
    : reservaQuery.is("pagamento_ref", null);
  const { data: reservada } = await reservaQuery.select("entity_id");

  if (!reservada || reservada.length === 0) {
    return NextResponse.json(
      { error: "O PIX desta ficha já está sendo gerado. Aguarde e atualize a tela." },
      { status: 409 },
    );
  }

  // A partir daqui a reserva está gravada. Um erro solto deixaria a ficha travada com "reservado:"
  // — o try/catch garante que, no pior caso, a reserva seja liberada (só quando é seguro).
  try {
    const cobranca = await emitirCobrancaPix({
      cpfCnpj: documento,
      empreendimento,
      entityId,
      nome,
      valor,
    });

    if (!cobranca.ok) {
      if (cobranca.paymentId) {
        // A cobrança FOI criada (temos o id), só faltou o link. NÃO libera a reserva — grava o id
        // para não reemitir — e reporta para tratamento manual do link.
        await client
          .from("apolo_esteira")
          .update({ pagamento_ref: cobranca.paymentId })
          .eq("entity_id", entityId)
          .eq("enterprise_id", enterpriseId);
        return NextResponse.json(
          {
            error:
              "A cobrança foi criada, mas o Asaas não devolveu o link. A ficha ficou marcada para não cobrar de novo; recarregue o status para recuperar o link.",
          },
          { status: 502 },
        );
      }
      // Erro ANTES de criar a cobrança (cliente/validação): aí sim é seguro liberar a ficha.
      await client
        .from("apolo_esteira")
        .update({ pagamento_ref: null })
        .eq("entity_id", entityId)
        .eq("enterprise_id", enterpriseId)
        .eq("pagamento_ref", reserva);
      return NextResponse.json(
        { error: `Não foi possível emitir a cobrança: ${cobranca.erro}` },
        { status: 502 },
      );
    }

    // Grava a referência REAL por cima da reserva antes de enviar: se o envio morrer, a ficha não
    // é cobrada de novo.
    await client
      .from("apolo_esteira")
      .update({ pagamento_ref: cobranca.paymentId })
      .eq("entity_id", entityId)
      .eq("enterprise_id", enterpriseId);

    const envio = await enviarCobrancaPrevenda({
      admin: client,
      empreendimento,
      enterpriseId,
      entityId,
      link: cobranca.link,
      nome,
      paymentId: cobranca.paymentId,
      valorFmt: moedaBR(valor),
    });

    return NextResponse.json({
      data: {
        email: envio.email,
        jaExistia: false,
        paymentId: cobranca.paymentId,
        whatsapp: envio.whatsapp,
      },
    });
  } catch (e) {
    // Só chega aqui em erro inesperado (não os retornos ok:false da lib). Como não dá para saber
    // se a cobrança foi criada, o seguro é NÃO liberar a reserva: melhor uma ficha a destravar do
    // que uma pessoa cobrada duas vezes. A reserva antiga vira retomável depois de 90s.
    return NextResponse.json(
      {
        error: `Falha inesperada ao gerar o PIX: ${(e as Error).message}. Recarregue o status antes de tentar de novo.`,
      },
      { status: 500 },
    );
  }
}
