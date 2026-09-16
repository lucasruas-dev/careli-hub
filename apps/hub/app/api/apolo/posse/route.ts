import { NextResponse } from "next/server";

import { authorizeApoloRead, authorizeApoloWrite } from "@/lib/apolo/auth";
import {
  conferirPosse,
  type ErroDePosse,
  type OrigemDaPosse,
  ORIGENS_DA_POSSE,
  type PosseRegistrada,
} from "@/lib/apolo/posse";
import { createApoloAdminClient } from "@/lib/apolo/server";

// A DATA DA POSSE DE UM CONTRATO — ler, gravar e APAGAR.
//
// Lucas (15/09/2026): *"vamos precisar de incluir esse campo de posse, ae vc pode incluir no lugar
// correto. se não estiver preenchido é que a posse não aconteceu."*
//
// Esta é a primeira e (por enquanto) única escrita de `hercules_posse` — migration 0165, já
// aplicada em produção com 0 linhas. Quem lê o número é a conta da rescisão: sem a data,
// `mesesDeFruicao` devolve zero e a rubrica mais pesada do termo some do papel. No caso de
// referência (LAVRA DO OURO, Quadra 06 — Lote 10) a fruição vale R$ 11.401,11 — mais do que todas
// as outras deduções somadas. Por isso esta rota existe antes da tela: sem um caminho de cadastro,
// a coluna nasceria vazia para sempre e a rubrica seria decorativa.
//
// ⚠️ APAGAR É OPERAÇÃO NORMAL, NÃO CASO DE EXCEÇÃO. Vazio significa "a posse não aconteceu", e esse
// é o estado correto da maioria dos contratos que chegam à rescisão: a cláusula 5.1 da minuta da
// Lavra do Ouro só concede a posse a quem está EM DIA com as obrigações, que é justamente quem não
// se distrata. Então o DELETE fica ao lado do PUT, com o mesmo gate, e responde 200 mesmo quando
// não havia linha nenhuma — dois cliques, ou uma aba aberta desde ontem, não podem pintar de
// vermelho um estado que já é exatamente o que o operador queria.
//
// ⚠️ O UPSERT AQUI NÃO É `.upsert()`, E ISSO NÃO É PREFERÊNCIA. O índice único é PARCIAL
// (`hercules_posse_um_por_contrato ... where contrato_c2x_id is not null`, migration 0165), e o
// `on_conflict` do PostgREST só sabe escrever a LISTA DE COLUNAS: vira
// `on conflict (workspace_id, contrato_c2x_id) do update`, sem o `where` na cláusula de inferência.
// O Postgres não elege índice parcial numa inferência sem predicado — devolve 42P10 ("there is no
// unique or exclusion constraint matching the ON CONFLICT specification"). E não inventei o
// contorno: onde a casa já lida com um índice parcial
// (`hercules_reservas_uma_viva_por_unidade`, migration 0125, em
// `app/api/incorporador/venda/reserva/route.ts`) ela não usa `.upsert()` — ela grava e TRADUZ o
// 23505 numa frase. Aqui é o mesmo: lê, decide entre insert e update, e trata a corrida pelo código
// do erro.
//
// ⚠️ SÓ CONTRATO DO C2X PASSA POR AQUI. A tabela aceita dois donos e o CHECK
// `hercules_posse_um_dono` exige EXATAMENTE UM (`contrato_c2x_id` XOR `venda_id`). Corpo que traga
// `vendaId` é recusado com a frase, e não deixado seguir para virar um 23514 com o nome de uma
// constraint na tela do operador. Quando a venda nascida no Panteon precisar de posse, é rota
// irmã — e não um `if` a mais aqui, que seria a porta para gravar linha com os dois donos.
//
// ⚠️ E O `local-hub-user` NUNCA CHEGA AO INSERT. `authorizeApolo` devolve esse userId de mentira
// quando não há credencial do Supabase — e `registrado_por` é `uuid`, então ele derrubaria a
// gravação com 22P02. Não acontece porque a MESMA ausência de credencial faz
// `createApoloAdminClient()` devolver null, e a rota para no 503 antes de tocar no banco.
//
// ⚠️ CAMPO QUE NÃO VEIO NO PUT NÃO APAGA O QUE JÁ ESTÁ GRAVADO — E ISSO NASCEU DE UM DEFEITO REAL.
// Até 15/09/2026 o UPDATE mandava o objeto INTEIRO, com `enterprise_id` e `unidade_c2x_id` sempre
// dentro. Corpo sem o retrato virava `null` na linha que já existia, e o GET nem devolvia esses dois
// campos — a tela que recarregou a posse não tinha como reenviá-los. Ou seja: o SEGUNDO PUT do mesmo
// contrato apagava o retrato por construção. O estrago é o que o aviso do próprio retrato descreve
// logo abaixo: sem `enterprise_id` a linha sai do índice parcial `hercules_posse_por_empreendimento`
// (`where enterprise_id is not null`) e some para sempre da pergunta "quais lotes deste
// empreendimento têm posse?" — calada, porque a data continua certa e a tela diz "salvo".
//   O conserto tem duas metades, e as duas são necessárias:
//   (1) o UPDATE só carrega o retrato QUANDO ELE VEIO no corpo. Em branco e ausente são a mesma
//       coisa (`veioPreenchido`), e nenhum dos dois sobrescreve: a tela que não conhece o retrato
//       manda `""` exatamente como manda nada, e limpar um campo que SÓ serve para filtrar nunca é
//       o que alguém quis. Trocar o retrato continua possível — é mandar o novo valor. Zerá-lo é
//       DELETE e cadastrar de novo, que é operação normal aqui (ver o aviso do DELETE).
//   (2) o GET DEVOLVE `enterpriseId` e `unidadeC2xId`. Sem isso a metade (1) só esconderia o
//       problema: a tela nunca reenviaria o retrato, e a linha ficaria para sempre com o que o
//       primeiro PUT gravou, sem jeito de corrigir um retrato errado pela tela.
//
// ⚠️ ERRO DE VALIDAÇÃO SAI EM 422 COM `error` JUNTO DE `erros`, E NÃO SÓ `erros`. Toda aba de
// empreendimento do Apolo lê `corpo.error` e SÓ ele (`politica-comercial-tab.tsx`,
// `categorias-tab.tsx`, `anexos-do-contrato.tsx`, `adicionar-unidades.tsx`, todas com
// `corpo.error ?? "<frase genérica>"`). Devolver as frases certas apenas dentro de `erros` fazia a
// tela imprimir "Não foi possível salvar." para "posse no futuro", "31 de fevereiro" e "origem
// inválida" — o operador nunca ficava sabendo o que errou. E 422 é o molde da casa para corpo bem
// formado com conteúdo recusado (`incorporador/venda/bloqueio`, `.../reserva`, `.../proposta`); 400
// fica para o que nem chega a ser um pedido legível (corpo que não é JSON, contrato ausente na URL).
// O formato é IDÊNTICO ao da rota irmã `empreendimentos/premissas-de-rescisao`, de propósito: são as
// duas escritas da mesma tela de rescisão, e uma tratativa de erro serve para as duas.

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// ⚠️ "careli", A STRING, E NÃO UM UUID. A coluna é TEXT com default 'careli' (migration 0165, igual
// a toda a família `hercules_*`). Texto contra texto NÃO DÁ ERRO DE TIPO: um uuid aqui casaria zero
// linhas, em silêncio, o GET responderia "sem posse" para todo contrato que tem posse e o termo
// sairia sem a fruição — sem uma linha de log para denunciar. Foi exatamente o defeito de
// 14/09/2026 em `venda/bloqueio`, que passou por 28 testes verdes e só caiu na revisão. O teste
// desta rota lê esta linha como TEXTO, porque nenhuma outra prova alcança este erro.
const WORKSPACE = "careli";

/**
 * O que a tela e o termo precisam saber da linha. `registrado_por` não sai: é uuid interno.
 *
 * ⚠️ `enterprise_id` E `unidade_c2x_id` ESTÃO AQUI PARA A TELA PODER REENVIÁ-LOS. Eles não são
 * enfeite da resposta: enquanto o GET não os devolvia, a tela que recarregava a posse não tinha como
 * mandá-los de volta no PUT seguinte — ver o aviso do retrato no cabeçalho.
 */
const COLUNAS =
  "id,data_da_posse,origem,observacao,registrado_em,registrado_por_nome,enterprise_id,unidade_c2x_id";

type ClienteAdmin = NonNullable<ReturnType<typeof createApoloAdminClient>>;

type LinhaDePosse = {
  data_da_posse: null | string;
  enterprise_id: null | string;
  id: string;
  observacao: null | string;
  origem: null | string;
  registrado_em: null | string;
  registrado_por_nome: null | string;
  unidade_c2x_id: null | number;
};

/**
 * A posse como a tela recebe: o fato (o que `lib/apolo/posse.ts` define) MAIS o retrato.
 *
 * ⚠️ O RETRATO NÃO ENTRA EM `PosseRegistrada`, E ISSO É DE PROPÓSITO. Aquele tipo é o que o TERMO
 * consome — data, origem, observação e autoria. `enterprise_id` e `unidade_c2x_id` não decidem nada
 * no papel (migration 0165: "só filtra"); eles existem para esta rota conseguir devolver ao
 * formulário o que o formulário precisa reenviar. Misturá-los no tipo do termo convidaria alguém a
 * calcular alguma coisa com eles.
 */
type PosseNaTela = PosseRegistrada & {
  enterpriseId: null | string;
  unidadeC2xId: null | number;
};

type CorpoDaPosse = {
  contratoC2xId?: unknown;
  dataDaPosse?: unknown;
  enterpriseId?: unknown;
  observacao?: unknown;
  origem?: unknown;
  unidadeC2xId?: unknown;
  /** ⚠️ Só existe no tipo para ser RECUSADO — ver o aviso do cabeçalho. */
  vendaId?: unknown;
};

/**
 * O id do contrato como o banco o guarda.
 *
 * ⚠️ `contrato_c2x_id` É BIGINT. Um "?contrato=abc" mandado para o PostgREST volta como 22P02 e a
 * rota cairia em 500 por causa de um erro de digitação na URL; e um número acima de 2^53 já chegaria
 * arredondado aqui, antes de chegar ao banco, casando a linha ERRADA. Por isso o filtro é de
 * dígitos com teto de 15 casas — os 3.022 contratos vivos do C2X cabem com folga.
 */
function contratoDaUrl(request: Request): null | number {
  const bruto = String(new URL(request.url).searchParams.get("contrato") ?? "").trim();
  if (!/^\d{1,15}$/.test(bruto)) return null;
  const numero = Number(bruto);
  return numero > 0 ? numero : null;
}

/** O mesmo filtro, para os ids que vêm no corpo. Devolve null quando não é um id plausível. */
function idPlausivel(valor: unknown): null | number {
  const bruto = String(valor ?? "").trim();
  if (!/^\d{1,15}$/.test(bruto)) return null;
  const numero = Number(bruto);
  return numero > 0 ? numero : null;
}

/** Foi preenchido pelo operador? String vazia e nulo são a mesma coisa: campo em branco. */
function veioPreenchido(valor: unknown): boolean {
  return valor != null && String(valor).trim() !== "";
}

/**
 * A origem da linha, estreitada para o tipo.
 *
 * ⚠️ O CHECK `hercules_posse_origem` JÁ GARANTE os três valores — isto não é desconfiança do banco,
 * é o que evita um `as OrigemDaPosse` cego. O fallback é `declarada`, que é o DEFAULT da própria
 * coluna: se um dia o CHECK afrouxar, a tela mostra a origem mais fraca em vez de um rótulo vazio.
 */
function origemDaLinha(valor: unknown): OrigemDaPosse {
  const bruto = String(valor ?? "").trim();
  return ORIGENS_DA_POSSE.find((o) => o.valor === bruto)?.valor ?? "declarada";
}

function posseParaTela(linha: LinhaDePosse): PosseNaTela {
  return {
    dataDaPosse: String(linha.data_da_posse ?? ""),
    enterpriseId: linha.enterprise_id ?? null,
    observacao: linha.observacao,
    origem: origemDaLinha(linha.origem),
    registradoEm: linha.registrado_em,
    registradoPorNome: linha.registrado_por_nome,
    unidadeC2xId: linha.unidade_c2x_id ?? null,
  };
}

/**
 * A posse registrada de um contrato, ou `null`.
 *
 * ⚠️ `null` NÃO É ERRO, E A TELA NÃO PODE TRATAR COMO PENDÊNCIA. Ausência de posse é o estado
 * normal (ver o cabeçalho e o aviso em `lib/apolo/posse.ts`): 200 com `posse: null` é a resposta
 * certa, não 404. Um 404 aqui faria a tela desenhar erro em cima da maioria dos contratos.
 */
export async function GET(request: Request) {
  const auth = await authorizeApoloRead(request);
  if (!auth.ok) return auth.response;

  // ⚠️ A ORDEM É auth → PEDIDO → INFRAESTRUTURA, IGUAL À ROTA IRMÃ DAS PREMISSAS, e a escolha tem
  // motivo. "Informe o contrato" é uma resposta que não depende de Supabase nenhum: conferindo o
  // cliente antes, o MESMO pedido torto responderia 400 em produção e 503 num ambiente sem
  // credencial — a resposta a um defeito do pedido mudando com a infraestrutura, que é justamente o
  // que confunde quem está lendo o log. Os três verbos deste arquivo seguem esta ordem.
  const contrato = contratoDaUrl(request);
  if (contrato === null) {
    return NextResponse.json({ error: "Informe o contrato." }, { status: 400 });
  }

  const admin = createApoloAdminClient();
  if (!admin) {
    return NextResponse.json({ error: "Supabase indisponível." }, { status: 503 });
  }

  try {
    const { data, error } = await admin
      .from("hercules_posse")
      .select(COLUNAS)
      .eq("workspace_id", WORKSPACE)
      .eq("contrato_c2x_id", contrato)
      .maybeSingle();

    if (error) throw new Error(error.message);

    const linha = (data ?? null) as LinhaDePosse | null;

    return NextResponse.json(
      { data: { posse: linha ? posseParaTela(linha) : null } },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (erro) {
    // ⚠️ 503, E NÃO 500 — A MESMA ESCOLHA DA ROTA IRMÃ DAS PREMISSAS. Falha de leitura não é erro do
    // cliente nem defeito desta rota: é o banco fora de alcance. E o que ela NÃO pode virar é
    // "posse: null", que é uma resposta legítima aqui e significa "a posse não aconteceu" — a tela
    // desenharia o contrato como sem posse e o operador estaria a um clique de gravar esse vazio por
    // cima de uma data real. 503 diz "não consegui ler", que é outra frase.
    console.error("[apolo][posse][GET]", erro);
    return NextResponse.json({ error: "Não foi possível ler a posse." }, { status: 503 });
  }
}

/**
 * Registra (ou corrige) a data da posse do contrato.
 *
 * ⚠️ O AUTOR ANDA JUNTO COM O VALOR. A tabela tem UM par de colunas de autoria
 * (`registrado_por` / `registrado_por_nome`) e um carimbo (`registrado_em`), e o que a ficha imprime
 * é a frase inteira: "15/03/2024, declarada por Fulano em 12/09/2026". Se a correção trocasse a data
 * e deixasse o par antigo, o papel atribuiria a Fulano um número que ele não escolheu. Então os três
 * são reescritos juntos, sempre. O que se perde é "desde quando o sistema sabe da posse" — e esse
 * fato não é impresso em lugar nenhum, enquanto a autoria errada é.
 *
 * ⚠️ O NOME É COPIADO, NÃO RESOLVIDO POR JOIN. É para isso que `authorizeApoloWrite` passou a
 * devolver `nome` em 15/09/2026 (ver `lib/apolo/auth.ts`): a pessoa sai da empresa, o cadastro muda,
 * e o histórico tem de continuar dizendo quem foi naquele dia. `nome` pode ser nulo — e nulo se
 * grava como nulo, sem inventar "Sistema".
 */
export async function PUT(request: Request) {
  const auth = await authorizeApoloWrite(request);
  if (!auth.ok) return auth.response;

  // A ordem é a mesma do GET: pedido antes de infraestrutura. Ver o aviso lá em cima. (A irmã das
  // premissas conferia o cliente ANTES do corpo até 15/09/2026, e passou a seguir esta mesma ordem
  // no mesmo dia — as duas rotas concordam hoje: auth → pedido → infraestrutura → validação.)
  //
  // ⚠️ O `try/catch` SUBSTITUIU O `.json().catch(() => null)`, e não é só alinhamento com a irmã. O
  // `catch(() => null)` confunde dois casos: "o corpo não é JSON" e "o corpo é o JSON `null`" — que
  // é JSON válido. Pior: um corpo como `"texto"` ou `[]` passa pelo `!corpo`, e a primeira leitura
  // de propriedade num `null` viraria um 500 sem rastro. Aqui o que não é OBJETO é recusado com a
  // mesma frase, antes de qualquer `corpo.campo`.
  let corpo: CorpoDaPosse;
  try {
    const lido: unknown = await request.json();
    if (lido === null || typeof lido !== "object" || Array.isArray(lido)) {
      return NextResponse.json({ error: "Corpo inválido." }, { status: 400 });
    }
    corpo = lido as CorpoDaPosse;
  } catch {
    return NextResponse.json({ error: "Corpo inválido." }, { status: 400 });
  }

  const admin = createApoloAdminClient();
  if (!admin) {
    return NextResponse.json({ error: "Supabase indisponível." }, { status: 503 });
  }

  const erros: ErroDePosse[] = [];

  // ⚠️ A RECUSA VEM ANTES DE TUDO. Deixar `vendaId` passar e só não gravá-lo seria pior do que
  // recusar: quem chamou acharia que registrou a posse da venda do Panteon e teria registrado a de
  // um contrato do C2X com o mesmo número.
  if (veioPreenchido(corpo.vendaId)) {
    erros.push({
      campo: "vendaId",
      mensagem:
        "Esta rota registra a posse de contrato do C2X. Venda nascida no Panteon tem caminho próprio.",
    });
  }

  const contrato = idPlausivel(corpo.contratoC2xId);
  if (contrato === null) {
    erros.push({
      campo: "contratoC2xId",
      mensagem: "Informe a qual contrato esta posse pertence.",
    });
  }

  // ⚠️ RETRATO INVÁLIDO É ERRO, NÃO CAMPO DESCARTADO. `unidade_c2x_id` e `enterprise_id` só servem
  // para filtrar ("quais lotes deste empreendimento têm posse?"); engolir um valor quebrado faria a
  // linha sumir desse filtro para sempre, e ninguém procura o que nunca apareceu.
  const unidade = idPlausivel(corpo.unidadeC2xId);
  if (veioPreenchido(corpo.unidadeC2xId) && unidade === null) {
    erros.push({ campo: "unidadeC2xId", mensagem: "Unidade inválida." });
  }

  // A MESMA régua da tela, de novo — ver o aviso em `conferirPosse`. O teto ("posse no futuro") é
  // conferido aqui porque o Postgres não aceita `current_date` num CHECK.
  erros.push(
    ...conferirPosse({
      dataDaPosse: corpo.dataDaPosse,
      observacao: corpo.observacao,
      origem: corpo.origem,
    }),
  );

  // ⚠️ 422 COM `error` E `erros` — EXATAMENTE O ENVELOPE DA ROTA IRMÃ. Ver o aviso no cabeçalho: a
  // tela do Apolo lê `corpo.error` e só ele, então um 400 com apenas `erros` transformava as frases
  // certas ("a posse não pode estar no futuro", "31 de fevereiro não existe") em "Não foi possível
  // salvar." `erros` continua indo junto, porque é ele que diz QUAL campo pintar de vermelho.
  if (erros.length > 0 || contrato === null) {
    return NextResponse.json(
      { error: "Confira os dados da posse antes de salvar.", erros },
      { status: 422 },
    );
  }

  const agora = new Date().toISOString();

  // O FATO em si: é o que o operador acabou de escolher, e é sempre reescrito por inteiro — inclusive
  // a autoria, pelo motivo explicado no cabeçalho desta função.
  const valoresDoFato = {
    atualizado_em: agora,
    data_da_posse: String(corpo.dataDaPosse ?? "").trim(),
    observacao: String(corpo.observacao ?? "").trim() || null,
    origem: String(corpo.origem ?? "").trim(),
    registrado_em: agora,
    registrado_por: auth.userId,
    registrado_por_nome: auth.nome,
  };

  // ⚠️ O RETRATO SÓ ENTRA NO PAYLOAD SE VEIO NO CORPO — é aqui que mora o conserto de 15/09/2026
  // descrito no cabeçalho. Chave ausente do objeto significa "não mexa nesta coluna": o PostgREST só
  // escreve o que recebe, então o UPDATE preserva o que já estava gravado e o INSERT deixa a coluna
  // no default (null), que é o mesmo valor que o corpo sem retrato pediria. Um `enterprise_id: null`
  // explícito aqui seria a volta do defeito.
  const retrato: { enterprise_id?: string; unidade_c2x_id?: number } = {};
  if (veioPreenchido(corpo.enterpriseId)) {
    retrato.enterprise_id = String(corpo.enterpriseId).trim();
  }
  if (unidade !== null) {
    retrato.unidade_c2x_id = unidade;
  }

  const valores = { ...valoresDoFato, ...retrato };

  try {
    const { data: atual, error: erroDaLeitura } = await admin
      .from("hercules_posse")
      .select("id")
      .eq("workspace_id", WORKSPACE)
      .eq("contrato_c2x_id", contrato)
      .maybeSingle();

    if (erroDaLeitura) throw new Error(erroDaLeitura.message);

    if (atual) {
      return await respostaDoUpdate(admin, contrato, valores);
    }

    // ⚠️ `venda_id` NÃO ENTRA NEM COMO null EXPLÍCITO por acaso: é o default da coluna, e o CHECK
    // `hercules_posse_um_dono` é quem garante o dono único. Escrevê-lo aqui só abriria a porta para
    // alguém, um dia, trocar o null por um valor.
    const { data: criada, error: erroDoInsert } = await admin
      .from("hercules_posse")
      .insert({ ...valores, contrato_c2x_id: contrato, workspace_id: WORKSPACE })
      .select(COLUNAS)
      .maybeSingle();

    if (erroDoInsert) {
      // 23505 = o índice parcial pegou: alguém gravou a posse deste contrato entre a leitura e o
      // insert. Não é erro do operador — é a mesma gravação, feita na ordem inversa.
      if (erroDoInsert.code === "23505") {
        return await respostaDoUpdate(admin, contrato, valores);
      }
      throw new Error(erroDoInsert.message);
    }

    const linha = (criada ?? null) as LinhaDePosse | null;
    if (!linha) {
      throw new Error("O insert da posse não devolveu a linha gravada.");
    }

    return NextResponse.json({ data: { posse: posseParaTela(linha) } });
  } catch (erro) {
    console.error("[apolo][posse][PUT]", erro);
    return NextResponse.json({ error: "Não foi possível gravar a posse." }, { status: 500 });
  }
}

/**
 * A segunda metade do upsert.
 *
 * ⚠️ O `.select()` É A PROVA, E NÃO ENFEITE. `.update()` sem ele devolve sucesso mesmo casando ZERO
 * linhas — e zero linhas tem cenário real aqui: entre a leitura e a gravação, alguém pode ter
 * APAGADO a posse (que é operação legítima e frequente nesta tabela). Sem a conferência a tela diria
 * "salvo" sobre uma linha que não existe mais.
 *
 * ⚠️ `valores` CHEGA AQUI JÁ PODADO, e quem chama é responsável por isso. O UPDATE escreve
 * exatamente as chaves que existirem no objeto: coluna que não está nele fica como está no banco. É
 * o que impede o PUT de correção de apagar o retrato do empreendimento — ver o cabeçalho.
 */
async function respostaDoUpdate(
  admin: ClienteAdmin,
  contrato: number,
  valores: Record<string, unknown>,
) {
  const { data, error } = await admin
    .from("hercules_posse")
    .update(valores)
    .eq("workspace_id", WORKSPACE)
    .eq("contrato_c2x_id", contrato)
    .select(COLUNAS)
    .maybeSingle();

  if (error) throw new Error(error.message);

  const linha = (data ?? null) as LinhaDePosse | null;
  if (!linha) {
    return NextResponse.json(
      { error: "A posse deste contrato deixou de existir. Recarregue a tela." },
      { status: 409 },
    );
  }

  return NextResponse.json({ data: { posse: posseParaTela(linha) } });
}

/**
 * Apaga a posse do contrato — o operador cadastrou errado, ou descobriu que a posse nunca
 * aconteceu.
 *
 * ⚠️ NÃO EXISTIR JÁ É O RESULTADO PEDIDO, ENTÃO NÃO É 404. Apagar aqui não destrói história: a
 * linha guarda um fato que, nesta tabela, tem exatamente duas respostas possíveis — tem data ou não
 * tem. Quem clica em "a posse não aconteceu" quer o segundo estado, e devolver erro quando ele já é
 * o estado atual transformaria uma aba recarregada duas vezes em chamado. O corpo diz o que
 * aconteceu de verdade (`apagada`), para a tela avisar sem mentir.
 *
 * ⚠️ E O `.select("id")` É O QUE DISTINGUE OS DOIS CASOS. Sem ele o PostgREST devolve o mesmo
 * sucesso para "apaguei uma linha" e "não havia linha", e `apagada` seria um chute.
 */
export async function DELETE(request: Request) {
  const auth = await authorizeApoloWrite(request);
  if (!auth.ok) return auth.response;

  // A ordem é a mesma do GET e do PUT: pedido antes de infraestrutura. Ver o aviso no GET.
  const contrato = contratoDaUrl(request);
  if (contrato === null) {
    return NextResponse.json({ error: "Informe o contrato." }, { status: 400 });
  }

  const admin = createApoloAdminClient();
  if (!admin) {
    return NextResponse.json({ error: "Supabase indisponível." }, { status: 503 });
  }

  try {
    const { data, error } = await admin
      .from("hercules_posse")
      .delete()
      .eq("workspace_id", WORKSPACE)
      .eq("contrato_c2x_id", contrato)
      .select("id");

    if (error) throw new Error(error.message);

    const apagadas = Array.isArray(data) ? data.length : 0;
    return NextResponse.json({ data: { apagada: apagadas > 0 } });
  } catch (erro) {
    console.error("[apolo][posse][DELETE]", erro);
    return NextResponse.json({ error: "Não foi possível apagar a posse." }, { status: 500 });
  }
}
