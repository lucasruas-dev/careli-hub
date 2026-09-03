import { NextResponse } from "next/server";

import { coordenadoresDosEmpreendimentos, enviarPeloRelacionamento } from "@/lib/apolo/disparo-credenciamento";
import { autorizar, idsDaSessao } from "@/lib/apolo/incorporador/escopo";
import { loadApoloEnterpriseCadastro } from "@/lib/apolo/empreendimentos";
import { createApoloAdminClient } from "@/lib/apolo/server";
import { carregarCadastroDeEmpreendimentos } from "@/lib/hercules/cadastro";
import {
  familiaDoEmpreendimento,
  podemVender,
  quemPodeVender,
} from "@/lib/hercules/quem-pode-vender";
import {
  avisosDaReserva,
  conferirReserva,
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
      .select("id")
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

    const avisos = await avisar(admin, {
      corretorId: pedido.corretorEntityId ?? null,
      empreendimento: { c2xId: String(unidade.enterprise_id), nome: empreendimento.nome },
      imobiliariaId: pedido.imobiliariaEntityId,
      proponente: pedido.proponente,
      unidade: comoSeEscreve(unidade),
      validadeEm: pedido.validadeEm,
    });

    return NextResponse.json({ data: { avisos, id: criada?.id ?? null } });
  } catch (erro) {
    console.error("[hercules][reserva] falha ao reservar", erro);
    return NextResponse.json({ error: "Não foi possível reservar agora." }, { status: 503 });
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
    proponente: { cpf: string; nome: string; telefone: string };
    unidade: string;
    validadeEm: string;
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

    const textos = avisosDaReserva({
      cliente: dados.proponente.nome,
      corretor: dados.corretorId ? (nomePorId.get(dados.corretorId) ?? null) : null,
      cpf: dados.proponente.cpf,
      empreendimento: dados.empreendimento.nome,
      imobiliaria: nomePorId.get(dados.imobiliariaId) ?? "Imobiliária",
      unidade: dados.unidade,
      validadeEm: dados.validadeEm,
    });

    const coordenadores = await coordenadoresDosEmpreendimentos(
      admin,
      [{ enterpriseId: dados.empreendimento.c2xId, label: dados.empreendimento.nome }],
      loadApoloEnterpriseCadastro,
    );

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
