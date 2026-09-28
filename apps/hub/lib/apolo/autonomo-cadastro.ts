// A PORTA DA HABILITAÇÃO DO CORRETOR AUTÔNOMO — quem habilita, o que fica registrado e quem fica
// sabendo. Espelho de `lib/apolo/imobiliaria-cadastro.ts` + `lib/apolo/habilitacao-pelo-cadastro.ts`,
// para o autônomo, e SEM nenhuma palavra "imobiliária" chegando a ele.
//
// Lucas (27/09/2026), perguntado se o autônomo vende em tudo ou só onde a coordenação liberar:
// *"Sim, empreendimento a empreendimento"*. E a regra-mãe, do mesmo dia: *"nao quero ter a informacao
// que pode ter pessoa fisica como imobiliaria, isso sera bem restrito"*.
//
// ⚠️ POR QUE UM MÓDULO PRÓPRIO, E NÃO O `/api/apolo/relationships/create` QUE JÁ EXISTE. Aquele ramo
// grava o vínculo `empreendimento` `verified` para QUALQUER entidade, sem olhar papel nem
// `entity_kind` (medido lendo o arquivo: app/api/apolo/relationships/create/route.ts:117), então ele
// habilitaria o autônomo hoje. O que ele NÃO faz é o resto, e o resto é a decisão do Lucas de
// 24/09/2026 ("3 - Isso ae"): habilitação feita por dentro AVISA O COORDENADOR e deixa linha de
// auditoria. Pelo modal, `habilitacaoPeloVinculo` exige papel `imobiliaria` ativo e devolve
// `nao-e-habilitacao` para o autônomo, ou seja, ele seria habilitado EM SILÊNCIO. Foi exatamente o
// silêncio que a LUNA sofreu com a VIDA IMOVEIS, a SANTA FE e a VINICIUS JOHNNY no 43.
//
// ⚠️ E A MENSAGEM É OUTRA. `mensagemCoordenadorHabilitacao` abre com *"Imobiliária habilitada no seu
// empreendimento"*: reusá-la diria ao coordenador, por escrito, que uma pessoa física é imobiliária.
// Aqui vai `mensagemCoordenadorHabilitacaoDoAutonomo`.
//
// ⚠️ NENHUMA MIGRATION. Medido em produção (bxgukywoxgivlrhjkwjx, 28/09/2026): `apolo_disparos.tipo` e
// `apolo_audit_events.action` são `text` SEM CHECK (o único CHECK de `apolo_audit_events` é o de
// `status`), e `apolo_relationships_status_check` já aceita `verified`. O tipo de disparo e a ação de
// auditoria novos entram sem tocar o schema.
import { mensagemCoordenadorHabilitacaoDoAutonomo } from "@/lib/apolo/credenciamento-mensagens";
import { listEmpreendimentosAtivos } from "@/lib/apolo/credenciamento";
import { expansorDeEmpreendimentos } from "@/lib/apolo/habilitacao-pelo-cadastro";
import {
  coordenadoresDosEmpreendimentosPorId,
  enviarPeloRelacionamento,
} from "@/lib/apolo/disparo-credenciamento";
import {
  type Autonomo,
  FONTE_DA_HABILITACAO_DO_AUTONOMO,
  idsHabilitadosDoAutonomo,
  lerAutonomo,
  MENSAGEM_FALHA_AO_LER_HABILITACAO,
  type RecusaDoAutonomo,
} from "@/lib/apolo/habilitacao-do-autonomo";
import type { createApoloAdminClient } from "@/lib/apolo/server";
import { filtrarEmpreendimentosHabilitados, type EmpreendimentoPublico } from "@/lib/publico/cad/regras";

type AdminClient = NonNullable<ReturnType<typeof createApoloAdminClient>>;

/** A ação de auditoria da habilitação do autônomo, separada da da imobiliária de propósito. */
export const ACAO_DA_HABILITACAO_DO_AUTONOMO = "corretor_autonomo_habilitado";
/** O tipo do disparo ao coordenador, separado pelo mesmo motivo (a tela de status os distingue). */
export const TIPO_DO_DISPARO_DO_AUTONOMO = "credenciamento_coordenador_autonomo";

/**
 * Os empreendimentos que ESTE autônomo trabalha: habilitação dele ∩ empreendimentos ATIVOS.
 *
 * ⚠️ MESMO RECORTE DA IMOBILIÁRIA (`empreendimentosHabilitadosInterno`), inclusive o
 * `filtrarEmpreendimentosHabilitados`, que é quem sabe que o vínculo pode estar no id da DIVISÃO
 * enquanto o catálogo mostra o GRUPO (o caso DANY CASTRO no Lagoa Bonita). Usa o MASTER
 * (`credenciamento_ativo`) sozinho, sem o portão público `recepcao_cad`: quem cadastra aqui é o time
 * interno, como no cadastro manual de prospect.
 */
export async function empreendimentosDoAutonomo(
  client: AdminClient,
  entityId: string,
): Promise<EmpreendimentoPublico[]> {
  const habilitados = await idsHabilitadosDoAutonomo(client, entityId);
  if (!habilitados.ok) return [];
  if (habilitados.ids.length === 0) return [];
  const ativos = await listEmpreendimentosAtivos(client);
  return filtrarEmpreendimentosHabilitados(habilitados.ids, ativos);
}

export type HabilitacaoDoAutonomoFeita = {
  autonomo: Autonomo;
  auditou: boolean;
  coordenadores: { avisados: number; falharam: number };
  /** true = a habilitação já existia; nada foi gravado e ninguém foi avisado de novo. */
  jaHabilitado: boolean;
  ok: true;
};

/**
 * HABILITA O AUTÔNOMO NUM EMPREENDIMENTO.
 *
 * ⚠️ A FICHA É CONFERIDA ANTES DE QUALQUER ESCRITA (`lerAutonomo`): só entidade `pf`, com
 * `broker_code`, papel `corretor` ativo e SEM papel `imobiliaria`. Sem isso, esta rota seria um jeito
 * de habilitar qualquer ficha da base por um id no corpo.
 *
 * ⚠️ HABILITAÇÃO REPETIDA NÃO GRAVA LINHA NOVA NEM AVISA DE NOVO. É a lição medida de 24/09/2026 com a
 * SANTA FE e a VINICIUS JOHNNY: o wizard gravava uma segunda linha `verified` e o coordenador receberia
 * "habilitada no seu empreendimento" sobre quem já vendia o produto havia semanas.
 *
 * ⚠️ O AVISO É BEST-EFFORT E NUNCA DESFAZ A HABILITAÇÃO: quando ele roda, o vínculo já está gravado.
 * Coordenador não achado ou sem telefone vira disparo `falhou` COM o motivo (`impedimento`), que é o
 * que a tela de status mostra, e não um silêncio.
 */
export async function habilitarAutonomoNoEmpreendimento(
  client: AdminClient,
  input: {
    autorNome?: null | string;
    autorUserId: null | string;
    enterpriseId: string;
    entityId: string;
    label: string;
  },
): Promise<HabilitacaoDoAutonomoFeita | RecusaDoAutonomo> {
  const enterpriseId = String(input.enterpriseId ?? "").trim();
  if (!enterpriseId) {
    return {
      mensagem: "Informe o empreendimento em que o corretor autônomo será habilitado.",
      motivo: "nao-habilitado",
      ok: false,
    };
  }

  const ficha = await lerAutonomo(client, input.entityId);
  if (!ficha.ok) return ficha;
  const autonomo = ficha.autonomo;

  const habilitados = await idsHabilitadosDoAutonomo(client, input.entityId);
  if (!habilitados.ok) return habilitados;
  // ⚠️ "JÁ HABILITADO" USA A MESMA EXPANSÃO QUE A AUTORIZAÇÃO (revisão de 28/09/2026). A primeira
  // versão comparava o id CRU (`habilitados.ids.includes(enterpriseId)`) enquanto
  // `conferirHabilitacaoDoAutonomo` expande pai e grupo: quem estivesse habilitado no PAI "35" (que é
  // como o wizard grava) e fosse habilitado de novo na divisão "37" ganhava um SEGUNDO vínculo
  // `verified` e o coordenador recebia "Corretor autônomo habilitado no seu empreendimento" sobre quem
  // já vendia o produto. É literalmente o caso SANTA FE e VINICIUS JOHNNY de 24/09/2026 que o
  // cabeçalho cita como lição, e o caminho da imobiliária não tem o furo porque usa
  // `separarVinculosNovos` COM o expansor. Se a função que confere e a que grava não usarem a mesma
  // régua, uma sempre vai discordar da outra.
  //
  // ⚠️ AQUI O EXPANSOR TOLERANTE SERVE, e é de propósito: esta é a doutrina de AVISO, não de
  // autorização. Leitura do cadastro que falha cai na identidade e o pior caso é um aviso repetido ao
  // coordenador, que se vê. Na régua que AUTORIZA (`conferirHabilitacaoDoAutonomo`) o cadastro é lido
  // direto e a falha recusa, porque lá o erro frouxo é venda de quem a coordenação não liberou.
  const expandir = await expansorDeEmpreendimentos([...habilitados.ids, enterpriseId]);
  const permitidos = new Set<string>();
  for (const id of habilitados.ids) {
    permitidos.add(id);
    for (const coberto of expandir(id)) permitidos.add(coberto);
  }
  const alvo = [enterpriseId, ...expandir(enterpriseId)];
  if (alvo.some((id) => permitidos.has(id))) {
    return {
      autonomo,
      auditou: false,
      coordenadores: { avisados: 0, falharam: 0 },
      jaHabilitado: true,
      ok: true,
    };
  }

  const label = String(input.label ?? "").trim() || "Empreendimento";
  const { error } = await client.from("apolo_relationships").insert({
    entity_id: autonomo.entityId,
    label,
    metadata: {
      c2xSynced: false,
      createdAt: new Date().toISOString(),
      createdBy: input.autorUserId,
      enterpriseId,
      enterpriseLabel: label,
      kind: "trabalho",
      role: "empreendimento",
      // ⚠️ A FONTE É O QUE SEPARA ESTA HABILITAÇÃO DO VÍNCULO DE CAD DE UM CLIENTE (169 assim em
      // entidade `pf` hoje, todos `publico-cad`). Ver `habilitacao-do-autonomo.ts`.
      source: FONTE_DA_HABILITACAO_DO_AUTONOMO,
    },
    related_entity_id: null,
    relationship_type: "empreendimento",
    status: "verified",
  });
  if (error) {
    console.error("[apolo][autonomo] falha ao gravar a habilitacao", error.message);
    return { mensagem: MENSAGEM_FALHA_AO_LER_HABILITACAO, motivo: "falha", ok: false };
  }

  const resultado: HabilitacaoDoAutonomoFeita = {
    autonomo,
    auditou: false,
    coordenadores: { avisados: 0, falharam: 0 },
    jaHabilitado: false,
    ok: true,
  };

  // AUDITORIA. Ação PRÓPRIA: a contagem de habilitações de imobiliária não pode somar autônomo, ou o
  // painel do coordenador passaria a dizer que ele tem mais parceiros do que tem.
  try {
    const { error: erroDaAuditoria } = await client.from("apolo_audit_events").insert({
      action: ACAO_DA_HABILITACAO_DO_AUTONOMO,
      actor_user_id: input.autorUserId,
      entity_id: autonomo.entityId,
      field_name: "habilitacao_corretor_autonomo",
      metadata: {
        automatico: false,
        codigo: autonomo.codigo,
        enterpriseId,
        origem: "cadastro-interno",
      },
      status: "mapped",
    });
    resultado.auditou = !erroDaAuditoria;
    if (erroDaAuditoria) {
      console.error("[apolo][autonomo] falha ao auditar a habilitacao", erroDaAuditoria.message);
    }
  } catch (erro) {
    console.error("[apolo][autonomo] falha ao auditar a habilitacao", erro);
  }

  // AVISO AO COORDENADOR (Lucas, 24/09/2026, "3 - Isso ae"), pelo ID do empreendimento e nunca pela
  // sigla (a busca que achou a LUNA depois do renome do 43).
  try {
    const coordenadores = await coordenadoresDosEmpreendimentosPorId(client, [
      { enterpriseId, label },
    ]);
    const envios = await Promise.all(
      coordenadores.map((coordenador) =>
        enviarPeloRelacionamento(client, {
          destinatario: `coordenador:${coordenador.nome}`,
          entityId: autonomo.entityId,
          impedimento: coordenador.motivo,
          telefone: coordenador.telefone,
          texto: mensagemCoordenadorHabilitacaoDoAutonomo({
            codigo: autonomo.codigo,
            corretor: autonomo.nome,
            empreendimentos: coordenador.empreendimentos,
            responsavel: input.autorNome ?? null,
          }),
          tipo: TIPO_DO_DISPARO_DO_AUTONOMO,
        }),
      ),
    );
    resultado.coordenadores = {
      avisados: envios.filter((envio) => envio.ok).length,
      falharam: envios.filter((envio) => !envio.ok).length,
    };
  } catch (erro) {
    console.error("[apolo][autonomo] falha ao avisar o coordenador da habilitacao", erro);
  }

  return resultado;
}
