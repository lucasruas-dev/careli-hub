// EDIÇÃO do cadastro de uma entidade do Apolo, direto no CRM.
//
// Por que existe: 91 das 93 CADs de casados estão sem o regime de bens (e outros campos podem
// faltar), o que barra a escrita no C2X. O time preenche isso à mão na aba Cadastro do CRM — que
// até então era só leitura. Estas funções carregam os campos editáveis (com os ids do C2X que os
// selects usam) e salvam de volta.
//
// A ficha vive espalhada: os dados pessoais (com os ids do C2X) em `apolo_entities.metadata.cadastro`,
// o endereço em `apolo_addresses`, o contato em `apolo_contacts`, o cônjuge em `apolo_relationships`.
// Editar toca as quatro. O metadata é mesclado, nunca substituído (a lição da migration 0057: um
// upsert cego apaga esteira/imobiliariaId/c2xSynced).
//
// ⚠️ A LEITURA É O MERGE COMPLETO, A ESCRITA É SÓ O DIFF (Lucas, 23/08: "as informações que já
// estavam estão sumindo, não pode sumir, tem que ficar para que o operador veja e corrija").
// Antes, o GET lia SÓ `metadata.cadastro` — vazio em ~70% das CADs, porque a ficha de quem veio
// do C2X/import mora em `apolo_esteira.ficha` e a correção humana em `metadata.cadastroEditado`.
// O formulário abria em branco, e o PATCH (que mandava o form inteiro) transformava o branco em
// null por cima do que existia. Agora: ler = cadastro < C2X ao vivo < esteira.ficha <
// cadastroEditado (a MESMA cascata do board e da CAD assinada); gravar = apenas os campos que o
// operador alterou, na camada `cadastroEditado` (a que todos os leitores aplicam por último).
import { mapearC2xParaFicha } from "./cad-de-entidade";
import { lerCadDaEsteira } from "./esteira-cad";
import { normalizarProfissaoLivre } from "./profissao";
import { fetchC2xCadastroByEntity, type createApoloAdminClient } from "./server";

type AdminClient = NonNullable<ReturnType<typeof createApoloAdminClient>>;

// O que a tela de edição lê e grava. Os *_id são strings porque é assim que o metadata guarda e o
// <select> devolve; a conversão para número acontece só na hora de montar o payload do C2X.
export type CadastroEditavel = {
  bairro: string;
  cep: string;
  cidade: string;
  cidade_uf: string; // "MG"
  complemento: string;
  conjuge_cpf: string;
  conjuge_email: string;
  conjuge_nome: string;
  conjuge_telefone: string;
  dataNascimento: string;
  email: string;
  escolaridadeId: string;
  estadoCivilId: string;
  logradouro: string;
  nacionalidade: string;
  naturalidade: string;
  nomeMae: string;
  numero: string;
  profissaoId: string;
  // Profissão DIGITADA no cadastro, quando o corretor não a achou entre as 234 do C2X. Editável
  // aqui de propósito: sem isto ela era gravada uma vez pelo wizard e ninguém mais conseguia
  // corrigir um "nao sei"/"asdf" nem apagar um dado colado por engano — e ela sai na CAD e na nota
  // da validação. Nunca vira `profession` no C2X. Ver lib/apolo/profissao.ts.
  profissaoOutro: string;
  regimeBensId: string;
  rendaId: string;
  sexoId: string;
  telefone: string;
};

function texto(v: unknown): string {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}

// Ficha ao vivo do C2X desta entidade (com spouse), best-effort. Usada na leitura (preencher o
// form) e na escrita (fallback do nome do cônjuge quando o form não o mandou).
async function fichaC2xDaEntidade(client: AdminClient, entityId: string) {
  const { data: sourceLinks } = await client
    .from("apolo_source_links")
    .select("entity_id, source_system, source_table, source_id")
    .eq("entity_id", entityId)
    .eq("source_system", "c2x")
    .eq("source_table", "users");
  const links = (sourceLinks ?? []) as {
    entity_id: string;
    source_id: string | null;
    source_system: string | null;
    source_table: string | null;
  }[];
  if (links.length === 0) return null;
  const { cadastro: c2xByEntity } = await fetchC2xCadastroByEntity(
    client,
    links,
    new Set<number>(),
    new Set<number>(),
  );
  return c2xByEntity.get(entityId) ?? null;
}

// ── LEITURA ───────────────────────────────────────────────────────────────

export async function lerCadastroParaEdicao(
  client: AdminClient,
  entityId: string,
): Promise<{ dados: CadastroEditavel; ehApolo: boolean } | null> {
  const { data: entity } = await client
    .from("apolo_entities")
    .select("metadata")
    .eq("id", entityId)
    .single();
  if (!entity) return null;

  const meta = (entity.metadata ?? {}) as Record<string, unknown>;
  // Só entidade nascida no Apolo tem cadastro editável aqui; a que veio do C2X é espelho do legado.
  const ehApolo = meta.source === "apolo";

  const [{ data: contatos }, { data: enderecos }, { data: rels }, esteira] = await Promise.all([
    client.from("apolo_contacts").select("contact_type, value").eq("entity_id", entityId),
    client
      .from("apolo_addresses")
      .select("postal_code, street, number, complement, district, city, state, is_primary")
      .eq("entity_id", entityId)
      .order("is_primary", { ascending: false })
      .limit(1),
    client
      .from("apolo_relationships")
      .select("label, metadata")
      .eq("entity_id", entityId)
      .eq("relationship_type", "conjuge")
      .limit(1),
    lerCadDaEsteira<{ ficha: Record<string, unknown> | null }>(client, entityId, "ficha"),
  ]);

  // Ficha AO VIVO do C2X, best-effort (mesmo padrão de montarCadDeEntidade): se o legado estiver
  // fora ou a entidade não tiver vínculo, a edição segue com as camadas locais.
  let c2xMapeado: Record<string, string> = {};
  // ⚠️ O CÔNJUGE DO C2X entra à parte (caso Geraldo/Rosangela, 24/08): `mapearC2xParaFicha` não
  // traz o spouse, então a aba de leitura MOSTRAVA a cônjuge (cad.spouse) e a edição abria os
  // campos dela VAZIOS — o operador corrigia um campo, o nome não viajava e o salvar descartava
  // tudo em silêncio.
  let spouseC2x: {
    cpf: null | string;
    email: null | string;
    name: null | string;
    phone: null | string;
  } | null = null;
  try {
    const c2x = await fichaC2xDaEntidade(client, entityId);
    if (c2x) {
      c2xMapeado = mapearC2xParaFicha(c2x);
      spouseC2x = c2x.spouse
        ? {
            cpf: c2x.spouse.cpf,
            email: c2x.spouse.email,
            name: c2x.spouse.name,
            phone: c2x.spouse.phone,
          }
        : null;
    }
  } catch (erro) {
    console.error("[apolo] lerCadastroParaEdicao: c2xCadastro indisponivel", erro);
  }

  const lista = (contatos ?? []) as { contact_type: string; value: string }[];
  const end = (enderecos ?? [])[0] as Record<string, unknown> | undefined;
  const conj = (rels ?? [])[0] as
    | { label: string | null; metadata: Record<string, unknown> | null }
    | undefined;

  // A MESMA cascata do board e da CAD assinada: a correção humana (cadastroEditado) por último.
  const m = {
    ...((meta.cadastro ?? {}) as Record<string, unknown>),
    ...c2xMapeado,
    ...((esteira?.ficha ?? {}) as Record<string, unknown>),
    ...((meta.cadastroEditado ?? {}) as Record<string, unknown>),
  } as Record<string, unknown>;

  return {
    dados: {
      // Endereço e contato: o que o operador corrigiu na ficha ganha da tabela — igual à CAD.
      bairro: texto(m.bairro) || texto(end?.district),
      cep: texto(m.cep) || texto(end?.postal_code),
      cidade: texto(m.cidade) || texto(end?.city),
      cidade_uf: texto(m.uf) || texto(end?.state),
      complemento: texto(m.complemento) || texto(end?.complement),
      conjuge_cpf: texto(m.conjugeCpf) || texto(conj?.metadata?.cpf) || texto(spouseC2x?.cpf),
      conjuge_email:
        texto(m.conjugeEmail) || texto(conj?.metadata?.email) || texto(spouseC2x?.email),
      conjuge_nome: texto(m.conjugeNome) || texto(conj?.label) || texto(spouseC2x?.name),
      conjuge_telefone:
        texto(m.conjugeTelefone) || texto(conj?.metadata?.phone) || texto(spouseC2x?.phone),
      dataNascimento: texto(m.dataNascimento).slice(0, 10),
      email: texto(m.email) || (lista.find((c) => c.contact_type === "email")?.value ?? ""),
      escolaridadeId: texto(m.escolaridadeId),
      estadoCivilId: texto(m.estadoCivilId),
      logradouro: texto(m.logradouro) || texto(end?.street),
      nacionalidade: texto(m.nacionalidade),
      naturalidade: texto(m.naturalidade),
      nomeMae: texto(m.nomeMae),
      numero: texto(m.numero) || texto(end?.number),
      profissaoId: texto(m.profissaoId),
      profissaoOutro: normalizarProfissaoLivre(m.profissaoOutro),
      regimeBensId: texto(m.regimeBensId),
      rendaId: texto(m.rendaId),
      sexoId: texto(m.sexoId),
      telefone:
        texto(m.telefone) ||
        (lista.find((c) => c.contact_type === "whatsapp")?.value ??
          lista.find((c) => c.contact_type === "phone")?.value ??
          ""),
    },
    ehApolo,
  };
}

// ── ESCRITA ───────────────────────────────────────────────────────────────

function limparVazias(obj: Record<string, unknown>): Record<string, unknown> {
  const saida: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    saida[k] = v === "" ? null : v;
  }
  return saida;
}

const CHAVES_DE_CADASTRO = [
  "dataNascimento",
  // ⚠️ E-MAIL E TELEFONE TAMBÉM ENTRAM NA CAMADA DE CORREÇÃO HUMANA (24/08). Eles continuam
  // indo para `apolo_contacts` (cobrança/Iris/disparos leem de lá), mas SÓ lá o valor perdia
  // para `esteira.ficha.email` em toda leitura em cascata — o operador salvava, a tela dizia
  // salvo, e o formulário reabria com o antigo (caso TAIS, 48 entidades divergentes na base).
  "email",
  "escolaridadeId",
  "estadoCivilId",
  "nacionalidade",
  "naturalidade",
  "nomeMae",
  "profissaoId",
  // A declaração do cliente é CORRIGÍVEL: gravar em `cadastroEditado` (a camada que todos os
  // leitores aplicam por último) é o que faz o conserto — e o apagar — valer no board, na CAD
  // regerada e aqui. Ela continua fora do payload do C2X.
  "profissaoOutro",
  "regimeBensId",
  "rendaId",
  "sexoId",
  "telefone",
] as const;

// `dados` é o DIFF: só as chaves que o operador ALTEROU chegam aqui (a tela compara com o valor
// inicial). Campo ausente = intocado = permanece como está; campo enviado vazio = o operador
// APAGOU de propósito. É o que garante o "não pode sumir" do Lucas (23/08) — antes o form
// inteiro chegava e o que abriu em branco virava null por cima do dado existente.
export async function salvarEdicaoCadastro(
  client: AdminClient,
  entityId: string,
  dados: Partial<CadastroEditavel>,
): Promise<{ error?: string; ok: boolean }> {
  const { data: entity } = await client
    .from("apolo_entities")
    .select("metadata")
    .eq("id", entityId)
    .single();
  if (!entity) return { error: "Entidade não encontrada.", ok: false };

  const meta = (entity.metadata ?? {}) as Record<string, unknown>;
  const enviado = (chave: keyof CadastroEditavel) => chave in dados;

  const alteracoes: Record<string, unknown> = {};
  for (const chave of CHAVES_DE_CADASTRO) {
    if (enviado(chave)) alteracoes[chave] = dados[chave];
  }
  // O cônjuge editado TAMBÉM entra na camada de correção humana (24/08): é dela que a ficha do
  // painel, a CAD e o envio ao C2X leem por último — só o relacionamento local não bastava (o
  // sync do C2X não o alcança e a aba de leitura preferia o spouse do legado).
  const MAPA_CONJUGE = {
    conjuge_cpf: "conjugeCpf",
    conjuge_email: "conjugeEmail",
    conjuge_nome: "conjugeNome",
    conjuge_telefone: "conjugeTelefone",
  } as const;
  for (const [campo, chave] of Object.entries(MAPA_CONJUGE) as [
    keyof typeof MAPA_CONJUGE,
    string,
  ][]) {
    if (enviado(campo)) alteracoes[chave] = dados[campo];
  }
  // A declaração entra no MESMO formato que o wizard grava (espaços colapsados, teto de
  // caracteres): é o que mantém estável a comparação com o catálogo em quem lê.
  if (enviado("profissaoOutro")) {
    alteracoes.profissaoOutro = normalizarProfissaoLivre(dados.profissaoOutro);
  }
  // Regime de bens só faz sentido casado/união (2/6): se o operador MUDOU o estado civil para
  // outro, o regime some junto para não sujar.
  if (
    enviado("estadoCivilId") &&
    dados.estadoCivilId !== "2" &&
    dados.estadoCivilId !== "6"
  ) {
    alteracoes.regimeBensId = "";
  }

  if (Object.keys(alteracoes).length > 0) {
    // Grava em `cadastroEditado` — a camada da CORREÇÃO HUMANA, que o board, a CAD assinada e o
    // envio ao C2X aplicam por último. Gravar em `cadastro` (como era) deixava a correção
    // invisível em toda tela onde a esteira.ficha tem valor. MERGE: o resto do metadata
    // (esteira, imobiliariaId, c2xSynced, source, bornRole) permanece intocado.
    const editadoAtual = (meta.cadastroEditado ?? {}) as Record<string, unknown>;
    const cadastroEditado = { ...editadoAtual, ...limparVazias(alteracoes) };

    const { error: erroEntity } = await client
      .from("apolo_entities")
      .update({
        metadata: { ...meta, cadastroEditado },
        updated_at: new Date().toISOString(),
      })
      .eq("id", entityId);
    if (erroEntity) return { error: erroEntity.message, ok: false };
  }

  // Endereço: atualiza o principal se existe, senão cria. Uma linha por entidade basta aqui.
  // ⚠️ QUALQUER campo de endereço no diff grava (24/08): antes só `logradouro` disparava a
  // gravação — corrigir só o CEP ou a cidade era descartado em silêncio com resposta "salvo".
  // O update é PARCIAL (só as chaves que vieram), para uma correção pontual não anular o resto.
  const errosDeEscrita: string[] = [];
  const CAMPOS_ENDERECO = [
    ["cidade", "city"],
    ["complemento", "complement"],
    ["bairro", "district"],
    ["numero", "number"],
    ["cep", "postal_code"],
    ["cidade_uf", "state"],
    ["logradouro", "street"],
  ] as const;
  const patchEndereco: Record<string, unknown> = {};
  for (const [campo, coluna] of CAMPOS_ENDERECO) {
    if (enviado(campo)) patchEndereco[coluna] = (dados[campo] ?? "").trim() || null;
  }
  if (Object.keys(patchEndereco).length > 0) {
    const { data: endExistente } = await client
      .from("apolo_addresses")
      .select("id")
      .eq("entity_id", entityId)
      .order("is_primary", { ascending: false })
      .limit(1);
    const idExistente = (endExistente ?? [])[0]?.id as string | undefined;
    if (idExistente) {
      const { error } = await client
        .from("apolo_addresses")
        .update(patchEndereco)
        .eq("id", idExistente);
      if (error) errosDeEscrita.push(`endereço: ${error.message}`);
    } else {
      const { error } = await client.from("apolo_addresses").insert({
        street: "",
        ...patchEndereco,
        entity_id: entityId,
        is_primary: true,
        label: "Principal",
      });
      if (error) errosDeEscrita.push(`endereço: ${error.message}`);
    }
  }

  // Telefone e e-mail — só os que o operador alterou. O erro NÃO é engolido: se a gravação
  // falhar, quem salvou precisa saber — é deste ponto que a cobrança e o recibo leem o contato.
  const errosDeContato = [
    enviado("telefone") ? await upsertContato(client, entityId, "phone", dados.telefone ?? "") : null,
    enviado("email") ? await upsertContato(client, entityId, "email", dados.email ?? "") : null,
  ].filter((e): e is string => Boolean(e));

  // Cônjuge: só quando algum campo dele veio no diff. O metadata do relacionamento entra em
  // MERGE — o wizard grava ali a ficha completa (nascimento, mãe, sexo, renda, escolaridade,
  // profissão, patrimônio...), e substituir o objeto inteiro (como era) APAGAVA tudo isso num
  // simples "salvar" desta tela.
  const conjugeEnviado =
    enviado("conjuge_nome") ||
    enviado("conjuge_cpf") ||
    enviado("conjuge_email") ||
    enviado("conjuge_telefone");
  if (conjugeEnviado) {
    const { data: relExistente } = await client
      .from("apolo_relationships")
      .select("id, label, metadata")
      .eq("entity_id", entityId)
      .eq("relationship_type", "conjuge")
      .limit(1);
    const rel = (relExistente ?? [])[0] as
      | { id: string; label: string | null; metadata: Record<string, unknown> | null }
      | undefined;

    let nome = enviado("conjuge_nome")
      ? (dados.conjuge_nome ?? "").trim()
      : texto(rel?.label).trim();
    // ⚠️ O NOME PODE MORAR SÓ NO C2X (caso Geraldo/Rosangela, 24/08): a tela mostrava a cônjuge
    // (spouse do legado), o operador corrigia um campo sem redigitar o nome, e este ramo
    // descartava TUDO em silêncio devolvendo "salvo". Fallback no spouse do C2X; se mesmo assim
    // não houver nome, o salvar AVISA em vez de fingir sucesso.
    if (!nome) {
      try {
        const c2x = await fichaC2xDaEntidade(client, entityId);
        nome = texto(c2x?.spouse?.name).trim();
      } catch {
        // best-effort: legado fora não derruba o resto do salvamento; o aviso abaixo cobre.
      }
    }
    if (!nome) {
      errosDeEscrita.push(
        "cônjuge: os campos foram salvos na ficha, mas informe também o NOME para criar o vínculo do cônjuge",
      );
    }

    if (nome) {
      const metaAtual = (rel?.metadata ?? {}) as Record<string, unknown>;
      const metaConj = {
        ...metaAtual,
        cpf: enviado("conjuge_cpf") ? dados.conjuge_cpf || null : (metaAtual.cpf ?? null),
        email: enviado("conjuge_email")
          ? dados.conjuge_email || null
          : (metaAtual.email ?? null),
        kind: "contato",
        phone: enviado("conjuge_telefone")
          ? dados.conjuge_telefone || null
          : (metaAtual.phone ?? null),
        source: metaAtual.source ?? "apolo",
      };
      if (rel) {
        const { error } = await client
          .from("apolo_relationships")
          .update({ label: nome, metadata: metaConj })
          .eq("id", rel.id);
        if (error) errosDeEscrita.push(`cônjuge: ${error.message}`);
      } else {
        const { error } = await client.from("apolo_relationships").insert({
          entity_id: entityId,
          label: nome,
          metadata: metaConj,
          related_entity_id: null,
          relationship_type: "conjuge",
          status: "verified",
        });
        if (error) errosDeEscrita.push(`cônjuge: ${error.message}`);
      }
    }
  }

  const erros = [...errosDeContato, ...errosDeEscrita];
  if (erros.length > 0) {
    return { error: `Não gravei tudo — ${erros.join("; ")}`, ok: false };
  }

  return { ok: true };
}

// Grava o contato editado e o torna PRINCIPAL. Três cuidados, todos aprendidos na marra — este é
// o gêmeo de `gravarContato` em prevenda-fluxo.ts, que já tinha sido consertado lá e ficou com o
// defeito aqui:
//
//  1. `status` tem CHECK no banco ('verified'|'pending'|'attention'|'blocked'). Gravar "active"
//     violava a constraint e o insert falhava em SILÊNCIO, porque o erro não era checado — a tela
//     dizia "salvo" e nada tinha sido gravado.
//  2. O erro do insert/update sobe para quem chamou. Salvar que não salva precisa aparecer.
//  3. O C2X grava telefone como 'whatsapp' e quase nunca como 'phone'. Procurar só por 'phone'
//     fazia sempre cair no INSERT, e o 'whatsapp' antigo continuava como principal — então
//     `contatosDaFicha` seguia devolvendo o número velho e a cobrança de R$ 1.000 ia para ele.
//     Por isso o telefone considera a família inteira e o novo valor vira o único principal.
const FAMILIA_DE_TIPOS: Record<string, string[]> = {
  email: ["email"],
  phone: ["whatsapp", "phone"],
};

async function upsertContato(
  client: AdminClient,
  entityId: string,
  tipo: string,
  valor: string,
): Promise<string | null> {
  if (!valor.trim()) return null;
  const familia = FAMILIA_DE_TIPOS[tipo] ?? [tipo];

  const { data } = await client
    .from("apolo_contacts")
    .select("id, contact_type")
    .eq("entity_id", entityId)
    .in("contact_type", familia)
    // ⚠️ ORDEM ESTÁVEL: sem ela, entidade com linhas duplicadas do mesmo tipo (474 na base,
    // 62 com valores diferentes) atualizava UMA linha ao acaso e os leitores liam OUTRA — o
    // e-mail "salvo" alternava com o antigo conforme o planner.
    .order("created_at", { ascending: true })
    .limit(20);
  const existentes = (data ?? []) as { contact_type: string; id: string }[];

  // Ninguém da família continua principal: quem vale é o que o operador acabou de digitar.
  if (existentes.length > 0) {
    const { error } = await client
      .from("apolo_contacts")
      .update({ is_primary: false })
      .eq("entity_id", entityId)
      .in("contact_type", familia);
    if (error) return `${tipo}: ${error.message}`;
  }

  // TODAS as linhas do mesmo tipo recebem o valor novo (as duplicatas deixam de guardar o dado
  // velho); a mais antiga vira a principal.
  const doTipo = existentes.filter((c) => c.contact_type === tipo);
  if (doTipo.length > 0) {
    const { error } = await client
      .from("apolo_contacts")
      .update({ updated_at: new Date().toISOString(), value: valor })
      .in("id", doTipo.map((c) => c.id));
    if (error) return `${tipo}: ${error.message}`;
    const { error: erroPrincipal } = await client
      .from("apolo_contacts")
      .update({ is_primary: true })
      .eq("id", doTipo[0]!.id);
    return erroPrincipal ? `${tipo}: ${erroPrincipal.message}` : null;
  }

  const { error } = await client.from("apolo_contacts").insert({
    contact_type: tipo,
    entity_id: entityId,
    is_primary: true,
    status: "pending",
    value: valor,
  });
  return error ? `${tipo}: ${error.message}` : null;
}
