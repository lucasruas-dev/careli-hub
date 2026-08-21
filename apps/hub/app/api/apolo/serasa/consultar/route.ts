import { NextResponse } from "next/server";

import { authorizeApoloWrite } from "@/lib/apolo/auth";
import { avisarImobReprovado } from "@/lib/apolo/disparo-imobiliaria";
import { lerCadDaEsteira } from "@/lib/apolo/esteira-cad";
import { cpfValido } from "@/lib/apolo/documento";
import { destinoAposCredito } from "@/lib/apolo/destino-credito";
import { atualizarEtapa } from "@/lib/apolo/esteira";
import {
  resolverAnaliseHabilitada,
  resolverLimiteCredito,
  resolverPrevendaHabilitada,
} from "@/lib/apolo/limite-credito";
import { comLimiteDeTempo, gerarESalvarCad } from "@/lib/apolo/salvar-cad";
import { createApoloAdminClient } from "@/lib/apolo/server";
import { gerarESalvarComprovante } from "@/lib/serasa/comprovante";
import { avaliarCredito } from "@/lib/serasa/avaliacao";
import { consultarPF, consultarPJ } from "@/lib/serasa/client";
import { ambienteConfere, lerConfigSerasa } from "@/lib/serasa/config";
import { resumirRelatorio } from "@/lib/serasa/resumo";

// CONSULTA DE CRÉDITO no Serasa — o caminho que gasta dinheiro.
//
// GET  = SITUAÇÃO, custo zero: diz se está configurado, em que ambiente, se já existe consulta
//        recente do mesmo documento e quantas chamadas já saíram hoje.
// POST = CONSULTA de verdade. Exige `confirmado`.
//
// Mesma disciplina da MOST: orçamento e confirmação antes de qualquer chamada paga.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

// Homologação bloqueia o IP acima de 200 chamadas/dia. Paramos antes, com folga, porque o
// bloqueio é por IP e derrubaria outros serviços que saem pelo mesmo endereço.
const TETO_DIARIO_HOMOLOGACAO = 150;

// Consulta do mesmo documento dentro deste prazo é reaproveitada em vez de cobrada de novo.
// 30 dias é o palpite conservador enquanto o Serasa não responde se existe janela comercial.
const DIAS_REAPROVEITAMENTO = 30;

type Corpo = {
  // De QUEM é a consulta. "titular" é o dono da ficha (comportamento de sempre); "conjuge" usa
  // o CPF do cônjuge que está na ficha da esteira, para o caso de compra em casal.
  alvo?: "titular" | "conjuge";
  confirmado?: boolean;
  // De QUAL CAD é a consulta. Desde a 0080 a pessoa pode ter CAD em vários empreendimentos, e
  // limite de crédito, pré-venda e etapa são configuração DO EMPREENDIMENTO. Sem ele, a CAD mais
  // recente (mesmo default do Board, que hoje mostra um card por pessoa).
  enterpriseId?: null | number | string;
  entityId?: string;
  finalidade?: string;
  forcar?: boolean;
  optionalFeatures?: string[];
  reportName?: string;
};

async function situacao(client: NonNullable<ReturnType<typeof createApoloAdminClient>>, documento: string) {
  const desde = new Date(Date.now() - DIAS_REAPROVEITAMENTO * 24 * 3600 * 1000).toISOString();

  const [{ data: recente }, { count: hoje }] = await Promise.all([
    client
      .from("serasa_consultas")
      .select("id, created_at, ambiente, resumo, report_name, resposta")
      .eq("documento", documento)
      .eq("status", "sucesso")
      .gte("created_at", desde)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    client
      .from("serasa_consultas")
      .select("id", { count: "exact", head: true })
      .gte("created_at", new Date().toISOString().slice(0, 10)),
  ]);

  return { consultasHoje: hoje ?? 0, recente: recente ?? null };
}

// Só ADMIN reenvia o aviso de reprovação. Em dev sem sessão real (userId sintético), libera.
async function viewerEhAdmin(
  client: NonNullable<ReturnType<typeof createApoloAdminClient>>,
  userId: string,
): Promise<boolean> {
  if (!/^[0-9a-f-]{36}$/i.test(userId)) return true;
  const { data } = await client
    .from("hub_users")
    .select("role")
    .eq("id", userId)
    .maybeSingle<{ role: string }>();
  return data?.role === "admin";
}

// Devolutiva dos avisos de reprovação já enviados nesta ficha (mais recentes primeiro).
async function listarDisparos(
  client: NonNullable<ReturnType<typeof createApoloAdminClient>>,
  entityId: string,
) {
  const { data } = await client
    .from("apolo_disparos")
    .select(
      "tipo, destinatario, telefone, status, origem, erro, sent_at, delivered_at, read_at, created_at",
    )
    .eq("entity_id", entityId)
    .order("created_at", { ascending: false })
    .limit(10);
  return data ?? [];
}

// Etapa PERSISTIDA da esteira. É ela — não o veredito recomputado — que diz se o cliente está
// reprovado no crédito ("revisao"). A tela usa isto para decidir se mostra o aviso de reprovação e
// os botões de reenvio, imune a mudança de limite ou indisponibilidade do C2X.
async function lerEtapaEsteira(
  client: NonNullable<ReturnType<typeof createApoloAdminClient>>,
  entityId: string,
  enterpriseId?: unknown,
): Promise<string | null> {
  const data = await lerCadDaEsteira<{ etapa: string | null }>(client, entityId, "etapa", {
    enterpriseId,
  });
  return data?.etapa ?? null;
}

export async function GET(request: Request) {
  const auth = await authorizeApoloWrite(request);
  if (!auth.ok) return auth.response;

  const client = createApoloAdminClient();
  if (!client) return NextResponse.json({ error: "Supabase indisponivel." }, { status: 503 });

  // Recebe a FICHA, não o documento: o CPF sai do cadastro, nunca da query string (não vaza
  // em log de proxy, e ninguém consulta um documento arbitrário por esta rota).
  const url = new URL(request.url);
  const entityId = url.searchParams.get("entityId") ?? "";
  const enterpriseId = url.searchParams.get("enterpriseId");

  let documento = "";
  if (entityId) {
    const { data: entidade } = await client
      .from("apolo_entities")
      .select("document_masked")
      .eq("id", entityId)
      .maybeSingle<{ document_masked: string | null }>();
    documento = (entidade?.document_masked ?? "").replace(/\D/g, "");
  }

  const cfg = lerConfigSerasa();
  if (!cfg.ok) {
    return NextResponse.json({
      data: { configurado: false, faltando: cfg.faltando },
    });
  }

  const coerente = ambienteConfere(cfg.config);
  const { consultasHoje, recente } = documento
    ? await situacao(client, documento)
    : { consultasHoje: 0, recente: null };

  // Veredito calculado do cru salvo: aprovado/reprovado pela regra do empreendimento. O limite
  // sai do empreendimento do cliente (best-effort); sem limite próprio, cai no padrão R$ 1.000.
  const cru = (recente as { resposta?: unknown } | null)?.resposta ?? null;
  const limiteResolvido = entityId
    ? await resolverLimiteCredito(client, entityId, enterpriseId)
    : null;
  const veredito = cru ? avaliarCredito(cru, limiteResolvido ?? 1000) : null;

  // Papel do viewer + etapa persistida + histórico de disparos: o REENVIO do aviso é só de ADMIN, o
  // painel de reprovação se guia pela ETAPA (não pelo veredito recomputado), e a tela mostra a
  // devolutiva de entrega (enviado/entregue/lido) de cada envio já feito nesta ficha.
  const ehAdmin = await viewerEhAdmin(client, auth.userId);
  const [disparos, etapa] = entityId
    ? await Promise.all([listarDisparos(client, entityId), lerEtapaEsteira(client, entityId)])
    : [[], null];

  // CÔNJUGE: a tela precisa saber se o botão de consultar o cônjuge deve aparecer, e o estado
  // civil mora na ficha da esteira. Casado = 2, união estável = 6 (tabela do C2X).
  // Mandamos só se É casado e se TEM CPF do cônjuge — o CPF em si nunca sai daqui.
  const fichaEsteira = entityId
    ? await lerCadDaEsteira<{ ficha: Record<string, unknown> | null }>(client, entityId, "ficha", {
        enterpriseId,
      })
    : null;

  const estadoCivil = String(fichaEsteira?.ficha?.estadoCivilId ?? "");
  const cpfDoConjuge = String(fichaEsteira?.ficha?.conjugeCpf ?? "").replace(/\D/g, "");
  const conjuge = {
    // Nome só para a tela dizer de quem é a consulta; pode vir vazio (só 6 fichas têm).
    nome: String(fichaEsteira?.ficha?.conjugeNome ?? ""),
    temCpf: cpfDoConjuge.length === 11,
    temConjuge: ["2", "6"].includes(estadoCivil),
  };

  return NextResponse.json(
    {
      data: {
        ambiente: cfg.config.ambiente,
        avisoAmbiente: coerente.ok ? null : coerente.erro,
        configurado: true,
        conjuge,
        consultasHoje,
        disparos,
        ehAdmin,
        etapa,
        // Em homologação a conta é contra o teto do IP; em produção, informativa.
        tetoDiario: cfg.config.ambiente === "homologacao" ? TETO_DIARIO_HOMOLOGACAO : null,
        ultimaConsulta: recente ? { ...recente, veredito } : null,
      },
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: Request) {
  const auth = await authorizeApoloWrite(request);
  if (!auth.ok) return auth.response;

  const client = createApoloAdminClient();
  if (!client) return NextResponse.json({ error: "Supabase indisponivel." }, { status: 503 });

  const corpo = (await request.json().catch(() => ({}))) as Corpo;

  if (!corpo.confirmado) {
    return NextResponse.json(
      { error: "Esta acao CONSULTA O SERASA e pode ser cobrada. Confirme na tela." },
      { status: 428 },
    );
  }
  if (!corpo.entityId) {
    return NextResponse.json({ error: "Informe a ficha." }, { status: 400 });
  }

  const cfg = lerConfigSerasa();
  if (!cfg.ok) {
    return NextResponse.json(
      { error: `Integracao nao configurada. Falta: ${cfg.faltando.join(", ")}.` },
      { status: 503 },
    );
  }

  const coerente = ambienteConfere(cfg.config);
  if (!coerente.ok) {
    return NextResponse.json({ error: coerente.erro }, { status: 409 });
  }

  // De quem é a consulta: o documento vem da ficha, nunca do corpo da requisição — assim
  // ninguém consulta um CPF arbitrário por esta rota.
  const { data: entidade } = await client
    .from("apolo_entities")
    .select("id, display_name, document_masked, entity_kind")
    .eq("id", corpo.entityId)
    .maybeSingle<{
      display_name: string;
      document_masked: string | null;
      entity_kind: string;
      id: string;
    }>();

  if (!entidade) return NextResponse.json({ error: "Ficha nao encontrada." }, { status: 404 });

  // CÔNJUGE (pedido do Lucas 27/07): quando o cliente é casado, dá pra consultar também quem
  // compra junto. O CPF sai da FICHA da esteira (`ficha.conjugeCpf`), nunca do corpo da
  // requisição — mesma regra do titular: ninguém consulta um CPF arbitrário por esta rota.
  //
  // O cônjuge não é entidade própria no Apolo, é campo dentro da ficha do titular. Por isso a
  // consulta é sempre PF e o registro fica pendurado no `entity_id` do titular, separado pela
  // `finalidade`.
  const ehConjuge = corpo.alvo === "conjuge";
  let documentoDoConjuge = "";

  if (ehConjuge) {
    // ⚠️ CONSULTA PAGA. O CPF do cônjuge sai da FICHA — e a ficha é POR CAD. Sem escopo, uma
    // pessoa com CAD em dois loteamentos poderia ter o cônjuge de uma ficha consultado na outra.
    const esteira = await lerCadDaEsteira<{ ficha: Record<string, unknown> | null }>(
      client,
      entidade.id,
      "ficha",
      { enterpriseId: corpo.enterpriseId },
    );

    const bruto = esteira?.ficha?.conjugeCpf;
    documentoDoConjuge = typeof bruto === "string" ? bruto.replace(/\D/g, "") : "";

    // O aviso que o Lucas pediu: sem CPF do cônjuge não há o que consultar, e a mensagem diz
    // onde resolver. Hoje 80 dos 103 casados do Vale do Ouro caem aqui.
    if (!documentoDoConjuge) {
      return NextResponse.json(
        {
          error:
            "Sem o CPF do conjuge nao da para consultar. Preencha o CPF do conjuge na ficha " +
            "do cliente e tente de novo.",
        },
        { status: 412 },
      );
    }
  }

  const documento = ehConjuge
    ? documentoDoConjuge
    : (entidade.document_masked ?? "").replace(/\D/g, "");
  const ehPj = !ehConjuge && entidade.entity_kind === "pj";
  const tamanhoEsperado = ehPj ? 14 : 11;

  if (documento.length !== tamanhoEsperado) {
    return NextResponse.json(
      {
        error: ehConjuge
          ? `O CPF do conjuge na ficha esta incompleto (${documento.length} digitos). ` +
            "Corrija na ficha do cliente e tente de novo."
          : `A ficha nao tem ${ehPj ? "CNPJ" : "CPF"} completo para consultar ` +
            `(${documento.length} digitos). Complete o cadastro antes.`,
      },
      { status: 412 },
    );
  }

  // SEM CAD NA ESTEIRA A CONSULTA NÃO TEM PARA ONDE IR — e ela é PAGA (Lucas, 10/08: "cliente
  // que já teve análise de crédito feito voltando para validação").
  //
  // `atualizarEtapa` recusa gravar quando não há empreendimento (esteira.ts:148), de propósito, para
  // não criar CAD órfã. Só que a consulta já tinha sido feita e cobrada, e a resposta ainda dizia
  // que a ficha avançou. Na recarga do Board o card volta para Validação, porque não existe linha na
  // esteira para dizer onde ele está. Foi exatamente o que aconteceu com uma ficha do Vale do Ouro:
  // QUATRO consultas cobradas (04/08, 06/08, 07/08 e 10/08), a tela dizendo "avançou" toda vez, e o
  // card de volta em Validação toda vez.
  //
  // Barramos ANTES de gastar, com a saída escrita na mensagem: o empreendimento se informa no
  // cadastro. A leitura é a mesma da esteira (CAD do empreendimento pedido, ou a mais recente).
  const cadDoCredito = await lerCadDaEsteira<{ enterprise_id: null | string }>(
    client,
    entidade.id,
    "enterprise_id",
    { enterpriseId: corpo.enterpriseId },
  );
  if (!(cadDoCredito?.enterprise_id ?? "").trim()) {
    return NextResponse.json(
      {
        error:
          "Esta ficha não tem CAD com empreendimento na esteira, então o resultado do crédito não " +
          "teria onde ser gravado (e a ficha voltaria para a Validação). Informe o empreendimento " +
          "no cadastro antes de consultar.",
      },
      { status: 409 },
    );
  }

  // Dígito verificador do CPF: a MOST às vezes lê um dígito errado (ex.: 106… no lugar de 166…) e
  // a ficha nasce com CPF impossível. O Serasa rejeita com 412 "[X-Document-Id] inválido" e a
  // chamada pode ser COBRADA — barramos ANTES de gastar. (CNPJ tem regra própria; aqui é PF.)
  if (!ehPj && !cpfValido(documento)) {
    return NextResponse.json(
      {
        error:
          "O CPF da ficha é inválido (o dígito verificador não confere). Corrija o CPF na " +
          "validação antes de consultar o crédito.",
      },
      { status: 412 },
    );
  }

  // ANÁLISE DE CRÉDITO DESLIGADA no empreendimento: o lançamento não faz crédito, então NÃO
  // consultamos o Serasa (consulta é paga). A ficha com documento OK avança direto — pré-venda se
  // ela estiver ligada, senão credenciado. Mesmo destino de um "aprovado", só que sem consulta.
  const analiseHabilitada = await resolverAnaliseHabilitada(client, entidade.id, corpo.enterpriseId);
  if (!analiseHabilitada) {
    const prevendaHabilitada = await resolverPrevendaHabilitada(
      client,
      entidade.id,
      corpo.enterpriseId,
    );
    // Sem consulta = tratamos como "aprovado" (documento OK), então o destino segue a MESMA regra
    // do crédito aprovado: prevenda se ligada, senão credenciado (PROBLEMA 1, Lucas 04/08).
    const destino = destinoAposCredito({ aprovado: true, prevendaHabilitada });
    const transicao = await atualizarEtapa(client, entidade.id, destino, {
      atualizadoPor: auth.userId,
      automatico: true,
      enterpriseId: corpo.enterpriseId ?? null,
      motivo: "Análise de crédito desligada no empreendimento — avançou sem consulta.",
      nuncaRebaixar: true,
    });

    // A ETAPA GRAVOU? Se não, a resposta NÃO pode dizer que avançou (ver o bloco do "sem CAD" mais
    // acima). Devolver o alvo calculado como se fosse o gravado é o que fazia a tela mover o card e
    // o reload trazer ele de volta.
    if (transicao.error) {
      return NextResponse.json(
        { error: transicao.error },
        { status: transicao.semCad || transicao.bloqueado ? 409 : 500 },
      );
    }

    return NextResponse.json({
      data: {
        analisePulada: true,
        etapa: transicao.etapa,
        mensagem:
          "Análise de crédito desligada neste empreendimento. A ficha avançou sem consulta ao Serasa.",
        reaproveitada: false,
      },
    });
  }

  // O RELATÓRIO é escolhido pelo TIPO da ficha, no servidor — a tela não decide. PF e PJ são
  // serviços diferentes no Serasa, com relatórios de nomes diferentes; mandar o relatório de PF
  // numa consulta PJ dá "report not found" (412). Cada tipo tem a sua env própria.
  const overrideTela = corpo.reportName?.trim() || null;
  const reportName = ehPj
    ? // PJ: a env é a fonte da verdade. O override da tela só entra se NÃO for um nome de PF
      // (o front hoje manda RELATORIO_BASICO_PF_PME por padrão — esse nunca vale para PJ).
      process.env.SERASA_REPORT_PJ?.trim() ||
      (overrideTela && !/PF|PME/i.test(overrideTela) ? overrideTela : null)
    : // PF: mantém o que já funcionava — env, senão o que a tela manda, senão o default.
      process.env.SERASA_REPORT_PF?.trim() || overrideTela || "RELATORIO_BASICO_PF_PME";

  if (!reportName) {
    return NextResponse.json(
      {
        error:
          "Consulta de PJ ainda nao configurada: falta o NOME do relatorio PJ contratado no " +
          "Serasa. Defina a variavel de ambiente SERASA_REPORT_PJ com a grafia exata do relatorio " +
          "(ex.: RELATORIO_BASICO_PJ) e a consulta de CNPJ passa a rodar.",
      },
      { status: 412 },
    );
  }

  const { consultasHoje, recente } = await situacao(client, documento);

  // Trava de duplicidade: consulta recente do mesmo documento é reaproveitada, a não ser que
  // se peça explicitamente uma nova (e aí a tela já avisou que gera cobrança).
  if (recente && !corpo.forcar) {
    return NextResponse.json({
      data: { consultaAnterior: recente, reaproveitada: true },
    });
  }

  // Teto diário: em homologação, estourar bloqueia o IP e a liberação exige formalização.
  if (cfg.config.ambiente === "homologacao" && consultasHoje >= TETO_DIARIO_HOMOLOGACAO) {
    return NextResponse.json(
      {
        error:
          `Teto diario de homologacao atingido (${consultasHoje}). O Serasa bloqueia o IP ` +
          `acima de 200 chamadas por dia. Tente amanha.`,
      },
      { status: 429 },
    );
  }

  const entrada = {
    documento,
    optionalFeatures: corpo.optionalFeatures ?? [],
    reportName,
  };

  const resposta = ehPj
    ? await consultarPJ(cfg.config, entrada)
    : await consultarPF(cfg.config, entrada);

  // Grava SEMPRE, inclusive o erro: a chamada pode ter sido cobrada mesmo falhando, e sem
  // registro ninguém consegue reconciliar a fatura depois.
  const registro = {
    ambiente: cfg.config.ambiente,
    cost_center: cfg.config.costCenter,
    documento,
    entity_id: entidade.id,
    erro: resposta.ok ? null : resposta.erro,
    // Separa as duas consultas do mesmo cliente sem precisar de coluna nova: `entity_id` é o
    // titular nos dois casos, e a finalidade diz de quem é o resultado.
    finalidade: ehConjuge
      ? "analise-credito-conjuge"
      : corpo.finalidade?.trim() || "analise-credito-cad",
    http_status: resposta.httpStatus,
    optional_features: entrada.optionalFeatures,
    report_name: entrada.reportName,
    resposta: resposta.ok ? resposta.corpo : null,
    resumo: resposta.ok ? resumirRelatorio(resposta.corpo) : {},
    solicitado_por: /^[0-9a-f-]{36}$/i.test(auth.userId) ? auth.userId : null,
    status: resposta.ok ? "sucesso" : "erro",
    tipo_pessoa: ehPj ? "pj" : "pf",
  };

  const { data: gravada } = await client
    .from("serasa_consultas")
    .insert(registro)
    .select("id, created_at, resumo, ambiente")
    .maybeSingle();

  if (!resposta.ok) {
    return NextResponse.json(
      { error: resposta.erro, registroId: (gravada as { id: string } | null)?.id ?? null },
      { status: resposta.httpStatus ?? 502 },
    );
  }

  // GATILHO DA ESTEIRA: o resultado do crédito move a etapa automaticamente. Aprovado segue para
  // a PRÉ-VENDA (sem rebaixar quem já passou); reprovado vai para "Crédito em revisão" com o
  // motivo, de onde só o coordenador/admin destrava. A decisão é do servidor, não da tela: é o
  // ponto autoritativo, logo depois de gravar a consulta.
  // O limite vem do EMPREENDIMENTO do cliente (best-effort); sem limite próprio, padrão R$ 1.000.
  //
  // ⚠️ `automatico: true` = SEM REGRESSÃO. Quem já está em pré-venda ou credenciado não é movido
  // por reconsulta: ou o coordenador já liberou o crédito, ou a pessoa já PAGOU. Sem essa trava,
  // reconsultar uma ficha credenciada a devolvia para revisão e desfazia a decisão humana.
  const limiteResolvido = await resolverLimiteCredito(client, entidade.id, corpo.enterpriseId);
  const veredito = avaliarCredito(resposta.corpo, limiteResolvido ?? 1000);

  // CONGELA O VEREDITO NA CONSULTA — "a etapa tem que ser marcada" (Lucas, 21/08).
  //
  // ⚠️ ATÉ AQUI O RESULTADO NÃO ERA GUARDADO EM LUGAR NENHUM: ele era RECALCULADO a cada leitura
  // (aqui e no GET) a partir do JSON cru, usando o limite ATUAL do empreendimento. Como esse
  // limite é editável, o mesmo relatório podia virar APROVADO no dia seguinte sem ninguém
  // reconsultar nada — e o contrário também. O único rastro da decisão era a etapa.
  //
  // Guardado junto do `resumo` para não custar coluna nova. Best-effort e DEPOIS do insert: a
  // consulta já foi cobrada e gravada, e um carimbo que falha não pode derrubá-la.
  const idConsulta = (gravada as { id?: string } | null)?.id ?? null;
  if (idConsulta) {
    try {
      const resumoAtual = ((gravada as { resumo?: Record<string, unknown> } | null)?.resumo ??
        {}) as Record<string, unknown>;
      await client
        .from("serasa_consultas")
        .update({
          resumo: {
            ...resumoAtual,
            veredito: {
              aprovado: veredito.aprovado,
              avaliadoEm: new Date().toISOString(),
              // O limite VIGENTE no momento da decisão. É ele que explica, meses depois, por que
              // esta consulta reprovou e outra igual passou.
              limite: limiteResolvido ?? 1000,
              motivo: veredito.motivo ?? null,
            },
          },
        })
        .eq("id", idConsulta);
    } catch {
      /* segue: o veredito volta a ser recomputado, como era antes */
    }
  }
  // Pré-venda DESLIGADA no empreendimento (ex.: fila já montada, PIX encerrado): o aprovado vai
  // DIRETO para credenciado, sem gerar PIX. Ligada (padrão) segue para pré-venda como sempre.
  const prevendaHabilitada = await resolverPrevendaHabilitada(
    client,
    entidade.id,
    corpo.enterpriseId,
  );
  // Destino pela regra única (PROBLEMA 1 + 2, Lucas 04/08): aprovado -> prevenda se ligada, senão
  // credenciado; reprovado -> revisao (trava). Antes o `? "prevenda" : "credenciado"` vivia
  // repetido aqui e no caminho da análise desligada — agora é `destinoAposCredito`.
  const destino = destinoAposCredito({ aprovado: veredito.aprovado, prevendaHabilitada });
  // O CÔNJUGE SÓ AJUDA, NUNCA ATRAPALHA (regra do Lucas, 27/07):
  //   • titular reprovado -> ficha vai para "Crédito em revisão", como sempre;
  //   • cônjuge aprovado  -> RESGATA a ficha e o credenciamento segue, porque a renda que
  //     sustenta a compra é a dele;
  //   • cônjuge reprovado -> não mexe em nada. A ficha já está em revisão pelo titular, e se o
  //     titular tinha sido aprovado seria errado derrubá-lo por causa do cônjuge: quem tem
  //     crédito é ele.
  //
  // O `nuncaRebaixar` continua valendo, então nem o resgate nem a aprovação normal desfazem
  // decisão humana de quem já está em pré-venda ou credenciado.
  const conjugeResgata = ehConjuge && veredito.aprovado;
  const transicao =
    ehConjuge && !conjugeResgata
      ? null
      : await atualizarEtapa(
          client,
          entidade.id,
          destino,
          {
            atualizadoPor: auth.userId,
            automatico: true,
            enterpriseId: corpo.enterpriseId ?? null,
            motivo: conjugeResgata
              ? "Crédito aprovado pelo cônjuge."
              : veredito.aprovado
                ? undefined
                : `Crédito reprovado. ${veredito.motivo}`,
            nuncaRebaixar: veredito.aprovado,
          },
        );

  // DISPARO AUTOMÁTICO da reprovação: reprovou -> avisa o coordenador do empreendimento (sempre) e
  // o corretor (se tiver telefone), com a CAD anexa, pela Iris. Best-effort: falha no disparo NÃO
  // derruba a consulta (que já foi cobrada e gravada) — o resultado vai na resposta pra tela
  // mostrar, e o reenvio manual cobre o que falhar. Só dispara em disparo genuíno, não no reaproveitamento.
  //
  // ⚠️ Só avisa se a ficha REALMENTE foi para revisão. Quando a etapa é mantida (a pessoa já está
  // em pré-venda/credenciado, protegida contra regressão), avisar de novo seria dizer ao
  // coordenador que um cliente já aprovado — ou que já pagou — foi reprovado.
  // Cônjuge reprovado não avisa ninguém: `transicao` é null e a ficha não mudou de etapa —
  // avisar sem mudar seria alarme falso. Cônjuge aprovado também não cai aqui (é aprovação).
  // A ETAPA GRAVOU? A consulta já foi feita e cobrada, então aqui não se devolve erro seco: o
  // resultado do crédito vai na resposta de qualquer jeito. O que NÃO pode acontecer é a resposta
  // afirmar uma etapa que o banco não tem — a tela move o card e o próximo reload desfaz. Quando
  // não gravou, `etapa` volta null e o aviso vai junto, para a tela dizer o que resolver.
  const etapaNaoGravada = transicao?.error ?? null;

  let disparo = null;
  // ⚠️ Não avisa ninguém sem gravação (era a task #38): dizer ao coordenador que o cliente foi para
  // revisão, quando a esteira não registrou nada, é criar trabalho para uma ficha que a tela vai
  // mostrar em Validação de novo no minuto seguinte.
  if (transicao && !etapaNaoGravada && !veredito.aprovado && !transicao.mantida) {
    // ⚠️ O AVISO NÃO SAI MAIS DAQUI. Ele agora é disparado por `atualizarEtapa`, que é o ponto
    // autoritativo de escrita de etapa, e vem de volta em `transicao.aviso`.
    //
    // Regra do Lucas (21/08): *"reforço que os disparos têm que ser feitos pelo número do
    // relacionamento"*. O caminho antigo (`dispararReprovacao`) saía do 4143 com template da Meta
    // — e o ramo do CORRETOR ali era estruturalmente morto: lia `metadata.phone` do vínculo do
    // cliente, campo vazio em 718 de 718 CADs, o que explica `apolo_disparos` ter 2.249 linhas e
    // ZERO do tipo `corretor`. O caminho novo lê `corretor_entity_id` e cai na imobiliária quando
    // o corretor não está vinculado.
    //
    // O PDF da CAD continua indo junto para o coordenador — `esteira-avisos` anexa na `revisao`.
    disparo = transicao.aviso ?? null;

    // Avisa também a IMOBILIÁRIA (só o STATUS, nunca o valor do crédito). Best-effort próprio.
    //
    // ⚠️ CONTINUA SEPARADO de propósito: este aviso é do fluxo da imobiliária (outro texto, outro
    // destinatário resolvido por outro caminho) e sobrevive mesmo quando a CAD não tem corretor.
    try {
      await avisarImobReprovado(client, entidade.id);
    } catch {
      /* segue */
    }
  }

  // COMPROVANTE da consulta + CAD da ficha: ambos gerados e salvos na pasta do cliente,
  // automaticamente (pedido do Lucas). Best-effort — falha aqui não derruba a consulta já cobrada
  // e gravada. Todo resultado (aprovado ou reprovado) tem comprovante e CAD.
  // ⚠️ NADA DISSO RODA PARA O CÔNJUGE. Comprovante e CAD são documentos DO TITULAR e são
  // montados a partir da "última consulta da ficha". Como a consulta do cônjuge fica gravada no
  // entity_id do titular, gerar aqui produziria: (1) uma CAD do titular carimbada com o
  // resultado do cônjuge — apagando a anterior, porque salvar-cad substitui a automática; e
  // (2) um comprovante com o NOME do titular e o CPF, o score e as restrições do cônjuge, ou
  // seja, um documento falso, com QR de verificação, salvo na pasta do cliente.
  const idGravada = ehConjuge ? null : (gravada as { id?: string } | null)?.id;
  if (idGravada) {
    const quem = /^[0-9a-f-]{36}$/i.test(auth.userId) ? "Análise de crédito" : null;
    // Best-effort E com teto de tempo: a consulta já foi cobrada e gravada; comprovante e CAD não
    // podem estourar o maxDuration (504) sob C2X lento. O que não der tempo é gerado depois (a
    // próxima transição regenera a CAD; o botão baixa/gera o comprovante).
    try {
      await comLimiteDeTempo(gerarESalvarComprovante(client, idGravada, { uploadedByName: quem }), 15000);
    } catch {
      /* segue */
    }
    try {
      await comLimiteDeTempo(
        gerarESalvarCad(client, entidade.id, {
          enterpriseId: corpo.enterpriseId ?? null,
          uploadedByName: quem,
        }),
        15000,
      );
    } catch {
      /* segue */
    }
  }

  return NextResponse.json({
    data: {
      alvo: ehConjuge ? "conjuge" : "titular",
      consulta: gravada,
      disparo,
      etapa: etapaNaoGravada ? null : (transicao?.etapa ?? null),
      // Preenchido só quando a esteira RECUSOU a gravação. A tela mostra como aviso, e não move
      // o card: melhor a consulta aparecer sem etapa do que a etapa aparecer sem existir.
      etapaNaoGravada,
      reaproveitada: false,
      veredito,
    },
  });
}
