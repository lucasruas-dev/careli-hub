import { avisarImobReprovado } from "@/lib/apolo/disparo-imobiliaria";
import { cnpjValido, cpfValido } from "@/lib/apolo/documento";
import { destinoAposCredito } from "@/lib/apolo/destino-credito";
import { atualizarEtapa } from "@/lib/apolo/esteira";
import { lerCadDaEsteira, normalizarEnterpriseId } from "@/lib/apolo/esteira-cad";
import {
  resolverAnaliseHabilitada,
  resolverLimiteCredito,
  resolverPrevendaHabilitada,
} from "@/lib/apolo/limite-credito";
import { comLimiteDeTempo, gerarESalvarCad } from "@/lib/apolo/salvar-cad";
import type { createApoloAdminClient } from "@/lib/apolo/server";
import { avaliarCredito, type Veredito } from "@/lib/serasa/avaliacao";
import { consultarPF, consultarPJ } from "@/lib/serasa/client";
import { gerarESalvarComprovante } from "@/lib/serasa/comprovante";
import { ambienteConfere, lerConfigSerasa } from "@/lib/serasa/config";
import { resumirRelatorio } from "@/lib/serasa/resumo";

// A CONSULTA DE CRÉDITO NO SERASA, SEM A PORTA: o miolo das duas rotas que gastam dinheiro.
//
// POR QUE ESTE ARQUIVO EXISTE (16/09/2026). Decisão do Lucas: *"A Cecílio, no portal"* faz a
// análise de crédito dos clientes dela, com a consulta paga na conta da Careli e o registro de quem
// consultou. A tela do Apolo chama `/api/apolo/serasa/consultar` com o Bearer do hub; o portal chama
// `/api/incorporador/board/[id]/serasa/consultar` com o cookie. Duplicar a rota seria copiar ~700
// linhas de regra de dinheiro que divergem no primeiro ajuste, então o código mudou para cá TAL QUAL
// (comentários e armadilhas incluídos) e as duas rotas viraram cascas: autenticam, recortam e chamam.
//
// ⚠️ NADA DE AUTENTICAÇÃO AQUI. Quem chama já provou quem é e, no portal, já conferiu que a CAD está
// no escopo do produto. O serviço recebe o AUTOR e aplica as mesmas regras para os dois.
//
// ⚠️ O QUE É DIFERENTE PARA O PORTAL, E SÓ ISTO (cada ponto marcado com "(portal)" no código):
//   • `forcar` não gera cobrança nova: dentro da janela de reaproveitamento o resultado guardado é
//     devolvido E aplicado na CAD, porque sem isso a CAD ficaria parada na análise sem saída;
//   • o relatório, os opcionais e a finalidade são os padrões do servidor (quem é de fora não
//     escolhe um relatório mais caro na conta da Careli);
//   • só vale consulta guardada do MESMO ambiente (um relatório de homologação não move CAD real),
//     DA MESMA FICHA e do MESMO ALVO (titular ou cônjuge): ver `situacao`;
//   • o reaproveitamento não devolve o relatório cru e deixa a leitura na auditoria;
//   • a consulta nova passa por um freio de gasto (`freioDoPortal`) e é RESERVADA no registro antes
//     de chamar o Serasa (autoria garantida e clique concorrente sem cobrança dupla);
//   • o registro leva o autor do portal em `resumo.autor` (a tabela não tem metadata e não ganha
//     coluna nova), e o comprovante nasce com o empreendimento da CAD;
//   • o painel não devolve os disparos de aviso (telefones da Careli) nem o selo de admin;
//   • as mensagens de erro não citam variável de ambiente nem detalhe técnico do Serasa.
// Uma regra nova vale para as DUAS portas, por pedido explícito: o CNPJ passa pela conferência do
// dígito verificador antes de gastar (o CPF já passava). E, nas duas, a leitura que falha antes de
// gastar vira 503: "não sei se já consultei" não pode virar "consulto de novo".
//
// (16/09/2026, decisão do Lucas) NO HUB, SÓ A COORDENAÇÃO FORÇA NOVA CONSULTA DENTRO DA JANELA. O
// analista que pede `forcar` recebe a consulta guardada com o recado de quem pode cobrar de novo (e,
// no cônjuge, o veredito dela, para o botão do cônjuge não voltar mudo). Ver `podeForcarNovaConsulta`.
// Os tetos do portal (por portal, por conta e por documento) não mudam.

type AdminClient = NonNullable<ReturnType<typeof createApoloAdminClient>>;

// Homologação bloqueia o IP acima de 200 chamadas/dia. Paramos antes, com folga, porque o
// bloqueio é por IP e derrubaria outros serviços que saem pelo mesmo endereço.
export const TETO_DIARIO_HOMOLOGACAO = 150;

// Consulta do mesmo documento dentro deste prazo é reaproveitada em vez de cobrada de novo.
// 30 dias é o palpite conservador enquanto o Serasa não responde se existe janela comercial.
//
// ⚠️ A JANELA É POR DOCUMENTO, NÃO POR EMPREENDIMENTO. `serasa_consultas` não tem coluna de
// empreendimento (migration 0059) e o relatório é da PESSOA: o mesmo CPF consultado para outro
// loteamento há 10 dias não é cobrado de novo. O que depende do empreendimento é o VEREDITO, e ele
// é recalculado com o limite do empreendimento da CAD (como o painel sempre fez).
export const DIAS_REAPROVEITAMENTO = 30;

/** A finalidade que separa a consulta do cônjuge da do titular (as duas ficam no `entity_id` dele). */
export const FINALIDADE_CONJUGE = "analise-credito-conjuge";

// (portal) O FREIO DE GASTO. Em produção não havia teto nenhum: o teto diário só existia para não
// derrubar o IP de homologação. Com o cônjuge editável pela ficha do portal, um laço "troca o CPF,
// consulta" gastaria sem limite na conta da Careli, sobre pessoas que nem são clientes.
//
// ⚠️ OS NÚMEROS SAÍRAM DE MEDIÇÃO (16/09/2026, `serasa_consultas` de produção, 47 dias com consulta):
// a Careli INTEIRA, somando todos os empreendimentos, fez em média 17 consultas por dia, 43 no
// percentil 95 e 327 no dia de pico (lançamento); por usuário, 40 no percentil 95. Um portal é UM
// incorporador: 50 por dia no portal e 25 por conta cobrem o dia normal com folga. O dia de
// lançamento passa disso de propósito: aí a conversa é com a Careli, antes do gasto.
export const TETO_PORTAL_24H = 50;
export const TETO_USUARIO_PORTAL_24H = 25;
// Tentativas com ERRO do mesmo documento em 24 horas. A chamada que falha pode ter sido cobrada, e
// sem esta conta um erro estável do Serasa virava repetição paga pelo botão.
export const TETO_ERROS_DOCUMENTO_24H = 2;

// (portal) A RESERVA ANTES DA CHAMADA. A tabela só aceita `sucesso` ou `erro` (0059), então a reserva
// nasce como `erro` com uma marca própria e é ATUALIZADA com o resultado. Se a função morrer no meio,
// a linha fica com a marca de "em andamento": para a conciliação da fatura, uma chamada que PODE ter
// saído, com o autor já gravado. A de quem desistiu antes de chamar diz que não chamou.
// Só letras e hífen: a marca entra num filtro `or` do PostgREST sem precisar de aspas.
export const MARCA_EM_ANDAMENTO = "reserva-do-portal-em-andamento";
export const MARCA_DESISTIU = "reserva-do-portal-desistiu-sem-chamar-o-serasa";
// A função da rota vive no máximo 60 s; uma reserva "em andamento" mais velha que isto é de uma
// função que morreu, e não segura mais ninguém.
const SEGUNDOS_DA_RESERVA = 120;

// (portal) A frase para o que é configuração interna da Careli (variável de ambiente faltando,
// ambiente incoerente, relatório PJ sem nome). Quem é de fora não tem o que fazer com o detalhe.
export const MENSAGEM_INDISPONIVEL_NO_PORTAL =
  "A análise de crédito está indisponível no momento. Fale com a Careli.";

/**
 * QUEM está consultando ou aprovando.
 *
 * `papel` do hub é a porta pela qual ele passou (`escrita` = authorizeApoloWrite, `coordenacao` =
 * authorizeApoloCoordenacao), e não uma releitura de `hub_users`: o hub continua com as mesmas
 * idas ao banco de antes.
 */
export type AutorDoCredito =
  | { nome: null | string; papel: "coordenacao" | "escrita"; tipo: "hub"; userId: string }
  | {
      incorporadorId: string;
      nome: string;
      slug: string;
      tipo: "portal";
      usuarioId: string;
    };

/** A resposta sem `NextResponse`: a rota embrulha. Mantém o serviço testável sem o runtime do Next. */
export type RespostaDoCredito = {
  corpo: unknown;
  headers?: Record<string, string>;
  status: number;
};

export type CorpoDaConsulta = {
  // De QUEM é a consulta. "titular" é o dono da ficha (comportamento de sempre); "conjuge" usa
  // o CPF do cônjuge que está na ficha da esteira, para o caso de compra em casal.
  alvo?: "titular" | "conjuge";
  confirmado?: boolean;
  // De QUAL CAD é a consulta. Desde a 0080 a pessoa pode ter CAD em vários empreendimentos, e
  // limite de crédito, pré-venda e etapa são configuração DO EMPREENDIMENTO. Sem ele, a CAD mais
  // recente (mesmo default do Board, que hoje mostra um card por pessoa).
  enterpriseId?: null | number | string;
  entityId?: string;
  finalidade?: string;
  forcar?: boolean;
  optionalFeatures?: string[];
  reportName?: string;
};

// O teste de uuid FROUXO que as rotas do hub sempre usaram para `solicitado_por` e para o "é
// admin". Mantido igual de propósito: trocar pela regex estrita mudaria quem o hub considera
// usuário real no ambiente local.
const pareceUuid = (valor: string): boolean => /^[0-9a-f-]{36}$/i.test(valor);

/** O id que vai para `atualizado_por`, `solicitado_por` e afins. */
export function idDoAutor(autor: AutorDoCredito): string {
  return autor.tipo === "hub" ? autor.userId : autor.usuarioId;
}

/**
 * O autor gravado junto da consulta, em `resumo.autor`.
 *
 * ⚠️ SÓ PARA O PORTAL. O hub já se identifica por `solicitado_por` (uuid de `hub_users`) e o
 * registro dele continua byte a byte o mesmo. A conta do portal NÃO está em `hub_users`: sem o nome,
 * o slug e a origem, um `solicitado_por` dela não diria a ninguém quem gastou a consulta.
 */
export function autorParaRegistro(autor: AutorDoCredito): null | Record<string, string> {
  if (autor.tipo === "hub") return null;
  return {
    incorporadorId: autor.incorporadorId,
    nome: autor.nome,
    origem: "portal-incorporador",
    slug: autor.slug,
    usuarioId: autor.usuarioId,
  };
}

/**
 * O autor pode pedir uma consulta NOVA (cobrada) dentro da janela de reaproveitamento?
 *
 * (16/09/2026, decisão do Lucas) Hub: só a COORDENAÇÃO (admin e leader, a porta
 * `authorizeApoloCoordenacao` pela qual a rota passou). O portal nunca: a consulta sai na conta da
 * Careli, e o portal que opera sozinho não tem quem confira a segunda cobrança do mesmo CPF.
 *
 * ⚠️ O PAPEL É A PORTA, NÃO UMA LEITURA AQUI. A rota do hub só pergunta à porta da coordenação quando
 * o corpo pede `forcar`; sem ela passar, o autor chega como `escrita`. Uma leitura de papel que falha
 * vira `escrita` (nega), nunca cobrança. As duas objeções à versão anterior desta regra ficaram
 * resolvidas na resposta: o analista recebe a consulta guardada com o recado
 * (`MENSAGEM_SO_COORDENACAO_FORCA`) e, no cônjuge, o veredito dela, então o botão do cônjuge (que
 * manda `forcar` sempre) não volta mudo.
 */
export function podeForcarNovaConsulta(autor: AutorDoCredito): boolean {
  return autor.tipo === "hub" && autor.papel === "coordenacao";
}

/** O recado do analista do hub que pediu nova consulta dentro da janela (D9, 16/09/2026). */
export const MENSAGEM_SO_COORDENACAO_FORCA = `Só a coordenação pode pedir uma nova consulta dentro de ${DIAS_REAPROVEITAMENTO} dias.`;

/** A consulta guardada mais recente de um documento, dentro da janela. */
export type ConsultaGuardada = {
  ambiente: string;
  created_at: string;
  id: string;
  report_name: string;
  resposta: unknown;
  resumo: unknown;
};

/**
 * Recorte da consulta guardada à FICHA e ao ALVO.
 *
 * (portal) ⚠️ POR DOCUMENTO SÓ, O REAPROVEITAMENTO ERA UM BALCÃO DE RELATÓRIOS. O CPF do cônjuge é
 * campo livre da ficha do portal: trocar o `conjugeCpf` pelo CPF de qualquer pessoa que a Careli
 * consultou nos últimos 30 dias, e pedir a consulta do cônjuge, devolvia de graça o relatório dela
 * (e dizia, pela presença, que a Careli a consultou). A mesma porta existia pela identidade: o CPF
 * do titular trocado pelo de um cônjuge aprovado de outra ficha aplicava o veredito de OUTRA pessoa.
 * No portal só vale a consulta pendurada NESTA ficha (`entity_id`) e do MESMO alvo (`finalidade`).
 */
export type RecorteDaConsulta = {
  alvo: "conjuge" | "titular";
  entityId: string;
  /**
   * (16/09/2026, revisão do conjunto) Só a consulta que ESTE portal fez (`resumo.autor.incorporadorId`).
   *
   * ⚠️ COM A D5, A FICHA DA CARELI É A MESMA DA CAD DO PORTAL. A Cecílio cadastra no Garden o CPF de um
   * cliente que a Careli consultou há 10 dias para outro produto, e o recorte por ficha e alvo passava a
   * entregar a ela o Serasa da Careli (e a reaproveitá-lo para decidir a CAD do Garden, sem ela nunca ter
   * pedido nem pago a consulta). Para o portal, a consulta de outro autor conta como inexistente: o freio
   * decide se paga de novo. No hub o campo não vem e nada muda.
   */
  incorporadorId?: null | string;
};

async function situacao(
  client: AdminClient,
  documento: string,
  opts: { ambiente?: null | string; cad?: RecorteDaConsulta } = {},
): Promise<{ consultasHoje: number; recente: ConsultaGuardada | null }> {
  const desde = new Date(Date.now() - DIAS_REAPROVEITAMENTO * 24 * 3600 * 1000).toISOString();

  let busca = client
    .from("serasa_consultas")
    .select("id, created_at, ambiente, resumo, report_name, resposta")
    .eq("documento", documento)
    .eq("status", "sucesso")
    .gte("created_at", desde);
  // (portal) Só o ambiente em que a consulta de agora sairia. No hub o filtro não entra: a tela
  // interna sempre mostrou a última consulta, de qualquer ambiente, com o selo de homologação.
  if (opts.ambiente) busca = busca.eq("ambiente", opts.ambiente);
  if (opts.cad) {
    busca = busca.eq("entity_id", opts.cad.entityId);
    if (opts.cad.incorporadorId) {
      busca = busca.eq("resumo->autor->>incorporadorId", opts.cad.incorporadorId);
    }
    // `finalidade` é NOT NULL (0059), então o `neq` não perde linha nula. O titular inclui as
    // finalidades antigas dele ("analise-credito-cad", "preview-validacao").
    busca =
      opts.cad.alvo === "conjuge"
        ? busca.eq("finalidade", FINALIDADE_CONJUGE)
        : busca.neq("finalidade", FINALIDADE_CONJUGE);
  }

  const [lida, contada] = await Promise.all([
    busca.order("created_at", { ascending: false }).limit(1).maybeSingle<ConsultaGuardada>(),
    client
      .from("serasa_consultas")
      .select("id", { count: "exact", head: true })
      .gte("created_at", new Date().toISOString().slice(0, 10)),
  ]);

  // (16/09/2026, revisão) ⚠️ A LEITURA QUE FALHA LANÇA. Antes o erro era descartado e virava
  // "nenhuma consulta recente": num timeout, a trava de custo abria e o mesmo CPF era cobrado de novo;
  // na régua da etapa, um override antigo vencia a reconsulta reprovada que não foi lida.
  if (lida.error) throw new Error(`serasa_consultas: ${lida.error.message}`);
  if (contada.error) throw new Error(`serasa_consultas (contagem): ${contada.error.message}`);

  return { consultasHoje: contada.count ?? 0, recente: lida.data ?? null };
}

/** A última consulta com sucesso do documento na janela (a mesma régua do reaproveitamento). */
export async function consultaRecenteDoDocumento(
  client: AdminClient,
  documento: string,
  opts: { ambiente?: null | string; cad?: RecorteDaConsulta } = {},
): Promise<ConsultaGuardada | null> {
  return (await situacao(client, documento, opts)).recente;
}

// Só ADMIN reenvia o aviso de reprovação. Em dev sem sessão real (userId sintético), libera.
async function viewerEhAdmin(client: AdminClient, userId: string): Promise<boolean> {
  if (!pareceUuid(userId)) return true;
  const { data } = await client
    .from("hub_users")
    .select("role")
    .eq("id", userId)
    .maybeSingle<{ role: string }>();
  return data?.role === "admin";
}

// Devolutiva dos avisos de reprovação já enviados nesta ficha (mais recentes primeiro).
async function listarDisparos(client: AdminClient, entityId: string) {
  const { data } = await client
    .from("apolo_disparos")
    .select(
      "tipo, destinatario, telefone, status, origem, erro, sent_at, delivered_at, read_at, created_at",
    )
    .eq("entity_id", entityId)
    .order("created_at", { ascending: false })
    .limit(10);
  return data ?? [];
}

// Etapa PERSISTIDA da esteira. É ela, e não o veredito recomputado, que diz se o cliente está
// reprovado no crédito ("revisao"). A tela usa isto para decidir se mostra o aviso de reprovação e
// os botões de reenvio, imune a mudança de limite ou indisponibilidade do C2X.
async function lerEtapaEsteira(
  client: AdminClient,
  entityId: string,
  enterpriseId?: unknown,
): Promise<string | null> {
  const data = await lerCadDaEsteira<{ etapa: string | null }>(client, entityId, "etapa", {
    enterpriseId,
  });
  return data?.etapa ?? null;
}

// ═══════════════════════════════════════════════════════════════════════════════════════════
// GET: a SITUAÇÃO, custo zero
// ═══════════════════════════════════════════════════════════════════════════════════════════

export async function situacaoDoCredito(input: {
  autor: AutorDoCredito;
  client: AdminClient;
  enterpriseId: null | string;
  entityId: string;
}): Promise<RespostaDoCredito> {
  const { autor, client, enterpriseId, entityId } = input;
  const doPortal = autor.tipo === "portal";

  let documento = "";
  // `metadata` vem junto porque o estado civil pode estar SÓ aqui (ver o bloco do cônjuge abaixo).
  let cadastroDaEntidade: Record<string, unknown> | undefined;
  if (entityId) {
    const { data: entidade } = await client
      .from("apolo_entities")
      .select("document_masked, metadata")
      .eq("id", entityId)
      .maybeSingle<{ document_masked: null | string; metadata: unknown }>();
    documento = (entidade?.document_masked ?? "").replace(/\D/g, "");
    cadastroDaEntidade = (entidade?.metadata as { cadastro?: Record<string, unknown> } | null)
      ?.cadastro;
  }

  const cfg = lerConfigSerasa();
  if (!cfg.ok) {
    // (portal) Os nomes das variáveis de ambiente que faltam são configuração interna da Careli.
    return {
      corpo: { data: { configurado: false, faltando: doPortal ? [] : cfg.faltando } },
      status: 200,
    };
  }

  const coerente = ambienteConfere(cfg.config);
  let leitura: { consultasHoje: number; recente: ConsultaGuardada | null } = {
    consultasHoje: 0,
    recente: null,
  };
  if (documento) {
    try {
      leitura = await situacao(client, documento, {
        ambiente: doPortal ? cfg.config.ambiente : null,
        // (portal) Só a consulta do titular DESTA ficha, feita por ESTE portal (ver `RecorteDaConsulta`).
        cad:
          autor.tipo === "portal" && entityId
            ? { alvo: "titular", entityId, incorporadorId: autor.incorporadorId }
            : undefined,
      });
    } catch {
      // O painel é custo zero e não decide cobrança: no hub segue como sempre seguiu (sem consulta
      // na tela; o POST é que barra antes de gastar). No portal a tela tem o aviso curto de
      // indisponível, que é mais honesto que "nenhuma consulta".
      if (doPortal) {
        return {
          corpo: { error: "Não foi possível carregar a análise de crédito agora. Tente de novo." },
          status: 503,
        };
      }
    }
  }
  const { consultasHoje, recente } = leitura;

  // Veredito calculado do cru salvo: aprovado/reprovado pela regra do empreendimento. O limite
  // sai do empreendimento do cliente (best-effort); sem limite próprio, cai no padrão R$ 1.000.
  const cru = recente?.resposta ?? null;
  const limiteResolvido = entityId
    ? await resolverLimiteCredito(client, entityId, enterpriseId)
    : null;
  const veredito = cru ? avaliarCredito(cru, limiteResolvido ?? 1000) : null;

  // Papel do viewer + etapa persistida + histórico de disparos: o REENVIO do aviso é só de ADMIN, o
  // painel de reprovação se guia pela ETAPA (não pelo veredito recomputado), e a tela mostra a
  // devolutiva de entrega (enviado/entregue/lido) de cada envio já feito nesta ficha.
  //
  // (portal) Nem admin nem disparos: o reenvio é da Careli, e a lista traz nome e telefone de quem
  // recebeu o aviso. E a etapa é a da CAD do recorte; o hub segue lendo a mais recente, como sempre.
  const ehAdmin = doPortal ? false : await viewerEhAdmin(client, autor.userId);
  const [disparos, etapa] = entityId
    ? await Promise.all([
        doPortal ? Promise.resolve([]) : listarDisparos(client, entityId),
        lerEtapaEsteira(client, entityId, doPortal ? enterpriseId : undefined),
      ])
    : [[], null];

  // CÔNJUGE: a tela precisa saber se o botão de consultar o cônjuge deve aparecer, e o estado
  // civil mora na ficha da esteira. Casado = 2, união estável = 6 (tabela do C2X).
  // Mandamos só se É casado e se TEM CPF do cônjuge; o CPF em si nunca sai daqui.
  const fichaEsteira = entityId
    ? await lerCadDaEsteira<{ ficha: Record<string, unknown> | null }>(client, entityId, "ficha", {
        enterpriseId,
      })
    : null;

  // ⚠️ O ESTADO CIVIL MORA EM DOIS LUGARES, e ler só um escondia o botão de quem é casado.
  //
  // A ficha da esteira é a fonte preferida, mas 40 CADs de casados têm o dado APENAS em
  // `apolo_entities.metadata.cadastro`: foi o caso do Geraldo Antonio Mendes (22/08): a tela de
  // validação mostrava "Casado (a) · Comunhão parcial de bens", o PDF da CAD também, e mesmo
  // assim o botão do cônjuge não aparecia, porque `apolo_esteira.ficha` dele está vazia. Sem o
  // botão, o titular reprovado vira beco sem saída: não há como tentar o resgate pela renda do
  // cônjuge.
  //
  // Medido em produção: 126 casados pela ficha da esteira, 57 pelo metadata, 40 SÓ pelo metadata.
  const valorDaFicha = (chave: string): string => {
    const daEsteira = fichaEsteira?.ficha?.[chave];
    if (typeof daEsteira === "string" && daEsteira.trim()) return daEsteira.trim();
    const doCadastro = cadastroDaEntidade?.[chave];
    return typeof doCadastro === "string" ? doCadastro.trim() : "";
  };

  const estadoCivil = valorDaFicha("estadoCivilId");
  const cpfDoConjuge = valorDaFicha("conjugeCpf").replace(/\D/g, "");
  const conjuge = {
    // Nome só para a tela dizer de quem é a consulta; pode vir vazio (só 6 fichas têm).
    nome: valorDaFicha("conjugeNome"),
    temCpf: cpfDoConjuge.length === 11,
    temConjuge: ["2", "6"].includes(estadoCivil),
  };

  return {
    corpo: {
      data: {
        ambiente: cfg.config.ambiente,
        // (portal) O aviso do hub cita SERASA_AMBIENTE e as URLs: para quem é de fora, só o fato.
        avisoAmbiente: coerente.ok ? null : doPortal ? MENSAGEM_INDISPONIVEL_NO_PORTAL : coerente.erro,
        configurado: true,
        conjuge,
        consultasHoje,
        disparos,
        ehAdmin,
        etapa,
        // Em homologação a conta é contra o teto do IP; em produção, informativa.
        tetoDiario: cfg.config.ambiente === "homologacao" ? TETO_DIARIO_HOMOLOGACAO : null,
        // (portal, 16/09/2026, revisão do conjunto) O relatório vai inteiro porque a tela da análise
        // desenha dele os dados cadastrais e a tabela de restrições (`ResultadoCredito`), que é o que o
        // time da Cecílio usa para aprovar com restrição. O que muda é QUAL consulta: no portal, só a
        // que ele mesmo fez e pagou (`RecorteDaConsulta.incorporadorId`); a da Careli na mesma ficha
        // (D5) nunca chega aqui.
        ultimaConsulta: recente ? { ...recente, veredito } : null,
      },
    },
    headers: { "Cache-Control": "no-store" },
    status: 200,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════════════════
// O VEREDITO NA ESTEIRA: o mesmo caminho para a consulta nova e para a guardada (portal)
// ═══════════════════════════════════════════════════════════════════════════════════════════

type TransicaoDoCredito = Awaited<ReturnType<typeof atualizarEtapa>>;

async function levarVereditoParaEsteira(input: {
  autor: AutorDoCredito;
  client: AdminClient;
  ehConjuge: boolean;
  enterpriseId: null | number | string | undefined;
  entityId: string;
  veredito: Veredito;
}): Promise<{
  disparo: unknown;
  etapaNaoGravada: null | string;
  transicao: null | TransicaoDoCredito;
}> {
  const { autor, client, ehConjuge, entityId, veredito } = input;

  // Pré-venda DESLIGADA no empreendimento (ex.: fila já montada, PIX encerrado): o aprovado vai
  // DIRETO para credenciado, sem gerar PIX. Ligada (padrão) segue para pré-venda como sempre.
  const prevendaHabilitada = await resolverPrevendaHabilitada(client, entityId, input.enterpriseId);
  // Destino pela regra única (PROBLEMA 1 + 2, Lucas 04/08): aprovado -> prevenda se ligada, senão
  // credenciado; reprovado -> revisao (trava). Antes o `? "prevenda" : "credenciado"` vivia
  // repetido aqui e no caminho da análise desligada; agora é `destinoAposCredito`.
  const destino = destinoAposCredito({ aprovado: veredito.aprovado, prevendaHabilitada });
  // O CÔNJUGE SÓ AJUDA, NUNCA ATRAPALHA (regra do Lucas, 27/07):
  //   • titular reprovado -> ficha vai para "Crédito em revisão", como sempre;
  //   • cônjuge aprovado  -> RESGATA a ficha e o credenciamento segue, porque a renda que
  //     sustenta a compra é a dele;
  //   • cônjuge reprovado -> não mexe em nada. A ficha já está em revisão pelo titular, e se o
  //     titular tinha sido aprovado seria errado derrubá-lo por causa do cônjuge: quem tem
  //     crédito é ele.
  //
  // O `nuncaRebaixar` continua valendo, então nem o resgate nem a aprovação normal desfazem
  // decisão humana de quem já está em pré-venda ou credenciado.
  // ⚠️ CÔNJUGE APROVADO NÃO MOVE A FICHA SOZINHO, decisão do Lucas (22/08): *"posso fazer análise
  // de crédito do cônjuge, contudo eu tenho que aprovar se segue o cadastro pelo cônjuge ou não,
  // não pode ser automático"*.
  //
  // Antes, cônjuge aprovado disparava `atualizarEtapa` na hora e o credenciamento seguia. Só que
  // seguir pela renda do cônjuge é escolha comercial, não consequência do score: muda quem
  // assina, o regime de bens pesa, e o titular reprovado continua no contrato. Agora a consulta
  // só INFORMA; quem move a ficha é o operador, pelo botão "Seguir o credenciamento pelo
  // cônjuge", que passa por `atualizarEtapa` com autor humano e motivo registrado.
  //
  // Cônjuge REPROVADO segue sem mexer em nada, como já era: a ficha está em revisão pelo titular.
  //
  // ⚠️ `automatico: true` = SEM REGRESSÃO. Quem já está em pré-venda ou credenciado não é movido
  // por reconsulta: ou o coordenador já liberou o crédito, ou a pessoa já PAGOU. Sem essa trava,
  // reconsultar uma ficha credenciada a devolvia para revisão e desfazia a decisão humana.
  const transicao = ehConjuge
    ? null
    : await atualizarEtapa(client, entityId, destino, {
        atualizadoPor: idDoAutor(autor),
        automatico: true,
        enterpriseId: input.enterpriseId ?? null,
        motivo: veredito.aprovado ? undefined : `Crédito reprovado. ${veredito.motivo}`,
        nuncaRebaixar: veredito.aprovado,
      });

  // DISPARO AUTOMÁTICO da reprovação: reprovou -> avisa o coordenador do empreendimento (sempre) e
  // o corretor (se tiver telefone), com a CAD anexa, pela Iris. Best-effort: falha no disparo NÃO
  // derruba a consulta (que já foi cobrada e gravada); o resultado vai na resposta pra tela
  // mostrar, e o reenvio manual cobre o que falhar.
  //
  // ⚠️ Só avisa se a ficha REALMENTE foi para revisão. Quando a etapa é mantida (a pessoa já está
  // em pré-venda/credenciado, protegida contra regressão), avisar de novo seria dizer ao
  // coordenador que um cliente já aprovado, ou que já pagou, foi reprovado.
  // Cônjuge reprovado não avisa ninguém: `transicao` é null e a ficha não mudou de etapa;
  // avisar sem mudar seria alarme falso. Cônjuge aprovado também não cai aqui (é aprovação).
  // A ETAPA GRAVOU? A consulta já foi feita e cobrada, então aqui não se devolve erro seco: o
  // resultado do crédito vai na resposta de qualquer jeito. O que NÃO pode acontecer é a resposta
  // afirmar uma etapa que o banco não tem: a tela move o card e o próximo reload desfaz. Quando
  // não gravou, `etapa` volta null e o aviso vai junto, para a tela dizer o que resolver.
  const etapaNaoGravada = transicao?.error ?? null;

  let disparo: unknown = null;
  // ⚠️ Não avisa ninguém sem gravação (era a task #38): dizer ao coordenador que o cliente foi para
  // revisão, quando a esteira não registrou nada, é criar trabalho para uma ficha que a tela vai
  // mostrar em Validação de novo no minuto seguinte.
  if (transicao && !etapaNaoGravada && !veredito.aprovado && !transicao.mantida) {
    // ⚠️ O AVISO NÃO SAI MAIS DAQUI. Ele agora é disparado por `atualizarEtapa`, que é o ponto
    // autoritativo de escrita de etapa, e vem de volta em `transicao.aviso`.
    //
    // Regra do Lucas (21/08): *"reforço que os disparos têm que ser feitos pelo número do
    // relacionamento"*. O caminho antigo (`dispararReprovacao`) saía do 4143 com template da Meta,
    // e o ramo do CORRETOR ali era estruturalmente morto: lia `metadata.phone` do vínculo do
    // cliente, campo vazio em 718 de 718 CADs, o que explica `apolo_disparos` ter 2.249 linhas e
    // ZERO do tipo `corretor`. O caminho novo lê `corretor_entity_id` e cai na imobiliária quando
    // o corretor não está vinculado.
    //
    // O PDF da CAD continua indo junto para o coordenador: `esteira-avisos` anexa na `revisao`.
    disparo = transicao.aviso ?? null;

    // Avisa também a IMOBILIÁRIA (só o STATUS, nunca o valor do crédito). Best-effort próprio.
    //
    // ⚠️ CONTINUA SEPARADO de propósito: este aviso é do fluxo da imobiliária (outro texto, outro
    // destinatário resolvido por outro caminho) e sobrevive mesmo quando a CAD não tem corretor.
    try {
      await avisarImobReprovado(client, entityId);
    } catch {
      /* segue */
    }
  }

  return { disparo, etapaNaoGravada, transicao };
}

// ═══════════════════════════════════════════════════════════════════════════════════════════
// POST: a CONSULTA de verdade (paga)
// ═══════════════════════════════════════════════════════════════════════════════════════════

export async function consultarCredito(input: {
  autor: AutorDoCredito;
  client: AdminClient;
  corpo: CorpoDaConsulta;
}): Promise<RespostaDoCredito> {
  const { autor, client, corpo } = input;
  const doPortal = autor.tipo === "portal";

  // (portal) As frases do hub continuam byte a byte; as do portal têm acento e não citam variável de
  // ambiente nem detalhe interno (revisão de 16/09/2026).
  const frase = (hub: string, portal: string): string => (doPortal ? portal : hub);

  if (!corpo.confirmado) {
    return {
      corpo: {
        error: frase(
          "Esta acao CONSULTA O SERASA e pode ser cobrada. Confirme na tela.",
          "Esta ação consulta o Serasa e pode ser cobrada. Confirme na tela.",
        ),
      },
      status: 428,
    };
  }
  if (!corpo.entityId) {
    return { corpo: { error: "Informe a ficha." }, status: 400 };
  }

  const cfg = lerConfigSerasa();
  if (!cfg.ok) {
    return {
      corpo: {
        error: frase(
          `Integracao nao configurada. Falta: ${cfg.faltando.join(", ")}.`,
          MENSAGEM_INDISPONIVEL_NO_PORTAL,
        ),
      },
      status: 503,
    };
  }

  const coerente = ambienteConfere(cfg.config);
  if (!coerente.ok) {
    return {
      corpo: { error: frase(coerente.erro ?? "Ambiente incoerente.", MENSAGEM_INDISPONIVEL_NO_PORTAL) },
      status: 409,
    };
  }

  // De quem é a consulta: o documento vem da ficha, nunca do corpo da requisição; assim
  // ninguém consulta um CPF arbitrário por esta rota.
  const { data: entidade } = await client
    .from("apolo_entities")
    .select("id, display_name, document_masked, entity_kind")
    .eq("id", corpo.entityId)
    .maybeSingle<{
      display_name: string;
      document_masked: string | null;
      entity_kind: string;
      id: string;
    }>();

  if (!entidade) {
    return { corpo: { error: frase("Ficha nao encontrada.", "Ficha não encontrada.") }, status: 404 };
  }

  // CÔNJUGE (pedido do Lucas 27/07): quando o cliente é casado, dá pra consultar também quem
  // compra junto. O CPF sai da FICHA da esteira (`ficha.conjugeCpf`), nunca do corpo da
  // requisição: mesma regra do titular, ninguém consulta um CPF arbitrário por esta rota.
  //
  // O cônjuge não é entidade própria no Apolo, é campo dentro da ficha do titular. Por isso a
  // consulta é sempre PF e o registro fica pendurado no `entity_id` do titular, separado pela
  // `finalidade`.
  const ehConjuge = corpo.alvo === "conjuge";
  let documentoDoConjuge = "";

  if (ehConjuge) {
    // ⚠️ CONSULTA PAGA. O CPF do cônjuge sai da FICHA, e a ficha é POR CAD. Sem escopo, uma
    // pessoa com CAD em dois loteamentos poderia ter o cônjuge de uma ficha consultado na outra.
    const esteira = await lerCadDaEsteira<{ ficha: Record<string, unknown> | null }>(
      client,
      entidade.id,
      "ficha",
      { enterpriseId: corpo.enterpriseId },
    );

    const bruto = esteira?.ficha?.conjugeCpf;
    documentoDoConjuge = typeof bruto === "string" ? bruto.replace(/\D/g, "") : "";

    // O aviso que o Lucas pediu: sem CPF do cônjuge não há o que consultar, e a mensagem diz
    // onde resolver. Hoje 80 dos 103 casados do Vale do Ouro caem aqui.
    if (!documentoDoConjuge) {
      return {
        corpo: {
          error: frase(
            "Sem o CPF do conjuge nao da para consultar. Preencha o CPF do conjuge na ficha " +
              "do cliente e tente de novo.",
            "Sem o CPF do cônjuge não dá para consultar. Preencha o CPF do cônjuge na ficha " +
              "do cliente e tente de novo.",
          ),
        },
        status: 412,
      };
    }
  }

  const documento = ehConjuge
    ? documentoDoConjuge
    : (entidade.document_masked ?? "").replace(/\D/g, "");
  const ehPj = !ehConjuge && entidade.entity_kind === "pj";
  const tamanhoEsperado = ehPj ? 14 : 11;

  if (documento.length !== tamanhoEsperado) {
    return {
      corpo: {
        error: ehConjuge
          ? frase(
              `O CPF do conjuge na ficha esta incompleto (${documento.length} digitos). ` +
                "Corrija na ficha do cliente e tente de novo.",
              `O CPF do cônjuge na ficha está incompleto (${documento.length} dígitos). ` +
                "Corrija na ficha do cliente e tente de novo.",
            )
          : frase(
              `A ficha nao tem ${ehPj ? "CNPJ" : "CPF"} completo para consultar ` +
                `(${documento.length} digitos). Complete o cadastro antes.`,
              `A ficha não tem ${ehPj ? "CNPJ" : "CPF"} completo para consultar ` +
                `(${documento.length} dígitos). Complete o cadastro antes.`,
            ),
      },
      status: 412,
    };
  }

  // SEM CAD NA ESTEIRA A CONSULTA NÃO TEM PARA ONDE IR, e ela é PAGA (Lucas, 10/08: "cliente
  // que já teve análise de crédito feito voltando para validação").
  //
  // `atualizarEtapa` recusa gravar quando não há empreendimento (esteira.ts:148), de propósito, para
  // não criar CAD órfã. Só que a consulta já tinha sido feita e cobrada, e a resposta ainda dizia
  // que a ficha avançou. Na recarga do Board o card volta para Validação, porque não existe linha na
  // esteira para dizer onde ele está. Foi exatamente o que aconteceu com uma ficha do Vale do Ouro:
  // QUATRO consultas cobradas (04/08, 06/08, 07/08 e 10/08), a tela dizendo "avançou" toda vez, e o
  // card de volta em Validação toda vez.
  //
  // Barramos ANTES de gastar, com a saída escrita na mensagem: o empreendimento se informa no
  // cadastro. A leitura é a mesma da esteira (CAD do empreendimento pedido, ou a mais recente).
  const cadDoCredito = await lerCadDaEsteira<{ enterprise_id: null | string }>(
    client,
    entidade.id,
    "enterprise_id",
    { enterpriseId: corpo.enterpriseId },
  );
  if (!(cadDoCredito?.enterprise_id ?? "").trim()) {
    return {
      corpo: {
        error:
          "Esta ficha não tem CAD com empreendimento na esteira, então o resultado do crédito não " +
          "teria onde ser gravado (e a ficha voltaria para a Validação). Informe o empreendimento " +
          "no cadastro antes de consultar.",
      },
      status: 409,
    };
  }

  // Dígito verificador do CPF: a MOST às vezes lê um dígito errado (ex.: 106… no lugar de 166…) e
  // a ficha nasce com CPF impossível. O Serasa rejeita com 412 "[X-Document-Id] inválido" e a
  // chamada pode ser COBRADA: barramos ANTES de gastar.
  if (!ehPj && !cpfValido(documento)) {
    return {
      corpo: {
        error:
          "O CPF da ficha é inválido (o dígito verificador não confere). Corrija o CPF na " +
          "validação antes de consultar o crédito.",
      },
      status: 412,
    };
  }

  // (16/09/2026) O CNPJ TAMBÉM, nas duas portas. Até aqui só o CPF era conferido ("CNPJ tem regra
  // própria"), e a regra própria existia desde a edição de identidade (`cnpjValido`) sem ninguém
  // ligá-la aqui: um CNPJ com dígito trocado ia ao Serasa, voltava 412 e podia ser cobrado.
  if (ehPj && !cnpjValido(documento)) {
    return {
      corpo: {
        error:
          "O CNPJ da ficha é inválido (o dígito verificador não confere). Corrija o CNPJ na " +
          "validação antes de consultar o crédito.",
      },
      status: 412,
    };
  }

  // ANÁLISE DE CRÉDITO DESLIGADA no empreendimento: o lançamento não faz crédito, então NÃO
  // consultamos o Serasa (consulta é paga). A ficha com documento OK avança direto: pré-venda se
  // ela estiver ligada, senão credenciado. Mesmo destino de um "aprovado", só que sem consulta.
  const analiseHabilitada = await resolverAnaliseHabilitada(client, entidade.id, corpo.enterpriseId);
  if (!analiseHabilitada) {
    const prevendaHabilitada = await resolverPrevendaHabilitada(
      client,
      entidade.id,
      corpo.enterpriseId,
    );
    // Sem consulta = tratamos como "aprovado" (documento OK), então o destino segue a MESMA regra
    // do crédito aprovado: prevenda se ligada, senão credenciado (PROBLEMA 1, Lucas 04/08).
    const destino = destinoAposCredito({ aprovado: true, prevendaHabilitada });
    const transicao = await atualizarEtapa(client, entidade.id, destino, {
      atualizadoPor: idDoAutor(autor),
      automatico: true,
      enterpriseId: corpo.enterpriseId ?? null,
      motivo: "Análise de crédito desligada no empreendimento — avançou sem consulta.",
      nuncaRebaixar: true,
    });

    // A ETAPA GRAVOU? Se não, a resposta NÃO pode dizer que avançou (ver o bloco do "sem CAD" mais
    // acima). Devolver o alvo calculado como se fosse o gravado é o que fazia a tela mover o card e
    // o reload trazer ele de volta.
    if (transicao.error) {
      return {
        corpo: { error: transicao.error },
        status: transicao.semCad || transicao.bloqueado ? 409 : 500,
      };
    }

    return {
      corpo: {
        data: {
          analisePulada: true,
          etapa: transicao.etapa,
          mensagem:
            "Análise de crédito desligada neste empreendimento. A ficha avançou sem consulta ao Serasa.",
          reaproveitada: false,
        },
      },
      status: 200,
    };
  }

  // O RELATÓRIO é escolhido pelo TIPO da ficha, no servidor; a tela não decide. PF e PJ são
  // serviços diferentes no Serasa, com relatórios de nomes diferentes; mandar o relatório de PF
  // numa consulta PJ dá "report not found" (412). Cada tipo tem a sua env própria.
  //
  // (portal) O override da tela NÃO vale: o relatório é o do servidor. Quem é de fora não escolhe
  // um relatório mais caro para sair na conta da Careli.
  const overrideTela = doPortal ? null : corpo.reportName?.trim() || null;
  const reportName = ehPj
    ? // PJ: a env é a fonte da verdade. O override da tela só entra se NÃO for um nome de PF
      // (o front hoje manda RELATORIO_BASICO_PF_PME por padrão; esse nunca vale para PJ).
      process.env.SERASA_REPORT_PJ?.trim() ||
      (overrideTela && !/PF|PME/i.test(overrideTela) ? overrideTela : null)
    : // PF: mantém o que já funcionava: env, senão o que a tela manda, senão o default.
      process.env.SERASA_REPORT_PF?.trim() || overrideTela || "RELATORIO_BASICO_PF_PME";

  if (!reportName) {
    return {
      corpo: {
        error: frase(
          "Consulta de PJ ainda nao configurada: falta o NOME do relatorio PJ contratado no " +
            "Serasa. Defina a variavel de ambiente SERASA_REPORT_PJ com a grafia exata do relatorio " +
            "(ex.: RELATORIO_BASICO_PJ) e a consulta de CNPJ passa a rodar.",
          MENSAGEM_INDISPONIVEL_NO_PORTAL,
        ),
      },
      status: 412,
    };
  }

  const alvo: RecorteDaConsulta["alvo"] = ehConjuge ? "conjuge" : "titular";

  // ⚠️ SEM SABER SE JÁ CONSULTOU, NÃO CONSULTA (revisão de 16/09/2026). A leitura que falha lança
  // (`situacao`), e aqui ela vira 503 ANTES de gastar, nas duas portas. Antes, um timeout nesta
  // leitura virava "nenhuma consulta recente" e o mesmo CPF era cobrado de novo.
  let leitura: { consultasHoje: number; recente: ConsultaGuardada | null };
  try {
    leitura = await situacao(client, documento, {
      ambiente: doPortal ? cfg.config.ambiente : null,
      cad:
        autor.tipo === "portal"
          ? { alvo, entityId: entidade.id, incorporadorId: autor.incorporadorId }
          : undefined,
    });
  } catch (erro) {
    console.error("[serasa] leitura das consultas anteriores falhou; nada foi consultado", {
      entityId: entidade.id,
      erro: (erro as Error).message,
      origem: autor.tipo,
    });
    return {
      corpo: {
        error:
          "Não foi possível conferir as consultas anteriores deste documento agora. Nada foi consultado nem cobrado. Tente de novo em instantes.",
      },
      status: 503,
    };
  }
  const { consultasHoje, recente } = leitura;

  // Trava de duplicidade: consulta recente do mesmo documento é reaproveitada, a não ser que
  // se peça explicitamente uma nova (e aí a tela já avisou que gera cobrança) e quem pede possa
  // cobrar de novo (`podeForcarNovaConsulta`: no hub, só a coordenação; o portal, nunca).
  if (recente && !(corpo.forcar && podeForcarNovaConsulta(autor))) {
    if (autor.tipo === "hub") {
      // Sem `forcar`: a MESMA resposta de sempre.
      if (!corpo.forcar) {
        return { corpo: { data: { consultaAnterior: recente, reaproveitada: true } }, status: 200 };
      }
      // (16/09/2026, D9) O ANALISTA PEDIU NOVA CONSULTA DENTRO DA JANELA: não cobra, devolve a
      // guardada e diz quem pode cobrar de novo. No cônjuge vai também o veredito da guardada (com o
      // limite do empreendimento desta CAD, como o painel calcula): o botão do cônjuge manda `forcar`
      // sempre, e sem o veredito a tela do analista não mostraria resultado nenhum do cônjuge. Nada
      // se move na esteira (sem `etapa`), igual à consulta do cônjuge de sempre.
      const doConjuge =
        ehConjuge && recente.resposta !== null && recente.resposta !== undefined
          ? {
              alvo: "conjuge" as const,
              veredito: avaliarCredito(
                recente.resposta,
                (await resolverLimiteCredito(client, entidade.id, corpo.enterpriseId)) ?? 1000,
              ),
            }
          : {};
      return {
        corpo: {
          data: {
            consultaAnterior: recente,
            forcarRecusado: true,
            mensagem: MENSAGEM_SO_COORDENACAO_FORCA,
            reaproveitada: true,
            ...doConjuge,
          },
        },
        status: 200,
      };
    }
    return reaproveitarNoPortal({
      alvo,
      autor,
      client,
      corpo,
      ehConjuge,
      entityId: entidade.id,
      recente,
    });
  }

  // (portal) O freio de gasto, antes de qualquer chamada paga.
  if (autor.tipo === "portal") {
    const freio = await freioDoPortal({
      alvo,
      ambiente: cfg.config.ambiente,
      autor,
      client,
      documento,
      entityId: entidade.id,
    });
    if (freio) return freio;
  }

  // Teto diário: em homologação, estourar bloqueia o IP e a liberação exige formalização.
  if (cfg.config.ambiente === "homologacao" && consultasHoje >= TETO_DIARIO_HOMOLOGACAO) {
    return {
      corpo: {
        error: frase(
          `Teto diario de homologacao atingido (${consultasHoje}). O Serasa bloqueia o IP ` +
            `acima de 200 chamadas por dia. Tente amanha.`,
          "O limite diário de consultas de teste foi atingido. Tente amanhã.",
        ),
      },
      status: 429,
    };
  }

  const entrada = {
    documento,
    // (portal) Sem opcionais: cada um pode ter preço próprio no contrato do Serasa.
    optionalFeatures: doPortal ? [] : (corpo.optionalFeatures ?? []),
    reportName,
  };

  // O que o registro da cobrança carrega de qualquer jeito (sucesso, erro ou reserva).
  const autorDoRegistro = autorParaRegistro(autor);
  const baseDoRegistro = {
    ambiente: cfg.config.ambiente,
    cost_center: cfg.config.costCenter,
    documento,
    entity_id: entidade.id,
    // Separa as duas consultas do mesmo cliente sem precisar de coluna nova: `entity_id` é o
    // titular nos dois casos, e a finalidade diz de quem é o resultado.
    finalidade: ehConjuge
      ? FINALIDADE_CONJUGE
      : (doPortal ? "" : corpo.finalidade?.trim()) || "analise-credito-cad",
    optional_features: entrada.optionalFeatures,
    report_name: entrada.reportName,
    solicitado_por: pareceUuid(idDoAutor(autor)) ? idDoAutor(autor) : null,
    tipo_pessoa: ehPj ? "pj" : "pf",
  };

  // (portal) RESERVA ANTES DE GASTAR: a linha com o autor existe antes da chamada, e o clique
  // concorrente do mesmo documento desiste em vez de cobrar em dobro.
  let reservaId: null | string = null;
  if (autorDoRegistro) {
    const reserva = await reservarConsultaDoPortal({
      autorDoRegistro,
      base: baseDoRegistro,
      client,
    });
    if (!reserva.ok) return reserva.resposta;
    reservaId = reserva.id;

    // (16/09/2026, revisão do conjunto) O freio contou ANTES da reserva; aqui ele confere de novo, já
    // com a fila de reservas gravada (ver `tetoDepoisDaReserva`).
    if (autor.tipo === "portal") {
      const estourou = await tetoDepoisDaReserva({
        ambiente: cfg.config.ambiente,
        autor,
        client,
        criadaEm: reserva.criadaEm,
        reservaId: reserva.id,
      });
      if (estourou) return estourou;
    }
  }

  const resposta = ehPj
    ? await consultarPJ(cfg.config, entrada)
    : await consultarPF(cfg.config, entrada);

  // Grava SEMPRE, inclusive o erro: a chamada pode ter sido cobrada mesmo falhando, e sem
  // registro ninguém consegue reconciliar a fatura depois.
  const resumoBase = resposta.ok ? resumirRelatorio(resposta.corpo) : {};
  const registro = {
    ...baseDoRegistro,
    erro: resposta.ok ? null : resposta.erro,
    http_status: resposta.httpStatus,
    resposta: resposta.ok ? resposta.corpo : null,
    // (portal) QUEM CONSULTOU vai junto do extrato, no mesmo registro da cobrança. É o lugar onde a
    // conferência da fatura já olha, e ele não é apagado pelo sync do C2X (0059).
    resumo: autorDoRegistro ? { ...resumoBase, autor: autorDoRegistro } : resumoBase,
    status: resposta.ok ? "sucesso" : "erro",
  };

  // Hub: o insert de sempre. Portal: a reserva vira o registro (update idempotente, então dá para
  // tentar de novo sem duplicar a linha da cobrança).
  const gravacao = reservaId
    ? await finalizarReservaDoPortal(client, reservaId, registro)
    : await client
        .from("serasa_consultas")
        .insert(registro)
        .select("id, created_at, resumo, ambiente")
        .maybeSingle();
  const gravada = gravacao.data;

  // (16/09/2026, revisão) ⚠️ O ERRO DA GRAVAÇÃO NÃO É MAIS DESCARTADO. A consulta já foi paga: sem a
  // linha, a fatura não tem autor e o próximo clique cobra de novo. Fica no log (documento mascarado)
  // e a tela recebe o aviso. No portal, a reserva com a marca "em andamento" continua lá, com o autor.
  const registroNaoGravado = Boolean(gravacao.error) || !gravada;
  if (registroNaoGravado) {
    console.error("[serasa] a consulta saiu, mas o registro da cobrança não gravou", {
      autor: autorDoRegistro ?? { origem: "hub", userId: idDoAutor(autor) },
      documentoFinal: documento.slice(-3),
      entityId: entidade.id,
      erro: gravacao.error?.message ?? "sem linha devolvida",
      httpStatus: resposta.httpStatus,
      reservaId,
    });
  }
  const avisoDoRegistro = registroNaoGravado
    ? {
        mensagem:
          "A consulta foi feita, mas o registro dela não foi gravado. Avise a Careli antes de consultar de novo.",
        registroNaoGravado: true,
      }
    : {};

  if (!resposta.ok) {
    const registroId = (gravada as { id: string } | null)?.id ?? reservaId ?? null;
    return {
      corpo: {
        // (portal) O erro do Serasa traz código, dica de configuração e trecho da resposta crua:
        // para quem é de fora, só o fato e a saída.
        error: frase(
          resposta.erro,
          `O Serasa não concluiu a consulta${resposta.httpStatus ? ` (código ${resposta.httpStatus})` : ""}. ` +
            "A tentativa ficou registrada; se o erro se repetir, fale com a Careli.",
        ),
        registroId,
      },
      // (portal) 502 sempre: o status cru do Serasa (401, 404) se confundiria com os da porta.
      status: doPortal ? 502 : (resposta.httpStatus ?? 502),
    };
  }

  // GATILHO DA ESTEIRA: o resultado do crédito move a etapa automaticamente. Aprovado segue para
  // a PRÉ-VENDA (sem rebaixar quem já passou); reprovado vai para "Crédito em revisão" com o
  // motivo, de onde só o coordenador/admin destrava. A decisão é do servidor, não da tela: é o
  // ponto autoritativo, logo depois de gravar a consulta.
  // O limite vem do EMPREENDIMENTO do cliente (best-effort); sem limite próprio, padrão R$ 1.000.
  const limiteResolvido = await resolverLimiteCredito(client, entidade.id, corpo.enterpriseId);
  const veredito = avaliarCredito(resposta.corpo, limiteResolvido ?? 1000);

  // CONGELA O VEREDITO NA CONSULTA: "a etapa tem que ser marcada" (Lucas, 21/08).
  //
  // ⚠️ ATÉ AQUI O RESULTADO NÃO ERA GUARDADO EM LUGAR NENHUM: ele era RECALCULADO a cada leitura
  // (aqui e no GET) a partir do JSON cru, usando o limite ATUAL do empreendimento. Como esse
  // limite é editável, o mesmo relatório podia virar APROVADO no dia seguinte sem ninguém
  // reconsultar nada, e o contrário também. O único rastro da decisão era a etapa.
  //
  // Guardado junto do `resumo` para não custar coluna nova. Best-effort e DEPOIS do insert: a
  // consulta já foi cobrada e gravada, e um carimbo que falha não pode derrubá-la.
  const idConsulta = (gravada as { id?: string } | null)?.id ?? null;
  if (idConsulta) {
    try {
      const resumoAtual = ((gravada as { resumo?: Record<string, unknown> } | null)?.resumo ??
        {}) as Record<string, unknown>;
      await client
        .from("serasa_consultas")
        .update({
          resumo: {
            ...resumoAtual,
            veredito: {
              aprovado: veredito.aprovado,
              avaliadoEm: new Date().toISOString(),
              // O limite VIGENTE no momento da decisão. É ele que explica, meses depois, por que
              // esta consulta reprovou e outra igual passou.
              limite: limiteResolvido ?? 1000,
              motivo: veredito.motivo ?? null,
            },
          },
        })
        .eq("id", idConsulta);
    } catch {
      /* segue: o veredito volta a ser recomputado, como era antes */
    }
  }

  const { disparo, etapaNaoGravada, transicao } = await levarVereditoParaEsteira({
    autor,
    client,
    ehConjuge,
    enterpriseId: corpo.enterpriseId,
    entityId: entidade.id,
    veredito,
  });

  // COMPROVANTE da consulta + CAD da ficha: ambos gerados e salvos na pasta do cliente,
  // automaticamente (pedido do Lucas). Best-effort: falha aqui não derruba a consulta já cobrada
  // e gravada. Todo resultado (aprovado ou reprovado) tem comprovante e CAD.
  // ⚠️ NADA DISSO RODA PARA O CÔNJUGE. Comprovante e CAD são documentos DO TITULAR e são
  // montados a partir da "última consulta da ficha". Como a consulta do cônjuge fica gravada no
  // entity_id do titular, gerar aqui produziria: (1) uma CAD do titular carimbada com o
  // resultado do cônjuge, apagando a anterior, porque salvar-cad substitui a automática; e
  // (2) um comprovante com o NOME do titular e o CPF, o score e as restrições do cônjuge, ou
  // seja, um documento falso, com QR de verificação, salvo na pasta do cliente.
  const idGravada = ehConjuge ? null : (gravada as { id?: string } | null)?.id;
  if (idGravada) {
    const quem = pareceUuid(idDoAutor(autor)) ? "Análise de crédito" : null;
    // Best-effort E com teto de tempo: a consulta já foi cobrada e gravada; comprovante e CAD não
    // podem estourar o maxDuration (504) sob C2X lento. O que não der tempo é gerado depois (a
    // próxima transição regenera a CAD; o botão baixa/gera o comprovante).
    try {
      // (portal) O comprovante pago pelo portal nasce com o empreendimento da CAD. Sem a marca, a
      // régua de documentos trata o crédito como documento pessoal para o comercial, e a Gurgel
      // abriria o score de uma análise que o Cecílio fez para a CAD dele (bastava a pessoa ter CAD
      // nos dois produtos). O hub não marca: mudaria o que o comercial vê dos comprovantes da Careli.
      //
      // (16/09/2026) A MARCA VAI NA MESMA GRAVAÇÃO (`metadataExtra`), e não num update depois: o
      // update deixava o comprovante sem dono se falhasse, e o "Baixar comprovante" do hub, ao
      // regerar, apagava a marca (agora `gerarESalvarComprovante` herda a do anterior).
      const marca = doPortal
        ? (normalizarEnterpriseId(corpo.enterpriseId) ??
          normalizarEnterpriseId(cadDoCredito?.enterprise_id))
        : null;
      await comLimiteDeTempo(
        gerarESalvarComprovante(
          client,
          idGravada,
          marca
            ? { metadataExtra: { enterpriseId: marca }, uploadedByName: quem }
            : { uploadedByName: quem },
        ),
        15000,
      );
    } catch {
      /* segue */
    }
    try {
      await comLimiteDeTempo(
        gerarESalvarCad(client, entidade.id, {
          enterpriseId: corpo.enterpriseId ?? null,
          uploadedByName: quem,
        }),
        15000,
      );
    } catch {
      /* segue */
    }
  }

  return {
    corpo: {
      data: {
        alvo: ehConjuge ? "conjuge" : "titular",
        consulta: gravada,
        disparo,
        etapa: etapaNaoGravada ? null : (transicao?.etapa ?? null),
        // Preenchido só quando a esteira RECUSOU a gravação. A tela mostra como aviso, e não move
        // o card: melhor a consulta aparecer sem etapa do que a etapa aparecer sem existir.
        etapaNaoGravada,
        reaproveitada: false,
        veredito,
        ...avisoDoRegistro,
      },
    },
    status: 200,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════════════════
// (portal) O FREIO DE GASTO E A RESERVA
// ═══════════════════════════════════════════════════════════════════════════════════════════

/**
 * (portal) Pode sair uma consulta PAGA agora? `null` = pode; senão, a recusa pronta.
 *
 * Existe porque a consulta do portal sai na conta da Careli e, até a revisão de 16/09/2026, nada a
 * limitava em produção. Quatro contas, todas no ambiente da consulta, e todas antes da chamada:
 *   1. a CAD já teve consulta paga de OUTRO documento do mesmo alvo na janela (a do mesmo documento
 *      teria sido reaproveitada). É o que fecha o laço "troca o CPF do cônjuge, consulta": cada CAD
 *      dá uma consulta de titular e uma de cônjuge por janela; a correção de um documento já
 *      consultado passa pela Careli. Medido: 6 de 776 fichas tiveram dois documentos no mesmo alvo;
 *   2. tentativas com ERRO do mesmo documento em 24 horas (a que falha pode ter sido cobrada);
 *   3. consultas do PORTAL em 24 horas;
 *   4. consultas da CONTA em 24 horas.
 * Leitura que falha: 503, nunca "pode".
 */
async function freioDoPortal(input: {
  alvo: RecorteDaConsulta["alvo"];
  ambiente: string;
  autor: Extract<AutorDoCredito, { tipo: "portal" }>;
  client: AdminClient;
  documento: string;
  entityId: string;
}): Promise<null | RespostaDoCredito> {
  const { alvo, ambiente, autor, client, documento, entityId } = input;
  const agora = Date.now();
  const janela = new Date(agora - DIAS_REAPROVEITAMENTO * 24 * 3600 * 1000).toISOString();
  const umDia = new Date(agora - 24 * 3600 * 1000).toISOString();

  const contar = () =>
    client
      .from("serasa_consultas")
      .select("id", { count: "exact", head: true })
      .eq("ambiente", ambiente);

  const daCad = contar().eq("entity_id", entityId).neq("documento", documento).gte("created_at", janela);
  const [outroDocumento, errosDoDocumento, doPortal, daConta] = await Promise.all([
    (alvo === "conjuge"
      ? daCad.eq("finalidade", FINALIDADE_CONJUGE)
      : daCad.neq("finalidade", FINALIDADE_CONJUGE)
    )
      // A reserva "em andamento" de uma função que morreu também conta: ela pode ter sido cobrada.
      .or(`status.eq.sucesso,erro.eq.${MARCA_EM_ANDAMENTO}`),
    contar()
      .eq("documento", documento)
      .eq("status", "erro")
      .neq("erro", MARCA_DESISTIU)
      .gte("created_at", umDia),
    contar().eq("resumo->autor->>slug", autor.slug).gte("created_at", umDia),
    contar().eq("resumo->autor->>usuarioId", autor.usuarioId).gte("created_at", umDia),
  ]);

  const falhou = [outroDocumento, errosDoDocumento, doPortal, daConta].find((r) => r.error);
  if (falhou?.error) {
    console.error("[serasa] freio do portal sem leitura; nada foi consultado", {
      erro: falhou.error.message,
      slug: autor.slug,
    });
    return {
      corpo: {
        error:
          "Não foi possível conferir o limite de consultas agora. Nada foi consultado nem cobrado. Tente de novo em instantes.",
      },
      status: 503,
    };
  }

  const recusa = (error: string): RespostaDoCredito => ({ corpo: { error }, status: 429 });

  if ((outroDocumento.count ?? 0) > 0) {
    return recusa(
      alvo === "conjuge"
        ? "Esta CAD já teve o crédito de outro CPF de cônjuge consultado nos últimos 30 dias. Uma nova consulta com outro documento é feita pela Careli."
        : "Esta CAD já teve o crédito de outro documento do titular consultado nos últimos 30 dias. Uma nova consulta com outro documento é feita pela Careli.",
    );
  }
  if ((errosDoDocumento.count ?? 0) >= TETO_ERROS_DOCUMENTO_24H) {
    return recusa(
      "A consulta deste documento falhou mais de uma vez nas últimas 24 horas. Peça à Careli para conferir antes de tentar de novo.",
    );
  }
  if ((doPortal.count ?? 0) >= TETO_PORTAL_24H) {
    return recusa(
      `O portal atingiu o limite de ${TETO_PORTAL_24H} consultas de crédito em 24 horas. Para seguir hoje, fale com a Careli.`,
    );
  }
  if ((daConta.count ?? 0) >= TETO_USUARIO_PORTAL_24H) {
    return recusa(
      `Sua conta atingiu o limite de ${TETO_USUARIO_PORTAL_24H} consultas de crédito em 24 horas. Para seguir hoje, fale com a Careli.`,
    );
  }
  return null;
}

type BaseDoRegistro = Record<string, unknown> & { documento: string; entity_id: string };

/**
 * (portal) Grava a linha da cobrança ANTES de chamar o Serasa e confere se ninguém chegou antes.
 *
 * ⚠️ POR QUE NÃO BASTA O "LER E DEPOIS GRAVAR" DO HUB. Entre a leitura "sem consulta recente" e o
 * insert passam os segundos da chamada ao Serasa: dois cliques no mesmo card (duas abas, dois
 * usuários, um script) liam "nada" e pagavam as duas. Sem migration não há trava no banco, então a
 * régua é a de fila: cada pedido grava a sua reserva e só segue quem for a reserva MAIS ANTIGA viva
 * (ou não houver consulta com sucesso recém-gravada) para a mesma ficha e o mesmo documento. Quem
 * chega depois desiste, marca a própria reserva como "sem chamada" e recebe 409.
 * Falha em qualquer passo: 503, sem chamar.
 */
async function reservarConsultaDoPortal(input: {
  autorDoRegistro: Record<string, string>;
  base: BaseDoRegistro;
  client: AdminClient;
}): Promise<{ criadaEm: string; id: string; ok: true } | { ok: false; resposta: RespostaDoCredito }> {
  const { autorDoRegistro, base, client } = input;
  const indisponivel: RespostaDoCredito = {
    corpo: {
      error:
        "Não foi possível registrar a consulta antes de fazê-la. Nada foi consultado nem cobrado. Tente de novo em instantes.",
    },
    status: 503,
  };

  const { data: reserva, error } = await client
    .from("serasa_consultas")
    .insert({
      ...base,
      erro: MARCA_EM_ANDAMENTO,
      http_status: null,
      resposta: null,
      resumo: { autor: autorDoRegistro },
      status: "erro",
    })
    .select("id, created_at")
    .maybeSingle<{ created_at: string; id: string }>();
  if (error || !reserva?.id) {
    console.error("[serasa] reserva do portal não gravou; nada foi consultado", {
      erro: error?.message ?? "sem linha devolvida",
      slug: autorDoRegistro.slug,
    });
    return { ok: false, resposta: indisponivel };
  }

  const desistir = () => desistirDaReserva(client, reserva.id);

  const recente = new Date(Date.now() - SEGUNDOS_DA_RESERVA * 1000).toISOString();
  const { data: fila, error: erroFila } = await client
    .from("serasa_consultas")
    .select("id, created_at")
    .eq("documento", base.documento)
    .eq("entity_id", base.entity_id)
    .eq("ambiente", base.ambiente as string)
    .gte("created_at", recente)
    .or(`status.eq.sucesso,erro.eq.${MARCA_EM_ANDAMENTO}`)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true })
    .limit(1);
  if (erroFila) {
    await desistir();
    return { ok: false, resposta: indisponivel };
  }

  const primeira = ((fila ?? []) as Array<{ id: string }>)[0];
  if (primeira && primeira.id !== reserva.id) {
    await desistir();
    return {
      ok: false,
      resposta: {
        corpo: {
          error:
            "Já existe uma consulta deste documento em andamento. Aguarde alguns segundos e atualize a tela: o resultado aparece sem nova cobrança.",
        },
        status: 409,
      },
    };
  }

  return { criadaEm: reserva.created_at, id: reserva.id, ok: true };
}

/** (portal) A reserva que não vai chamar o Serasa vira "desistiu" (não conta como possível cobrança). */
async function desistirDaReserva(client: AdminClient, reservaId: string): Promise<void> {
  try {
    await client.from("serasa_consultas").update({ erro: MARCA_DESISTIU }).eq("id", reservaId);
  } catch {
    /* a marca "em andamento" expira sozinha em SEGUNDOS_DA_RESERVA */
  }
}

/**
 * (portal) Os tetos de 24 horas conferidos DEPOIS de a reserva existir. `null` = cabe.
 *
 * (16/09/2026, revisão do conjunto) ⚠️ O FREIO SOZINHO NÃO SEGURA RAJADA. `freioDoPortal` conta antes de
 * gravar, e a reserva só barra a concorrência do MESMO documento na MESMA ficha: com 49 consultas no
 * dia, 40 pedidos simultâneos de fichas diferentes contavam 49 < 50 e saíam os 40 (89 cobranças). Aqui
 * cada pedido conta só as linhas do portal (e da conta) gravadas ANTES da própria reserva, as reservas
 * em andamento inclusive, pela mesma régua do freio. Na rajada, a reserva de posição 50 em diante
 * desiste (sem chamar o Serasa) e recebe o mesmo 429; as anteriores seguem. Os tetos são os de sempre
 * (D9: 50 por portal, 25 por conta). Leitura que falha desiste e responde 503, nunca cobra.
 */
async function tetoDepoisDaReserva(input: {
  ambiente: string;
  autor: Extract<AutorDoCredito, { tipo: "portal" }>;
  client: AdminClient;
  criadaEm: string;
  reservaId: string;
}): Promise<null | RespostaDoCredito> {
  const { ambiente, autor, client, criadaEm, reservaId } = input;
  const umDia = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const antes = () =>
    client
      .from("serasa_consultas")
      .select("id", { count: "exact", head: true })
      .eq("ambiente", ambiente)
      .gte("created_at", umDia)
      .lt("created_at", criadaEm);

  const [doPortal, daConta] = await Promise.all([
    antes().eq("resumo->autor->>slug", autor.slug),
    antes().eq("resumo->autor->>usuarioId", autor.usuarioId),
  ]);

  if (doPortal.error || daConta.error) {
    await desistirDaReserva(client, reservaId);
    console.error("[serasa] recontagem do teto sem leitura; nada foi consultado", {
      erro: (doPortal.error ?? daConta.error)?.message,
      slug: autor.slug,
    });
    return {
      corpo: {
        error:
          "Não foi possível conferir o limite de consultas agora. Nada foi consultado nem cobrado. Tente de novo em instantes.",
      },
      status: 503,
    };
  }

  if ((doPortal.count ?? 0) >= TETO_PORTAL_24H) {
    await desistirDaReserva(client, reservaId);
    return {
      corpo: {
        error: `O portal atingiu o limite de ${TETO_PORTAL_24H} consultas de crédito em 24 horas. Para seguir hoje, fale com a Careli.`,
      },
      status: 429,
    };
  }
  if ((daConta.count ?? 0) >= TETO_USUARIO_PORTAL_24H) {
    await desistirDaReserva(client, reservaId);
    return {
      corpo: {
        error: `Sua conta atingiu o limite de ${TETO_USUARIO_PORTAL_24H} consultas de crédito em 24 horas. Para seguir hoje, fale com a Careli.`,
      },
      status: 429,
    };
  }
  return null;
}

/** (portal) A reserva vira o registro da consulta. Uma segunda tentativa, porque o update não duplica. */
async function finalizarReservaDoPortal(
  client: AdminClient,
  reservaId: string,
  registro: Record<string, unknown>,
): Promise<{ data: unknown; error: { message: string } | null }> {
  let ultima: { data: unknown; error: { message: string } | null } = { data: null, error: null };
  for (let tentativa = 0; tentativa < 2; tentativa += 1) {
    ultima = await client
      .from("serasa_consultas")
      .update(registro)
      .eq("id", reservaId)
      .select("id, created_at, resumo, ambiente")
      .maybeSingle();
    if (!ultima.error && ultima.data) return ultima;
  }
  return ultima;
}

/**
 * (portal) A consulta guardada vira o resultado da CAD, sem cobrança nova.
 *
 * ⚠️ POR QUE NO PORTAL O REAPROVEITAMENTO MOVE A ETAPA, E NO HUB NÃO. No hub, reaproveitar só
 * mostra o resultado, e quem precisa andar com a CAD pede "Consultar de novo" (cobrado). O portal
 * não pode pedir consulta nova dentro da janela (`podeForcarNovaConsulta`): sem aplicar o guardado,
 * a CAD que voltou de uma correção, ou cuja etapa não gravou na primeira consulta, ficaria parada na
 * Análise de crédito para sempre. O caminho é o MESMO da consulta nova (`levarVereditoParaEsteira`:
 * `automatico`, sem regressão, avisos na reprovação), com o veredito recalculado pelo limite do
 * empreendimento desta CAD, exatamente como o painel mostra.
 *
 * A resposta é a do hub (`consultaAnterior` + `reaproveitada: true`) somada aos campos da consulta
 * nova (`alvo`, `veredito`, `etapa`, `etapaNaoGravada`, `disparo`), para a mesma tela refletir o
 * resultado sem saber de qual porta ele veio. `forcarRecusado` diz que o "consultar de novo" não
 * gerou cobrança.
 *
 * (16/09/2026, revisão) ⚠️ SEM O RELATÓRIO CRU, E COM A LEITURA NA AUDITORIA. A consulta guardada
 * já vem recortada à ficha e ao alvo (`situacao`), mas entregar o relatório inteiro a cada clique,
 * sem cobrança e sem linha nova em `serasa_consultas`, deixava a leitura sem rastro. Aqui sai o que a
 * tela usa (resumo e veredito; o painel lê o do titular pelo GET da própria CAD), e a entrega fica
 * em `apolo_audit_events` com o autor. Sem conseguir registrar, não entrega.
 */
async function reaproveitarNoPortal(input: {
  alvo: RecorteDaConsulta["alvo"];
  autor: Extract<AutorDoCredito, { tipo: "portal" }>;
  client: AdminClient;
  corpo: CorpoDaConsulta;
  ehConjuge: boolean;
  entityId: string;
  recente: ConsultaGuardada;
}): Promise<RespostaDoCredito> {
  const { alvo, autor, client, corpo, ehConjuge, entityId, recente } = input;

  // Sucesso sem relatório não deveria existir (o insert grava os dois juntos). Se existir, NÃO se
  // avalia: `avaliarCredito` de um cru vazio soma zero de restrição e APROVARIA.
  if (recente.resposta === null || recente.resposta === undefined) {
    return {
      corpo: {
        error:
          "Existe uma consulta recente deste documento, mas sem o relatório guardado. Peça à Careli para conferir antes de uma nova consulta.",
      },
      status: 409,
    };
  }

  const { error: erroDaAuditoria } = await client.from("apolo_audit_events").insert({
    action: "serasa_consulta_reaproveitada",
    actor_user_id: pareceUuid(autor.usuarioId) ? autor.usuarioId : null,
    entity_id: entityId,
    field_name: "credito",
    metadata: {
      alvo,
      autorNome: autor.nome,
      consultaId: recente.id,
      enterpriseId: normalizarEnterpriseId(corpo.enterpriseId),
      incorporadorId: autor.incorporadorId,
      origem: "portal-incorporador",
      slug: autor.slug,
      usuarioId: autor.usuarioId,
    },
    status: "mapped",
  });
  if (erroDaAuditoria) {
    console.error("[serasa] leitura da consulta guardada sem auditoria; não entregue", {
      erro: erroDaAuditoria.message,
      slug: autor.slug,
    });
    return {
      corpo: {
        error:
          "Não foi possível registrar o uso da consulta guardada agora. Nada foi alterado nem cobrado. Tente de novo em instantes.",
      },
      status: 503,
    };
  }

  const limite = await resolverLimiteCredito(client, entityId, corpo.enterpriseId);
  const veredito = avaliarCredito(recente.resposta, limite ?? 1000);

  const { disparo, etapaNaoGravada, transicao } = await levarVereditoParaEsteira({
    autor,
    client,
    ehConjuge,
    enterpriseId: corpo.enterpriseId,
    entityId,
    veredito,
  });

  // CAD VIVA: mudou de etapa, a CAD acompanha (mesma regra da consulta nova e do mover do Board).
  // Sem comprovante novo: o da consulta guardada já existe e continua sendo o documento dela.
  if (transicao && !transicao.error && !transicao.mantida) {
    try {
      await comLimiteDeTempo(
        gerarESalvarCad(client, entityId, {
          enterpriseId: normalizarEnterpriseId(corpo.enterpriseId),
          uploadedByName: pareceUuid(idDoAutor(autor)) ? "Análise de crédito" : null,
        }),
        15000,
      );
    } catch {
      /* segue */
    }
  }

  const quando = new Date(recente.created_at).toLocaleDateString("pt-BR", {
    timeZone: "America/Sao_Paulo",
  });

  return {
    corpo: {
      data: {
        alvo: ehConjuge ? "conjuge" : "titular",
        // O formato da guardada do hub, menos o relatório cru.
        consultaAnterior: {
          ambiente: recente.ambiente,
          created_at: recente.created_at,
          id: recente.id,
          report_name: recente.report_name,
          resumo: recente.resumo,
        },
        disparo,
        etapa: etapaNaoGravada ? null : (transicao?.etapa ?? null),
        etapaNaoGravada,
        forcarRecusado: Boolean(corpo.forcar),
        mensagem:
          `Este documento já foi consultado em ${quando}. O resultado guardado foi usado, ` +
          "sem nova cobrança.",
        reaproveitada: true,
        veredito,
      },
    },
    status: 200,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════════════════
// O CRÉDITO DESTA CAD ESTÁ APROVADO? (a régua das etapas de decisão no portal)
// ═══════════════════════════════════════════════════════════════════════════════════════════

export type CreditoDaCad = {
  aprovado: boolean;
  /**
   * De onde veio a resposta: a etapa já passou pelo crédito, a análise está desligada no
   * empreendimento, a última consulta na janela, o override (aprovação com restrição) mais novo que
   * ela, ou nada que prove aprovação.
   */
  fonte: "analise-desligada" | "consulta" | "etapa" | "override" | "sem-decisao";
};

/**
 * O crédito da CAD (entity_id + enterprise_id) está aprovado?
 *
 * Existe porque o portal que opera sozinho passa a gravar pré-venda e credenciado pela rota de
 * etapa, e na tela do Apolo essas etapas só chegam pelo crédito (consulta aprovada, análise
 * desligada ou aprovação com restrição). Sem esta régua no servidor, um PATCH direto credenciaria a
 * CAD sem Serasa.
 *
 * ⚠️ FAIL-CLOSED: leitura que falha LANÇA; quem chama traduz em 503, nunca em "aprovado".
 */
export async function creditoDaCad(input: {
  client: AdminClient;
  enterpriseId: string;
  entityId: string;
  etapaAtual: null | string;
  /** O portal que decide: só a consulta DELE vale como prova (ver `RecorteDaConsulta`). */
  incorporadorId?: null | string;
}): Promise<CreditoDaCad> {
  const { client, enterpriseId, entityId } = input;

  // A CAD já passou pelo crédito: foi a consulta, o override ou o "seguir pelo cônjuge" que a
  // levaram até aqui, todos pelo servidor.
  if (input.etapaAtual === "prevenda" || input.etapaAtual === "credenciado") {
    return { aprovado: true, fonte: "etapa" };
  }

  const { data: entidade, error: erroEntidade } = await client
    .from("apolo_entities")
    .select("document_masked, entity_kind")
    .eq("id", entityId)
    .maybeSingle<{ document_masked: null | string; entity_kind: null | string }>();
  if (erroEntidade) throw new Error(`apolo_entities: ${erroEntidade.message}`);
  const documento = (entidade?.document_masked ?? "").replace(/\D/g, "");
  const documentoOk = entidade?.entity_kind === "pj" ? cnpjValido(documento) : cpfValido(documento);

  // Análise desligada: a mesma régua da consulta ("a ficha com documento OK avança direto").
  if (!(await resolverAnaliseHabilitada(client, entityId, enterpriseId))) {
    return documentoOk
      ? { aprovado: true, fonte: "analise-desligada" }
      : { aprovado: false, fonte: "sem-decisao" };
  }

  // (16/09/2026, revisão) Sem a configuração não se sabe o ambiente, e sem o ambiente uma consulta de
  // homologação contaria como aprovação real. Lança (a porta traduz em 503).
  const cfg = lerConfigSerasa();
  if (!cfg.ok) throw new Error("Serasa sem configuração: o ambiente da consulta não é conhecido.");
  const [consulta, override] = await Promise.all([
    // A leitura que falha LANÇA (`situacao`), e o override mais velho não vence uma reconsulta que
    // não foi lida. Só a consulta do TITULAR desta ficha (ver `RecorteDaConsulta`).
    documentoOk
      ? consultaRecenteDoDocumento(client, documento, {
          ambiente: cfg.config.ambiente,
          cad: { alvo: "titular", entityId, incorporadorId: input.incorporadorId },
        })
      : Promise.resolve(null),
    client
      .from("apolo_credito_overrides")
      .select("created_at")
      .eq("entity_id", entityId)
      .eq("enterprise_id", enterpriseId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle<{ created_at: string }>(),
  ]);
  if (override.error) throw new Error(`apolo_credito_overrides: ${override.error.message}`);

  // A decisão MAIS NOVA manda: um override de ontem vale sobre a consulta reprovada de anteontem,
  // e uma reconsulta reprovada de hoje vale sobre o override de semana passada.
  const quandoOverride = override.data?.created_at ? Date.parse(override.data.created_at) : NaN;
  const quandoConsulta = consulta?.created_at ? Date.parse(consulta.created_at) : NaN;
  if (Number.isFinite(quandoOverride) && !(quandoConsulta > quandoOverride)) {
    return { aprovado: true, fonte: "override" };
  }

  if (consulta && consulta.resposta !== null && consulta.resposta !== undefined) {
    const limite = await resolverLimiteCredito(client, entityId, enterpriseId);
    const veredito = avaliarCredito(consulta.resposta, limite ?? 1000);
    return { aprovado: veredito.aprovado, fonte: "consulta" };
  }

  return { aprovado: false, fonte: "sem-decisao" };
}

/**
 * (portal) Existe crédito REPROVADO pelo Serasa nesta CAD para "aprovar com restrição"?
 *
 * ⚠️ POR QUE A ETAPA "REVISÃO" NÃO BASTA NO PORTAL (revisão de 16/09/2026). No hub, a CAD só chega
 * em revisão pela consulta reprovada (ou pela mão da coordenação, que é quem aprova). No portal, o
 * próprio time grava "revisao" pela rota de etapa ("Enviar ao coordenador"), e depois disso qualquer
 * imagem anexada credenciava a CAD SEM CONSULTA NENHUMA, e o override ainda valia como crédito
 * aprovado na régua da etapa. Aqui a prova é a consulta: a última do titular desta ficha, na janela,
 * no ambiente atual, com relatório, e reprovada no limite do empreendimento da CAD.
 *
 * O motivo gravado na CAD ("Crédito reprovado...") NÃO serve de prova: a rota de etapa do portal
 * grava o motivo que vier no corpo.
 *
 * ⚠️ FAIL-CLOSED: leitura que falha LANÇA; quem chama responde 503.
 */
export async function creditoReprovadoDaCad(input: {
  client: AdminClient;
  enterpriseId: null | string;
  entityId: string;
  /** O portal que aprova: só a consulta reprovada DELE serve de prova (ver `RecorteDaConsulta`). */
  incorporadorId?: null | string;
}): Promise<boolean> {
  const { client, enterpriseId, entityId } = input;

  const { data: entidade, error } = await client
    .from("apolo_entities")
    .select("document_masked")
    .eq("id", entityId)
    .maybeSingle<{ document_masked: null | string }>();
  if (error) throw new Error(`apolo_entities: ${error.message}`);
  const documento = (entidade?.document_masked ?? "").replace(/\D/g, "");
  if (!documento) return false;

  const cfg = lerConfigSerasa();
  if (!cfg.ok) throw new Error("Serasa sem configuração: o ambiente da consulta não é conhecido.");

  const consulta = await consultaRecenteDoDocumento(client, documento, {
    ambiente: cfg.config.ambiente,
    cad: { alvo: "titular", entityId, incorporadorId: input.incorporadorId },
  });
  if (!consulta || consulta.resposta === null || consulta.resposta === undefined) return false;

  const limite = await resolverLimiteCredito(client, entityId, enterpriseId);
  return !avaliarCredito(consulta.resposta, limite ?? 1000).aprovado;
}
