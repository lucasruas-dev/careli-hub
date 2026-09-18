// RESERVA DE UNIDADE NO LANÇAMENTO: a tela touch (Lucas, 24/08/2026).
//
// O processo: bipa a etiqueta → escolhe QUADRA → marca os LOTES livres → confirma → cupom com QR.
// O layout, o cupom e a PA continuam os mesmos; o que mudou em 18/09/2026 foi QUEM DECIDE e ONDE
// GRAVA.
//
// ⚠️ QUEM DECIDE SE O LOTE ESTÁ LIVRE É A SITUAÇÃO ÚNICA DO PANTEON (Lucas, 18/09/2026: *"esses
// status tem que morar em um so lugar"* · *"no c2x não precisa olhar"* · *"quero é dentro do
// panteon tem que ter o mesmo status"*). Até ali o tótem oferecia pelo `sale_status_id` do C2X e a
// tela Venda pelo Panteon: o lote bloqueado pelo coordenador no Apolo aparecia livre no salão. Hoje
// o tótem oferece SÓ o que `estaLivre(situação única)` diz, a mesma régua da Venda, do Apolo e do
// telão (lib/hercules/situacao-da-unidade.ts). Do C2X continuam vindo SÓ os dados de exibição
// (quadra, lote, área, preço), que é o que a tela e a PA imprimem.
//
// ⚠️ A RESERVA NASCE NO HÉRCULES (Lucas, 18/09/2026: *"toda reserva, proposta deve ser criada no
// hercules"* · *"essa tela tem que puxar a tela de vendas do hercules e quando houver a reserva
// fosse reservada no hercules"* · *"cadastro apolo, interações comerciais hercules"*). Cada lote do
// cupom passa pela PORTA ÚNICA (`criarReservaNoHercules`, origem `salao`): a mesma conferência de
// terreno, a mesma trava e o mesmo índice que seguram a reserva do coordenador. `prometeu_reservas`
// continua existindo, mas como o CUPOM: o papel que o salão imprime, bipa na PA e acompanha.
//
// ⚠️ E NUNCA DOIS DONOS (Lucas: *"eu não posso vender dois lotes para pessoas diferentes, eu tomo
// processo por conta disso"*). Toda leitura que falha termina em recusa, nunca em lote oferecido.
import { randomUUID } from "node:crypto";

import type { RowDataPacket } from "mysql2";

import { getHadesDbPool } from "@/lib/guardian/db";
import { carregarCadastroDeEmpreendimentos } from "@/lib/hercules/cadastro";
import { cancelarReservaNoHercules } from "@/lib/hercules/cancelar-reserva-server";
import { criarReservaNoHercules } from "@/lib/hercules/criar-reserva";
import {
  acharUnidade,
  estaLivre,
  lerSituacaoDasUnidades,
  rotuloDaSituacao,
  type SituacaoDasUnidades,
  type UnidadeComSituacao,
} from "@/lib/hercules/situacao-da-unidade";

import {
  cuponsSoltosPeloHercules,
  reservaDoHerculesCaiu,
  reservasDoHerculesDosCupons,
} from "./cupom-segue-o-hercules";
import type { createPrometeuClient } from "./data";
import { lotesTravadosDoEvento } from "./situacao-do-lote";

type AdminClient = NonNullable<ReturnType<typeof createPrometeuClient>>;

export type UnidadeDisponivel = {
  area: string;
  c2xId: string;
  codigo: string;
  lote: string;
  preco: null | number;
  quadra: string;
};

export type QuadraDoEvento = {
  disponiveis: UnidadeDisponivel[];
  quadra: string;
};

/** O evento, do jeito que a oferta e a reserva precisam dele. */
export type EventoDaReserva = {
  /** `lotesBloqueados` (a trava do Setup) mora aqui. */
  config?: null | Record<string, unknown>;
  /** O id do C2X do empreendimento: é por ele que a situação única é lida. */
  enterpriseId: null | string;
  id: string;
};

// As funções PURAS do cupom/proponentes moram em cupom.ts (client-safe — este arquivo puxa
// mysql2 e NÃO pode entrar no bundle do navegador); reexportadas aqui para o servidor usar de
// um lugar só.
export {
  codigoDoCupom,
  conteudoDoQrDoCupom,
  ehIdDeCupom,
  MAX_PROPONENTES,
  normalizarCodigoDeUnidade,
  validarProponentes,
  type ProponenteDaReserva,
} from "./cupom";

import {
  codigoDoCupom,
  normalizarCodigoDeUnidade,
  validarProponentes,
  type ProponenteDaReserva,
} from "./cupom";

// Ordena quadras e lotes com números de verdade ("2" antes de "10"), sem quebrar quadra-letra
// ("C01") — o formato varia por empreendimento (RVP usa letra na quadra).
function comparaNatural(a: string, b: string): number {
  return a.localeCompare(b, "pt-BR", { numeric: true, sensitivity: "base" });
}

const NAO_DEU_PARA_CONFERIR =
  "Não foi possível confirmar que os lotes estão livres. Nada foi gravado; tente de novo em instantes.";

function enterpriseDoEvento(evento: EventoDaReserva): null | string {
  const id = Number(evento.enterpriseId);
  // `hercules_unidades.enterprise_id` guarda o id do C2X como texto ("35"); o Number normaliza o
  // que veio do Setup (" 35", "035") para a mesma forma.
  return Number.isFinite(id) && id > 0 ? String(id) : null;
}

/**
 * O lote pode entrar num cupom? A MESMA pergunta para a oferta (o que o tótem mostra) e para a
 * gravação (o que o POST aceita), para as duas nunca discordarem.
 *
 * ⚠️ A BUSCA É A DA RÉGUA (`acharUnidade`): id do legado primeiro, código depois. Lote que o Panteon
 * não conhece NÃO é livre: sem cadastro não há situação, e sem situação não se vende.
 *
 * ⚠️ A TRAVA DO SETUP VALE PARA O TERRENO INTEIRO: travar o VLO0305 trava também o VOC0305, que é o
 * mesmo chão.
 */
export function loteDoCupom(
  situacoes: SituacaoDasUnidades,
  travados: ReadonlySet<string>,
  lote: { c2xId?: null | string; codigo: string },
): { motivo: string; ok: false } | { ok: true; unidade: UnidadeComSituacao } {
  const codigo = normalizarCodigoDeUnidade(lote.codigo);
  const origemC2x = String(lote.c2xId ?? "").trim() || null;

  // ⚠️ AS DUAS CHAVES TÊM QUE CONCORDAR QUANDO AS DUAS EXISTEM. O cupom imprime o CÓDIGO, e a
  // reserva do Hércules cai na linha que a busca achar, que é pelo id do legado primeiro. Um pedido
  // com o código de um lote e o id de outro (tela velha, corpo adulterado) reservaria no Hércules um
  // lote e entregaria ao cliente o papel de outro: o lote do papel seguiria livre para a próxima
  // venda. Quando só uma das chaves casa (nome no C2X diferente do código da carga), vale a busca.
  const pelaOrigem = origemC2x ? situacoes.porOrigemC2x.get(origemC2x) : undefined;
  const peloCodigo = codigo ? situacoes.porCodigo.get(codigo) : undefined;
  if (pelaOrigem && peloCodigo && pelaOrigem.id !== peloCodigo.id) {
    return { motivo: "o código e o id do legado apontam para lotes diferentes", ok: false };
  }

  const unidade = acharUnidade(situacoes, { codigo, origemC2x });
  if (!unidade) return { motivo: "sem cadastro no Panteon", ok: false };

  const codigosDoTerreno = [codigo, ...(situacoes.terreno(unidade.id)?.codigos ?? [unidade.codigo])];
  if (codigosDoTerreno.some((c) => travados.has(normalizarCodigoDeUnidade(c)))) {
    return { motivo: "travado no Setup do lançamento", ok: false };
  }
  if (!estaLivre(unidade.situacao)) {
    return { motivo: rotuloDaSituacao(unidade.situacao).toLowerCase(), ok: false };
  }
  return { ok: true, unidade };
}

/**
 * As quadras do empreendimento do evento com SÓ os lotes livres pela situação única.
 * Uma consulta no C2X (só exibição) + a leitura da régua por chamada. A tela faz poll leve (15s)
 * e nunca consulta por clique (conexão com o legado é escassa).
 *
 * ⚠️ SEM CACHE, de propósito: a oferta que atrasa oferece o lote que alguém acabou de reservar na
 * Venda. A porta única recusaria na gravação, mas o cliente já teria escolhido o lote na tela.
 */
export async function quadrasDoEvento(
  client: AdminClient,
  evento: EventoDaReserva,
): Promise<{ error?: string; quadras: QuadraDoEvento[] }> {
  const enterpriseId = enterpriseDoEvento(evento);
  if (!enterpriseId) {
    return {
      error: "Evento sem empreendimento vinculado no Setup.",
      quadras: [],
    };
  }

  const poolResult = getHadesDbPool();
  if (!poolResult.ok) return { error: "C2X indisponível.", quadras: [] };

  let rows: RowDataPacket[];
  let situacoes: SituacaoDasUnidades;
  try {
    // ⚠️ SEM FILTRO DE SITUAÇÃO NO C2X. Até 18/09/2026 esta consulta filtrava `sale_status_id = 1`,
    // `sale_blocked` e pedido de aquisição aberto: era a régua do legado decidindo o que o salão
    // vendia. Agora ela traz TODAS as unidades só para ter quadra, lote, área e preço, e quem
    // escolhe o que aparece é a situação única, logo abaixo.
    const [consulta, lidas] = await Promise.all([
      poolResult.pool.query<RowDataPacket[]>(
        `SELECT eu.id, eu.name, eu.block, eu.lot, eu.area, eu.price
           FROM enterprise_unities eu
          WHERE eu.enterprise_id = ?
          ORDER BY eu.block, eu.lot`,
        [Number(enterpriseId)],
      ),
      lerSituacaoDasUnidades(client, [enterpriseId]),
    ]);
    rows = consulta[0];
    situacoes = lidas;
  } catch (erro) {
    // ⚠️ FALHA DE LEITURA VIRA ERRO, NUNCA PRATELEIRA CHEIA. Sem a situação, não há como saber o
    // que está livre.
    console.error("[prometeu][reserva] oferta do tótem sem leitura", erro);
    return {
      error: "Não foi possível ler a situação das unidades agora.",
      quadras: [],
    };
  }

  const travados = lotesTravadosDoEvento(evento.config);

  const porQuadra = new Map<string, UnidadeDisponivel[]>();
  for (const r of rows as Array<Record<string, unknown>>) {
    const codigo = normalizarCodigoDeUnidade(String(r.name ?? ""));
    if (!codigo) continue;
    const c2xId = String(r.id ?? "");
    if (!loteDoCupom(situacoes, travados, { c2xId, codigo }).ok) continue;
    const quadra = String(r.block ?? "").trim();
    const unidade: UnidadeDisponivel = {
      area: String(r.area ?? "").trim(),
      c2xId,
      codigo,
      lote: String(r.lot ?? "").trim(),
      preco: r.price == null || r.price === "" ? null : Number(r.price),
      quadra,
    };
    const lista = porQuadra.get(quadra);
    if (lista) lista.push(unidade);
    else porQuadra.set(quadra, [unidade]);
  }

  const quadras = [...porQuadra.entries()]
    .map(([quadra, disponiveis]) => ({
      disponiveis: disponiveis.sort((a, b) => comparaNatural(a.lote, b.lote)),
      quadra,
    }))
    .sort((a, b) => comparaNatural(a.quadra, b.quadra));

  return { quadras };
}

export type NovaReserva = {
  credenciadoId: string;
  criadoPor: null | string;
  criadoPorNome: null | string;
  evento: EventoDaReserva;
  /** A imobiliária do titular no Apolo, quando o vínculo existe. Vai para a reserva do Hércules. */
  imobiliariaEntityId?: null | string;
  proponentes: ProponenteDaReserva[];
  unidades: UnidadeDisponivel[];
};

/**
 * O empreendimento do cadastro (`hercules_empreendimentos.id`) que a reserva do Hércules referencia.
 *
 * ⚠️ A MESMA ESCOLHA DA ROTA DA VENDA (app/api/incorporador/venda/reserva/route.ts): as linhas do
 * cadastro com o id do C2X da unidade, e o PAI ganha, porque um filho pode compartilhar o mesmo id
 * do C2X. Duas escolhas diferentes fariam a mesma unidade ter reservas penduradas em dois produtos.
 */
export function empreendimentoDaReserva(
  cadastro: ReadonlyArray<{ c2xEnterpriseId: null | string; id: string; paiId: null | string }>,
  enterpriseId: string,
): null | string {
  const doC2x = cadastro.filter((l) => l.c2xEnterpriseId === String(enterpriseId));
  return (doC2x.find((l) => l.paiId === null) ?? doC2x[0])?.id ?? null;
}

/**
 * Os proponentes do cupom no formato da reserva do Hércules: `[{ nome, cpf, telefone, entity_id }]`
 * (0125). É o `cpf` que a proposta do Hércules usa para achar a CAD do titular; sem ele a reserva
 * do salão nunca viraria proposta. O resto do cupom (participação, origem) vai junto: a coluna é
 * jsonb e quem lê ignora o que não conhece.
 */
export function proponentesParaOHercules(proponentes: ProponenteDaReserva[]): unknown[] {
  return proponentes.map((p) => ({
    cpf: String(p.documento ?? "").replace(/\D/g, ""),
    credenciadoId: p.credenciadoId,
    entity_id: p.entityId ?? null,
    nome: p.nome,
    origem: p.origem ?? null,
    percentual: p.percentual,
    // O telefone mora na ficha do Apolo, não no credenciado; a Venda completa quando precisar.
    telefone: "",
  }));
}

type ReservaCriada = { codigo: string; linhaId: string; reservaId: string };

/**
 * Desfaz as reservas do Hércules de um cupom que não fechou. Devolve os códigos que NÃO foi
 * possível desfazer (o lote fica preso por uma reserva do Hércules: o lado seguro, mas alguém
 * precisa cancelá-la na tela Venda).
 */
async function desfazerNoHercules(
  client: AdminClient,
  criadas: ReservaCriada[],
  motivo: string,
): Promise<string[]> {
  const presas: string[] = [];
  for (const c of criadas) {
    const r = await cancelarReservaNoHercules(client, {
      canceladoPor: null,
      canceladoPorNome: "Sistema",
      motivo,
      reservaDoEventoId: c.linhaId,
      reservaId: c.reservaId,
    });
    if (!r.ok) {
      // ⚠️ Grita no log com os ids: é uma reserva viva que ninguém no salão vai enxergar.
      console.error("[prometeu][reserva] RESERVA DO HÉRCULES NÃO DESFEITA", {
        codigo: c.codigo,
        motivo: r.motivo,
        reserva: c.reservaId,
      });
      presas.push(c.codigo);
    }
  }
  return presas;
}

function avisoDePresas(presas: string[]): string {
  return presas.length
    ? ` Atenção: a reserva de ${presas.join(", ")} ficou presa no Hércules; cancele pela tela Venda.`
    : "";
}

/**
 * Solta os cupons deste evento cuja reserva do Hércules já foi cancelada (na tela Venda, por
 * exemplo). Devolve a mensagem de erro, ou `null`.
 *
 * ⚠️ SEM ISTO O LOTE FICAVA IMPOSSÍVEL DE RESERVAR NO SALÃO. O índice `prometeu_reservas_unidade_viva`
 * (0101) aceita um cupom vivo por código por evento. O cupom ligado a uma reserva do Hércules segue
 * a reserva do Hércules (a régua única não o conta sozinho), então o lote aparece livre; mas o cupom
 * velho continua `reservada` na tabela, e a gravação do cupom novo morreria no 23505 com o lote
 * verde na tela. Só sai o cupom cuja reserva do Hércules está cancelada ou expirada: o cupom sem
 * reserva do Hércules (anterior a 18/09) conta como dono pela régua e nem chega aqui.
 */
async function soltarCuponsDeReservaCancelada(
  client: AdminClient,
  eventoId: string,
  codigos: string[],
): Promise<null | string> {
  const { data: vivos, error } = await client
    .from("prometeu_reservas")
    .select("id, codigo")
    .eq("evento_id", eventoId)
    .eq("situacao", "reservada")
    .in("codigo", codigos);
  if (error) return error.message;
  const ids = ((vivos ?? []) as Array<{ id: string }>).map((l) => l.id);
  if (ids.length === 0) return null;

  const ligadas = await reservasDoHerculesDosCupons(client, ids);
  if (ligadas.error) return ligadas.error;

  const soltar = ids.filter((id) => reservaDoHerculesCaiu(ligadas.porCupom.get(id)));
  if (soltar.length === 0) return null;

  const agora = new Date().toISOString();
  const { error: erroAoSoltar } = await client
    .from("prometeu_reservas")
    .update({
      cancelada_em: agora,
      cancelada_motivo: "A reserva do Hércules deste lote foi cancelada; o cupom seguiu.",
      situacao: "cancelada",
      updated_at: agora,
    })
    .in("id", soltar)
    .eq("situacao", "reservada");
  return erroAoSoltar ? erroAoSoltar.message : null;
}

/**
 * Confirma a reserva do salão: UMA reserva do Hércules por lote, e o cupom (uma linha por lote em
 * `prometeu_reservas`, todas com o mesmo `grupo_id`) por cima delas. Tudo ou nada: cupom pela
 * metade não existe.
 *
 * ⚠️ A ORDEM É A REGRA, e não estética:
 *   1. a situação única confere TODOS os lotes antes de qualquer gravação;
 *   2. a porta única grava a reserva do Hércules de cada lote, um por vez, já apontando para a
 *      linha do cupom que ainda vai nascer (`prometeu_reserva_id`, id gerado aqui);
 *   3. um lote recusado desfaz as reservas do Hércules já feitas neste cupom, e a resposta diz qual;
 *   4. SÓ ENTÃO grava o cupom. Se o cupom fosse gravado antes, a régua já veria o lote reservado
 *      pelo próprio cupom e a porta única recusaria toda reserva do salão;
 *   5. o cupom que não grava desfaz as reservas do Hércules deste cupom.
 *
 * ⚠️ O VÍNCULO NASCE NO INSERT, E NÃO NUM UPDATE DEPOIS. A reserva do Hércules já é gravada com o id
 * da sua linha do cupom. Ligar depois (INSERT do cupom, UPDATE das reservas) deixaria uma janela em
 * que o cupom recém-gravado é um dono SEM reserva do Hércules: a régua o contaria como dono à parte,
 * uma proposta feita na Venda nesse instante seria recusada e, se o UPDATE falhasse, o lote ficaria
 * com dois registros de dono. Com o id escolhido aqui, o cupom nasce já absorvido pela reserva.
 */
export async function criarReservaDoEvento(
  client: AdminClient,
  entrada: NovaReserva,
): Promise<{ conflitos?: string[]; error?: string; grupoId?: string }> {
  if (entrada.unidades.length === 0) {
    return { error: "Selecione ao menos um lote." };
  }

  const erroProponentes = validarProponentes(entrada.proponentes);
  if (erroProponentes) return { error: erroProponentes };

  const enterpriseId = enterpriseDoEvento(entrada.evento);
  if (!enterpriseId) return { error: "Evento sem empreendimento vinculado no Setup." };

  const codigos = entrada.unidades.map((u) => normalizarCodigoDeUnidade(u.codigo));
  if (new Set(codigos).size !== codigos.length) {
    return { error: "O mesmo lote apareceu duas vezes no cupom. Refaça a seleção." };
  }

  // ── 1. A situação única, uma leitura para o cupom inteiro ──
  let situacoes: SituacaoDasUnidades;
  try {
    situacoes = await lerSituacaoDasUnidades(client, [enterpriseId]);
  } catch (erro) {
    console.error("[prometeu][reserva] leitura da situação falhou", erro);
    return { error: NAO_DEU_PARA_CONFERIR };
  }

  const travados = lotesTravadosDoEvento(entrada.evento.config);
  const alvos: Array<{ codigo: string; unidade: UnidadeComSituacao; unidadeDoCupom: UnidadeDisponivel }> = [];
  const conflitos: string[] = [];
  const motivos: string[] = [];
  const terrenosDoCupom = new Set<string>();
  entrada.unidades.forEach((u, i) => {
    const codigo = codigos[i] ?? normalizarCodigoDeUnidade(u.codigo);
    const lote = loteDoCupom(situacoes, travados, { c2xId: u.c2xId, codigo });
    if (!lote.ok) {
      conflitos.push(codigo);
      motivos.push(`${codigo} (${lote.motivo})`);
      return;
    }
    // Dois códigos do mesmo chão (VLO0305 e VOC0305) no mesmo cupom seriam duas reservas do mesmo
    // terreno: a porta única recusaria a segunda e o cupom inteiro cairia sem explicação.
    if (terrenosDoCupom.has(lote.unidade.id)) {
      conflitos.push(codigo);
      motivos.push(`${codigo} (é o mesmo lote de outro código do cupom)`);
      return;
    }
    terrenosDoCupom.add(lote.unidade.id);
    alvos.push({ codigo, unidade: lote.unidade, unidadeDoCupom: u });
  });
  if (conflitos.length > 0) {
    return {
      conflitos,
      error: `Não está livre: ${motivos.join(", ")}. Refaça sem esse(s) lote(s).`,
    };
  }

  // ── O produto do cadastro (hercules_empreendimentos) de cada lote ──
  let cadastro: Awaited<ReturnType<typeof carregarCadastroDeEmpreendimentos>>;
  try {
    cadastro = await carregarCadastroDeEmpreendimentos();
  } catch (erro) {
    console.error("[prometeu][reserva] cadastro de empreendimentos indisponível", erro);
    return { error: NAO_DEU_PARA_CONFERIR };
  }
  const empreendimentoDe = new Map<string, string>();
  for (const { unidade } of alvos) {
    const id = empreendimentoDaReserva(cadastro, unidade.enterpriseId);
    if (!id) {
      return { error: "Este empreendimento ainda não está no cadastro do Hércules. Nada foi gravado." };
    }
    empreendimentoDe.set(unidade.id, id);
  }

  // ── Cupom velho cuja reserva do Hércules já caiu não pode travar o cupom novo ──
  const erroAoSoltar = await soltarCuponsDeReservaCancelada(client, entrada.evento.id, codigos);
  if (erroAoSoltar) {
    console.error("[prometeu][reserva] cupons velhos não conferidos", erroAoSoltar);
    return { error: NAO_DEU_PARA_CONFERIR };
  }

  const grupoId = randomUUID();
  const proponentesDoHercules = proponentesParaOHercules(entrada.proponentes);
  const observacao = `Reserva do salão do lançamento, cupom ${codigoDoCupom(grupoId)}.`;
  const comLinha = alvos.map((alvo) => ({ ...alvo, linhaId: randomUUID() }));

  // ── 2 e 3. A porta única, lote a lote; o primeiro recusado desfaz os anteriores ──
  const criadas: ReservaCriada[] = [];
  for (const alvo of comLinha) {
    const resultado = await criarReservaNoHercules(client, {
      criadoPor: entrada.criadoPor,
      criadoPorNome: entrada.criadoPorNome,
      empreendimentoId: empreendimentoDe.get(alvo.unidade.id) ?? "",
      enterpriseId: alvo.unidade.enterpriseId,
      eventoId: entrada.evento.id,
      imobiliariaEntityId: entrada.imobiliariaEntityId ?? null,
      observacao,
      origem: "salao",
      prometeuReservaId: alvo.linhaId,
      proponentes: proponentesDoHercules,
      unidadeId: alvo.unidade.id,
    });
    if (!resultado.ok) {
      const presas = await desfazerNoHercules(
        client,
        criadas,
        `Cupom do salão não fechou: ${alvo.codigo} foi recusado. Desfeita pelo sistema.`,
      );
      if (resultado.status === 409) {
        return {
          conflitos: [alvo.codigo],
          error: `${alvo.codigo}: ${resultado.motivo} Refaça sem esse lote.${avisoDePresas(presas)}`,
        };
      }
      return { error: `${resultado.motivo}${avisoDePresas(presas)}` };
    }
    criadas.push({ codigo: alvo.codigo, linhaId: alvo.linhaId, reservaId: resultado.reserva.id });
  }

  // ── 4. O cupom, só agora, com os ids que as reservas do Hércules já apontam ──
  const linhas = comLinha.map(({ codigo, linhaId, unidadeDoCupom: u }) => ({
    area: u.area || null,
    codigo,
    credenciado_id: entrada.credenciadoId,
    criado_por: entrada.criadoPor,
    criado_por_nome: entrada.criadoPorNome,
    evento_id: entrada.evento.id,
    grupo_id: grupoId,
    id: linhaId,
    lote: u.lote,
    preco_tabela: u.preco,
    proponentes: entrada.proponentes,
    quadra: u.quadra,
    situacao: "reservada",
    unidade_c2x_id: u.c2xId || null,
  }));

  const { error } = await client.from("prometeu_reservas").insert(linhas);
  if (!error) return { grupoId };

  // ── 5. O cupom não gravou: as reservas do Hércules deste cupom saem ──
  console.error("[prometeu][reserva] cupom não gravou", { code: error.code, erro: error.message });
  const presas = await desfazerNoHercules(
    client,
    criadas,
    "Cupom do salão não gravou. Desfeita pelo sistema.",
  );

  // 23505 = a trava do cupom (0101). Descobre QUAIS lotes para a mensagem ser útil.
  if (error.code === "23505") {
    const { data } = await client
      .from("prometeu_reservas")
      .select("codigo")
      .eq("evento_id", entrada.evento.id)
      .eq("situacao", "reservada")
      .in("codigo", codigos);
    const presosNoCupom = ((data ?? []) as { codigo: string }[]).map((r) => r.codigo);
    return {
      conflitos: presosNoCupom,
      error: presosNoCupom.length
        ? `Acabou de ser reservado: ${presosNoCupom.join(", ")}. Refaça sem esse(s) lote(s).${avisoDePresas(presas)}`
        : `Um dos lotes acabou de ser reservado. Atualize e tente de novo.${avisoDePresas(presas)}`,
    };
  }

  return { error: `Não foi possível gravar o cupom. Nada ficou reservado.${avisoDePresas(presas)}` };
}

export type ReservaDoCupom = {
  area: null | string;
  codigo: string;
  createdAt: string;
  credenciadoId: string;
  grupoId: string;
  id: string;
  lote: string;
  paImpressaEm: null | string;
  paImpressaVezes: number;
  precoTabela: null | number;
  proponentes: ProponenteDaReserva[];
  propostaLancadaEm: null | string;
  quadra: string;
  situacao: string;
};

/**
 * As unidades de um cupom (grupo). Cancele-se uma linha e ela continua contando a história.
 *
 * ⚠️ A LINHA SEGUE A RESERVA DO HÉRCULES. Desde 18/09/2026 cada linha nova tem uma reserva do
 * Hércules, e é ela que diz se o lote ainda é deste cliente: cancelada na tela Venda, o lote está
 * livre para outro, mesmo com a linha do cupom ainda `reservada` na tabela. Por isso a linha cuja
 * reserva do Hércules caiu sai daqui como `cancelada`, e a PA não imprime proposta para um lote que
 * o cliente já não segura (seria o começo da venda do mesmo lote para duas pessoas).
 *
 * ⚠️ SEM CONSEGUIR LER O HÉRCULES, ERRO, e não o cupom cru: imprimir a PA na dúvida é o risco caro.
 */
export async function reservasDoGrupo(
  client: AdminClient,
  grupoId: string,
): Promise<{ error?: string; reservas: ReservaDoCupom[] }> {
  const { data, error } = await client
    .from("prometeu_reservas")
    .select(
      "id, grupo_id, credenciado_id, codigo, quadra, lote, area, preco_tabela, proponentes, situacao, pa_impressa_em, pa_impressa_vezes, proposta_lancada_em, created_at",
    )
    .eq("grupo_id", grupoId)
    .order("codigo", { ascending: true });
  if (error) return { error: error.message, reservas: [] };

  const brutas = (data ?? []) as Array<Record<string, unknown>>;
  const ligadas = await reservasDoHerculesDosCupons(
    client,
    brutas.filter((r) => r.situacao === "reservada").map((r) => String(r.id ?? "")).filter(Boolean),
  );
  if (ligadas.error) {
    console.error("[prometeu][cupom] reservas do Hércules não lidas", ligadas.error);
    return { error: "Não foi possível conferir a reserva no Hércules agora.", reservas: [] };
  }

  const reservas = brutas.map((r) => {
    const id = String(r.id ?? "");
    const situacao =
      r.situacao === "reservada" && reservaDoHerculesCaiu(ligadas.porCupom.get(id))
        ? "cancelada"
        : String(r.situacao ?? "");
    return {
      area: (r.area as null | string) ?? null,
      codigo: String(r.codigo ?? ""),
      createdAt: String(r.created_at ?? ""),
      credenciadoId: String(r.credenciado_id ?? ""),
      grupoId: String(r.grupo_id ?? ""),
      id,
      lote: String(r.lote ?? ""),
      paImpressaEm: (r.pa_impressa_em as null | string) ?? null,
      paImpressaVezes: Number(r.pa_impressa_vezes ?? 0),
      precoTabela: r.preco_tabela == null ? null : Number(r.preco_tabela),
      proponentes: Array.isArray(r.proponentes)
        ? (r.proponentes as ProponenteDaReserva[])
        : [],
      propostaLancadaEm: (r.proposta_lancada_em as null | string) ?? null,
      quadra: String(r.quadra ?? ""),
      situacao,
    };
  });

  return { reservas };
}

export type ContadoresDoEvento = {
  finalizadas: number;
  propostas: number;
  reservas: number;
};

/**
 * O mini dash da tela touch: Reservas = cupons vivos · Propostas = cupons com proposta
 * lançada na SECRETÁRIA · Finalizadas = concluídos do funil (a proposta acontece dentro da
 * secretária — Lucas, 24/08).
 */
export async function contadoresDoEvento(
  client: AdminClient,
  eventoId: string,
): Promise<ContadoresDoEvento> {
  const [reservasRes, concluidosRes] = await Promise.all([
    client
      .from("prometeu_reservas")
      .select("id, grupo_id, situacao, proposta_lancada_em")
      .eq("evento_id", eventoId),
    client
      .from("prometeu_credenciados")
      .select("id", { count: "exact", head: true })
      .eq("evento_id", eventoId)
      .eq("etapa", "concluido"),
  ]);

  const linhas = (reservasRes.data ?? []) as Array<{
    grupo_id: string;
    id: string;
    proposta_lancada_em: null | string;
    situacao: string;
  }>;
  // O cupom cuja reserva do Hércules caiu (cancelada na Venda) não é mais reserva viva. Sem ler o
  // Hércules, conta como estava: o mini dash a mais é o erro barato.
  const soltos =
    (await cuponsSoltosPeloHercules(
      client,
      linhas.filter((l) => l.situacao === "reservada").map((l) => l.id),
    )) ?? new Set<string>();
  const gruposVivos = new Set<string>();
  const gruposComProposta = new Set<string>();
  for (const linha of linhas) {
    if (linha.situacao === "reservada" && !soltos.has(linha.id)) gruposVivos.add(linha.grupo_id);
    if (linha.proposta_lancada_em) gruposComProposta.add(linha.grupo_id);
  }

  return {
    finalizadas: concluidosRes.count ?? 0,
    propostas: gruposComProposta.size,
    reservas: gruposVivos.size,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════════════════
// CANCELAR UMA RESERVA
//
// ⚠️ ISTO NÃO EXISTIA ATÉ 28/08/2026, e a falta doía: as colunas `situacao`, `cancelada_em` e
// `cancelada_motivo` estavam na migration 0101 desde o começo e NADA no código escrevia nelas.
// Um lote reservado por engano no salão só saía da prateleira por SQL na mão. O botão "cancelar"
// do tótem é outra coisa — ele abandona o atendimento ANTES de confirmar, e não desfaz reserva
// já gravada.
//
// É SOFT DELETE, e a trava do banco conta com isso: o índice único é parcial
// (`where situacao = 'reservada'`), então marcar como cancelada devolve o lote à prateleira na
// hora, sem apagar a história de que a reserva existiu. Quem reservou, quando, quais lotes e por
// que caiu — tudo fica.
//
// ⚠️ DESDE 18/09/2026 CANCELAR O CUPOM CANCELA A RESERVA DO HÉRCULES LIGADA A ELE. É ela que
// segura o lote em todas as telas; cancelar só o papel deixaria o lote preso na Venda por uma
// reserva que ninguém no salão enxerga.

export type ReservaCancelada = {
  codigos: string[];
  quantos: number;
  /** Quantas reservas do Hércules ligadas ao cupom foram canceladas junto. */
  reservasDoHercules: number;
};

/**
 * Cancela a reserva — o cupom inteiro, ou SÓ os lotes escolhidos — e a reserva do Hércules de cada
 * lote cancelado.
 *
 * Cancela o grupo inteiro por padrão: o cupom é indivisível para o cliente — ele levou UM papel com
 * três lotes. ⚠️ `codigos` existe porque devolver UM lote de um cupom com vários é caso real
 * (Lucas, 29/08/2026: *"o vitor vai devolver somente um lote, tem que especificar qual quando tem
 * mais de um"*). Lista vazia (ou ausente) = cupom inteiro.
 *
 * ⚠️ A ORDEM: primeiro a linha do cupom, depois a reserva do Hércules. Em nenhum instante o lote
 * aparece livre com um registro dizendo que ele tem dono: enquanto a reserva do Hércules não cai, o
 * lote segue reservado em todas as telas. Se ela não cair (erro de banco), a resposta diz e o
 * cancelamento pode ser repetido: a linha já cancelada com reserva do Hércules ainda `ativa` é
 * retomada aqui.
 *
 * ⚠️ LOTE QUE JÁ VIROU PROPOSTA NO HÉRCULES NÃO SE CANCELA POR AQUI, e o cupom inteiro fica como
 * está: a partir da proposta quem representa a venda é ela, com condições comerciais gravadas, e o
 * cancelamento é o da proposta, na tela Venda (a mesma régua da Venda).
 *
 * Idempotente: cancelar de novo o que já está cancelado não é erro, é resultado zero. O
 * operador pode bipar duas vezes sem susto.
 */
export async function cancelarReservaDoGrupo(
  client: AdminClient,
  entrada: {
    canceladoPor: null | string;
    /** O nome de quem cancelou, para o histórico da reserva no Hércules. */
    canceladoPorNome?: null | string;
    /** Quais lotes cancelar. Vazio = todos os do cupom. */
    codigos?: null | string[];
    grupoId: string;
    motivo: null | string;
  },
): Promise<{ error?: string; resultado?: ReservaCancelada }> {
  const grupoId = String(entrada.grupoId ?? "").trim();
  if (!grupoId) return { error: "Informe a reserva a cancelar." };

  const motivo = String(entrada.motivo ?? "").trim();
  const escolhidos = (entrada.codigos ?? [])
    .map((c) => String(c ?? "").trim().toUpperCase())
    .filter(Boolean);

  // ── As linhas do cupom em jogo (vivas e já canceladas: estas por causa da retomada) ──
  // O recorte por lote entra DEPOIS do filtro do grupo: um código só cancela dentro do cupom
  // que o operador abriu, nunca um lote de outro cliente com o mesmo número.
  let leitura = client
    .from("prometeu_reservas")
    .select("id, codigo, situacao")
    .eq("grupo_id", grupoId);
  if (escolhidos.length > 0) leitura = leitura.in("codigo", escolhidos);
  const { data: doCupom, error: erroDoCupom } = await leitura;
  if (erroDoCupom) return { error: erroDoCupom.message };

  const linhas = (doCupom ?? []) as Array<{ codigo: string; id: string; situacao: string }>;
  const ligadas = await reservasDoHerculesDosCupons(
    client,
    linhas.map((l) => l.id),
  );
  if (ligadas.error) {
    console.error("[prometeu][cancelar] reservas do Hércules não lidas", ligadas.error);
    return { error: "Não foi possível conferir a reserva no Hércules. Nada foi cancelado; tente de novo." };
  }

  const vivas = linhas.filter((l) => l.situacao === "reservada");
  const codigoDaLinha = new Map(linhas.map((l) => [l.id, l.codigo]));

  const emProposta = vivas.filter((l) =>
    (ligadas.porCupom.get(l.id) ?? []).some((r) => r.situacao === "proposta" || r.situacao === "vendida"),
  );
  if (emProposta.length > 0) {
    return {
      error: `${emProposta.map((l) => l.codigo).join(", ")} já tem proposta no Hércules. O cancelamento é o da proposta, na tela Venda. Nada foi cancelado.`,
    };
  }

  // As reservas do Hércules que ainda seguram lote destas linhas.
  const aCancelarNoHercules = linhas.flatMap((l) =>
    (ligadas.porCupom.get(l.id) ?? []).filter((r) => r.situacao === "ativa"),
  );

  if (escolhidos.length > 0 && vivas.length === 0 && aCancelarNoHercules.length === 0) {
    return { error: "Nenhum dos lotes escolhidos estava reservado neste cupom." };
  }

  // ── 1. As linhas do cupom ──
  let codigos: string[] = [];
  if (vivas.length > 0) {
    const { data, error } = await client
      .from("prometeu_reservas")
      .update({
        cancelada_em: new Date().toISOString(),
        // Quem cancelou vai junto do motivo: a coluna de autor é do CRIADOR da reserva, e
        // sobrescrevê-la apagaria quem fez a reserva original.
        cancelada_motivo: entrada.canceladoPor
          ? `${motivo || "Sem motivo informado"} (por ${entrada.canceladoPor})`
          : motivo || null,
        situacao: "cancelada",
      })
      .in("id", vivas.map((l) => l.id))
      // ⚠️ Só as VIVAS. Sem isto, recancelar carimbaria uma data nova por cima da original e
      // apagaria quando a reserva realmente caiu.
      .eq("situacao", "reservada")
      .select("codigo");
    if (error) return { error: error.message };
    codigos = ((data ?? []) as { codigo: string }[]).map((r) => r.codigo);
  }

  // ── 2. As reservas do Hércules ligadas ──
  let reservasDoHercules = 0;
  const presas: string[] = [];
  for (const reserva of aCancelarNoHercules) {
    const linhaId = String(reserva.prometeu_reserva_id ?? "");
    const r = await cancelarReservaNoHercules(client, {
      canceladoPor: entrada.canceladoPor,
      canceladoPorNome: entrada.canceladoPorNome ?? null,
      motivo: `${motivo || "Sem motivo informado"} (cancelada no salão do lançamento)`,
      reservaDoEventoId: linhaId,
      reservaId: reserva.id,
    });
    if (!r.ok) {
      console.error("[prometeu][cancelar] RESERVA DO HÉRCULES NÃO CANCELADA", {
        erro: r.motivo,
        linha: linhaId,
        reserva: reserva.id,
      });
      presas.push(codigoDaLinha.get(linhaId) ?? linhaId);
      continue;
    }
    if (r.cancelada) reservasDoHercules += 1;
  }

  const resultado: ReservaCancelada = { codigos, quantos: codigos.length, reservasDoHercules };
  if (presas.length > 0) {
    return {
      error: `O cupom foi cancelado, mas a reserva de ${presas.join(", ")} no Hércules não. Cancele de novo em instantes.`,
      resultado,
    };
  }
  return { resultado };
}

/** As reservas de um evento, para a tela que lista e cancela. */
export type ReservaDoEvento = {
  canceladaEm: null | string;
  /** Códigos das unidades, na MESMA ordem de `lotes`. */
  codigos: string[];
  canceladaMotivo: null | string;
  cliente: null | string;
  criadaEm: string;
  grupoId: string;
  lotes: string[];
  origem: null | string;
  paImpressaEm: null | string;
  propostaLancadaEm: null | string;
  situacao: string;
};

export async function reservasDoEvento(
  client: AdminClient,
  eventoId: string,
): Promise<{ error?: string; reservas?: ReservaDoEvento[] }> {
  const { data, error } = await client
    .from("prometeu_reservas")
    .select(
      "id, grupo_id, codigo, quadra, lote, situacao, proponentes, cancelada_em, cancelada_motivo, pa_impressa_em, proposta_lancada_em, created_at",
    )
    .eq("evento_id", eventoId)
    .order("created_at", { ascending: false });

  if (error) return { error: error.message };

  const brutas = (data ?? []) as Array<Record<string, unknown>>;
  // ⚠️ A LINHA SEGUE A RESERVA DO HÉRCULES (ver cupom-segue-o-hercules.ts): cancelada na Venda, o
  // cupom aparece cancelado aqui também. Sem ler o Hércules, a lista mostra a linha crua (é só a
  // lista; imprimir a PA passa por `reservasDoGrupo`, que recusa na dúvida).
  const soltos =
    (await cuponsSoltosPeloHercules(
      client,
      brutas.filter((l) => l.situacao === "reservada").map((l) => String(l.id ?? "")),
    )) ?? new Set<string>();
  const situacaoDaLinha = (linha: Record<string, unknown>) =>
    linha.situacao === "reservada" && soltos.has(String(linha.id ?? "")) ? "cancelada" : String(linha.situacao ?? "");

  // Uma linha por LOTE no banco, uma linha por CUPOM na tela: é o cupom que o operador tem na
  // mão quando vem cancelar.
  const porGrupo = new Map<string, ReservaDoEvento>();
  for (const linha of brutas) {
    const grupoId = String(linha.grupo_id ?? "");
    if (!grupoId) continue;
    const rotulo =
      `${String(linha.quadra ?? "").trim()} ${String(linha.lote ?? "").trim()}`.trim();
    const codigo = String(linha.codigo ?? "").trim();
    const existente = porGrupo.get(grupoId);
    if (existente) {
      existente.lotes.push(rotulo);
      existente.codigos.push(codigo);
      // Um lote vivo basta para o cupom estar vivo (devolver um lote de três não cancela o papel).
      if (situacaoDaLinha(linha) === "reservada") existente.situacao = "reservada";
      continue;
    }
    const proponentes = Array.isArray(linha.proponentes)
      ? (linha.proponentes as Array<{
          nome?: null | string;
          origem?: null | string;
        }>)
      : [];
    porGrupo.set(grupoId, {
      canceladaEm: (linha.cancelada_em as null | string) ?? null,
      canceladaMotivo: (linha.cancelada_motivo as null | string) ?? null,
      cliente: String(proponentes[0]?.nome ?? "").trim() || null,
      criadaEm: String(linha.created_at ?? ""),
      grupoId,
      // ⚠️ RÓTULO E CÓDIGO ANDAM JUNTOS, na MESMA ordem. O rótulo ("32 06") é o que o operador
      // lê; o código ("JDG3206") é o que o cancelamento por lote precisa mandar. Guardar só o
      // rótulo obrigaria a tela a remontar o código na mão, e uma quadra com letra quebraria.
      codigos: [codigo],
      lotes: [rotulo],
      origem: String(proponentes[0]?.origem ?? "").trim() || null,
      paImpressaEm: (linha.pa_impressa_em as null | string) ?? null,
      propostaLancadaEm: (linha.proposta_lancada_em as null | string) ?? null,
      situacao: situacaoDaLinha(linha),
    });
  }

  return { reservas: [...porGrupo.values()] };
}
