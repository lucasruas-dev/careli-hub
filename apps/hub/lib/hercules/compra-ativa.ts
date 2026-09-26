// O COMPRADOR DA CARTEIRA: quem já tem contrato ativo na família deste empreendimento.
//
// Lucas (26/09/2026), com o print do Hércules barrando um comprador antigo do Veredas do Ouro que
// reservou outra unidade: *"tem um cliente que é comprador, mas não está dando para ele comprar mais
// uma unidade. ele comprou a muito tempo, temos que aproveitar esses cadastros de comprador"*. As
// três decisões dele, literais das opções que escolheu:
//   • ALCANCE, "Só no mesmo": quem comprou no Veredas compra de novo no Veredas (e nas divisões da
//     mesma família, pai e filhos). Para outro empreendimento, abre CAD como hoje.
//   • ATRASO, "Passa mesmo em atraso": ter contrato ativo basta. Parcela vencida não é olhada.
//   • REGISTRO, "Nasce a CAD credenciada": ver `cad-do-comprador.ts`.
//
// ⚠️ A FONTE É O PANTEON, E NÃO O C2X (medido em 26/09/2026, só SELECT). `hercules_propostas` com
// etapa 'faturado' e o empreendimento PELO ID da unidade (`hercules_unidades.enterprise_id`, o id do
// C2X em texto). Dos 2.037 faturados, 1.969 batem 100% com o C2X ao vivo (pedido, estágio 4,
// empreendimento por id e CPF); os 68 restantes diferem só por serem PJ. Zero mudaram de estágio
// desde a carga. Ler o C2X aqui daria o mesmo resultado (1.501 contra 1.499), mas seria venda lida do
// legado (Lucas, 21/09: nada de venda lida do C2X) e poria o MySQL no caminho da proposta.
//
// ⚠️ NUNCA `empreendimento_codigo`. É sigla, e sigla muda (43 RDV virou PDI em 24/09): a chave é o id
// da unidade. Ver a memória "C2X pela SIGLA quebra no renome".
//
// ⚠️ SÓ 'faturado' É CONTRATO ATIVO. Cancelado e distrato não contam; assinatura e contrato também
// não (ainda não é contrato ativo, são 309 pessoas a mais que ficariam de fora de propósito).
//
// ⚠️ O CO-COMPRADOR CONTA (`CO_COMPRADOR_CONTA`). Ele é parte do contrato: está em client_2..5 no
// C2X, com percentual, assina e responde pela dívida. A regra "co-comprador não conta" (04/07) é da
// CACÁ, para CONTAR UNIDADES, e não para dizer quem comprou. São 43 pessoas a mais das 4.241 medidas.
// Ponto para o Lucas confirmar: desligar é trocar a constante, e só o titular passa a contar.
//
// ⚠️ PJ FICA DE FORA, como hoje: a régua do credenciamento exige CPF de 11 dígitos.
//
// ⚠️ ESTE MÓDULO NÃO CONHECE `FalhaAoLerCredenciamento`, de propósito: quem o chama (a régua do
// titular) embrulha qualquer erro nela. Assim não há import circular entre os dois arquivos.

import type { SupabaseClient } from "@supabase/supabase-js";

import { soDigitos } from "@/lib/apolo/documento";
import { hashIdentifier } from "@/lib/apolo/server";

type ClienteDeLeitura = Pick<SupabaseClient, "from">;

/** A etapa que faz de alguém "comprador com contrato ativo". Uma só. */
export const ETAPA_DO_CONTRATO_ATIVO = "faturado";

/**
 * O co-comprador (proponente que não é o titular) também conta como comprador da carteira.
 *
 * ⚠️ DECISÃO DO ZEUS, A CONFIRMAR COM O LUCAS (26/09/2026). Ver o topo do arquivo.
 */
export const CO_COMPRADOR_CONTA = true;

/** O valor de `apolo_esteira.origem` da CAD que nasce da carteira. */
export const ORIGEM_COMPRADOR_DA_CARTEIRA = "comprador_da_carteira";

const WORKSPACE = "careli";

/** O PostgREST corta em 1.000 linhas sem avisar: a leitura é paginada, com ordem fixa. */
const PAGINA = 1000;

/** Lote do `.in()` por URL (o teto seguro registrado na memória do projeto). */
const LOTE = 100;

/** O hash tem 64 caracteres, quase o dobro de um uuid: metade do lote cabe na mesma URL. */
const LOTE_DE_HASH = 50;

/** A linha de `hercules_propostas` que esta régua lê, com a unidade embutida. */
export type LinhaDoContrato = {
  cancelada_em?: null | string;
  cliente_c2x_id: null | number | string;
  cliente_documento: null | string;
  cliente_entity_id: null | string;
  cliente_nome?: null | string;
  codigo: null | string;
  compradores: unknown;
  etapa: null | string;
  etapa_desde: null | string;
  id: string;
  unidade:
    | null
    | UnidadeDoContrato
    | UnidadeDoContrato[];
};

type UnidadeDoContrato = {
  codigo: null | string;
  enterprise_id: null | number | string;
  id: string;
};

/** O contrato ativo que faz desta pessoa uma compradora da carteira neste empreendimento. */
export type CompraAtiva = {
  /** O usuário do C2X que o contrato aponta para esta pessoa (titular ou co). */
  c2xUserId: null | string;
  /** O código da venda (`hercules_propostas.codigo`). */
  codigo: null | string;
  /** Desde quando o contrato está faturado (`etapa_desde`). */
  desde: null | string;
  /** O id do C2X do empreendimento DA UNIDADE do contrato. */
  enterpriseIdDaUnidade: string;
  /** A entidade do Apolo que o contrato aponta, quando ele a guarda (venda nativa). */
  entityIdApontada: null | string;
  /**
   * A entidade em que a CAD do comprador deve nascer: a ligada ao usuário do C2X do contrato.
   * `null` até alguém resolvê-la (`resolverEntidadeDoContrato`).
   */
  entityIdDoContrato: null | string;
  papel: "co" | "titular";
  propostaId: string;
  /** O código da unidade do contrato ("Q07 L28"). */
  unidade: null | string;
};

/** Uma pessoa que compra num contrato ativo: o CPF, o nome gravado no contrato e a compra. */
export type CompradorDoContrato = {
  compra: CompraAtiva;
  cpf: string;
  nome: null | string;
};

function texto(v: unknown): string {
  return v === null || v === undefined ? "" : String(v).trim();
}

function unidadeDa(linha: LinhaDoContrato): null | UnidadeDoContrato {
  const u = linha.unidade;
  if (!u) return null;
  return Array.isArray(u) ? (u[0] ?? null) : u;
}

/**
 * Este contrato está ativo e dentro do escopo?
 *
 * ⚠️ A LEITURA JÁ FILTRA ISTO NO BANCO, e a função repete de propósito: é ela que os testes
 * exercitam com fixtures de distrato, assinatura e empreendimento vizinho, e é ela que impede uma
 * leitura escrita errada no futuro de deixar passar quem não devia.
 */
export function contratoAtivoNoEscopo(linha: LinhaDoContrato, escopo: ReadonlySet<string>): boolean {
  if (texto(linha.etapa).toLowerCase() !== ETAPA_DO_CONTRATO_ATIVO) return false;
  if (texto(linha.cancelada_em)) return false;
  const enterpriseId = texto(unidadeDa(linha)?.enterprise_id);
  return Boolean(enterpriseId) && escopo.has(enterpriseId);
}

/**
 * Quem compra neste contrato: o titular e, se `CO_COMPRADOR_CONTA`, os co-compradores.
 *
 * ⚠️ DOIS FORMATOS DE `compradores`, e os dois existem hoje: a carga do C2X grava
 * `{ c2x_user_id, documento, nome, percentual, titular }` e a venda nativa grava
 * `{ cpf, nome, participacao, telefone, titular }`. O documento vem com e sem máscara
 * (###.###.###-## e 11 dígitos); a comparação é sempre por dígitos.
 *
 * ⚠️ SÓ CPF. Documento que não tem 11 dígitos (CNPJ, vazio) não vira comprador: a régua do
 * credenciamento exige CPF, e a PJ continua abrindo CAD como hoje.
 */
export function compradoresDoContrato(
  linha: LinhaDoContrato,
  opcoes: { coComprador?: boolean } = {},
): CompradorDoContrato[] {
  const unidade = unidadeDa(linha);
  const enterpriseId = texto(unidade?.enterprise_id);
  if (!enterpriseId) return [];

  const base = {
    codigo: texto(linha.codigo) || null,
    desde: texto(linha.etapa_desde) || null,
    enterpriseIdDaUnidade: enterpriseId,
    entityIdDoContrato: null,
    propostaId: linha.id,
    unidade: texto(unidade?.codigo) || null,
  };

  const lista = Array.isArray(linha.compradores)
    ? (linha.compradores as Array<null | Record<string, unknown>>)
    : [];
  const docDe = (c: null | Record<string, unknown>) => soDigitos(texto(c?.documento) || texto(c?.cpf));
  const titularNaLista = lista.find((c) => c?.titular === true) ?? null;

  const saida: CompradorDoContrato[] = [];
  const cpfDoTitular = soDigitos(texto(linha.cliente_documento)) || docDe(titularNaLista);
  // O titular da venda nativa também é achado pela entidade que o contrato aponta; nesse caso ele
  // entra mesmo sem CPF legível (e `cpf` fica vazio, que nunca casa com um CPF de 11 dígitos).
  if (cpfDoTitular.length === 11 || (cpfDoTitular.length === 0 && texto(linha.cliente_entity_id))) {
    saida.push({
      compra: {
        ...base,
        c2xUserId: texto(linha.cliente_c2x_id) || texto(titularNaLista?.c2x_user_id) || null,
        entityIdApontada: texto(linha.cliente_entity_id) || null,
        papel: "titular",
      },
      cpf: cpfDoTitular,
      nome: texto(linha.cliente_nome) || texto(titularNaLista?.nome) || null,
    });
  }

  if (opcoes.coComprador ?? CO_COMPRADOR_CONTA) {
    for (const c of lista) {
      if (!c || c.titular === true) continue;
      const cpf = docDe(c);
      if (cpf.length !== 11 || cpf === cpfDoTitular) continue;
      saida.push({
        compra: {
          ...base,
          c2xUserId: texto(c.c2x_user_id) || null,
          entityIdApontada: texto(c.entity_id) || null,
          papel: "co",
        },
        cpf,
        nome: texto(c.nome) || null,
      });
    }
  }

  return saida;
}

/**
 * Ordem de preferência entre dois contratos da mesma pessoa, para `sort`.
 *
 * ⚠️ TITULAR ANTES DE CO, e depois o mais recente, com o id como desempate final. O titular é o
 * contrato que aponta a entidade dele com certeza (`cliente_c2x_id`), e sem ordem fixa a mesma
 * pergunta devolveria contratos diferentes a cada clique.
 */
function daMelhorCompra(a: CompraAtiva, b: CompraAtiva): number {
  if (a.papel !== b.papel) return a.papel === "titular" ? -1 : 1;
  return (
    texto(b.desde).localeCompare(texto(a.desde)) || a.propostaId.localeCompare(b.propostaId)
  );
}

/**
 * O contrato ativo desta pessoa DENTRO do escopo, ou `null`. Pura.
 *
 * A pessoa é achada pelo CPF (nos dois formatos) ou, para o titular da venda nativa, pela entidade
 * que o contrato aponta (`cliente_entity_id` em `entityIds`).
 */
export function compraDaPessoa(
  linhas: readonly LinhaDoContrato[],
  alvo: { coComprador?: boolean; cpf: string; entityIds: readonly string[]; escopo: readonly string[] },
): CompraAtiva | null {
  const cpf = soDigitos(alvo.cpf);
  if (cpf.length !== 11) return null;
  const escopo = new Set(alvo.escopo.map((id) => texto(id)).filter(Boolean));
  const ids = new Set(alvo.entityIds);

  const achadas: CompraAtiva[] = [];
  for (const linha of linhas) {
    if (!contratoAtivoNoEscopo(linha, escopo)) continue;
    for (const comprador of compradoresDoContrato(linha, { coComprador: alvo.coComprador })) {
      const peloCpf = comprador.cpf === cpf;
      const pelaEntidade =
        comprador.compra.papel === "titular" &&
        Boolean(comprador.compra.entityIdApontada) &&
        ids.has(comprador.compra.entityIdApontada as string);
      if (peloCpf || pelaEntidade) achadas.push(comprador.compra);
    }
  }

  return achadas.sort(daMelhorCompra)[0] ?? null;
}

/**
 * Os contratos ativos (faturados, não cancelados) cujas unidades estão no escopo.
 *
 * ⚠️ O EMPREENDIMENTO VEM DA UNIDADE, embutida com `!inner` e filtrada no banco pelo id do C2X. A
 * família de um empreendimento tem centenas de faturados (medido: 144 no VDO, 182 no Vale do Ouro
 * inteiro, 368 no 13), então uma leitura só, paginada, com ORDEM FIXA: paginar sem `order` perde
 * linha e o total ainda bate (memória "PostgREST teto de 1.000").
 *
 * ⚠️ ERRO LANÇA. Quem chama decide: a régua do titular transforma em `FalhaAoLerCredenciamento`
 * (503), nunca em "não credenciado".
 */
export async function lerContratosAtivos(
  admin: ClienteDeLeitura,
  escopo: readonly string[],
): Promise<LinhaDoContrato[]> {
  const ids = [...new Set(escopo.map((id) => texto(id)).filter(Boolean))];
  if (ids.length === 0) return [];

  const saida: LinhaDoContrato[] = [];
  for (let de = 0; ; de += PAGINA) {
    const { data, error } = await admin
      .from("hercules_propostas")
      .select(
        "id, codigo, etapa, etapa_desde, cancelada_em, cliente_c2x_id, cliente_documento, cliente_entity_id, cliente_nome, compradores, unidade:hercules_unidades!inner(id, codigo, enterprise_id)",
      )
      .eq("workspace_id", WORKSPACE)
      .eq("etapa", ETAPA_DO_CONTRATO_ATIVO)
      .is("cancelada_em", null)
      .in("unidade.enterprise_id", ids)
      .order("id", { ascending: true })
      .range(de, de + PAGINA - 1);
    if (error) throw new Error(`hercules_propostas: leitura falhou (${error.message})`);
    const pagina = (data ?? []) as unknown as LinhaDoContrato[];
    saida.push(...pagina);
    if (pagina.length < PAGINA) break;
  }
  return saida;
}

/**
 * A entidade do Apolo ligada a cada usuário do C2X, por `apolo_source_links`.
 *
 * ⚠️ É A ENTIDADE DO CONTRATO, a sincronizada do C2X. 74 CPFs de titular têm também uma entidade
 * nascida no Apolo; gravar a CAD nela acenderia o selo "nunca enviado" do Board e poria a pessoa no
 * lote de envio ao C2X (que só pega `metadata.source = 'apolo'`).
 */
export async function entidadesDosUsuariosDoC2x(
  admin: ClienteDeLeitura,
  usuarios: readonly string[],
): Promise<Map<string, string>> {
  const alvos = [...new Set(usuarios.map((u) => texto(u)).filter(Boolean))];
  const saida = new Map<string, string>();
  for (let i = 0; i < alvos.length; i += LOTE) {
    const lote = alvos.slice(i, i + LOTE);
    const { data, error } = await admin
      .from("apolo_source_links")
      .select("entity_id, source_id")
      .eq("source_system", "c2x")
      .eq("source_table", "users")
      .in("source_id", lote);
    if (error) throw new Error(`apolo_source_links: leitura falhou (${error.message})`);
    for (const l of (data ?? []) as Array<{ entity_id: null | string; source_id: null | string }>) {
      const id = texto(l.source_id);
      if (id && l.entity_id && !saida.has(id)) saida.set(id, l.entity_id);
    }
  }
  return saida;
}

/**
 * Em qual das entidades da pessoa a CAD do comprador nasce. Pura.
 *
 * Ordem: a ligada ao usuário do C2X do contrato; a que o contrato aponta; a primeira do CPF. As
 * duas primeiras só valem se forem MESMO desta pessoa (estão em `entityIds`, as entidades do CPF):
 * uma CAD gravada numa entidade que não carrega o CPF não seria achada na próxima proposta.
 */
export function escolherEntidadeDoContrato(
  compra: CompraAtiva,
  entityIds: readonly string[],
  ligadaAoUsuario: null | string,
): null | string {
  const doCpf = new Set(entityIds);
  if (ligadaAoUsuario && doCpf.has(ligadaAoUsuario)) return ligadaAoUsuario;
  if (compra.entityIdApontada && doCpf.has(compra.entityIdApontada)) return compra.entityIdApontada;
  return [...entityIds].sort()[0] ?? null;
}

/**
 * Resolve `entityIdDoContrato` de uma compra (uma ida a `apolo_source_links`, quando há usuário).
 */
export async function resolverEntidadeDoContrato(
  admin: ClienteDeLeitura,
  compra: CompraAtiva,
  entityIds: readonly string[],
): Promise<CompraAtiva> {
  const ligadas = compra.c2xUserId
    ? await entidadesDosUsuariosDoC2x(admin, [compra.c2xUserId])
    : new Map<string, string>();
  const ligada = compra.c2xUserId ? (ligadas.get(compra.c2xUserId) ?? null) : null;
  return { ...compra, entityIdDoContrato: escolherEntidadeDoContrato(compra, entityIds, ligada) };
}

/**
 * As entidades de cada CPF, pelas DUAS fontes do documento (a coluna de quem nasceu no Apolo e os
 * identificadores de quem veio do sync do C2X), em lote. É a mesma leitura de
 * `entidadesDoDocumento` (cliente-credenciado.ts), para várias pessoas de uma vez.
 */
export async function entidadesDosCpfs(
  admin: ClienteDeLeitura,
  cpfs: readonly string[],
): Promise<Map<string, string[]>> {
  const porHash = new Map<string, string>();
  for (const cpf of new Set(cpfs.map((c) => soDigitos(c)).filter((c) => c.length === 11))) {
    porHash.set(hashIdentifier("cpf", cpf), cpf);
  }
  const hashes = [...porHash.keys()];
  const saida = new Map<string, Set<string>>();
  const juntar = (hash: null | string, entityId: null | string) => {
    const cpf = hash ? porHash.get(hash) : undefined;
    if (!cpf || !entityId) return;
    saida.set(cpf, (saida.get(cpf) ?? new Set()).add(entityId));
  };

  for (let i = 0; i < hashes.length; i += LOTE_DE_HASH) {
    const lote = hashes.slice(i, i + LOTE_DE_HASH);
    const [porColuna, porIdentificador] = await Promise.all([
      admin.from("apolo_entities").select("id, document_hash").in("document_hash", lote),
      admin.from("apolo_entity_identifiers").select("entity_id, value_hash").in("value_hash", lote),
    ]);
    if (porColuna.error) throw new Error(`apolo_entities: leitura falhou (${porColuna.error.message})`);
    if (porIdentificador.error) {
      throw new Error(`apolo_entity_identifiers: leitura falhou (${porIdentificador.error.message})`);
    }
    for (const l of (porColuna.data ?? []) as Array<{ document_hash: null | string; id: null | string }>) {
      juntar(l.document_hash, l.id);
    }
    for (const l of (porIdentificador.data ?? []) as Array<{
      entity_id: null | string;
      value_hash: null | string;
    }>) {
      juntar(l.value_hash, l.entity_id);
    }
  }

  return new Map([...saida].map(([cpf, ids]) => [cpf, [...ids].sort()]));
}
