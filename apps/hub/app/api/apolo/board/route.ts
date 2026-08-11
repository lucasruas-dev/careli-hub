import { NextResponse } from "next/server";

import { authorizeApoloRead } from "@/lib/apolo/auth";
import { alertaC2xDaCad } from "@/lib/apolo/c2x-alerta-board";
import { maisRecentePorEntidade } from "@/lib/apolo/esteira-cad";
import { imobiliariaEntityIdEmLote } from "@/lib/apolo/imobiliaria-do-cliente";
import { normalizarNome } from "@/lib/apolo/imobiliaria-match";
import { prevendaLigadaNaSetting, type SettingPrevenda } from "@/lib/apolo/limite-credito";
import { createApoloAdminClient } from "@/lib/apolo/server";

// Fila da ESTEIRA de credenciamento: tudo que nasceu pelos canais externos e aguarda o time.
// A entidade já nasce com status 'review' (createApoloEntity), então a fila sai daí — sem tabela
// nova. As ETAPAS da esteira (validado / crédito / pago) ainda não persistem: esta primeira
// versão é o esqueleto navegável pro Lucas validar o layout.
// Ver [[project_esteira_credenciamento_venda]].
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

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
  // PIX da pré-venda confirmado (carimbo nosso, com hora). Null = ainda não pagou.
  pago_em: string | null;
};

type EntityRow = {
  created_at: string;
  display_name: string;
  document_masked: string | null;
  entity_kind: string;
  id: string;
  legal_name: string | null;
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

export async function GET(request: Request) {
  const auth = await authorizeApoloRead(request);
  if (!auth.ok) return auth.response;

  const adminClient = createApoloAdminClient();
  if (!adminClient) {
    return NextResponse.json({ error: "Supabase indisponivel." }, { status: 503 });
  }

  const CAMPOS =
    "id, display_name, legal_name, document_masked, entity_kind, metadata, created_at, primary_city, primary_state";

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
      "entity_id, enterprise_id, etapa, analista_id, chegou_em, corretor, empreendimento, imobiliaria, pago_em, atualizado_em, created_at",
    )
    .order("atualizado_em", { ascending: false })
    .order("created_at", { ascending: false })
    .order("enterprise_id", { ascending: false })
    .limit(2000);

  const esteiraPorEntidade = maisRecentePorEntidade((esteiraRows ?? []) as EsteiraRow[]);
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

  const [daFila, naEsteira] = await Promise.all([
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
    lotes.length > 0 ? lerEntidadesEmLotes() : Promise.resolve({ data: [], error: null }),
  ]);

  if (daFila.error && naEsteira.error) {
    return NextResponse.json({ error: "Nao foi possivel carregar a fila." }, { status: 500 });
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
  const porId = new Map<string, EntityRow>();
  for (const row of [...(daFila.data ?? []), ...(naEsteira.data ?? [])] as EntityRow[]) {
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
  const grafiaCanonicaPorCliente = new Map<string, string>();
  {
    const linhas = [...esteiraPorEntidade.values()].filter((r) => (r.imobiliaria ?? "").trim());
    const imobPorVinculo = await imobiliariaEntityIdEmLote(
      adminClient,
      linhas.map((r) => r.entity_id),
    );
    const { data: matches } = await adminClient
      .from("apolo_imobiliaria_match")
      .select("nome_normalizado, entity_id")
      .not("entity_id", "is", null);
    const entidadePorTexto = new Map<string, string>();
    for (const m of (matches ?? []) as Array<{ entity_id: string; nome_normalizado: string }>) {
      entidadePorTexto.set(m.nome_normalizado, m.entity_id);
    }

    // Chave do grupo: a entidade da imobiliária, ou (na falta) o texto normalizado.
    const chaveDe = (r: EsteiraRow): string => {
      const texto = (r.imobiliaria ?? "").trim();
      const ent = imobPorVinculo.get(r.entity_id) ?? entidadePorTexto.get(normalizarNome(texto));
      return ent ? `ent:${ent}` : `txt:${normalizarNome(texto)}`;
    };

    // Conta a frequência de cada grafia dentro do grupo.
    const contagem = new Map<string, Map<string, number>>();
    for (const r of linhas) {
      const texto = (r.imobiliaria ?? "").trim();
      const porGrafia = contagem.get(chaveDe(r)) ?? new Map<string, number>();
      porGrafia.set(texto, (porGrafia.get(texto) ?? 0) + 1);
      contagem.set(chaveDe(r), porGrafia);
    }

    // Grafia canônica do grupo: mais frequente; empate -> mais curta -> alfabética.
    const canonicaPorChave = new Map<string, string>();
    for (const [chave, porGrafia] of contagem) {
      let melhor = "";
      let melhorN = -1;
      for (const [grafia, n] of porGrafia) {
        const vence =
          n > melhorN ||
          (n === melhorN &&
            (grafia.length < melhor.length ||
              (grafia.length === melhor.length && grafia.localeCompare(melhor) < 0)));
        if (vence) {
          melhor = grafia;
          melhorN = n;
        }
      }
      canonicaPorChave.set(chave, melhor);
    }

    for (const r of linhas) {
      const canonica = canonicaPorChave.get(chaveDe(r));
      if (canonica) grafiaCanonicaPorCliente.set(r.entity_id, canonica);
    }
  }

  // PRÉ-VENDA POR EMPREENDIMENTO (regra do Lucas, 10/08: "pré-venda só existe se estiver
  // habilitado"). A tela precisa saber CAD a CAD, porque a etapa Pré-venda não é do processo: é
  // do empreendimento. Uma leitura só (são poucas linhas) e a MESMA regra do servidor, importada —
  // não uma segunda cópia que amanhã diverge.
  const { data: settingsRows } = await adminClient
    .from("apolo_enterprise_settings")
    .select("enterprise_id, prevenda_habilitada, valor_pix")
    .limit(500);

  const prevendaPorEmpreendimento = new Map<string, boolean>();
  for (const linha of (settingsRows ?? []) as Array<SettingPrevenda & { enterprise_id: string }>) {
    prevendaPorEmpreendimento.set(String(linha.enterprise_id), prevendaLigadaNaSetting(linha));
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

    // O empreendimento vem do cadastro (quem nasceu no wizard) OU da esteira (quem foi
    // importado do Asana, que é cadastro antigo e não tem metadata.cadastro).
    const doCadastro = nomesEmpreendimentos(cadastro?.empreendimentos);
    const empreendimentos =
      doCadastro.length > 0
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
    analistas.find((pessoa) => pessoa.id === auth.userId) ?? null;

  return NextResponse.json(
    { data: { analistas, itens, usuarioAtual } },
    { headers: { "Cache-Control": "no-store" } },
  );
}
