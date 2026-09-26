import { NextResponse } from "next/server";

import { catalogoDeEmpreendimentos } from "@/lib/apolo/catalogo-empreendimentos";
import { autorizarOperacaoDeVenda } from "@/lib/apolo/incorporador/board-do-portal";
import { idsDaSessao } from "@/lib/apolo/incorporador/escopo";
import {
  type EscopoDaEsteiraDoPortal,
  escopoDaEsteiraDoPortal,
} from "@/lib/apolo/incorporador/familia-no-portal";
import { ehPortalComercial } from "@/lib/apolo/incorporador/perfis-de-portal";
import { createApoloAdminClient, hashIdentifier } from "@/lib/apolo/server";
import {
  type CandidatoDaBase,
  casa,
  MAXIMO_DE_CANDIDATOS,
  ordenar,
  type ProponenteEncontrado,
  type TermoDaBusca,
  termoDaBusca,
} from "@/lib/hercules/busca-de-proponente";
import { carregarCadastroDeEmpreendimentos } from "@/lib/hercules/cadastro";
import { decidirPelasLinhas, type LinhaDaEsteira } from "@/lib/hercules/cliente-credenciado";
import {
  type CompraAtiva,
  compraDaPessoa,
  compradoresDoContrato,
  contratoAtivoNoEscopo,
  entidadesDosCpfs,
  entidadesDosUsuariosDoC2x,
  escolherEntidadeDoContrato,
  type LinhaDoContrato,
  lerContratosAtivos,
} from "@/lib/hercules/compra-ativa";

// A BUSCA DE PROPONENTE — quem pode entrar na proposta junto com o titular.
//
// Lucas (05/09/2026), digitando o nome de um proponente na modal: *"os demais proponentes têm que
// ser buscados; eu digitei o nome da Larissa, deveria puxar a CAD dela caso a mesma tenha uma CAD
// credenciada (nome, CPF); se não estiver credenciada, fala que CAD não encontrada"*.
//
// ⚠️ DIGITAR CRIAVA UMA PESSOA QUE NÃO EXISTE. O campo antigo aceitava qualquer nome com qualquer
// CPF válido — bastava o dígito verificador fechar. Quem escrevesse "Larissa Fontes" com um CPF
// certo criava um comprador que o Apolo nunca viu: sem CAD, sem crédito analisado, sem entidade — e
// ele entrava no PDF, na minuta e no contrato como se fosse cadastrado. A régua do titular era dura
// (CAD credenciada no empreendimento) e a do segundo comprador não existia, no MESMO papel.
//
// ⚠️ A DECISÃO É A MESMA DO TITULAR, e literalmente a mesma função: `decidirPelasLinhas`, extraída
// de `credenciadoParaVender` justamente para isto. Uma segunda régua "parecida" aqui liberaria, no
// mesmo empreendimento e no mesmo dia, quem a primeira barra.
//
// ⚠️ A BUSCA É DENTRO DO ESCOPO, e isso é privacidade, não preguiça. Procurar na base inteira do
// Apolo devolveria nome e CPF de qualquer pessoa da casa para qualquer corretor com acesso ao
// portal. Aqui só aparece quem tem CAD NESTE empreendimento (ou na família dele) — o mesmo recorte
// que a tela Venda já lê para contar o funil.
//
// (26/09/2026) ⚠️ O COMPRADOR DA CARTEIRA TAMBÉM APARECE, pela MESMA régua do titular: quem não tem
// CAD no escopo, mas é comprador (titular ou co) de contrato ativo numa unidade da família, entra na
// lista como credenciado, com `origem: "comprador_da_carteira"`. O recorte de privacidade é o
// mesmo: os contratos lidos são os das unidades dos ids ABERTOS; os do espelho do pai só entram com
// o CPF inteiro, e só o daquele CPF. A decisão é por PESSOA (todas as entidades do CPF), como a do
// titular: uma CAD em revisão numa entidade qualquer da pessoa continua barrando.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const WORKSPACE = "careli";

/** Teto da leitura da esteira. A família de um empreendimento tem centenas, não milhares. */
const TETO_DA_ESTEIRA = 2000;

export async function GET(request: Request) {
  const auth = autorizarOperacaoDeVenda(request);
  if (!auth.ok) return auth.response;

  const admin = createApoloAdminClient();
  if (!admin) {
    return NextResponse.json({ error: "Configuração indisponível." }, { status: 503 });
  }

  const url = new URL(request.url);
  const unidadeId = (url.searchParams.get("unidade") ?? "").trim();
  const termo = termoDaBusca(url.searchParams.get("q") ?? "");

  if (!unidadeId) {
    return NextResponse.json({ error: "Informe a unidade." }, { status: 400 });
  }

  // ⚠️ TERMO CURTO NÃO É ERRO, É "AINDA NÃO". A tela busca a cada tecla; responder 400 faria a
  // caixa piscar vermelho enquanto a pessoa digita as duas primeiras letras.
  if (termo.tipo === "curto") {
    return NextResponse.json({ data: { encontrados: [], termoCurto: true } });
  }

  try {
    const permitidos = new Set(await idsDaSessao(auth.sessao));

    const { data: linhaDaUnidade } = await admin
      .from("hercules_unidades")
      .select("id,enterprise_id")
      .eq("workspace_id", WORKSPACE)
      .eq("id", unidadeId)
      .maybeSingle();

    const unidade = linhaDaUnidade as null | { enterprise_id: string; id: string };
    if (!unidade || !permitidos.has(String(unidade.enterprise_id))) {
      return NextResponse.json({ error: "Unidade não encontrada." }, { status: 404 });
    }

    // O MESMO escopo expandido do portão do titular: família (pai e filhos) mais o `group:` que as
    // divisões cobrem. Sem a expansão, uma CAD gravada no grupo some da busca.
    //
    // (16/09/2026, revisão da onda do Cecílio) ⚠️ FORA DO COMERCIAL A FAMÍLIA É RECORTADA PELA
    // SESSÃO (`escopoDaEsteiraDoPortal`). A família do VOC (37) é 35 + 36 + 37 + 41, e o 36 é a
    // carteira do Lino: sem o recorte, varrer prefixos de CPF levava nome, CPF e etapa de qualquer
    // comprador do Vale do Ouro para o time do Cecílio. O espelho do pai (35), onde mora a CAD do
    // próprio cliente do VOC, só abre gente nova quando o termo é o CPF INTEIRO. O comercial segue
    // exatamente como antes.
    const [cadastro, catalogo] = await Promise.all([
      carregarCadastroDeEmpreendimentos(),
      catalogoDeEmpreendimentos(Date.now()),
    ]);
    const escopo = escopoDaEsteiraDoPortal({
      c2xId: String(unidade.enterprise_id),
      cadastro,
      catalogo,
      comercial: ehPortalComercial(auth.sessao.tipo),
      permitidos,
    });
    const cpfInteiro = termo.tipo === "cpf" && termo.digitos.length === 11;

    if (escopo.abertos.length === 0 && !(cpfInteiro && escopo.soComCpfInteiro.length > 0)) {
      return NextResponse.json({ data: { encontrados: [] } });
    }

    const linhasAbertas =
      escopo.abertos.length > 0 ? await lerEsteira(admin, { enterpriseIds: escopo.abertos }) : [];

    // Quem o CPF inteiro alcança no espelho do pai. Só existe fora do comercial (para ele
    // `soComCpfInteiro` é sempre vazio) e só com os onze dígitos: é confirmação, não lista.
    const doCpf =
      termo.tipo === "cpf" && cpfInteiro && escopo.soComCpfInteiro.length > 0
        ? new Set(await entidadesDoCpf(admin, termo.digitos))
        : new Set<string>();

    // Os compradores da carteira que casam com o termo, já na entidade do contrato de cada um.
    const carteira = await compradoresDaCarteira(admin, { cpfInteiro, escopo, termo });

    const entityIds = [
      ...new Set([...linhasAbertas.map((l) => l.entity_id), ...doCpf, ...carteira.keys()]),
    ];
    if (entityIds.length === 0) {
      return NextResponse.json({ data: { encontrados: [] } });
    }

    // ⚠️ O FILTRO POR NOME/CPF ACONTECE AQUI, e não no `.in()`: são centenas de pessoas, e a régua
    // de casamento (sem acento, palavras em qualquer ordem, CPF por prefixo) é a mesma que o teste
    // guarda. Empurrá-la para o PostgREST significaria escrevê-la duas vezes, em duas linguagens.
    // Em lotes de 100: `.in()` com centenas de uuids estoura a URL do PostgREST.
    const entidades: Array<{
      display_name: null | string;
      document_masked: null | string;
      id: string;
      legal_name: null | string;
      trade_name: null | string;
    }> = [];
    for (const lote of emLotes(entityIds, LOTE)) {
      const { data, error: erroDasEntidades } = await admin
        .from("apolo_entities")
        .select("id, display_name, legal_name, trade_name, document_masked")
        .in("id", lote);
      if (erroDasEntidades) throw new Error(erroDasEntidades.message);
      entidades.push(...((data ?? []) as typeof entidades));
    }

    const candidatos: CandidatoDaBase[] = entidades.map((e) => ({
      documento: e.document_masked,
      id: e.id,
      nome: (e.display_name || e.legal_name || e.trade_name || "").trim() || null,
    }));

    // Para quem veio do espelho, o hash do CPF já é a prova do casamento: o `document_masked` de
    // quem nasceu no Apolo pode estar mascarado, e o prefixo não casaria. O comprador da carteira
    // já casou pelo que o CONTRATO diz (nome e CPF do comprador), e é a entidade do contrato que
    // aparece.
    const casados = candidatos.filter((c) => casa(c, termo) || doCpf.has(c.id) || carteira.has(c.id));

    // A DECISÃO olha as mesmas CADs que o titular olha (abertos + espelho), mas só de quem já casou.
    // Sem isto, quem tem CAD nova no 37 e a credenciada no 35 sairia "não credenciado" pelo nome e
    // "credenciado" pelo CPF, e a proposta do titular diria uma terceira coisa. Para o comprador da
    // carteira entram TODAS as entidades do CPF dele, porque a régua do titular decide por pessoa.
    const idsDaDecisao = [
      ...new Set([
        ...casados.map((c) => c.id),
        ...[...carteira.values()].flatMap((v) => v.entityIdsDoCpf),
      ]),
    ];
    const linhasDoEspelho =
      escopo.soComCpfInteiro.length > 0 && casados.length > 0
        ? await lerEsteira(admin, {
            enterpriseIds: escopo.soComCpfInteiro,
            entityIds: idsDaDecisao,
          })
        : [];

    const todasAsLinhas = [...linhasAbertas, ...linhasDoEspelho];
    const idsCasados = new Set(casados.map((c) => c.id));
    const porEntidade = new Map<string, LinhaDaEsteira[]>();
    for (const l of todasAsLinhas) {
      if (!idsCasados.has(l.entity_id)) continue;
      porEntidade.set(l.entity_id, [...(porEntidade.get(l.entity_id) ?? []), l]);
    }

    const encontrados: ProponenteEncontrado[] = casados
      // Sem CAD em nenhum id do escopo, e sem contrato ativo na família, a pessoa não aparece:
      // "existe na base" não é resposta.
      .filter((c) => porEntidade.has(c.id) || carteira.has(c.id))
      .map((c) => {
        const daCarteira = carteira.get(c.id);
        // ⚠️ A MESMA FUNÇÃO DO TITULAR, com a compra no terceiro argumento: ela só vale quando a
        // PESSOA não tem CAD nenhuma no escopo. CAD em revisão numa entidade qualquer dela barra.
        const decisao = daCarteira
          ? decidirPelasLinhas(
              todasAsLinhas.filter((l) => daCarteira.entityIdsDoCpf.includes(l.entity_id)),
              [c.id],
              daCarteira.compra,
            )
          : decidirPelasLinhas(porEntidade.get(c.id) ?? [], [c.id]);
        return {
          credenciado: decisao.credenciado,
          cpf: c.documento ?? "",
          etapa: decisao.etapa,
          id: c.id,
          motivo: decisao.motivo,
          nome: c.nome ?? "—",
          origem: decisao.origem,
        };
      })
      .sort(ordenar)
      .slice(0, MAXIMO_DE_CANDIDATOS);

    return NextResponse.json({ data: { encontrados } });
  } catch (erro) {
    console.error("[hercules][proponentes] falha ao buscar", erro);
    return NextResponse.json({ error: "Não foi possível buscar agora." }, { status: 503 });
  }
}

type AdminClient = NonNullable<ReturnType<typeof createApoloAdminClient>>;

/** Lote do `.in()` por URL: a memória do projeto registra 100 como o teto seguro do PostgREST. */
const LOTE = 100;

function emLotes<T>(lista: readonly T[], tamanho: number): T[][] {
  const lotes: T[][] = [];
  for (let i = 0; i < lista.length; i += tamanho) lotes.push(lista.slice(i, i + tamanho));
  return lotes;
}

/**
 * As linhas da esteira nestes empreendimentos, opcionalmente só destas pessoas.
 *
 * Sem pessoas: o teto de sempre (a família de um empreendimento tem centenas, não milhares). Com
 * pessoas: em lotes de 100, pelo mesmo limite de URL do `.in()`.
 */
async function lerEsteira(
  admin: AdminClient,
  filtro: { enterpriseIds: string[]; entityIds?: string[] },
): Promise<LinhaDaEsteira[]> {
  const COLUNAS = "atualizado_em, chegou_em, created_at, enterprise_id, entity_id, etapa, origem";
  if (!filtro.entityIds) {
    const { data, error } = await admin
      .from("apolo_esteira")
      .select(COLUNAS)
      .in("enterprise_id", filtro.enterpriseIds)
      .limit(TETO_DA_ESTEIRA);
    if (error) throw new Error(error.message);
    return (data ?? []) as LinhaDaEsteira[];
  }

  const saida: LinhaDaEsteira[] = [];
  for (const lote of emLotes(filtro.entityIds, LOTE)) {
    const { data, error } = await admin
      .from("apolo_esteira")
      .select(COLUNAS)
      .in("enterprise_id", filtro.enterpriseIds)
      .in("entity_id", lote);
    if (error) throw new Error(error.message);
    saida.push(...((data ?? []) as LinhaDaEsteira[]));
  }
  return saida;
}

/**
 * As entidades que carregam este CPF, pelas DUAS fontes do documento (a coluna de quem nasceu no
 * Apolo e os identificadores de quem veio do sync do C2X), a mesma leitura de
 * `credenciadoParaVender`. O tipo do documento já está dentro do hash.
 */
async function entidadesDoCpf(admin: AdminClient, digitos: string): Promise<string[]> {
  const hash = hashIdentifier("cpf", digitos);
  const [porColuna, porIdentificador] = await Promise.all([
    admin.from("apolo_entities").select("id").eq("document_hash", hash).limit(20),
    admin.from("apolo_entity_identifiers").select("entity_id").eq("value_hash", hash).limit(20),
  ]);
  if (porColuna.error) throw new Error(porColuna.error.message);
  if (porIdentificador.error) throw new Error(porIdentificador.error.message);

  const ids = new Set<string>();
  for (const linha of (porColuna.data ?? []) as Array<{ id: null | string }>) {
    if (linha.id) ids.add(linha.id);
  }
  for (const linha of (porIdentificador.data ?? []) as Array<{ entity_id: null | string }>) {
    if (linha.entity_id) ids.add(linha.entity_id);
  }
  return [...ids];
}

/** Quantas pessoas da carteira seguem para a resolução de entidade. A tela recebe só oito. */
const MAXIMO_DA_CARTEIRA = 40;

type CompradorDaCarteira = { compra: CompraAtiva; entityIdsDoCpf: string[] };

/**
 * Os compradores (titular e co) de contratos ativos na família que casam com o termo, por entidade
 * do contrato.
 *
 * ⚠️ O MESMO RECORTE DA ESTEIRA. Nome e pedaço de CPF só olham os contratos das unidades dos ids
 * ABERTOS; os do espelho do pai só entram com o CPF inteiro, e só o daquele CPF. O irmão de outro
 * dono (o 36 do Lino) nunca é lido.
 *
 * ⚠️ O CASAMENTO É PELO QUE O CONTRATO DIZ (nome e CPF gravados no comprador), antes de ir ao banco
 * atrás de entidade: só quem casou custa leitura de `apolo_entities` e `apolo_source_links`.
 */
async function compradoresDaCarteira(
  admin: AdminClient,
  entrada: { cpfInteiro: boolean; escopo: EscopoDaEsteiraDoPortal; termo: TermoDaBusca },
): Promise<Map<string, CompradorDaCarteira>> {
  const { cpfInteiro, escopo, termo } = entrada;
  const saida = new Map<string, CompradorDaCarteira>();
  if (termo.tipo === "curto") return saida;

  const cpfDoTermo = cpfInteiro && termo.tipo === "cpf" ? termo.digitos : null;
  const doEspelho = cpfDoTermo ? escopo.soComCpfInteiro : [];
  if (escopo.abertos.length === 0 && doEspelho.length === 0) return saida;

  const [contratosAbertos, contratosDoEspelho] = await Promise.all([
    escopo.abertos.length > 0 ? lerContratosAtivos(admin, escopo.abertos) : ([] as LinhaDoContrato[]),
    doEspelho.length > 0 ? lerContratosAtivos(admin, doEspelho) : ([] as LinhaDoContrato[]),
  ]);

  const abertos = new Set(escopo.abertos);
  const nomes = new Map<string, string>();
  for (const linha of contratosAbertos) {
    if (!contratoAtivoNoEscopo(linha, abertos)) continue;
    for (const c of compradoresDoContrato(linha)) {
      if (c.cpf.length !== 11) continue;
      if (casa({ documento: c.cpf, id: c.cpf, nome: c.nome }, termo)) {
        nomes.set(c.cpf, c.nome ?? "");
      }
    }
  }
  if (cpfDoTermo && !nomes.has(cpfDoTermo)) {
    const noEspelho = new Set(doEspelho);
    const achou = contratosDoEspelho.some(
      (l) => contratoAtivoNoEscopo(l, noEspelho) && compradoresDoContrato(l).some((c) => c.cpf === cpfDoTermo),
    );
    if (achou) nomes.set(cpfDoTermo, "");
  }
  if (nomes.size === 0) return saida;

  const todos = [...contratosAbertos, ...contratosDoEspelho];
  const compras = new Map<string, CompraAtiva>();
  const cpfs = [...nomes.keys()]
    .sort((a, b) => (nomes.get(a) ?? "").localeCompare(nomes.get(b) ?? "", "pt-BR") || a.localeCompare(b))
    .slice(0, MAXIMO_DA_CARTEIRA);
  for (const cpf of cpfs) {
    const escopoDaPessoa = cpf === cpfDoTermo ? [...escopo.abertos, ...doEspelho] : escopo.abertos;
    const compra = compraDaPessoa(todos, { cpf, entityIds: [], escopo: escopoDaPessoa });
    if (compra) compras.set(cpf, compra);
  }
  if (compras.size === 0) return saida;

  const [entidades, ligadas] = await Promise.all([
    entidadesDosCpfs(admin, [...compras.keys()]),
    entidadesDosUsuariosDoC2x(
      admin,
      [...compras.values()].map((c) => c.c2xUserId ?? "").filter(Boolean),
    ),
  ]);

  for (const [cpf, compra] of compras) {
    const ids = entidades.get(cpf) ?? [];
    // Sem entidade no Apolo não há quem adicionar: a tela escolhe uma entidade, não um CPF solto.
    if (ids.length === 0) continue;
    const ligada = compra.c2xUserId ? (ligadas.get(compra.c2xUserId) ?? null) : null;
    const entityId = escolherEntidadeDoContrato(compra, ids, ligada);
    if (!entityId || saida.has(entityId)) continue;
    saida.set(entityId, { compra: { ...compra, entityIdDoContrato: entityId }, entityIdsDoCpf: ids });
  }
  return saida;
}
