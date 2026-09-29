import type { RowDataPacket } from "mysql2";

import { filtroPorIds, idDoC2x } from "@/lib/apolo/c2x-pelo-id";
import { idsDoC2xDasSiglasAoVivo, type OrigemDaSigla } from "@/lib/apolo/c2x-pelo-id-servidor";
import { getHadesDbPool } from "@/lib/guardian/db";

// A POLÍTICA COMERCIAL DO EMPREENDIMENTO, juntando as DUAS fontes com a precedência que o Lucas
// definiu em 17/08/2026:
//
//   • do C2X (`commercial_policies`): comissão total, entrada mínima, parcelas do sinal e o split
//     da cadeia por papel. "Toda parte financeira, enquanto não migramos tudo para o Apolo, o C2X
//     tem prioridade."
//   • do APOLO (`apolo_enterprise_settings.gestao_carteira_percentual`): a % de gestão de carteira.
//     "O que vai nascer já no Apolo é a % da gestão de carteira."
//
// A tela mostra de onde veio cada campo. Não é enfeite: o operador precisa saber se muda no C2X ou
// aqui, e o incorporador vai perguntar de onde saiu o número.
//
// ⚠️ ESTA CAMADA É SÓ LEITURA DO LEGADO. O C2X é read-only (regra-mãe do projeto); o único campo
// gravável é o do Apolo.

export type SplitDaCadeia = {
  /** Rótulo do papel, como o Lucas fala: Corretor, Imobiliária, Coordenador… */
  papel: string;
  /** Percentual dentro da comissão total. */
  percentual: null | number;
  /** Prêmio, quando o empreendimento tem. */
  premio: null | number;
};

/**
 * O SPLIT DE PAGAMENTO CADASTRADO no C2X (`split_enterprises`), que é o rateio de VERDADE: é este
 * cadastro que gera os boletos e alimenta o `payments.split_data`.
 *
 * ⚠️ NÃO CONFUNDIR COM OS PERCENTUAIS DE `commercial_policies`. Aqueles são campos soltos (corretor
 * 4%, imobiliária 4%…) e vários estão com valor morto — o `loteador_percentage` está 10+10 em nove
 * empreendimentos com contrato ativo. O split abaixo é por TIPO DE PAGAMENTO, cada grupo fechando
 * 100%, e existe para 21 empreendimentos. O Lucas mostrou a tela em 17/08: sistema.careli.adm.br/
 * split_enterprises/{id}/edit.
 *
 * Os quatro grupos: **Ato · Sinal (Imobiliária) · Sinal (Corretor) · Mensal**.
 * É no MENSAL que mora a gestão de carteira: no Recanto, Incorporador 97% e Gestora 3%.
 *
 * ⚠️ NÃO TRATAR "CARELI COMO CAPTADOR" COMO ERRO DE CADASTRO. No Recanto a CARELI ASSESSORIA
 * FINANCEIRA aparece amarrada ao perfil **Captador** (6% no Ato e nos dois Sinais), e isso está
 * CERTO: foi a Careli que captou aquele empreendimento (Lucas, 17/08). Eu levantei como
 * inconsistência e não era. A linha "Gestora de recebíveis" ficar sem `user_id` em todos os
 * empreendimentos também é normal — o destinatário é implícito.
 */
export type LinhaDoSplitCadastrado = {
  /** Valor fixo, quando o cadastro usa reais em vez de percentual. */
  fixo: null | number;
  /** "Incorporador" | "Coordenação" | "Gerente" | "Imobiliária" | … */
  perfil: string;
  percentual: null | number;
  /** Nome de quem recebe, quando o cadastro amarra num parceiro específico. */
  quemRecebe: null | string;
};

export type GrupoDeSplit = {
  /** "Ato" | "Sinal (Imobiliária)" | "Sinal (Corretor)" | "Mensal" */
  grupo: string;
  linhas: LinhaDoSplitCadastrado[];
  /** Soma dos percentuais: o cadastro do C2X mostra "Total: 100,0000% (OK)". */
  total: number;
};

/**
 * O QUE O APOLO GUARDA sobre a política daquele empreendimento — tudo o que vem de
 * `apolo_enterprise_settings`, num objeto só por `enterprise_id`.
 *
 * ⚠️ É UM PARÂMETRO, NÃO CINCO. Esta função já recebia dois `Map` posicionais (gestão de carteira e
 * entrada mínima) e a 0145 traria mais três; a essa altura a ordem dos argumentos vira armadilha —
 * trocar dois `Map<string, null | number>` de lugar compila, roda, e grava entrada mínima onde
 * deveria estar a comissão. Um objeto nomeado por empreendimento não tem esse buraco.
 */
export type DadosDoApolo = {
  comissaoCoordenadoraPercentual: null | number;
  comissaoImobiliariaPercentual: null | number;
  coordenadoraEntityId: null | string;
  entradaMinimaPercentual: null | number;
  gestaoCarteiraPercentual: null | number;
};

export type PoliticaComercialDoEmpreendimento = {
  code: string;
  /**
   * A % sobre o valor VENDIDO destinada à coordenadora de vendas, cadastrada NO APOLO
   * (migration 0145). Nulo = não cadastrado; zero = decidido.
   */
  comissaoCoordenadoraApolo: null | number;
  /**
   * A % sobre o valor VENDIDO destinada aos associados (imobiliária/corretor), cadastrada NO APOLO.
   *
   * ⚠️ A SOMA DESTA COM A DA COORDENADORA é a comissão total do contrato de corretagem, e é ela que
   * a tela põe ao lado do `comissaoTotal` do C2X para o operador conferir.
   */
  comissaoImobiliariaApolo: null | number;
  /** `total_value_commission` — percentual sobre o VALOR DO LOTE. */
  comissaoTotal: null | number;
  /** `commissioning_incorporador`. */
  comissaoIncorporador: null | number;
  /** A entidade (`apolo_entities`) apontada como coordenadora de vendas. */
  coordenadoraEntityId: null | string;
  /**
   * O `display_name` da coordenadora.
   *
   * ⚠️ QUEM RESOLVE É A ROTA, não esta função: aqui só existe o legado (MySQL do C2X) e o que o
   * chamador entregou. Chamador que não faz a consulta em `apolo_entities` recebe `null` — e nulo
   * com `coordenadoraEntityId` preenchido significa "o id não resolveu", que é o caso da entidade
   * arquivada ou fundida (a 0145 não criou FK de propósito). A tela trata os dois como lacuna.
   */
  coordenadoraNome: null | string;
  enterpriseId: string;
  /** `initial_input_value` — entrada mínima (ato + sinal) SEGUNDO O C2X. Read-only, não trava. */
  entradaMinima: null | number;
  /**
   * A % mínima de entrada cadastrada NO APOLO — a que vale.
   *
   * ⚠️ É ESTA QUE O SIMULADOR E A PROPOSTA OBEDECEM (Lucas, 03/09/2026: *"vamos ter um campo dentro
   * da parte que vamos cadastrar a política comercial e lá vamos apontar a % mínima"*). A do C2X
   * acima continua aparecendo ao lado, como referência, do mesmo jeito que a gestão de carteira
   * mostra o número do legado e o nosso.
   *
   * Nulo = não cadastrado; quem lê aplica o padrão da casa.
   */
  entradaMinimaApolo: null | number;
  /** `careli_percentage` — o par do loteador na divisão da parcela, no C2X. */
  gestaoCarteiraCareliC2x: null | number;
  /** `loteador_percentage` — quanto fica com o incorporador, segundo o C2X. */
  gestaoCarteiraC2x: null | number;
  /** O que está cadastrado NO APOLO. É este que vale para o cálculo do líquido. */
  gestaoCarteiraApolo: null | number;
  /** `max_signal_parcels`. */
  maxParcelasSinal: null | number;
  /** Juros e multa por incumprimento. */
  jurosAtraso: null | number;
  multaAtraso: null | number;
  nome: string;
  /** A cadeia de comissionamento, já sem os papéis zerados. */
  split: SplitDaCadeia[];
  /** O split de pagamento cadastrado, por tipo de pagamento. É o rateio que gera os boletos. */
  splitCadastrado: GrupoDeSplit[];
  /** Nome do split ativo no C2X ("PADRAO"), para a tela dizer qual está valendo. */
  splitNome: null | string;
  /**
   * A % do INCORPORADOR no grupo "Mensal" do split — a gestão de carteira, lida da fonte que gera
   * os boletos. Decisão do Lucas (17/08): "pode ler no split".
   */
  gestaoCarteiraSplit: null | number;
  /** Diagnóstico para a tela avisar em vez de mostrar número furado. */
  avisos: string[];
};

type LinhaC2x = RowDataPacket & {
  award_captador: null | number;
  award_coordenador: null | number;
  award_corretor: null | number;
  award_gerente: null | number;
  award_imobiliaria: null | number;
  careli_percentage: null | number;
  code: null | string;
  commissioning_captador: null | number;
  commissioning_careli: null | number;
  commissioning_coordenador: null | number;
  commissioning_corretor: null | number;
  commissioning_gerente: null | number;
  commissioning_imobiliaria: null | number;
  commissioning_incorporador: null | number;
  enterprise_id: number;
  initial_input_value: null | number;
  loteador_percentage: null | number;
  max_signal_parcels: null | number;
  name: null | string;
  non_compliance_fine: null | number;
  non_compliance_interest: null | number;
  total_value_commission: null | number;
};

/** O pool do C2X, extraído do helper para não repetir o tipo em cada função. */
type PoolDoC2x = Extract<ReturnType<typeof getHadesDbPool>, { ok: true }>["pool"];

const numero = (v: unknown): null | number => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * Monta a cadeia de comissionamento, escondendo quem está zerado.
 *
 * Papel com 0% é papel que não participa naquele empreendimento; listá-lo só faz o operador
 * procurar sentido numa linha vazia.
 */
function montarSplit(linha: LinhaC2x): SplitDaCadeia[] {
  const papeis: [string, null | number, null | number][] = [
    ["Corretor", numero(linha.commissioning_corretor), numero(linha.award_corretor)],
    ["Imobiliária", numero(linha.commissioning_imobiliaria), numero(linha.award_imobiliaria)],
    ["Coordenador", numero(linha.commissioning_coordenador), numero(linha.award_coordenador)],
    ["Gerente", numero(linha.commissioning_gerente), numero(linha.award_gerente)],
    ["Captador", numero(linha.commissioning_captador), numero(linha.award_captador)],
    ["Careli", numero(linha.commissioning_careli), null],
    ["Incorporador", numero(linha.commissioning_incorporador), null],
  ];

  return papeis
    .filter(([, pct, premio]) => (pct ?? 0) > 0 || (premio ?? 0) > 0)
    .map(([papel, percentual, premio]) => ({ papel, percentual, premio }));
}

/**
 * Confere a política e devolve o que está furado, em texto que o operador entende.
 *
 * Medido em 17/08: Garden e Jardim das Gerais não têm política nenhuma; o VLO está com 10 + 10
 * (default nunca configurado); o VOR está invertido (loteador 3, Careli 97); e cinco
 * empreendimentos estão sem `total_value_commission`. Nada disso aparecia em lugar algum.
 */
function conferir(
  linha: LinhaC2x | undefined,
  doApolo: null | number,
  doSplit: null | number,
): string[] {
  const avisos: string[] = [];

  if (!linha) {
    avisos.push("Sem política comercial cadastrada no C2X.");
  } else if (numero(linha.total_value_commission) === null) {
    avisos.push(
      "Comissão total não cadastrada no C2X: o líquido da entrada e do sinal não pode ser calculado.",
    );
  }

  // ⚠️ NÃO CONFERIMOS MAIS `loteador_percentage` + `careli_percentage`. Esses campos de
  // `commercial_policies` estão com valor MORTO em nove empreendimentos com contrato ativo (10+10,
  // que nem fecha 100%), e a gestão de carteira de verdade vem do SPLIT cadastrado — a mesma fonte
  // que gera os boletos. Avisar sobre campo que ninguém usa só ensina o operador a ignorar avisos.

  if (doSplit === null && doApolo === null) {
    // Não é pendência: é a resposta. A Careli não administra a carteira deste empreendimento.
    avisos.push(
      "A Careli não administra a carteira deste empreendimento: o split das mensalidades não tem a Gestora de recebíveis. A aba Carteira não aparece para o incorporador.",
    );
  } else if (doSplit === null) {
    avisos.push(
      "O split das mensalidades no C2X não tem a Gestora de recebíveis, mas há percentual informado no Apolo. Vale o do Apolo; confira se o split do C2X está completo.",
    );
  } else if (doApolo !== null && Math.abs(doApolo - doSplit) > 0.001) {
    avisos.push(
      `O Apolo tem ${doApolo}% de gestão de carteira e o split do C2X tem ${doSplit}%. Vale o do Apolo, porque foi informado à mão; confira qual está certo.`,
    );
  }

  return avisos;
}

type LinhaSplitC2x = RowDataPacket & {
  code: null | string;
  fixed_value: null | number | string;
  grupo: null | string;
  grupo_id: null | number;
  percent: null | number | string;
  perfil: null | string;
  quem_recebe: null | string;
  split_nome: null | string;
};

/**
 * Lê o SPLIT CADASTRADO de cada empreendimento, agrupado por tipo de pagamento.
 *
 * Só o split ATIVO (`currently_active = 1`): o C2X guarda histórico, e mostrar um cadastro que não
 * está valendo seria pior que não mostrar nada.
 *
 * ⚠️ FILTRA PELO ID (PAN-124), e o mapa continua pela SIGLA que o C2X devolve na linha: é a mesma
 * sigla da linha da política, lida no mesmo instante, então o casamento das duas não depende de nome
 * guardado em lugar nenhum.
 *
 * ⚠️ O ORDER BY NÃO DESEMPATA, e ficou assim de propósito. O split tem 15 empates de percentual no
 * mesmo grupo (o LOS e o LOU têm duas linhas de 2% em cada grupo, o LBP três de 5,7143%; medido em
 * 25/09/2026), e a ordem delas é a que o plano do MySQL der. Pela sigla ela já variava com o pedido
 * (no Ato do LOS pedido sozinho, o Captador sem nome vinha antes do FABRICIO; pedido junto com o
 * LOU, depois).
 * Medido linha a linha: pelo id, a ordem é a mesma de antes em 39 dos 40 pedidos; só a Lavra do Ouro
 * inteira (LOS + LOU) troca de lugar as linhas empatadas. Um `v.id` no fim fixaria a ordem, mas
 * mudaria 3 dos 40 pedidos em vez de 1.
 */
async function lerSplitCadastrado(
  pool: PoolDoC2x,
  filtro: { params: number[]; sql: string },
): Promise<Map<string, { grupos: GrupoDeSplit[]; nome: null | string }>> {
  const [rows] = await pool.query<LinhaSplitC2x[]>(
    `select e.code,
            se.name as split_nome,
            gn.id as grupo_id, gn.name as grupo,
            pr.name as perfil,
            v.percent, v.fixed_value,
            u.name as quem_recebe
       from split_enterprises se
       join enterprises e on e.id = se.enterprise_id
       join split_enterprise_groups sg on sg.split_enterprise_id = se.id
       join split_group_names gn on gn.id = sg.split_group_name_id
       join split_enterprise_group_values v on v.split_enterprise_group_id = sg.id
       join split_profiles pr on pr.id = v.split_profile_id
       left join users u on u.id = v.user_id
      where ${filtro.sql} and se.currently_active = 1
      order by e.code, gn.id, v.percent desc`,
    filtro.params,
  );

  const porCode = new Map<string, { grupos: GrupoDeSplit[]; nome: null | string }>();

  for (const linha of rows) {
    const code = (linha.code ?? "").trim().toUpperCase();
    if (!code) continue;

    if (!porCode.has(code)) {
      porCode.set(code, { grupos: [], nome: linha.split_nome ?? null });
    }
    const alvo = porCode.get(code);
    if (!alvo) continue;

    const nomeGrupo = (linha.grupo ?? "").trim() || "Sem grupo";
    let grupo = alvo.grupos.find((g) => g.grupo === nomeGrupo);
    if (!grupo) {
      grupo = { grupo: nomeGrupo, linhas: [], total: 0 };
      alvo.grupos.push(grupo);
    }

    const percentual = numero(linha.percent);
    grupo.linhas.push({
      fixo: numero(linha.fixed_value),
      percentual,
      perfil: (linha.perfil ?? "").trim() || "Sem perfil",
      // `quem_recebe` vem como string VAZIA quando o cadastro não amarra ninguém (não como null),
      // e uma linha "recebe: " na tela parece dado faltando.
      quemRecebe: (linha.quem_recebe ?? "").trim() || null,
    });
    grupo.total += percentual ?? 0;
  }

  return porCode;
}

/**
 * A gestão de carteira: a fatia do INCORPORADOR no grupo "Mensal" (as parcelas do financiamento).
 *
 * ⚠️ SÓ EXISTE GESTÃO SE A GESTORA DE RECEBÍVEIS ESTIVER NO SPLIT DO MENSAL. Regra do Lucas
 * (17/08): "o que não estiver cadastrado na mensalidade é que não fazemos a carteira; do Lagoa
 * Bonita fazemos somente do LBF".
 *
 * O dado mostra isso: oito empreendimentos têm o Incorporador com **100%** e nenhuma Gestora
 * (Estância do Lago, Lagoa Bonita LBP, Milenium, os dois Portal dos Vales, Rio de Pedras, Viva
 * Boulevard, Veredas do Ouro). Não é taxa zero, é ausência de administração: a parcela passa direto
 * para o incorporador. O LBP com 100% ao lado do LBF com 97/3, no MESMO empreendimento, é o caso
 * que prova a leitura.
 *
 * Devolver 100% nesses seria pior que devolver nada: a tela mostraria carteira administrada onde
 * não há, e o portal do incorporador abriria uma aba Carteira que não deveria existir.
 */
function gestaoDoSplit(grupos: GrupoDeSplit[]): null | number {
  const mensal = grupos.find((g) => /mensal/i.test(g.grupo));
  if (!mensal) return null;

  const temGestora = mensal.linhas.some((l) => /gestora/i.test(l.perfil));
  if (!temGestora) return null;

  const incorporador = mensal.linhas.find((l) => /incorporador|loteador/i.test(l.perfil));

  return incorporador?.percentual ?? null;
}

/** O erro de sempre quando o C2X não responde: a tela e o portal já mostram esta frase. */
const ERRO_DO_C2X = "Nao foi possivel ler a politica comercial no C2X.";

/**
 * Lê a política dos empreendimentos pedidos, pelas SIGLAS (a tela do Apolo e o portal mandam a
 * sigla). O que é do Apolo entra por quem chama (o Apolo é o dono desses campos), para esta função
 * ficar restrita ao legado e continuar testável.
 *
 * ⚠️ PAN-124: A SIGLA NÃO VAI MAIS AO C2X COMO FILTRO. Ela era o `e.code in (...)`, e a sigla muda
 * quando alguém renomeia no legado (o 43 de RDV para PDI em 24/09/2026). Agora a sigla é traduzida num
 * lugar só (`idsDoC2xDasSiglasAoVivo`) e as duas consultas filtram pelo `enterprises.id`, em
 * `loadPoliticaComercialPorIds`. Quem tem o id chama a versão por id. A sigla guardada de antes de um
 * renome só é salva enquanto o catálogo em cache for de antes dele (até 10 minutos).
 *
 * ⚠️ SEM A EXCLUSÃO PADRÃO (`excluir: []`), como sempre foi: esta leitura nunca excluiu ninguém. Pelo
 * catálogo, a sigla de TSC, SDT e LAB não se traduz (ele não os lista) e sai sem política; nenhum
 * chamador do portal os pede. A tela do Apolo passa `conferirNoC2x` (ver `OrigemDaSigla`), e aí a
 * sigla viva deles acha a política, como `e.code in` achava.
 *
 * ⚠️ CATÁLOGO ILEGÍVEL É O C2X FORA: devolve o mesmo erro de quando a consulta caía, e não uma
 * política vazia com cara de "não cadastrada".
 */
export async function loadPoliticaComercial(
  codes: string[],
  doApolo: Map<string, DadosDoApolo> = new Map(),
  origem: OrigemDaSigla = {},
): Promise<
  { error: string; ok: false } | { ok: true; politicas: PoliticaComercialDoEmpreendimento[] }
> {
  const alvos = codes.map((c) => c.trim().toUpperCase()).filter(Boolean);
  if (alvos.length === 0) return { ok: true, politicas: [] };

  const poolResult = getHadesDbPool();
  if (!poolResult.ok) {
    return { error: `Configuracao C2X ausente: ${poolResult.missing.join(", ")}.`, ok: false };
  }

  const traduzido = await idsDoC2xDasSiglasAoVivo(alvos, { ...origem, excluir: [] });
  if (!traduzido.ok) return { error: ERRO_DO_C2X, ok: false };

  return loadPoliticaComercialPorIds(traduzido.ids, doApolo);
}

/**
 * A política pelos ids do C2X (`enterprises.id`), que não mudam num renome.
 *
 * Só aceita id do C2X: o nascido no Panteon (>= 100000), `group:` e uuid ficam de fora (`idDoC2x`), e
 * sem id nenhum não há consulta. Não exclui ninguém, como a busca pela sigla nunca excluiu.
 *
 * ⚠️ SÓ O WHERE MUDOU: o SELECT continua devolvendo `e.code`, o split continua casado pela sigla da
 * linha (`splitPorCode`), e a resposta sai idêntica à da busca pela sigla para quem não foi
 * renomeado (medido linha a linha em 25/09/2026, scratchpad/pan124-lote2-identidade.ts).
 */
export async function loadPoliticaComercialPorIds(
  idsPedidos: ReadonlyArray<number | string>,
  doApolo: Map<string, DadosDoApolo> = new Map(),
): Promise<
  { error: string; ok: false } | { ok: true; politicas: PoliticaComercialDoEmpreendimento[] }
> {
  const filtro = filtroPorIds(
    "e.id",
    idsPedidos.map(idDoC2x).filter((id): id is number => id !== null),
  );
  if (!filtro) return { ok: true, politicas: [] };

  const poolResult = getHadesDbPool();
  if (!poolResult.ok) {
    return { error: `Configuracao C2X ausente: ${poolResult.missing.join(", ")}.`, ok: false };
  }

  try {
    const [rows] = await poolResult.pool.query<LinhaC2x[]>(
      `select e.id as enterprise_id, e.code, e.name,
              p.total_value_commission, p.initial_input_value, p.max_signal_parcels,
              p.loteador_percentage, p.careli_percentage,
              p.non_compliance_interest, p.non_compliance_fine,
              p.commissioning_corretor, p.commissioning_imobiliaria, p.commissioning_coordenador,
              p.commissioning_gerente, p.commissioning_captador, p.commissioning_careli,
              p.commissioning_incorporador,
              p.award_corretor, p.award_imobiliaria, p.award_coordenador,
              p.award_gerente, p.award_captador
         from enterprises e
         left join commercial_policies p on p.enterprise_id = e.id
        where ${filtro.sql}`,
      filtro.params,
    );

    const splitPorCode = await lerSplitCadastrado(poolResult.pool, filtro);

    const politicas = rows.map((linha) => {
      const enterpriseId = String(linha.enterprise_id);
      const apolo = doApolo.get(enterpriseId);
      const gestaoApolo = apolo?.gestaoCarteiraPercentual ?? null;
      // Linha sem política vem com tudo nulo pelo `left join`: o `total_value_commission` nulo E o
      // `loteador_percentage` nulo juntos significam que não existe registro.
      const temPolitica =
        numero(linha.total_value_commission) !== null ||
        numero(linha.loteador_percentage) !== null ||
        numero(linha.initial_input_value) !== null;

      const doSplit = splitPorCode.get((linha.code ?? "").trim().toUpperCase());
      const grupos = doSplit?.grupos ?? [];
      const gestaoSplit = gestaoDoSplit(grupos);

      return {
        avisos: conferir(temPolitica ? linha : undefined, gestaoApolo, gestaoSplit),
        gestaoCarteiraSplit: gestaoSplit,
        splitCadastrado: grupos,
        splitNome: doSplit?.nome ?? null,
        code: (linha.code ?? "").trim(),
        comissaoCoordenadoraApolo: apolo?.comissaoCoordenadoraPercentual ?? null,
        comissaoImobiliariaApolo: apolo?.comissaoImobiliariaPercentual ?? null,
        comissaoIncorporador: numero(linha.commissioning_incorporador),
        comissaoTotal: numero(linha.total_value_commission),
        coordenadoraEntityId: apolo?.coordenadoraEntityId ?? null,
        // Quem resolve o nome é a rota (ver o comentário do campo): aqui só há o legado.
        coordenadoraNome: null,
        enterpriseId,
        entradaMinima: numero(linha.initial_input_value),
        entradaMinimaApolo: apolo?.entradaMinimaPercentual ?? null,
        gestaoCarteiraApolo: gestaoApolo,
        gestaoCarteiraC2x: numero(linha.loteador_percentage),
        gestaoCarteiraCareliC2x: numero(linha.careli_percentage),
        jurosAtraso: numero(linha.non_compliance_interest),
        maxParcelasSinal: numero(linha.max_signal_parcels),
        multaAtraso: numero(linha.non_compliance_fine),
        nome: (linha.name ?? "").trim(),
        split: temPolitica ? montarSplit(linha) : [],
      };
    });

    return { ok: true, politicas };
  } catch {
    return { error: ERRO_DO_C2X, ok: false };
  }
}
