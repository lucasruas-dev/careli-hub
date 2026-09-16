import { NextResponse } from "next/server";

import { authorizeApoloRead, authorizeApoloWrite } from "@/lib/apolo/auth";
import {
  conferirPremissa,
  type ErroDePremissa,
  type LinhaDePremissa,
  premissasDoRecorte,
  ROTULO_DA_BASE_NA_TELA,
  RUBRICAS,
} from "@/lib/apolo/premissas-de-rescisao";
import { createApoloAdminClient } from "@/lib/apolo/server";
import {
  comoSeHerdou,
  itensDoMenorRecorte,
  type OrigemDoRecorte,
  type RecorteDaUnidade,
} from "@/lib/hercules/recorte-da-unidade";
import { ehTabelaAusente } from "@/lib/temis/tabela-ausente";

// AS PREMISSAS DE RESCISÃO DO EMPREENDIMENTO — a aba que cadastra as alíquotas que o termo imprime.
//
// Lucas (14/09/2026): *"vamos precisar ter esses parâmetros de rescisão nas politicas comerciais,
// essas aliquotas precisam ser cadastradas para que o sistema puxe isso"*, e *"a ideia é ter as
// premissas para gente montar isso por empreendimento"*.
//
//   GET ?enterprise=<enterprise_id> → AS CINCO RUBRICAS, cadastradas aqui, HERDADAS DO PAI ou
//        faltando, cada uma com as bases que se aplicam a ela e o rótulo que a tela escreve. A tela
//        desenha o formulário COMPLETO a partir daqui, e por isso a resposta não pode ser só o que
//        existe no banco: uma aba que mostra duas linhas porque só duas foram cadastradas esconde as
//        três que ninguém cadastrou, e são justamente essas que o termo vai calcular pela praxe
//        (`origem: "padrao"` em `lib/apolo/rescisao.ts`) sem que ninguém tenha conferido o número.
//   PUT  { enterpriseId, premissas: [...] } → grava as linhas, uma por rubrica.
//
// ⚠️ "careli", E NÃO UM UUID. `workspace_id` é TEXT com default 'careli' (migration 0166, igual às
// irmãs desde a 0112). Um uuid aqui não dá erro de tipo: casa ZERO linhas, em silêncio — o GET
// devolveria as cinco rubricas "não cadastradas" para um empreendimento que TEM cadastro, e o PUT
// gravaria numa ilha que leitura nenhuma enxerga. Já aconteceu na rota de bloqueio em 14/09/2026,
// com a suíte inteira verde. O teste desta rota lê este arquivo como TEXTO para provar a constante.
//
// ⚠️ O GET LÊ OS DOIS DEGRAUS (ESTE EMPREENDIMENTO E O PAI), E ISSO É A REGRA, NÃO UM EXTRA.
// Consertado em 15/09/2026, depois de a revisão medir o buraco: a leitura filtrava
// `.eq("enterprise_id", ...)` e nem trazia a coluna `enterprise_id` — os dois cortes que impedem a
// precedência filho → pai de existir. Para um filho cuja cláusula penal mora no PAI (Lagoa Bonita,
// Vale do Ouro), a aba dizia "não cadastrada", o operador cadastrava "por segurança" e a herança
// morria calada: mudar o pai deixava de alcançar quem copiou
// ([[reference_masterplan_recorte_por_escopo]] é o mesmo cuidado do outro lado).
//   O PARENTESCO NÃO VEM DA URL, E A ESCOLHA É DELIBERADA. Seria mais barato aceitar
// `?pai=<enterprise_id>`, e é exatamente por isso que não: quem esquecesse o parâmetro receberia de
// volta "não cadastrada" — o mesmo defeito, agora dependendo de quem pergunta —, e quem mandasse o
// parâmetro ERRADO veria no formulário as alíquotas de outro produto. O parentesco é fato do
// cadastro do Panteon (`hercules_empreendimentos.pai_id`, migration 0123), então é de lá que ele sai,
// no servidor, uma vez por chamada. A régua que decide o degrau é `itensDoMenorRecorte` — a mesma de
// planos, faixas e comissão —, e não uma sexta cópia da precedência escrita aqui.
//
// ⚠️ E SE O CADASTRO NÃO RESPONDER, O GET NÃO DESENHA O FORMULÁRIO. Tratar a falha como "não tem
// pai" recriaria o defeito acima no pior momento (o único em que ninguém desconfia), então ela vira
// 503 com a frase: uma tela que não consegue distinguir "herdada" de "não cadastrada" não pode
// perguntar ao operador se ele quer cadastrar.
//
// ⚠️ AS CINCO SE SALVAM JUNTAS, E ISSO DIVERGE DE PROPÓSITO DA ABA IRMÃ. A Política Comercial tem
// uma trava de "um campo por vez" (`app/api/apolo/empreendimentos/politica/route.ts`, apoiada em
// `lib/apolo/enterprise-settings.ts`) porque lá cada linha é uma decisão independente — a gestão de
// carteira não tem relação com a entrada mínima, e mandar as duas juntas sobrescreveria o campo que
// o operador não tocou com o que a tela tinha em memória. AQUI É O CONTRÁRIO: as cinco rubricas são
// UM formulário só, e são as cinco que compõem o MESMO número no papel. Salvar a multa penal nova
// com a publicidade antiga produziria um termo cujo total não corresponde a nenhuma versão que
// alguém aprovou. Formulário inteiro, uma gravação.
//
// ⚠️ ESTA ROTA NÃO APAGA LINHA, E NÃO É ESQUECIMENTO. "Desligada continua cadastrada" está escrito
// no comentário da coluna `ativa` na migration: o histórico de POR QUE aquele empreendimento não
// cobra publicidade (a cláusula colada no campo) vale mais do que a linha removida. Parar de deduzir
// é `ativa: false`. Pelo mesmo motivo, rubrica que não veio no corpo fica como está — e a resposta
// diz quais foram gravadas e quais não vieram, para a tela não afirmar mais do que aconteceu.
//
// ⚠️ O ERRO DIZ QUAL RUBRICA ERROU. São cinco linhas na mesma tela: um erro com "percentual
// inválido" e nada mais obriga o operador a adivinhar em qual delas. Cada erro sai como
// `{ campo: "publicidade.percentual", mensagem: "Publicidade: ..." }` — a chave serve para a tela
// pintar o campo, e a frase serve para quem só lê o texto.
//
// ⚠️ E O ENVELOPE DO ERRO DE VALIDAÇÃO É `422 { error, erros }`, IDÊNTICO AO DA ROTA IRMÃ DA POSSE.
// São as duas escritas da MESMA tela de rescisão, e uma tratativa de erro tem de servir para as
// duas. 422 é o molde da casa para corpo bem formado com conteúdo recusado
// (`incorporador/venda/bloqueio`, `.../reserva`, `.../proposta`); 400 fica para o que nem chega a
// ser um pedido legível (corpo que não é JSON, empreendimento ausente). E o `error` vai JUNTO da
// lista porque toda aba de empreendimento do Apolo lê `corpo.error` e só ele — sem a frase curta, a
// tela imprime "Não foi possível salvar." tendo as frases certas na mão.
//
// ⚠️ A RÉGUA DA VALIDAÇÃO É `conferirPremissa`, E NÃO UMA CÓPIA AQUI. As travas dela são as mesmas
// dos CHECKs da 0166 (mensal só para fruição, percentual entre 0 e 100, rubrica ligada precisa de
// número exceto em `valor_efetivo`). Reimplementá-las na rota criaria duas verdades para a mesma
// regra, e a que discordasse do banco só apareceria como um `23514` na cara do operador.
//
// ⚠️ A MIGRATION 0166 PODE NÃO ESTAR APLICADA no ambiente que responde: ela foi escrita em
// 15/09/2026 e aguarda o OK do dono do produto. Tabela ausente vira 503 com a frase que diz o que
// falta, e não um 500 genérico que manda o operador abrir chamado para uma pendência conhecida.
// Quem decide o que é "ausente" é `ehTabelaAusente` (lib/temis/tabela-ausente.ts), que é a régua
// canônica da casa para esse caso — registrada como tal em `lib/roadmap/roadmap.ts`. A cópia que
// esta rota tinha (`/does not exist|schema cache/i`) parecia a mesma coisa e NÃO era: o PGRST204 de
// COLUNA ausente diz *"Could not find the 'x' column of 'y' in the schema cache"*, casa com "schema
// cache" e faria uma 0166 aplicada de um rascunho velho — sem a coluna `atualizado_por_nome`, que o
// PUT grava — responder "migration 0166 pendente" para uma tabela que JÁ EXISTE. Silêncio no ponto
// exato em que a auditoria vai procurar. O original exige o NOME DA TABELA e recusa mensagem que
// fala de coluna.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const WORKSPACE = "careli";
const TABELA = "hercules_premissas_de_rescisao";
/** O cadastro do Panteon (migration 0123) — é nele que mora o parentesco. */
const CADASTRO = "hercules_empreendimentos";

/**
 * As colunas que a tela mostra.
 *
 * ⚠️ `enterprise_id` NÃO É DECORAÇÃO NESTA LISTA. É por ele que `itensDoMenorRecorte` sabe se a
 * linha é deste empreendimento ou do pai; sem a coluna, toda linha chega sem dono, a régua não casa
 * nenhum degrau e a resposta diz "não cadastrada" para o que está cadastrado no pai.
 */
const COLUNAS_DA_PREMISSA =
  "rubrica,ativa,percentual,base,periodicidade,clausula,enterprise_id,atualizado_em,atualizado_por_nome";

type ClienteAdmin = NonNullable<ReturnType<typeof createApoloAdminClient>>;

/** A linha como o PostgREST devolve. `percentual` é `numeric` e pode voltar como texto. */
type LinhaGravada = {
  ativa: boolean;
  atualizado_em: null | string;
  atualizado_por_nome: null | string;
  base: null | string;
  clausula: null | string;
  enterprise_id: null | string;
  percentual: null | number | string;
  periodicidade: null | string;
  rubrica: string;
};

/**
 * A linha já no vocabulário da régua de recorte, com o que a tela precisa mostrar junto.
 *
 * `LinhaDePremissa` é o que `premissasDoRecorte` e `itensDoMenorRecorte` entendem; `atualizadoEm` e
 * `atualizadoPorNome` viajam de carona porque a aba mostra quem mexeu por último — inclusive quando
 * quem mexeu foi alguém no PAI, que é a informação que explica por que o campo veio preenchido.
 */
type LinhaDoDegrau = LinhaDePremissa & {
  atualizadoEm: null | string;
  atualizadoPorNome: null | string;
};

function mensagemDoBanco(erro: null | { code?: string; message?: string }): string {
  if (ehTabelaAusente(erro, TABELA)) {
    return "A tabela de premissas de rescisão ainda não existe neste ambiente (migration 0166 pendente).";
  }
  return `Não foi possível falar com o cadastro de premissas: ${erro?.message ?? "erro desconhecido"}`;
}

/**
 * `numeric` do PostgREST pode chegar como string; vazio e nulo são "não cadastrado".
 *
 * ⚠️ NÃO CONFUNDIR COM ZERO. `percentual: 0` é um cadastro legítimo ("esta rubrica existe e é 0%"),
 * e `null` é a ausência de cadastro — a própria migration distingue os dois no CHECK
 * `hercules_premissas_ativa_tem_numero`. Um `Number(v) || null` colapsaria os dois.
 */
function numeroDoBanco(valor: null | number | string | undefined): null | number {
  if (valor === null || valor === undefined || valor === "") return null;
  const numero = Number(valor);
  return Number.isFinite(numero) ? numero : null;
}

function texto(valor: null | string | undefined): string {
  return String(valor ?? "").trim();
}

function paraODegrau(linha: LinhaGravada): LinhaDoDegrau {
  return {
    // `ativa === true` e não `Boolean(ativa)`: a coluna é `boolean not null`, mas quem lê daqui
    // decide dedução em contrato — a porta estreita custa nada e fecha o caminho de um `"false"`.
    ativa: linha.ativa === true,
    atualizadoEm: linha.atualizado_em ?? null,
    atualizadoPorNome: linha.atualizado_por_nome ?? null,
    base: texto(linha.base),
    clausula: linha.clausula ?? null,
    enterpriseId: texto(linha.enterprise_id) || null,
    percentual: numeroDoBanco(linha.percentual),
    periodicidade: texto(linha.periodicidade),
    rubrica: texto(linha.rubrica),
  };
}

/** O que a leitura do cadastro respondeu sobre o parentesco deste empreendimento. */
type FamiliaDoEmpreendimento = {
  /** A frase do 503 quando `ok` é falso. Nulo quando deu certo. */
  motivo: null | string;
  ok: boolean;
  /**
   * O `enterprise_id` (id do C2X, como texto) do PAI.
   *
   * Nulo em três casos legítimos, e nenhum deles é falha: empreendimento sem pai, empreendimento que
   * ainda não está no cadastro do Panteon, e pai que só existe aqui (o LOX da Lavra do Ouro não tem
   * `c2x_enterprise_id`) — sem id do C2X não há premissa dele para herdar, porque a tabela de
   * premissas é chaveada por esse id.
   */
  paiEnterpriseId: null | string;
};

/** A frase do 503 quando o parentesco não pôde ser conferido. Escrita uma vez, dita nos dois ramos. */
const SEM_CONFERIR_O_PARENTESCO =
  "Não foi possível conferir se este empreendimento herda premissas do principal. Recarregue a tela antes de cadastrar.";

/**
 * Sobe UM nível no cadastro do Panteon e devolve o `enterprise_id` do pai.
 *
 * Um nível só, de propósito: `pai_id` é usado com um nível de profundidade em todo o repo
 * (`arvoreDeEmpreendimentos`, `topoDaArvore`), e uma subida recursiva aqui inventaria uma hierarquia
 * que a tabela não tem.
 *
 * ⚠️ NÃO USA `maybeSingle()`. Duas linhas do cadastro com o mesmo `c2x_enterprise_id` fariam o
 * PostgREST devolver ERRO em vez de linha, e a aba inteira cairia em 503 por causa de um cadastro
 * duplicado — que é problema de cadastro, não motivo para esconder as premissas. Com o select
 * normal, a primeira linha que declara pai responde.
 */
async function lerFamilia(
  admin: ClienteAdmin,
  enterpriseId: string,
): Promise<FamiliaDoEmpreendimento> {
  const { data, error } = await admin
    .from(CADASTRO)
    .select("id,pai_id")
    .eq("workspace_id", WORKSPACE)
    .eq("c2x_enterprise_id", enterpriseId);

  if (error) {
    console.error("[apolo][premissas-de-rescisao] cadastro do empreendimento", error.message);
    return { motivo: SEM_CONFERIR_O_PARENTESCO, ok: false, paiEnterpriseId: null };
  }

  const linhas = (data ?? []) as { id: string; pai_id: null | string }[];
  const paiId = texto(linhas.find((linha) => texto(linha.pai_id))?.pai_id);
  if (!paiId) return { motivo: null, ok: true, paiEnterpriseId: null };

  const { data: dadosDoPai, error: erroDoPai } = await admin
    .from(CADASTRO)
    .select("c2x_enterprise_id")
    .eq("workspace_id", WORKSPACE)
    .eq("id", paiId);

  if (erroDoPai) {
    console.error("[apolo][premissas-de-rescisao] cadastro do pai", erroDoPai.message);
    return { motivo: SEM_CONFERIR_O_PARENTESCO, ok: false, paiEnterpriseId: null };
  }

  const pais = (dadosDoPai ?? []) as { c2x_enterprise_id: null | string }[];
  return {
    motivo: null,
    ok: true,
    paiEnterpriseId: texto(pais[0]?.c2x_enterprise_id) || null,
  };
}

export async function GET(request: Request) {
  const auth = await authorizeApoloRead(request);
  if (!auth.ok) return auth.response;

  const enterpriseId = (new URL(request.url).searchParams.get("enterprise") ?? "").trim();
  if (!enterpriseId) {
    return NextResponse.json({ error: "Informe o empreendimento." }, { status: 400 });
  }

  const admin = createApoloAdminClient();
  if (!admin) {
    return NextResponse.json({ error: "Supabase indisponível." }, { status: 503 });
  }

  const familia = await lerFamilia(admin, enterpriseId);
  if (!familia.ok) {
    return NextResponse.json(
      { error: familia.motivo ?? SEM_CONFERIR_O_PARENTESCO },
      { status: 503 },
    );
  }

  // Os degraus que podem ter cadastro. Sem pai, é um só — e aí a resposta é a de sempre.
  const degraus = familia.paiEnterpriseId
    ? [enterpriseId, familia.paiEnterpriseId]
    : [enterpriseId];

  const { data, error } = await admin
    .from(TABELA)
    .select(COLUNAS_DA_PREMISSA)
    .eq("workspace_id", WORKSPACE)
    .in("enterprise_id", degraus);

  // ⚠️ FALHA DE LEITURA NÃO VIRA "NÃO CADASTRADO". Devolver as cinco rubricas vazias depois de um
  // timeout faria a tela AFIRMAR que o empreendimento não tem premissa nenhuma — e o operador
  // estaria a um clique de gravar esse vazio por cima do cadastro real. É o mesmo cuidado que a
  // rota da política comercial toma com a leitura das settings.
  if (error) {
    return NextResponse.json({ error: mensagemDoBanco(error) }, { status: 503 });
  }

  const linhas = ((data ?? []) as LinhaGravada[]).map(paraODegrau);

  // A unidade aqui é o EMPREENDIMENTO inteiro, então não há degrau de categoria: a aba cadastra por
  // empreendimento, e categoria é recorte de unidade. A régua é a mesma; só o primeiro degrau não
  // se aplica.
  const recorte: RecorteDaUnidade = {
    categoriaId: null,
    enterpriseId,
    paiEnterpriseId: familia.paiEnterpriseId,
  };

  // ⚠️ E ISTO NÃO É A MESMA PERGUNTA QUE A DE BAIXO. `premissasDoRecorte` responde "o que o TERMO vai
  // usar", e por isso descarta linha desligada e linha cuja base não serve à rubrica. A tela precisa
  // das duas respostas: a linha desligada TEM de aparecer no formulário (é ela que guarda a cláusula
  // explicando por que aquele empreendimento não cobra), e uma linha que existe mas não entra na
  // conta — nascida de SQL direto ou de backfill, com `fruicao` sobre `total_pago` — precisa
  // aparecer marcada, senão o operador olha um cadastro que o papel ignora e não fica sabendo.
  const doTermo = premissasDoRecorte(recorte, linhas);

  const premissas = RUBRICAS.map((rubrica) => {
    const daRubrica = linhas.filter((linha) => linha.rubrica === rubrica.valor);
    // A MESMA régua de categoria → filho → pai dos planos, das faixas e da comissão. Uma sexta
    // cópia da precedência aqui faria a mesma tela obedecer a duas leis conforme o campo.
    const escolha = itensDoMenorRecorte(recorte, daRubrica);
    const linha = escolha.itens[0] ?? null;
    const origem: null | OrigemDoRecorte = linha ? escolha.origem : null;

    // ⚠️ A BASE SUGERIDA É PRÉ-SELEÇÃO DE FORMULÁRIO, NÃO CADASTRO. Quem responde por isso é
    // `cadastrada: false`: a tela tem de conseguir dizer "ninguém cadastrou" enquanto já mostra o
    // campo preenchido com a opção mais provável.
    const baseSugerida = rubrica.bases[0] ?? null;

    return {
      ajuda: rubrica.ajuda,
      ativa: linha?.ativa === true,
      atualizadoEm: linha?.atualizadoEm ?? null,
      atualizadoPorNome: linha?.atualizadoPorNome ?? null,
      base: (linha?.base ?? "").trim() || baseSugerida,
      basesPermitidas: rubrica.bases.map((base) => ({
        rotulo: ROTULO_DA_BASE_NA_TELA[base],
        valor: base,
      })),
      // "Cadastrada" é cadastrada NESTE empreendimento — é o que o PUT desta aba grava e o que o
      // operador pode editar aqui. O que vem do pai sai em `herdada`, e os dois juntos é que dizem
      // se ainda falta alguém decidir.
      cadastrada: origem === "filho",
      clausula: linha?.clausula ?? null,
      herdada: origem === "pai",
      herdadaDe: origem === "pai" ? familia.paiEnterpriseId : null,
      origem,
      /** A frase da casa para a origem, escrita uma vez só em `comoSeHerdou`. */
      origemFrase: comoSeHerdou(origem),
      percentual: linha?.percentual ?? null,
      // ⚠️ FRUIÇÃO NASCE "MENSAL" NO FORMULÁRIO, e as demais "única". Não é enfeite: `mensal` só
      // existe para fruição (CHECK `hercules_premissas_mensal_so_fruicao`), e é assim que ela é
      // cobrada — por mês de ocupação, 0,75%/mês na praxe. Sugerir "única" para a fruição faria o
      // operador salvar uma dedução de uma vez só, que o banco ACEITA e o termo imprime errado.
      periodicidade:
        (linha?.periodicidade ?? "").trim() || (rubrica.valor === "fruicao" ? "mensal" : "unica"),
      rotulo: rubrica.rotulo,
      rubrica: rubrica.valor,
      /** A linha escolhida entra mesmo na conta do termo? Ver o aviso de `doTermo`. */
      valeNoTermo: doTermo.premissas[rubrica.valor] !== undefined,
    };
  });

  return NextResponse.json(
    {
      data: {
        cadastradas: premissas.filter((p) => p.cadastrada).map((p) => p.rubrica),
        enterpriseId,
        // ⚠️ "FALTANDO" É "NINGUÉM DECIDIU", E NÃO "NÃO TEM LINHA AQUI". Rubrica herdada do pai TEM
        // decisão — listá-la aqui é o que faria a aba pedir um cadastro "por segurança" que mata a
        // herança. É esta linha que fecha o defeito descrito no cabeçalho.
        faltando: premissas.filter((p) => !p.cadastrada && !p.herdada).map((p) => p.rubrica),
        herdadas: premissas.filter((p) => p.herdada).map((p) => p.rubrica),
        paiEnterpriseId: familia.paiEnterpriseId,
        premissas,
      },
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

/** Uma linha do corpo do PUT, do jeito que chega: sem tipo garantido. */
type PremissaDoCorpo = {
  ativa?: unknown;
  base?: unknown;
  clausula?: unknown;
  percentual?: unknown;
  periodicidade?: unknown;
  rubrica?: unknown;
};

/**
 * Lê o percentual como a tela manda (número, ou texto com vírgula).
 *
 * ⚠️ TRÊS CASAS, E NÃO DUAS. A regra da casa de arredondar com `Math.round(v * 100) / 100` é para
 * DINHEIRO; aqui o campo é `numeric(6, 3)` e a corretagem medida nos contratos vai de 1,5% a 8%.
 * Cortar na segunda casa faria o operador digitar 5,933% e a tela recarregar com 5,93% — o número
 * mudando sozinho entre salvar e reabrir. O arredondamento existe só para não mandar ao banco mais
 * casas do que a coluna guarda, o que o Postgres arredondaria calado.
 */
function lerPercentual(bruto: unknown): { invalido: boolean; valor: null | number } {
  if (bruto === null || bruto === undefined || bruto === "") {
    return { invalido: false, valor: null };
  }
  // ⚠️ `Number(true)` É 1. Sem esta porta, um booleano vindo de um input mal convertido viraria uma
  // alíquota de 1% que ninguém digitou.
  if (typeof bruto !== "number" && typeof bruto !== "string") {
    return { invalido: true, valor: null };
  }
  const numero = typeof bruto === "string" ? Number(bruto.trim().replace(",", ".")) : bruto;
  if (!Number.isFinite(numero)) {
    return { invalido: true, valor: null };
  }
  return { invalido: false, valor: Math.round(numero * 1000) / 1000 };
}

/**
 * A linha do corpo é um objeto que dá para ler campo a campo?
 *
 * ⚠️ `Array.isArray(corpo.premissas)` PROVA QUE É ARRAY, E NÃO QUE OS ITENS SÃO OBJETOS. Medido em
 * 15/09/2026: `PUT { enterpriseId: "31", premissas: [null] }` estourava `Cannot read properties of
 * null` no primeiro `recebida.rubrica` — fora de qualquer try — e o operador recebia um 500 com
 * stack no lugar do `{ campo, mensagem }` que o resto da rota entrega. Array e string também entram
 * por esta porta: `[].rubrica` é `undefined` e passaria como "rubrica desconhecida", uma frase que
 * manda o operador procurar um campo que não existe.
 */
function ehLinhaLegivel(bruta: unknown): bruta is PremissaDoCorpo {
  return typeof bruta === "object" && bruta !== null && !Array.isArray(bruta);
}

export async function PUT(request: Request) {
  const auth = await authorizeApoloWrite(request);
  if (!auth.ok) return auth.response;

  // ⚠️ O CORPO INTEIRO PASSA PELA MESMA PORTA QUE AS LINHAS, E ISSO FOI MEDIDO EM 15/09/2026. A
  // porta `ehLinhaLegivel` fechou o `premissas: [null]`, mas um degrau acima a leitura continuava
  // crua: `request.json()` devolve `null` para o corpo `null` — que é JSON VÁLIDO, então o `catch`
  // nunca dispara —, e o `String(corpo.enterpriseId ?? "")` logo abaixo estourava `Cannot read
  // properties of null`, fora de qualquer try, entregando ao operador um 500 com stack no lugar da
  // frase. Um corpo `"texto"`, `7` ou `[]` não estoura (ler propriedade de um primitivo devolve
  // `undefined`), mas respondia "Informe o empreendimento." — mandando procurar um campo num corpo
  // que nem é formulário. O que não é OBJETO é recusado aqui, com a mesma frase da rota irmã da
  // posse, que fechou este mesmo buraco na mesma data.
  let corpo: { enterpriseId?: unknown; premissas?: unknown };
  try {
    const lido: unknown = await request.json();
    if (lido === null || typeof lido !== "object" || Array.isArray(lido)) {
      return NextResponse.json({ error: "Corpo inválido." }, { status: 400 });
    }
    corpo = lido as typeof corpo;
  } catch {
    return NextResponse.json({ error: "Corpo inválido." }, { status: 400 });
  }

  const enterpriseId = String(corpo.enterpriseId ?? "").trim();
  if (!enterpriseId) {
    return NextResponse.json({ error: "Informe o empreendimento." }, { status: 400 });
  }

  const recebidas = Array.isArray(corpo.premissas) ? (corpo.premissas as unknown[]) : null;
  if (!recebidas || recebidas.length === 0) {
    return NextResponse.json({ error: "Informe ao menos uma rubrica." }, { status: 400 });
  }

  // ⚠️ A INFRAESTRUTURA É CONFERIDA DEPOIS DO PEDIDO, E ERA AQUI QUE AS DUAS ROTAS DIVERGIAM. Até
  // 15/09/2026 o cliente do Supabase era conferido antes do corpo, e com isso o MESMO pedido torto
  // respondia 400 em produção e 503 num ambiente sem credencial — a resposta a um defeito do PEDIDO
  // mudando com a infraestrutura, que é exatamente o que faz alguém procurar no lugar errado ao ler
  // o log. "Informe o empreendimento." não depende de banco nenhum. A rota irmã da posse já seguia
  // esta ordem nos três verbos; agora as duas concordam: auth → pedido → infraestrutura → validação.
  const admin = createApoloAdminClient();
  if (!admin) {
    return NextResponse.json({ error: "Supabase indisponível." }, { status: 503 });
  }

  const erros: ErroDePremissa[] = [];
  const camposComErro = new Set<string>();

  // ⚠️ UMA FRASE POR CAMPO. Um percentual escrito como "dez" derrubaria duas mensagens na mesma
  // caixinha ("não é número" e "informe o percentual"), e a segunda é só consequência da primeira.
  const anotar = (campo: string, mensagem: string) => {
    if (camposComErro.has(campo)) return;
    camposComErro.add(campo);
    erros.push({ campo, mensagem });
  };

  const linhas: Record<string, unknown>[] = [];
  const rubricasVistas = new Set<string>();
  const agora = new Date().toISOString();

  recebidas.forEach((bruta, indice) => {
    if (!ehLinhaLegivel(bruta)) {
      anotar(
        `linha${indice + 1}.rubrica`,
        `Linha ${indice + 1}: não consegui ler esta linha do formulário.`,
      );
      return;
    }

    const recebida = bruta;
    const rubrica = String(recebida.rubrica ?? "").trim();
    const conhecida = RUBRICAS.find((r) => r.valor === rubrica);

    // A chave do erro é a rubrica quando dá para reconhecê-la, e a posição quando não dá. Nos dois
    // casos a tela consegue apontar o campo, que é o ponto.
    const chave = conhecida ? conhecida.valor : `linha${indice + 1}`;
    const rotulo = conhecida ? conhecida.rotulo : `Linha ${indice + 1}`;

    // ⚠️ RUBRICA REPETIDA NO MESMO CORPO DERRUBA O UPSERT INTEIRO. O índice único é
    // (workspace_id, enterprise_id, rubrica), e o Postgres recusa o lote com "ON CONFLICT DO UPDATE
    // command cannot affect row a second time" — uma mensagem que não diz nada a quem está na tela,
    // e que faria as CINCO rubricas não salvarem por causa de uma linha duplicada.
    if (conhecida && rubricasVistas.has(rubrica)) {
      anotar(
        `${chave}.rubrica`,
        `${rotulo}: esta rubrica veio duas vezes no mesmo formulário. Deixe uma linha por rubrica.`,
      );
      return;
    }
    if (conhecida) rubricasVistas.add(rubrica);

    // ⚠️ `ativa` TEM DE SER BOOLEANO DE VERDADE. Um `"false"` (texto) vindo de um input mal
    // convertido é TRUTHY em JavaScript, e um `"true"` não é `=== true`: os dois caminhos silenciosos
    // existem, e um deles DESLIGA a rubrica que o operador acabou de ligar sem avisar ninguém.
    if (typeof recebida.ativa !== "boolean") {
      anotar(`${chave}.ativa`, `${rotulo}: diga se a rubrica está ligada ou desligada.`);
      return;
    }

    const percentual = lerPercentual(recebida.percentual);
    if (percentual.invalido) {
      anotar(`${chave}.percentual`, `${rotulo}: percentual inválido. Informe um número.`);
    }

    const base = String(recebida.base ?? "").trim();
    const periodicidade = String(recebida.periodicidade ?? "").trim();
    const clausula = recebida.clausula == null ? "" : String(recebida.clausula).trim();

    // A MESMA régua da tela e dos CHECKs da 0166. Ver o aviso em `conferirPremissa`.
    for (const erro of conferirPremissa({
      ativa: recebida.ativa,
      base,
      clausula,
      percentual: percentual.valor,
      periodicidade,
      rubrica,
    })) {
      anotar(`${chave}.${erro.campo}`, `${rotulo}: ${erro.mensagem}`);
    }

    linhas.push({
      ativa: recebida.ativa,
      atualizado_em: agora,
      // ⚠️ O AUTOR VAI GRAVADO COM NOME E TUDO, e não resolvido por join depois: a pessoa sai da
      // empresa, o cadastro muda, e o histórico tem de continuar dizendo quem mexeu naquele dia. É
      // para isso que `authorizeApoloWrite` passou a devolver o `nome` (15/09/2026). Nulo é
      // aceitável — `hub_users.display_name` não é obrigatório —, e inventar "Sistema" seria pior.
      atualizado_por: auth.userId,
      atualizado_por_nome: auth.nome,
      base,
      clausula: clausula || null,
      enterprise_id: enterpriseId,
      percentual: percentual.valor,
      periodicidade,
      rubrica,
      workspace_id: WORKSPACE,
    });
  });

  if (erros.length > 0) {
    return NextResponse.json(
      { error: "Confira as premissas antes de salvar.", erros },
      { status: 422 },
    );
  }

  // ⚠️ UM UPSERT SÓ, e não um laço de cinco escritas. Cinco chamadas em sequência deixariam o
  // empreendimento com duas rubricas novas e três velhas quando a terceira falhasse — o estado
  // meio-feito que a rota da política comercial é obrigada a relatar no erro justamente porque
  // grava em laço. Aqui o lote inteiro é um comando: ele vale ou não vale.
  const { data: gravadas, error } = await admin
    .from(TABELA)
    .upsert(linhas, { onConflict: "workspace_id,enterprise_id,rubrica" })
    .select("rubrica");

  if (error) {
    if (ehTabelaAusente(error, TABELA)) {
      return NextResponse.json({ error: mensagemDoBanco(error) }, { status: 503 });
    }
    // ⚠️ `23514` É O BANCO RECUSANDO PELO CHECK, e chegar aqui significa que a rota deixou passar
    // algo que a 0166 proíbe: as duas réguas divergiram. Vira 400 (o corpo é que está errado), com a
    // mensagem do banco junto, para a divergência aparecer em vez de virar um 500 sem rastro. Não é
    // 422 de propósito: 422 é a validação desta rota, que sai com a lista `erros` apontando campo a
    // campo; aqui a rota não sabe qual campo é, e responder no mesmo envelope faria a tela procurar
    // uma lista que não existe.
    const status = error.code === "23514" ? 400 : 500;
    console.error("[apolo][premissas-de-rescisao] upsert falhou", error.message);
    return NextResponse.json({ error: mensagemDoBanco(error) }, { status });
  }

  // ⚠️ CONFERE O QUE CASOU. `.upsert()` sem `.select()` devolve sucesso sem dizer quantas linhas
  // gravou; com o `select`, a contagem prova que as cinco entraram. Sem isso, a tela diria "salvo"
  // para uma gravação que não aconteceu — foi exatamente o buraco que a rota de bloqueio fechou.
  const rubricasGravadas = Array.isArray(gravadas)
    ? (gravadas as { rubrica: string }[]).map((linha) => String(linha.rubrica))
    : [];

  if (rubricasGravadas.length !== linhas.length) {
    return NextResponse.json(
      {
        error: `Salvei ${rubricasGravadas.length} de ${linhas.length} rubricas. Recarregue a tela e confira antes de emitir um termo.`,
        gravadas: rubricasGravadas,
      },
      { status: 500 },
    );
  }

  return NextResponse.json({
    data: {
      atualizadoPorNome: auth.nome,
      enterpriseId,
      gravadas: rubricasGravadas,
      // A tela não pode dizer "premissas salvas" quando o operador mandou três de cinco: o que não
      // veio continua como estava, e isso é informação, não detalhe.
      naoEnviadas: RUBRICAS.filter((r) => !rubricasVistas.has(r.valor)).map((r) => r.valor),
    },
  });
}
