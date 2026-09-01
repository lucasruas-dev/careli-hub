import { NextResponse } from "next/server";

import { type ContaAsaas, chaveDaConta, rotuloDaConta } from "@/lib/apolo/asaas-contas";
import {
  documentoMascarado,
  documentosDeVarios,
  documentosDoEmpreendimento,
} from "@/lib/apolo/boletos/documentos";
import {
  acharOuCriarCliente,
  apenasDaCompetencia,
  atualizarCobranca,
  cancelarCobranca,
  cobrancasDaReferencia,
  criarBoleto,
  impedimentosDaConta,
  lerReferencia,
  listarCobrancas,
  situacaoCadastral,
} from "@/lib/apolo/boletos/emissao";
import { historicoDoBoleto, registrarEvento } from "@/lib/apolo/boletos/eventos";
import {
  type CanalDoDisparo,
  dispararBoleto,
  previaDoBoleto,
  registrarDisparo,
} from "@/lib/apolo/boletos/disparo";
import { empreendimentoPorSlug } from "@/lib/apolo/boletos/empreendimentos";
import {
  divergenciasDeNome,
  loteDaCompetencia,
  parcelasDaCompetencia,
} from "@/lib/apolo/boletos/parcelas";
import { carteirasDoPortal, portalEmiteBoletos, portalPodeEmitir } from "@/lib/apolo/boletos/portais";
import { autorizar } from "@/lib/apolo/incorporador/escopo";
import { createApoloAdminClient } from "@/lib/apolo/server";

// A EMISSÃO DE BOLETOS DENTRO DO PORTAL DO INCORPORADOR.
//
// Pedido do Lucas (01/09/2026): *"essa tela vai somente no perfil da CER e Cecilio (...) Nessa tela
// vamos emitir os boletos, gerar os pagamentos"*, e logo depois: *"não quero importar planilha, já
// traz isso pronto, vc já tem os dados pode montar a tela e ter o botão de gerar boleto e pronto"*.
//
// ⚠️ É A SEGUNDA ESCRITA EXTERNA DO PANTEON, e a mais séria: a primeira (a base do LSoft) corrige
// cadastro; esta cria cobrança em nome de outra empresa, num CNPJ que não é o nosso, e o Asaas não
// desfaz em lote. As travas:
//   1. só portais de `carteirasDoPortal` entram — lista explícita, não derivada de vínculo;
//   2. o empreendimento pedido é conferido contra a lista DAQUELE portal, a cada chamada;
//   3. o corpo do POST traz só competência e empreendimento: valor, CPF e vencimento vêm do banco;
//   4. ensaio por padrão — sem `confirmar: true` nada é criado no Asaas.
//
// ⚠️ A TRAVA 3 SUBSTITUIU UMA DEFESA. Antes a tela lia a planilha e mandava as linhas, e a rota
// reaplicava a regra por cima delas. Funcionava, mas mantinha um caminho em que o valor do boleto
// passava pelo navegador. Com a carteira no banco, esse caminho deixou de existir.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

function fora(): NextResponse {
  // 404, não 403: para quem não tem a aba, esta rota não existe.
  return NextResponse.json({ error: "Não encontrado." }, { status: 404 });
}

function intervaloDaCompetencia(competencia: string): { fim: string; inicio: string } {
  const [ano, mes] = competencia.split("-").map(Number) as [number, number];
  const ultimo = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  return { fim: `${competencia}-${ultimo}`, inicio: `${competencia}-01` };
}

/**
 * A cobrança está vencida?
 *
 * ⚠️ O STATUS DO ASAAS MANDA. Ele conhece o feriado e a compensação; derivar só da data marcaria como
 * vencido um boleto pago hoje que ainda não compensou.
 */
function estaVencido(situacao: string, vencimento: string, pagamento: null | string): boolean {
  if (pagamento) return false;
  if (situacao === "OVERDUE") return true;
  if (situacao === "RECEIVED" || situacao === "CONFIRMED" || situacao === "RECEIVED_IN_CASH") {
    return false;
  }
  return vencimento < new Date().toISOString().slice(0, 10);
}

// ── LEITURA: a carteira do mês e o que já foi emitido ───────────────────────

export async function GET(request: Request) {
  const auth = autorizar(request);
  if (!auth.ok) return auth.response;
  if (!portalEmiteBoletos(auth.sessao.slug)) return fora();

  const url = new URL(request.url);
  const competencia = (url.searchParams.get("competencia") ?? "").trim();
  if (!/^\d{4}-\d{2}$/.test(competencia)) {
    return NextResponse.json({ error: "competência deve ser AAAA-MM" }, { status: 400 });
  }

  const permitidos = carteirasDoPortal(auth.sessao.slug);

  // O HISTÓRICO DE UMA UNIDADE — o que o modal mostra ao clicar na linha.
  //
  // ⚠️ Chamada à parte, e não junto da listagem: o histórico exige uma consulta por unidade mais a
  // leitura do status de entrega, e carregá-lo para as 11 linhas de uma vez transformaria a abertura
  // da tela em dezenas de consultas para responder algo que ninguém pediu ainda.
  const historicoDe = (url.searchParams.get("historico") ?? "").trim();
  if (historicoDe) {
    const doEmpreendimento = (url.searchParams.get("empreendimento") ?? "").trim().toLowerCase();
    // A mesma trava do POST: sessão de um portal não lê o histórico da carteira de outro.
    if (!portalPodeEmitir(auth.sessao.slug, doEmpreendimento)) return fora();

    const [eventos, documentos] = await Promise.all([
      historicoDoBoleto({
        competencia,
        empreendimento: doEmpreendimento,
        unidade: historicoDe,
      }),
      documentosDoEmpreendimento(doEmpreendimento),
    ]);

    const cadastro = documentos.get(historicoDe);
    return NextResponse.json(
      {
        data: {
          // O telefone do cadastro, para o modal mostrar e permitir corrigir.
          contato: cadastro?.contato ?? null,
          eventos,
          nome: cadastro?.nome ?? null,
          unidade: historicoDe,
        },
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  const carteiras = permitidos.map((slug) => {
    const e = empreendimentoPorSlug(slug);
    return {
      conta: e?.conta ? rotuloDaConta(e.conta) : null,
      // A tela precisa dizer "falta a chave" em vez de mostrar a aba vazia.
      contaConfigurada: Boolean(e?.conta && chaveDaConta(e.conta)),
      nome: e?.nome ?? slug,
      slug,
    };
  });

  const comChave = permitidos
    .map(empreendimentoPorSlug)
    .filter((e) => e !== null)
    .filter((e) => e.conta && chaveDaConta(e.conta));

  // A CARTEIRA DO MÊS — o que a tela mostra antes de qualquer clique, e a razão de a planilha ter
  // saído do caminho.
  const [parcelas, documentos] = await Promise.all([
    parcelasDaCompetencia({ competencia, empreendimentos: permitidos }),
    documentosDeVarios(permitidos),
  ]);

  const aEmitir = parcelas.map((p) => {
    const cadastro = documentos.get(`${p.empreendimento}|${p.unidade}`);
    return {
      bloqueio:
        p.bloqueio ??
        (cadastro ? null : `sem CPF/CNPJ cadastrado para a unidade ${p.unidade}`),
      documento: cadastro ? documentoMascarado(cadastro.documento) : null,
      empreendimento: p.empreendimento,
      // O nome do cadastro quando existe: é ele que sai no boleto.
      nome: cadastro?.nome ?? p.nome,
      nomeNaPlanilha: p.nome,
      unidade: p.unidade,
      valor: p.valor,
      vencimentoDia: p.vencimentoDia,
    };
  });

  aEmitir.sort(
    (a, b) =>
      a.empreendimento.localeCompare(b.empreendimento) ||
      (a.vencimentoDia ?? 99) - (b.vencimentoDia ?? 99) ||
      a.unidade.localeCompare(b.unidade, "pt-BR", { numeric: true }),
  );

  // O QUE JÁ FOI EMITIDO, direto do Asaas.
  const contas = [...new Set(comChave.map((e) => e.conta as ContaAsaas))];
  const slugsPorConta = new Map<ContaAsaas, Set<string>>();
  for (const e of comChave) {
    const conta = e.conta as ContaAsaas;
    if (!slugsPorConta.has(conta)) slugsPorConta.set(conta, new Set());
    slugsPorConta.get(conta)!.add(e.slug);
  }

  const intervalo = intervaloDaCompetencia(competencia);
  const porChave = new Map(parcelas.map((p) => [`${p.empreendimento}|${p.unidade}`, p]));
  const boletos = [];
  const falhas: { conta: string; erro: string }[] = [];

  for (const conta of contas) {
    const lista = await listarCobrancas(conta, intervalo);
    if (!lista.ok) {
      falhas.push({ conta: rotuloDaConta(conta), erro: lista.erro });
      continue;
    }

    const destaConta = slugsPorConta.get(conta)!;
    for (const c of apenasDaCompetencia(lista.data, competencia)) {
      const ref = lerReferencia(c.externalReference);
      // ⚠️ A conta da CER serve cinco carteiras; um portal que só pudesse ver duas receberia as
      // outras de brinde se o filtro não estivesse aqui.
      if (!ref || !destaConta.has(ref.empreendimento)) continue;

      const cadastro = documentos.get(`${ref.empreendimento}|${ref.unidade}`);
      const pagamento = c.paymentDate ?? c.clientPaymentDate ?? null;

      const parcela = porChave.get(`${ref.empreendimento}|${ref.unidade}`);

      boletos.push({
        cobranca: c.id,
        // ⚠️ O TELEFONE INTEIRO, e não mascarado: é o campo que o operador confere quando o cliente
        // diz que não recebeu, e mascarado ele não serve para nada. Pedido do Lucas (01/09/2026):
        // *"pode trazer o numero de telefone"*.
        contato: cadastro?.contato ?? null,
        documento: cadastro ? documentoMascarado(cadastro.documento) : null,
        emissao: c.dateCreated ?? null,
        empreendimento: ref.empreendimento,
        link: c.bankSlipUrl ?? c.invoiceUrl ?? null,
        nome: cadastro?.nome ?? c.description ?? "(sem cadastro)",
        pagamento,
        situacao: c.status,
        unidade: ref.unidade,
        valor: c.value,
        vencido: estaVencido(c.status, c.dueDate, pagamento),
        vencimento: c.dueDate,
        // O aviso verde some ao recarregar; isto fica.
        whatsappEnviadoEm: parcela?.whatsappEnviadoEm ?? null,
        whatsappErro: parcela?.whatsappErro ?? null,
      });
    }
  }

  boletos.sort(
    (a, b) =>
      a.empreendimento.localeCompare(b.empreendimento) ||
      a.vencimento.localeCompare(b.vencimento) ||
      a.unidade.localeCompare(b.unidade, "pt-BR", { numeric: true }),
  );

  // ⚠️ A UNIDADE QUE JÁ TEM BOLETO SAI DA LISTA DE "A EMITIR". Sem isto ela apareceria nos dois
  // lados e o contador diria que faltam onze quando já saíram onze.
  const emitidas = new Set(boletos.map((b) => `${b.empreendimento}|${b.unidade}`));

  return NextResponse.json(
    {
      data: {
        aEmitir: aEmitir.map((p) => ({
          ...p,
          jaEmitido: emitidas.has(`${p.empreendimento}|${p.unidade}`),
        })),
        boletos,
        carteiras,
        competencia,
        falhas,
      },
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

// ── ESCRITA: emitir o lote ──────────────────────────────────────────────────

type Corpo = {
  /**
   * O que fazer:
   *   "emitir" (padrão) cria a cobrança no Asaas;
   *   "enviar"          manda o link ao cliente;
   *   "cancelar"        cancela a cobrança;
   *   "editar"          corrige valor, vencimento, descrição ou telefone.
   */
  acao?: unknown;
  /** Da edição: o que mudar. Campo ausente = não mexe naquele campo. */
  edicao?: unknown;
  /**
   * Da emissão: manda o link logo depois de criar cada boleto.
   *
   * ⚠️ Pedido do Lucas (01/09/2026): *"o disparo tem que ser automatico quando gerado o boleto"*. O
   * envio acontece POR BOLETO, logo após a criação de cada um, e a falha do envio NÃO desfaz a
   * emissão: o boleto existe, e o botão de reenviar resolve o que não saiu.
   */
  enviarAoEmitir?: unknown;
  /**
   * Por onde a mensagem sai. Padrão "template" (4143, com template aprovado).
   *
   * ⚠️ "relacionamento" é o 6065, via Evolution, que fala sem template porque não passa pela Meta.
   * Pedido do Lucas (01/09/2026) para testar antes de a Meta aprovar: *"vamos disparar pelo 6065 que
   * não precisa de template, só para ver se meu boleto vai ser gerado"* e *"só para o teste usar o
   * do relacionamento"*. A regra da casa é que CLIENTE recebe pelo Atendimento.
   */
  canal?: unknown;
  competencia?: unknown;
  confirmar?: unknown;
  empreendimento?: unknown;
  /** As unidades a emitir ou enviar. Ausente = todas as da carteira do mês. */
  unidades?: unknown;
};

export async function POST(request: Request) {
  const auth = autorizar(request);
  if (!auth.ok) return auth.response;
  if (!portalEmiteBoletos(auth.sessao.slug)) return fora();

  let corpo: Corpo;
  try {
    corpo = (await request.json()) as Corpo;
  } catch {
    return NextResponse.json({ error: "corpo inválido" }, { status: 400 });
  }

  const competencia = String(corpo.competencia ?? "").trim();
  if (!/^\d{4}-\d{2}$/.test(competencia)) {
    return NextResponse.json({ error: "competência deve ser AAAA-MM" }, { status: 400 });
  }

  const slug = String(corpo.empreendimento ?? "").trim().toLowerCase();
  // ⚠️ A CONFERÊNCIA MAIS IMPORTANTE DA ROTA: sem ela, sessão de um portal emitiria na carteira de
  // outro só mandando o slug no corpo.
  if (!portalPodeEmitir(auth.sessao.slug, slug)) return fora();

  const empreendimento = empreendimentoPorSlug(slug);
  if (!empreendimento?.conta || !chaveDaConta(empreendimento.conta)) {
    return NextResponse.json(
      { error: `a conta do Asaas de ${empreendimento?.nome ?? slug} não está configurada` },
      { status: 400 },
    );
  }

  const conta = empreendimento.conta;

  // ── CANCELAR A COBRANÇA ───────────────────────────────────────────────────
  //
  // ⚠️ CANCELAR NÃO DESFAZ O QUE O CLIENTE JÁ VIU. O boleto pode estar no aplicativo do banco ou
  // agendado; o cancelamento impede o pagamento futuro, e quem cancela precisa avisar a pessoa.
  if (String(corpo.acao ?? "") === "cancelar") {
    const unidade = Array.isArray(corpo.unidades)
      ? String((corpo.unidades as unknown[])[0] ?? "").trim()
      : "";
    if (!unidade) {
      return NextResponse.json({ error: "informe a unidade a cancelar" }, { status: 400 });
    }

    const cobrancas = await listarCobrancas(conta, intervaloDaCompetencia(competencia));
    if (!cobrancas.ok) {
      return NextResponse.json(
        { error: `não consegui ler as cobranças no Asaas: ${cobrancas.erro}` },
        { status: 502 },
      );
    }

    const alvo = apenasDaCompetencia(cobrancas.data, competencia).find((c) => {
      const ref = lerReferencia(c.externalReference);
      return ref?.empreendimento === slug && ref.unidade === unidade;
    });

    if (!alvo) {
      return NextResponse.json(
        { error: "não achei essa cobrança nesta competência" },
        { status: 404 },
      );
    }

    const r = await cancelarCobranca(conta, alvo.id);
    await registrarEvento({
      autor: auth.sessao.slug,
      cobrancaId: alvo.id,
      competencia,
      detalhe: r.ok ? null : r.erro,
      empreendimento: slug,
      ok: r.ok,
      tipo: "cancelamento",
      unidade,
    });

    if (!r.ok) return NextResponse.json({ error: r.erro }, { status: r.status || 502 });
    return NextResponse.json({ data: { cancelada: alvo.id, unidade } });
  }

  // ── EDITAR ────────────────────────────────────────────────────────────────
  //
  // ⚠️ O TELEFONE VAI PARA O NOSSO CADASTRO; VALOR, VENCIMENTO E DESCRIÇÃO VÃO PARA O ASAAS. São
  // dois destinos, e a distinção importa: corrigir o telefone não mexe na cobrança, e mudar o valor
  // faz o Asaas gerar um boleto NOVO, com outra linha digitável. Quem já recebeu o link precisa
  // receber de novo.
  if (String(corpo.acao ?? "") === "editar") {
    const e = (corpo.edicao ?? {}) as {
      descricao?: unknown;
      telefone?: unknown;
      valor?: unknown;
      vencimento?: unknown;
    };
    const unidade = Array.isArray(corpo.unidades)
      ? String((corpo.unidades as unknown[])[0] ?? "").trim()
      : "";
    if (!unidade) {
      return NextResponse.json({ error: "informe a unidade a editar" }, { status: 400 });
    }

    const mudou: string[] = [];

    // O telefone é nosso: muda no cadastro e vale do próximo envio em diante.
    if (typeof e.telefone === "string") {
      const supabase = createApoloAdminClient();
      if (supabase) {
        await supabase
          .from("boletos_documentos")
          .update({ atualizado_em: new Date().toISOString(), contato: e.telefone.trim() || null })
          .eq("workspace_id", "careli")
          .eq("empreendimento", slug)
          .eq("unidade", unidade);
        mudou.push("telefone");
      }
    }

    const naCobranca: { descricao?: string; valor?: number; vencimento?: string } = {};
    if (typeof e.valor === "number" && Number.isFinite(e.valor) && e.valor > 0) {
      naCobranca.valor = e.valor;
      mudou.push("valor");
    }
    if (typeof e.vencimento === "string" && /^\d{4}-\d{2}-\d{2}$/.test(e.vencimento)) {
      naCobranca.vencimento = e.vencimento;
      mudou.push("vencimento");
    }
    if (typeof e.descricao === "string" && e.descricao.trim()) {
      naCobranca.descricao = e.descricao.trim();
      mudou.push("descrição");
    }

    if (Object.keys(naCobranca).length > 0) {
      const cobrancas = await listarCobrancas(conta, intervaloDaCompetencia(competencia));
      if (!cobrancas.ok) {
        return NextResponse.json(
          { error: `não consegui ler as cobranças no Asaas: ${cobrancas.erro}` },
          { status: 502 },
        );
      }
      const alvo = apenasDaCompetencia(cobrancas.data, competencia).find((c) => {
        const ref = lerReferencia(c.externalReference);
        return ref?.empreendimento === slug && ref.unidade === unidade;
      });
      if (!alvo) {
        return NextResponse.json(
          { error: "o boleto ainda não foi emitido — não há o que corrigir no Asaas" },
          { status: 404 },
        );
      }

      const r = await atualizarCobranca(conta, alvo.id, naCobranca);
      if (!r.ok) return NextResponse.json({ error: r.erro }, { status: r.status || 502 });
    }

    if (mudou.length === 0) {
      return NextResponse.json({ error: "nada para mudar" }, { status: 400 });
    }

    return NextResponse.json({
      data: {
        mudou,
        // ⚠️ Valor ou vencimento novos = boleto novo no Asaas: a linha digitável antiga morreu.
        precisaReenviar: mudou.includes("valor") || mudou.includes("vencimento"),
        unidade,
      },
    });
  }

  // ── ENVIAR O LINK AO CLIENTE ──────────────────────────────────────────────
  //
  // ⚠️ SÓ MANDA O QUE JÁ FOI EMITIDO. O link vem do Asaas, e boleto que não existe não tem link:
  // sem esta leitura, o envio iria com o campo vazio e a Meta recusaria a mensagem inteira, ou pior,
  // o Evolution mandaria o texto com um buraco no meio da frase.
  if (String(corpo.acao ?? "") === "enviar") {
    const canal: CanalDoDisparo =
      String(corpo.canal ?? "") === "relacionamento" ? "relacionamento" : "template";

    const pedidas = Array.isArray(corpo.unidades)
      ? new Set((corpo.unidades as unknown[]).map((u) => String(u).trim()).filter(Boolean))
      : null;

    const [parcelas, documentos, cobrancas] = await Promise.all([
      parcelasDaCompetencia({ competencia, empreendimentos: [slug] }),
      documentosDoEmpreendimento(slug),
      listarCobrancas(conta, intervaloDaCompetencia(competencia)),
    ]);

    if (!cobrancas.ok) {
      return NextResponse.json(
        { error: `não consegui ler as cobranças no Asaas: ${cobrancas.erro}` },
        { status: 502 },
      );
    }

    // unidade -> a cobrança daquela unidade nesta competência.
    const porUnidade = new Map<string, (typeof cobrancas.data)[number]>();
    for (const c of apenasDaCompetencia(cobrancas.data, competencia)) {
      const ref = lerReferencia(c.externalReference);
      if (ref?.empreendimento === slug) porUnidade.set(ref.unidade, c);
    }

    const alvos = parcelas.filter(
      (p) => !p.bloqueio && (!pedidas || pedidas.has(p.unidade)),
    );

    // ⚠️ ENSAIO POR PADRÃO, COMO NA EMISSÃO. Sem `confirmar: true` devolve a PRÉVIA do texto que
    // cada cliente receberia. Mensagem enviada não volta, e o operador precisa ler o que vai sair.
    const previas = alvos.map((p) => {
      const cobranca = porUnidade.get(p.unidade);
      const cadastro = documentos.get(p.unidade);
      const link = cobranca?.bankSlipUrl ?? cobranca?.invoiceUrl ?? "";

      const texto = previaDoBoleto({
        competencia,
        empreendimento: empreendimento.nome,
        link,
        nome: cadastro?.nome ?? p.nome,
        parcelaAtual: p.parcelaAtual,
        totalParcelas: p.totalParcelas,
        unidade: p.unidade,
        valor: p.valor ?? 0,
        vencimento: cobranca?.dueDate ?? "",
      });

      return {
        contato: cadastro?.contato ?? null,
        impedimento: !cobranca
          ? "o boleto ainda não foi emitido"
          : !cadastro
            ? "sem cadastro para esta unidade"
            : !texto
              ? "faltou dado para montar a mensagem"
              : null,
        nome: cadastro?.nome ?? p.nome,
        texto,
        unidade: p.unidade,
      };
    });

    if (corpo.confirmar !== true) {
      return NextResponse.json(
        { data: { canal, competencia, empreendimento: empreendimento.nome, ensaio: true, previas } },
        { headers: { "Cache-Control": "no-store" } },
      );
    }

    const envios = [];
    // Em série: o gateway do Relacionamento é uma sessão só, e rajada paralela derruba a conexão.
    for (const previa of previas) {
      if (previa.impedimento) {
        envios.push({
          canal,
          erro: previa.impedimento,
          nome: previa.nome,
          ok: false,
          unidade: previa.unidade,
        });
        continue;
      }

      const cobranca = porUnidade.get(previa.unidade)!;
      const parcela = parcelas.find((x) => x.unidade === previa.unidade)!;
      const cadastro = documentos.get(previa.unidade)!;

      const r = await dispararBoleto({
        canal,
        competencia,
        contato: cadastro.contato,
        empreendimento: empreendimento.nome,
        link: cobranca.bankSlipUrl ?? cobranca.invoiceUrl ?? "",
        nome: cadastro.nome,
        parcelaAtual: parcela.parcelaAtual,
        totalParcelas: parcela.totalParcelas,
        unidade: previa.unidade,
        valor: parcela.valor ?? 0,
        vencimento: cobranca.dueDate,
      });

      await registrarDisparo({
        competencia,
        empreendimento: slug,
        erro: r.erro,
        unidade: previa.unidade,
      });
      await registrarEvento({
        autor: auth.sessao.slug,
        canal: r.canal,
        competencia,
        detalhe: r.erro,
        empreendimento: slug,
        ok: r.ok,
        telefone: r.telefone,
        tipo: "envio",
        unidade: previa.unidade,
        waMessageId: r.messageId,
      });

      envios.push({
        canal: r.canal,
        erro: r.erro,
        nome: cadastro.nome,
        ok: r.ok,
        telefone: r.telefone,
        unidade: previa.unidade,
      });
    }

    return NextResponse.json(
      {
        data: {
          canal,
          competencia,
          empreendimento: empreendimento.nome,
          enviados: envios.filter((e) => e.ok).length,
          ensaio: false,
          envios,
          falhas: envios.filter((e) => !e.ok).length,
        },
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  // ── EMITIR ────────────────────────────────────────────────────────────────
  const lote = await loteDaCompetencia({ competencia, empreendimento: slug });

  // Recorte por unidade, para o operador emitir um boleto só sem mandar o lote inteiro.
  const pedidas = Array.isArray(corpo.unidades)
    ? new Set((corpo.unidades as unknown[]).map((u) => String(u).trim()).filter(Boolean))
    : null;
  const itens = pedidas ? lote.itens.filter((i) => pedidas.has(i.unidade)) : lote.itens;

  if (pedidas && itens.length === 0) {
    return NextResponse.json(
      { error: "nenhuma das unidades pedidas está liberada para emissão neste mês" },
      { status: 400 },
    );
  }

  const divergencias = await divergenciasDeNome({ competencia, empreendimento: slug });

  const situacao = await situacaoCadastral(conta);
  const impedimentos = situacao.ok
    ? impedimentosDaConta(situacao.data, itens.length)
    : [`não consegui consultar a situação do cadastro no Asaas: ${situacao.erro}`];

  if (corpo.confirmar !== true) {
    return NextResponse.json(
      {
        data: {
          competencia,
          conta: rotuloDaConta(conta),
          divergencias,
          empreendimento: empreendimento.nome,
          ensaio: true,
          fora: lote.fora,
          impedimentos,
          itens: itens.map((i) => ({
            nome: i.nome,
            referencia: i.referencia,
            unidade: i.unidade,
            valor: i.valor,
            vencimento: i.vencimento,
          })),
        },
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  if (impedimentos.length > 0) {
    return NextResponse.json({ error: impedimentos.join(" · "), impedimentos }, { status: 409 });
  }

  const resultados = [];

  // Por onde o envio automático sai. Ausente = emite e não manda nada.
  const canalAutomatico: CanalDoDisparo | null =
    corpo.enviarAoEmitir === "relacionamento"
      ? "relacionamento"
      : corpo.enviarAoEmitir === "template" || corpo.enviarAoEmitir === true
        ? "template"
        : null;

  // As parcelas trazem o número da parcela, que a mensagem usa e o lote não carrega.
  const parcelasDoLote = canalAutomatico
    ? await parcelasDaCompetencia({ competencia, empreendimentos: [slug] })
    : [];

  // ⚠️ EM SÉRIE, DE PROPÓSITO. Em paralelo, duas linhas do mesmo CPF (o MARCELO, com dois
  // apartamentos) fariam duas buscas de cliente ao mesmo tempo, as duas não achariam nada, e o Asaas
  // ganharia dois cadastros para a mesma pessoa.
  for (const item of itens) {
    const base = {
      cobranca: null as null | string,
      enviado: false,
      envioErro: null as null | string,
      erro: null as null | string,
      ja_existia: false,
      link: null as null | string,
      nome: item.nome,
      referencia: item.referencia,
      unidade: item.unidade,
      valor: item.valor,
      vencimento: item.vencimento,
    };

    // ⚠️ CONSULTA ANTES DE CRIAR, SEMPRE. Alguém vai clicar duas vezes, ou a conexão vai cair no meio
    // e a rodada será repetida. Sem isto o cliente recebe dois boletos do mesmo mês.
    const jaEmitido = await cobrancasDaReferencia(conta, item.referencia);
    if (!jaEmitido.ok) {
      resultados.push({ ...base, erro: `não consegui conferir se já existia: ${jaEmitido.erro}` });
      continue;
    }
    if ((jaEmitido.data.data?.length ?? 0) > 0) {
      const existente = jaEmitido.data.data[0]!;
      resultados.push({
        ...base,
        cobranca: existente.id,
        ja_existia: true,
        link: existente.bankSlipUrl ?? existente.invoiceUrl ?? null,
      });
      continue;
    }

    const cliente = await acharOuCriarCliente(conta, {
      contato: item.contato,
      documento: item.documento,
      nome: item.nome,
      referencia: `boleto:${slug}:${item.unidade}`,
    });
    if (!cliente.ok) {
      resultados.push({ ...base, erro: `cliente: ${cliente.erro}` });
      continue;
    }

    const boleto = await criarBoleto(conta, {
      cliente: cliente.data.cliente.id,
      descricao: item.descricao,
      referencia: item.referencia,
      valor: item.valor,
      vencimento: item.vencimento,
    });
    if (!boleto.ok) {
      resultados.push({ ...base, erro: `boleto: ${boleto.erro}` });
      continue;
    }

    await registrarEvento({
      autor: auth.sessao.slug,
      cobrancaId: boleto.data.id,
      competencia,
      empreendimento: slug,
      ok: true,
      tipo: "emissao",
      unidade: item.unidade,
    });

    const link = boleto.data.bankSlipUrl ?? boleto.data.invoiceUrl ?? null;

    // ⚠️ O ENVIO ACOMPANHA A EMISSÃO, MAS NÃO A DERRUBA. Pedido do Lucas (01/09/2026): *"o disparo
    // tem que ser automatico quando gerado o boleto"*. Se a mensagem falhar, o boleto continua
    // emitido e válido: o que falta é o aviso, e o botão de reenviar resolve. Desfazer a emissão por
    // causa do WhatsApp seria cancelar uma cobrança correta por um problema de recado.
    if (canalAutomatico && link) {
      const parcela = parcelasDoLote.find((x) => x.unidade === item.unidade);
      const envio = await dispararBoleto({
        canal: canalAutomatico,
        competencia,
        contato: item.contato,
        empreendimento: empreendimento.nome,
        link,
        nome: item.nome,
        parcelaAtual: parcela?.parcelaAtual,
        totalParcelas: parcela?.totalParcelas,
        unidade: item.unidade,
        valor: item.valor,
        vencimento: item.vencimento,
      });

      await registrarDisparo({
        competencia,
        empreendimento: slug,
        erro: envio.erro,
        unidade: item.unidade,
      });
      await registrarEvento({
        canal: envio.canal,
        competencia,
        detalhe: envio.erro,
        empreendimento: slug,
        ok: envio.ok,
        telefone: envio.telefone,
        tipo: "envio",
        unidade: item.unidade,
        waMessageId: envio.messageId,
      });

      resultados.push({
        ...base,
        cobranca: boleto.data.id,
        enviado: envio.ok,
        envioErro: envio.erro,
        link,
      });
      continue;
    }

    resultados.push({ ...base, cobranca: boleto.data.id, link });
  }

  return NextResponse.json(
    {
      data: {
        competencia,
        conta: rotuloDaConta(conta),
        emitidos: resultados.filter((r) => r.cobranca && !r.ja_existia).length,
        empreendimento: empreendimento.nome,
        ensaio: false,
        enviados: resultados.filter((r) => r.enviado).length,
        falhas: resultados.filter((r) => r.erro).length,
        falhasNoEnvio: resultados.filter((r) => r.envioErro).length,
        fora: lote.fora,
        repetidos: resultados.filter((r) => r.ja_existia).length,
        resultados,
      },
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
