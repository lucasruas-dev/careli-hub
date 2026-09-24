import type { SupabaseClient } from "@supabase/supabase-js";

import {
  cancelarEnvelope,
  consultarEnvelope,
  enviarParaAssinatura,
  type PedidoDeEnvio,
} from "@/lib/assinatura/clicksign/envelope";
import type { PortaDaClicksign } from "@/lib/assinatura/clicksign/cliente";
import { congelarSignatarios } from "@/lib/assinatura/congelar-signatarios";
import {
  type EnvelopeDaProposta,
  envelopeQueSegura,
  envioAindaPodeEstarNoAr,
  seguraOEnvio,
} from "@/lib/assinatura/envio-db";
import {
  assinanteDeTermosDaVendedora,
  assinantesDoQuadro,
  empresasDoEmpreendimento,
} from "@/lib/assinatura/quadro-db";
import { type Pessoa, signatariosDoContrato } from "@/lib/assinatura/signatarios";
import type { EstadoDaAssinatura, Signatario } from "@/lib/assinatura/tipos";
import { rotuloDoEstado } from "@/lib/assinatura/traduzir";
import type {
  GuardianApprovalStatus,
  GuardianCompromissoDetail,
} from "@/lib/guardian/compromissos";
import { identidadeDoContrato } from "@/lib/temis/contrato-guardado";
import { dadosDaProposta } from "@/lib/temis/dados-do-contrato";

import { assinanteDaCareli } from "./assinante-da-careli";
import {
  envelopesDoCompromisso,
  faltaAColunaDoAcordo,
  type LinhaDoEnvelope,
  MIGRATION_DO_ELO_DO_ACORDO,
  SEM_A_COLUNA,
} from "./envelopes-db";
import { motivoParaNaoEnviarParaAssinatura, MOTIVOS_DO_ENVIO } from "./envio-gate";
import { signatariosDoAcordo } from "./signatarios-do-acordo";
import { montarTermoDoAcordoEmPdf, type TermoEmPdf } from "./termo-em-pdf";

// O TERMO DE ACORDO INDO PARA A CLICKSIGN — o mesmo motor do contrato, com a chave do Hades.
//
// ────────────────────────────────────────────────────────────────────────────────────────────
// ⚠️ NÃO HÁ SEGUNDO MOTOR AQUI, E ESSA É A DECISÃO DO ARQUIVO.
// ────────────────────────────────────────────────────────────────────────────────────────────
//
// `enviarParaAssinatura` (os 6 passos da Clicksign), `conferirSignatarios`, `ordenarSignatarios`,
// `envelopeQueSegura`, o webhook e a tradução de estados continuam sendo os do contrato, sem uma
// linha de mudança: nenhum deles sabe o que é uma proposta. O que o acordo NÃO pode reusar é
// `lib/assinatura/envio-db.ts` inteiro, porque aquele arquivo é sobre CONTRATO — ele lê
// `hercules_documentos`, baixa o PDF do bucket e move o card da Têmis. O acordo não tem documento
// guardado, não tem bucket e não tem card. Então este arquivo repete a DISCIPLINA daquele (gravar a
// intenção antes de chamar, perguntar se já existe envelope, carimbar o resultado) e nada do miolo.
//
// ⚠️ `proposta_id` FICA NULO, E ISSO É UMA TRAVA, NÃO UM DESCUIDO. Seria tentador preenchê-lo (o
// acordo casa 100% com uma proposta do Panteon, medido em 20/09/2026: 38 de 38). Mas TODAS as
// leituras de contrato filtram por `proposta_id` — o card da Têmis, o portal do incorporador, os
// fatos do contrato, o retorno para correção e, principalmente, `impedimentoDeEnvelopeVivo`. Um
// envelope de ACORDO com a proposta preenchida faria a Têmis recusar o envio do CONTRATO daquela
// venda ("já existe envelope vivo"), e o portal do incorporador contaria o acordo como assinatura de
// contrato. O elo do acordo é `compromisso_id`, e só ele.
//
// ⚠️ SEM A COLUNA `compromisso_id`, NADA É ENVIADO. A migration 0179 pode não ter sido aplicada
// ainda (ela nasce pendente, aguardando o OK do Lucas), e o código sobe antes dela: as LEITURAS
// toleram a ausência e devolvem "nenhum envelope", que é o certo — não há nenhum. O ENVIO, não: sem
// a coluna não há como ligar o envelope ao acordo, e sem esse elo some a única guarda contra o
// segundo envelope do mesmo acordo, numa conta de PRODUÇÃO onde cada envelope custa e o ativado não
// se apaga. A recusa nomeia a migration, como a do contrato nomeia a 0149.

// ── O QUE SAI DAQUI ─────────────────────────────────────────────────────────

// ⚠️ REPASSADA, e não redefinida: a frase da recusa que cita o número da migration nasce em
// `envelopes-db.ts`, e quem importa o envio continua achando o número no mesmo lugar de sempre.
export { MIGRATION_DO_ELO_DO_ACORDO } from "./envelopes-db";

/** O envelope do acordo, como a tela de acompanhamento o recebe. */
export type EnvelopeDoAcordo = {
  atualizadoEm: null | string;
  criadoEm: string;
  enviadoEm: null | string;
  enviadoPorNome: null | string;
  /** O id na Clicksign. `null` = envio que começou e o Panteon não soube como terminou. */
  envelopeId: null | string;
  estado: string;
  estadoCru: null | string;
  falha: null | string;
  /** A chave da NOSSA linha em `temis_envelopes`. */
  id: string;
  provedor: string;
  provedorDocumentoId: null | string;
};

export type PreparoDoAcordo = {
  /** O envelope mais recente deste acordo, quando existe. É o que a tela acompanha. */
  envelope: EnvelopeDoAcordo | null;
  /**
   * A frase que impede o envio — `null` quando dá para mandar.
   *
   * ⚠️ O PREPARO NÃO RECUSA, DEVOLVE O IMPEDIMENTO. A tela precisa mostrar QUEM assina mesmo quando
   * falta o e-mail de alguém: é olhando a lista que o operador entende o que corrigir. Quem recusa
   * de verdade é o POST, com as mesmas funções.
   */
  impedimento: null | string;
  ok: true;
  /** Já com o número da ordem resolvido: comprador 1, incorporador 2, Careli 3. */
  signatarios: Signatario[];
};

export type FalhaNoAcordo = {
  /**
   * Sobrou envelope na conta da Clicksign por causa DESTA tentativa?
   *
   * ⚠️ É O QUE DIZ À TELA QUE O BOTÃO NÃO PODE VOLTAR — o mesmo campo, pelo mesmo motivo, de
   * `FalhaAoEnviar` no contrato: frase é redação, campo é contrato.
   */
  envelopeAtivo?: boolean;
  erro: string;
  ok: false;
  status: 400 | 404 | 409 | 502 | 503;
};

export type EnvioDoAcordoFeito = {
  /**
   * O QUE DEU ERRADO DEPOIS QUE O ENVELOPE JÁ ESTAVA DE PÉ. `undefined` quando nada deu.
   *
   * ⚠️ ELE EXISTE PORQUE "OK" E "SEM PROBLEMA" NÃO SÃO A MESMA COISA AQUI. O envelope é criado,
   * ativado e notificado em 6 passos e só DEPOIS o Panteon carimba o resultado na nossa linha. Se
   * esse UPDATE falhar (a função morre, o PostgREST recusa, o teto de 120s da Vercel estoura depois
   * do passo 6), o envelope está VIVO na Clicksign, pago, permanente, com os convites já na caixa
   * do cliente, e a nossa linha continua em rascunho sem `envelope_id`. Responder 200 limpo nesse
   * caso faria a tela recarregar, não mostrar envelope nenhum, e o operador clicar de novo.
   *
   * ⚠️ E NÃO É `ok: false`, PORQUE O ENVIO ACONTECEU. Chamar de falha mandaria a tela oferecer
   * "tentar de novo", que é justamente o clique que cria o segundo envelope pago. É a mesma
   * distinção do campo `aviso` de `TrocaFeita`: o gesto deu certo, e algo ficou para alguém resolver.
   */
  aviso?: string;
  envelopeId: string;
  nome: string;
  ok: true;
  registroId: string;
  signatarios: Signatario[];
};

/** As peças externas, trocáveis no teste — a Clicksign e a montagem do PDF. */
export type PecasDoEnvio = {
  montarPdf?: (acordo: GuardianCompromissoDetail) => Promise<TermoEmPdf>;
  porta?: PortaDaClicksign;
};

// ── A LEITURA: OS ENVELOPES DESTE ACORDO ────────────────────────────────────
//
// ⚠️ A CONSULTA E A COLUNA QUE PODE NÃO EXISTIR MORAM EM `envelopes-db.ts`, e não aqui. Quem também
// precisa perguntar "este acordo tem envelope?" é a EXCLUSÃO do acordo, e ela não pode arrastar o
// `pdf-lib` e o `mysql2` que este arquivo puxa pela cadeia de `termo-em-pdf.ts`.

function comoATelaLe(linha: LinhaDoEnvelope): EnvelopeDoAcordo {
  return {
    atualizadoEm: linha.atualizado_em,
    criadoEm: linha.criado_em,
    enviadoEm: linha.enviado_em,
    enviadoPorNome: linha.enviado_por_nome,
    envelopeId: linha.envelope_id,
    estado: linha.estado ?? "desconhecido",
    estadoCru: linha.estado_cru,
    falha: linha.falha,
    id: linha.id,
    provedor: linha.provedor ?? "clicksign",
    provedorDocumentoId: linha.provedor_documento_id,
  };
}

/** A forma que a régua do contrato (`envelopeQueSegura`) lê. É a mesma régua, sem cópia. */
function comoAReguaLe(linha: LinhaDoEnvelope): EnvelopeDaProposta {
  return {
    criado_em: linha.criado_em,
    envelope_id: linha.envelope_id,
    estado: linha.estado ?? "desconhecido",
    falha: linha.falha,
    id: linha.id,
    provedor: linha.provedor ?? "clicksign",
  };
}

// ── QUEM ASSINA: AS TRÊS PARTES, LIDAS DO PANTEON ───────────────────────────

/** O que a venda do Panteon dá a este acordo: a proposta, a unidade e o empreendimento. */
type VendaDoAcordo = {
  comprador: null | Pessoa;
  /** O id do C2X do empreendimento — é o que vai gravado em `temis_envelopes.enterprise_id`. */
  enterpriseId: null | string;
  /** "LOX" ou o nome do empreendimento: é o que dá nome ao envelope e liga o marcador [TESTE]. */
  empreendimento: string;
  incorporador: null | Pessoa;
  propostaId: null | string;
  /** "Q13 L01", ou o código da unidade quando ele existe. */
  unidade: string;
  unidadeId: null | string;
};

/**
 * A venda do Panteon deste acordo, e as duas partes que saem dela.
 *
 * ⚠️ A PONTE É `acquisition_request_c2x_id` → `hercules_propostas.origem_c2x_id`, e ela é sólida:
 * medido em 20/09/2026, os 38 acordos com unidade casam com uma proposta, 38 de 38, e todas estão
 * em `etapa = faturado`. É por aí que se chega ao empreendimento e ao cadastro do comprador sem
 * abrir uma segunda conexão no MySQL do C2X.
 *
 * ⚠️ O COMPRADOR É O TITULAR, E SÓ ELE. `signatariosDoContrato` devolve todos os compradores e os
 * cônjuges qualificados no contrato de venda; o TERMO DE ACORDO qualifica um comprador — o dono do
 * débito na carteira — e o Lucas pediu três signatários. Os demais entrariam no envelope sem estar
 * no papel.
 *
 * ⚠️ E O EMPREENDIMENTO TEM DOIS CAMINHOS, COMO NO CONTRATO. `__empreendimento_id` é o
 * `c2x_enterprise_id` do empreendimento da proposta; três empreendimentos (LOX, PDX, RDX) têm essa
 * coluna NULA, e neles o id vive na própria unidade (`__unidade_enterprise_id`). Medido em
 * 20/09/2026: só pelo empreendimento, 3 dos 18 acordos aprovados chegam a uma vendedora; com a queda
 * para a unidade, 18 de 18. A Lavra do Ouro, que responde por 32 dos 40 acordos, está justamente
 * nesse caso.
 *
 * ⚠️ E OS DOIS CAMINHOS VIRARAM TRÊS, NA ORDEM DA CASA, PARA PROCURAR QUEM ASSINA — ver
 * `cadeiaDeEmpreendimentos`. O id do ENVELOPE continua sendo o de sempre: são perguntas diferentes.
 */
async function vendaDoAcordo(
  sb: SupabaseClient,
  acordo: GuardianCompromissoDetail,
): Promise<VendaDoAcordo> {
  const vazio: VendaDoAcordo = {
    comprador: null,
    empreendimento: "",
    enterpriseId: null,
    incorporador: null,
    propostaId: null,
    unidade: "",
    unidadeId: null,
  };

  if (!acordo.acquisitionRequestC2xId) return vazio;

  const { data, error } = await sb
    .from("hercules_propostas")
    .select("id, unidade_id")
    .eq("workspace_id", "careli")
    .eq("origem_c2x_id", acordo.acquisitionRequestC2xId)
    .order("criado_em", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("[hades][acordo][assinatura] falha ao achar a venda do acordo", error);
    return vazio;
  }

  const proposta = data as null | { id: string; unidade_id: null | string };
  if (!proposta?.id) return vazio;

  const resolvido = await dadosDaProposta(proposta.id, sb);
  if (!resolvido) return { ...vazio, propostaId: proposta.id, unidadeId: proposta.unidade_id };


  const comprador =
    signatariosDoContrato(resolvido.dados).pessoas.find((p) => p.papel === "comprador") ?? null;

  // ⚠️ O NOME E A UNIDADE SAEM DE `identidadeDoContrato`, A MESMA FUNÇÃO DO CONTRATO. É ela que
  // decide entre o código da unidade e "Q13 L01", e é o `empreendimento_codigo` que ela devolve que
  // liga o marcador `[TESTE]` do `nomeDoEnvelope`. Montar a identidade à mão aqui faria o envelope
  // do acordo do ZZ TESTE entrar na lista de produção sem o marcador.
  const identidade = identidadeDoContrato(resolvido.dados.gerais, comprador?.nome ?? "");

  // ⚠️ ESTE É O ID DO ENVELOPE, E ELE NÃO MUDOU. É o que vai gravado em
  // `temis_envelopes.enterprise_id`, que responde "de que empreendimento é este envelope" — outra
  // pergunta, e outra coluna, que a correção de 20/09/2026 deixou em paz de propósito.
  const enterpriseId =
    resolvido.dados.gerais.__empreendimento_id ||
    resolvido.dados.gerais.__unidade_enterprise_id ||
    null;

  return {
    comprador,
    empreendimento: identidade.empreendimento,
    enterpriseId,
    incorporador: await incorporadorDoAcordo(sb, resolvido.dados.gerais),
    propostaId: proposta.id,
    unidade: identidade.unidade,
    unidadeId: proposta.unidade_id,
  };
}

/**
 * OS EMPREENDIMENTOS EM QUE SE PROCURA QUEM ASSINA, na ordem da casa e sem repetição.
 *
 *     a divisão da unidade  →  o empreendimento da proposta  →  o pai dele
 *
 * ⚠️ A ORDEM É A DE `chavesDaComissao`, E NÃO UMA REGRA NOVA (correção de 20/09/2026). Lucas
 * (08/09/2026): *"o pai sempre será o referencial, ele é o macro"*, e o filho que configurou usa o
 * seu. O acordo usava a ordem CONTRÁRIA e parava no segundo degrau
 * (`__empreendimento_id || __unidade_enterprise_id`): quem abrisse a ficha do empreendimento em que
 * o LOTE está e apontasse o analista lá não era achado, e quem apontasse UMA pessoa no loteamento
 * inteiro não valia para as divisões dele.
 *
 * ⚠️ MEDIDO EM 20/09/2026, e por isso a correção é barata agora: dos 18 acordos aprovados, ZERO têm
 * os dois ids diferentes e ZERO nascem de divisão com pai — mas 408 das 2.012 propostas faturadas
 * têm os dois ids preenchidos e DIFERENTES, e é de proposta faturada que nasce acordo. Os pares de
 * pai e filho existem no cadastro (VLO 35 é pai de VOC 37, VOL 36 e VOR 41; LAB 31 é pai de LBR 27,
 * LBP 32 e LBF 33).
 *
 * ⚠️ O PAI CUSTA DUAS CONSULTAS, E SÓ QUANDO EXISTE. É a mesma cadeia do termo de rescisão
 * (`termo-de-rescisao-server.ts`): a linha do empreendimento pelo `c2x_enterprise_id`, e o
 * `c2x_enterprise_id` do `pai_id` dela. Falha de leitura não derruba nada: devolve a cadeia curta,
 * que é exatamente o que o envio já fazia antes.
 */
async function cadeiaDeEmpreendimentos(
  sb: SupabaseClient,
  gerais: Record<string, string>,
): Promise<string[]> {
  const daUnidade = String(gerais.__unidade_enterprise_id ?? "").trim();
  const daProposta = String(gerais.__empreendimento_id ?? "").trim();
  const cadeia = [daUnidade, daProposta].filter(Boolean);

  if (daProposta) {
    try {
      const { data: filho } = await sb
        .from("hercules_empreendimentos")
        .select("pai_id")
        .eq("c2x_enterprise_id", daProposta)
        .limit(1)
        .maybeSingle<{ pai_id: null | string }>();

      const paiId = String(filho?.pai_id ?? "").trim();
      if (paiId) {
        const { data: pai } = await sb
          .from("hercules_empreendimentos")
          .select("c2x_enterprise_id")
          .eq("id", paiId)
          .limit(1)
          .maybeSingle<{ c2x_enterprise_id: null | string }>();

        const doPai = String(pai?.c2x_enterprise_id ?? "").trim();
        if (doPai) cadeia.push(doPai);
      }
    } catch (e) {
      console.warn(
        "[hades][acordo][assinatura] não deu para subir até o pai do empreendimento:",
        e instanceof Error ? e.message : e,
      );
    }
  }

  return [...new Set(cadeia)];
}

/**
 * QUEM ASSINA PELO INCORPORADOR — o primeiro nome que a cadeia devolver, na precedência do Lucas.
 *
 *     apontado para TERMOS  →  vendedora do quadro  →  representante legal da PJ
 *
 * ⚠️ E A VARREDURA É CAMPO A CAMPO, COMO EM `herdarComissao`, e não degrau a degrau: procura-se o
 * APONTADO nos três empreendimentos da cadeia antes de aceitar a vendedora do contrato de qualquer
 * um deles. O apontado é a resposta à pergunta certa ("quem assina os TERMOS"), e a vendedora do
 * quadro é a resposta a outra ("quem assina a COMPRA E VENDA") que serve de queda; deixar a
 * vendedora de um degrau mais específico vencer o apontado de um degrau acima trocaria a resposta
 * certa pela aproximada.
 *
 * ⚠️ SEM `ordemPropria`, NOS DOIS DEGRAUS (correção de 20/09/2026). `assinantesDoQuadro` carrega o
 * "Assina em" da linha, que é um campo da tela do CONTRATO, e `ordenarSignatarios` faz a ordem da
 * PESSOA vencer a do papel: com "Assina em: 1" na vendedora, o envelope do acordo saía com o
 * incorporador no MESMO degrau do comprador (groups 1, 1, 2 em vez de 1, 2, 3). A fila do acordo é
 * a do Lucas (*"na ordem comprador, incorporador e nivea careli"*), e o comprador vem primeiro
 * porque é ele quem pode não aceitar o acordo. `assinanteDeTermosDaVendedora` já nascia sem a
 * coluna; o degrau de baixo ficou sem a mesma proteção.
 *
 * ⚠️ SÓ A VENDEDORA. O quadro traz também coordenador e testemunha, que são partes do CONTRATO de
 * venda; o acordo é entre quem deve, quem vende e quem administra a carteira.
 */
async function incorporadorDoAcordo(
  sb: SupabaseClient,
  gerais: Record<string, string>,
): Promise<null | Pessoa> {
  const cadeia = await cadeiaDeEmpreendimentos(sb, gerais);

  for (const id of cadeia) {
    const apontado = await assinanteDeTermosDaVendedora(sb, id);
    if (apontado) return apontado;
  }

  for (const id of cadeia) {
    const empresas = await empresasDoEmpreendimento(sb, id);
    const doQuadro = await assinantesDoQuadro(sb, {
      coordenadorEntityId: empresas.coordenador,
      enterpriseId: id,
      vendedoraEntityId: empresas.vendedora,
    });
    const vendedora = doQuadro.find((p) => p.papel === "vendedora");
    if (vendedora) return semAOrdemDoContrato(vendedora);
  }

  return null;
}

/** A pessoa do quadro sem o "Assina em" da tela do contrato. Ver a nota de `incorporadorDoAcordo`. */
function semAOrdemDoContrato(pessoa: Pessoa): Pessoa {
  const { ordemPropria: _daTelaDoContrato, ...semAOrdem } = pessoa;
  return semAOrdem;
}

// ── O PREPARO: O QUE A TELA MOSTRA ANTES DE ALGUÉM CLICAR ───────────────────

/**
 * Tudo que a tela do acordo precisa: quem assina, o que impede, e o envelope que já existe.
 *
 * ⚠️ O GATE VEM ANTES DA LEITURA DA VENDA, e não é economia: ele é a régua do Lucas (*"o acordo so
 * pode ficar disponivel para envio depois da aprovacao"*), e 22 dos 40 acordos de hoje estão
 * reprovados. Ler a venda primeiro faria cada abertura de card de acordo reprovado carregar
 * `dadosDaProposta` inteiro — e a resposta seria a mesma frase que o card já sabia.
 */
export async function prepararEnvioDoAcordo(
  sb: SupabaseClient,
  acordo: GuardianCompromissoDetail,
): Promise<FalhaNoAcordo | PreparoDoAcordo> {
  const envelopes = await envelopesDoCompromisso(sb, acordo.id);
  // ⚠️ A COLUNA AUSENTE NÃO DERRUBA O PREPARO, ela vira o impedimento. É isso que permite o código
  // subir antes da migration: a tela abre, mostra quem assinaria, e diz que falta a 0179.
  const envelope = envelopes.ok ? (envelopes.linhas[0] ?? null) : null;

  const doGate = motivoParaNaoEnviarParaAssinatura(acordo);
  if (doGate) {
    return {
      envelope: envelope ? comoATelaLe(envelope) : null,
      impedimento: doGate,
      ok: true,
      signatarios: [],
    };
  }

  const venda = await vendaDoAcordo(sb, acordo);
  const montagem = signatariosDoAcordo({
    careli: assinanteDaCareli(),
    comprador: venda.comprador,
    incorporador: venda.incorporador,
  });

  return {
    envelope: envelope ? comoATelaLe(envelope) : null,
    // ⚠️ O ENVELOPE VIVO VEM ANTES DA FALTA DE CADASTRO (correção de 20/09/2026), e a razão é a
    // diferença entre um fato e uma previsão. A falta de cadastro fala do PRÓXIMO envio; o envelope
    // vivo é um termo que JÁ está cobrando assinatura do cliente, pago e sem apagar. Com o apontado
    // removido depois do envio, a ordem antiga fazia o operador ler "falta apontar quem assina os
    // TERMOS" ao lado de um envelope em curso, sem uma palavra sobre o id dele nem sobre como
    // cancelá-lo. A falha de LEITURA continua na frente das duas: sem ler `temis_envelopes` não se
    // sabe nem se existe envelope.
    impedimento:
      (envelopes.ok ? null : envelopes.erro) ??
      impedimentoDoEnvelopeVivo(envelopes.ok ? envelopes.linhas : []) ??
      montagem.impedimento,
    ok: true,
    signatarios: montagem.signatarios,
  };
}

// ── A GUARDA CONTRA O SEGUNDO ENVELOPE ──────────────────────────────────────

const NOME_DO_PROVEDOR: Record<string, string> = { clicksign: "Clicksign", d4sign: "D4Sign" };

/** A hora em português, para a frase. O valor cru quando a data não se lê. */
function quando(iso: string): string {
  const data = new Date(iso);
  return Number.isNaN(data.getTime())
    ? iso
    : data.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
}

const ESTADOS_DO_ENVELOPE: Record<EstadoDaAssinatura, true> = {
  aguardando: true,
  assinado: true,
  cancelado: true,
  desconhecido: true,
  expirado: true,
  parcial: true,
  rascunho: true,
  recusado: true,
};

function comoSeEscreveOEstado(gravado: string): string {
  return Object.prototype.hasOwnProperty.call(ESTADOS_DO_ENVELOPE, gravado)
    ? rotuloDoEstado(gravado as EstadoDaAssinatura)
    : gravado;
}

/**
 * Já existe envelope vivo deste acordo? A frase da recusa, ou `null` quando dá para mandar.
 *
 * ⚠️ A RÉGUA É A MESMA DO CONTRATO (`envelopeQueSegura`), e reusá-la é o ponto: ela já foi pensada
 * nos dois sentidos — segurar de menos cria o segundo envelope pago, segurar demais trava um reenvio
 * legítimo — e tem teste próprio. Só `cancelado`, `expirado` e `recusado` liberam; `assinado` fica
 * de fora de propósito.
 *
 * ⚠️ E ISSO VALE TAMBÉM PARA O REENVIO, que o Lucas pediu na mesma mensagem. Não há caminho de
 * reenvio que pule esta função: reenviar é mandar de novo, e mandar de novo passa por aqui.
 */
function impedimentoDoEnvelopeVivo(linhas: LinhaDoEnvelope[]): null | string {
  const vivo = envelopeQueSegura(linhas.map(comoAReguaLe));
  if (!vivo) return null;

  const provedor = NOME_DO_PROVEDOR[vivo.provedor] ?? vivo.provedor;

  if (!vivo.envelope_id) {
    // ⚠️ A MESMA LINHA QUER DIZER DUAS COISAS OPOSTAS, E A IDADE É O QUE AS SEPARA. Durante os 40 a
    // 90 segundos de um envio normal a linha vive exatamente assim, em rascunho, sem `envelope_id` e
    // sem `falha`: é ela que segura o duplo clique. Uma frase só, mandando "cancele por lá", faria
    // quem seguisse o conselho matar o envelope que o `carimbarSucesso` ia registrar meio minuto
    // depois, e o cancelado fica na lista da conta para sempre. A régua da idade é
    // `envioAindaPodeEstarNoAr`, a MESMA do contrato (o `maxDuration` de 120s desta rota mais folga),
    // e não um palpite: ver a nota dela em `lib/assinatura/envio-db.ts`.
    if (envioAindaPodeEstarNoAr(vivo.criado_em)) {
      return (
        `Este acordo ESTÁ SENDO ENVIADO agora: o envio começou em ${quando(vivo.criado_em)} e ainda pode estar em curso (registro ${vivo.id}). ` +
        `Espere terminar e recarregue a tela, o envio leva até dois minutos. ` +
        `NÃO cancele nada na ${provedor} antes disso: o envelope deste envio ainda está sendo criado, e cancelá-lo agora jogaria fora um envelope que não se apaga.`
      );
    }

    // ⚠️ E A FRASE DIZ COMO SAIR, que é o que faltava. Sem a última oração, o acordo cujo carimbo
    // não gravou ficava barrado para sempre: cancelar pela tela devolve 404 (não há `envelope_id`
    // para cancelar) e mandar de novo cai aqui. A saída é a mesma do contrato, e ela é de banco.
    return (
      `Existe um envio deste acordo que começou em ${quando(vivo.criado_em)} e o Panteon não soube como terminou (registro ${vivo.id}). ` +
      `Confira na ${provedor} se o envelope deste acordo existe. Se existir, ele não se apaga: cancele por lá. ` +
      `Se não existir, o registro ${vivo.id} precisa ser encerrado em temis_envelopes antes de mandar de novo.`
    );
  }

  if (vivo.estado === "assinado") return MOTIVOS_DO_ENVIO.jaAssinado;

  return (
    `Este acordo já tem envelope na ${provedor}: ${vivo.envelope_id}, em "${comoSeEscreveOEstado(vivo.estado)}", aberto em ${quando(vivo.criado_em)}. ` +
    "Envelope não se apaga, só se cancela, e o cancelado fica na lista para sempre: mandar de novo deixaria DOIS termos do mesmo acordo cobrando assinatura. " +
    `Cancele o ${vivo.envelope_id} aqui mesmo, ou por lá, e o reenvio libera.`
  );
}

// ── A CORRIDA: DOIS ENVIOS DO MESMO ACORDO AO MESMO TEMPO ───────────────────
//
// ⚠️ A GUARDA DE CIMA É UM `SELECT` SEGUIDO DE UM `INSERT`, E ENTRE OS DOIS CABE UM ENVIO INTEIRO.
// Entre ler os envelopes e gravar a intenção o acordo ainda monta o PDF, que abre o C2X: são
// segundos, não milissegundos, e a rota reserva 120s. Duas abas, dois operadores, o F5 no meio ou um
// retry da Vercel depois do timeout passam os dois pela guarda e criam DOIS envelopes pagos do mesmo
// acordo. O botão da tela se desabilita, mas isso protege uma aba, não a conta.
//
// ⚠️ SÃO DUAS TRAVAS, E ELAS NÃO SE SUBSTITUEM. A primeira é do BANCO (o índice único parcial da
// 0179), e é a única que vale entre duas funções da Vercy que nunca se falam; ela responde 23505 no
// insert. A segunda é esta: depois de gravar, a linha é lida DE VOLTA e quem não for a mais antiga
// desiste antes de tocar a API. Ela existe porque o índice pode não ter sido aplicado ainda (a 0179
// nasce pendente) e porque ela é o que um teste consegue provar sem um Postgres de verdade.

/** A frase de quem perdeu a corrida. É a mesma ideia da guarda: não convida a tentar de novo. */
const CORRIDA_PERDIDA =
  "Este acordo já está sendo enviado agora, por outra aba ou por outra pessoa. "
  + "Nada foi mandado para a Clicksign por este clique. "
  + "Espere terminar e recarregue a tela: o envio leva até dois minutos, e dois envios do mesmo acordo criariam dois envelopes pagos.";

/**
 * Este erro é o índice único do acordo recusando o segundo envio vivo?
 *
 * ⚠️ O NOME DO ÍNDICE ENTRA NA CONTA, como o nome da coluna entra em `faltaAColunaDoAcordo`. Sem
 * ele, qualquer 23505 de qualquer unicidade da tabela viraria "já existe envio deste acordo", e o
 * operador leria a frase errada sobre o defeito errado.
 */
function ehConflitoDeEnvioVivo(erro: null | { code?: string; message?: string }): boolean {
  const texto = `${erro?.code ?? ""} ${erro?.message ?? ""}`;
  if (!/23505|duplicate key/i.test(texto)) return false;
  return /um_envio_vivo_por_acordo|compromisso_id/i.test(texto);
}

/**
 * Depois de gravar: a NOSSA linha é a primeira? `null` quando sim.
 *
 * ⚠️ O CRITÉRIO É `criado_em` E, NO EMPATE, O `id`, e o empate não é hipótese: duas funções que
 * gravam no mesmo milissegundo recebem o mesmo `criado_em`. O `id` é um uuid, então quem ganha é
 * arbitrário, mas é O MESMO para as duas leituras, que é tudo o que se precisa aqui: exatamente uma
 * das duas se vê como primeira.
 *
 * ⚠️ E QUEM PERDE MARCA A PRÓPRIA LINHA COMO `cancelado`, que é um dos três estados que liberam
 * reenvio (`ESTADOS_QUE_LIBERAM_REENVIO`). Deixá-la em rascunho faria a perdedora segurar o acordo
 * para sempre, pelo mesmo caminho que ela acabou de evitar.
 */
async function perdemosACorrida(
  sb: SupabaseClient,
  compromissoId: string,
  registroId: string,
): Promise<null | string> {
  const envelopes = await envelopesDoCompromisso(sb, compromissoId);
  // ⚠️ NÃO SABER AQUI NÃO PARA O ENVIO. A leitura já passou uma vez neste mesmo caminho; um blip
  // agora não é motivo para abandonar uma linha que já está gravada, e o índice do banco continua de
  // pé por trás.
  if (!envelopes.ok) return null;

  const vivos = envelopes.linhas.map(comoAReguaLe).filter(seguraOEnvio);
  const primeiro = [...vivos].sort((a, b) =>
    a.criado_em === b.criado_em ? a.id.localeCompare(b.id) : a.criado_em.localeCompare(b.criado_em),
  )[0];

  if (!primeiro || primeiro.id === registroId) return null;

  await sb
    .from("temis_envelopes")
    .update({
      atualizado_em: new Date().toISOString(),
      estado: "cancelado",
      estado_cru: "panteon:corrida",
      falha: `desistiu antes de chamar a Clicksign: o envio ${primeiro.id} do mesmo acordo começou primeiro`,
      fechado_em: new Date().toISOString(),
    })
    .eq("id", registroId);

  return CORRIDA_PERDIDA;
}

// ── A APROVAÇÃO, LIDA DE NOVO ───────────────────────────────────────────────

/**
 * A régua do Lucas conferida OUTRA VEZ, agora com o que está no banco, antes de gravar a intenção.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────
 * ⚠️ O GATE DO PASSO 1 LÊ O COMPROMISSO QUE A ROTA CARREGOU, E ELE ENVELHECE NO MEIO DO CAMINHO.
 * ────────────────────────────────────────────────────────────────────────────────────────────
 *
 * Entre o gate e a chamada que cria o envelope correm quatro esperas: a venda no Panteon, a leitura
 * dos envelopes, a montagem do PDF (que abre o C2X) e o insert. A rota reserva 120s para o conjunto.
 * Se o gestor reprovar nesse intervalo, o envelope sairia assim mesmo, pago e permanente, com
 * condições que deixaram de valer. Lucas, 20/09/2026: *"o acordo so pode ficar disponivel para envio
 * depois da aprovacao"*, e "depois" aqui inclui o instante do clique.
 *
 * ⚠️ ELA NÃO INVENTA RECUSA. Leitura que falha, ou que não traz `approval_status`, mantém o veredito
 * do compromisso que a rota já carregou: um blip do PostgREST não pode virar "este acordo foi
 * reprovado" para quem está com a aprovação na mão. Só o que o banco DIZ, positivamente, muda a
 * resposta.
 *
 * ⚠️ E É UMA CONSULTA NUM CAMINHO QUE JÁ FAZ CINCO. O que ela evita custa uma conta na Clicksign e
 * um termo assinado que não devia existir.
 */
async function aprovacaoAindaVale(
  sb: SupabaseClient,
  acordo: GuardianCompromissoDetail,
): Promise<null | string> {
  const { data, error } = await sb
    .from("guardian_compromissos")
    .select("approval_status, metadata, status")
    .eq("id", acordo.id)
    .maybeSingle();

  if (error) {
    console.error("[hades][acordo][assinatura] não deu para reler a aprovação do acordo", error);
  }

  const linha = (data ?? null) as null | {
    approval_status?: unknown;
    metadata?: unknown;
    status?: unknown;
  };

  const aprovacao =
    typeof linha?.approval_status === "string"
      ? (linha.approval_status as GuardianApprovalStatus)
      : acordo.approvalStatus;
  const situacao = typeof linha?.status === "string" ? linha.status : acordo.status;
  const metadata =
    linha?.metadata && typeof linha.metadata === "object"
      ? (linha.metadata as Record<string, unknown>)
      : acordo.metadata;

  return motivoParaNaoEnviarParaAssinatura({
    acquisitionRequestC2xId: acordo.acquisitionRequestC2xId,
    approvalStatus: aprovacao,
    kind: acordo.kind,
    metadata,
    parcelas: acordo.parcelas,
    status: situacao,
  });
}

// ── O REGISTRO ──────────────────────────────────────────────────────────────

/**
 * A linha que diz "o termo deste acordo está indo para assinatura".
 *
 * ⚠️ ELA NASCE ANTES DA CHAMADA, e falha aqui PARA O ENVIO. É a ATENÇÃO 1 da migration 0149, e vale
 * igual: sem a linha, o envelope existiria na Clicksign sem nada no Panteon apontando para ele —
 * pago, permanente e invisível. A ordem é: grava a intenção → chama → carimba o resultado.
 */
async function abrirRegistro(
  sb: SupabaseClient,
  dados: {
    compromissoId: string;
    enterpriseId: null | string;
    nome: string;
    signatarios: readonly Signatario[];
    unidadeId: null | string;
    usuarioId: null | string;
    usuarioNome: null | string;
  },
): Promise<FalhaNoAcordo | { id: string; ok: true }> {
  const { data, error } = await sb
    .from("temis_envelopes")
    .insert({
      compromisso_id: dados.compromissoId,
      enterprise_id: dados.enterpriseId || null,
      enviado_por: dados.usuarioId,
      enviado_por_nome: dados.usuarioNome,
      estado: "rascunho",
      nome: dados.nome,
      // A ordem do acordo é sempre ligada: comprador, depois incorporador, depois Careli.
      ordenada: true,
      // ⚠️ NULO DE PROPÓSITO. Ver a nota do topo: preencher faria a Têmis e o portal do incorporador
      // tratarem este envelope como o contrato daquela venda.
      proposta_id: null,
      provedor: "clicksign",
      signatarios: dados.signatarios.map((s) => ({
        email: s.email,
        nome: s.nome,
        ordem: s.ordem,
        papel: s.papel,
      })),
      unidade_id: dados.unidadeId,
      workspace_id: "careli",
    })
    .select("id")
    .maybeSingle();

  if (error || !data) {
    if (faltaAColunaDoAcordo(error)) return { erro: SEM_A_COLUNA, ok: false, status: 503 };
    // ⚠️ 23505 AQUI É A GUARDA DO BANCO FALANDO, E NÃO UM DEFEITO. O índice único parcial da 0179
    // (`temis_envelopes_um_envio_vivo_por_acordo_idx`) existe justamente para fechar a janela entre
    // o SELECT da guarda e este INSERT: duas abas, dois operadores ou um retry da Vercel chegam aqui
    // ao mesmo tempo, os dois passam pela guarda, e só um grava. Quem perde precisa ler a MESMA
    // frase da guarda, e não "erro ao registrar" com um botão convidando a tentar de novo.
    if (ehConflitoDeEnvioVivo(error)) {
      return { erro: CORRIDA_PERDIDA, ok: false, status: 409 };
    }
    console.error("[hades][acordo][assinatura] falha ao abrir o registro do envelope", error);
    return {
      erro:
        "Não foi possível registrar o envio no Panteon, e por isso nada foi mandado para a Clicksign. " +
        `Confira se as migrations 0149 (temis_envelopes) e ${MIGRATION_DO_ELO_DO_ACORDO} (compromisso_id) foram aplicadas.`,
      ok: false,
      status: 503,
    };
  }

  return { id: (data as { id: string }).id, ok: true };
}

/**
 * Carimba o resultado na nossa linha, e DEVOLVE A FRASE quando não consegue.
 *
 * ⚠️ ATÉ 20/09/2026 ELA ENGOLIA O ERRO, e o preço era o pior dos desfechos: o envelope está ativado
 * e notificado na conta de PRODUÇÃO, o cliente já recebeu o convite, e a nossa linha fica em
 * rascunho, sem `envelope_id` e sem `provedor_documento_id`. A rota respondia 200 limpo, a tela
 * recarregava sem mostrar envelope nenhum, e o acordo ficava barrado para sempre (cancelar devolve
 * 404 por falta de id, mandar de novo cai na guarda). Quem lê o log não é quem está na tela.
 *
 * ⚠️ NÃO DESFAZ NADA, E ISSO NÃO MUDOU. O envelope já está ativado e não se apaga; falhar aqui é
 * perder o id do nosso lado, não o documento. O que mudou é que agora o id sobe para quem chamou,
 * em vez de ficar só no `console.error`.
 */
async function carimbarSucesso(
  sb: SupabaseClient,
  registroId: string,
  resultado: {
    documentoId: string;
    envelopeId: string;
    /** `{ e-mail -> id do signatario }`, como a Clicksign devolveu no passo 3 do envio. */
    signatarios?: Record<string, string>;
  },
  signatarios: readonly Signatario[],
): Promise<null | string> {
  const { error } = await sb
    .from("temis_envelopes")
    .update({
      atualizado_em: new Date().toISOString(),
      // ⚠️ `aguardando`, E NÃO `rascunho`: a esta altura o envelope foi ATIVADO e notificado.
      estado: "aguardando",
      estado_cru: "clicksign:running",
      envelope_id: resultado.envelopeId,
      enviado_em: new Date().toISOString(),
      provedor_documento_id: resultado.documentoId,
      // ⚠️ COM A `chave` DA CLICKSIGN. Ver `lib/assinatura/congelar-signatarios.ts`: sem ela o
      // reenvio de convite manda a key do webhook (ou o e-mail) e leva 422.
      signatarios: congelarSignatarios(signatarios, resultado.signatarios),
    })
    .eq("id", registroId);

  if (!error) return null;

  console.error(
    "[hades][acordo][assinatura] O ENVELOPE FOI CRIADO E O REGISTRO NÃO ATUALIZOU. envelope:",
    resultado.envelopeId,
    error,
  );

  return (
    `⚠️ O termo FOI para a Clicksign e os convites saíram, mas o Panteon não conseguiu registrar isso. ` +
    `Anote o envelope ${resultado.envelopeId}: ele está vivo, é pago e não se apaga. ` +
    `Enquanto o registro ${registroId} não for encerrado em temis_envelopes, este acordo não pode ser mandado de novo, e o botão de cancelar não acha o envelope. ` +
    `Acompanhe por lá.`
  );
}

async function carimbarFalha(
  sb: SupabaseClient,
  registroId: string,
  resultado: {
    envelopeId: null | string;
    erro: string;
    passo: string;
    rascunhoApagado: boolean;
  },
): Promise<void> {
  const ativado = resultado.passo === "notificar";
  const sobrou = ativado
    ? " (⚠️ SOBROU ENVELOPE ATIVO na conta: ele não se apaga, só se cancela, e os convites não saíram)"
    : resultado.rascunhoApagado
      ? ""
      : " (⚠️ pode ter sobrado envelope na conta)";

  const { error } = await sb
    .from("temis_envelopes")
    .update({
      atualizado_em: new Date().toISOString(),
      falha: `passo "${resultado.passo}": ${resultado.erro}${sobrou}`,
      ...(resultado.envelopeId ? { envelope_id: resultado.envelopeId } : {}),
      // ⚠️ E O ESTADO SÓ VIRA `aguardando` NO PASSO `notificar`: é o único desfecho em que se SABE
      // que o envelope está ativo. No `ativar`, a chamada pode ter estourado depois de o servidor já
      // ter trocado o status, e afirmar "aguardando" ali trocaria uma dúvida por uma certeza falsa.
      ...(ativado ? { estado: "aguardando", estado_cru: "clicksign:running" } : {}),
    })
    .eq("id", registroId);

  if (error) console.error("[hades][acordo][assinatura] falha ao carimbar o erro do envio", error);
}

// ── O ENVIO ─────────────────────────────────────────────────────────────────

/**
 * Manda o termo deste acordo para a Clicksign.
 *
 * A ordem das perguntas é a ordem do custo: primeiro o que é de graça (o gate do Lucas, quem
 * assina), depois o banco (já existe envelope?), depois o C2X e o desenho do PDF, e só então a API
 * que cobra.
 *
 * ⚠️ COM DUAS EXCEÇÕES, E AS DUAS SÃO DE PROPÓSITO. Os passos 5 e 7 são consultas a mais num caminho
 * que já faz cinco, colocadas onde estão porque o que elas evitam é caro e não se desfaz: o passo 5
 * relê a aprovação porque os passos 2 a 4 são segundos de espera e a régua do Lucas vale no instante
 * do clique; o passo 7 relê o registro porque entre a guarda do passo 3 e a escrita do passo 6 cabe
 * um segundo envio do mesmo acordo. Envelope custa, é permanente e chega na caixa do cliente.
 */
export async function enviarAcordoParaAssinatura(
  sb: SupabaseClient,
  acordo: GuardianCompromissoDetail,
  pedido: { mensagem?: string; prazoEmDias?: number; usuarioId?: null | string; usuarioNome?: null | string },
  pecas: PecasDoEnvio = {},
): Promise<EnvioDoAcordoFeito | FalhaNoAcordo> {
  // 1. A RÉGUA DO LUCAS, antes de tudo: só acordo APROVADO vai para assinatura.
  const doGate = motivoParaNaoEnviarParaAssinatura(acordo);
  if (doGate) return { erro: doGate, ok: false, status: 409 };

  // 2. QUEM ASSINA — a recusa acontece aqui, antes de existir envelope. E-mail faltando ou repetido
  //    deixado para a API recusar produziria um envelope criado com metade dos signatários dentro.
  const venda = await vendaDoAcordo(sb, acordo);
  const montagem = signatariosDoAcordo({
    careli: assinanteDaCareli(),
    comprador: venda.comprador,
    incorporador: venda.incorporador,
  });
  if (montagem.impedimento) return { erro: montagem.impedimento, ok: false, status: 409 };

  // 3. JÁ EXISTE UM? A primeira das três guardas contra o segundo envelope, e ela vem antes de
  //    montar o PDF porque nada do que o PDF traz muda a resposta. As outras duas são o índice único
  //    da 0179, no passo 6, e a leitura de volta, no passo 7: esta aqui é a que responde com a frase
  //    inteira (qual envelope, em que estado, desde quando), e as outras duas são o que sobra
  //    quando duas chamadas passam por ela ao mesmo tempo.
  const envelopes = await envelopesDoCompromisso(sb, acordo.id);
  if (!envelopes.ok) return { erro: envelopes.erro, ok: false, status: 503 };

  const jaTem = impedimentoDoEnvelopeVivo(envelopes.linhas);
  if (jaTem) return { erro: jaTem, ok: false, status: 409 };

  // 4. O PAPEL. `montarTermoDoAcordoEmPdf` recusa quando o C2X não confirma mais o débito que foi
  //    negociado — é a conferência que impede o envelope de sair com um número que já mudou.
  const montarPdf = pecas.montarPdf ?? montarTermoDoAcordoEmPdf;
  const termo = await montarPdf(acordo);
  if (!termo.ok) {
    return { erro: termo.motivo, ok: false, status: statusDaRecusa(termo.status) };
  }

  // 5. A APROVAÇÃO, DE NOVO, agora contra o banco. Os passos 2 a 4 são segundos de espera, e a
  //    régua do Lucas vale no instante do clique, não no instante em que a tela carregou.
  const aindaAprovado = await aprovacaoAindaVale(sb, acordo);
  if (aindaAprovado) return { erro: aindaAprovado, ok: false, status: 409 };

  // 6. A INTENÇÃO, GRAVADA ANTES DA CHAMADA.
  const registro = await abrirRegistro(sb, {
    compromissoId: acordo.id,
    enterpriseId: venda.enterpriseId,
    nome: termo.nome,
    signatarios: montagem.signatarios,
    unidadeId: venda.unidadeId,
    usuarioId: pedido.usuarioId ?? null,
    usuarioNome: pedido.usuarioNome ?? null,
  });
  if (!registro.ok) return registro;

  // 7. E A NOSSA LINHA É A PRIMEIRA? A leitura de volta é o que fecha a janela entre o SELECT do
  //    passo 3 e o INSERT do passo 6 quando o índice único da 0179 ainda não está no banco.
  const perdeu = await perdemosACorrida(sb, acordo.id, registro.id);
  if (perdeu) return { erro: perdeu, ok: false, status: 409 };

  const paraEnviar: PedidoDeEnvio = {
    arquivo: { bytes: termo.bytes, nome: termo.nome },
    identidade: {
      comprador: venda.comprador?.nome ?? "",
      // ⚠️ A CHAVE DO ACORDO VIAJA NO `metadata` DO DOCUMENTO, e é a rede de segurança que o contrato
      // tem por `proposta_id`. Sem ela, um envelope de acordo cujo carimbo não gravasse ficaria
      // invisível para o webhook: `acharEnvelope` tenta `provedor_documento_id`, `envelope_id` e o
      // metadata, e para o acordo os três podiam voltar vazios ao mesmo tempo.
      compromissoId: acordo.id,
      // ⚠️ O `metadata` do documento NÃO leva `proposta_id`, e não é esquecimento: o webhook casa o
      // evento por `provedor_documento_id` (`estado-db.ts`), e `concluirAssinaturaDoCard` só roda
      // quando a NOSSA linha tem proposta. Mandar a proposta aqui faria o webhook de um ACORDO
      // assinado tentar mover o card do CONTRATO daquela venda.
      empreendimento: venda.empreendimento,
      // ⚠️ "Termo de Acordo" NA FRENTE DO NOME, e não "Contrato". Ver `IdentidadeDoEnvelope.especie`:
      // a lista da Clicksign é de produção, e é por ela que a casa acha o que mandou.
      especie: "Termo de Acordo",
      unidade: venda.unidade,
    },
    signatarios: montagem.signatarios,
    ...(pedido.mensagem ? { mensagem: pedido.mensagem } : {}),
    ...(pedido.prazoEmDias ? { prazoEmDias: pedido.prazoEmDias } : {}),
  };

  const resultado = await enviarParaAssinatura(paraEnviar, pecas.porta);

  if (!resultado.ok) {
    await carimbarFalha(sb, registro.id, resultado);
    const sobrou = resultado.rascunhoApagado
      ? "Nada ficou pendente na Clicksign."
      : resultado.passo === "notificar"
        ? `⚠️ O envelope ${resultado.envelopeId ?? "(sem id)"} ficou ATIVO na Clicksign e os convites NÃO saíram. Ele não se apaga: confira lá antes de mandar de novo, senão o mesmo acordo vira dois envelopes.`
        : `⚠️ Um envelope pode ter ficado na Clicksign${resultado.envelopeId ? ` (${resultado.envelopeId})` : ""}: confira antes de tentar de novo.`;

    return {
      envelopeAtivo: !resultado.rascunhoApagado,
      erro: `A Clicksign recusou o envio no passo "${resultado.passo}": ${resultado.erro} ${sobrou}`,
      ok: false,
      status: 502,
    };
  }

  const avisoDoCarimbo = await carimbarSucesso(sb, registro.id, resultado, montagem.signatarios);

  return {
    ...(avisoDoCarimbo ? { aviso: avisoDoCarimbo } : {}),
    envelopeId: resultado.envelopeId,
    nome: resultado.nome,
    ok: true,
    registroId: registro.id,
    signatarios: montagem.signatarios,
  };
}

/** O status da recusa do papel, preso aos que a falha do acordo sabe carregar. */
function statusDaRecusa(status: number): FalhaNoAcordo["status"] {
  if (status === 404) return 404;
  if (status === 400) return 400;
  if (status === 503) return 503;
  return 409;
}

// ── O CANCELAMENTO ──────────────────────────────────────────────────────────

/**
 * CANCELA o envelope deste acordo na Clicksign — e é o que libera o reenvio.
 *
 * ⚠️ O ESTADO É LIDO NA CLICKSIGN ANTES, E NÃO NO NOSSO BANCO. `temis_envelopes.estado` só é escrito
 * pelo webhook, e entre a última assinatura e o evento chegar existe uma janela real: a tela
 * carregada às 13:58 mostra "parcial", o terceiro signatário assina às 14:00, e às 14:00:01 o
 * Panteon cancelaria um termo ASSINADO POR TODOS. Pior: `cancelado` é terminal, então o evento de
 * fechamento que chegasse depois seria DESCARTADO, e não sobraria registro de que aquilo foi
 * assinado. É a mesma disciplina do retorno para correção da Têmis.
 *
 * ⚠️ E CANCELAR NÃO É APAGAR. Depois de ativado o envelope é permanente: cancelar apenas o fecha, e
 * ele continua na lista da conta para sempre, ao lado dos contratos de verdade. Não é faxina; é o
 * preço de ter mandado.
 */
export async function cancelarAssinaturaDoAcordo(
  sb: SupabaseClient,
  acordo: GuardianCompromissoDetail,
  pedido: { motivo?: string; usuarioNome?: null | string },
  pecas: PecasDoEnvio = {},
): Promise<FalhaNoAcordo | { envelopeId: string; ok: true }> {
  const envelopes = await envelopesDoCompromisso(sb, acordo.id);
  if (!envelopes.ok) return { erro: envelopes.erro, ok: false, status: 503 };

  const linha = envelopes.linhas[0];
  if (!linha?.envelope_id) {
    return {
      erro: "Este acordo não tem envelope com id na Clicksign para cancelar.",
      ok: false,
      status: 404,
    };
  }

  const naClicksign = await consultarEnvelope(linha.envelope_id, pecas.porta);
  if (!naClicksign.ok) {
    return {
      erro: `Não foi possível ler o estado do envelope ${linha.envelope_id} na Clicksign: ${naClicksign.erro}. Nada foi cancelado.`,
      ok: false,
      status: 502,
    };
  }

  // ⚠️ `closed` VOLTA COMO `desconhecido` de propósito (ver `estadoDaClicksign`): ele é tanto "todos
  // assinaram" quanto "venceu o prazo e fechou com o que tinha". Cancelar um envelope fechado não
  // desfaz assinatura nenhuma, e a frase manda conferir em vez de afirmar.
  if (naClicksign.status === "closed") {
    return {
      erro: `O envelope ${linha.envelope_id} já está FECHADO na Clicksign: ou todos assinaram, ou o prazo venceu. Cancelar não desfaz assinatura. Confira lá antes de qualquer coisa.`,
      ok: false,
      status: 409,
    };
  }

  const cancelado = await cancelarEnvelope(linha.envelope_id, pecas.porta);
  if (!cancelado.ok) {
    return {
      erro: cancelado.duvidoso
        ? `Não deu para confirmar o cancelamento do envelope ${linha.envelope_id}: ${cancelado.erro}. Confira na Clicksign se ele está cancelado antes de mandar de novo.`
        : `A Clicksign recusou o cancelamento do envelope ${linha.envelope_id}: ${cancelado.erro}. O envelope continua como estava.`,
      ok: false,
      status: 502,
    };
  }

  const { error } = await sb
    .from("temis_envelopes")
    .update({
      atualizado_em: new Date().toISOString(),
      estado: "cancelado",
      estado_cru: "clicksign:canceled",
      falha: `cancelado por ${pedido.usuarioNome ?? "alguém do hub"}${pedido.motivo ? `: ${pedido.motivo}` : ""}`,
      fechado_em: new Date().toISOString(),
    })
    .eq("id", linha.id);

  // ⚠️ FALHA AQUI NÃO DESFAZ O CANCELAMENTO — ele já aconteceu lá, e não se desfaz. O webhook
  // `canceled` chega em seguida e grava o mesmo estado; o log é o que explica a janela entre os dois.
  if (error) {
    console.error("[hades][acordo][assinatura] cancelou na Clicksign e não gravou aqui", error);
  }

  return { envelopeId: linha.envelope_id, ok: true };
}
