// Fluxo da pré-venda entre o Board (apolo_esteira) e a fila do Prometeu.
//
// Regra (Lucas, 22/jul):
//  1. ENVIOU o PIX  -> a ficha sai de "prevenda" e vira "credenciado", e a pessoa ENTRA na fila do
//     evento ativo. Sem pagamento ainda, `ordem_fila` fica nula: o Prometeu já joga esses pro fim,
//     desempatando por ordem de cadastro (a data de envio da CAD).
//  2. PAGOU         -> carimbamos o pagamento na esteira (é o que o Board mostra e filtra) e no
//     Prometeu. Lá a `ordem_fila` vira a HORA do pagamento, então a fila se reordena sozinha e
//     quem pagou vai pra frente, sem tocar em mais ninguém.
//
// A hora usada é a NOSSA (recebimento do webhook): o `paymentDate` do Asaas vem sem hora e
// empataria as pessoas. Ver [[project_prometeu_gestao_fila]] e [[project_asaas_prevenda]].

import type { SupabaseClient } from "@supabase/supabase-js";

import { adicionarCredenciado, eventoOperavelId, registrarPagamento } from "@/lib/prometeu/data";

import { garantirNaFilaDoLancamento } from "./credenciado-para-fila";
import { lerCadDaEsteira, normalizarEnterpriseId } from "./esteira-cad";
import { resolverEnterpriseIdPorNome, resolverPrevendaHabilitada } from "./limite-credito";

// CONTATOS DA FICHA — a MESMA fonte para a cobrança e para o recibo. Antes cada um puxava de um
// lugar (a cobrança da tela, o recibo do cadastro do Asaas, que nasce vazio) e o recibo não saía.
export async function contatosDaFicha(
  client: SupabaseClient,
  entityId: string,
): Promise<{ email: string | null; telefone: string | null }> {
  const { data } = await client
    .from("apolo_contacts")
    .select("contact_type, value, is_primary")
    .eq("entity_id", entityId)
    .limit(20);

  const lista = (data ?? []) as Array<{
    contact_type: string | null;
    is_primary: boolean | null;
    value: string | null;
  }>;

  // Preferimos o marcado como principal; senão, o primeiro que tiver valor.
  const pega = (tipos: string[]) => {
    const vale = (c: (typeof lista)[number]) =>
      tipos.includes(c.contact_type ?? "") && Boolean(c.value?.trim());
    return (
      lista.find((c) => vale(c) && c.is_primary)?.value?.trim() ??
      lista.find(vale)?.value?.trim() ??
      null
    );
  };

  // ⚠️ O C2X grava telefone como 'whatsapp' (4.067 registros) e quase nunca como 'phone' (520):
  // procurar só por 'phone' deixaria a maioria das fichas sem telefone.
  return { email: pega(["email"]), telefone: pega(["whatsapp", "phone"]) };
}

// TESTE DA BANCADA: grava na arquitetura os dados digitados, para a pessoa percorrer o MESMO
// caminho do fluxo real (contatos em apolo_contacts + ficha em pré-venda na esteira). Sem isso, o
// teste valida a tela, não o caminho. Idempotente: repetir não duplica.
export async function plantarFichaPrevenda(
  client: SupabaseClient,
  input: {
    email?: string | null;
    empreendimento?: string | null;
    // Id do empreendimento no C2X. Desde a 0080 a esteira EXIGE (a chave é
    // `entity_id + enterprise_id`), então sem ele não há CAD para plantar. Quando a bancada só
    // souber o nome, ele é traduzido pelo C2X logo abaixo.
    enterpriseId?: null | number | string;
    entityId: string;
    telefone?: string | null;
  },
): Promise<{ contatos: string; esteira: string }> {
  const saida = { contatos: "sem dados", esteira: "mantida" };

  // Grava o contato e o torna PRINCIPAL. Dois cuidados aprendidos na marra:
  //  1. `status` tem CHECK no banco ('verified'|'pending'|'attention'|'blocked'). Gravar "active"
  //     violava a constraint e o insert falhava — em SILÊNCIO, porque o erro não era checado.
  //     Resultado: o operador corrigia o telefone na tela e o envio saía para o número antigo.
  //  2. Só inserir não basta: se o contato antigo continuar como principal, é ele que o envio usa.
  //     Por isso o novo vira principal e os outros do mesmo tipo deixam de ser.
  const erros: string[] = [];
  const gravarContato = async (tipo: string, valor: string) => {
    const { data: jaTem } = await client
      .from("apolo_contacts")
      .select("id")
      .eq("contact_type", tipo)
      .eq("entity_id", input.entityId)
      .eq("value", valor)
      .maybeSingle<{ id: string }>();

    // Tira o principal dos demais do mesmo tipo: quem vale é o que acabou de ser informado.
    await client
      .from("apolo_contacts")
      .update({ is_primary: false })
      .eq("contact_type", tipo)
      .eq("entity_id", input.entityId);

    if (jaTem) {
      const { error } = await client
        .from("apolo_contacts")
        .update({ is_primary: true })
        .eq("id", jaTem.id);
      if (error) erros.push(`${tipo}: ${error.message}`);
      return;
    }

    const { error } = await client.from("apolo_contacts").insert({
      contact_type: tipo,
      entity_id: input.entityId,
      is_primary: true,
      metadata: { origem: "bancada-prevenda" },
      status: "pending",
      value: valor,
    });
    if (error) erros.push(`${tipo}: ${error.message}`);
  };

  const telefone = input.telefone?.trim();
  const email = input.email?.trim();
  if (telefone) await gravarContato("whatsapp", telefone);
  if (email) await gravarContato("email", email);
  if (erros.length) saida.contatos = `erro: ${erros.join(" · ")}`;
  else if (telefone || email) saida.contatos = "gravados";

  // De qual CAD estamos falando: a do empreendimento informado (ou traduzido do nome). A bancada
  // é teste, então uma tradução falhada não pode virar CAD sem empreendimento — vira recado.
  const enterpriseId =
    normalizarEnterpriseId(input.enterpriseId) ??
    (await resolverEnterpriseIdPorNome(input.empreendimento ?? null));

  // Sem linha na esteira a pessoa não está "na pré-venda": criamos para o fluxo ser o real.
  const esteira = await lerCadDaEsteira<{ etapa: null | string }>(
    client,
    input.entityId,
    "etapa",
    { enterpriseId },
  );

  if (esteira) {
    saida.esteira = `já existia (${esteira.etapa ?? "sem etapa"})`;
    return saida;
  }

  if (!enterpriseId) {
    saida.esteira =
      "erro: sem empreendimento resolvido — a esteira exige o id do empreendimento (chave por CAD)";
    return saida;
  }

  // ⚠️ NEM A BANCADA CRIA PRÉ-VENDA ONDE ELA NÃO EXISTE (Lucas, 10/08: "pré-venda só existe se
  // estiver habilitado"). Este INSERT é a única escrita de `etapa` que não passa por
  // `atualizarEtapa`, ou seja, o único lugar do produto que escapava do toggle. Um teste que
  // plantasse ficha em pré-venda num empreendimento sem cobrança criaria, na tela do time, o
  // mesmo fantasma que estamos consertando.
  const prevendaHabilitada = await resolverPrevendaHabilitada(
    client as never,
    input.entityId,
    enterpriseId,
  );
  if (!prevendaHabilitada) {
    saida.esteira =
      "recusada: a pré-venda está desligada neste empreendimento (ligue o PIX em Empreendimentos antes de testar)";
    return saida;
  }

  const { error } = await client.from("apolo_esteira").insert({
    chegou_em: new Date().toISOString(),
    empreendimento: input.empreendimento ?? null,
    enterprise_id: enterpriseId,
    entity_id: input.entityId,
    etapa: "prevenda",
    origem: "bancada-teste",
  });
  saida.esteira = error ? `erro: ${error.message}` : "criada em pré-venda";

  return saida;
}

// Registra o envio em `apolo_disparos`. O webhook da Meta atualiza entregue/lido casando por
// `wa_message_id`, então é daqui que sai a auditoria do disparo em massa: quem recebeu, quem
// falhou e onde retomar. Best-effort — falhar aqui não invalida a mensagem, que já saiu.
export async function registrarDisparoPrevenda(
  client: SupabaseClient,
  r: {
    canal: "email" | "whatsapp";
    destinatario: string | null;
    entityId: string | null;
    erro?: string | null;
    template: string;
    tipo: "prevenda_cobranca" | "prevenda_recibo";
    waMessageId?: string | null;
  },
): Promise<void> {
  try {
    await client.from("apolo_disparos").insert({
      destinatario: r.destinatario,
      entity_id: r.entityId,
      erro: r.erro ?? null,
      origem: `prevenda:${r.canal}`,
      status: r.erro ? "falhou" : "enviado",
      telefone: r.canal === "whatsapp" ? r.destinatario : null,
      template: r.template,
      tipo: r.tipo,
      wa_message_id: r.waMessageId ?? null,
    });
  } catch {
    /* best-effort */
  }
}

// Evento do Prometeu que recebe gente na fila.
//
// ⚠️ ARMADILHA CORRIGIDA EM 01/08 (dia do Vale do Ouro): aqui existia um `eventoAtivoId` local
// que filtrava só `status = 'ativo'`. Só que "ativo" é o evento em PREPARO — quando o dia começa,
// `iniciarEventoReal` muda o status para `em_andamento`. Ou seja: a partir do momento em que o
// evento abre, esta consulta passava a devolver NADA, e todo mundo que pagava o PIX virava
// "credenciado" no Board sem entrar na fila nem sair na impressão de etiqueta — justamente no
// horário em que isso mais dói.
//
// `eventoOperavelId` é a MESMA regra que o resto do Prometeu usa (prioriza `em_andamento`, cai
// para `ativo`): a fila do dia e o Board deixam de discordar sobre qual é o evento.
const eventoDaFilaId = (client: SupabaseClient): Promise<string | null> =>
  eventoOperavelId(client);

// SOBE PARA O C2X QUEM FOI CREDENCIADO AQUI.
//
// Mesmo buraco que a rede da fila (`garantirNaFilaDoLancamento`) tapa, mas do lado do legado: as
// duas funções abaixo gravam `etapa: "credenciado"` por ESCRITA DIRETA na apolo_esteira, então não
// passam pelo gancho de `atualizarEtapa` (esteira.ts), que é o ÚNICO lugar que chamava o envio ao
// C2X. Como o fluxo real do negócio é justamente este (o PIX de R$ 1.000 é o que credencia), o
// cliente credenciado por PIX não chegava no C2X: o Board mostrava "credenciado" e o sistema de
// contratos não tinha a pessoa, sem ninguém perceber.
//
// BEST-EFFORT COM TETO DE TEMPO. `subirParaC2xAoCredenciar` já não lança, mas conversa com o
// legado (MySQL do C2X + API Rails) e pode ficar pendurado. Um dos chamadores é o WEBHOOK do
// Asaas, que precisa devolver 200 rápido (senão o Asaas reentrega o pagamento). Estourando o
// teto, paramos de ESPERAR, o envio segue no ar e a etapa, a fila e a resposta seguem normais.
// Nunca segura nem reverte a mudança de etapa: a ficha que não subir fica para o lote da tela
// Sync C2X, que é o mesmo desfecho de antes.
const TETO_C2X_MS = 8_000;

async function subirParaC2xBestEffort(client: SupabaseClient, entityId: string): Promise<string> {
  let alarme: ReturnType<typeof setTimeout> | undefined;
  try {
    // Import dinâmico como em `esteira.ts`: o envio puxa o pool do MySQL do C2X, que não tem por
    // que entrar no módulo de quem só mexe na esteira.
    const { subirParaC2xAoCredenciar } = await import("./credenciado-para-c2x");
    const envio = subirParaC2xAoCredenciar(client, entityId)
      .then((r) => (r.enviado ? r.detalhe : `não subiu: ${r.detalhe}`))
      .catch((erro) => (erro instanceof Error ? erro.message : String(erro)));
    const teto = new Promise<string>((resolve) => {
      alarme = setTimeout(() => resolve("C2X demorou: o envio segue em segundo plano"), TETO_C2X_MS);
    });
    return await Promise.race([envio, teto]);
  } catch (erro) {
    return erro instanceof Error ? erro.message : String(erro);
  } finally {
    clearTimeout(alarme);
  }
}

export async function aoEnviarPixPrevenda(input: {
  client: SupabaseClient;
  // De qual CAD é este PIX. Sem ele, a CAD mais recente da pessoa.
  enterpriseId?: null | number | string;
  entityId: string;
  // Cobrança recém-criada no Asaas. Gravamos JÁ na emissão: sem isso a ficha só sabia do PIX
  // depois do pagamento, e a tela mostrava "ainda não gerado" com o PIX na mão do cliente.
  paymentId?: string | null;
}): Promise<{ c2x?: string; etapa: string; fila: string }> {
  const { client, entityId } = input;
  // `c2x` é diagnóstico: sai na resposta da bancada/do lote para dar para ver, sem abrir o banco,
  // se a ficha subiu para o C2X ao ser credenciada.
  const saida: { c2x?: string; etapa: string; fila: string } = {
    etapa: "não movida",
    fila: "não entrou",
  };

  // ⚠️ A CAD ALVO É RESOLVIDA UMA VEZ, ANTES DE QUALQUER ESCRITA, e todas as escritas abaixo são
  // presas nela. Sem isto, `.eq("entity_id", ...)` sozinho carimbaria o `pagamento_ref` e
  // credenciaria a pessoa em TODOS os empreendimentos onde ela tem CAD — e aqui há dinheiro
  // envolvido: o `pagamento_ref` é a trava que impede cobrar R$ 1.000 duas vezes.
  const esteira = await lerCadDaEsteira<{
    corretor: null | string;
    enterprise_id: null | string;
    etapa: null | string;
    imobiliaria: null | string;
  }>(client, entityId, "enterprise_id, etapa, corretor, imobiliaria", {
    enterpriseId: input.enterpriseId,
  });
  const enterpriseId =
    normalizarEnterpriseId(input.enterpriseId) ?? normalizarEnterpriseId(esteira?.enterprise_id);

  if (input.paymentId && enterpriseId) {
    await client
      .from("apolo_esteira")
      .update({ pagamento_ref: input.paymentId })
      .eq("entity_id", entityId)
      .eq("enterprise_id", enterpriseId);
  }

  const { data: entidade } = await client
    .from("apolo_entities")
    .select("display_name, legal_name, document_masked")
    .eq("id", entityId)
    .maybeSingle<{
      display_name: string | null;
      document_masked: string | null;
      legal_name: string | null;
    }>();

  const nome = (entidade?.legal_name || entidade?.display_name || "").trim();

  // 1) prevenda -> credenciado (só move quem está de fato em pré-venda, e só NESTA CAD).
  if (esteira?.etapa === "prevenda" && enterpriseId) {
    const { error } = await client
      .from("apolo_esteira")
      .update({ atualizado_em: new Date().toISOString(), etapa: "credenciado" })
      .eq("entity_id", entityId)
      .eq("enterprise_id", enterpriseId);
    saida.etapa = error ? `erro: ${error.message}` : "credenciado";

    // ⚠️ AVISO À MÃO PORQUE ESTA ESCRITA FURA `atualizarEtapa` (ver o comentário na linha 227).
    // O gancho de aviso mora lá dentro, então quem grava direto na tabela não é coberto por ele —
    // e este é justamente o caminho de MAIOR volume de boa notícia (o cliente pagou). Sem esta
    // chamada, o corretor descobre pelo cliente que a CAD foi credenciada.
    if (!error) {
      const { avisarEtapa } = await import("./esteira-avisos");
      await avisarEtapa(client, {
        enterpriseId,
        entityId,
        etapa: "credenciado",
        etapaAnterior: "prevenda",
      });
    }
  } else {
    saida.etapa = `mantida (${esteira?.etapa ?? "sem esteira"})`;
  }

  // 2) entra na fila. O índice único (evento, origem, origem_ref) evita duplicar no reenvio.
  const eventoId = await eventoDaFilaId(client);
  if (!eventoId) {
    saida.fila = "sem evento ativo no Prometeu";
  } else if (!nome) {
    saida.fila = "sem nome na ficha";
  } else {
    const r = await adicionarCredenciado({
      client,
      corretor: esteira?.corretor ?? null,
      documento: entidade?.document_masked ?? null,
      entityId,
      eventoId,
      imobiliaria: esteira?.imobiliaria ?? null,
      nome,
      origem: "prevenda",
      origemRef: entityId,
    });
    saida.fila = r.error ?? "na fila";
  }

  // REDE: a regra do Lucas (01/08) é que QUEM ESTÁ EM "CREDENCIADO" ESTÁ NA FILA — sem exceção.
  // Esta função move a etapa por escrita direta, então não passa pelo gancho de `atualizarEtapa`;
  // se o bloco acima não conseguiu (erro do banco, corrida com outro disparo), a regra ainda tem
  // que valer. `garantirNaFilaDoLancamento` é idempotente: no caminho feliz ele nem chega aqui.
  if (saida.etapa === "credenciado" && saida.fila !== "na fila") {
    const rede = await garantirNaFilaDoLancamento(client, entityId, { enterpriseId });
    if (rede.naFila) saida.fila = "na fila";
  }

  // 3) sobe para o C2X. Depois da fila de propósito: no dia do lançamento a etiqueta é o que não
  // pode atrasar. Só quando ESTA chamada credenciou — quem já estava credenciado já subiu, e ficha
  // em outra etapa não vai para o sistema de contratos com dado incompleto.
  if (saida.etapa === "credenciado") {
    saida.c2x = await subirParaC2xBestEffort(client, entityId);
  }

  return saida;
}

export async function aoConfirmarPagamentoPrevenda(input: {
  client: SupabaseClient;
  enterpriseId?: null | number | string;
  entityId: string;
  pagoEm: string;
  paymentId?: string | null;
}): Promise<{ c2x?: string; esteira: string; fila: string }> {
  const { client, entityId, pagoEm } = input;
  // `c2x` é diagnóstico: volta na resposta do webhook para dar para ver se a ficha subiu ao ser
  // credenciada pelo pagamento.
  const saida: { c2x?: string; esteira: string; fila: string } = {
    esteira: "não carimbada",
    fila: "não atualizada",
  };

  // QUAL CAD PAGOU. O webhook do Asaas chega com o `externalReference` (= entityId) e o
  // `paymentId`, e é o SEGUNDO que identifica a CAD sem ambiguidade: `pagamento_ref` foi gravado
  // na emissão, naquela CAD específica. Ancorar no entityId carimbaria "pago" em todas as CADs da
  // pessoa — inclusive na de outro loteamento, que continua devendo os R$ 1.000.
  //
  // Ordem de preferência: empreendimento informado > CAD que carrega este pagamento_ref > CAD
  // mais recente (cobrança antiga, emitida antes de gravarmos a referência).
  let alvo = await cadDoPagamento(client, entityId, input.enterpriseId, input.paymentId);
  alvo ??= await lerCadDaEsteira<{ enterprise_id: null | string }>(
    client,
    entityId,
    "enterprise_id",
  );
  const enterpriseId = normalizarEnterpriseId(alvo?.enterprise_id);

  if (!enterpriseId) {
    return { esteira: "sem CAD na esteira para carimbar", fila: "não atualizada" };
  }

  // 1) Board: carimbo do pagamento. O `is null` deixa idempotente — reentrega não sobrescreve a
  // hora do primeiro pagamento (que é o que vale pra fila).
  const { error } = await client
    .from("apolo_esteira")
    .update({
      atualizado_em: new Date().toISOString(),
      pagamento_ref: input.paymentId ?? null,
      pago_em: pagoEm,
    })
    .eq("entity_id", entityId)
    .eq("enterprise_id", enterpriseId)
    .is("pago_em", null);
  saida.esteira = error ? `erro: ${error.message}` : "pago";

  // 1b) prevenda -> credenciado. Quem credencia no caminho feliz e' o ENVIO do PIX
  // (aoEnviarPixPrevenda), nao o pagamento. Quando o disparo falha e a pessoa paga por um link
  // entregue na mao (a central manda pela Iris), ela pagava e CONTINUAVA parada em pre-venda no
  // Board: o time lia como cliente travado, sendo que o dinheiro ja tinha entrado. Dinheiro
  // confirmado credencia, tenha o aviso saido ou nao. O `eq etapa prevenda` mantem a mesma regra
  // do envio: so move quem esta de fato em pre-venda, nunca puxa ninguem para tras.
  //
  // O `select` no fim devolve as linhas afetadas (mesmo recurso que `completar-vinculos.ts` usa
  // nesta tabela): é assim que sabemos se ESTA chamada credenciou e, portanto, se há ficha nova
  // para subir ao C2X mais abaixo.
  const { data: credenciadasAgora, error: erroEtapa } = await client
    .from("apolo_esteira")
    .update({ atualizado_em: new Date().toISOString(), etapa: "credenciado" })
    .eq("entity_id", entityId)
    .eq("enterprise_id", enterpriseId)
    .eq("etapa", "prevenda")
    .select("entity_id");

  if (erroEtapa) {
    saida.esteira = `${saida.esteira} (etapa: erro ${erroEtapa.message})`;
  }

  // Quem ESTA chamada credenciou (o `.eq("etapa","prevenda")` acima faz o update devolver linha só
  // na primeira vez). Guardado aqui porque o envio ao C2X acontece lá embaixo, DEPOIS da fila.
  const credenciouAgora = (credenciadasAgora?.length ?? 0) > 0;

  // ⚠️ MESMA RAZÃO DO OUTRO PONTO: escrita direta não passa pelo gancho de `atualizarEtapa`.
  // `credenciouAgora` é a trava de repetição aqui — o `.eq("etapa","prevenda")` faz o update
  // devolver linha só na primeira vez, então um webhook do Asaas reentregue não vira mensagem
  // nova para quem já foi avisado.
  if (credenciouAgora) {
    const { avisarEtapa } = await import("./esteira-avisos");
    await avisarEtapa(client, {
      enterpriseId,
      entityId,
      etapa: "credenciado",
      etapaAnterior: "prevenda",
    });
  }

  // 2) Prometeu: a fila se reordena sozinha pela hora do pagamento.
  const eventoId = await eventoDaFilaId(client);
  if (!eventoId) {
    saida.fila = "sem evento ativo";
    // Sem lançamento rodando (dia normal) não há fila, mas o cadastro no C2X não pode depender
    // disso: sobe aqui também, senão quem pagou fora do evento nunca chegaria ao C2X.
    if (credenciouAgora) saida.c2x = await subirParaC2xBestEffort(client, entityId);
    return saida;
  }

  const { data: cred } = await client
    .from("prometeu_credenciados")
    .select("id, pago_em")
    .eq("evento_id", eventoId)
    .eq("entity_id", entityId)
    .limit(1)
    .maybeSingle<{ id: string; pago_em: string | null }>();

  if (!cred) {
    // PAGOU e não estava na fila. Acontece quando o disparo não conseguiu avisar a pessoa por
    // nenhum canal (ela não entra na fila na emissão) e ela paga por outro caminho. Antes isso
    // só virava a frase "não está na fila" e a pessoa ficava de fora do evento tendo pago — o
    // pior desfecho possível no dia do lançamento. Agora entra, já com a hora do pagamento.
    const esteira = await lerCadDaEsteira<{ corretor: null | string; imobiliaria: null | string }>(
      client,
      entityId,
      "corretor, imobiliaria",
      { enterpriseId },
    );

    const { data: entidade } = await client
      .from("apolo_entities")
      .select("display_name, legal_name, document_masked")
      .eq("id", entityId)
      .maybeSingle<{
        display_name: string | null;
        document_masked: string | null;
        legal_name: string | null;
      }>();

    const nome = (entidade?.legal_name || entidade?.display_name || "").trim();
    if (!nome) {
      saida.fila = "não está na fila e a ficha não tem nome";
    } else {
      const r = await adicionarCredenciado({
        client,
        corretor: esteira?.corretor ?? null,
        documento: entidade?.document_masked ?? null,
        entityId,
        eventoId,
        imobiliaria: esteira?.imobiliaria ?? null,
        nome,
        origem: "prevenda",
        origemRef: entityId,
        pagoEm,
      });
      saida.fila = r.error ?? "entrou na fila já paga";
    }
  } else if (cred.pago_em) {
    saida.fila = "já estava paga";
  } else {
    const r = await registrarPagamento({ client, credenciadoId: cred.id, pagoEm });
    saida.fila = r.error ?? "fila atualizada";
  }

  // REDE, mesma regra do envio do PIX: a etapa virou "credenciado" por escrita direta (sem passar
  // pelo gancho de `atualizarEtapa`), então quem garante que a pessoa está mesmo na fila é isto.
  // Vai com `pagoEm` para não perder o lugar dela: quem pagou entra na fila pela HORA do
  // pagamento, senão cairia no fim depois de ter pago.
  const RESOLVIDOS = ["entrou na fila já paga", "fila atualizada", "já estava paga"];
  if (!RESOLVIDOS.includes(saida.fila)) {
    const rede = await garantirNaFilaDoLancamento(client, entityId, { enterpriseId, pagoEm });
    if (rede.naFila) saida.fila = "entrou na fila já paga";
  }

  // 3) SOBE PARA O C2X quem o pagamento acabou de credenciar (o gancho de `atualizarEtapa` não roda
  // aqui, ver o comentário de `subirParaC2xBestEffort`). Fica por ÚLTIMO de propósito: este webhook
  // tem teto de 30s e o código não reprocessa a mesma cobrança, então quem pagou precisa entrar na
  // fila com a HORA do pagamento ANTES de a gente gastar tempo falando com o C2X. Se o C2X demorar
  // ou cair, o lugar da pessoa na fila já está garantido e a ficha fica para o lote/tela do C2X.
  if (credenciouAgora) saida.c2x = await subirParaC2xBestEffort(client, entityId);

  return saida;
}

// A CAD que carrega ESTE pagamento. É a âncora confiável do webhook: `pagamento_ref` foi gravado
// na emissão do PIX, na CAD que foi cobrada. Devolve null quando não há como amarrar (cobrança
// antiga, sem referência gravada), e aí o chamador cai na CAD mais recente.
async function cadDoPagamento(
  client: SupabaseClient,
  entityId: string,
  enterpriseId: unknown,
  paymentId: null | string | undefined,
): Promise<null | { enterprise_id: null | string }> {
  const informado = normalizarEnterpriseId(enterpriseId);
  if (informado) return { enterprise_id: informado };
  if (!paymentId) return null;

  const { data } = await client
    .from("apolo_esteira")
    .select("enterprise_id")
    .eq("entity_id", entityId)
    .eq("pagamento_ref", paymentId)
    .limit(1)
    .maybeSingle<{ enterprise_id: null | string }>();

  return data ?? null;
}
