import { NextResponse } from "next/server";

import { authorizeApoloRead, authorizeApoloWrite } from "@/lib/apolo/auth";
import {
  planejarHabilitacao,
  resumoDaHabilitacao,
  type EmpreendimentoPedido,
} from "@/lib/apolo/credenciamento-aprovacao";
import { contatoDaEntidadeImobiliaria } from "@/lib/apolo/disparo-imobiliaria";
import { telefoneDaImobiliaria } from "@/lib/apolo/disparo-credenciamento";
import {
  avisarCredenciamentoAprovado,
  avisarCredenciamentoIndeferido,
  coordenadoresDosEmpreendimentos,
  representanteDaImobiliaria,
} from "@/lib/apolo/disparo-credenciamento";
import {
  chaveDoCorretor,
  conflitosDeCorretor,
  explicarConflitos,
  type VinculoDeCorretor,
} from "@/lib/apolo/credenciamento-trava-corretor";
import { loadApoloEnterpriseCadastro } from "@/lib/apolo/empreendimentos";
import { listEmpreendimentosAtivos } from "@/lib/apolo/credenciamento";
import { createApoloAdminClient } from "@/lib/apolo/server";

// HABILITAR / INDEFERIR o credenciamento de uma imobiliária.
//
// ⚠️ POR QUE ESTA ROTA EXISTE, e não é o `[id]/etapa`: o Board desenha a trilha da imobiliária
// como `cadastro -> habilitada`, mas `ehEtapaValida` só conhece as etapas da esteira de CAD
// (validacao/credito/revisao/prevenda/credenciado/correcao/indeferido). O clique em "Habilitada"
// devolvia **400 "Etapa invalida."** e nada acontecia — era isso que fazia a aprovação "não ir
// para habilitação", com 16 imobiliárias paradas desde 11/08/2026 sem conseguir enviar CAD.
//
// E não dá para simplesmente aceitar a etapa nova: `apolo_esteira` tem PRIMARY KEY
// `(entity_id, enterprise_id)` e não aceita nulo, porque cada linha de lá é uma CAD de uma
// pessoa NUM empreendimento. Imobiliária é uma empresa com N empreendimentos e UMA validação.
// Por isso a habilitação mexe onde o portal do corretor de fato lê:
//   • `apolo_entity_profiles.status = 'active'`  -> libera o CNPJ (dados.ts:218)
//   • `apolo_relationships.status  = 'verified'` -> libera cada empreendimento (dados.ts:~265)
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

const PERFIL = "imobiliaria";
const ehUuid = (v: string): boolean =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

type Corpo = {
  // ids de empreendimento do C2X (metadata.enterpriseId) que o operador liberou
  empreendimentos?: unknown;
  motivos?: unknown;
  observacao?: unknown;
  acao?: unknown;
};

const listaDeTexto = (v: unknown): string[] =>
  Array.isArray(v)
    ? v.map((item) => (typeof item === "string" ? item.trim() : "")).filter(Boolean)
    : [];

// O que a imobiliária PEDIU, para a tela montar as caixinhas. Fica na mesma rota de propósito:
// quem decide precisa ver exatamente a lista sobre a qual vai decidir.
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  // Mesma régua das outras leituras do Board: sem isto, os empreendimentos pedidos por uma
  // imobiliária ficariam legíveis para qualquer um que soubesse o id.
  const auth = await authorizeApoloRead(request);
  if (!auth.ok) return auth.response;

  const adminClient = createApoloAdminClient();
  if (!adminClient) {
    return NextResponse.json({ error: "Supabase indisponivel." }, { status: 503 });
  }

  const { id } = await context.params;
  if (!ehUuid(id)) {
    return NextResponse.json({ error: "Imobiliaria invalida." }, { status: 400 });
  }

  const { data, error } = await adminClient
    .from("apolo_relationships")
    .select("id, label, status, metadata")
    .eq("entity_id", id)
    .eq("relationship_type", "empreendimento")
    .limit(500);

  if (error) {
    return NextResponse.json({ error: "Falha ao ler os empreendimentos." }, { status: 500 });
  }

  const empreendimentos = (
    (data ?? []) as Array<{
      id: string;
      label: string | null;
      metadata: { enterpriseId?: string } | null;
      status: string | null;
    }>
  )
    .filter((linha) => Boolean(linha.metadata?.enterpriseId))
    .map((linha) => ({
      enterpriseId: String(linha.metadata?.enterpriseId),
      // `verified` = já habilitado; a tela marca e desabilita a caixinha, para o operador não
      // achar que precisa aprovar de novo o que já vale.
      habilitado: linha.status === "verified",
      label: linha.label ?? "Empreendimento",
    }))
    .sort((a, b) => a.label.localeCompare(b.label, "pt-BR"));

  return NextResponse.json({ data: { empreendimentos } });
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await authorizeApoloWrite(request);
  if (!auth.ok) return auth.response;

  const adminClient = createApoloAdminClient();
  if (!adminClient) {
    return NextResponse.json({ error: "Supabase indisponivel." }, { status: 503 });
  }

  const { id } = await context.params;
  if (!ehUuid(id)) {
    return NextResponse.json({ error: "Imobiliaria invalida." }, { status: 400 });
  }

  const corpo = (await request.json().catch(() => ({}))) as Corpo;
  const acao = corpo.acao === "indeferir" ? "indeferir" : "habilitar";

  // A entidade precisa ter MESMO o papel de imobiliária: sem esta checagem, um id de CAD de
  // cliente promoveria um papel que não existe e a resposta seria um "ok" mentiroso.
  const { data: papel, error: papelError } = await adminClient
    .from("apolo_entity_profiles")
    .select("entity_id, status")
    .eq("entity_id", id)
    .eq("profile", PERFIL)
    .maybeSingle<{ entity_id: string; status: string }>();

  if (papelError) {
    return NextResponse.json({ error: "Falha ao ler o credenciamento." }, { status: 500 });
  }
  if (!papel) {
    return NextResponse.json(
      { error: "Esta ficha nao tem cadastro de imobiliaria." },
      { status: 409 },
    );
  }

  const { data: vinculos, error: vinculosError } = await adminClient
    .from("apolo_relationships")
    .select("id, label, status, metadata")
    .eq("entity_id", id)
    .eq("relationship_type", "empreendimento")
    .limit(500);

  if (vinculosError) {
    return NextResponse.json({ error: "Falha ao ler os empreendimentos." }, { status: 500 });
  }

  const pedidos: EmpreendimentoPedido[] = (
    (vinculos ?? []) as Array<{
      id: string;
      label: string | null;
      metadata: { enterpriseId?: string } | null;
      status: string | null;
    }>
  )
    .filter((linha) => Boolean(linha.metadata?.enterpriseId))
    .map((linha) => ({
      enterpriseId: String(linha.metadata?.enterpriseId),
      id: linha.id,
      label: linha.label ?? "Empreendimento",
      status: linha.status ?? "pending",
    }));

  // ── INDEFERIR ──────────────────────────────────────────────────────────────
  // Motivo é OBRIGATÓRIO: recusa sem motivo é o que faz a imobiliária refazer o cadastro do
  // zero (a FN Consultoria pediu duas vezes por não receber resposta).
  if (acao === "indeferir") {
    const motivos = listaDeTexto(corpo.motivos);
    const observacao = typeof corpo.observacao === "string" ? corpo.observacao.trim() : "";

    if (motivos.length === 0 && !observacao) {
      return NextResponse.json(
        { error: "Diga o motivo do indeferimento: e ele que a imobiliaria recebe." },
        { status: 400 },
      );
    }

    // `blocked`, não `rejected`: o CHECK da coluna só aceita
    // active | review | blocked | archived. `rejected` estouraria a constraint em runtime, e o
    // typecheck não pega isso porque a coluna é `text`.
    const { error } = await adminClient
      .from("apolo_entity_profiles")
      .update({ status: "blocked" })
      .eq("entity_id", id)
      .eq("profile", PERFIL);

    if (error) {
      return NextResponse.json({ error: "Nao foi possivel indeferir." }, { status: 500 });
    }

    await adminClient.from("apolo_audit_events").insert({
      action: "credenciamento_indeferido",
      actor_user_id: ehUuid(auth.userId) ? auth.userId : null,
      entity_id: id,
      field_name: "credenciamento",
      metadata: { motivos, observacao: observacao || null, origem: "board" },
      status: "mapped",
    });

    // AVISA a imobiliária e o coordenador, pelo número do Relacionamento. Best-effort: o
    // indeferimento já está gravado, e uma falha de gateway não pode desfazê-lo.
    const contatoInd = await contatoDaEntidadeImobiliaria(adminClient, id);
    const repInd = await representanteDaImobiliaria(adminClient, id);
    const envioInd = await avisarCredenciamentoIndeferido(adminClient, {
      empreendimentos: pedidos.map((p) => ({ label: p.label })),
      entityId: id,
      imobiliaria: contatoInd.nome,
      // Telefone do REPRESENTANTE primeiro; o da empresa é plano B (costuma ser fixo).
      imobiliariaTelefone: telefoneDaImobiliaria([repInd.telefone, contatoInd.telefone]),
      motivos: observacao ? [...motivos, observacao] : motivos,
      representante: repInd.nome,
    });

    return NextResponse.json({
      data: {
        acao: "indeferir",
        avisou: envioInd.imobiliaria.ok,
        motivos,
        ok: true,
        resumo: envioInd.imobiliaria.ok
          ? "Cadastro indeferido e imobiliaria avisada"
          : "Cadastro indeferido (nao consegui avisar pelo WhatsApp)",
      },
    });
  }

  // ── HABILITAR ──────────────────────────────────────────────────────────────
  //
  // ⚠️ QUEM JÁ É CREDENCIADA PODE RECEBER EMPREENDIMENTO NOVO, sem vínculo prévio. É a regra do
  // Lucas ("imobiliária que já tem cadastro não precisa cair na fila de validação"), e é o que o
  // portal interno de credenciamento faz: ele lista os empreendimentos que ela AINDA NÃO
  // trabalha, ou seja, por construção nenhum deles existe como pedido. Sem `ativos`, todos
  // caíam em `desconhecidos` e o botão devolvia 400 em 100% dos casos.
  //
  // Para quem ainda está em `review` nada muda: o operador só pode liberar o que ela pediu, que
  // é a proteção contra habilitar um produto às escondidas na tela de validação.
  const jaCredenciada = papel.status === "active";
  let escolhidos = listaDeTexto(corpo.empreendimentos);
  let ativos: string[] | undefined;
  // Label de cada id REAL, para nomear o vínculo criado do zero.
  const labelPorId = new Map<string, string>();

  // ⚠️ A EXPANSÃO DE GRUPO VALE SEMPRE, o `ativos` é que é condicional.
  //
  // Um empreendimento pode ser um GRUPO (Lagoa Bonita = LBF + LBR + LBP): a tela manda o id do
  // grupo e o vínculo guarda os enterprise_id REAIS. Sem expandir, o id do grupo não casa com
  // nenhum pedido e vira `desconhecido` — ou seja, o botão devolveria 400 também para as 16
  // imobiliárias que estão paradas em `review` esperando validação, que são justamente o motivo
  // desta rota existir. Deixar a expansão dentro do `if (jaCredenciada)` consertava um caso e
  // mantinha o outro quebrado.
  //
  // `ativos` continua só para quem já é credenciada: é ele que autoriza CRIAR vínculo novo sem
  // pedido, e para quem está em review o operador só pode liberar o que ela pediu.
  const lista = await listEmpreendimentosAtivos(adminClient);
  const porId = new Map(lista.map((e) => [String(e.id), e]));
  const expandir = (emp: (typeof lista)[number]): string[] =>
    emp.stageIds.length ? emp.stageIds.map(String) : [String(emp.id)];

  escolhidos = escolhidos.flatMap((id) => {
    const emp = porId.get(id);
    if (!emp) return [id];
    const reais = expandir(emp);
    for (const real of reais) labelPorId.set(real, emp.name);
    return reais;
  });

  if (jaCredenciada) {
    ativos = lista.flatMap(expandir);
  }

  const plano = planejarHabilitacao({
    ativos,
    escolhidos,
    pedidos,
  });

  if (plano.desconhecidos.length > 0) {
    return NextResponse.json(
      {
        error: `Empreendimento que esta imobiliaria nao pediu: ${plano.desconhecidos.join(", ")}.`,
      },
      { status: 400 },
    );
  }

  if (!plano.promoverPapel) {
    // Papel ativo sem empreendimento nenhum deixaria o CNPJ valendo no formulário do corretor
    // e nenhum empreendimento na lista dele: credenciada para nada.
    return NextResponse.json(
      { error: "Escolha ao menos um empreendimento para habilitar." },
      { status: 400 },
    );
  }

  // ── TRAVA DO CORRETOR ──────────────────────────────────────────────────────
  // Um corretor não trabalha o mesmo empreendimento por duas imobiliárias (regra do Lucas). A
  // checagem é AQUI porque é aqui que o vínculo passa a valer: até a habilitação, o pedido é só
  // uma intenção. Barrar antes seria recusar um cadastro que talvez nem seja aprovado.
  // Os empreendimentos NOVOS entram na trava também: é neles que o conflito de corretor tem mais
  // chance de existir, porque são justamente os que ela ainda não trabalhava.
  const escolhidosParaTrava = [
    ...pedidos.filter((p) => plano.habilitar.includes(p.id)),
    ...plano.novos.map((enterpriseId) => ({
      enterpriseId,
      id: enterpriseId,
      label: labelPorId.get(enterpriseId) ?? "Empreendimento",
      status: "verified",
    })),
  ];

  if (escolhidosParaTrava.length > 0) {
    const { data: meusCorretores } = await adminClient
      .from("apolo_relationships")
      .select("label, metadata")
      .eq("entity_id", id)
      .eq("relationship_type", "corretor")
      .limit(500);

    const corretores = ((meusCorretores ?? []) as Array<{
      label: null | string;
      metadata: { cpf?: string } | null;
    }>).map((linha) => ({
      cpf: linha.metadata?.cpf ?? null,
      nome: linha.label ?? "",
    })).filter((c) => c.nome);

    if (corretores.length > 0) {
      // Todas as OUTRAS imobiliárias que já trabalham esses empreendimentos, com seus corretores.
      const enterpriseIds = escolhidosParaTrava.map((p) => p.enterpriseId);
      const { data: rivais } = await adminClient
        .from("apolo_relationships")
        .select("entity_id, metadata")
        .eq("relationship_type", "empreendimento")
        .eq("status", "verified")
        .limit(2000);

      const imobsPorEmpreendimento = ((rivais ?? []) as Array<{
        entity_id: string;
        metadata: { enterpriseId?: string } | null;
      }>).filter((r) => enterpriseIds.includes(String(r.metadata?.enterpriseId)));

      const outrasImobs = [
        ...new Set(imobsPorEmpreendimento.map((r) => r.entity_id).filter((e) => e !== id)),
      ];

      if (outrasImobs.length > 0) {
        const [{ data: corretoresRivais }, { data: nomes }] = await Promise.all([
          adminClient
            .from("apolo_relationships")
            .select("entity_id, label, metadata")
            .eq("relationship_type", "corretor")
            .in("entity_id", outrasImobs.slice(0, 100))
            .limit(2000),
          adminClient
            .from("apolo_entities")
            .select("id, display_name")
            .in("id", outrasImobs.slice(0, 100)),
        ]);

        const nomePorId = new Map(
          ((nomes ?? []) as Array<{ display_name: null | string; id: string }>).map((n) => [
            n.id,
            n.display_name ?? "outra imobiliária",
          ]),
        );

        const jaVinculados: VinculoDeCorretor[] = [];
        for (const rival of (corretoresRivais ?? []) as Array<{
          entity_id: string;
          label: null | string;
          metadata: { cpf?: string } | null;
        }>) {
          // O corretor da imobiliária rival vale para CADA empreendimento que ela trabalha.
          for (const emp of imobsPorEmpreendimento.filter((e) => e.entity_id === rival.entity_id)) {
            jaVinculados.push({
              chave: chaveDoCorretor({ cpf: rival.metadata?.cpf, nome: rival.label }),
              enterpriseId: String(emp.metadata?.enterpriseId),
              imobiliariaId: rival.entity_id,
              imobiliariaNome: nomePorId.get(rival.entity_id) ?? "outra imobiliária",
              nome: rival.label ?? "",
            });
          }
        }

        const conflitos = conflitosDeCorretor({
          corretores,
          empreendimentos: escolhidosParaTrava.map((p) => ({
            enterpriseId: p.enterpriseId,
            label: p.label,
          })),
          imobiliariaId: id,
          jaVinculados,
        });

        if (conflitos.length > 0) {
          return NextResponse.json(
            { conflitos, error: explicarConflitos(conflitos) },
            { status: 409 },
          );
        }
      }
    }
  }

  // ORDEM IMPORTA: primeiro os empreendimentos, depois o papel.
  // Se o papel subisse antes e a segunda escrita falhasse, o CNPJ passaria a valer no portal do
  // corretor com ZERO empreendimento liberado — ele entraria e não teria onde enviar a CAD.
  // Na ordem inversa o pior caso é empreendimento liberado com papel ainda em review, que é o
  // estado de hoje e não quebra nada: basta clicar de novo.
  if (plano.habilitar.length > 0) {
    const { error } = await adminClient
      .from("apolo_relationships")
      .update({ status: "verified" })
      .in("id", plano.habilitar);

    if (error) {
      return NextResponse.json(
        { error: "Nao foi possivel habilitar os empreendimentos." },
        { status: 500 },
      );
    }
  }

  // Empreendimento que ela ainda não tinha pedido: o vínculo nasce JÁ habilitado. Só chega aqui
  // quem já é credenciada e escolheu um empreendimento aberto (ver `ativos` acima).
  if (plano.novos.length > 0) {
    const { error } = await adminClient.from("apolo_relationships").insert(
      plano.novos.map((enterpriseId) => ({
        entity_id: id,
        label: labelPorId.get(enterpriseId) ?? "Empreendimento",
        metadata: {
          enterpriseId,
          kind: "trabalho",
          role: "empreendimento",
          source: "apolo-credenciamento",
        },
        related_entity_id: null,
        relationship_type: "empreendimento",
        status: "verified",
      })),
    );

    if (error) {
      return NextResponse.json(
        { error: "Nao foi possivel habilitar os empreendimentos." },
        { status: 500 },
      );
    }
  }

  // PRIMEIRA VEZ ou só mais um empreendimento? Lido ANTES de promover, senão o papel já estaria
  // 'active' e toda habilitação pareceria rotina. É o que decide o texto que a imobiliária
  // recebe: "seu cadastro foi aprovado" para quem chega agora, "mais um empreendimento" para
  // quem já é parceira (Lucas, 15/08).
  const primeiraVez = papel.status !== "active";

  const { error: papelUpdateError } = await adminClient
    .from("apolo_entity_profiles")
    .update({ status: "active" })
    .eq("entity_id", id)
    .eq("profile", PERFIL);

  if (papelUpdateError) {
    return NextResponse.json(
      { error: "Empreendimentos liberados, mas o credenciamento nao foi ativado. Tente de novo." },
      { status: 500 },
    );
  }

  // A entidade também sobe: ela nasceu 'review' no auto-cadastro, e é esse status que a tira da
  // fila de validação do Board.
  await adminClient.from("apolo_entities").update({ status: "active" }).eq("id", id);

  await adminClient.from("apolo_audit_events").insert({
    action: "credenciamento_habilitado",
    actor_user_id: ehUuid(auth.userId) ? auth.userId : null,
    entity_id: id,
    field_name: "credenciamento",
    metadata: {
      empreendimentos: plano.habilitar.length + plano.novos.length,
      jaHabilitados: plano.jaHabilitados.length,
      origem: "board",
      seguemPendentes: plano.seguemPendentes.length,
    },
    status: "mapped",
  });

  // AVISA. Best-effort e DEPOIS da gravação: a habilitação é o que destrava a CAD, e uma falha
  // de WhatsApp não pode desfazê-la. O resultado do envio volta no resumo, para o operador saber
  // se precisa avisar à mão.
  const habilitados = [
    ...pedidos
      .filter((p) => plano.habilitar.includes(p.id) || plano.jaHabilitados.includes(p.id))
      .map((p) => ({ label: p.label })),
    ...plano.novos.map((enterpriseId) => ({
      label: labelPorId.get(enterpriseId) ?? "Empreendimento",
    })),
  ];
  const contato = await contatoDaEntidadeImobiliaria(adminClient, id);
  const rep = await representanteDaImobiliaria(adminClient, id);
  const corretores = await adminClient
    .from("apolo_relationships")
    .select("id", { count: "exact", head: true })
    .eq("entity_id", id)
    .eq("relationship_type", "corretor");

  // Cada empreendimento tem o SEU coordenador de vendas (cadastro do C2X). Agrupado: quem cuida
  // de três produtos recebe UMA mensagem com os três, não três mensagens iguais.
  const coordenadores = await coordenadoresDosEmpreendimentos(
    adminClient,
    [
      ...pedidos
        .filter((p) => plano.habilitar.includes(p.id))
        .map((p) => ({ enterpriseId: p.enterpriseId, label: p.label })),
      ...plano.novos.map((enterpriseId) => ({
        enterpriseId,
        label: labelPorId.get(enterpriseId) ?? "Empreendimento",
      })),
    ],
    loadApoloEnterpriseCadastro,
  );

  const envio = await avisarCredenciamentoAprovado(adminClient, {
    coordenadores,
    corretores: corretores.count ?? 0,
    empreendimentos: habilitados,
    entityId: id,
    imobiliaria: contato.nome,
    // Telefone do REPRESENTANTE primeiro; o da empresa é plano B (costuma ser fixo, e o
    // WhatsApp não entrega em fixo). `telefoneDaImobiliaria` também trata a string vazia, que o
    // `??` deixava passar.
    imobiliariaTelefone: telefoneDaImobiliaria([rep.telefone, contato.telefone]),
    primeiraVez,
    representante: rep.nome,
  });

  return NextResponse.json({
    data: {
      acao: "habilitar",
      avisou: envio.imobiliaria.ok,
      habilitados: plano.habilitar.length + plano.novos.length,
      ok: true,
      resumo: resumoDaHabilitacao(plano),
      seguemPendentes: plano.seguemPendentes.length,
    },
  });
}
