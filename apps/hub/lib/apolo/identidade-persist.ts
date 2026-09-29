// EDIÇÃO DE IDENTIDADE de uma ficha do Apolo: nome, documento e tipo PF/PJ.
//
// Por que isto existe: as CADs do Vale do Ouro foram importadas antes da triagem que o
// formulário novo faz. A leitura de documentos para no primeiro anexo com CPF válido — no PDF
// do casal esse costuma ser o do CÔNJUGE — e a JFL (pessoa jurídica) entrou como física com o
// CPF do representante. O operador precisa poder colocar cada um no seu lugar.
//
// ⚠️ Este é o caminho mais destrutivo do módulo: troca a identidade de um cliente real. A
// ordem das operações abaixo NÃO é estilo, é o que impede quatro estragos concretos que uma
// auditoria adversarial do código levantou. Cada passo diz qual.
import {
  cnpjValido,
  cpfValido,
  documentoCombinaComTipo,
  formatarDocumento,
  soDigitos,
  tipoDoDocumento,
} from "@/lib/apolo/documento";
import { hashIdentifier, type createApoloAdminClient } from "@/lib/apolo/server";

type AdminClient = NonNullable<ReturnType<typeof createApoloAdminClient>>;

/**
 * ⚠️ `parcial` EXISTE PORQUE A FUNÇÃO GRAVA EM QUATRO TABELAS, NA ORDEM. Depois do passo 5
 * (`apolo_entities`) o nome NOVO já está no banco: se o identificador ou o índice de busca falharem
 * depois disso, "não foi salvo" é MENTIRA, e era a frase que a tela mostrava (board-view.tsx, a
 * rodada parcial de 28/09/2026). `colisao`, `invalido` e `nao_encontrada` recusam ANTES do passo 5 e
 * continuam significando "nada encostou no banco".
 */
export type ResultadoIdentidade =
  | { erro: string; motivo: "colisao" | "invalido" | "nao_encontrada" | "parcial"; ok: false }
  | { ok: true };

// Mesma normalização que o índice de busca do Apolo usa (server.ts:4950).
function normalizarBusca(valor: string): string {
  return valor
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function ehUuid(valor: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(valor);
}

export async function atualizarIdentidade(input: {
  /**
   * (16/09/2026) Nome de quem corrigiu, quando a conta NÃO está em `hub_users` (a do portal). Vai
   * para `metadata.autorNome` do evento, como o `edit_ficha` do portal já faz; sem ele o histórico
   * mostrava um traço no autor. A rota do hub não passa.
   */
  autorNome?: null | string;
  autorUserId: string | null;
  client: AdminClient;
  /**
   * (16/09/2026) A CAD pela qual a correção foi pedida (a do recorte do portal). Vai para
   * `metadata.enterpriseId` do evento, que é a marca que o histórico do portal lê para saber de qual
   * produto a edição é. Não muda o alcance da correção: a identidade continua sendo da PESSOA.
   * A rota do hub não passa.
   */
  enterpriseId?: null | string;
  /**
   * ⚠️ OPCIONAL, E "O MESMO QUE JÁ ESTÁ GRAVADO" CONTA COMO NÃO INFORMADO (29/09/2026). A tela manda
   * um DIFF; quem corrige só a razão social não está mexendo no documento. Ver o passo 2.
   */
  documento?: null | string;
  entityId: string;
  motivo: string;
  nome: string;
  // Só PJ: nome fantasia.
  nomeFantasia?: string | null;
  tipo: "pf" | "pj";
}): Promise<ResultadoIdentidade> {
  const nome = input.nome.trim();
  const motivo = input.motivo.trim();
  const digitosDoCorpo = soDigitos(input.documento ?? "");

  if (!nome) return { erro: "Nome obrigatorio.", motivo: "invalido", ok: false };
  if (!motivo) {
    return { erro: "Informe o motivo da correcao.", motivo: "invalido", ok: false };
  }

  // (1) ORIGEM: NÃO EXISTE MAIS RECUSA POR AQUI, E ISSO É DECISÃO, NÃO ESQUECIMENTO.
  //
  // Até 28/09/2026 esta função lia `apolo_source_links` e devolvia 409 em toda ficha com
  // `source_system = 'c2x'`: "a correção tem que ser feita no legado, senão o sync desfaz em até 6
  // horas". ESSA FRASE DEIXOU DE SER VERDADE EM 04/08/2026, quando as 7 tabelas de IDENTIDADE do
  // sync passaram a ON CONFLICT DO NOTHING (`lib/apolo/server.ts:3917-3949`, `ignorarDuplicados:
  // true` em `apolo_entities`, `apolo_entity_profiles`, `apolo_source_links`,
  // `apolo_entity_identifiers`, `apolo_contacts`, `apolo_addresses` e `apolo_relationships`):
  // QUEM NÃO EXISTE NASCE, QUEM JÁ EXISTE FICA INTOCADO — inclusive `display_name`, `legal_name`,
  // `trade_name`, `entity_kind`, `document_*` e o `metadata` inteiro. É o que
  // `lib/apolo/sync-c2x-identidade.test.ts` trava desde então.
  //
  // MEDIDO EM PRODUÇÃO (28/09/2026, só SELECT): o resync completo continua rodando de 6 em 6 horas
  // (`apolo_sync_runs`, 4.789 fichas varridas por rodada) e o sync continua CRIANDO ficha nova (1 a
  // 3 por dia, venda registrada direto no legado precisa de onde pendurar a carteira, e há FK) —
  // mas as 43 correções de identidade feitas em ficha espelho entre 20/07 e 01/08/2026 continuam
  // gravadas em `apolo_entities` HOJE. Depois de 01/08 a trava barrou 100% delas: zero eventos
  // `edit_identity` em ficha espelho, contra 433 das 483 imobiliárias e 548 das 610 PJ presas.
  //
  // Lucas, 28/09/2026, ao ver que a liberação sairia só para as fichas nascidas no Apolo: *"então,
  // é o que eu estou falando tem tempo, TUDO PRECISA MORAR DENTRO DO PANTEON, não tem mais cadastro
  // vindo do c2x"*, *"TODOS eu poderia alterar, atualizar"*.
  //
  // ⚠️ O QUE "O SYNC DESFAZ" AINDA ALCANÇAVA, E FOI FECHADO EM 29/09/2026 (não fica de promessa):
  //
  //   • O ÍNDICE DE BUSCA. `apolo_search_entries` continua em upsert de verdade de propósito (metade
  //     do `normalized_text` é carteira), e o resync re-estampava o `display_name` do legado ali.
  //     Medido em 29/09/2026: 6 fichas espelho com nome certo em `apolo_entities` e nome do legado em
  //     `apolo_search_entries`, re-estampadas naquele dia entre 09:20 e 10:55 — uma delas com o nome
  //     de OUTRA PESSOA no campo em que o Apolo, a Iris e a CACÁ fazem ilike. `buildSearchRow` agora
  //     recebe a ficha GRAVADA e ela vence na identidade (`lib/apolo/server.ts`).
  //   • O DOCUMENTO. O passo 6 daqui APAGA a linha antiga de `apolo_entity_identifiers`, e ON
  //     CONFLICT DO NOTHING não protege linha apagada: o resync reinseria o documento VELHO, com
  //     `is_primary = true`, deixando a ficha com dois documentos primários. Fechado por
  //     `lerFichasGravadas` em `lib/apolo/server.ts`: quando `apolo_entities.document_hash` divergir
  //     do hash do legado, o sync não recria cpf/cnpj.
  //
  // ⚠️ O QUE CONTINUA SOBREPONDO: `scripts/apolo-sync-c2x.mjs` é outra cópia do sync e escreve em
  // upsert normal em tudo. Ele não roda por cron (a carga do C2X foi encerrada em 21/09/2026) e desde
  // 29/09/2026 exige `--recarga-identidade` para sobrepor a identidade.
  const { data: entidade } = await input.client
    .from("apolo_entities")
    .select("id, display_name, document_masked, entity_kind, trade_name")
    .eq("id", input.entityId)
    .maybeSingle<{
      display_name: string;
      document_masked: string | null;
      entity_kind: string;
      id: string;
      trade_name: null | string;
    }>();

  if (!entidade) {
    return { erro: "Ficha nao encontrada.", motivo: "nao_encontrada", ok: false };
  }

  // ⚠️ O ANTES FICA GUARDADO AQUI, E NÃO LIDO DE `entidade` LÁ EMBAIXO. O passo 5 reescreve
  // `apolo_entities`, e tanto o passo 7 (que precisa TIRAR os termos velhos do índice de busca)
  // quanto a auditoria do passo 8 (o `de:` do evento) falam do estado ANTERIOR. Ler a variável
  // depois do update é o tipo de erro que só aparece quando o cliente devolve a mesma referência.
  const antes = {
    documento: entidade.document_masked,
    nome: entidade.display_name,
    nomeFantasia: entidade.trade_name,
    tipo: entidade.entity_kind,
  };

  // (2) ⚠️ SÓ SE VALIDA E SÓ SE REGRAVA O DOCUMENTO QUANDO ELE MUDOU (29/09/2026).
  //
  // Até aqui todo salvamento revalidava o documento que o corpo trazia, e a tela sempre manda o
  // ATUAL quando o operador não mexeu nele (`documento: docNovo ?? ficha.entidade.documento`,
  // board-view.tsx). Em ficha PJ isso virou beco sem saída no mesmo dia em que a razão social foi
  // liberada: o CNPJ é só de leitura de propósito (trocar o CNPJ é mudar QUEM A EMPRESA É), então a
  // correção do NOME era recusada com 400 falando de um campo que o operador não pode tocar.
  //
  // MEDIDO NO PRÓPRIO CÓDIGO: quando o C2X não tem `cpf_cnpj` com 11 ou 14 dígitos, o sync grava a
  // FRASE "Documento em revisao" em `document_masked` (`lib/apolo/server.ts:5260-5271`, usada em
  // :3812), e é essa mesma frase que põe a ficha em `status = "review"` (:4558) — ou seja, a
  // população presa era exatamente a da coluna Validação do print do Lucas. A fixture
  // `lib/apolo/c2x-recusa-em-voo.test.ts:69` ("IMOBILIARIA SEM CNPJ LTDA") é uma delas. Some-se a
  // PJ com CPF gravado (a JFL do topo deste arquivo): "Pessoa juridica exige CNPJ" barrando a
  // correção do nome.
  //
  // A régua nova: VALIDA-SE O QUE O OPERADOR MUDOU. Documento igual ao que já está na ficha (ou
  // corpo sem dígito nenhum, que é o caso do placeholder) não é correção de documento: pula dígito
  // verificador, colisão e o passo 6. Quem TROCA o documento continua passando por tudo.
  const digitosDaFicha = soDigitos(antes.documento ?? "");
  const documentoMudou = digitosDoCorpo !== "" && digitosDoCorpo !== digitosDaFicha;
  const digitos = documentoMudou ? digitosDoCorpo : digitosDaFicha;
  const tipoMudou = input.tipo !== antes.tipo;

  // (3) COERÊNCIA com o tipo. O banco não tem CHECK que impeça PJ com CPF — foi exatamente assim
  // que a JFL entrou. Cobra-se quando o documento mudou OU quando o TIPO mudou: trocar PF→PJ
  // mantendo um CPF é o mesmo defeito, ainda que o documento não tenha sido tocado.
  if (documentoMudou || (tipoMudou && digitos !== "")) {
    const combina = documentoCombinaComTipo(input.tipo, digitos);
    if (!combina.ok) {
      return { erro: combina.erro ?? "Documento invalido.", motivo: "invalido", ok: false };
    }
  }

  // `null` = a ficha não tem documento válido gravado e o operador não mandou um. As colunas de
  // documento ficam INTOCADAS nesse caso: melhor sem documento do que com hash de string vazia.
  const tipoDoc = digitos === "" ? null : tipoDoDocumento(digitos);
  if (documentoMudou && !tipoDoc) {
    return { erro: "Documento invalido.", motivo: "invalido", ok: false };
  }

  const hash = tipoDoc ? hashIdentifier(tipoDoc, digitos) : null;

  // (4) COLISÃO. Não existe índice único em document_hash (a migration 0026 dropou), então
  // duas fichas com o mesmo CPF são possíveis no banco — e já aconteceu. Checar em código é a
  // única barreira. Consulta as DUAS fontes porque as entidades do C2X têm document_hash nulo
  // e guardam o CPF só em apolo_entity_identifiers.
  //
  // Só quando o documento MUDOU: o documento que já está na ficha não pode colidir por ficar onde
  // está, e checá-lo transformava a correção do nome numa recusa por dado antigo de terceiro.
  if (documentoMudou && hash) {
    const [{ data: porColuna }, { data: porIdentificador }] = await Promise.all([
      input.client
        .from("apolo_entities")
        .select("id, display_name")
        .eq("document_hash", hash)
        .neq("id", input.entityId)
        .limit(1)
        .maybeSingle(),
      input.client
        .from("apolo_entity_identifiers")
        .select("entity_id")
        .in("identifier_type", ["cpf", "cnpj"])
        .eq("value_hash", hash)
        .neq("entity_id", input.entityId)
        .limit(1)
        .maybeSingle(),
    ]);

    const donoId =
      (porColuna as { display_name: string; id: string } | null)?.id ??
      (porIdentificador as { entity_id: string } | null)?.entity_id ??
      null;

    if (donoId) {
      const { data: dono } = await input.client
        .from("apolo_entities")
        .select("display_name")
        .eq("id", donoId)
        .maybeSingle<{ display_name: string }>();
      return {
        erro: `Este documento ja pertence a outra ficha (${dono?.display_name ?? donoId}).`,
        motivo: "colisao",
        ok: false,
      };
    }
  }

  // Sem documento válido, o que vai para a busca é o que a ficha já mostra (pode ser a frase
  // "Documento em revisao"): o índice indexa o que a tela indexa.
  const documentoCompleto = tipoDoc
    ? formatarDocumento(digitos)
    : (antes.documento ?? "");
  const ehPj = input.tipo === "pj";

  // (5) A ENTIDADE. `update` de colunas nomeadas, nunca do metadata inteiro (substituiria o
  // jsonb e apagaria o que o sync e o cadastro escreveram lá).
  //
  // ⚠️ `trade_name` SÓ ENTRA QUANDO O CAMPO VEIO. A tela manda um DIFF: quem corrige apenas a
  // razão social não manda `nomeFantasia`, e a versão anterior gravava `null` nesse caso — ou seja,
  // liberar a razão social (28/09/2026) APAGARIA o nome fantasia da empresa na mesma tacada. A
  // ficha da igreja do print (`bda7977b-6f84-4946-a71f-4170821731dd`) tem `trade_name` = "CBA NOVO
  // TEMPLO", que é justamente o dado CERTO dela. `undefined` = não mexe; string vazia = limpa.
  // Perda aqui é definitiva: o sync não devolve, porque `apolo_entities` vai com DO NOTHING.
  const fantasiaVeio = input.nomeFantasia !== undefined;
  const fantasiaDaFicha = fantasiaVeio ? (input.nomeFantasia?.trim() || null) : antes.nomeFantasia;
  // PJ que vira PF perde o nome fantasia de qualquer jeito: PF não tem.
  const trocaDoFantasia = !ehPj || fantasiaVeio ? { trade_name: ehPj ? fantasiaDaFicha : null } : {};
  // ⚠️ AS TRÊS COLUNAS DE DOCUMENTO SÓ ENTRAM QUANDO EXISTE DOCUMENTO VÁLIDO. Sem elas a ficha PJ
  // sem CNPJ continua sem CNPJ (que é o certo) em vez de receber hash de string vazia. Quando o
  // documento não mudou mas é válido, elas são regravadas com o MESMO valor — o que de quebra
  // preenche `document_hash` na ficha vinda do C2X, que nasce com ele nulo.
  const trocaDoDocumento = tipoDoc
    ? {
        document_hash: hash,
        document_kind: tipoDoc,
        // Formato COMPLETO: é como o sync do C2X grava (4.133 registros) e como a busca indexa.
        document_masked: formatarDocumento(digitos),
      }
    : {};
  const { error: erroEntidade } = await input.client
    .from("apolo_entities")
    .update({
      display_name: nome,
      ...trocaDoDocumento,
      entity_kind: input.tipo,
      legal_name: ehPj ? nome : null,
      ...trocaDoFantasia,
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.entityId);

  if (erroEntidade) {
    return { erro: erroEntidade.message, motivo: "invalido", ok: false };
  }

  // (6) IDENTIFICADORES: DELETE e depois INSERT. **Nunca upsert.** A chave única é
  // (entity_id, identifier_type, value_hash), então um upsert com o CPF novo NÃO apaga o
  // antigo: a pessoa ficaria com dois CPFs, ambos is_primary. E a CACÁ procura cliente por
  // essa tabela (lookupApoloByDocument) — ela passaria a atender a pessoa errada.
  //
  // ⚠️ SÓ QUANDO O DOCUMENTO MUDOU (29/09/2026). Correção de razão social não tem por que apagar e
  // reinserir o identificador, e mexer nele à toa era o que abria a porta do resync: `ignorarDuplicados`
  // (ON CONFLICT DO NOTHING) protege a linha QUE AINDA EXISTE, não a que foi APAGADA. Ver a guarda
  // gêmea em `lib/apolo/server.ts` (`identificadoresQueASyncNaoRecria`), que é o que impede o
  // documento VELHO de voltar quando a troca é legítima.
  if (documentoMudou && tipoDoc) {
    const { error: erroDelete } = await input.client
      .from("apolo_entity_identifiers")
      .delete()
      .eq("entity_id", input.entityId)
      .in("identifier_type", ["cpf", "cnpj"]);

    if (erroDelete) {
      return {
        erro: `Falha ao limpar o documento antigo: ${erroDelete.message}`,
        motivo: "parcial",
        ok: false,
      };
    }

    const { error: erroInsert } = await input.client.from("apolo_entity_identifiers").insert({
      confidence_score: 100,
      entity_id: input.entityId,
      identifier_type: tipoDoc,
      is_primary: true,
      metadata: { source: "apolo", origem: "board-validacao" },
      source_system: "apolo",
      value_hash: hash,
      value_masked: documentoCompleto,
      verified_at: new Date().toISOString(),
    });

    // Sem identificador a pessoa fica invisível para o dedup e para a busca da CACÁ — e o
    // antigo já foi apagado. Não dá para seguir como se tivesse dado certo.
    if (erroInsert) {
      return {
        erro: `Falha ao gravar o documento novo: ${erroInsert.message}`,
        motivo: "parcial",
        ok: false,
      };
    }
  }

  // (7) ÍNDICE DE BUSCA. Sem recalcular `normalized_text`, a ficha continua indexada pelo nome
  // ANTIGO: o Apolo, a Iris e a CACÁ fazem ilike nesse campo. O cliente existiria e ninguém
  // conseguiria achar.
  //
  // ⚠️ UPDATE, não upsert. `apolo_search_entries.status` é NOT NULL SEM DEFAULT: o upsert do
  // PostgREST monta um INSERT ... ON CONFLICT, e o INSERT viola a restrição antes de chegar ao
  // conflito. Foi o que aconteceu em 21/jul — 11 fichas corrigidas ficaram indexadas pelo nome
  // antigo porque o upsert falhou EM SILÊNCIO (o erro não era checado).
  // ⚠️ O TEXTO É COSTURADO EM CIMA DO QUE JÁ ESTÁ LÁ, NÃO MONTADO DO ZERO (29/09/2026).
  //
  // Metade do `normalized_text` de uma ficha com carteira é CARTEIRA: empreendimento, bloco/lote,
  // código da unidade e da solicitação, "comprador adimplente"/"comprador inadimplente" (quem monta
  // é `buildSearchRow`, lib/apolo/server.ts:4395), e no MODO ANEXO do `cadastro-persist.ts` entram
  // também e-mail, telefone e imobiliária. Montar do zero com nome + fantasia + documento sumia com
  // a imobiliária da busca POR EMPREENDIMENTO e POR UNIDADE na hora em que alguém corrigia o nome
  // dela. Enquanto só ficha nascida no Apolo chegava aqui isso alcançava poucas dezenas; com a
  // liberação da ficha espelho (28/09/2026) alcançaria 433 das 483 imobiliárias.
  //
  // A costura: tira do texto atual os termos ANTIGOS de identidade e põe os novos na frente. O que
  // não é identidade fica onde está.
  const { data: buscaAtual } = await input.client
    .from("apolo_search_entries")
    .select("normalized_text")
    .eq("entity_id", input.entityId)
    .maybeSingle<{ normalized_text: null | string }>();

  let restoDoTexto = normalizarBusca(buscaAtual?.normalized_text ?? "");
  for (const antigo of [antes.nome, antes.nomeFantasia, antes.documento]) {
    const termo = normalizarBusca(antigo ?? "");
    if (termo) restoDoTexto = restoDoTexto.split(termo).join(" ");
  }

  const busca = {
    display_name: nome,
    document_masked: documentoCompleto,
    entity_kind: input.tipo,
    last_synced_at: new Date().toISOString(),
    // ⚠️ O NOME FANTASIA ENTRA COM O VALOR QUE A FICHA FICOU, não só com o que veio no corpo:
    // correção que não manda `nomeFantasia` não muda `trade_name` (ver o passo 5), então tirá-lo do
    // texto sumia com a imobiliária da busca pelo nome fantasia sem tirá-lo da ficha.
    normalized_text: normalizarBusca(
      [nome, ehPj ? fantasiaDaFicha : null, documentoCompleto, restoDoTexto]
        .filter(Boolean)
        .join(" "),
    ),
  };

  const { data: indexada, error: erroBusca } = await input.client
    .from("apolo_search_entries")
    .update(busca)
    .eq("entity_id", input.entityId)
    .select("entity_id");

  if (erroBusca) {
    return {
      erro: `Identidade gravada, mas o indice de busca falhou: ${erroBusca.message}`,
      motivo: "parcial",
      ok: false,
    };
  }

  // Entidade sem linha de busca ainda: aí sim insere, com os obrigatórios.
  if (!indexada || indexada.length === 0) {
    const { error: erroInsert } = await input.client.from("apolo_search_entries").insert({
      ...busca,
      entity_id: input.entityId,
      status: "active",
    });
    if (erroInsert) {
      return {
        erro: `Identidade gravada, mas o indice de busca falhou: ${erroInsert.message}`,
        motivo: "parcial",
        ok: false,
      };
    }
  }

  // (8) AUDITORIA. `insert` puro — id determinístico seria sobrescrito pelo sync, que usa
  // esse padrão para os eventos dele. O documento vai MASCARADO no registro: auditoria não é
  // lugar de guardar CPF por extenso.
  await input.client.from("apolo_audit_events").insert({
    action: "edit_identity",
    actor_user_id: input.autorUserId && ehUuid(input.autorUserId) ? input.autorUserId : null,
    entity_id: input.entityId,
    field_name: "identidade",
    metadata: {
      // Só entram quando vieram (portal): o evento do hub fica com o mesmo formato de antes.
      ...(input.autorNome?.trim() ? { autorNome: input.autorNome.trim() } : {}),
      ...(input.enterpriseId?.trim() ? { enterpriseId: input.enterpriseId.trim() } : {}),
      de: {
        documento: antes.documento,
        nome: antes.nome,
        tipo: antes.tipo,
      },
      motivo,
      origem: "board-validacao",
      para: {
        documento: documentoCompleto.replace(/\d(?=\d{2})/g, "*"),
        nome,
        tipo: input.tipo,
      },
    },
    status: "mapped",
  });

  // (9) A esteira guarda o motivo, para a fila mostrar por que a ficha foi mexida.
  //
  // ⚠️ SEM ESCOPO DE EMPREENDIMENTO, DE PROPÓSITO. Corrigir a IDENTIDADE (nome, CPF, PF/PJ) é uma
  // correção da PESSOA, não de uma CAD: se o CPF estava trocado, ele estava trocado em todas as
  // CADs dela. O motivo tem que aparecer em todas as filas onde essa pessoa está, senão o
  // operador do outro empreendimento vê a ficha mudar e não sabe por quê. É o único update em
  // lote que continua valendo para todas as CADs — e é assim que tem que ser.
  await input.client
    .from("apolo_esteira")
    .update({ motivo })
    .eq("entity_id", input.entityId);

  return { ok: true };
}

export { cnpjValido, cpfValido };
