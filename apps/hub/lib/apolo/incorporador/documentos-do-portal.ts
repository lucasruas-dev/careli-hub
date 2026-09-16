// OS DOCUMENTOS DO APOLO QUE PODEM SAIR PELO PORTAL: o filtro que roda por cima de
// `listApoloDocuments` em TODA leitura de documento de pessoa feita por sessão de portal: a lista e
// a abertura do board (`/api/incorporador/board/[id]/documentos/**`) e a aba Documentos do CRM
// (`montarDocumentos` / `abrirDocumento`, em documentos.ts).
//
// Por que existe (16/09/2026): o Cecílio vira réplica do portal comercial, *"a Cecilio quem vai
// fazer é o proprio time deles (...) eles meio que vão andar sozinhos sem o time administrativo da
// Careli"*. As rotas do board passaram a aceitar o Cecílio, e com isso uma lista que só a Careli
// via inteira ficou ao alcance de gente de fora. `listApoloDocuments` devolve TUDO o que a pessoa
// tem em `apolo_documents`, sem olhar empreendimento nem tipo, e dois vazamentos saíam por ali:
//   • o COMPROVANTE DO SERASA (`comprovante-credito`, lib/serasa/comprovante.ts) e a evidência da
//     aprovação com restrição (`aprovacao-credito-restricao`). A regra da casa é que o incorporador
//     não sabe do Serasa (crm.ts, `rotuloDaEtapa`): *"não tem por que saber que fulano foi
//     reprovado"*;
//   • a CAD EM PDF (e a PA do Prometeu) de OUTRO loteamento, quando a pessoa tem CAD em dois
//     produtos. Abrir a CAD do vizinho é saber onde o cliente dele está comprando.
//
// ⚠️ O HUB NÃO PASSA POR AQUI. `/api/apolo/documentos` continua devolvendo tudo: quem opera o Apolo
// enxerga a casa inteira por desenho. O filtro é da PORTA do portal, de qualquer tipo (o comercial
// da Gurgel também é gente de fora). As diferenças por tipo são duas: a análise de crédito, que o
// comercial continua vendo (ver `ContextoDoPortal.comercial`) e que o portal que opera sozinho vê
// só das CADs do escopo dele; e, no portal que opera sozinho, o documento pessoal sem marca, que só
// sai com a pessoa inteira no recorte, porque a ficha é compartilhada com a Careli (D5, ver
// `ContextoDoPortal.operaSozinho`).
//
// ⚠️ COMO `apolo_documents` GUARDA O EMPREENDIMENTO: não guarda. A tabela (0026) não tem coluna de
// empreendimento, e o metadata só carrega `enterpriseId` num tipo. Medido em 16/09/2026 (leitura,
// agregado por tipo): `aprovacao-credito-restricao` 10 de 10 com `metadata.enterpriseId`; `cad`
// 1.037, `pa` 128, `comprovante-credito` 801 e todos os demais tipos com ZERO marca. O
// `dossie-juridico` (14) traz `codigoVenda`, não o empreendimento. Por isso a regra abaixo tem duas
// metades: a MARCA, quando existe, manda; sem marca, o documento que é por natureza de um
// empreendimento (CAD, PA) só sai quando TODOS os empreendimentos da pessoa estão no recorte.
//
// ⚠️ LISTA E ABERTURA USAM A MESMA FUNÇÃO. A rota que abre um documento confere o id contra a
// lista FILTRADA, nunca contra a lista crua: esconder da lista e deixar abrir pelo id seria só
// esconder o botão.
import { listApoloDocuments, type ApoloDocumentItem } from "@/lib/apolo/documentos";
import { normalizarEnterpriseId } from "@/lib/apolo/esteira-cad";
import type { createApoloAdminClient } from "@/lib/apolo/server";

import { lerFamiliasDoCadastro, recorteDeLeituraDoPortal } from "./familia-no-portal";

type AdminClient = NonNullable<ReturnType<typeof createApoloAdminClient>>;

// ── O VOCABULÁRIO ───────────────────────────────────────────────────────────

/**
 * Análise de crédito. Não sai pelo portal de INCORPORADOR PADRÃO, com marca ou sem marca, dentro ou
 * fora do recorte. O comercial (a Careli vendendo) continua abrindo, como sempre abriu: ver
 * `ContextoDoPortal.comercial`. O portal que opera sozinho abre a das CADs do escopo dele: ver
 * `ContextoDoPortal.operaSozinho`.
 *
 * `comprovante-credito` é o `COMPROVANTE_DOC_TYPE` de lib/serasa/comprovante.ts;
 * `aprovacao-credito-restricao` é o que app/api/apolo/serasa/aprovar-restricao grava. Os literais
 * ficam aqui (e não importados) porque aqueles módulos puxam PDF, token e Supabase para dentro de
 * uma regra pura; o teste lê os dois arquivos e falha se a marca mudar lá sem mudar aqui.
 */
export const TIPOS_DE_CREDITO: ReadonlySet<string> = new Set([
  "aprovacao-credito-restricao",
  "comprovante-credito",
]);

/**
 * Qualquer tipo com "credito" ou "serasa" como palavra também fica de fora. É a rede para o
 * próximo documento da análise de crédito que alguém criar sem lembrar desta lista: esquecer aqui
 * vira documento escondido (alguém reclama), nunca comprovante do Serasa entregue (ninguém vê).
 */
const PALAVRA_DE_CREDITO = /(^|[-_])(credito|serasa)([-_]|$)/;

/**
 * Peças internas da Careli. O dossiê jurídico (lib/hades/dossie) leva a repartição da comissão
 * (coordenadora e imobiliária), o valor de corretagem e o score de cobrança da Careli: é a pasta
 * da cobrança e do jurídico, não documento do cliente. E não traz empreendimento, só o código da
 * venda.
 */
export const TIPOS_INTERNOS_DA_CARELI: ReadonlySet<string> = new Set(["dossie-juridico"]);

/**
 * Documentos que são, por natureza, de UM empreendimento e nascem sem a marca: a CAD em PDF
 * (lib/apolo/salvar-cad.ts, cadastro/salvar, publico/cad/salvar) e a PA do bip do Prometeu
 * (lib/prometeu/pa-para-apolo.ts). O RG, a CNH e o comprovante de endereço são da PESSOA e valem
 * para qualquer produto dela.
 */
export const TIPOS_DE_EMPREENDIMENTO: ReadonlySet<string> = new Set(["cad", "pa"]);

// ── REGRA PURA ──────────────────────────────────────────────────────────────

/** O que a regra precisa saber de cada linha de `apolo_documents`. */
export type MarcaDoDocumento = {
  documentType: null | string;
  /** `metadata.enterpriseId`, quando o documento foi gravado com ele. */
  enterpriseId: null | string;
  id: string;
};

export type ContextoDoPortal = {
  /**
   * A sessão é do portal COMERCIAL (a própria Careli vendendo, `ehPortalComercial`)?
   *
   * (16/09/2026, revisão) ⚠️ SÓ MUDA O PASSO 2, E SÓ PARA A ANÁLISE DE CRÉDITO. A regra "o
   * incorporador não sabe do Serasa" (crm.ts, `rotuloDaEtapa`) é do INCORPORADOR. O coordenador do
   * comercial move a CAD até crédito e revisão e lê o motivo da reprovação na fila; esconder dele o
   * comprovante que sempre abriu seria uma regressão sem decisão do Lucas. Ausente = false
   * (fechado): quem esquecer de passar esconde, nunca entrega.
   */
  comercial?: boolean;
  /** Os `enterprise_id` de TODAS as CADs da pessoa em `apolo_esteira` (não só as do recorte). */
  esteira: readonly string[];
  /**
   * A pessoa entrou no escopo pela porta da IMOBILIÁRIA (`cadNoEscopo(...).escopo.imobiliaria`).
   * No CRM do portal é sempre false: `pessoaNoEscopo` recusa imobiliária.
   */
  imobiliaria: boolean;
  /**
   * A sessão é do portal que OPERA SOZINHO (`portalConfeccionaContrato`, hoje só o `cecilio-rocha`)?
   *
   * (16/09/2026, crédito no portal) Decisão do Lucas: *"A Cecílio, no portal"* faz a análise de
   * crédito e o credenciamento dos clientes dela. O comprovante do Serasa e a evidência da aprovação
   * com restrição passam a sair para ela, MAS SÓ DAS CADs DO ESCOPO: a análise de crédito entra pela
   * mesma régua da CAD em PDF (passos 3 e 6 de `documentoVisivelNoPortal`), e não pela do documento
   * pessoal, que sairia para qualquer produto da pessoa.
   *
   * Não vale junto de `comercial` (o comercial já vê tudo, e a Gurgel não opera sozinha). Ausente =
   * false (fechado): a porta que ainda não passa o campo (proponentes da venda, Têmis) continua
   * escondendo o crédito, nunca entrega. O board e o CRM (documentos.ts) passam.
   *
   * (16/09/2026, D5) ⚠️ E O DOCUMENTO PESSOAL SEM MARCA PASSA A SEGUIR A RÉGUA DO PASSO 6 para ela.
   * Decisão do Lucas: o cliente que já tem ficha na Careli, cadastrado pelo portal, APROVEITA a ficha
   * (uma por pessoa), SEM devolver nada do que a Careli já tem. O RG e o comprovante de endereço que a
   * Careli guardou para a CAD de outro produto são da mesma pessoa, sem marca: sem esta régua, a
   * Cecílio os receberia só por ter cadastrado o CPF. O que o portal sobe nasce marcado com o
   * empreendimento dele e sai pelo passo 3.
   */
  operaSozinho?: boolean;
  /** Os ids que a sessão alcança (divisões e, quando cobre o grupo inteiro, o id do grupo). */
  recorte: ReadonlySet<string>;
  /** `metadata.enterpriseId` dos vínculos `empreendimento` da pessoa (pendentes e habilitados). */
  vinculos: readonly string[];
};

function tipoDe(marca: MarcaDoDocumento): string {
  return String(marca.documentType ?? "").trim().toLowerCase();
}

/**
 * Este documento pode sair pelo portal?
 *
 * Na ordem, e cada passo só fecha:
 *   1. sem a marca lida do banco: NÃO (não deu para provar nada sobre ele);
 *   2. análise de crédito (fora do comercial) ou peça interna da Careli: NÃO. A exceção é o portal
 *      que opera sozinho (`operaSozinho`): a análise de crédito dele segue adiante como documento
 *      DE EMPREENDIMENTO (passos 3 e 6), e só pela porta da CAD (pessoa com CAD na esteira, fora da
 *      porta da imobiliária). (16/09/2026, revisão do conjunto) E SÓ COM MARCA: o comprovante que o
 *      portal paga nasce marcado com o empreendimento da CAD (`metadataExtra`, consulta-servico.ts),
 *      e o sem marca é sempre da Careli (o hub não marca; 801 de 801 medidos em 16/09). Com a ficha
 *      compartilhada (D5), a inferência do passo 6 entregaria à Cecílio o Serasa que a Careli
 *      consultou para outro produto, a mesma porta que o painel de crédito fechou por autor;
 *   3. marcado com empreendimento: só se o empreendimento está no recorte;
 *   4. documento pessoal sem marca (RG, CNH, comprovante de endereço, anexo): SIM. No portal que
 *      opera sozinho (`operaSozinho`, D5 de 16/09/2026), só com a régua do passo 6: a ficha é
 *      compartilhada com a Careli, e o documento sem marca pode ter vindo de outro produto;
 *   5. CAD da IMOBILIÁRIA (ela não tem esteira; o PDF é a ficha de cadastro dela, igual para todos
 *      os produtos em que ela trabalha, medido em 16/09: 44 de 44 sem esteira): SIM;
 *   6. CAD/PA sem marca: só quando a pessoa tem empreendimento conhecido e TODOS estão no recorte.
 *
 * ⚠️ O PASSO 6 É INFERÊNCIA, E ELA SÓ ABRE QUANDO NÃO HÁ DÚVIDA. Com CAD em um produto só (medido
 * em 16/09: 981 das 993 CADs de pessoa, e as 128 PAs), o PDF sem marca só pode ser daquele produto.
 * Com CAD em dois produtos, o PDF sem marca pode ser de qualquer um dos dois: some para os dois
 * portais até o documento ser gravado com `metadata.enterpriseId`. Os vínculos entram na conta
 * porque a mesclagem de fichas (0079) leva os documentos junto e pode deixar só o vínculo como
 * rastro do produto antigo; mais empreendimentos na conta só fecham mais.
 */
export function documentoVisivelNoPortal(
  marca: MarcaDoDocumento | undefined,
  contexto: ContextoDoPortal,
): boolean {
  if (!marca) return false;

  const tipo = tipoDe(marca);
  const deCredito = TIPOS_DE_CREDITO.has(tipo) || PALAVRA_DE_CREDITO.test(tipo);
  // O crédito que sai pelo portal que opera sozinho: só pela régua da CAD, logo abaixo. O comercial
  // não entra aqui (ele segue abrindo como sempre abriu).
  const creditoDaCad = deCredito && contexto.comercial !== true && contexto.operaSozinho === true;
  if (deCredito && contexto.comercial !== true && !creditoDaCad) return false;
  if (TIPOS_INTERNOS_DA_CARELI.has(tipo)) return false;

  if (creditoDaCad) {
    // "Das CADs no escopo": entrar pela porta da imobiliária não prova CAD nenhuma, e pessoa sem CAD
    // na esteira não tem análise de crédito deste produto para mostrar.
    const cads = contexto.esteira.map((id) => normalizarEnterpriseId(id)).filter((id) => id !== null);
    if (contexto.imobiliaria || cads.length === 0) return false;
    // (16/09/2026, revisão do conjunto) Sem marca, a análise é da Careli (ver o passo 2 acima): fora.
    if (!normalizarEnterpriseId(marca.enterpriseId)) return false;
  }

  const marcado = normalizarEnterpriseId(marca.enterpriseId);
  if (marcado) return contexto.recorte.has(marcado);

  // O documento pessoal sem marca sai; o crédito sem marca, não: ele desce para o passo 6.
  //
  // (16/09/2026, D5) No portal que opera sozinho o pessoal sem marca também desce para o passo 6. A
  // ficha de quem já era cliente da Careli é APROVEITADA pelo portal (uma ficha por pessoa), e o RG
  // guardado pela Careli para a CAD de outro produto não é do portal: só sai quando todos os
  // empreendimentos da pessoa estão no recorte. A porta da imobiliária não tem exceção aqui (fechado):
  // com vínculo em produto de fora, o documento dela fica para a Careli. O comercial e os portais
  // padrão seguem como eram.
  const pessoalSemMarca = !TIPOS_DE_EMPREENDIMENTO.has(tipo) && !creditoDaCad;
  const pessoalPelaRegua = contexto.operaSozinho === true && contexto.comercial !== true;
  if (pessoalSemMarca && !pessoalPelaRegua) return true;

  if (tipo === "cad" && contexto.imobiliaria && contexto.esteira.length === 0) return true;

  const daPessoa = new Set(
    [...contexto.esteira, ...contexto.vinculos]
      .map((id) => normalizarEnterpriseId(id))
      .filter((id): id is string => id !== null),
  );
  if (daPessoa.size === 0) return false;
  for (const id of daPessoa) {
    if (!contexto.recorte.has(id)) return false;
  }
  return true;
}

/**
 * A lista de `listApoloDocuments` reduzida ao que o portal pode ver, no MESMO formato.
 *
 * ⚠️ `uploadedBy` SAI NULO. Ele é o `metadata.uploadedByName`, e a rota do hub grava ali o
 * `display_name` OU O E-MAIL de quem anexou (app/api/apolo/documentos); o comprovante, a CAD
 * automática e o dossiê gravam o nome do operador. É a equipe da Careli identificada para gente de
 * fora, a mesma regra do histórico e dos analistas. O Board não lê o campo (o `DocItem` da tela
 * usa tipo, nome, arquivo e id), então nada some da tela.
 *
 * (16/09/2026, D4 do Lucas) ⚠️ O COMERCIAL (a Gurgel) VOLTA A RECEBER O NOME. A decisão devolveu a ela
 * os nomes dos analistas da Careli como antes da onda 1; quem anexou o documento é a mesma informação.
 * Só o portal que não é o comercial recebe o campo nulo.
 */
export function filtrarDocumentosParaPortal(
  documentos: readonly ApoloDocumentItem[],
  marcas: readonly MarcaDoDocumento[],
  contexto: ContextoDoPortal,
): ApoloDocumentItem[] {
  const marcaPorId = new Map(marcas.map((marca) => [marca.id, marca]));
  return documentos
    .filter((documento) => documentoVisivelNoPortal(marcaPorId.get(documento.id), contexto))
    .map((documento) => ({
      ...documento,
      uploadedBy: contexto.comercial === true ? documento.uploadedBy : null,
    }));
}

// ── LEITURAS ────────────────────────────────────────────────────────────────

/**
 * As marcas dos documentos da pessoa: tipo e `metadata.enterpriseId`, sem trazer o resto do
 * metadata. Mesma ordem e mesmo teto de `listApoloDocuments`, para as duas leituras cobrirem as
 * mesmas linhas; um documento que chegue entre uma e outra fica sem marca e não sai (passo 1).
 *
 * ⚠️ ERRO LANÇA. Devolver lista vazia aqui esconderia tudo, o que até é seguro, mas silencioso: a
 * rota responde erro e a tela diz que não carregou.
 */
export async function lerMarcasDosDocumentos(
  admin: AdminClient,
  entityId: string,
): Promise<MarcaDoDocumento[]> {
  const { data, error } = await admin
    .from("apolo_documents")
    .select("id, document_type, enterpriseId:metadata->>enterpriseId")
    .eq("entity_id", entityId)
    .order("created_at", { ascending: false })
    .limit(500);
  if (error) throw new Error(error.message);

  return ((data ?? []) as unknown as Array<{
    document_type: null | string;
    enterpriseId: null | string;
    id: string;
  }>).map((linha) => ({
    documentType: linha.document_type,
    enterpriseId: linha.enterpriseId,
    id: linha.id,
  }));
}

/**
 * Os empreendimentos que a PESSOA tem no Apolo, em TODOS os produtos: as CADs (`apolo_esteira`) e
 * os vínculos `empreendimento`. Sem recorte de propósito: a pergunta do passo 6 é justamente "ela
 * tem CAD em algum lugar que este portal não alcança?".
 */
export async function lerEmpreendimentosDaPessoa(
  admin: AdminClient,
  entityId: string,
): Promise<Pick<ContextoDoPortal, "esteira" | "vinculos">> {
  const [esteira, vinculos] = await Promise.all([
    admin.from("apolo_esteira").select("enterprise_id").eq("entity_id", entityId).limit(200),
    admin
      .from("apolo_relationships")
      .select("enterpriseId:metadata->>enterpriseId")
      .eq("entity_id", entityId)
      .eq("relationship_type", "empreendimento")
      .limit(500),
  ]);
  if (esteira.error) throw new Error(esteira.error.message);
  if (vinculos.error) throw new Error(vinculos.error.message);

  const ids = (linhas: unknown, campo: "enterpriseId" | "enterprise_id"): string[] =>
    ((linhas ?? []) as Array<Record<string, unknown>>)
      .map((linha) => normalizarEnterpriseId(linha[campo]))
      .filter((id): id is string => id !== null);

  return {
    esteira: ids(esteira.data, "enterprise_id"),
    vinculos: ids(vinculos.data, "enterpriseId"),
  };
}

/**
 * A leitura de documentos do Apolo para QUALQUER porta do portal: `listApoloDocuments` (a peça
 * canônica, intocada) filtrada por `filtrarDocumentosParaPortal`. Lança quando uma das leituras
 * de apoio falha: sem marca não há como provar o que pode sair.
 *
 * (16/09/2026, revisão) ⚠️ O RECORTE GANHA O ESPELHO DO PAI (`recorteComEspelhoDoPai`). As CADs do
 * Vale do Ouro moram no 35 (VLO), que não está em `idsDaSessao` de quem alcança só uma divisão: a
 * sessão do cer (37) ou do valedoouro (36) nunca tinha o 35, e a CAD e a PA do próprio comprador
 * sumiam do CRM (688 CADs no 35, das quais 540 pessoas são clientes do C2X). A pessoa já provou estar
 * no escopo pela outra porta; o espelho do pai é o mesmo loteamento. Irmão de outro dono continua
 * fora (o 36 não entra para quem tem o 37).
 */
export async function documentosDoApoloParaPortal(
  admin: AdminClient,
  entityId: string,
  contexto: Pick<ContextoDoPortal, "comercial" | "imobiliaria" | "operaSozinho" | "recorte">,
): Promise<ApoloDocumentItem[]> {
  const [documentos, marcas, daPessoa, familias] = await Promise.all([
    listApoloDocuments(admin, "entidade", entityId),
    lerMarcasDosDocumentos(admin, entityId),
    lerEmpreendimentosDaPessoa(admin, entityId),
    lerFamiliasDoCadastro(admin),
  ]);

  return filtrarDocumentosParaPortal(documentos, marcas, {
    ...contexto,
    ...daPessoa,
    // (16/09/2026, revisão do conjunto) No portal que opera sozinho o espelho do pai só entra com CAD
    // ou vínculo da pessoa numa divisão do recorte (ver `recorteDeLeituraDoPortal`).
    recorte: recorteDeLeituraDoPortal({
      cadastro: familias,
      daPessoa,
      operaSozinho: contexto.operaSozinho === true && contexto.comercial !== true,
      recorte: contexto.recorte,
    }),
  });
}
