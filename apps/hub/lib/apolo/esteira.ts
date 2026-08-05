// Atualização da ETAPA da esteira (apolo_esteira). Centraliza o upsert de etapa, que hoje vive
// espalhado (asana-import.ts, publico/cad/dados.ts), e serve tanto às ações do operador no Board
// quanto ao gatilho automático do crédito (aprovado -> pré-venda, reprovado -> revisão).
//
// Vocabulário de etapas (migration 0057): a app impõe, o banco não tem CHECK.
//   validacao | credito | revisao | prevenda | credenciado | correcao | indeferido
//
// ⚠️ DESDE A MIGRATION 0080 A CHAVE DA ESTEIRA É `(entity_id, enterprise_id)`: uma CAD por pessoa
// POR EMPREENDIMENTO. "A etapa do fulano" deixou de ser uma frase completa — toda escrita aqui é
// presa numa CAD só. Ver `lib/apolo/esteira-cad.ts`.
// Ver [[project_esteira_credenciamento_venda]].

import { lerCadDaEsteira, normalizarEnterpriseId } from "@/lib/apolo/esteira-cad";
import { resolverPrevendaHabilitada } from "@/lib/apolo/limite-credito";
import { createApoloAdminClient } from "@/lib/apolo/server";

type AdminClient = NonNullable<ReturnType<typeof createApoloAdminClient>>;

export const ETAPAS_ESTEIRA = [
  "validacao",
  "credito",
  "revisao",
  "prevenda",
  "credenciado",
  "correcao",
  "indeferido",
] as const;

export type EtapaEsteira = (typeof ETAPAS_ESTEIRA)[number];

// Ordem do CAMINHO FELIZ, só para o avanço automático nunca rebaixar quem já passou (mesma ordem
// do asana-import). Os desvios (revisao/correcao/indeferido) ficam fora de propósito: são
// movimentos LATERAIS, decididos pelo operador, e não entram nessa comparação.
const ORDEM: Record<string, number> = { validacao: 0, credito: 1, prevenda: 2, credenciado: 3 };

// A partir daqui a máquina não mexe mais: ou o crédito já foi liberado, ou a pessoa já pagou.
const ORDEM_PREVENDA = 2;

const ehUuid = (v: unknown): v is string =>
  typeof v === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

export function ehEtapaValida(v: unknown): v is EtapaEsteira {
  return typeof v === "string" && (ETAPAS_ESTEIRA as readonly string[]).includes(v);
}

// Grava a etapa.
//
// `nuncaRebaixar` é para os avanços AUTOMÁTICOS (ex.: crédito aprovado), que não podem desfazer um
// item que já andou; nas ações explícitas do operador (indeferir, revisão) ele fica falso, porque
// ali a vontade de quem analisa manda.
//
// `automatico` é a trava contra REGRESSÃO: quem já está em pré-venda ou credenciado NÃO é movido
// por gatilho de máquina. Sem isso, reconsultar o Serasa de uma ficha já credenciada (que portanto
// já PAGOU) devolvia ela para revisão — foi o que aconteceu em 23/jul. `nuncaRebaixar` sozinho não
// resolvia porque os desvios (revisao/correcao/indeferido) ficam fora da ORDEM e "venciam"
// qualquer comparação. Decisão humana continua livre: quem chama sem esta flag manda.
// `enterpriseId` diz de QUAL CAD é a etapa. Desde a 0080 a mesma pessoa pode ter CAD em vários
// empreendimentos, e mover "a etapa do fulano" deixou de ser uma frase completa. Quem tem o id em
// mãos (o card do Board, o portal) passa; quem não tem (gatilho do crédito, rotas antigas) cai na
// CAD MAIS RECENTE, com ordem explícita.
export async function atualizarEtapa(
  client: AdminClient,
  entityId: string,
  etapa: EtapaEsteira,
  opts: {
    atualizadoPor?: string | null;
    automatico?: boolean;
    enterpriseId?: null | number | string;
    motivo?: string | null;
    nuncaRebaixar?: boolean;
    // PROBLEMA 2 (Lucas, 04/08): crédito REPROVADO mora em "revisao" e NÃO pode avançar para
    // cobrança/credenciamento por um clique manual. Só a COORDENAÇÃO destrava, e só pela rota de
    // override (com evidência anexada), que passa esta flag. Sem ela, sair de "revisao" para
    // "prevenda"/"credenciado" é barrado aqui — ver o guard abaixo.
    saidaDeRevisaoAutorizada?: boolean;
  } = {},
): Promise<{
  // `true` = a saída de "revisao" para uma etapa de avanço foi barrada (PROBLEMA 2): crédito
  // reprovado só avança pela coordenação. A rota traduz em 409, não em 500 — é pedido incoerente.
  bloqueado?: boolean;
  error: string | null;
  etapa: EtapaEsteira;
  mantida?: boolean;
  // `true` = não havia CAD para mover (nem empreendimento para criar uma). Não é falha de
  // servidor: é o pedido que não faz sentido, e a rota traduz isso em 409, não em 500.
  semCad?: boolean;
}> {
  let alvo: EtapaEsteira = etapa;
  const enterpriseIdPedido = normalizarEnterpriseId(opts.enterpriseId);

  // A LEITURA PASSOU A SER SEMPRE NECESSÁRIA, não só nos avanços automáticos: é dela que sai o
  // `enterprise_id` da CAD que vai receber a etapa. Sem ele o upsert não sabe em qual linha
  // gravar — e, com `enterprise_id` NOT NULL, um INSERT sem empreendimento nem chega ao banco.
  const atual = await lerCadDaEsteira<{ enterprise_id: null | string; etapa: null | string }>(
    client,
    entityId,
    "enterprise_id, etapa",
    { enterpriseId: enterpriseIdPedido },
  );

  // PROBLEMA 2 (Lucas, 04/08): crédito REPROVADO mora em "revisao" e NÃO pode avançar para
  // cobrança (prevenda) nem credenciamento por um clique manual. Foi exatamente isso que aconteceu
  // com o Ramon: reprovado no Serasa (score 454, restrições acima do limite), etapa foi para
  // "revisao" — e um clique do Board ("Aprovar crédito (coordenador)") o empurrou para "prevenda"
  // sem nenhuma autorização registrada. A partir daqui esse pulo é BARRADO, exceto por:
  //   • um avanço AUTOMÁTICO legítimo (o cônjuge aprovado resgata a ficha) — passa `automatico`;
  //   • o OVERRIDE da coordenação, com evidência anexada — passa `saidaDeRevisaoAutorizada`.
  // Qualquer outra tentativa de sair de "revisao" para avançar volta como `bloqueado` (a rota
  // traduz em 409). Movimentos LATERAIS (voltar para "credito"/"correcao") continuam livres.
  const saindoDeRevisao = atual?.etapa === "revisao";
  const ehAvanco = etapa === "prevenda" || etapa === "credenciado";
  if (saindoDeRevisao && ehAvanco && !opts.automatico && !opts.saidaDeRevisaoAutorizada) {
    return {
      bloqueado: true,
      error:
        "Crédito reprovado: a ficha está em revisão e não pode avançar sem a aprovação da " +
        "coordenação (com evidência anexada).",
      etapa: "revisao",
    };
  }

  if (opts.nuncaRebaixar || opts.automatico) {
    const etapaAtual = atual?.etapa ?? null;
    const pesoAtual = ORDEM[etapaAtual ?? ""] ?? -1;
    const pesoNovo = ORDEM[etapa] ?? -1;

    // Passou da análise? Máquina não mexe mais — nem para frente, nem para trás.
    if (opts.automatico && ehEtapaValida(etapaAtual) && pesoAtual >= ORDEM_PREVENDA) {
      return { error: null, etapa: etapaAtual, mantida: true };
    }
    if (opts.nuncaRebaixar && pesoAtual > pesoNovo && ehEtapaValida(etapaAtual)) {
      alvo = etapaAtual;
    }
  }

  const enterpriseId = enterpriseIdPedido ?? normalizarEnterpriseId(atual?.enterprise_id);

  // SEM EMPREENDIMENTO NÃO SE CRIA CAD. Antes esta função criava a linha como EFEITO COLATERAL de
  // mover a etapa — e criava sem empreendimento, em silêncio, produzindo CAD órfã. Isso deixou de
  // ser possível: recusar aqui é a diferença entre um erro visível e um dado corrompido.
  //
  // ⚠️ QUEM PODE CAIR AQUI: o Board lista DUAS origens — quem está na esteira e quem só é uma
  // entidade em `review` vinda do wizard (o wizard só cria linha na esteira quando o operador
  // escolheu empreendimento E imobiliária). O card da segunda origem não tem CAD, e antes mover a
  // etapa dele CRIAVA uma, sem empreendimento. A saída certa é escolher o empreendimento no
  // cadastro, não deixar a CAD nascer órfã de um clique de etapa.
  if (!enterpriseId) {
    return {
      error: atual
        ? "A CAD desta ficha está sem empreendimento; a etapa não pode ser gravada."
        : "Esta ficha ainda não tem CAD na esteira. Informe o empreendimento no cadastro antes de mover a etapa.",
      etapa: alvo,
      semCad: true,
    };
  }

  // PROBLEMA 1 (Lucas, 04/08): a pré-venda (cobrança PIX de R$ 1.000) é DO EMPREENDIMENTO. No VLO
  // ela está desligada (`prevenda_habilitada=false`) e mesmo assim o Ramon caiu em "prevenda".
  // Aqui — o ponto autoritativo único de escrita de etapa — quem tentar mandar para "prevenda" com
  // a pré-venda desligada é redirecionado para "credenciado" (pula a cobrança). Assim TODO caminho
  // respeita o toggle: a rota do Serasa, o override da coordenação, o move manual do Board e a
  // importação. Só consultamos a setting quando o alvo é "prevenda"; nas outras transições não há
  // leitura extra. `enterpriseId` já resolvido acima, então `resolverPrevendaHabilitada` não refaz
  // a busca do empreendimento.
  if (alvo === "prevenda") {
    const prevendaHabilitada = await resolverPrevendaHabilitada(client, entityId, enterpriseId);
    if (!prevendaHabilitada) alvo = "credenciado";
  }

  // Só as colunas que mudam. `etapa` é NOT NULL com default, então o caminho de INSERT (CAD nova
  // deste empreendimento) também é seguro. NÃO tocar ficha nem colunas de vínculo.
  const registro: Record<string, unknown> = {
    atualizado_em: new Date().toISOString(),
    atualizado_por: ehUuid(opts.atualizadoPor) ? opts.atualizadoPor : null,
    enterprise_id: enterpriseId,
    entity_id: entityId,
    etapa: alvo,
  };
  if (opts.motivo !== undefined) registro.motivo = opts.motivo;

  // ⚠️ `onConflict` TEM QUE CASAR COM A CONSTRAINT ÚNICA. Com a PK composta, `"entity_id"` sozinho
  // vira erro 42P10 do Postgres ("no unique constraint matching the ON CONFLICT specification") no
  // minuto seguinte à migration — sem depender de existir uma segunda CAD.
  const { error } = await client
    .from("apolo_esteira")
    .upsert(registro, { onConflict: "entity_id,enterprise_id" });

  // ESTÁ NO BOARD → ESTÁ NA FILA DO LANÇAMENTO, EM QUALQUER ETAPA.
  //
  // ⚠️ REGRA DO DIA DO EVENTO (Lucas, 01/08, com o Vale do Ouro rodando): "hoje tudo liberado,
  // entrou no board vai para etiquetas". Antes só `credenciado` alimentava a fila do Prometeu, e a
  // tela de etiquetas lê SÓ de lá — resultado: quem estava em validação, revisão, pré-venda ou
  // correção estava no salão e não existia para a impressão. No dia do lançamento não dá para
  // explicar para o cliente na fila que a etapa do card dele não deixa imprimir a etiqueta.
  //
  // Quem ler isto depois: esta amplitude é DO DIA DO EVENTO, não uma regra de negócio permanente.
  // Se o Prometeu voltar a operar num dia normal e a fila tiver que ser só de credenciado, é aqui
  // que a condição volta a ser `alvo === "credenciado"`.
  //
  // Best-effort e DEPOIS do upsert: se falhar, a etapa já mudou e o resto fica para o backfill
  // (`scripts/apolo/liberar-board-para-etiquetas.mjs`). A fila é consequência, nunca condição.
  if (!error) {
    const { garantirNaFilaDoLancamento } = await import("./credenciado-para-fila");
    await garantirNaFilaDoLancamento(client, entityId, { enterpriseId });
  }

  // SUBIR PARA O C2X continua SÓ para "credenciado", de propósito. O C2X é o sistema de contratos:
  // mandar para lá uma ficha que ainda está em validação ou correção é cadastrar cliente com dado
  // incompleto no lugar mais caro de consertar. Liberar a ETIQUETA é barato e reversível; liberar
  // o CADASTRO NO CONTRATO não é — por isso as duas regras andam separadas a partir de hoje.
  if (!error && alvo === "credenciado") {
    const { subirParaC2xAoCredenciar } = await import("./credenciado-para-c2x");
    await subirParaC2xAoCredenciar(client, entityId);
  }

  return { error: error?.message ?? null, etapa: alvo };
}
