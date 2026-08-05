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
import type { createApoloAdminClient } from "./server";

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
  regimeBensId: string;
  rendaId: string;
  sexoId: string;
  telefone: string;
};

function texto(v: unknown): string {
  return typeof v === "string" ? v : v == null ? "" : String(v);
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
  const cad = (meta.cadastro ?? {}) as Record<string, unknown>;
  // Só entidade nascida no Apolo tem cadastro editável aqui; a que veio do C2X é espelho do legado.
  const ehApolo = meta.source === "apolo";

  const [{ data: contatos }, { data: enderecos }, { data: rels }] = await Promise.all([
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
  ]);

  const lista = (contatos ?? []) as { contact_type: string; value: string }[];
  const end = (enderecos ?? [])[0] as Record<string, unknown> | undefined;
  const conj = (rels ?? [])[0] as
    | { label: string | null; metadata: Record<string, unknown> | null }
    | undefined;

  return {
    dados: {
      bairro: texto(end?.district),
      cep: texto(end?.postal_code),
      cidade: texto(end?.city),
      cidade_uf: texto(end?.state),
      complemento: texto(end?.complement),
      conjuge_cpf: texto(conj?.metadata?.cpf),
      conjuge_email: texto(conj?.metadata?.email),
      conjuge_nome: texto(conj?.label),
      conjuge_telefone: texto(conj?.metadata?.phone),
      dataNascimento: texto(cad.dataNascimento),
      email: lista.find((c) => c.contact_type === "email")?.value ?? "",
      escolaridadeId: texto(cad.escolaridadeId),
      estadoCivilId: texto(cad.estadoCivilId),
      logradouro: texto(end?.street),
      nacionalidade: texto(cad.nacionalidade),
      naturalidade: texto(cad.naturalidade),
      nomeMae: texto(cad.nomeMae),
      numero: texto(end?.number),
      profissaoId: texto(cad.profissaoId),
      regimeBensId: texto(cad.regimeBensId),
      rendaId: texto(cad.rendaId),
      sexoId: texto(cad.sexoId),
      telefone:
        lista.find((c) => c.contact_type === "whatsapp")?.value ??
        lista.find((c) => c.contact_type === "phone")?.value ??
        "",
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

export async function salvarEdicaoCadastro(
  client: AdminClient,
  entityId: string,
  dados: CadastroEditavel,
): Promise<{ error?: string; ok: boolean }> {
  const { data: entity } = await client
    .from("apolo_entities")
    .select("metadata")
    .eq("id", entityId)
    .single();
  if (!entity) return { error: "Entidade não encontrada.", ok: false };

  const meta = (entity.metadata ?? {}) as Record<string, unknown>;
  const cadAtual = (meta.cadastro ?? {}) as Record<string, unknown>;

  // MERGE: o cadastro novo entra por cima do que já havia; o resto do metadata (esteira,
  // imobiliariaId, c2xSynced, source, bornRole) permanece intocado.
  const cadastro = {
    ...cadAtual,
    ...limparVazias({
      dataNascimento: dados.dataNascimento,
      escolaridadeId: dados.escolaridadeId,
      estadoCivilId: dados.estadoCivilId,
      nacionalidade: dados.nacionalidade,
      naturalidade: dados.naturalidade,
      nomeMae: dados.nomeMae,
      profissaoId: dados.profissaoId,
      // Regime de bens só faz sentido casado/união (2/6); nos demais, some para não sujar.
      regimeBensId:
        dados.estadoCivilId === "2" || dados.estadoCivilId === "6"
          ? dados.regimeBensId
          : "",
      rendaId: dados.rendaId,
      sexoId: dados.sexoId,
    }),
  };

  const { error: erroEntity } = await client
    .from("apolo_entities")
    .update({ metadata: { ...meta, cadastro }, updated_at: new Date().toISOString() })
    .eq("id", entityId);
  if (erroEntity) return { error: erroEntity.message, ok: false };

  // Endereço: atualiza o principal se existe, senão cria. Uma linha por entidade basta aqui.
  if (dados.logradouro.trim()) {
    const { data: endExistente } = await client
      .from("apolo_addresses")
      .select("id")
      .eq("entity_id", entityId)
      .order("is_primary", { ascending: false })
      .limit(1);
    const enderecoRow = {
      city: dados.cidade || null,
      complement: dados.complemento || null,
      district: dados.bairro || null,
      number: dados.numero || null,
      postal_code: dados.cep || null,
      state: dados.cidade_uf || null,
      street: dados.logradouro,
    };
    const idExistente = (endExistente ?? [])[0]?.id as string | undefined;
    if (idExistente) {
      await client.from("apolo_addresses").update(enderecoRow).eq("id", idExistente);
    } else {
      await client
        .from("apolo_addresses")
        .insert({ ...enderecoRow, entity_id: entityId, is_primary: true, label: "Principal" });
    }
  }

  // Telefone e e-mail. O erro NÃO é engolido: se a gravação falhar, quem salvou precisa saber —
  // é deste ponto que a cobrança e o recibo leem o contato.
  const errosDeContato = [
    await upsertContato(client, entityId, "phone", dados.telefone),
    await upsertContato(client, entityId, "email", dados.email),
  ].filter((e): e is string => Boolean(e));

  // Cônjuge: só faz sentido casado/união. Cria/atualiza o relacionamento; sem nome, remove.
  const ehCasado = dados.estadoCivilId === "2" || dados.estadoCivilId === "6";
  if (ehCasado && dados.conjuge_nome.trim()) {
    const { data: relExistente } = await client
      .from("apolo_relationships")
      .select("id, metadata")
      .eq("entity_id", entityId)
      .eq("relationship_type", "conjuge")
      .limit(1);
    const metaConj = {
      cpf: dados.conjuge_cpf || null,
      email: dados.conjuge_email || null,
      kind: "contato",
      phone: dados.conjuge_telefone || null,
      source: "apolo",
    };
    const idRel = (relExistente ?? [])[0]?.id as string | undefined;
    if (idRel) {
      await client
        .from("apolo_relationships")
        .update({ label: dados.conjuge_nome, metadata: metaConj })
        .eq("id", idRel);
    } else {
      await client.from("apolo_relationships").insert({
        entity_id: entityId,
        label: dados.conjuge_nome,
        metadata: metaConj,
        related_entity_id: null,
        relationship_type: "conjuge",
        status: "verified",
      });
    }
  }

  if (errosDeContato.length > 0) {
    return { error: `Não gravei o contato — ${errosDeContato.join("; ")}`, ok: false };
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

  // Atualiza a linha do MESMO tipo, se houver; senão cria.
  const doTipo = existentes.find((c) => c.contact_type === tipo);
  if (doTipo) {
    const { error } = await client
      .from("apolo_contacts")
      .update({ is_primary: true, value: valor })
      .eq("id", doTipo.id);
    return error ? `${tipo}: ${error.message}` : null;
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
