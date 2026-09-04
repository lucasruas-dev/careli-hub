import { NextResponse } from "next/server";

import { coordenadoresDosEmpreendimentos, enviarPeloRelacionamento } from "@/lib/apolo/disparo-credenciamento";
import { autorizar, idsDaSessao } from "@/lib/apolo/incorporador/escopo";
import { loadApoloEnterpriseCadastro } from "@/lib/apolo/empreendimentos";
import { createApoloAdminClient } from "@/lib/apolo/server";
import { carregarCadastroDeEmpreendimentos } from "@/lib/hercules/cadastro";
import {
  coordenadoresDoPanteon,
  familiaDoEmpreendimento,
  podemVender,
  quemPodeVender,
} from "@/lib/hercules/quem-pode-vender";
import { codigoDaVenda } from "@/lib/hercules/codigo-da-venda";
import {
  type AvisoDaReserva,
  avisosDaReserva,
  avisosDeCancelamento,
  conferirCancelamento,
  conferirReserva,
  motivoEscrito,
  type PedidoDeCancelamento,
  type PedidoDeReserva,
} from "@/lib/hercules/reserva";

// A RESERVA DA UNIDADE — o primeiro passo da venda, gravado no Panteon.
//
// Lucas (03/09/2026): *"se a unidade estiver disponível, ter um botão para reservar (...) quando
// ele clicar para reservar, reserva essa unidade e automaticamente vai ser encaminhada uma mensagem
// para o corretor, imobiliária e coordenador de que a unidade X foi reservada para fulano (vai sair
// do número do relacionamento). Pronto, a reserva acaba aqui."*
//
// ⚠️ GET LISTA QUEM PODE VENDER, POST RESERVA. Duas rotas seriam duas autorizações e dois lugares
// para o escopo escapar; o escopo aqui é lido uma vez, do cookie, e vale para as duas.
//
// ⚠️ O ESCOPO VEM DO COOKIE, NUNCA DO CORPO. `idsDaSessao` é a única fonte do que este usuário
// enxerga: o `unidadeId` do POST é conferido contra ele, e unidade de fora responde 404 — a mesma
// resposta de unidade inexistente, para o 403 não virar um oráculo de "existe, mas não é sua".
//
// ⚠️ A TRAVA DE DUPLICIDADE É DO BANCO. `hercules_reservas_uma_viva_por_unidade` (índice parcial,
// migration 0125) é quem impede dois donos: no salão são dezenas de tablets na mesma tela, e no
// portal dois coordenadores podem clicar no mesmo lote no mesmo segundo. Conferir antes em
// JavaScript perderia essa corrida; o que fazemos com o 23505 é traduzi-lo numa frase.
//
// ⚠️ O AVISO NÃO DERRUBA A RESERVA. Se o WhatsApp falhar, a reserva continua gravada e a resposta
// diz quem não foi avisado. O contrário — desfazer uma reserva boa porque um número estava errado —
// seria perder a venda por causa do cadastro.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const WORKSPACE = "careli";

type UnidadeDaReserva = {
  codigo: string;
  enterprise_id: string;
  id: string;
  lote: null | string;
  preco_tabela: null | number;
  quadra: null | string;
  situacao: string;
};

/** "Quadra 12 · Lote 06" — como a tela escreve, e como a mensagem precisa dizer. */
function comoSeEscreve(unidade: UnidadeDaReserva): string {
  if (unidade.quadra && unidade.lote) return `Quadra ${unidade.quadra} · Lote ${unidade.lote}`;
  const padrao = /^([A-Za-z]{2,4})(\d{2})(\d{2})$/.exec(unidade.codigo.trim());
  if (padrao) return `Quadra ${padrao[2]} · Lote ${padrao[3]}`;
  return unidade.codigo;
}

export async function GET(request: Request) {
  const auth = autorizar(request);
  if (!auth.ok) return auth.response;

  const admin = createApoloAdminClient();
  if (!admin) {
    return NextResponse.json({ error: "Configuração indisponível." }, { status: 503 });
  }

  const url = new URL(request.url);
  const unidadeId = (url.searchParams.get("unidade") ?? "").trim();
  if (!unidadeId) {
    return NextResponse.json({ error: "Informe a unidade." }, { status: 400 });
  }

  try {
    const permitidos = new Set(await idsDaSessao(auth.sessao));
    const { data } = await admin
      .from("hercules_unidades")
      .select("id,codigo,quadra,lote,situacao,preco_tabela,enterprise_id")
      .eq("workspace_id", WORKSPACE)
      .eq("id", unidadeId)
      .maybeSingle();

    const unidade = data as null | UnidadeDaReserva;
    if (!unidade || !permitidos.has(String(unidade.enterprise_id))) {
      return NextResponse.json({ error: "Unidade não encontrada." }, { status: 404 });
    }

    // ⚠️ A FAMÍLIA INTEIRA, e não só o empreendimento da unidade — ver `familiaDoEmpreendimento`.
    // As unidades do Vale do Ouro vivem em VLO/VOL/VOC e as imobiliárias estão vinculadas só ao
    // VLO: perguntar pelo id da unidade devolvia zero num produto com 37 credenciadas.
    const cadastro = await carregarCadastroDeEmpreendimentos();
    const escopo = familiaDoEmpreendimento(cadastro, String(unidade.enterprise_id));

    const lista = await quemPodeVender(admin, escopo);
    return NextResponse.json({ data: lista });
  } catch (erro) {
    console.error("[hercules][reserva] falha ao listar quem pode vender", erro);
    return NextResponse.json({ error: "Não foi possível carregar a lista agora." }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const auth = autorizar(request);
  if (!auth.ok) return auth.response;

  const admin = createApoloAdminClient();
  if (!admin) {
    return NextResponse.json({ error: "Configuração indisponível." }, { status: 503 });
  }

  let corpo: Partial<PedidoDeReserva> & { observacao?: string };
  try {
    corpo = (await request.json()) as typeof corpo;
  } catch {
    return NextResponse.json({ error: "Pedido inválido." }, { status: 400 });
  }

  const pedido: PedidoDeReserva = {
    corretorEntityId: corpo.corretorEntityId ?? null,
    imobiliariaEntityId: String(corpo.imobiliariaEntityId ?? "").trim(),
    proponente: {
      cpf: String(corpo.proponente?.cpf ?? ""),
      nome: String(corpo.proponente?.nome ?? "").trim(),
      telefone: String(corpo.proponente?.telefone ?? ""),
    },
    unidadeId: String(corpo.unidadeId ?? "").trim(),
    validadeEm: String(corpo.validadeEm ?? ""),
  };

  const erros = conferirReserva(pedido, new Date().toISOString());
  if (erros.length > 0) {
    return NextResponse.json({ erros }, { status: 422 });
  }

  try {
    const permitidos = new Set(await idsDaSessao(auth.sessao));

    const { data } = await admin
      .from("hercules_unidades")
      .select("id,codigo,quadra,lote,situacao,preco_tabela,enterprise_id")
      .eq("workspace_id", WORKSPACE)
      .eq("id", pedido.unidadeId)
      .maybeSingle();

    const unidade = data as null | UnidadeDaReserva;
    if (!unidade || !permitidos.has(String(unidade.enterprise_id))) {
      return NextResponse.json({ error: "Unidade não encontrada." }, { status: 404 });
    }

    if (unidade.situacao !== "disponivel") {
      return NextResponse.json(
        { error: `Esta unidade está ${unidade.situacao}. Só unidade disponível pode ser reservada.` },
        { status: 409 },
      );
    }

    // O mesmo escopo do GET: quem a lista ofereceu é quem a gravação aceita.
    const cadastro = await carregarCadastroDeEmpreendimentos();
    const escopo = familiaDoEmpreendimento(cadastro, String(unidade.enterprise_id));

    const habilitados = await podemVender(admin, escopo, {
      corretorId: pedido.corretorEntityId,
      imobiliariaId: pedido.imobiliariaEntityId,
    });
    if (!habilitados.ok) {
      return NextResponse.json({ error: habilitados.motivo }, { status: 403 });
    }

    // ⚠️ O EMPREENDIMENTO DA RESERVA É O PAI. As unidades moram no espelho (o pai do cadastro), e é
    // o `id` dele que `hercules_reservas.empreendimento_id` referencia. Um filho pode compartilhar
    // o código do C2X em outra coluna, então o pai ganha na escolha.
    const doC2x = cadastro.filter((l) => l.c2xEnterpriseId === String(unidade.enterprise_id));
    const empreendimento = doC2x.find((l) => l.paiId === null) ?? doC2x[0] ?? null;
    if (!empreendimento) {
      return NextResponse.json(
        { error: "Este empreendimento ainda não está no cadastro do Hércules." },
        { status: 409 },
      );
    }

    const { data: criada, error } = await admin
      .from("hercules_reservas")
      .insert({
        corretor_entity_id: pedido.corretorEntityId || null,
        criado_por: auth.sessao.usuarioId,
        criado_por_nome: auth.sessao.usuarioNome,
        empreendimento_id: empreendimento.id,
        imobiliaria_entity_id: pedido.imobiliariaEntityId,
        observacao: corpo.observacao?.trim() || null,
        origem: "coordenador",
        proponentes: [pedido.proponente],
        situacao: "ativa",
        unidade_id: unidade.id,
        validade_em: pedido.validadeEm,
        workspace_id: WORKSPACE,
      })
      .select("id, protocolo_numero")
      .maybeSingle();

    if (error) {
      // 23505 = a trava do índice parcial: alguém reservou primeiro.
      if (error.code === "23505") {
        return NextResponse.json(
          { error: "Esta unidade acabou de ser reservada por outra pessoa." },
          { status: 409 },
        );
      }
      throw new Error(error.message);
    }

    // A unidade passa a `reservada`: é o campo que o mapa e a grade leem.
    await admin
      .from("hercules_unidades")
      .update({ atualizado_em: new Date().toISOString(), situacao: "reservada" })
      .eq("id", unidade.id);

    const codigo = codigoDaVenda(
      (criada as null | { protocolo_numero?: null | number })?.protocolo_numero,
    );

    const avisos = await avisar(admin, {
      corretorId: pedido.corretorEntityId ?? null,
      empreendimento: { c2xId: String(unidade.enterprise_id), nome: empreendimento.nome },
      imobiliariaId: pedido.imobiliariaEntityId,
      textos: (nomes) =>
        avisosDaReserva({
          cliente: pedido.proponente.nome,
          codigo,
          corretor: nomes.corretor,
          cpf: pedido.proponente.cpf,
          empreendimento: empreendimento.nome,
          imobiliaria: nomes.imobiliaria,
          unidade: comoSeEscreve(unidade),
          validadeEm: pedido.validadeEm,
        }),
    });

    return NextResponse.json({ data: { avisos, codigo, id: criada?.id ?? null } });
  } catch (erro) {
    console.error("[hercules][reserva] falha ao reservar", erro);
    return NextResponse.json({ error: "Não foi possível reservar agora." }, { status: 503 });
  }
}

// ── O CANCELAMENTO ──────────────────────────────────────────────────────────
//
// Lucas (04/09/2026): *"da reserva eu tenho dois caminhos, gerar proposta ou cancelar"*.
//
// ⚠️ PATCH, E NÃO DELETE. A reserva cancelada continua existindo: é ela que responde "quem tinha
// este lote em agosto e por que soltou". Apagar a linha apagaria a resposta — e o histórico da
// unidade lê justamente `cancelada_em` para montar o evento.
//
// ⚠️ A UNIDADE VOLTA A `disponivel` ANTES DO AVISO. Se o WhatsApp falhar, o lote já está livre para
// vender; o contrário — lote preso porque uma mensagem não saiu — custaria uma venda.
export async function PATCH(request: Request) {
  const auth = autorizar(request);
  if (!auth.ok) return auth.response;

  const admin = createApoloAdminClient();
  if (!admin) {
    return NextResponse.json({ error: "Configuração indisponível." }, { status: 503 });
  }

  let corpo: Partial<PedidoDeCancelamento>;
  try {
    corpo = (await request.json()) as typeof corpo;
  } catch {
    return NextResponse.json({ error: "Pedido inválido." }, { status: 400 });
  }

  const pedido: PedidoDeCancelamento = {
    detalhe: typeof corpo.detalhe === "string" ? corpo.detalhe : null,
    motivo: String(corpo.motivo ?? "").trim(),
    unidadeId: String(corpo.unidadeId ?? "").trim(),
  };

  const erros = conferirCancelamento(pedido);
  if (erros.length > 0) {
    return NextResponse.json({ erros }, { status: 422 });
  }

  try {
    const permitidos = new Set(await idsDaSessao(auth.sessao));

    const { data } = await admin
      .from("hercules_unidades")
      .select("id,codigo,quadra,lote,situacao,preco_tabela,enterprise_id")
      .eq("workspace_id", WORKSPACE)
      .eq("id", pedido.unidadeId)
      .maybeSingle();

    const unidade = data as null | UnidadeDaReserva;
    if (!unidade || !permitidos.has(String(unidade.enterprise_id))) {
      return NextResponse.json({ error: "Unidade não encontrada." }, { status: 404 });
    }

    const { data: viva } = await admin
      .from("hercules_reservas")
      .select(
        "id, situacao, protocolo_numero, proponentes, imobiliaria_entity_id, corretor_entity_id, empreendimento_id",
      )
      .eq("workspace_id", WORKSPACE)
      .eq("unidade_id", unidade.id)
      .in("situacao", ["ativa", "proposta"])
      .maybeSingle();

    const reserva = viva as null | {
      corretor_entity_id: null | string;
      empreendimento_id: string;
      id: string;
      imobiliaria_entity_id: null | string;
      proponentes: unknown;
      protocolo_numero: null | number;
      situacao: string;
    };

    if (!reserva) {
      return NextResponse.json(
        { error: "Não há reserva ativa nesta unidade." },
        { status: 409 },
      );
    }

    // ⚠️ RESERVA QUE JÁ VIROU PROPOSTA NÃO SE CANCELA POR AQUI. A partir dali quem representa a
    // venda é a proposta, com condições comerciais gravadas — cancelar a reserva por baixo dela
    // deixaria uma proposta viva apontando para um lote disponível.
    if (reserva.situacao !== "ativa") {
      return NextResponse.json(
        { error: "Esta reserva já virou proposta. O cancelamento é o da proposta." },
        { status: 409 },
      );
    }

    const motivo = motivoEscrito(pedido.motivo, pedido.detalhe);
    const agora = new Date().toISOString();

    const { error } = await admin
      .from("hercules_reservas")
      .update({
        atualizado_em: agora,
        cancelada_em: agora,
        cancelada_motivo: motivo,
        cancelada_por: auth.sessao.usuarioId,
        cancelada_por_nome: auth.sessao.usuarioNome,
        situacao: "cancelada",
      })
      .eq("id", reserva.id)
      // ⚠️ A CONDIÇÃO REPETIDA NÃO É PARANOIA: dois coordenadores no mesmo lote, e o segundo
      // clique cancelaria de novo uma reserva já cancelada, disparando um segundo WhatsApp.
      .eq("situacao", "ativa");

    if (error) throw new Error(error.message);

    await admin
      .from("hercules_unidades")
      .update({ atualizado_em: agora, situacao: "disponivel" })
      .eq("id", unidade.id);

    const cadastro = await carregarCadastroDeEmpreendimentos();
    const nomeDoEmpreendimento =
      cadastro.find((l) => l.id === reserva.empreendimento_id)?.nome ?? "empreendimento";

    const titular = Array.isArray(reserva.proponentes)
      ? (reserva.proponentes[0] as null | { nome?: unknown })
      : null;
    const codigo = codigoDaVenda(reserva.protocolo_numero);

    const avisos = reserva.imobiliaria_entity_id
      ? await avisar(admin, {
          corretorId: reserva.corretor_entity_id,
          empreendimento: { c2xId: String(unidade.enterprise_id), nome: nomeDoEmpreendimento },
          imobiliariaId: reserva.imobiliaria_entity_id,
          textos: (nomes) =>
            avisosDeCancelamento({
              cliente: typeof titular?.nome === "string" ? titular.nome : "cliente",
              codigo,
              corretor: nomes.corretor,
              empreendimento: nomeDoEmpreendimento,
              imobiliaria: nomes.imobiliaria,
              motivo,
              unidade: comoSeEscreve(unidade),
            }),
        })
      : [];

    return NextResponse.json({ data: { avisos, codigo, id: reserva.id } });
  } catch (erro) {
    console.error("[hercules][reserva] falha ao cancelar", erro);
    return NextResponse.json({ error: "Não foi possível cancelar agora." }, { status: 503 });
  }
}

type ResultadoDoAviso = { motivo?: string; ok: boolean; para: string };

/**
 * Avisa corretor, imobiliária e coordenador — pelo número do Relacionamento.
 *
 * ⚠️ NUNCA LANÇA. A reserva já está gravada quando esta função roda: uma exceção aqui viraria um
 * 503 numa operação que deu certo, e o coordenador reservaria de novo por cima do índice único.
 * Cada destinatário volta com o seu resultado, e a tela diz quem ficou sem aviso.
 */
async function avisar(
  admin: ReturnType<typeof createApoloAdminClient>,
  dados: {
    corretorId: null | string;
    empreendimento: { c2xId: string; nome: string };
    imobiliariaId: string;
    /**
     * O que cada um vai ler, montado com os nomes que só esta função conhece.
     *
     * ⚠️ É FUNÇÃO, E NÃO TEXTO PRONTO: quem chama sabe o ASSUNTO (reserva criada, reserva
     * cancelada) mas não sabe o nome da imobiliária nem o do corretor — os dois saem do
     * `apolo_entities` que esta busca aqui. Passar texto pronto obrigaria cada chamador a repetir
     * essa consulta, e "quem recebe e como envia" viraria dois lugares.
     */
    textos: (nomes: { corretor: null | string; imobiliaria: string }) => AvisoDaReserva[];
  },
): Promise<ResultadoDoAviso[]> {
  if (!admin) return [];

  try {
    const [{ data: entidades }, { data: contatos }] = await Promise.all([
      admin
        .from("apolo_entities")
        .select("id, display_name, legal_name, trade_name")
        .in("id", [dados.imobiliariaId, dados.corretorId].filter(Boolean) as string[]),
      admin
        .from("apolo_contacts")
        .select("entity_id, value, is_primary")
        .eq("contact_type", "phone")
        .in("entity_id", [dados.imobiliariaId, dados.corretorId].filter(Boolean) as string[]),
    ]);

    const nomePorId = new Map<string, string>();
    for (const e of (entidades ?? []) as Array<{
      display_name: null | string;
      id: string;
      legal_name: null | string;
      trade_name: null | string;
    }>) {
      nomePorId.set(e.id, (e.trade_name || e.display_name || e.legal_name || "").trim() || "—");
    }

    const telefonePorId = new Map<string, string>();
    for (const c of (contatos ?? []) as Array<{
      entity_id: string;
      is_primary: boolean | null;
      value: null | string;
    }>) {
      const valor = (c.value ?? "").trim();
      if (!valor) continue;
      if (c.is_primary === true || !telefonePorId.has(c.entity_id)) {
        telefonePorId.set(c.entity_id, valor);
      }
    }

    const textos = dados.textos({
      corretor: dados.corretorId ? (nomePorId.get(dados.corretorId) ?? null) : null,
      imobiliaria: nomePorId.get(dados.imobiliariaId) ?? "Imobiliária",
    });

    // ⚠️ O COORDENADOR VEM DO C2X, E CAI NO PANTEON QUANDO NÃO EXISTE LÁ. Empreendimento que só
    // existe aqui — o de teste, e qualquer produto novo antes de ser cadastrado no legado — ficaria
    // sem ninguém para avisar. O fallback nunca esconde o coordenador de verdade: só entra quando a
    // consulta ao legado volta vazia.
    const doC2x = await coordenadoresDosEmpreendimentos(
      admin,
      [{ enterpriseId: dados.empreendimento.c2xId, label: dados.empreendimento.nome }],
      loadApoloEnterpriseCadastro,
    );
    const coordenadores =
      doC2x.length > 0
        ? doC2x
        : (await coordenadoresDoPanteon(admin, [dados.empreendimento.c2xId])).map((c) => ({
            empreendimentos: [],
            nome: c.nome,
            telefone: c.telefone,
          }));

    const destinos: Array<{ entityId: string; papel: string; telefone: null | string }> = [];
    if (dados.corretorId) {
      destinos.push({
        entityId: dados.corretorId,
        papel: "corretor",
        telefone: telefonePorId.get(dados.corretorId) ?? null,
      });
    }
    destinos.push({
      entityId: dados.imobiliariaId,
      papel: "imobiliaria",
      telefone: telefonePorId.get(dados.imobiliariaId) ?? null,
    });
    for (const c of coordenadores) {
      destinos.push({ entityId: dados.imobiliariaId, papel: "coordenador", telefone: c.telefone });
    }

    const resultados = await Promise.all(
      destinos.map(async (destino) => {
        const texto = textos.find((t) => t.papel === destino.papel)?.texto;
        if (!texto) return { motivo: "sem texto", ok: false, para: destino.papel };
        const r = await enviarPeloRelacionamento(admin, {
          destinatario: destino.papel,
          entityId: destino.entityId,
          origem: "reserva:whatsapp",
          telefone: destino.telefone,
          texto,
          tipo: "hercules_reserva",
        });
        return { motivo: r.erro, ok: r.ok, para: destino.papel };
      }),
    );

    return resultados;
  } catch (erro) {
    console.error("[hercules][reserva] falha ao avisar", erro);
    return [];
  }
}
