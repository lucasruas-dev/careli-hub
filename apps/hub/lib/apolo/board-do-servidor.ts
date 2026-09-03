import { NextResponse } from "next/server";

import { alertaC2xDaCad } from "@/lib/apolo/c2x-alerta-board";
import {
  C2X_ESCOLARIDADE,
  C2X_ESTADO_CIVIL,
  C2X_FAIXA_RENDA,
  C2X_REGIME_BENS,
  C2X_SEXO,
  normalizeSearch,
} from "@/lib/apolo/c2x-fields";
import type { C2xOption } from "@/lib/apolo/c2x-fields";
import { C2X_PROFISSOES } from "@/lib/apolo/c2x-professions";
import { catalogoDeEmpreendimentos } from "@/lib/apolo/catalogo-empreendimentos";
import { listEmpreendimentosAtivos } from "@/lib/apolo/credenciamento";
import {
  planejarHabilitacao,
  resumoDaHabilitacao,
  type EmpreendimentoPedido,
} from "@/lib/apolo/credenciamento-aprovacao";
import {
  chaveDoCorretor,
  conflitosDeCorretor,
  explicarConflitos,
  type VinculoDeCorretor,
} from "@/lib/apolo/credenciamento-trava-corretor";
import {
  avisarCredenciamentoAprovado,
  avisarCredenciamentoCorrecao,
  avisarCredenciamentoIndeferido,
  coordenadoresDosEmpreendimentos,
  corretoresDaImobiliaria,
  representanteDaImobiliaria,
  telefoneDaImobiliaria,
} from "@/lib/apolo/disparo-credenciamento";
import { contatoDaEntidadeImobiliaria } from "@/lib/apolo/disparo-imobiliaria";
import { canonizador } from "@/lib/apolo/empreendimento-equivalencia";
import { loadApoloEnterpriseCadastro } from "@/lib/apolo/empreendimentos";
import { atualizarEtapa, ehEtapaValida } from "@/lib/apolo/esteira";
import {
  lerCadDaEsteira,
  maisRecentePorEntidade,
  normalizarEnterpriseId,
} from "@/lib/apolo/esteira-cad";
import { grafiaCanonicaPorCliente as grafiaCanonicaDaImobiliaria } from "@/lib/apolo/imobiliaria-grafia";
import { prevendaLigadaNaSetting, type SettingPrevenda } from "@/lib/apolo/limite-credito";
import { comLimiteDeTempo, gerarESalvarCad } from "@/lib/apolo/salvar-cad";
import { createApoloAdminClient, fetchC2xCadastroByEntity } from "@/lib/apolo/server";
import type { ApoloC2xCadastro } from "@/lib/apolo/types";
import { toTitleCase } from "@/lib/format/name-case";
import { formatarTelefoneBR } from "@/lib/format/phone-br";

// O BOARD DO APOLO, DO LADO DO SERVIDOR — o miolo das rotas `/api/apolo/board/**`, num lugar só.
//
// POR QUE ESTE ARQUIVO EXISTE (02/09/2026). O portal comercial (Hércules, o portal dos
// coordenadores) ganhou a aba Cadastro do produto = *"a mesma visão do apolo, imobiliária e cads"*
// (Lucas). É o MESMO Board, com as MESMAS regras, por outra porta: cookie do portal no lugar do
// Bearer do hub e o recorte pelo empreendimento do coordenador. Duplicar as rotas seria copiar
// ~1.700 linhas que amanhã divergem no primeiro ajuste; então o miolo mora aqui e as duas portas
// (`app/api/apolo/board/**` e `app/api/incorporador/board/**`) são cascas finas: autenticam, fazem
// o recorte e chamam daqui.
//
// ⚠️ NADA DE AUTENTICAÇÃO AQUI. Quem chama já provou quem é (hub ou sessão do portal) e, no caso
// do portal, já conferiu que a CAD alvo está no escopo do empreendimento. Estas funções recebem
// o `adminClient` (service role) e o AUTOR e gravam; a régua de quem pode fica na porta.
//
// ⚠️ O CÓDIGO ABAIXO FOI MOVIDO DAS ROTAS TAL QUAL — comentários, decisões e armadilhas incluídos.
// O que mudou de verdade está marcado com "(02/09)": o recorte da fila por empreendimento, os
// ids de vínculo por entidade (para o recorte alcançar a imobiliária que só PEDIU) e o autor com
// nome no metadata da auditoria (a conta do portal não está em hub_users).

type AdminClient = NonNullable<ReturnType<typeof createApoloAdminClient>>;

export const ehUuid = (v: string): boolean =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

// Quem está agindo. `userId` é a conta do hub (uuid de hub_users) ou a do portal (uuid da conta
// do coordenador, que NÃO está em hub_users — por isso o nome viaja junto e vai para o metadata).
export type AutorDoBoard = {
  nome?: null | string;
  /** "board" (tela interna) ou "portal-comercial" (Hércules). Vai em `metadata.origem`. */
  origem: "board" | "portal-comercial";
  /** Nome que a CAD regenerada carrega como quem subiu o arquivo. */
  uploadedByName: null | string;
  userId: string;
};

// ═══════════════════════════════════════════════════════════════════════════════════════════
// 1) A FILA — GET /api/apolo/board
// ═══════════════════════════════════════════════════════════════════════════════════════════

/**
 * O RECORTE do portal comercial (02/09): só os cards do empreendimento do coordenador.
 *
 *   • `ids`: os enterprise_ids do C2X (divisões reais e, quando o produto cobre o grupo inteiro,
 *     o id do grupo) — a CAD entra se `esteira.enterprise_id` estiver aqui; a imobiliária entra
 *     se QUALQUER vínculo dela (pendente ou habilitado) apontar para um destes ids.
 *   • `nomes`: os nomes do catálogo cobertos pelo recorte — vira a lista `empreendimentos` da
 *     resposta (no lugar dos "abertos a credenciamento", que é a lista da tela interna).
 *   • `usuario`: a conta do portal, para `usuarioAtual` (ela não está em hub_users).
 */
export type RecorteDaFila = {
  ids: Set<string>;
  nomes: string[];
  usuario: { id: string; nome: string };
};

// UM CARD DO BOARD (por PESSOA; `enterpriseId` diz de qual CAD é). O tipo é declarado à mão
// para a rota do portal e a tela lerem o mesmo contrato; o `map` lá embaixo é conferido contra
// ele pelo typecheck.
export type ItemDaFila = {
  analistaId: null | string;
  c2xErro: null | string;
  c2xFalha: null | string;
  corretor: null | string;
  corretores: number;
  criadoEm: string;
  documento: string;
  empreendimentos: string[];
  enterpriseId: null | string;
  entidadeStatus: null | string;
  erroEnvio: boolean;
  etapa: null | string;
  id: string;
  imobiliaria: null | string;
  motivo: null | string;
  nome: string;
  pagoEm: null | string;
  papel: string;
  papelStatus: null | string;
  prevendaHabilitada: boolean;
  semCad: boolean;
  socios: number;
};

export type FilaDoBoard = {
  analistas: Array<{ id: string; nome: string }>;
  empreendimentos: string[];
  itens: ItemDaFila[];
  usuarioAtual: null | { id: string; nome: string };
};

type HubUserRow = { display_name: string | null; email: string | null; id: string };

// Estado do item na esteira do Board. Mora em tabela própria justamente para sobreviver ao
// sync do C2X, que substitui o metadata da entidade a cada rodada.
type EsteiraRow = {
  analista_id: string | null;
  atualizado_em: string | null;
  chegou_em: string | null;
  corretor: string | null;
  created_at: string | null;
  empreendimento: string | null;
  enterprise_id: string | null;
  entity_id: string;
  etapa: string | null;
  imobiliaria: string | null;
  // O porquê da etapa atual (correção/revisão/indeferido). É o que o operador escreveu no popup.
  motivo: string | null;
  // PIX da pré-venda confirmado (carimbo nosso, com hora). Null = ainda não pagou.
  pago_em: string | null;
};

type EntidadeDaFilaRow = {
  created_at: string;
  display_name: string;
  document_masked: string | null;
  entity_kind: string;
  id: string;
  legal_name: string | null;
  // review | active | attention | blocked | archived. Para a imobiliária, `attention` é
  // "esperando ela corrigir uma pendência" — o CHECK do papel não tem esse valor.
  status?: null | string;
  metadata: {
    bornRole?: string;
    // Carimbos do envio ao C2X (c2x-write-server.ts). São a prova de que a ficha JÁ existe no
    // legado: com qualquer um deles preenchido o alerta de "nunca enviado" não acende.
    c2xSynced?: boolean;
    c2xUserId?: number | null;
    cadastro?: { corretores?: unknown[]; empreendimentos?: unknown[]; socios?: unknown[] };
    // Onde o item está na esteira. Fica no metadata (jsonb livre) em vez de coluna própria.
    esteira?: {
      analistaId?: string | null;
      atualizadoEm?: string;
      chegouEm?: string | null;
      corretor?: string | null;
      empreendimento?: string | null;
      etapa?: string;
      imobiliaria?: string | null;
      origem?: string;
    };
    // Onde a ficha nasceu. 'apolo' = veio do wizard/portal e PRECISA subir para o C2X; sem isso
    // veio do sync do legado, ou seja já existe lá.
    source?: string;
  } | null;
  primary_city: string | null;
  primary_state: string | null;
};

export async function montarFilaDoBoard(
  adminClient: AdminClient,
  opts: { recorte?: RecorteDaFila; usuarioId: string },
): Promise<{ data: FilaDoBoard; ok: true } | { error: string; ok: false; status: number }> {
  const CAMPOS =
    "id, display_name, legal_name, document_masked, entity_kind, metadata, created_at, primary_city, primary_state, status";

  // A fila tem DUAS origens e elas não se sobrepõem:
  //
  // (a) o que nasceu pelos canais externos (wizard/portal) e aguarda validação. O filtro por
  //     source='apolo' existe porque sem ele entravam ~512 entidades do sync do C2X, que estão
  //     em 'review' por outro motivo e não são trabalho do operador.
  // (b) o que já foi COLOCADO na esteira — hoje, as CADs importadas do Asana. Essas são
  //     cadastros antigos: status 'active' e sem source, então o filtro (a) as excluiria e a
  //     coluna Credenciado ficaria vazia mesmo com a importação tendo funcionado.
  // A esteira vive em `apolo_esteira` (tabela própria). Ela NÃO pode morar no metadata da
  // entidade: o sync do C2X faz upsert substituindo o metadata inteiro, e em 20/jul isso
  // apagou etapa e analista de 122 CADs importadas.
  //
  // ⚠️ DESDE A 0080 CADA LINHA É UMA **CAD**, NÃO UMA PESSOA: a chave é
  // `(entity_id, enterprise_id)`, então a mesma pessoa aparece uma vez por empreendimento. O
  // `limit(2000)` passou a contar CADs.
  //
  // O CARD DO BOARD, POR ENQUANTO, CONTINUA SENDO POR PESSOA (o `id` do card é o entityId e a
  // tela inteira depende disso: seleção, painel de validação, rotas `/board/[id]/*`). Transformar
  // o card em CAD é uma decisão de produto à parte, e grande. O que MUDOU aqui é que o colapso
  // deixou de ser "a última linha que o banco devolveu" e passou a ser a CAD MAIS RECENTE, com
  // ordem explícita — e o card agora carrega o `enterpriseId` dela, para as ações saberem em qual
  // CAD estão mexendo.
  const { data: esteiraRows } = await adminClient
    .from("apolo_esteira")
    .select(
      "entity_id, enterprise_id, etapa, analista_id, chegou_em, corretor, empreendimento, imobiliaria, motivo, pago_em, atualizado_em, created_at",
    )
    .order("atualizado_em", { ascending: false })
    .order("created_at", { ascending: false })
    .order("enterprise_id", { ascending: false })
    .limit(2000);

  const linhasDaEsteira = (esteiraRows ?? []) as EsteiraRow[];

  // (02/09) NO PORTAL, "A MAIS RECENTE" É A MAIS RECENTE DENTRO DO RECORTE. O card é por pessoa
  // e carrega a CAD mais recente dela; o recorte lá embaixo (`noRecorte`) filtra por esse
  // `enterpriseId`. Com o mapa montado sobre a esteira INTEIRA, quem fez CAD no VOC em agosto e
  // no VOL em setembro sumia da fila do coordenador do VOC (o card carregava o VOL, fora do
  // recorte) — não vazava, mas escondia uma CAD que existe e é dele. Aqui só as linhas do recorte
  // disputam a recência; o caminho do hub (sem recorte) segue com a esteira inteira.
  const recorteDaFila = opts.recorte;
  const esteiraPorEntidade = maisRecentePorEntidade(
    recorteDaFila
      ? linhasDaEsteira.filter(
          (row) => row.enterprise_id && recorteDaFila.ids.has(String(row.enterprise_id).trim()),
        )
      : linhasDaEsteira,
  );
  const idsNaEsteira = [...esteiraPorEntidade.keys()];

  // ⚠️ EM LOTES DE 100, NUNCA `.in()` COM A FILA INTEIRA.
  //
  // Esta consulta é feita por URL (PostgREST), e a lista de ids vai NELA. Com as 653 CADs de hoje a
  // URL passava de 25 KB e voltava 400 Bad Request — medido em produção em 10/08. Como o código só
  // desiste quando as DUAS pernas falham, a falha era silenciosa: o Board servia apenas as 115
  // entidades da perna (a) e 540 CADs (433 credenciadas e 107 em revisão de crédito) simplesmente
  // não tinham card. Some daí o "sumiu do Board" e a impressão de que a ficha voltou para trás.
  //
  // O lote de 100 é o teto que a memória do projeto já registra para o `.in()` do PostgREST. Os
  // lotes vão em paralelo; um lote que falhe derruba só o próprio pedaço, e o `erroLotes` avisa.
  const LOTE_IDS = 100;
  const lotes: string[][] = [];
  for (let i = 0; i < idsNaEsteira.length; i += LOTE_IDS) {
    lotes.push(idsNaEsteira.slice(i, i + LOTE_IDS));
  }

  const lerEntidadesEmLotes = async () => {
    const respostas = await Promise.all(
      lotes.map((lote) =>
        adminClient
          .from("apolo_entities")
          .select(CAMPOS)
          .in("id", lote)
          .limit(LOTE_IDS),
      ),
    );
    return {
      data: respostas.flatMap((r) => r.data ?? []),
      error: respostas.find((r) => r.error)?.error ?? null,
    };
  };

  // ⚠️ IMOBILIÁRIA DECIDIDA NÃO PODE SUMIR DA TELA. Habilitar move a entidade para `active`, e a
  // consulta da fila só lista `review` — então o card DESAPARECIA no clique e a coluna
  // "Habilitada" ficava permanentemente zerada, mesmo depois de habilitar. O operador não tinha
  // como conferir o que acabou de fazer (Lucas, 17/08, olhando a coluna vazia).
  //
  // Janela de 30 dias: o Board é o que passou por aqui recentemente, não um arquivo histórico —
  // sem o corte, toda imobiliária já credenciada voltaria para a tela para sempre. Quem foi
  // INDEFERIDO continua com a entidade em `review` e já entra pela perna de cima.
  const DESDE = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const [daFila, decididas, naEsteira] = await Promise.all([
    adminClient
      .from("apolo_entities")
      .select(CAMPOS)
      .eq("status", "review")
      .eq("metadata->>source", "apolo")
      // CORRETOR NÃO É CAD (regra do Lucas, 05/08). Esta fila mostra o que precisa de VALIDAÇÃO de
      // documento de comprador; o corretor cadastra, vincula na imobiliária e acabou.
      //
      // ⚠️ ESTE É O SEGUNDO PORTÃO. Já barramos a gravação na esteira (em
      // /api/apolo/cadastro/salvar), mas o corretor CONTINUAVA aparecendo, porque esta consulta
      // não olha a esteira: ela lista TODA entidade "review" nascida no Apolo. Corrigir só a
      // esteira dava a impressão de resolvido e a tela seguia igual.
      //
      // `or` com is.null preserva quem não tem bornRole (entidades antigas, anteriores ao campo):
      // um `neq` puro as descartaria, porque em SQL NULL não é "diferente de" nada.
      .or("metadata->>bornRole.is.null,metadata->>bornRole.neq.corretor")
      .order("created_at", { ascending: true })
      // Teto alto (era 200): com ordem da mais ANTIGA pra mais nova, um teto baixo cortava as CADs
      // RECENTES da fila de validação — a partir da 201ª a CAD sumia do Board (incidente 22/jul:
      // "Poliana", a 272ª, não aparecia). 2000 = mesmo teto da esteira.
      .limit(2000),
    adminClient
      .from("apolo_entities")
      .select(CAMPOS)
      // `active` = habilitada · `attention` = esperando a imobiliária corrigir uma pendência.
      // As duas somem da perna de cima (que só lê `review`) e precisam continuar na tela: uma
      // para o operador conferir o que acabou de liberar, a outra porque é trabalho EM ABERTO.
      .in("status", ["active", "attention"])
      .eq("metadata->>source", "apolo")
      .eq("metadata->>bornRole", "imobiliaria")
      .gte("updated_at", DESDE)
      .order("updated_at", { ascending: false })
      .limit(500),
    lotes.length > 0 ? lerEntidadesEmLotes() : Promise.resolve({ data: [], error: null }),
  ]);

  if (daFila.error && naEsteira.error) {
    return { error: "Nao foi possivel carregar a fila.", ok: false, status: 500 };
  }

  // MOTIVO DA CORREÇÃO DA IMOBILIÁRIA. Ela não tem esteira: o motivo mora no evento de
  // auditoria `credenciamento_correcao` (metadata.motivos + observacao), gravado quando o
  // operador devolve. Sem este lookup a ficha em correção mostrava só o selo, sem o porquê
  // (Lucas, 22/08: "não aparece o estágio e nem o motivo, tem que ser padrão").
  // ⚠️ A perna certa é `decididas` — é ela que carrega active/attention; `naEsteira` é outra.
  const idsImobAttention = ((decididas.data ?? []) as Array<{ id: string; status?: null | string }>)
    .filter((row) => row.status === "attention")
    .map((row) => row.id);
  const motivoCorrecaoImob = new Map<string, string>();
  if (idsImobAttention.length > 0) {
    const { data: eventosCorrecao } = await adminClient
      .from("apolo_audit_events")
      .select("entity_id, metadata, created_at")
      .eq("action", "credenciamento_correcao")
      .in("entity_id", idsImobAttention.slice(0, 100))
      .order("created_at", { ascending: false })
      .limit(300);
    for (const evento of (eventosCorrecao ?? []) as Array<{
      created_at: string;
      entity_id: string;
      metadata: { motivos?: unknown; observacao?: unknown } | null;
    }>) {
      // Mais recentes primeiro: o primeiro visto por entidade é o que vale.
      if (motivoCorrecaoImob.has(evento.entity_id)) continue;
      const motivos = Array.isArray(evento.metadata?.motivos)
        ? evento.metadata.motivos.filter((m): m is string => typeof m === "string" && !!m.trim())
        : [];
      const observacao =
        typeof evento.metadata?.observacao === "string" ? evento.metadata.observacao.trim() : "";
      const texto = [...motivos, observacao].filter(Boolean).join(" · ");
      if (texto) motivoCorrecaoImob.set(evento.entity_id, texto);
    }
  }

  // FALHA DE ENVIO da pré-venda. O card só marca quem deu erro — quem está bem não mostra nada,
  // senão a fila vira um mar de ícones e o problema deixa de saltar aos olhos.
  const { data: falhas } = await adminClient
    .from("apolo_disparos")
    .select("entity_id")
    .in("tipo", ["prevenda_cobranca", "prevenda_recibo"])
    .eq("status", "falhou")
    .limit(2000);
  const comErroEnvio = new Set(
    ((falhas ?? []) as Array<{ entity_id: string | null }>)
      .map((f) => f.entity_id)
      .filter((id): id is string => Boolean(id)),
  );

  // NÃO SUBIU PARA O C2X. Alerta que o Lucas pediu (05/08): a CAD que falhou ao ser criada no
  // legado precisa gritar no Board. Só DOIS status valem alerta, e eles são coisas diferentes:
  //   'erro'            -> a API recusou de verdade; o motivo está na coluna `erro`
  //                        (ex.: "Escolaridade não pode ficar em branco").
  //   'sem_confirmacao' -> a API respondeu sucesso MAS o cadastro não apareceu no banco do C2X.
  //                        É o mais perigoso, porque PARECE sucesso: foi o incidente de 28/jul e
  //                        01/08, com a env de escrita apontando para o ambiente de teste.
  // Quem está resolvido/enviado/duplicado está no C2X e NÃO ganha ícone. Quem está 'pendente'
  // saiu do processo no meio do envio: sem prova de falha, segue sem marca de falha.
  //
  // ⚠️ Lido por STATUS, não por `.in()` com os ids do board: a fila tem centenas de ids e o `.in()`
  // com essa quantidade estoura o tamanho da URL do PostgREST (400 — foi o que derrubou a Iris).
  // Aqui voltam só as linhas com falha (dezenas), e o índice apolo_c2x_sync_status_idx cobre
  // exatamente esta consulta. Mesmo padrão do bloco de falha de envio acima.
  //
  // A SEGUNDA CONSULTA cobre o outro lado do mesmo problema: quem NUNCA FOI TENTADO. A tabela só
  // ganha linha no momento do envio, então quem parou antes disso (faltou campo, caiu em
  // "conferir", ou o gancho de credenciar nem rodou) não gera linha nenhuma e ficava em silêncio
  // total — em 05/08 eram 97 CADs credenciadas sem uma única linha de sync. Trazemos só os
  // `entity_id` de TODAS as linhas (470 hoje, uma coluna) para saber quem já foi tentado; a
  // decisão de acender fica em `alertaC2xDaCad`.
  const TETO_SYNC = 5000;
  const [falhasC2xRes, linhasC2xRes] = await Promise.all([
    adminClient
      .from("apolo_c2x_sync")
      .select("entity_id, status, erro")
      .in("status", ["erro", "sem_confirmacao"])
      .limit(2000),
    adminClient.from("apolo_c2x_sync").select("entity_id").limit(TETO_SYNC),
  ]);

  const c2xFalhaPorEntidade = new Map<string, { erro: string | null; status: string }>();
  for (const linha of (falhasC2xRes.data ?? []) as Array<{
    entity_id: string | null;
    erro: string | null;
    status: string;
  }>) {
    if (linha.entity_id) {
      c2xFalhaPorEntidade.set(linha.entity_id, { erro: linha.erro, status: linha.status });
    }
  }

  // Quem tem QUALQUER linha na fila do C2X (inclusive 'resolvido' e 'pendente'): já foi tentado,
  // então não é caso de "nunca enviado".
  const linhasC2x = (linhasC2xRes.data ?? []) as Array<{ entity_id: string | null }>;
  const tentadasNoC2x = new Set(
    linhasC2x.map((linha) => linha.entity_id).filter((id): id is string => Boolean(id)),
  );
  // Consulta com erro ou no teto = lista incompleta, e aí NÃO dá para afirmar que alguém nunca foi
  // tentado. Fail-safe: o aviso de "nunca enviado" some, o de falha continua. Melhor calar do que
  // acusar em massa quem está certo.
  const listaC2xCompleta = !linhasC2xRes.error && linhasC2x.length < TETO_SYNC;

  // Uma entidade pode cair nas duas consultas: dedup por id, preservando a ordem de chegada.
  const porId = new Map<string, EntidadeDaFilaRow>();
  for (const row of [
    ...(daFila.data ?? []),
    ...(decididas.data ?? []),
    ...(naEsteira.data ?? []),
  ] as EntidadeDaFilaRow[]) {
    if (!porId.has(row.id)) porId.set(row.id, row);
  }
  const data = [...porId.values()].sort((a, b) =>
    a.created_at.localeCompare(b.created_at),
  );

  const conta = (valor: unknown): number => (Array.isArray(valor) ? valor.length : 0);

  // Nomes dos empreendimentos: o Lucas precisa ver a QUE empreendimento cada item se refere,
  // tanto nas CADs quanto nas imobiliárias (é o eixo de filtro e ordenação da Torre).
  const nomesEmpreendimentos = (valor: unknown): string[] =>
    Array.isArray(valor)
      ? valor
          .map((item) => {
            const registro = item as { label?: unknown; nome?: unknown };
            const label = registro?.label ?? registro?.nome;
            return typeof label === "string" ? label.trim() : "";
          })
          .filter(Boolean)
      : [];

  // PADRONIZAÇÃO do nome da imobiliária (Lucas, 29/07: "temos que padronizar esses nomes"). A
  // imobiliária vive como TEXTO livre na esteira, e a MESMA imobiliária aparece com grafias
  // diferentes ("RR Soluções" x "RR Soluções Imobiliárias LTDA", "Mais Lotes" x "Mais Lotes
  // Negócios Imobiliários LTDA"). Aqui agrupamos as CADs pela ENTIDADE da imobiliária (vínculo em
  // apolo_relationships, com fallback no de-para apolo_imobiliaria_match por texto normalizado) e
  // exibimos, para todas as CADs de uma imobiliária, a MESMA grafia: a MAIS USADA entre elas
  // (empate -> a mais curta). Preserva a grafia original (acentos e siglas como "J&F"), sem forçar
  // caixa. O "apelido curador" curto fica para um passo seguinte (decisão do Lucas: unificar já).
  // Sem entidade resolvida, cai no texto normalizado (junta ao menos as grafias idênticas).
  // A regra mora em `lib/apolo/imobiliaria-grafia.ts` desde 14/08 — o painel público do
  // coordenador precisa da MESMA canonização, e duas cópias divergem no primeiro ajuste.
  const grafiaCanonicaPorCliente = await grafiaCanonicaDaImobiliaria(
    adminClient,
    [...esteiraPorEntidade.values()],
  );

  // PRÉ-VENDA POR EMPREENDIMENTO (regra do Lucas, 10/08: "pré-venda só existe se estiver
  // habilitado"). A tela precisa saber CAD a CAD, porque a etapa Pré-venda não é do processo: é
  // do empreendimento. Uma leitura só (são poucas linhas) e a MESMA regra do servidor, importada —
  // não uma segunda cópia que amanhã diverge.
  const { data: settingsRows } = await adminClient
    .from("apolo_enterprise_settings")
    .select("enterprise_id, prevenda_habilitada, valor_pix, credenciamento_ativo")
    .limit(500);

  // Os que estão abertos a credenciamento: é essa a lista que o seletor da tela oferece.
  const settingsAtivosRows = ((settingsRows ?? []) as Array<{
    credenciamento_ativo: boolean | null;
    enterprise_id: string;
  }>).filter((linha) => linha.credenciamento_ativo === true);

  const prevendaPorEmpreendimento = new Map<string, boolean>();
  for (const linha of (settingsRows ?? []) as Array<SettingPrevenda & { enterprise_id: string }>) {
    prevendaPorEmpreendimento.set(String(linha.enterprise_id), prevendaLigadaNaSetting(linha));
  }

  // ⚠️ O STATUS DO PAPEL É A ETAPA DA IMOBILIÁRIA. Ela não tem linha em `apolo_esteira` (medido:
  // 435 de 435), então a coluna do Board não pode sair de `esteira.etapa` — é por isso que a
  // Beatriz Teodora voltava para "Validação" a cada F5, mesmo depois de indeferida: a decisão
  // estava gravada em `apolo_entity_profiles.status` e a tela nunca lia esse campo.
  //   blocked = Recusada · active = Habilitada · review = Validação
  // CATÁLOGO DE EMPREENDIMENTOS: a lista canônica, já AGRUPADA (LBF+LBR+LBP viram um "Lagoa
  // Bonita"). Serve para duas coisas: traduzir o `enterpriseId` do vínculo em nome, e alimentar o
  // seletor da tela — que antes se montava só com o que aparecia nos cards e, por isso, escondia
  // todo empreendimento sem CAD.
  //
  // Falha na leitura NÃO derruba o Board: sem catálogo o card cai nas fontes antigas (cadastro e
  // esteira) e o seletor volta a ser o derivado. Perder a fila inteira por causa do rótulo de um
  // filtro seria trocar um problema pequeno por um grande.
  const catalogo = await catalogoDeEmpreendimentos(Date.now());

  // TRADUÇÃO id → nome, para TODO empreendimento do catálogo. Vale também para o que não está
  // aberto a credenciamento: uma imobiliária pode ter vínculo antigo com empreendimento já
  // encerrado, e mostrar o id cru no card seria pior do que mostrar o nome.
  const nomeDoGrupo = new Map<string, string>();
  for (const emp of catalogo) {
    for (const real of emp.stageIds) nomeDoGrupo.set(String(real), emp.name);
    nomeDoGrupo.set(emp.id, emp.name);
  }

  // ⚠️ O SELETOR mostra só o que está ABERTO A CREDENCIAMENTO, não o catálogo inteiro. São 8 hoje,
  // contra 36 no C2X — a lista completa traria servidor de treinamento, teste de split e
  // empreendimento encerrado, e o filtro viraria um índice do legado em vez de uma ferramenta de
  // trabalho. Os `credenciamento_ativo` são exatamente os que podem receber CAD.
  const idsAtivos = new Set(
    ((settingsAtivosRows ?? []) as Array<{ enterprise_id: string }>).map((linha) =>
      String(linha.enterprise_id),
    ),
  );
  const nomesAtivos = catalogo
    .filter((emp) => idsAtivos.has(emp.id) || emp.stageIds.some((id) => idsAtivos.has(id)))
    .map((emp) => emp.name);

  const idsDaLista = data.map((row) => row.id);
  const papelStatusPorEntidade = new Map<string, string>();
  for (let i = 0; i < idsDaLista.length; i += 100) {
    // Em lotes de 100: `.in()` com centenas de ids estoura o tamanho da URL do PostgREST.
    const { data: papeis } = await adminClient
      .from("apolo_entity_profiles")
      .select("entity_id, status")
      .eq("profile", "imobiliaria")
      .in("entity_id", idsDaLista.slice(i, i + 100));

    for (const linha of (papeis ?? []) as Array<{ entity_id: string; status: null | string }>) {
      if (linha.status) papelStatusPorEntidade.set(linha.entity_id, linha.status);
    }
  }

  // ⚠️ O EMPREENDIMENTO DA IMOBILIÁRIA MORA NO VÍNCULO, não no texto do cadastro.
  //
  // Caso medido (17/08, apontado pelo Lucas: "não está aparecendo Lagoa Bonita"): a DANY CASTRO
  // está habilitada nas TRÊS divisões do Lagoa Bonita (LBF, LBR e LBP, todas `verified`) e o
  // `metadata.cadastro.empreendimentos` dela é NULO — ela veio do C2X, não do wizard. O card
  // aparecia sem empreendimento nenhum, e como o seletor do Board se monta a partir do que está
  // nos cards, o Lagoa Bonita simplesmente não existia na lista de opções.
  //
  // O vínculo guarda o `enterpriseId` do C2X e quase nunca o `label` (medido: 1 de 10 grupos tem),
  // então o nome vem do CATÁLOGO — que já entrega o empreendimento AGRUPADO ("Lagoa Bonita" para
  // LBF+LBR+LBP). É a regra do Lucas: as divisões existem para nós, o mercado vê um só.
  const vinculosPorEntidade = new Map<string, Set<string>>();
  // TODO vínculo de empreendimento da imobiliária (pendente OU habilitado), por ID CRU. Não
  // alimenta o card: existe para o RECORTE do portal comercial — o coordenador de um produto
  // precisa ver a imobiliária que PEDIU o produto dele (vínculo `pending`) para habilitá-la.
  const idsDeVinculoPorEntidade = new Map<string, Set<string>>();
  for (let i = 0; i < idsDaLista.length; i += 100) {
    // Lotes de 100: `.in()` com centenas de ids estoura o tamanho da URL do PostgREST.
    const { data: vinculos } = await adminClient
      .from("apolo_relationships")
      .select("entity_id, metadata, status")
      .eq("relationship_type", "empreendimento")
      .in("entity_id", idsDaLista.slice(i, i + 100));

    for (const linha of (vinculos ?? []) as Array<{
      entity_id: string;
      metadata: { enterpriseId?: string } | null;
      status: null | string;
    }>) {
      const idDoVinculo = linha.metadata?.enterpriseId;
      if (idDoVinculo) {
        const ids = idsDeVinculoPorEntidade.get(linha.entity_id) ?? new Set<string>();
        ids.add(String(idDoVinculo).trim());
        idsDeVinculoPorEntidade.set(linha.entity_id, ids);
      }

      // `pending` é pedido em análise e não habilita: mostrar como se fosse liberado faria o
      // Board dizer que a imobiliária já trabalha um empreendimento que ela ainda não pode.
      if (linha.status !== "verified") continue;
      const id = idDoVinculo;
      if (!id) continue;

      const nome = nomeDoGrupo.get(String(id));
      if (!nome) continue;

      const atual = vinculosPorEntidade.get(linha.entity_id) ?? new Set<string>();
      atual.add(nome);
      vinculosPorEntidade.set(linha.entity_id, atual);
    }
  }

  const itens = data.map((row) => {
    const cadastro = row.metadata?.cadastro;
    const esteira = esteiraPorEntidade.get(row.id);

    const falhaC2x = c2xFalhaPorEntidade.get(row.id) ?? null;
    // Um aviso só, decidido em UM lugar (lib/apolo/c2x-alerta-board.ts): a falha do envio e o
    // "credenciado que nunca subiu" são o mesmo assunto na tela e disputam o mesmo selo.
    const alertaC2x = alertaC2xDaCad({
      etapa: esteira?.etapa ?? null,
      falhaSync: falhaC2x?.status ?? null,
      listaSyncCompleta: listaC2xCompleta,
      metadata: row.metadata,
      temLinhaSync: tentadasNoC2x.has(row.id),
    });

    // O empreendimento vem, nesta ordem: do VÍNCULO habilitado (a fonte de verdade, e a única que
    // existe para quem veio do C2X), do cadastro (quem nasceu no wizard) ou da esteira (importado
    // do Asana, cadastro antigo sem `metadata.cadastro`).
    const doVinculo = [...(vinculosPorEntidade.get(row.id) ?? [])];
    const doCadastro = nomesEmpreendimentos(cadastro?.empreendimentos);
    const empreendimentos =
      doVinculo.length > 0
        ? doVinculo
        : doCadastro.length > 0
          ? doCadastro
          : esteira?.empreendimento
            ? [esteira.empreendimento]
            : [];

    return {
      // Responsável salvo. Sem isto o Board volta a mostrar "Sem analista" a cada carga.
      analistaId: esteira?.analista_id ?? null,
      // Motivo da recusa do C2X, para o tooltip do ícone. Null quando não falhou.
      c2xErro: falhaC2x?.erro ?? null,
      // O que o selo do card deve mostrar sobre o C2X:
      //   'erro'            -> a API recusou (motivo em c2xErro);
      //   'sem_confirmacao' -> respondeu sucesso mas o cadastro não apareceu no banco do C2X;
      //   'nunca_enviado'   -> credenciado no Apolo e nunca chegou a ser enviado;
      //   null              -> está no C2X, ou ainda não é hora de cobrar (não mostra nada).
      c2xFalha: alertaC2x,
      corretor: esteira?.corretor ?? null,
      corretores: conta(cadastro?.corretores),
      // Quando a CAD chegou. Para o que veio do Asana é a data da própria CAD; o created_at
      // da entidade seria a data do SYNC do C2X (100 das 122 no mesmo segundo), que não diz
      // nada sobre a chegada e ainda ordenaria a fila errado.
      criadoEm: esteira?.chegou_em ?? row.created_at,
      documento: row.document_masked ?? "",
      empreendimentos,
      // De QUAL CAD é este card (metade da chave da esteira). A tela devolve isto nas ações, para
      // a etapa não ser gravada na CAD que a pessoa tem em outro loteamento.
      enterpriseId: esteira?.enterprise_id ?? null,
      imobiliaria: grafiaCanonicaPorCliente.get(row.id) ?? esteira?.imobiliaria ?? null,
      // A etapa salva no banco. A tela usa isto como ponto de partida do item; sem ele, tudo
      // voltava para "Validação" a cada carregamento porque a etapa só existia em memória.
      // Da TABELA, não do metadata: para as CADs vindas do C2X o metadata é apagado pelo
      // sync, e era exatamente por ler daqui que a coluna "Análise de crédito" aparecia
      // zerada mesmo com 122 registros corretos no banco.
      etapa: esteira?.etapa ?? null,
      // O PORQUÊ da etapa. A tela de correção dizia só o texto genérico ("aguardando o documento
      // ou a informação que faltou") e o motivo real — que o operador é OBRIGADO a escrever no
      // popup — morria no banco (Lucas, 22/08: "aqui tem que apontar o porque estamos colocando
      // essa cad em correção").
      motivo: esteira?.motivo ?? motivoCorrecaoImob.get(row.id) ?? null,
      // Só é true quando algum envio da pré-venda falhou — o card marca em vermelho.
      erroEnvio: comErroEnvio.has(row.id),
      id: row.id,
      nome: row.legal_name || row.display_name,
      // PIX da pré-venda: alimenta o selo "PAGO" no card e o filtro de pagos.
      pagoEm: esteira?.pago_em ?? null,
      // A etapa Pré-venda existe para ESTA CAD? Vem do empreendimento dela. Sem CAD não há
      // empreendimento, e a resposta é não — mesma regra fail-closed do servidor.
      prevendaHabilitada: esteira?.enterprise_id
        ? (prevendaPorEmpreendimento.get(String(esteira.enterprise_id)) ?? false)
        : false,
      // SEM CAD NA ESTEIRA. O card existe (a entidade nasceu no wizard) mas não há linha em
      // `apolo_esteira`, então ele não tem etapa nem empreendimento — e é por isso que ele reaparece
      // em Validação a cada recarga, por mais que a análise de crédito já tenha sido feita. A tela
      // marca em vez de fingir que está tudo certo; a saída é informar o empreendimento no cadastro.
      semCad: !esteira,
      // O papel é o `bornRole` da ficha. O fallback NÃO pode ser "PJ = imobiliária": esta lista
      // é a esteira de CADs, e uma CAD de empresa é um CLIENTE PJ, não uma imobiliária. Com a
      // regra antiga, FM SOLUCOES INDUSTRIAIS (credenciada, veio do sync do C2X e por isso não
      // tem bornRole) aparecia na trilha de imobiliária, com as etapas erradas. Toda ficha
      // nascida no Apolo tem bornRole, então o fallback só alcança o que veio do sync.
      papel: row.metadata?.bornRole ?? "prospect",
      // `attention` = a imobiliária foi para correção. Fica na ENTIDADE porque o CHECK do papel
      // não tem esse valor (só active|review|blocked|archived).
      entidadeStatus: row.status ?? null,
      // Só faz sentido para imobiliária; para o resto fica null e a tela ignora.
      papelStatus: papelStatusPorEntidade.get(row.id) ?? null,
      socios: conta(cadastro?.socios),
    };
  });

  // Analistas = usuários internos do hub, pra atribuir quem está cuidando de cada item.
  const { data: usuarios } = await adminClient
    .from("hub_users")
    .select("id, display_name, email")
    .order("display_name", { ascending: true })
    .limit(200);

  const analistas = ((usuarios ?? []) as HubUserRow[])
    .map((row) => ({ id: row.id, nome: row.display_name || row.email || "" }))
    .filter((row) => row.nome);

  // Quem abre o processo assume a análise (regra do Lucas): a tela precisa saber quem está logado.
  const usuarioAtual =
    analistas.find((pessoa) => pessoa.id === opts.usuarioId) ?? null;

  // A lista canônica para o seletor da tela. Vai ORDENADA e já agrupada: o seletor não pode mais
  // ser derivado dos cards, senão empreendimento sem CAD nenhuma continua invisível — que foi
  // exatamente o caso do Lagoa Bonita.
  const empreendimentosDoCatalogo = [...new Set(nomesAtivos)].sort((a, b) =>
    a.localeCompare(b, "pt-BR"),
  );

  // (02/09) O RECORTE DO PORTAL. A fila inteira foi montada acima com as mesmas regras da tela
  // interna; aqui ela é reduzida ao empreendimento do coordenador. Fail-closed: card sem
  // `enterpriseId` e sem vínculo em nenhum id do recorte NÃO entra — a CAD "sem CAD" (`semCad`)
  // de outro loteamento não pode aparecer para ele.
  if (opts.recorte) {
    const { ids, nomes, usuario } = opts.recorte;
    const noRecorte = (item: (typeof itens)[number]): boolean => {
      if (item.enterpriseId && ids.has(String(item.enterpriseId).trim())) return true;
      if (item.papel !== "imobiliaria") return false;
      const vinculos = idsDeVinculoPorEntidade.get(item.id);
      if (!vinculos) return false;
      for (const id of vinculos) if (ids.has(id)) return true;
      return false;
    };

    return {
      data: {
        analistas,
        empreendimentos: [...new Set(nomes)].sort((a, b) => a.localeCompare(b, "pt-BR")),
        itens: itens.filter(noRecorte),
        usuarioAtual: usuarioAtual ?? { id: usuario.id, nome: usuario.nome },
      },
      ok: true,
    };
  }

  return {
    data: { analistas, empreendimentos: empreendimentosDoCatalogo, itens, usuarioAtual },
    ok: true,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════════════════
// 2) A FICHA — GET e PATCH /api/apolo/board/[id]
// ═══════════════════════════════════════════════════════════════════════════════════════════

// Ficha COMPLETA de um item da esteira, pro operador validar com o documento ao lado. Devolve os
// dados crus salvos no cadastro (metadata.cadastro + endereço + contatos); quem monta as seções
// é a tela, que já tem os catálogos (sexo, estado civil, profissão) e os formatadores.
// Ver [[project_esteira_credenciamento_venda]].

type EntidadeDaFichaRow = {
  created_at: string;
  display_name: string;
  document_masked: string | null;
  entity_kind: string;
  id: string;
  legal_name: string | null;
  metadata: {
    bornRole?: string;
    cadastro?: Record<string, unknown>;
    cadastroEditado?: Record<string, unknown>;
  } | null;
  trade_name: string | null;
};

type AddressRow = {
  city: string | null;
  complement: string | null;
  district: string | null;
  number: string | null;
  postal_code: string | null;
  state: string | null;
  street: string | null;
};

type ContactRow = { contact_type: string; value: string };

const texto = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

// `authorizeApoloWrite` devolve "local-hub-user" quando não há Supabase server-side; gravar
// isso em coluna uuid quebra o insert inteiro.
// Campos que são NOME de gente ou de lugar: vão para "Primeira Maiúscula".
const CAMPOS_DE_NOME = new Set([
  "bairro",
  "cidade",
  "complemento",
  "conjugeMae",
  "conjugeNome",
  "logradouro",
  "nacionalidade",
  "naturalidade",
  "nomeMae",
  "nomePai",
]);

function padronizar(chave: string, valor: unknown): unknown {
  if (typeof valor !== "string") return valor;
  if (chave.toLowerCase().includes("telefone")) return formatarTelefoneBR(valor);
  if (CAMPOS_DE_NOME.has(chave)) return toTitleCase(valor);
  return valor;
}

// Reverte um VALOR já resolvido do C2X (ex.: "Masculino", "Casado (a)") para o ID que a tela
// de validação usa nos selects. A ficha lê `sexoId`/`estadoCivilId`/etc. e resolve o rótulo
// com `opcao(lista, id)`; o c2xCadastro já traz o rótulo pronto, então o caminho é o inverso:
// achar na lista o item cujo label bate (tolerante a acento/caixa) e devolver o id como string.
function idPorRotulo(lista: C2xOption[], valor: string | null): string {
  if (!valor) return "";
  const alvo = normalizeSearch(valor);
  const achado = lista.find((o) => normalizeSearch(o.label) === alvo);
  return achado ? String(achado.id) : "";
}

// "02/05/1980" (BR, como o c2xCadastro devolve) -> "1980-05-02" (ISO, o que o input date da
// ficha espera; a EXIBIÇÃO via formatDateBR e o calcIdade aceitam os dois formatos).
function brParaIso(valor: string | null): string {
  if (!valor) return "";
  const m = valor.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : valor;
}

// Converte a ficha AO VIVO do C2X (`ApoloC2xCadastro`, a mesma fonte da aba Cadastro do CRM
// 360) para as MESMAS chaves que a tela de validação lê de `cadastro` — ver `montarSecoes` em
// modules/apolo/blocks/board/board-view.tsx. Só devolve chave COM valor: assim o merge nunca
// apaga o que veio do metadata/esteira com uma string vazia.
function mapearC2xParaFicha(c2x: ApoloC2xCadastro): Record<string, string> {
  const bruto: Record<string, string> = {
    // Identificação (PF)
    dataNascimento: brParaIso(c2x.birthday),
    nomeMae: c2x.motherName ?? "",
    naturalidade: c2x.naturalness ?? "",
    nacionalidade: c2x.nacionality ?? "",
    sexoId: idPorRotulo(C2X_SEXO, c2x.sex),
    estadoCivilId: idPorRotulo(C2X_ESTADO_CIVIL, c2x.civilState),
    regimeBensId: idPorRotulo(C2X_REGIME_BENS, c2x.propertyRegime),
    // Perfil (PF)
    escolaridadeId: idPorRotulo(C2X_ESCOLARIDADE, c2x.schooling),
    rendaId: idPorRotulo(C2X_FAIXA_RENDA, c2x.salaryRange),
    profissaoId: idPorRotulo(C2X_PROFISSOES, c2x.profession),
    // Endereço
    logradouro: c2x.street ?? "",
    numero: c2x.number ?? "",
    complemento: c2x.complement ?? "",
    bairro: c2x.district ?? "",
    cep: c2x.zipcode ?? "",
    cidade: c2x.city ?? "",
    uf: c2x.state ?? "",
    // Empresa (PJ) — só os campos com correspondência direta no C2X.
    dataAbertura: brParaIso(c2x.openCompanyDate),
    dataAtualizacaoCadastral: brParaIso(c2x.socialContractUpdatedAt),
    creci: c2x.creciNumber ?? "",
  };
  const limpo: Record<string, string> = {};
  for (const [chave, valor] of Object.entries(bruto)) {
    if (valor) limpo[chave] = valor;
  }
  return limpo;
}

/**
 * A ficha da PESSOA `id`. `enterpriseId` diz de qual CAD é a ficha (a esteira é
 * `(entity_id, enterprise_id)` desde a 0080); sem ele, a MAIS RECENTE.
 */
export async function lerFichaDoBoard(
  adminClient: AdminClient,
  id: string,
  enterpriseId: null | string,
): Promise<NextResponse> {
  const { data: entity } = await adminClient
    .from("apolo_entities")
    .select(
      "id, display_name, legal_name, trade_name, document_masked, entity_kind, metadata, created_at",
    )
    .eq("id", id)
    .maybeSingle<EntidadeDaFichaRow>();

  if (!entity) {
    return NextResponse.json({ error: "Entidade nao encontrada." }, { status: 404 });
  }

  const [{ data: enderecos }, { data: contatos }] = await Promise.all([
    adminClient
      .from("apolo_addresses")
      .select("street, number, complement, district, city, state, postal_code")
      .eq("entity_id", id)
      .limit(5),
    adminClient
      .from("apolo_contacts")
      .select("contact_type, value")
      .eq("entity_id", id)
      .limit(20),
  ]);

  const endereco = ((enderecos ?? []) as AddressRow[])[0] ?? null;
  const lista = (contatos ?? []) as ContactRow[];

  // A ficha vive em `apolo_esteira.ficha` (tabela própria) — o que o OCR leu, o que veio do
  // formulário do Asana e o que o OPERADOR digitou. Não pode ficar no metadata da entidade:
  // o sync do C2X substitui o metadata inteiro a cada rodada e apagaria o trabalho dele.
  //
  // ⚠️ `[id]` É A PESSOA, NÃO A CAD (a chave da esteira é `entity_id + enterprise_id` desde a
  // 0080). `?enterpriseId=` diz de qual CAD é a ficha; sem ele, a MAIS RECENTE. Enquanto o card
  // do Board for por pessoa, este default é o que mantém a tela coerente com o que ela lista.
  const esteiraRow = await lerCadDaEsteira<{
    ficha: Record<string, unknown> | null;
    ficha_editada_em: string | null;
  }>(adminClient, id, "ficha, ficha_editada_em", { enterpriseId });

  const daEsteira = (esteiraRow?.ficha ?? {}) as Record<string, unknown>;

  // O que o FORMULÁRIO do Asana diz sobre esta CAD (último laudo do diagnóstico). É a
  // referência que o operador usa para decidir: o Asana separa proponente de cônjuge e diz
  // se é PF ou PJ. Sem isso na tela, ele teria que abrir o Asana a cada ficha.
  const { data: laudoRow } = await adminClient
    .from("apolo_audit_events")
    .select("metadata, created_at")
    .eq("entity_id", id)
    .eq("action", "diagnostico_cad")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const laudo = ((laudoRow as { metadata: Record<string, unknown> } | null)?.metadata ??
    null) as Record<string, unknown> | null;

  // CÔNJUGE: vive em `apolo_relationships` (label = nome, metadata = cpf/nascimento/contato).
  // A tela precisa dele para o contrato — casado sem cônjuge não fecha venda.
  const { data: relConjuge } = await adminClient
    .from("apolo_relationships")
    .select("label, metadata")
    .eq("entity_id", id)
    .eq("relationship_type", "conjuge")
    .limit(1)
    .maybeSingle();

  const doRelacionamento = (relConjuge ?? null) as {
    label: string | null;
    metadata: Record<string, unknown> | null;
  } | null;
  // Ficha AO VIVO do C2X. Os CADs que vieram do sync têm `metadata.cadastro` só com nomes
  // (sem nascimento/mãe/sexo/naturalidade/endereço) e `apolo_esteira.ficha` só com o que o
  // operador mexeu — por isso a validação mostrava tudo "—" para eles. A fonte completa é a
  // MESMA da aba Cadastro do CRM 360: o `users` do C2X, resolvido por fetchC2xCadastroByEntity.
  // Best-effort: se o C2X estiver fora do ar (ou a entidade não tiver vínculo com o C2X), cai
  // no comportamento anterior sem derrubar a rota — a ficha do Apolo puro nem passa por aqui.
  let c2xMapeado: Record<string, string> = {};
  try {
    const { data: sourceLinks } = await adminClient
      .from("apolo_source_links")
      .select("entity_id, source_system, source_table, source_id")
      .eq("entity_id", id)
      .eq("source_system", "c2x")
      .eq("source_table", "users");

    const links = (sourceLinks ?? []) as {
      entity_id: string;
      source_id: string | null;
      source_system: string | null;
      source_table: string | null;
    }[];

    if (links.length > 0) {
      // Sets vazios: só afetam flags de comprador/inadimplência no grafo de relacionamentos,
      // não o cadastro básico do titular que a ficha precisa.
      const { cadastro: c2xByEntity } = await fetchC2xCadastroByEntity(
        adminClient,
        links,
        new Set<number>(),
        new Set<number>(),
      );
      const c2x = c2xByEntity.get(id);
      if (c2x) {
        c2xMapeado = mapearC2xParaFicha(c2x);
      }
    }
  } catch (erro) {
    console.error("[apolo] board validacao: c2xCadastro indisponivel", erro);
  }

  // Prioridade: o que o operador editou (esteira) GANHA do C2X, e o C2X GANHA do metadata cru
  // da importação. Assim a digitação humana nunca é sobrescrita e o CAD do C2X deixa de vir vazio.
  const cadastro = {
    ...(entity.metadata?.cadastro ?? {}),
    ...c2xMapeado,
    ...daEsteira,
    // ⚠️ POR ÚLTIMO, DE PROPÓSITO: `cadastroEditado` é o que um operador DIGITOU nesta tela para
    // uma ficha sem esteira (imobiliária). Se entrasse junto com `cadastro`, o C2X passaria por
    // cima — e o C2X manda em `creci`, `dataAbertura`, `dataAtualizacaoCadastral` e no endereço
    // inteiro. O operador corrigiria o CRECI, veria salvo, e no F5 o valor velho voltaria.
    // Correção humana ganha de tudo; é a única camada que não tem de onde ser regenerada.
    ...(entity.metadata?.cadastroEditado ?? {}),
  };

  return NextResponse.json(
    {
      data: {
        cadastro,
        contato: {
          email: lista.find((c) => c.contact_type === "email")?.value ?? "",
          // ⚠️ O C2X grava o telefone como 'whatsapp' (4.064 registros) e quase nunca como
          // 'phone' (248). Procurar só por 'phone' deixava 94% das fichas sem telefone na
          // validação — o operador via um traço e ia atrás de um dado que já estava no banco.
          telefone:
            lista.find((c) => c.contact_type === "whatsapp")?.value ??
            lista.find((c) => c.contact_type === "phone")?.value ??
            "",
        },
        endereco: endereco
          ? {
              bairro: endereco.district ?? "",
              cep: endereco.postal_code ?? "",
              cidade: endereco.city ?? "",
              complemento: endereco.complement ?? "",
              logradouro: endereco.street ?? "",
              numero: endereco.number ?? "",
              uf: endereco.state ?? "",
            }
          : null,
        // Referência do Asana + divergências, para a tela avisar em vez de o operador adivinhar.
        asana: laudo
          ? {
              conjuge: (laudo.conjugeAsana as string) ?? null,
              perfil: (laudo.perfilAsana as string) ?? null,
              proponente: (laudo.proponenteAsana as string) ?? null,
              tipoDiverge: Boolean(laudo.divergeTipo),
              tipoNoAsana: (laudo.tipoNoAsana as string) ?? null,
              veredito: (laudo.veredito as string) ?? null,
            }
          : null,
        // O que o operador editou na ficha GANHA do que veio do relacionamento.
        // A ficha COMPLETA (23/08): sexo, renda, escolaridade, profissão, patrimônio e
        // naturalidade agora chegam do wizard via metadata do relacionamento — antes só o PDF
        // os tinha, e a validação abria vazia.
        conjuge: {
          cpf: texto(daEsteira.conjugeCpf) || texto(doRelacionamento?.metadata?.cpf),
          dataNascimento:
            texto(daEsteira.conjugeNascimento) ||
            texto(doRelacionamento?.metadata?.dataNascimento),
          email: texto(daEsteira.conjugeEmail) || texto(doRelacionamento?.metadata?.email),
          escolaridadeId:
            texto(daEsteira.conjugeEscolaridadeId) ||
            texto(doRelacionamento?.metadata?.escolaridadeId),
          nacionalidade:
            texto(daEsteira.conjugeNacionalidade) ||
            texto(doRelacionamento?.metadata?.nacionalidade),
          naturalidade:
            texto(daEsteira.conjugeNaturalidade) ||
            texto(doRelacionamento?.metadata?.naturalidade),
          nome: texto(daEsteira.conjugeNome) || (doRelacionamento?.label ?? ""),
          nomeMae: texto(daEsteira.conjugeMae) || texto(doRelacionamento?.metadata?.nomeMae),
          patrimonio:
            texto(daEsteira.conjugePatrimonio) ||
            texto(doRelacionamento?.metadata?.patrimonio),
          profissaoId:
            texto(daEsteira.conjugeProfissaoId) ||
            texto(doRelacionamento?.metadata?.profissaoId),
          // Profissão DIGITADA no wizard (fora das 234 do C2X). Chega para a validação padronizar;
          // nunca vira `profession` no C2X. Ver lib/apolo/profissao.ts.
          profissaoOutro:
            texto(daEsteira.conjugeProfissaoOutro) ||
            texto(doRelacionamento?.metadata?.profissaoOutro),
          rendaId:
            texto(daEsteira.conjugeRendaId) || texto(doRelacionamento?.metadata?.rendaId),
          sexoId:
            texto(daEsteira.conjugeSexoId) || texto(doRelacionamento?.metadata?.sexoId),
          telefone:
            texto(daEsteira.conjugeTelefone) || texto(doRelacionamento?.metadata?.phone),
        },
        entidade: {
          criadoEm: entity.created_at,
          documento: entity.document_masked ?? "",
          nome: entity.legal_name || entity.display_name,
          nomeFantasia: entity.trade_name ?? "",
          papel: entity.metadata?.bornRole ?? "",
          tipo: entity.entity_kind,
        },
      },
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

// Salva o que o OPERADOR completou na validação.
//
// Grava em `apolo_esteira.ficha`, não no metadata da entidade: o sync do C2X substitui o
// metadata inteiro a cada rodada e apagaria o trabalho dele — foi o que aconteceu com a
// esteira em 20/jul. Aqui o prejuízo seria pior, porque é digitação humana.
//
// Grava a ficha de quem NÃO tem CAD na esteira (hoje: as imobiliárias e demais PJ) em
// `apolo_entities.metadata.cadastro` — a mesma chave que o GET lê como base da ficha.
//
// ⚠️ O `metadata` é REESCRITO INTEIRO no update, então ele é lido antes e mesclado em dois
// níveis: o objeto de fora (para não derrubar `bornRole` e o que mais viva ali) e o `cadastro`
// de dentro (para não derrubar os campos que o operador não tocou). Escrever `{ cadastro }`
// direto apagaria o resto do metadata — foi assim que o sync do C2X já apagou metadata antes.
async function salvarNoCadastroDaEntidade(
  adminClient: AdminClient,
  entityId: string,
  campos: Record<string, unknown>,
  userId: string,
  autorNome: null | string,
): Promise<
  | { auditoria: null | string; ok: true }
  | { error: string; ok: false; status: number }
> {
  const { data: entidade, error: erroLeitura } = await adminClient
    .from("apolo_entities")
    .select("metadata")
    .eq("id", entityId)
    .maybeSingle();

  if (erroLeitura) {
    return { error: erroLeitura.message, ok: false, status: 500 };
  }
  if (!entidade) {
    return { error: "Ficha não encontrada.", ok: false, status: 404 };
  }

  const metadata = (entidade.metadata ?? {}) as Record<string, unknown>;
  // Grava numa camada PRÓPRIA (`cadastroEditado`), não em `cadastro`. Duas razões: o GET a
  // aplica por último, então a correção não é encoberta pelo C2X ao vivo; e o que veio da
  // importação continua intacto ao lado, para efeito de comparação e auditoria.
  const cadastroAtual = (metadata.cadastroEditado ?? {}) as Record<string, unknown>;
  const cadastro: Record<string, unknown> = { ...cadastroAtual };

  // Mesma regra do caminho da esteira: vazio APAGA (deixa o operador limpar o que veio errado
  // do OCR) e o que fica entra padronizado pelo servidor.
  for (const [chave, valor] of Object.entries(campos)) {
    if (valor === "" || valor === null) {
      delete cadastro[chave];
      continue;
    }
    cadastro[chave] = padronizar(chave, valor);
  }

  // NOME FANTASIA tem coluna própria (`apolo_entities.trade_name`) e é DELA que o CRM lê
  // (server.ts:3249 `fantasyName`). Gravar só no cadastro deixaria a tela de validação certa e o
  // resto do Apolo mostrando o nome antigo. O sync do C2X não desfaz: desde 04/08 ele usa
  // ON CONFLICT DO NOTHING para as tabelas de identidade e não toca em quem já existe.
  const patchEntidade: Record<string, unknown> = {
    metadata: { ...metadata, cadastroEditado: cadastro },
  };
  if (typeof campos.nomeFantasia === "string") {
    patchEntidade.trade_name = campos.nomeFantasia.trim() || null;
  }

  const { error } = await adminClient
    .from("apolo_entities")
    .update(patchEntidade)
    .eq("id", entityId);

  if (error) {
    return { error: error.message, ok: false, status: 500 };
  }

  // TELEFONE E E-MAIL TAMBÉM VÃO PARA `apolo_contacts`. A tela mostra o cadastro por cima do
  // contato, então gravar só no metadata deixaria a tela certa e o resto do sistema errado: o
  // disparo de credenciamento, o phone-match do cockpit e a fila leem de `apolo_contacts`. O
  // operador corrigiria o número, veria "salvo", e a mensagem continuaria indo para o antigo.
  //
  // `atualizarContatoDoContato` é reusada porque ela grava `value` E `normalized_value` juntos —
  // o upsert do CRM deixa o normalizado velho e a busca passa a devolver a ficha errada.
  const telefoneNovo = typeof campos.telefone === "string" ? campos.telefone : null;
  const emailNovo = typeof campos.email === "string" ? campos.email : null;
  if (telefoneNovo || emailNovo) {
    const { atualizarContatoDoContato } = await import("@/lib/iris/apolo/escrita-contato");
    const gravado = await atualizarContatoDoContato(adminClient, {
      email: emailNovo,
      entidadeId: entityId,
      telefone: telefoneNovo,
    });
    // ⚠️ FALHA AQUI É FALHA DE SALVAMENTO, e devolve erro. A versão anterior devolvia
    // `{ auditoria: erro, ok: true }` — a resposta saía 200, a tela lia só `resposta.ok` e dizia
    // "salvo", enquanto o telefone continuava o antigo para todo o resto do sistema. Ninguém lê
    // o campo `auditoria` na tela, então aquilo era engolir o erro com passos extras.
    if (!gravado.ok) {
      return {
        error: `Cadastro salvo, mas o contato nao foi atualizado: ${gravado.erro}`,
        ok: false,
        status: 500,
      };
    }
  }

  // ⚠️ COMPARAÇÃO ESTÁVEL, não `String()`. Sócio e corretor chegam aqui como ARRAY, e
  // `String([{...}])` devolve "[object Object]" para qualquer conteúdo: dois arrays diferentes
  // pareciam iguais e a edição do telefone do representante nunca virava linha de auditoria.
  const mesmoValor = (a: unknown, b: unknown): boolean => {
    if (typeof a === "object" && a !== null) return JSON.stringify(a) === JSON.stringify(b);
    if (typeof b === "object" && b !== null) return false;
    return String(a ?? "") === String(b ?? "");
  };

  const trilha = Object.entries(campos)
    .filter(([chave, valor]) => !mesmoValor(cadastroAtual[chave], valor))
    .map(([chave, valor]) => ({
      action: "edit_ficha",
      actor_user_id: ehUuid(userId) ? userId : null,
      entity_id: entityId,
      field_name: chave,
      metadata: {
        autorNome,
        de: cadastroAtual[chave] ?? null,
        origem: "board-validacao-entidade",
        para: valor === "" || valor === null ? null : valor,
      },
      status: "mapped",
    }));

  let auditoria: null | string = null;
  if (trilha.length > 0) {
    const { error: erroAuditoria } = await adminClient
      .from("apolo_audit_events")
      .insert(trilha);
    if (erroAuditoria) auditoria = erroAuditoria.message;
  }

  return { auditoria, ok: true };
}

export type CorpoDaFicha = {
  campos?: Record<string, unknown>;
  // De qual CAD é a ficha. Sem ele, a mais recente (ver o GET acima).
  enterpriseId?: null | number | string;
};

// Faz MERGE, nunca replace: o operador salva um campo por vez e não pode zerar o resto.
export async function salvarFichaDoBoard(
  adminClient: AdminClient,
  id: string,
  body: CorpoDaFicha,
  autorUserId: string,
  // (02/09) Nome de quem editou, para a trilha. A conta do portal comercial não está em
  // hub_users; sem o nome no metadata o histórico mostraria um traço.
  autorNome: null | string = null,
): Promise<NextResponse> {
  const campos = body.campos ?? {};
  if (Object.keys(campos).length === 0) {
    return NextResponse.json({ error: "Nada para salvar." }, { status: 400 });
  }

  const atual = await lerCadDaEsteira<{
    enterprise_id: string | null;
    ficha: Record<string, unknown> | null;
  }>(adminClient, id, "enterprise_id, ficha", { enterpriseId: body.enterpriseId });

  // SALVAR FICHA NÃO CRIA CAD. Antes este upsert criava a linha do zero quando ela não existia —
  // sem empreendimento, como efeito colateral de um "salvar campo". Com `enterprise_id` NOT NULL
  // e na chave, isso viraria erro cru do Postgres; e mesmo se coubesse, criar CAD por engano num
  // salvar de campo é o tipo de dado que ninguém desconfia depois.
  const alvoEnterpriseId =
    normalizarEnterpriseId(body.enterpriseId) ?? normalizarEnterpriseId(atual?.enterprise_id);

  // ⚠️ QUEM NÃO TEM ESTEIRA GRAVA NO CADASTRO DA ENTIDADE, NÃO DÁ 409.
  //
  // A esteira é CAD de PESSOA num empreendimento. **Imobiliária não tem linha lá — medido em
  // 15/08: das 435 com papel `imobiliaria`, ZERO têm esteira.** Como este PATCH era o único
  // caminho de gravação da tela, o "Salvar" do modo Editar respondia 409 para TODAS elas, e
  // nem os campos que já tinham `chave` (telefone, e-mail) gravavam. Foi o que o Lucas
  // encontrou ao tentar corrigir o telefone da imobiliária para seguir os testes.
  //
  // Sem conflito de fonte: o GET monta a ficha como `metadata.cadastro` < C2X < esteira, então
  // gravar no metadata só é a resposta certa justamente quando não existe esteira para ganhar
  // dele. Pessoa física com CAD segue exatamente no caminho de antes.
  if (!atual || !alvoEnterpriseId) {
    const semEsteira = await salvarNoCadastroDaEntidade(
      adminClient,
      id,
      campos,
      autorUserId,
      autorNome,
    );
    if (!semEsteira.ok) {
      return NextResponse.json({ error: semEsteira.error }, { status: semEsteira.status });
    }
    return NextResponse.json({ data: { auditoria: semEsteira.auditoria, destino: "entidade" } });
  }

  const fichaAtual = (atual.ficha ?? {}) as Record<string, unknown>;

  // Campo apagado pelo operador (string vazia) some da ficha, em vez de virar "" — assim ele
  // consegue LIMPAR um dado que o OCR leu errado.
  //
  // PADRONIZAÇÃO no servidor, não só na tela: o mesmo dado entra por aqui pela digitação do
  // operador E pela importação do Asana, e tem que sair igual dos dois lados (regra do Lucas,
  // 21/jul). Nome em "Primeira Maiúscula" (regra global do Hub, 13/jul) e telefone no padrão
  // (37) 99956-9096 — as CADs trouxeram "37999569096", "(37)998256365", "+55 37 99860-2317".
  const mesclada: Record<string, unknown> = { ...fichaAtual };
  for (const [chave, valor] of Object.entries(campos)) {
    if (valor === "" || valor === null) {
      delete mesclada[chave];
      continue;
    }
    mesclada[chave] = padronizar(chave, valor);
  }

  const { error } = await adminClient
    .from("apolo_esteira")
    .update({
      ficha: mesclada,
      ficha_editada_em: new Date().toISOString(),
      ficha_editada_por: autorUserId,
    })
    .eq("entity_id", id)
    .eq("enterprise_id", alvoEnterpriseId);

  // E-MAIL/TELEFONE EDITADOS AQUI TAMBÉM ESPELHAM em `apolo_contacts` e em
  // `metadata.cadastroEditado` (24/08) — o ramo SEM esteira sempre fez isso; este não, e a
  // ficha virava um valor imortal que o Editar cadastro do CRM nunca alcançava (as duas telas
  // escreviam e-mail em camadas diferentes; quem lia decidia qual aparecia).
  const contatoNovo = {
    email: typeof campos.email === "string" ? campos.email : null,
    telefone: typeof campos.telefone === "string" ? campos.telefone : null,
  };
  if (!error && (contatoNovo.email || contatoNovo.telefone)) {
    const { atualizarContatoDoContato } = await import("@/lib/iris/apolo/escrita-contato");
    const gravado = await atualizarContatoDoContato(adminClient, {
      email: contatoNovo.email,
      entidadeId: id,
      telefone: contatoNovo.telefone,
    });
    if (!gravado.ok) {
      return NextResponse.json(
        { error: `Ficha salva, mas o contato nao foi atualizado: ${gravado.erro}` },
        { status: 500 },
      );
    }

    const { data: entidadeAtual } = await adminClient
      .from("apolo_entities")
      .select("metadata")
      .eq("id", id)
      .maybeSingle<{ metadata: Record<string, unknown> | null }>();
    if (entidadeAtual) {
      const metaAtual = entidadeAtual.metadata ?? {};
      const editadoAtual = (metaAtual.cadastroEditado ?? {}) as Record<string, unknown>;
      await adminClient
        .from("apolo_entities")
        .update({
          metadata: {
            ...metaAtual,
            cadastroEditado: {
              ...editadoAtual,
              ...(contatoNovo.email ? { email: contatoNovo.email } : {}),
              ...(contatoNovo.telefone ? { telefone: contatoNovo.telefone } : {}),
            },
          },
          updated_at: new Date().toISOString(),
        })
        .eq("id", id);
    }
  }

  // TRILHA DE AUDITORIA por campo (exigência do Lucas, 21/jul): "o que mudou, para qual valor
  // e quem — para caso eu precise validar depois". Uma linha POR CAMPO, com o valor de antes
  // e o de agora. `ficha_editada_por` sozinho só guarda o ÚLTIMO editor e não conta a história.
  //
  // Gravada DEPOIS do salvamento e sem travar a resposta: falha de auditoria não pode fazer o
  // operador perder o que digitou. Mas o erro é reportado no corpo, para não sumir calado.
  const trilha = Object.entries(campos)
    .filter(([chave, valor]) => {
      const antes = fichaAtual[chave] ?? "";
      const agora = valor ?? "";
      return String(antes) !== String(agora);
    })
    .map(([chave, valor]) => ({
      action: "edit_ficha",
      actor_user_id: ehUuid(autorUserId) ? autorUserId : null,
      entity_id: id,
      field_name: chave,
      metadata: {
        autorNome,
        de: fichaAtual[chave] ?? null,
        origem: "board-validacao",
        para: valor === "" || valor === null ? null : valor,
      },
      status: "mapped",
    }));

  let auditoria: string | null = null;
  if (trilha.length > 0) {
    const { error: erroAuditoria } = await adminClient
      .from("apolo_audit_events")
      .insert(trilha);
    if (erroAuditoria) auditoria = erroAuditoria.message;
  }

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ data: { auditoria, ficha: mesclada, ok: true } });
}

// ═══════════════════════════════════════════════════════════════════════════════════════════
// 3) HABILITAR / INDEFERIR a imobiliária — GET e POST /api/apolo/board/[id]/habilitar
// ═══════════════════════════════════════════════════════════════════════════════════════════
//
// ⚠️ POR QUE ISTO EXISTE, e não é o `moverEtapaDoBoard`: o Board desenha a trilha da imobiliária
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

const PERFIL = "imobiliaria";
export type CorpoDaDecisao = {
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

/**
 * O que a imobiliária PEDIU, para a tela montar as caixinhas (+ o que foi apontado na correção).
 * Fica junto da decisão de propósito: quem decide precisa ver exatamente a lista sobre a qual
 * vai decidir.
 */
export async function pedidosDaImobiliaria(
  adminClient: AdminClient,
  id: string,
): Promise<NextResponse> {
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

  // ⚠️ O QUE FOI APONTADO NA CORREÇÃO. Pedido do Lucas (17/08): antes de habilitar quem estava em
  // correção, a tela precisa "perguntar se os erros xyz foram corrigidos" — com os erros na tela,
  // não de memória. Sem isso o operador confere de cabeça, e o motivo da correção fica só na
  // mensagem que a imobiliária recebeu dias atrás.
  //
  // Os motivos foram gravados na auditoria no momento da decisão; é a MESMA fonte que o reenvio
  // usa, para a pergunta e a mensagem nunca divergirem.
  const [papel, entidade] = await Promise.all([
    adminClient
      .from("apolo_entity_profiles")
      .select("status")
      .eq("entity_id", id)
      .eq("profile", "imobiliaria")
      .maybeSingle<{ status: null | string }>(),
    adminClient
      .from("apolo_entities")
      .select("status")
      .eq("id", id)
      .maybeSingle<{ status: null | string }>(),
  ]);

  let pendencias: string[] = [];
  // Só quando ela está DE FATO esperando correção. Mostrar o motivo de uma correção antiga, já
  // resolvida, faria o operador conferir algo que não está mais em jogo.
  if (entidade.data?.status === "attention") {
    const { data: eventos } = await adminClient
      .from("apolo_audit_events")
      .select("metadata")
      .eq("entity_id", id)
      .eq("action", "credenciamento_correcao")
      .order("created_at", { ascending: false })
      .limit(1);

    const metadata = ((eventos ?? [])[0] as { metadata?: Record<string, unknown> } | undefined)
      ?.metadata;
    const motivos = Array.isArray(metadata?.motivos)
      ? (metadata.motivos as unknown[]).filter(
          (m): m is string => typeof m === "string" && m.trim() !== "",
        )
      : [];
    const observacao =
      typeof metadata?.observacao === "string" ? metadata.observacao.trim() : "";

    pendencias = observacao ? [...motivos, observacao] : motivos;
  }

  return NextResponse.json({
    data: {
      empreendimentos,
      papelStatus: papel.data?.status ?? null,
      pendencias,
    },
  });
}

/** Habilitar, pedir correção, indeferir ou reabrir o credenciamento da imobiliária `id`. */
export async function decidirCredenciamento(
  adminClient: AdminClient,
  id: string,
  corpo: CorpoDaDecisao,
  autorUserId: string,
): Promise<NextResponse> {
  if (!ehUuid(id)) {
    return NextResponse.json({ error: "Imobiliaria invalida." }, { status: 400 });
  }

  // TRÊS DECISÕES NA VALIDAÇÃO (regra do Lucas, 17/08): habilitar, pedir CORREÇÃO ou indeferir.
  // `reabrir` não é decisão, é o desfazer do indeferimento.
  const acao =
    corpo.acao === "indeferir"
      ? "indeferir"
      : corpo.acao === "reabrir"
        ? "reabrir"
        : corpo.acao === "correcao"
          ? "correcao"
          : "habilitar";

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

  // ── REABRIR ────────────────────────────────────────────────────────────────
  //
  // A imobiliária foi recusada, corrigiu o que faltava e volta para a fila de validação.
  //
  // ⚠️ EXISTE PORQUE A IMOBILIÁRIA NÃO TEM ESTEIRA. O botão de reabrir da tela chamava
  // `moverEtapa`, que grava em `apolo_esteira`, e o operador levava o 409 "esta ficha ainda não
  // tem CAD na esteira, informe o empreendimento no cadastro" — mensagem sem sentido para quem
  // valida uma EMPRESA: imobiliária não tem CAD, ela é quem cadastra os compradores.
  //
  // Só devolve o PAPEL para `review`. Os vínculos de empreendimento ficam como estão: os que já
  // valiam continuam valendo, e os pendentes seguem pendentes esperando a decisão.
  if (acao === "reabrir") {
    const { error } = await adminClient
      .from("apolo_entity_profiles")
      .update({ status: "review" })
      .eq("entity_id", id)
      .eq("profile", PERFIL);

    if (error) {
      return NextResponse.json(
        { error: "Nao foi possivel reabrir o credenciamento." },
        { status: 500 },
      );
    }

    // A entidade volta a aparecer na fila do Board (a consulta lista `status = 'review'`).
    // ⚠️ `updated_at` CARIMBADO À MÃO. A tabela não tem trigger e o default `now()` só vale no
    // INSERT, então sem isto a coluna guarda a data de CADASTRO, não a da decisão — e a fila do
    // Board, que corta por `updated_at` nos últimos 30 dias, passaria a esconder o card no clique
    // para toda ficha criada há mais de um mês.
    await adminClient
      .from("apolo_entities")
      .update({ status: "review", updated_at: new Date().toISOString() })
      .eq("id", id);

    await adminClient.from("apolo_audit_events").insert({
      action: "credenciamento_reaberto",
      actor_user_id: ehUuid(autorUserId) ? autorUserId : null,
      entity_id: id,
      field_name: "credenciamento",
      metadata: { de: papel.status, origem: "board", para: "review" },
      status: "mapped",
    });

    return NextResponse.json({
      data: { acao: "reabrir", resumo: "Credenciamento reaberto para validacao." },
    });
  }

  // ── CORREÇÃO ───────────────────────────────────────────────────────────────
  //
  // A imobiliária mandou algo errado ou incompleto e precisa ajustar. NÃO é recusa: o cadastro
  // continua vivo, ela recebe o que falta e volta. Foi a ação que faltava quando a Beatriz
  // Teodora enviou o Cartão de CNPJ no lugar do contrato social — sem ela, o operador indeferiu
  // três vezes um caso que era de pendência.
  //
  // ⚠️ O ESTADO VAI PARA `apolo_entities.status = 'attention'`, e o PAPEL CONTINUA `review`.
  // Duas razões: o CHECK de `apolo_entity_profiles.status` só aceita
  // active | review | blocked | archived, então não há valor para "em correção" lá; e o papel em
  // `review` é o que mantém a imobiliária como NÃO DECIDIDA, que é a verdade — ela não foi
  // aprovada nem recusada, está esperando o parceiro. `attention` existe no CHECK de
  // `apolo_entities` e significa exatamente isto: aguardando ação de fora.
  if (acao === "correcao") {
    const motivos = listaDeTexto(corpo.motivos);
    const observacao = typeof corpo.observacao === "string" ? corpo.observacao.trim() : "";

    if (motivos.length === 0 && !observacao) {
      return NextResponse.json(
        { error: "Diga o que precisa ser corrigido: e isso que a imobiliaria recebe." },
        { status: 400 },
      );
    }

    // `updated_at` junto: a janela de 30 dias da fila conta a partir da DECISÃO. Sem isto, a
    // imobiliária mandada para correção sumiria do Board 30 dias depois de ter se cadastrado,
    // ainda esperando resposta — o item de trabalho desapareceria em silêncio.
    const { error } = await adminClient
      .from("apolo_entities")
      .update({ status: "attention", updated_at: new Date().toISOString() })
      .eq("id", id);

    if (error) {
      return NextResponse.json(
        { error: "Nao foi possivel enviar para correcao." },
        { status: 500 },
      );
    }

    await adminClient.from("apolo_audit_events").insert({
      action: "credenciamento_correcao",
      actor_user_id: ehUuid(autorUserId) ? autorUserId : null,
      entity_id: id,
      field_name: "credenciamento",
      metadata: { motivos, observacao: observacao || null, origem: "board" },
      status: "mapped",
    });

    const contatoCor = await contatoDaEntidadeImobiliaria(adminClient, id);
    const repCor = await representanteDaImobiliaria(adminClient, id);
    const envioCor = await avisarCredenciamentoCorrecao(adminClient, {
      entityId: id,
      imobiliaria: contatoCor.nome,
      imobiliariaTelefone: telefoneDaImobiliaria([repCor.telefone, contatoCor.telefone]),
      motivos,
      observacao: observacao || null,
      representante: repCor.nome,
    });

    return NextResponse.json({
      data: {
        acao: "correcao",
        aviso: envioCor.imobiliaria.ok ? null : envioCor.imobiliaria.erro,
        resumo: envioCor.imobiliaria.ok
          ? "Pendencia enviada para a imobiliaria."
          : "Pendencia registrada, mas o aviso nao saiu. Fale com a imobiliaria.",
      },
    });
  }

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

    // A ENTIDADE volta para `review` e ganha o carimbo da decisão. Se ela tivesse sido habilitada
    // antes (entidade em `active`), indeferir depois a deixaria fora das duas pernas da fila e o
    // card sumiria em vez de ir para a coluna Recusada.
    await adminClient
      .from("apolo_entities")
      .update({ status: "review", updated_at: new Date().toISOString() })
      .eq("id", id);

    await adminClient.from("apolo_audit_events").insert({
      action: "credenciamento_indeferido",
      actor_user_id: ehUuid(autorUserId) ? autorUserId : null,
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

  // ⚠️ OS DOIS LADOS SÃO CANONIZADOS, e é este o conserto de 17/08.
  //
  // O mesmo empreendimento tem DOIS formatos de id vivos no banco: o do GRUPO ("group:Lagoa
  // Bonita"), que é o que o portal público grava porque lá fora não existe divisão, e o das
  // DIVISÕES (33/LBF, 27/LBR, 32/LBP), que é como o C2X o conhece.
  //
  // Antes daqui só os ESCOLHIDOS eram expandidos, para as divisões; os PEDIDOS ficavam como
  // estavam. Comparar [33, 27, 32] contra ["group:Lagoa Bonita"] não casa nada, e a imobiliária
  // que tinha ACABADO de pedir o Lagoa Bonita recebia "Empreendimento que esta imobiliaria nao
  // pediu: 33, 27, 32". Expansão de um lado só é o defeito.
  //
  // Agora os dois lados viram o id CANÔNICO (o do grupo, quando existe), então tanto faz em que
  // formato o pedido foi gravado. Regra do Lucas: "quando clicar em Lagoa Bonita, tem que
  // habilitar todos os Lagoa Bonita" — e é o que passa a acontecer, porque o vínculo do grupo
  // cobre as três divisões.
  const lista = await listEmpreendimentosAtivos(adminClient);
  const porId = new Map(lista.map((e) => [String(e.id), e]));
  const canon = canonizador(lista);

  escolhidos = [
    ...new Set(
      escolhidos.map((id) => {
        const canonico = canon(id);
        const emp = porId.get(canonico);
        if (emp) labelPorId.set(canonico, emp.name);
        return canonico;
      }),
    ),
  ];

  // O pedido gravado como divisão passa a valer pelo grupo, e vice-versa.
  const pedidosCanonicos = pedidos.map((pedido) => ({
    ...pedido,
    enterpriseId: canon(pedido.enterpriseId),
  }));

  if (jaCredenciada) {
    ativos = lista.map((emp) => String(emp.id));
  }

  const plano = planejarHabilitacao({
    ativos,
    escolhidos,
    pedidos: pedidosCanonicos,
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
  await adminClient
    .from("apolo_entities")
    .update({ status: "active", updated_at: new Date().toISOString() })
    .eq("id", id);

  await adminClient.from("apolo_audit_events").insert({
    action: "credenciamento_habilitado",
    actor_user_id: ehUuid(autorUserId) ? autorUserId : null,
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

  // ⚠️ SÓ AVISA SE ALGO MUDOU DE VERDADE, e esta é a trava que vale — a da tela é conveniência.
  //
  // `promoverPapel` fica true só com `jaHabilitados`, ou seja, sem UMA LINHA alterada no banco. E
  // aí a mensagem saía assim mesmo. O caminho para o estrago é curto: o operador clica, a rota
  // grava e dispara, a resposta se perde (rede, aba, timeout), a tela diz "o credenciamento NÃO
  // mudou" — afirmação falsa — e mantém o botão aceso. O segundo clique não muda nada e manda a
  // mensagem OUTRA VEZ, agora com o texto trocado: `primeiraVez` já é false, então o parceiro
  // recebe "seu cadastro foi aprovado" e, em seguida, "você está habilitada em mais um
  // empreendimento". Duas mensagens que se contradizem, e duas cobranças.
  const mudouAlgo = plano.habilitar.length + plano.novos.length > 0;

  // Os corretores DELA, para o aviso "a imobiliária X credenciou você no empreendimento Y".
  // Pedido do Lucas (17/08): até aqui o corretor era o único que não sabia de nada.
  const equipe = mudouAlgo ? await corretoresDaImobiliaria(adminClient, id) : [];

  const envio = mudouAlgo
    ? await avisarCredenciamentoAprovado(adminClient, {
        coordenadores,
        corretores: corretores.count ?? 0,
        corretoresParaAvisar: equipe,
        empreendimentos: habilitados,
        entityId: id,
        imobiliaria: contato.nome,
        // Telefone do REPRESENTANTE primeiro; o da empresa é plano B (costuma ser fixo, e o
        // WhatsApp não entrega em fixo). `telefoneDaImobiliaria` também trata a string vazia, que
        // o `??` deixava passar.
        imobiliariaTelefone: telefoneDaImobiliaria([rep.telefone, contato.telefone]),
        primeiraVez,
        representante: rep.nome,
      })
    : // Nada mudou: reativação de papel ou clique repetido. O parceiro não precisa saber de novo.
      {
        coordenador: { ok: true },
        corretores: { avisados: 0, falharam: 0 },
        imobiliaria: { ok: true },
      };

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

// ═══════════════════════════════════════════════════════════════════════════════════════════
// 4) HISTÓRICO da ficha — GET /api/apolo/board/[id]/historico
// ═══════════════════════════════════════════════════════════════════════════════════════════
//
// O que mudou, para qual valor e quem — exigência do Lucas para poder validar depois. Os dados
// já são gravados a cada salvamento (`edit_ficha`, uma linha por campo) e a cada correção de
// identidade (`edit_identity`); aqui eles viram uma lista legível.
//
// AGRUPADO POR EDIÇÃO: quando o operador salva 13 campos de uma vez, isso é UM evento com 13
// alterações, não 13 eventos. O agrupamento é por autor + minuto, que é o que o salvamento
// único produz.

// Rótulo legível de cada campo. Sem isto o histórico fala "escolaridadeId", que não diz nada
// para quem está conferindo.
const ROTULOS: Record<string, string> = {
  bairro: "Bairro",
  cep: "CEP",
  cidade: "Cidade",
  complemento: "Complemento",
  conjugeCpf: "Cônjuge · CPF",
  conjugeEmail: "Cônjuge · E-mail",
  conjugeMae: "Cônjuge · Nome da mãe",
  conjugeNascimento: "Cônjuge · Nascimento",
  conjugeNome: "Cônjuge · Nome",
  conjugeProfissaoOutro: "Cônjuge · Profissão (digitada no cadastro)",
  conjugeTelefone: "Cônjuge · Telefone",
  dataNascimento: "Nascimento",
  email: "E-mail",
  escolaridadeId: "Escolaridade",
  estadoCivilId: "Estado civil",
  identidade: "Identidade (nome/documento/tipo)",
  logradouro: "Logradouro",
  nacionalidade: "Nacionalidade",
  naturalidade: "Naturalidade",
  nomeMae: "Nome da mãe",
  numero: "Número",
  patrimonio: "Patrimônio",
  profissaoId: "Profissão",
  // Profissão DIGITADA no cadastro (fora das 234 do C2X). Aparece na trilha quando o operador
  // limpa a declaração depois de padronizar. Ver lib/apolo/profissao.ts.
  profissaoOutro: "Profissão (digitada no cadastro)",
  regimeBensId: "Regime de bens",
  rendaId: "Faixa de renda",
  rg: "RG",
  sexoId: "Sexo",
  telefone: "Telefone",
  uf: "UF",
};

type LinhaAuditoria = {
  action: string;
  actor_user_id: string | null;
  created_at: string;
  field_name: string | null;
  metadata: Record<string, unknown> | null;
};

function comoTexto(valor: unknown): string {
  if (valor === null || valor === undefined || valor === "") return "—";
  if (typeof valor === "string") return valor;
  // Identidade guarda um objeto {nome, documento, tipo}.
  if (typeof valor === "object") {
    const o = valor as Record<string, unknown>;
    return [o.nome, o.documento, o.tipo].filter(Boolean).join(" · ");
  }
  return String(valor);
}

// (02/09) O nome de quem editou pelo PORTAL comercial. A conta do coordenador não está em
// hub_users, então o nome vai no metadata do evento; sem isto o histórico mostraria um traço.
function autorNoMetadata(metadata: Record<string, unknown> | null): null | string {
  const nome = metadata?.autorNome;
  return typeof nome === "string" && nome.trim() ? nome.trim() : null;
}

export async function historicoDaFicha(client: AdminClient, id: string): Promise<NextResponse> {
  const { data } = await client
    .from("apolo_audit_events")
    .select("action, actor_user_id, created_at, field_name, metadata")
    .eq("entity_id", id)
    .in("action", ["edit_ficha", "edit_identity"])
    .order("created_at", { ascending: false })
    .limit(300);

  const linhas = (data ?? []) as LinhaAuditoria[];

  // Nome de quem editou, em uma consulta só.
  const autores = [...new Set(linhas.map((l) => l.actor_user_id).filter(Boolean))] as string[];
  const nomePorId = new Map<string, string>();
  if (autores.length > 0) {
    const { data: usuarios } = await client
      .from("hub_users")
      .select("id, display_name, email")
      .in("id", autores);
    for (const u of (usuarios ?? []) as {
      display_name: string | null;
      email: string | null;
      id: string;
    }[]) {
      nomePorId.set(u.id, u.display_name || u.email || "—");
    }
  }

  const porEdicao = new Map<
    string,
    { alteracoes: { campo: string; de: string; para: string }[]; autor: string; quando: string }
  >();

  for (const linha of linhas) {
    // Chave do agrupamento: autor + minuto. Um "Salvar alterações" grava tudo no mesmo minuto.
    const minuto = linha.created_at.slice(0, 16);
    const chave = `${linha.actor_user_id ?? "sistema"}|${minuto}`;

    if (!porEdicao.has(chave)) {
      porEdicao.set(chave, {
        alteracoes: [],
        // Quem editou. O `actor_user_id` é a conta do HUB; edição feita pelo portal comercial
        // (coordenador) grava o nome em `metadata.autorNome`, porque a conta dele não está em
        // hub_users e o histórico mostraria um traço no lugar de quem mexeu.
        autor: linha.actor_user_id
          ? (nomePorId.get(linha.actor_user_id) ?? autorNoMetadata(linha.metadata) ?? "—")
          : (autorNoMetadata(linha.metadata) ?? "Sistema"),
        quando: linha.created_at,
      });
    }

    const campo = linha.field_name ?? "";
    porEdicao.get(chave)!.alteracoes.push({
      campo: ROTULOS[campo] ?? campo,
      de: comoTexto(linha.metadata?.de),
      para: comoTexto(linha.metadata?.para),
    });
  }

  return NextResponse.json(
    { data: { edicoes: [...porEdicao.values()] } },
    { headers: { "Cache-Control": "no-store" } },
  );
}

// ═══════════════════════════════════════════════════════════════════════════════════════════
// 5) MOVER DE ETAPA — PATCH /api/apolo/board/[id]/etapa
// ═══════════════════════════════════════════════════════════════════════════════════════════
//
// Move um item da esteira de ETAPA (apolo_esteira). Irmã do PATCH de ficha. O Board deixou de
// ser esqueleto: avançar, indeferir, mandar à revisão e à correção gravam por aqui, em vez de
// viver só no estado local da tela. Ver [[project_esteira_credenciamento_venda]].

export type CorpoDaEtapa = {
  // Qual CAD desta pessoa está sendo movida. `[id]` é a PESSOA; desde a 0080 ela pode ter uma
  // CAD por empreendimento, e a tela manda o `enterpriseId` do card. Sem ele, a mais recente.
  enterpriseId?: unknown;
  etapa?: unknown;
  motivo?: unknown;
  // AVANÇAR não pode REBAIXAR. Só o botão de avanço genérico manda esta flag; indeferir,
  // correção e revisão são movimentos LATERAIS deliberados e continuam livres.
  nuncaRebaixar?: unknown;
};

export async function moverEtapaDoBoard(
  adminClient: AdminClient,
  id: string,
  body: CorpoDaEtapa,
  autor: AutorDoBoard,
): Promise<NextResponse> {
  if (!ehEtapaValida(body.etapa)) {
    return NextResponse.json({ error: "Etapa invalida." }, { status: 400 });
  }
  const motivo = typeof body.motivo === "string" ? body.motivo.trim() : "";
  const enterpriseId =
    typeof body.enterpriseId === "string" || typeof body.enterpriseId === "number"
      ? body.enterpriseId
      : null;

  // ⚠️ ESTA FLAG CONSERTA UM ROMBO DE DADO MEDIDO (Lucas, 21/08: *"porque temos cads ainda em
  // analise de credito no vale do ouro, quando nao tem a etapa do pix, se ele passou no credito
  // tem que ir direto para credenciado"*).
  //
  // A CAD da CRISTIANA, no Vale do Ouro, mostra a sequência inteira em `apolo_audit_events`:
  //   19:42:18  o Board grava `credito` (o operador clicou Avançar na Validação)
  //   19:42:23  a consulta ao Serasa APROVA (score 580, zero negativação) e o servidor,
  //             com a pré-venda desligada no VLO, grava `credenciado`
  //   19:42:37  o Board grava `credito` DE NOVO, por cima
  // Resultado: uma ficha aprovada parada na Análise de crédito, e a decisão do servidor perdida.
  //
  // A causa é o avanço chegar com a etapa que a TELA achava que era a atual. Sem `nuncaRebaixar`,
  // `atualizarEtapa` obedece — porque ação humana manda, e é assim que indeferir e corrigir
  // funcionam. Mas AVANÇAR que anda para trás não é decisão, é clique fora de sincronia.
  const nuncaRebaixar = body.nuncaRebaixar === true;

  const { bloqueado, error, etapa, semCad } = await atualizarEtapa(adminClient, id, body.etapa, {
    atualizadoPor: autor.userId,
    enterpriseId,
    nuncaRebaixar,
    // motivo só entra quando veio (indeferir/correção exigem motivo); avanço normal não mexe nele.
    motivo: motivo.length ? motivo : undefined,
  });

  // PROBLEMA 2 (Lucas, 04/08): 409, não 500 — um clique manual não pode tirar de "revisao" (crédito
  // reprovado) para avançar. Quem quiser destravar usa o override da coordenação (com evidência),
  // que é a única rota que passa `saidaDeRevisaoAutorizada`.
  if (bloqueado) return NextResponse.json({ error }, { status: 409 });

  // 409, não 500: "não existe CAD para mover" é um pedido incoerente, não uma falha do servidor —
  // e a mensagem já diz ao operador o que resolver.
  if (error) return NextResponse.json({ error }, { status: semCad ? 409 : 500 });

  // Trilha de auditoria, no mesmo padrão do PATCH de ficha: quem moveu, para qual etapa e por quê.
  await adminClient.from("apolo_audit_events").insert({
    action: "etapa_change",
    actor_user_id: ehUuid(autor.userId) ? autor.userId : null,
    entity_id: id,
    field_name: "etapa",
    metadata: {
      autorNome: autor.nome ?? null,
      motivo: motivo || null,
      origem: autor.origem,
      para: etapa,
    },
    status: "mapped",
  });

  // CAD VIVA: a cada mudança de etapa, regenera a CAD com as informações atuais da ficha (decisão
  // do Lucas — a CAD acompanha o cliente pela esteira). Best-effort E com teto de tempo: a etapa já
  // foi gravada; sob C2X lento a CAD não pode segurar a resposta do clique além do maxDuration.
  try {
    await comLimiteDeTempo(
      gerarESalvarCad(adminClient, id, {
        enterpriseId,
        uploadedByName: autor.uploadedByName,
      }),
      20000,
    );
  } catch {
    /* segue */
  }

  return NextResponse.json({ data: { etapa, ok: true } });
}
