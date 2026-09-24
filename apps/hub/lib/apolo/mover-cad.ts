// MOVER A CAD DE EMPREENDIMENTO: a ação que faltava no Apolo (24/09/2026).
//
// O CASO REAL: a CAD do JONATAS nasceu no VEREDAS DO OURO (19) quando era do VALE DO OURO (35). O time
// fez o que a tela ensinava ("exclui o antigo e adiciona o novo") e trocou só o VÍNCULO de
// empreendimento (apolo_relationships). A CAD (apolo_esteira, chave entity_id + enterprise_id) ficou
// no 19. O card mostrou "Vale do Ouro" e agiu no 19: o crédito leu a configuração do Veredas (análise
// desligada) e credenciou sem Serasa, o aviso de credenciado foi para o coordenador do Veredas, e o
// coordenador do Vale do Ouro não via o cliente no CRM. Não existia no Apolo nenhuma ação que movesse
// a CAD. Esta é ela, e o "Excluir" do vínculo da CAD passa a apontar para cá (relationships/archive).
//
// ⚠️ A REGRA DA ETAPA É DO LUCAS (24/09/2026), com as palavras dele:
//   *"Validação não precisa pois já foi feita, a ideia é se o empreendimento a qual está sendo
//   vinculado tiver análise de crédito e essa cad não tem uma análise feita recentemente tem que ir
//   para análise para fazer"* e *"se já foi feito (o empreendimento errado também exigia) é só validar
//   os valores e apontar se passou ou não"*. Traduzida em `planejarEtapaDoMover`.
//
// ⚠️ AS ESCRITAS, NA ORDEM QUE DEIXA MENOS ESTRAGO SE ALGUMA FALHAR NO MEIO:
//   0. TODA leitura e toda decisão (destino, se ele recebe CAD, nome, crédito) ANTES de escrever
//      qualquer coisa. Falhou leitura: 503 e nada mudou.
//   1. A LINHA DA ESTEIRA muda de empreendimento. É a CHAVE: a partir daqui CRM, Board, crédito e
//      aviso ao coordenador enxergam o produto certo. Se falhar, nada mudou (409/503).
//      ⚠️ E O REBAIXAMENTO DA ETAPA VAI NO MESMO UPDATE (revisão de 24/09/2026, D2 do Zeus). Na
//      primeira versão a descida para crédito ou revisão era um passo separado, depois da troca; se
//      ele falhasse, a CAD ficava CREDENCIADA no destino sem análise, que é exatamente o estado do
//      Jonatas, agora criado pela ferramenta que devia consertá-lo. No mesmo UPDATE, ou a CAD chega no
//      destino já na análise, ou não sai da origem. SUBIR (crédito aprovado no limite do destino)
//      continua pelo ponto autoritativo, no passo 4: se falhar, a CAD fica onde estava (crédito ou
//      revisão) no destino, que é o lado seguro, e a resposta diz isso.
//   2. VÍNCULOS: primeiro CRIA o do destino, só depois ARQUIVA o de origem. Se a criação falhar, a
//      origem NÃO é arquivada: um vínculo a mais é inofensivo, e arquivar o antigo sem o novo deixaria
//      a pessoa sem vínculo do produto em que a CAD mora. ⚠️ Entidade com perfil IMOBILIÁRIA: nenhum
//      vínculo de empreendimento é criado nem arquivado (para ela, o vínculo é a habilitação; ver o passo).
//   3. DOCUMENTOS DA PESSOA marcados com a origem passam a marcar o destino, MENOS os PDFs de CAD e o
//      crédito (ver o passo, D3 do Zeus).
//   4. ETAPA E AVISO: subir pelo ponto autoritativo (`atualizarEtapa`); fila do lançamento e aviso ao
//      corretor e ao coordenador DO DESTINO em qualquer caso, inclusive quando a etapa não muda.
//   5. PDF DA CAD regenerado no destino, com teto de tempo (toca o C2X).
//   6. LINHA DO TEMPO ('cad_movida'), por último, para registrar também o que não saiu.
// Os passos 2 a 5 são best-effort: a CAD já está no produto certo, e cada falha volta em `avisos`
// para a tela dizer o que conferir, em vez de virar 500 sobre uma troca que aconteceu.
//
// ⚠️ `incompleto` É SÓ PARA DADO (revisão de 24/09/2026, terceira rodada). Liga quando um passo que
// deixa o BANCO diferente do que devia não saiu: vínculo, documentos, etapa que devia subir. Aviso ao
// coordenador e PDF entram em `avisos`, mas NÃO ligam `incompleto`: são mensagem e papel, e o dado
// está certo. Antes os dois ligavam, e todo Mover para o group:Lagoa Bonita (code "LBF + LBR + LBP" no
// apolo_enterprise_settings, sem coordenador achado no C2X: 6 de 6 avisos de etapa ao coordenador
// falharam, medido em 24/09/2026) voltava "incompleto" para sempre, escondendo uma falha real de dado.
// `avisos` sai sem repetição.

import { garantirNaFilaDoLancamento } from "@/lib/apolo/credenciado-para-fila";
import { cnpjValido, cpfValido } from "@/lib/apolo/documento";
import { listEnterprisesRecebendo } from "@/lib/apolo/enterprise-settings";
import { atualizarEtapa, type EtapaEsteira } from "@/lib/apolo/esteira";
import { avisarEtapa, type ResultadoAvisoEtapa } from "@/lib/apolo/esteira-avisos";
import {
  type EmpreendimentoDoCadastro,
  idDeMercado,
  lerCadDaEsteira,
  lerCadsDaEsteira,
  lerEmpreendimentosDoCadastro,
  lerVinculosDeEmpreendimento,
  mesmoEmpreendimento,
  normalizarEnterpriseId,
} from "@/lib/apolo/esteira-cad";
import {
  TIPOS_DE_CREDITO,
  TIPOS_DE_EMPREENDIMENTO,
  TIPOS_INTERNOS_DA_CARELI,
} from "@/lib/apolo/incorporador/documentos-do-portal";
import { resolverAnaliseHabilitada, resolverLimiteCredito } from "@/lib/apolo/limite-credito";
import { comLimiteDeTempo, gerarESalvarCad } from "@/lib/apolo/salvar-cad";
import type { createApoloAdminClient } from "@/lib/apolo/server";
import { nomeDoEmpreendimento } from "@/lib/publico/cad/dados";
import { avaliarCredito, type Veredito } from "@/lib/serasa/avaliacao";
import { lerConfigSerasa } from "@/lib/serasa/config";
import { consultaRecenteDoDocumento } from "@/lib/serasa/consulta-servico";

type AdminClient = NonNullable<ReturnType<typeof createApoloAdminClient>>;

/** A resposta sem `NextResponse` (a rota embrulha), no mesmo molde do serviço do crédito. */
export type RespostaDoMover = { corpo: unknown; status: number };

export type CorpoDoMover = { de?: unknown; para?: unknown };

export type CreditoDoMover = {
  /** Houve consulta recente avaliada contra o limite do destino? */
  avaliado: boolean;
  /** Frase pronta para a tela (sem travessão). */
  motivo: string;
  /** `null` quando não foi avaliado. */
  passou: boolean | null;
};

/** As etapas em que o crédito já foi (ou está sendo) decidido. Antes delas, o fluxo normal decide. */
const ETAPAS_DO_CREDITO: ReadonlySet<string> = new Set([
  "credito",
  "revisao",
  "prevenda",
  "credenciado",
]);

/**
 * O nome da etapa como o Board mostra, para as frases de `avisos`. A revisão é "Crédito em revisão",
 * o rótulo da coluna do Board e da linha do resultado na tela (ROTULO_DA_ETAPA de mover-cad.tsx):
 * o mesmo bloco não pode dizer "Crédito em revisão" na linha e "Revisão" no aviso embaixo.
 */
const NOME_DA_ETAPA: Record<string, string> = {
  correcao: "Correção",
  credenciado: "Credenciado",
  credito: "Análise de crédito",
  indeferido: "Indeferido",
  prevenda: "Pré-venda",
  revisao: "Crédito em revisão",
  validacao: "Validação",
};

const nomeDaEtapa = (etapa: null | string): string =>
  (etapa && NOME_DA_ETAPA[etapa]) || "a etapa em que estava";

const ehUuid = (v: unknown): v is string =>
  typeof v === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

/** O Board pede texto sem travessão ([[feedback_sem_travessao]]); o motivo antigo pode ter. */
const semTravessao = (texto: string): string => texto.replace(/\s*[—–]\s*/g, ", ").trim();

/** Uma frase de fora (erro de outra função) no meio da nossa: sem travessão e sem o ponto final. */
const trecho = (texto: null | string | undefined): string =>
  semTravessao(texto ?? "").replace(/[.\s]+$/, "");

/**
 * Motivos de `avisarEtapa` (esteira-avisos.ts, `coordenadorDaCad`) que são CADASTRO, e não envio: o
 * que a coordenação confere para o próximo aviso sair. Chaveado pelo `trecho` do motivo (sem ponto
 * final), para a comparação não depender da pontuação de quem escreveu.
 */
const CONFERIR_NO_CADASTRO: Record<string, string> = {
  [trecho("Empreendimento sem coordenador de vendas no C2X.")]:
    "Confira o coordenador de vendas do empreendimento no C2X.",
  [trecho("Coordenador sem telefone no C2X.")]:
    "Confira o telefone do coordenador de vendas do empreendimento no C2X.",
  [trecho("Empreendimento sem sigla cadastrada no Apolo.")]:
    "Confira a sigla do empreendimento no Apolo.",
};

/**
 * A frase de quando o coordenador DO DESTINO não recebeu o aviso (revisão de 24/09/2026, terceira
 * rodada).
 *
 * ⚠️ SEM "REENVIE PELO BOARD". A frase anterior mandava reenviar, e esse reenvio não existe para a CAD
 * movida: o único reenvio de aviso de CAD no Board é o "Aviso de reprovação" (só admin, só na revisão)
 * e o de status-disparos é só para imobiliária. Pior no caso real: os avisos ao coordenador que falham
 * são, na medição de 24/09/2026, todos "Empreendimento sem coordenador de vendas no C2X.", e reenviar
 * falharia do mesmo jeito. A frase diz o que aconteceu e, quando o motivo é de cadastro, o que conferir.
 */
export function avisoDoCoordenadorQueNaoSaiu(erroDoAviso: null | string | undefined): string {
  const motivo = trecho(erroDoAviso);
  const aconteceu = `O aviso ao coordenador do novo empreendimento não saiu${motivo ? `: ${motivo}` : ""}.`;
  const conferir = motivo ? CONFERIR_NO_CADASTRO[motivo] : undefined;
  return conferir ? `${aconteceu} ${conferir}` : aconteceu;
}

const dataBr = (iso: string): string => {
  const quando = new Date(iso);
  return Number.isNaN(quando.getTime())
    ? ""
    : quando.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
};

export type PlanoDaEtapa = {
  credito: CreditoDoMover;
  /** `null` = a etapa não muda. */
  etapaAlvo: EtapaEsteira | null;
  /**
   * ONDE a etapa nova é gravada (revisão de 24/09/2026, D2 do Zeus):
   *   • `na-troca`: no MESMO UPDATE que troca o `enterprise_id`. É o REBAIXAMENTO (crédito ou
   *     revisão): a CAD nunca chega ao destino com uma etapa decidida pela régua da origem;
   *   • `depois`: por `atualizarEtapa`, com a CAD já no destino. É a PRÉ-VENDA (subir de crédito ou
   *     revisão com a consulta aprovada, ou reaplicar a pré-venda com a regra do destino), que precisa
   *     do redirecionamento para credenciado e da subida ao C2X que só o ponto autoritativo faz;
   *   • `null`: a etapa não muda.
   */
  gravacao: "depois" | "na-troca" | null;
  /** O motivo que fica na esteira (o card do Board mostra). */
  motivoDaEsteira: string;
  /**
   * Revisão -> pré-venda, quando a consulta PASSA no limite do destino. `atualizarEtapa` barra essa
   * saída sem autorização (crédito reprovado só avança pela coordenação). Aqui QUEM MOVE É A
   * COORDENAÇÃO (a rota só aceita admin/leader) e a prova é a consulta avaliada no limite do produto
   * certo: a reprovação era do limite do produto errado.
   */
  saidaDeRevisaoAutorizada: boolean;
};

const gravacaoDa = (etapaAlvo: EtapaEsteira | null): PlanoDaEtapa["gravacao"] => {
  if (!etapaAlvo) return null;
  return etapaAlvo === "credito" || etapaAlvo === "revisao" ? "na-troca" : "depois";
};

/**
 * A REGRA DA ETAPA, sem I/O (Lucas, 24/09/2026; ver o cabeçalho).
 *
 *   • CAD ANTES do crédito (validação, correção, indeferido): a etapa não muda. Quando ela chegar no
 *     crédito, o fluxo normal já aplica a configuração do destino (a CAD mora lá).
 *   • CAD no crédito, revisão, pré-venda ou credenciado:
 *       - destino SEM análise de crédito: a etapa não muda, menos a pré-venda (abaixo);
 *       - destino COM análise e consulta RECENTE do titular: avalia no limite do DESTINO. Passou:
 *         crédito/revisão vão para pré-venda (`atualizarEtapa` manda para credenciado se a pré-venda
 *         do destino está desligada); a pré-venda é reaplicada (abaixo); o credenciado fica. Não
 *         passou: revisão, com o mesmo motivo que o fluxo normal grava;
 *       - destino COM análise e SEM consulta recente: volta para a análise de crédito. Rebaixar um
 *         credenciado aqui é DE PROPÓSITO: o credenciado veio de uma régua que não era a do produto.
 *
 * ⚠️ A PRÉ-VENDA É REAPLICADA NO DESTINO (revisão de 24/09/2026, D6 do Zeus). Ela é do empreendimento
 * (a cobrança PIX, `prevenda_habilitada`): uma CAD em pré-venda levada para um produto que não cobra
 * ficaria esperando um PIX que ninguém vai pedir. Onde a CAD fica em pré-venda (consulta aprovada ou
 * destino sem análise), o plano chama `atualizarEtapa('prevenda')` no destino, que já manda para
 * credenciado quando a pré-venda dele está desligada.
 *
 * ⚠️ DECISÃO A CONFIRMAR COM O LUCAS: o CREDENCIADO NÃO VOLTA para a pré-venda quando o destino cobra
 * pré-venda (hoje, medido pela revisão em 24/09/2026, nenhum empreendimento tem pré-venda efetiva:
 * flag ligada e valor do PIX maior que zero). Fica credenciado, sem cobrança. Se o Lucas quiser a
 * cobrança, é aqui: devolver `etapaAlvo: "prevenda"` para o credenciado com a consulta aprovada.
 */
export function planejarEtapaDoMover(input: {
  analiseNoDestino: boolean;
  consulta: null | { quando: string; veredito: Veredito };
  etapaAtual: null | string;
  motivoAnterior: null | string;
  nomeAnterior: string;
  nomeNovo: string;
}): PlanoDaEtapa {
  const { analiseNoDestino, consulta, etapaAtual } = input;
  const troca = `CAD movida de ${input.nomeAnterior} para ${input.nomeNovo}.`;
  // Quando a etapa fica, o motivo antigo continua sendo o porquê dela (ex.: o que falta na correção);
  // ele vai junto, depois da troca, para o card não perder a explicação.
  const comAnterior = (texto: string) => {
    const anterior = semTravessao(input.motivoAnterior ?? "");
    return anterior ? `${texto} Motivo anterior: ${anterior}` : texto;
  };
  const plano = (
    credito: CreditoDoMover,
    etapaAlvo: EtapaEsteira | null,
    motivoDaEsteira: string,
    saidaDeRevisaoAutorizada = false,
  ): PlanoDaEtapa => ({
    credito,
    etapaAlvo,
    gravacao: gravacaoDa(etapaAlvo),
    motivoDaEsteira,
    saidaDeRevisaoAutorizada,
  });

  if (!etapaAtual || !ETAPAS_DO_CREDITO.has(etapaAtual)) {
    return plano(
      {
        avaliado: false,
        motivo:
          "A CAD ainda não passou pela análise de crédito. A regra do novo empreendimento vale quando ela chegar lá.",
        passou: null,
      },
      null,
      comAnterior(troca),
    );
  }

  const emPrevenda = etapaAtual === "prevenda";

  if (!analiseNoDestino) {
    return plano(
      {
        avaliado: false,
        motivo: emPrevenda
          ? "O novo empreendimento não faz análise de crédito. A pré-venda segue a regra do novo empreendimento."
          : "O novo empreendimento não faz análise de crédito. A etapa foi mantida.",
        passou: null,
      },
      emPrevenda ? "prevenda" : null,
      comAnterior(`${troca} O novo empreendimento não faz análise de crédito.`),
    );
  }

  if (!consulta) {
    const jaNoCredito = etapaAtual === "credito";
    const motivo = jaNoCredito
      ? "Sem consulta de crédito recente. A CAD segue na análise de crédito do novo empreendimento."
      : "Sem consulta de crédito recente. A CAD voltou para a análise de crédito do novo empreendimento.";
    return plano(
      { avaliado: false, motivo, passou: null },
      jaNoCredito ? null : "credito",
      `${troca} Sem consulta de crédito recente: vai para a análise de crédito.`,
    );
  }

  const { veredito } = consulta;
  const quando = dataBr(consulta.quando);
  const daConsulta = quando ? `Consulta de ${quando}` : "Consulta recente";

  if (veredito.aprovado) {
    return plano(
      {
        avaliado: true,
        motivo: `${daConsulta} aprovada no limite do novo empreendimento. ${veredito.motivo}`,
        passou: true,
      },
      // Crédito e revisão SOBEM; a pré-venda é reaplicada; o credenciado fica (ver a decisão acima).
      etapaAtual === "credenciado" ? null : "prevenda",
      `${troca} Crédito aprovado no limite do novo empreendimento. ${veredito.motivo}`,
      etapaAtual === "revisao",
    );
  }

  return plano(
    {
      avaliado: true,
      motivo: `${daConsulta} reprovada no limite do novo empreendimento. ${veredito.motivo}`,
      passou: false,
    },
    etapaAtual === "revisao" ? null : "revisao",
    // O MESMO motivo do fluxo normal (levarVereditoParaEsteira): é o que a coordenação lê no card
    // para decidir a aprovação com restrição.
    `Crédito reprovado. ${veredito.motivo}`,
  );
}

/**
 * O nome que vai para `apolo_esteira.empreendimento`, no padrão das CADs do destino. Vazio = não achou
 * (a ação recusa com 400: CAD sem nome de produto é o card sem rótulo).
 *
 * ⚠️ SEM NOMEAR "group:*" PELO PRÓPRIO ID (revisão de 24/09/2026, D4 do Zeus). A primeira versão
 * tinha um último recurso que transformava "group:Qualquer Coisa" em "QUALQUER COISA", e com ele um
 * corpo forjado levava a CAD para um id inventado, com nome e vínculo. O destino agora precisa estar
 * no portão de CAD (ver a ação), e o nome sai só de onde o produto existe de verdade.
 */
async function nomeDoDestino(
  client: AdminClient,
  para: string,
  cadastro: readonly EmpreendimentoDoCadastro[],
): Promise<string> {
  // 1. O nome do catálogo, pela MESMA função que o CAD público usa para gravar a esteira: é assim que
  //    691 das 692 CADs do Vale do Ouro dizem "VALE DO OURO".
  try {
    const doCatalogo = (await nomeDoEmpreendimento(client, para)).trim();
    if (doCatalogo) return doCatalogo;
  } catch {
    /* segue para as reservas */
  }

  // 2. O texto que as CADs do destino já usam (o catálogo pode estar fora do ar).
  try {
    const { data } = await client
      .from("apolo_esteira")
      .select("empreendimento")
      .eq("enterprise_id", para)
      .not("empreendimento", "is", null)
      .limit(1);
    const texto = String(
      ((data ?? []) as Array<{ empreendimento: null | string }>)[0]?.empreendimento ?? "",
    ).trim();
    if (texto) return texto;
  } catch {
    /* segue */
  }

  // 3. O nome do cadastro do Panteon, sem a sigla da divisão ("Vale do Ouro · VOC" vira "VALE DO OURO").
  const linha = cadastro.find((l) => normalizarEnterpriseId(l.c2xEnterpriseId) === para);
  const nome = (linha?.nome ?? "").split("·")[0]?.trim() ?? "";
  return nome ? nome.toLocaleUpperCase("pt-BR") : "";
}

/** A consulta recente do TITULAR desta ficha, avaliada no limite do destino. `null` = não há. */
async function consultaNoLimiteDoDestino(
  client: AdminClient,
  entityId: string,
  para: string,
  ambiente: string,
): Promise<null | { quando: string; veredito: Veredito }> {
  const { data: entidade, error } = await client
    .from("apolo_entities")
    .select("document_masked, entity_kind")
    .eq("id", entityId)
    .maybeSingle<{ document_masked: null | string; entity_kind: null | string }>();
  if (error) throw new Error(`apolo_entities: ${error.message}`);

  const documento = (entidade?.document_masked ?? "").replace(/\D/g, "");
  const documentoOk = entidade?.entity_kind === "pj" ? cnpjValido(documento) : cpfValido(documento);
  if (!documentoOk) return null;

  // A MESMA régua do reaproveitamento do serviço do crédito: janela de DIAS_REAPROVEITAMENTO, só o
  // ambiente atual (relatório de homologação não move CAD real), só o titular desta ficha.
  const consulta = await consultaRecenteDoDocumento(client, documento, {
    ambiente,
    cad: { alvo: "titular", entityId },
  });
  if (!consulta || consulta.resposta === null || consulta.resposta === undefined) return null;

  // O limite é o do DESTINO: a consulta é da pessoa, o veredito é do produto.
  const limite = await resolverLimiteCredito(client, entityId, para);
  return { quando: consulta.created_at, veredito: avaliarCredito(consulta.resposta, limite ?? 1000) };
}

/**
 * O documento da pessoa que o Mover REMARCA com o destino (revisão de 24/09/2026, D3 do Zeus).
 *
 * O portal lê `metadata.enterpriseId` para decidir de que produto é o documento
 * (lib/apolo/incorporador/documentos-do-portal.ts, passo 3): marcado com a origem, o portal do
 * DESTINO não o vê. Quem nasce marcado hoje, pelo código: o PDF de CAD (envio e automático), os
 * documentos que o portal sobe no cadastro (RG, comprovante de endereço etc., `cadastro-salvar.ts`
 * com origem portal), o comprovante do Serasa pago pelo portal e a evidência da aprovação com
 * restrição. Medido em 24/09/2026 no banco: só `cad` (19) e `aprovacao-credito-restricao` (12) têm a
 * marca, mas o cadastro pelo portal passa a marcar os pessoais a partir desta onda.
 *
 * FICAM COM A MARCA DA ORIGEM, de propósito:
 *   • o PDF de CAD (`cad`) e a PA (`pa`): o PDF de ENVIO é o registro histórico do que o corretor
 *     mandou, e agora IMPRIME o empreendimento de origem; remarcá-lo mostraria ao coordenador do
 *     destino um PDF que diz outro produto. O automático é regenerado no destino no passo 5, já com a
 *     marca e o nome certos. A PA é a do lançamento da origem;
 *   • a análise de crédito (comprovante do Serasa e aprovação com restrição): é a decisão do produto
 *     de origem. O Mover não reaproveita override da origem (vale só a consulta avaliada no limite do
 *     destino), e remarcar entregaria ao portal do destino o Serasa que a origem pagou;
 *   • as peças internas da Careli (não saem pelo portal de qualquer jeito).
 * O RESTO (os documentos pessoais) é da pessoa e acompanha a CAD: sem marca não imprimem produto.
 */
const PALAVRA_DE_CREDITO = /(^|[-_])(credito|serasa)([-_]|$)/;
function documentoAcompanhaACad(tipoBruto: unknown): boolean {
  const tipo = String(tipoBruto ?? "").trim().toLowerCase();
  if (!tipo) return false;
  if (TIPOS_DE_EMPREENDIMENTO.has(tipo)) return false;
  if (TIPOS_DE_CREDITO.has(tipo) || PALAVRA_DE_CREDITO.test(tipo)) return false;
  return !TIPOS_INTERNOS_DA_CARELI.has(tipo);
}

const erro = (status: number, mensagem: string): RespostaDoMover => ({
  corpo: { error: mensagem },
  status,
});

/**
 * Move a CAD `(entityId, de)` para o empreendimento `para` (canonizado para o id de mercado).
 *
 * Sem autenticação aqui: a rota já provou que é a coordenação (admin/leader).
 */
export async function moverCadDeEmpreendimento(input: {
  autor: { userId: string };
  client: AdminClient;
  corpo: CorpoDoMover;
  entityId: string;
  /** Quem aparece como autor do PDF regenerado ("Board"), ou null no ambiente local. */
  uploadedByName?: null | string;
}): Promise<RespostaDoMover> {
  const { autor, client, entityId } = input;
  const de = normalizarEnterpriseId(input.corpo.de);
  const paraPedido = normalizarEnterpriseId(input.corpo.para);

  if (!ehUuid(entityId)) return erro(400, "Ficha inválida.");
  if (!de || !paraPedido) {
    return erro(400, "Informe o empreendimento atual da CAD e o novo empreendimento.");
  }

  // ── 0. LEITURAS E DECISÕES (nada escrito ainda) ──────────────────────────────────────────────
  let cadastro: EmpreendimentoDoCadastro[];
  try {
    cadastro = await lerEmpreendimentosDoCadastro(client);
  } catch {
    return erro(503, "Não foi possível conferir o cadastro de empreendimentos agora. Nada foi alterado.");
  }

  // O destino é SEMPRE o id de mercado (o pai): VOC, VOL, VOR e "group:Vale do Ouro" viram 35.
  const para = idDeMercado(paraPedido, cadastro) ?? paraPedido;
  if (mesmoEmpreendimento(de, para, cadastro)) {
    return erro(400, "A CAD já está neste empreendimento.");
  }

  // ⚠️ O DESTINO PRECISA RECEBER CAD (revisão de 24/09/2026, D4 do Zeus). A tela só oferece os ids
  // com o portão de CAD aberto (`destinosDaCad`, board-do-servidor.ts), e a rota não conferia: um
  // corpo forjado levava a CAD para o RDV (43, que ainda não recebe CAD), para o 9001 de teste ou para
  // um "group:*" inventado, fora da configuração de crédito e do escopo de qualquer coordenador. Que é
  // o "CAD num id que ninguém enxerga" do caso do Jonatas. A fonte é a MESMA do seletor
  // (`listEnterprisesRecebendo`), comparada pela régua de mercado: o seletor manda "35" ou
  // "group:Lagoa Bonita", e uma divisão com o portão aberto também vale pelo pai.
  //
  // ⚠️ LISTA VAZIA É FALHA DE LEITURA, NÃO "NINGUÉM RECEBE" (revisão de 24/09/2026, terceira rodada).
  // `listEnterprisesRecebendo` NUNCA lança: em erro de leitura que não é migration pendente ela devolve
  // [] (enterprise-settings.ts, falha fechada). Com o try/catch sozinho, um blip do Supabase respondia
  // 400 "Este empreendimento não recebe CAD." para o Vale do Ouro, que recebe, e o coordenador concluía
  // que o produto estava fechado. Hoje há 8 ids com o portão de CAD aberto: vazio só acontece por
  // falha, e vira 503 (tente de novo). Continua FECHADO (nada muda); só a frase deixou de afirmar um
  // fato falso. Se um dia a Careli fechar TODOS os portões, o Mover responde 503 em vez de 400, o que
  // não abre porta nenhuma.
  const PORTAO_ILEGIVEL =
    "Não foi possível conferir os empreendimentos que recebem CAD agora. Nada foi alterado.";
  let recebendo: string[];
  try {
    recebendo = await listEnterprisesRecebendo(client, "cad");
  } catch {
    return erro(503, PORTAO_ILEGIVEL);
  }
  if (recebendo.length === 0) return erro(503, PORTAO_ILEGIVEL);
  if (!recebendo.some((id) => idDeMercado(id, cadastro) === para)) {
    return erro(400, "Este empreendimento não recebe CAD.");
  }

  type CadLida = {
    empreendimento: null | string;
    enterprise_id: string;
    etapa: null | string;
    motivo: null | string;
    pagamento_ref: null | string;
    pago_em: null | string;
  };
  let cad: CadLida | null;
  let cadsDaPessoa: Array<{ enterprise_id: null | string }>;
  try {
    cad = await lerCadDaEsteira<CadLida>(
      client,
      entityId,
      "enterprise_id, empreendimento, etapa, motivo, pagamento_ref, pago_em",
      { enterpriseId: de },
    );
    cadsDaPessoa = await lerCadsDaEsteira<{ enterprise_id: null | string }>(
      client,
      entityId,
      "enterprise_id",
      { limite: 50 },
    );
  } catch {
    return erro(503, "Não foi possível ler a CAD agora. Nada foi alterado.");
  }
  if (!cad) return erro(404, "Esta CAD não foi encontrada neste empreendimento.");

  // ⚠️ CAD COM COBRANÇA DE PRÉ-VENDA NÃO SE MOVE (revisão de 24/09/2026, terceira rodada; decisão
  // PADRÃO do Zeus, o Lucas pode mudar). `pagamento_ref` (a cobrança PIX gerada) e `pago_em` (o PIX
  // pago) moram na linha da esteira, e a troca é um UPDATE dessa mesma linha: mover levaria a cobrança
  // junto. O painel do coordenador (painel-coordenador.ts) soma `pagamento_ref` por `enterprise_id`, e
  // o PIX de R$ 1.000 pago ao Vale do Ouro passaria a contar no destino, sumindo do painel do VLO; e a
  // CAD rebaixada para o crédito carregaria a referência de uma cobrança de outro produto. As outras
  // saídas (mover a cobrança de propósito, ou limpar a referência e registrar na linha do tempo) são
  // decisão de financeiro, não de engenharia; recusar é a única que não mexe em dinheiro.
  //
  // Medido em produção em 24/09/2026 (apolo_esteira): 432 de 840 CADs têm `pagamento_ref`, 108 com
  // `pago_em`, TODAS credenciadas no Vale do Ouro (35), de 526 credenciados lá. É esse o tamanho da
  // recusa hoje. A CAD do Jonatas não tem nenhum dos dois. As colunas não têm migration no repo
  // (ver o aviso da 0080), mas existem: `pagamento_ref text`, `pago_em timestamptz`.
  //
  // A mesma condição vai no UPDATE da troca (passo 1): uma cobrança gerada entre esta leitura e a
  // escrita também barra, como a etapa.
  //
  // A RESERVA ("reservado:<ms>", gravada por gerar-pix e pelo disparo em lote ANTES de criar a
  // cobrança no Asaas) também barra, de propósito: é um PIX sendo criado para a origem agora. Mover
  // no meio disso deixaria a cobrança nova gravada numa CAD que já saiu do produto.
  if (String(cad.pagamento_ref ?? "").trim() || cad.pago_em) {
    return erro(
      409,
      "Esta CAD já tem cobrança de pré-venda no empreendimento atual. Mover levaria a cobrança para outro empreendimento. Resolva a cobrança antes de mover.",
    );
  }

  // A chave da esteira é (pessoa, empreendimento): duas CADs do mesmo produto não cabem. O destino é
  // conferido pela régua de mercado, e não pelo id cru, para uma CAD em "group:Vale do Ouro" também
  // contar como "já tem CAD no Vale do Ouro".
  const outras = cadsDaPessoa.filter((c) => normalizarEnterpriseId(c.enterprise_id) !== de);
  if (outras.some((c) => mesmoEmpreendimento(c.enterprise_id, para, cadastro))) {
    return erro(409, "Este cliente já tem CAD no novo empreendimento. Ajuste a CAD que já existe lá.");
  }
  // Outra CAD da pessoa no MESMO produto da origem: o vínculo e os documentos da origem também são
  // dela, e ficam onde estão (passos 2 e 3).
  const outraCadNaOrigem = outras.some((c) => mesmoEmpreendimento(c.enterprise_id, de, cadastro));

  const nomeNovo = await nomeDoDestino(client, para, cadastro);
  if (!nomeNovo) return erro(400, "O novo empreendimento não foi encontrado no cadastro.");
  const nomeAnterior = (cad.empreendimento ?? "").trim() || `EMPREENDIMENTO ${de}`;
  const etapaAnterior = cad.etapa ?? null;

  // O crédito é decidido ANTES de mover: se a leitura falhar, nada muda.
  let plano: PlanoDaEtapa;
  try {
    const precisaDoCredito = Boolean(etapaAnterior && ETAPAS_DO_CREDITO.has(etapaAnterior));
    const analiseNoDestino = precisaDoCredito
      ? await resolverAnaliseHabilitada(client, entityId, para)
      : false;
    let consulta: null | { quando: string; veredito: Veredito } = null;
    if (precisaDoCredito && analiseNoDestino) {
      const cfg = lerConfigSerasa();
      // Sem a configuração não se sabe o ambiente, e sem o ambiente uma consulta de homologação
      // contaria como crédito real (a mesma régua de `creditoDaCad`).
      if (!cfg.ok) {
        return erro(
          503,
          "A análise de crédito está sem configuração agora, então a consulta não pode ser conferida. Nada foi alterado.",
        );
      }
      consulta = await consultaNoLimiteDoDestino(client, entityId, para, cfg.config.ambiente);
    }
    plano = planejarEtapaDoMover({
      analiseNoDestino,
      consulta,
      etapaAtual: etapaAnterior,
      motivoAnterior: cad.motivo,
      nomeAnterior,
      nomeNovo,
    });
  } catch {
    return erro(503, "Não foi possível conferir o crédito desta CAD agora. Nada foi alterado.");
  }

  // ── 1. A CHAVE: a linha da esteira muda de empreendimento (e o rebaixamento vai junto) ──────────
  const agora = new Date().toISOString();
  const atualizadoPor = ehUuid(autor.userId) ? autor.userId : null;
  const naTroca = plano.gravacao === "na-troca" && plano.etapaAlvo !== null;
  const registro: Record<string, unknown> = {
    atualizado_em: agora,
    atualizado_por: atualizadoPor,
    empreendimento: nomeNovo,
    enterprise_id: para,
    motivo: plano.motivoDaEsteira,
  };
  if (naTroca) registro.etapa = plano.etapaAlvo;

  // ⚠️ A ETAPA LIDA É CONDIÇÃO DA ESCRITA. O plano foi decidido sobre ela: se o crédito da origem
  // mudou a etapa entre a leitura e esta escrita (ex.: validação virou credenciado pela régua do
  // produto errado), mover com o plano velho levaria um credenciado sem análise para o destino.
  // E A COBRANÇA TAMBÉM: sem `pagamento_ref` e sem `pago_em` na hora da escrita (ver a recusa acima).
  let mover = client
    .from("apolo_esteira")
    .update(registro)
    .eq("entity_id", entityId)
    .eq("enterprise_id", de)
    .is("pagamento_ref", null)
    .is("pago_em", null);
  if (etapaAnterior) mover = mover.eq("etapa", etapaAnterior);
  const { data: movidas, error: erroMover } = await mover.select("enterprise_id");
  if (erroMover) {
    // 23505 = já existe (pessoa, para): alguém criou a CAD no destino entre a leitura e a escrita.
    if ((erroMover as { code?: string }).code === "23505") {
      return erro(409, "Este cliente já tem CAD no novo empreendimento. Ajuste a CAD que já existe lá.");
    }
    return erro(503, "Não foi possível mover a CAD agora. Nada foi alterado.");
  }
  if (!(movidas ?? []).length) {
    return erro(
      409,
      "A CAD mudou enquanto era movida. Nada foi alterado. Recarregue o Board e tente de novo.",
    );
  }

  const avisos: string[] = [];
  // `incompleto` é só para DADO (ver o cabeçalho): vínculo, documentos, etapa que devia subir.
  let incompleto = false;
  const falhaDeDado = (texto: string) => {
    avisos.push(texto);
    incompleto = true;
  };
  let etapaNova: null | string = naTroca ? plano.etapaAlvo : etapaAnterior;

  // ── 2. VÍNCULOS: cria o do destino, depois arquiva o da origem ────────────────────────────────
  // Imobiliária (o vínculo com a pessoa que vende) e corretor NÃO mudam: são outros tipos de
  // vínculo, e continuam valendo.
  let vinculosIntocadosPorSerImobiliaria = false;
  try {
    // ⚠️ IMOBILIÁRIA QUE TAMBÉM TEM CAD: OS VÍNCULOS DE EMPREENDIMENTO DELA NÃO SÃO TOCADOS, nem na
    // origem nem no destino (revisão de 24/09/2026: D7, e na terceira rodada o destino). Para a
    // entidade com perfil imobiliária, o vínculo `empreendimento` é a HABILITAÇÃO dela no produto, e
    // dois leitores contam `status === "verified"` como habilitada:
    //   • `empreendimentosCredenciados` (lib/publico/cad/dados.ts): em que produtos ela manda CAD pelo
    //     link público;
    //   • `lerImobiliariasVinculadas` (lib/apolo/incorporador/crm.ts): a imobiliária credenciada e
    //     verificada do produto no portal do incorporador.
    // ARQUIVAR a origem tirava a habilitação como efeito colateral (o D7). CRIAR o destino como
    // `verified`, que a primeira versão ainda fazia, era o oposto e pior: credenciava a imobiliária no
    // destino sem a validação de imobiliária ("credenciar parceiro é decisão da Careli"). Caso medido
    // em produção em 24/09/2026: b343b378, perfis imobiliaria e prospect, CAD no 20 em validação e um
    // único vínculo, o 20 verified; mover para o 35 a habilitava no Vale do Ouro.
    // A CAD de cliente não precisa do vínculo: a trava do crédito (`cadComVinculoArquivado`) só olha
    // vínculo ARQUIVADO, e aqui nada é arquivado. Lido ANTES de qualquer escrita: se a leitura falhar,
    // nenhum vínculo é criado nem arquivado.
    const { data: perfil, error: erroPerfil } = await client
      .from("apolo_entity_profiles")
      .select("entity_id")
      .eq("entity_id", entityId)
      .eq("profile", "imobiliaria")
      .limit(1);
    if (erroPerfil) throw new Error(erroPerfil.message);
    vinculosIntocadosPorSerImobiliaria = (perfil ?? []).length > 0;

    if (!vinculosIntocadosPorSerImobiliaria) {
      const vinculos = await lerVinculosDeEmpreendimento(client, entityId);
      const ativos = vinculos.filter((v) => v.status !== "archived" && v.enterpriseId);
      let destinoCoberto = ativos.some((v) => mesmoEmpreendimento(v.enterpriseId, para, cadastro));

      if (!destinoCoberto) {
        // Mesmo formato de relationships/create (insertRelationship): é o que os leitores esperam.
        const { error: erroCriar } = await client.from("apolo_relationships").insert({
          entity_id: entityId,
          label: nomeNovo,
          metadata: {
            c2xSynced: false,
            createdAt: agora,
            createdBy: autor.userId,
            enterpriseId: para,
            enterpriseLabel: nomeNovo,
            kind: "trabalho",
            origem: "mover-cad",
            source: "apolo",
          },
          related_entity_id: null,
          relationship_type: "empreendimento",
          status: "verified",
        });
        if (erroCriar) falhaDeDado("O vínculo com o novo empreendimento não foi criado.");
        else destinoCoberto = true;
      }

      // ⚠️ Só arquiva a origem com o destino coberto, e só se NENHUMA outra CAD da pessoa for do mesmo
      // produto da origem: arquivar o vínculo de uma CAD viva é exatamente o estado que trava o crédito.
      if (destinoCoberto && !outraCadNaOrigem) {
        for (const v of ativos.filter((v) => mesmoEmpreendimento(v.enterpriseId, de, cadastro))) {
          // Mesmo formato do arquivamento manual (relationships/archive), com a origem da troca.
          const { error: erroArquivar } = await client
            .from("apolo_relationships")
            .update({
              metadata: {
                ...v.metadata,
                arquivadoEm: agora,
                arquivadoPelo: "mover-cad",
                arquivadoPor: autor.userId,
              },
              status: "archived",
              updated_at: agora,
            })
            .eq("id", v.id);
          if (erroArquivar) falhaDeDado("O vínculo com o empreendimento anterior não foi arquivado.");
        }
      }
    }
  } catch {
    falhaDeDado("Os vínculos de empreendimento não puderam ser conferidos.");
  }

  // ── 3. DOCUMENTOS DA PESSOA: a marca da origem passa para o destino (menos CAD e crédito) ──────
  // Ver `documentoAcompanhaACad`. A marca comparada é a de MERCADO: o portal marca com o id do vínculo
  // (pode ser a divisão, "37") e a CAD mora no pai ("35").
  let documentosRemarcados = 0;
  if (!outraCadNaOrigem) {
    try {
      const { data: docs, error: erroDocs } = await client
        .from("apolo_documents")
        .select("id, document_type, metadata")
        .eq("entity_id", entityId)
        .limit(500);
      if (erroDocs) throw new Error(erroDocs.message);
      for (const doc of (docs ?? []) as Array<{
        document_type: null | string;
        id: string;
        metadata: unknown;
      }>) {
        if (!documentoAcompanhaACad(doc.document_type)) continue;
        const meta =
          doc.metadata && typeof doc.metadata === "object" && !Array.isArray(doc.metadata)
            ? (doc.metadata as Record<string, unknown>)
            : null;
        const marca = normalizarEnterpriseId(meta?.enterpriseId);
        if (!meta || !marca || !mesmoEmpreendimento(marca, de, cadastro)) continue;
        const { error: erroDoc } = await client
          .from("apolo_documents")
          .update({
            metadata: {
              ...meta,
              enterpriseId: para,
              enterpriseIdAnterior: marca,
              remarcadoEm: agora,
              remarcadoPelo: "mover-cad",
            },
          })
          .eq("id", doc.id);
        if (erroDoc) throw new Error(erroDoc.message);
        documentosRemarcados += 1;
      }
    } catch {
      falhaDeDado(
        "Documentos enviados pelo portal continuam marcados com o empreendimento anterior; o portal do novo empreendimento não os vê.",
      );
    }
  }

  // ── 4. ETAPA, FILA E AVISO ────────────────────────────────────────────────────────────────────
  // `undefined` = ninguém tentou avisar ainda; `null` = tentou e não saiu.
  let aviso: null | ResultadoAvisoEtapa | undefined;
  let filaFeita = false;

  if (plano.gravacao === "depois" && plano.etapaAlvo) {
    // SUBIR (ou reaplicar a pré-venda) pelo ponto autoritativo, com a CAD já no destino. Sem
    // `automatico` e sem `nuncaRebaixar`: é decisão da coordenação, e o redirecionamento
    // pré-venda -> credenciado (pré-venda desligada no destino) e a subida ao C2X ficam com ele.
    const falhou = (detalhe: string) => {
      const acao =
        etapaAnterior === "prevenda"
          ? "A pré-venda não foi reaplicada com a regra do novo empreendimento"
          : "A CAD não avançou para a pré-venda";
      falhaDeDado(
        `${acao}${detalhe ? `: ${detalhe}` : ""}. A CAD ficou em ${nomeDaEtapa(etapaAnterior)} no novo empreendimento.`,
      );
    };
    try {
      const transicao = await atualizarEtapa(client, entityId, plano.etapaAlvo, {
        atualizadoPor,
        enterpriseId: para,
        motivo: plano.motivoDaEsteira,
        saidaDeRevisaoAutorizada: plano.saidaDeRevisaoAutorizada,
      });
      if (transicao.error) {
        falhou(trecho(transicao.error));
      } else {
        etapaNova = transicao.etapa;
        filaFeita = true;
        // Etapa que mudou de verdade: `atualizarEtapa` já avisou. Que não mudou: aviso abaixo.
        if (transicao.etapa !== etapaAnterior) aviso = transicao.aviso ?? null;
      }
    } catch {
      falhou("");
    }
  }

  // A FILA DO LANÇAMENTO do destino ("entrou no board vai para etiquetas", Lucas 01/08), como
  // `atualizarEtapa` faz em toda troca de etapa. A fila é por empreendimento: no produto errado a CAD
  // era recusada. Nunca lança, e o resultado não entra em `avisos`: sem lançamento ativo o normal é
  // não entrar, e é consequência, nunca condição (a mesma régua de `atualizarEtapa`).
  if (!filaFeita) {
    try {
      await garantirNaFilaDoLancamento(client, entityId, { enterpriseId: para });
    } catch {
      /* best-effort */
    }
  }

  // ⚠️ O DESTINO É AVISADO SEMPRE (revisão de 24/09/2026, D2 e D5 do Zeus). Regra do Lucas de 21/08:
  // *"devemos comunicar em todas as etapas o corretor, coordenador"*. No caso do Jonatas o único aviso
  // foi para o coordenador do produto errado, e o do Vale do Ouro nunca soube do cliente. Aqui:
  //   • etapa rebaixada no passo 1: o aviso da etapa nova, como `atualizarEtapa` faria;
  //   • etapa que NÃO mudou (antes do crédito, credenciado que fica, pré-venda reaplicada como
  //     pré-venda, subida que falhou): o aviso da etapa em que a CAD chegou, com `forcar`, que é o
  //     reenvio que a trava de repetição de `avisarEtapa` já prevê. A mensagem leva o nome do produto
  //     novo, e é assim que o coordenador e o corretor ficam sabendo que a CAD chegou lá.
  if (aviso === undefined && etapaNova) {
    try {
      aviso = await avisarEtapa(client, {
        enterpriseId: para,
        entityId,
        etapa: etapaNova,
        etapaAnterior,
        forcar: etapaNova === etapaAnterior,
        origem: "board",
      });
    } catch {
      aviso = null;
    }
  }
  // O coordenador do destino é o aviso que faltou no caso do Jonatas: se ele não recebeu, a tela
  // precisa dizer. O do corretor não entra: CAD sem corretor com telefone é comum (resíduo do Asana)
  // e já aparece registrada em `apolo_disparos`, na tela de status dos avisos.
  // Entra em `avisos`, mas NÃO liga `incompleto`: é mensagem, e o dado está certo (ver o cabeçalho).
  if (!aviso?.coordenador.ok) {
    avisos.push(avisoDoCoordenadorQueNaoSaiu(aviso?.coordenador.erro));
  }

  // ── 5. O PDF DA CAD, regenerado no destino (DEPOIS de mover: antes, a esteira do destino não
  // existia e a CAD sairia sem imobiliária e sem corretor) ───────────────────────────────────────
  // Falha aqui entra em `avisos` e NÃO liga `incompleto`: o PDF sai de novo na próxima troca de etapa.
  try {
    const gerado = await comLimiteDeTempo(
      gerarESalvarCad(client, entityId, {
        enterpriseId: para,
        uploadedByName: input.uploadedByName ?? null,
      }),
      15000,
    );
    if (!gerado?.ok) avisos.push("O PDF da CAD não foi regenerado agora; sai na próxima troca de etapa.");
  } catch {
    avisos.push("O PDF da CAD não foi regenerado agora; sai na próxima troca de etapa.");
  }

  // SEM REPETIÇÃO (revisão de 24/09/2026, terceira rodada): o passo 2 escreve a mesma frase uma vez
  // por vínculo da origem que falha (35 e a divisão 37, por exemplo), e a tela usa o texto como chave
  // da lista.
  const avisosSemRepeticao = [...new Set(avisos)];

  // ── 6. LINHA DO TEMPO, por último: registra também o que não saiu ─────────────────────────────
  try {
    await client.from("apolo_timeline_events").insert({
      description: plano.credito.motivo,
      entity_id: entityId,
      event_type: "cad_movida",
      metadata: {
        avisos: avisosSemRepeticao,
        credito: plano.credito,
        de,
        documentosRemarcados,
        etapaAnterior,
        etapaNova,
        incompleto,
        para,
        paraPedido,
        por: autor.userId,
        vinculosIntocadosPorSerImobiliaria,
      },
      occurred_at: agora,
      status: "attention",
      title: `CAD movida: ${nomeAnterior} para ${nomeNovo}`,
    });
  } catch {
    /* o registro é consequência, nunca condição */
  }

  return {
    corpo: {
      data: {
        avisos: avisosSemRepeticao,
        credito: plano.credito,
        de,
        empreendimentoNovo: nomeNovo,
        etapaAnterior,
        etapaNova,
        // `true` = algum passo de DADO depois da troca não saiu (vínculo, documentos, etapa que devia
        // subir; ver `avisos`). A CAD JÁ está no destino; a tela destaca para a coordenação conferir,
        // em vez de mostrar sucesso limpo. Aviso ao coordenador e PDF ficam só em `avisos`.
        incompleto,
        para,
      },
    },
    status: 200,
  };
}
