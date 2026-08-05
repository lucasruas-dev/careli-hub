// ORQUESTRAÇÃO da escrita Apolo -> C2X (lado servidor: toca Supabase + o banco do C2X + a API).
//
// Fluxo de UMA entidade: lê a ficha no Apolo (metadata.cadastro já traz os ids do C2X) -> monta o
// payload (c2x-write) -> grava a fila como "pendente" -> POST -> interpreta -> LÊ o id do C2X no
// banco de produção pelo documento (a API devolve token, não id) -> grava "resolvido" + carimba
// c2xSynced na entidade. Idempotente: quem já está resolvido não é reenviado.
import { getHadesDbPool } from "@/lib/guardian/db";
import type { RowDataPacket } from "mysql2/promise";

import { lerCadDaEsteira, maisRecentePorEntidade } from "./esteira-cad";
import { createApoloAdminClient } from "./server";
import {
  C2X_ESCOLARIDADE,
  C2X_ESTADO_CIVIL,
  C2X_FAIXA_RENDA,
  C2X_REGIME_BENS,
  C2X_SEXO,
  normalizeSearch,
  type C2xOption,
} from "./c2x-fields";
import { C2X_PROFISSOES } from "./c2x-professions";
import {
  derivarNacionalidade,
  partesDaNaturalidade,
  sinaisDeFichaCosturada,
  unirCadastroEFicha,
  unirConjuge,
  unirEndereco,
} from "./cadastro-cascata";
import {
  documentoDoCadastro,
  enviarUsuarioC2x,
  montarPayloadCliente,
  montarPayloadImobiliaria,
  payloadParaAuditoria,
  soDigitos,
  type DadosDaEntidade,
  type EnderecoC2x,
  type PerfilC2x,
} from "./c2x-write";
import type { ApoloC2xCadastro, ApoloC2xSpouse } from "./types";

type AdminClient = NonNullable<ReturnType<typeof createApoloAdminClient>>;

// id (string do metadata) -> label do C2X. O metadata.cadastro guarda os ids do C2X como texto;
// a montagem do payload os reconverte para id, então o round-trip preserva o número exato.
function label(options: C2xOption[], id: unknown): string | null {
  const n = Number(id);
  if (!id || Number.isNaN(n)) return null;
  return options.find((o) => o.id === n)?.label ?? null;
}

function texto(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

// ── LEITURA DO ID NO C2X (produção, read-only) ────────────────────────────

// A API devolve token, não id. Depois de criar, achamos o id do usuário no banco de produção pelo
// DOCUMENTO (CPF/CNPJ), que é a chave natural. Compara só dígitos dos dois lados: no C2X o cpf/cnpj
// pode estar com ou sem máscara. Retorna o mais recente se houver mais de um.
export async function lerIdC2xPorDocumento(documento: string): Promise<number | null> {
  const digitos = soDigitos(documento);
  if (!digitos) return null;

  const poolResult = getHadesDbPool();
  if (!poolResult.ok) return null;

  const semMascara =
    "REPLACE(REPLACE(REPLACE(REPLACE(%s,'.',''),'-',''),'/',''),' ','')";
  const [rows] = await poolResult.pool.query<RowDataPacket[]>(
    `SELECT id FROM users
      WHERE ${semMascara.replace("%s", "cpf")} = ?
         OR ${semMascara.replace("%s", "cnpj")} = ?
      ORDER BY id DESC LIMIT 1`,
    [digitos, digitos],
  );
  const id = rows[0]?.id;
  return typeof id === "number" ? id : id ? Number(id) : null;
}

// Resolve a UF (ex.: "MG") e o nome da cidade (ex.: "PARA DE MINAS") para os ids das tabelas
// states/cities do C2X. A collation do MySQL é accent-insensitive, então "PARA DE MINAS" casa
// "Pará de Minas". Sem cidade, devolve só o estado; sem estado, devolve nulos.
async function resolverEstadoCidade(
  uf: string | null,
  cidade: string | null,
): Promise<{ cityId: number | null; stateId: number | null }> {
  if (!uf) return { cityId: null, stateId: null };

  const poolResult = getHadesDbPool();
  if (!poolResult.ok) return { cityId: null, stateId: null };

  const [rows] = await poolResult.pool.query<RowDataPacket[]>(
    `SELECT s.id AS state_id, c.id AS city_id
       FROM states s
       LEFT JOIN cities c ON c.state_id = s.id AND UPPER(c.name) = UPPER(?)
      WHERE s.acronym = ?
      LIMIT 1`,
    [cidade ?? "", uf],
  );
  const linha = rows[0];
  const num = (v: unknown) => (typeof v === "number" ? v : v ? Number(v) : null);
  return { cityId: num(linha?.city_id), stateId: num(linha?.state_id) };
}

// Confere quais destes nomes são cidades BRASILEIRAS, na mesma tabela `cities` do C2X que resolve
// o endereço — é o que autoriza derivar "Brasileira" da naturalidade sem chutar. Uma consulta só
// para o lote inteiro; se o banco não responder, devolve conjunto vazio e ninguém deriva nada.
//
// O casamento é ACENTO-INSENSÍVEL nas duas pontas: a naturalidade vem do OCR em caixa alta e sem
// acento ("PARA DE MINAS"), enquanto a tabela devolve "Pará de Minas". No MySQL a collation já é
// accent-insensitive, então o WHERE casa; o cuidado é na volta, porque o Set é comparado em JS
// byte a byte — por isso guardamos a chave normalizada, não o nome como veio.
function chaveDeCidade(nome: string): string {
  return normalizeSearch(nome).replace(/\s+/g, " ");
}

async function cidadesBrasileiras(nomes: string[]): Promise<Set<string>> {
  const limpos = [...new Set(nomes.map((n) => n.trim()).filter(Boolean))];
  if (limpos.length === 0) return new Set();

  const poolResult = getHadesDbPool();
  if (!poolResult.ok) return new Set();

  try {
    const marcadores = limpos.map(() => "?").join(",");
    const [rows] = await poolResult.pool.query<RowDataPacket[]>(
      `SELECT DISTINCT name FROM cities WHERE name IN (${marcadores})`,
      limpos,
    );
    return new Set(rows.map((r) => chaveDeCidade(String(r.name))));
  } catch {
    return new Set();
  }
}

// ── LEITURA DA FICHA NO APOLO ─────────────────────────────────────────────

// A ficha do operador (`apolo_esteira.ficha`) de várias entidades de uma vez. Lê em blocos de 100
// porque `.in()` com centenas de uuids estoura o tamanho da URL do PostgREST e volta 400.
async function lerFichasDaEsteira(
  client: AdminClient,
  entityIds: string[],
): Promise<Map<string, Record<string, unknown>>> {
  const mapa = new Map<string, Record<string, unknown>>();
  for (let i = 0; i < entityIds.length; i += 100) {
    const bloco = entityIds.slice(i, i + 100);
    const { data } = await client
      .from("apolo_esteira")
      .select("entity_id, enterprise_id, ficha, atualizado_em, created_at")
      .in("entity_id", bloco);

    // ⚠️ AQUI SOBE FICHA PARA O C2X, QUE É O SISTEMA DE CONTRATOS. Com uma CAD por pessoa POR
    // EMPREENDIMENTO (0080), este `.in()` devolve VÁRIAS linhas por pessoa e o mapa por
    // `entity_id` só cabe uma. Antes, quem vencia era a última linha que o Postgres devolvesse —
    // ou seja, a ficha que subia para o contrato era sorteada. Agora é sempre a MAIS RECENTE, com
    // o mesmo critério de desempate do resto do módulo.
    //
    // O certo, quando o envio ao C2X passar a ser por CAD, é chavear por (entity_id,
    // enterprise_id) e mandar uma por vez. Enquanto o chamador manda uma lista de PESSOAS, esta é
    // a escolha determinística possível.
    const linhas = (data ?? []) as Array<{
      atualizado_em: string | null;
      created_at: string | null;
      enterprise_id: string | null;
      entity_id: string;
      ficha: Record<string, unknown> | null;
    }>;
    for (const [entityId, linha] of maisRecentePorEntidade(linhas)) {
      if (linha.ficha) mapa.set(entityId, linha.ficha);
    }
  }
  return mapa;
}

type EntityRow = {
  display_name: string | null;
  document_masked: string | null;
  entity_kind: string | null;
  id: string;
  legal_name: string | null;
  metadata: Record<string, unknown> | null;
  trade_name: string | null;
};

// Monta o ApoloC2xCadastro a partir das DUAS fontes da ficha — `metadata.cadastro` (importação do
// Asana) e `apolo_esteira.ficha` (o que o operador preencheu) — pela mesma ordem da CAD assinada:
// a ficha ganha. Ver `cadastro-cascata.ts`. Mais o cônjuge, que vive em apolo_relationships.
//
// `ficha` pode vir pronta de quem processa o lote, para não fazer uma consulta por entidade.
async function montarDados(
  client: AdminClient,
  entity: EntityRow,
  ficha?: Record<string, unknown> | null,
): Promise<{
  dados: DadosDaEntidade;
  // UUID da entidade imobiliária no APOLO (não o id do C2X). O `vinculed_by_id` que o C2X quer é o
  // id do usuário da imobiliária LÁ — resolvido na camada de lote, que sincroniza a imobiliária
  // antes e usa o c2x_user_id dela. Aqui só devolvemos o elo para a camada de cima resolver.
  imobiliariaUuid: string | null;
  perfil: PerfilC2x;
}> {
  const meta = entity.metadata ?? {};
  const isPj = entity.entity_kind === "pj";

  // A ficha do operador: se não veio do lote, busca aqui (envio unitário).
  let fichaDoOperador = ficha ?? null;
  if (fichaDoOperador === undefined || fichaDoOperador === null) {
    // Sem empreendimento no escopo (o envio unitário parte da entidade): a CAD mais recente, com
    // ordem explícita. Mesmo critério do lote acima, para os dois caminhos nunca discordarem.
    const linhaEsteira = await lerCadDaEsteira<{ ficha: Record<string, unknown> | null }>(
      client,
      entity.id,
      "ficha",
    );
    fichaDoOperador = linhaEsteira?.ficha ?? null;
  }

  const unido = unirCadastroEFicha(meta.cadastro as Record<string, unknown>, fichaDoOperador);
  const cad = unido.valores as Record<string, unknown>;

  // Contatos: a FICHA do operador ganha de `apolo_contacts`, como em todo o resto do payload.
  // Sem isto o envio usava só os contatos importados, e o e-mail que o operador corrigiu na ficha
  // era ignorado — foi o que reprovou 3 cadastros no C2X em 01/08 ("E-mail de acesso inválido"),
  // sendo que a ficha já tinha o endereço certo ("tr86460@gmail" na importação contra
  // "tr86460@gmail.com" na ficha).
  const { data: contatos } = await client
    .from("apolo_contacts")
    .select("contact_type, value")
    .eq("entity_id", entity.id);
  const lista = (contatos ?? []) as { contact_type: string; value: string }[];
  const daFicha = (fichaDoOperador ?? {}) as Record<string, unknown>;
  const textoDaFicha = (chave: string): string | null => {
    const v = daFicha[chave];
    return typeof v === "string" && v.trim() ? v.trim() : null;
  };

  const email =
    textoDaFicha("email") ?? lista.find((c) => c.contact_type === "email")?.value ?? null;
  const telefone =
    textoDaFicha("telefone") ??
    lista.find((c) => c.contact_type === "whatsapp")?.value ??
    lista.find((c) => c.contact_type === "phone")?.value ??
    null;

  // Cônjuge: relacionamento tipado. Só o essencial é persistido (nome, cpf, e-mail, telefone) —
  // suficiente para o contrato; data de nascimento e demais campos do cônjuge não são guardados.
  const { data: rels } = await client
    .from("apolo_relationships")
    .select("label, metadata")
    .eq("entity_id", entity.id)
    .eq("relationship_type", "conjuge")
    .limit(1);
  const relConjuge = (rels ?? [])[0] as
    | { label: string | null; metadata: Record<string, unknown> | null }
    | undefined;

  // O que o operador editou na ficha GANHA do relacionamento — a mesma regra da CAD assinada.
  const conjuge = unirConjuge(fichaDoOperador, {
    cpf: relConjuge?.metadata?.cpf,
    email: relConjuge?.metadata?.email,
    nome: relConjuge?.label,
    telefone: relConjuge?.metadata?.phone,
  });

  const spouse: ApoloC2xSpouse | null = conjuge
    ? {
        name: conjuge.nome,
        cpf: conjuge.cpf || null,
        birthday: texto((fichaDoOperador ?? {}).conjugeNascimento),
        document: null,
        email: conjuge.email || null,
        phone: conjuge.telefone || null,
        profession: null,
      }
    : null;

  const cadastro: ApoloC2xCadastro = {
    age: null,
    birthday: texto(cad.dataNascimento),
    city: null,
    civilState: label(C2X_ESTADO_CIVIL, cad.estadoCivilId),
    cnpj: isPj ? entity.document_masked : null,
    complement: null,
    cpf: isPj ? null : entity.document_masked,
    creciNumber: null,
    creciValidate: null,
    district: null,
    fantasyName: entity.trade_name,
    isCompany: isPj,
    motherName: texto(cad.nomeMae),
    municipalInscription: isPj ? "Isento" : null,
    nacionality: texto(cad.nacionalidade),
    naturalness: texto(cad.naturalidade),
    nire: isPj ? "Isento" : null,
    number: null,
    openCompanyDate: texto(cad.dataAbertura),
    profession: label(C2X_PROFISSOES, cad.profissaoId),
    propertyRegime: label(C2X_REGIME_BENS, cad.regimeBensId),
    rg: texto(cad.rg),
    salaryRange: label(C2X_FAIXA_RENDA, cad.rendaId),
    schooling: label(C2X_ESCOLARIDADE, cad.escolaridadeId),
    sex: label(C2X_SEXO, cad.sexoId),
    socialContractUpdatedAt: null,
    socialName: entity.legal_name,
    spouse,
    state: null,
    street: null,
    zipcode: null,
  };

  // Endereço: a entidade guarda o texto (UF, cidade); o C2X quer os ids. Lê o principal e resolve.
  const { data: enderecos } = await client
    .from("apolo_addresses")
    .select("postal_code, street, number, complement, district, city, state, is_primary")
    .eq("entity_id", entity.id)
    .order("is_primary", { ascending: false })
    .limit(1);
  const end = (enderecos ?? [])[0] as
    | {
        city: string | null;
        complement: string | null;
        district: string | null;
        number: string | null;
        postal_code: string | null;
        state: string | null;
        street: string | null;
      }
    | undefined;

  // Só 10 das 343 CADs do lançamento têm linha em `apolo_addresses` — nas outras o endereço nunca
  // saiu da ficha do operador. E onde as duas existem, a resolução é CAMPO A CAMPO com a ficha
  // ganhando, igual à CAD assinada: escolher a fonte inteira faria o cliente assinar um endereço
  // e o C2X gravar outro.
  const enderecoUnido = unirEndereco(fichaDoOperador, {
    bairro: texto(end?.district) ?? "",
    cep: texto(end?.postal_code) ?? "",
    cidade: texto(end?.city) ?? "",
    complemento: texto(end?.complement) ?? "",
    logradouro: texto(end?.street) ?? "",
    numero: texto(end?.number) ?? "",
    uf: texto(end?.state) ?? "",
  });

  let endereco: EnderecoC2x | null = null;
  if (enderecoUnido?.logradouro) {
    const { cityId, stateId } = await resolverEstadoCidade(
      enderecoUnido.uf || null,
      enderecoUnido.cidade || null,
    );
    endereco = {
      address: enderecoUnido.logradouro,
      cityId,
      complement: enderecoUnido.complemento || null,
      district: enderecoUnido.bairro || null,
      number: enderecoUnido.numero || null,
      stateId,
      zipcode: enderecoUnido.cep || null,
    };
  }

  // Nacionalidade que ficou em branco: deriva da naturalidade (cidade brasileira -> Brasileira),
  // como o Lucas pediu. A UF sufixada já basta; sem ela, confere na tabela `cities` do C2X.
  if (!cadastro.nacionality && cadastro.naturalness) {
    const { cidade, uf } = partesDaNaturalidade(cadastro.naturalness);
    const conhecidas = uf ? new Set<string>() : await cidadesBrasileiras([cidade]);
    cadastro.nacionality = derivarNacionalidade(cadastro.naturalness, "", (c) =>
      conhecidas.has(chaveDeCidade(c)),
    );
  }

  const perfil: PerfilC2x = isPj ? "imobiliaria" : "cliente";

  return {
    dados: { cadastro, email, endereco, nome: entity.display_name ?? "", telefone },
    imobiliariaUuid: texto(meta.imobiliariaId),
    perfil,
  };
}

// ── ENVIO DE UMA ENTIDADE ─────────────────────────────────────────────────

export type ResultadoEnvio = {
  c2xUserId?: number | null;
  entityId: string;
  erro?: string;
  // "sem_confirmacao" = a API aceitou, mas o usuário não apareceu no banco do C2X. Quase sempre
  // significa que a escrita foi para outro ambiente.
  status: "resolvido" | "duplicado" | "erro" | "sem_confirmacao";
};

// Envia UMA entidade para o C2X e reconcilia o id. `vinculedById` (id da imobiliária no C2X) é
// obrigatório para cliente; quem chama o lote resolve a imobiliária ANTES e passa aqui.
export async function enviarEntidadeParaC2x(input: {
  client?: AdminClient;
  entityId: string;
  // A ficha do operador, quando quem chama já a carregou (lote). Ausente = busca aqui.
  ficha?: Record<string, unknown> | null;
  vinculedById?: number;
}): Promise<ResultadoEnvio> {
  const client = input.client ?? createApoloAdminClient();
  if (!client) {
    return { entityId: input.entityId, erro: "Supabase indisponível.", status: "erro" };
  }

  const { data: entityData, error: entityErro } = await client
    .from("apolo_entities")
    .select("id, display_name, legal_name, trade_name, entity_kind, document_masked, metadata")
    .eq("id", input.entityId)
    .single();
  if (entityErro || !entityData) {
    return { entityId: input.entityId, erro: "Entidade não encontrada.", status: "erro" };
  }

  const entity = entityData as EntityRow;
  const { dados, perfil } = await montarDados(client, entity, input.ficha);
  const documento = documentoDoCadastro(dados.cadastro);

  if (perfil === "cliente" && !input.vinculedById) {
    return {
      entityId: input.entityId,
      erro: "Cliente sem imobiliária vinculada no C2X (vinculed_by_id).",
      status: "erro",
    };
  }

  const payload =
    perfil === "cliente"
      ? montarPayloadCliente(dados, { vinculedById: input.vinculedById! })
      : montarPayloadImobiliaria(dados);

  // Grava a fila como pendente ANTES de enviar: se o processo cair no meio, fica o rastro.
  await client.from("apolo_c2x_sync").upsert(
    {
      atualizado_em: new Date().toISOString(),
      documento,
      entity_id: input.entityId,
      perfil,
      requisicao: payloadParaAuditoria(payload),
      status: "pendente",
    },
    { onConflict: "entity_id" },
  );

  const resposta = await enviarUsuarioC2x(payload);

  // Sucesso OU duplicado: em ambos o usuário existe no C2X — lemos o id pelo documento.
  const criouOuExiste =
    resposta.status === "success" ||
    (resposta.status === "failed" && resposta.duplicado);

  if (!criouOuExiste) {
    const erro =
      resposta.status === "failed"
        ? resposta.mensagem
        : resposta.status === "erro_transporte"
          ? resposta.detalhe
          : "Falha desconhecida.";
    await client
      .from("apolo_c2x_sync")
      .update({
        atualizado_em: new Date().toISOString(),
        erro,
        resposta: resposta as unknown as Record<string, unknown>,
        status: "erro",
        tentativas: 1,
      })
      .eq("entity_id", input.entityId);
    return { entityId: input.entityId, erro, status: "erro" };
  }

  const c2xUserId = documento ? await lerIdC2xPorDocumento(documento) : null;

  // ⚠️ A API disse "criei", mas o usuário NÃO aparece no banco de produção do C2X. Isso é sinal de
  // que a escrita foi para OUTRO LUGAR — foi exatamente o que aconteceu em 28/jul e 01/08, com a
  // env `C2X_WRITE_API_URL` apontando para `teste.careli.adm.br`: 8 cadastros responderam
  // "success", nunca chegaram em produção, e mesmo assim foram carimbados como sincronizados e
  // sumiram da fila. O erro passou 4 dias despercebido porque o sinal (id nulo) era ignorado aqui.
  //
  // Agora a ficha sai da fila do mesmo jeito — reenviar duplicaria, porque o endpoint genérico
  // cria de novo a cada POST — mas fica MARCADA como não confirmada, e a tela mostra isso.
  const confirmado = c2xUserId != null;
  const status = !confirmado
    ? "sem_confirmacao"
    : resposta.status === "success"
      ? "resolvido"
      : "duplicado";

  await client
    .from("apolo_c2x_sync")
    .update({
      atualizado_em: new Date().toISOString(),
      c2x_token: resposta.status === "success" ? resposta.token : null,
      c2x_user_id: c2xUserId,
      enviado_em: new Date().toISOString(),
      erro: confirmado
        ? null
        : "A API respondeu sucesso, mas o usuário não foi encontrado no banco do C2X. Conferir para qual ambiente C2X_WRITE_API_URL está apontando.",
      resposta: resposta as unknown as Record<string, unknown>,
      status,
    })
    .eq("entity_id", input.entityId);

  // Carimba o flag na entidade (já previsto no cadastro: metadata.c2xSynced). NÃO substitui o
  // metadata inteiro (merge do que já existe), senão apaga cadastro/imobiliariaId — a lição da
  // migration 0057.
  const metaAtual = (entity.metadata ?? {}) as Record<string, unknown>;
  await client
    .from("apolo_entities")
    .update({
      metadata: {
        ...metaAtual,
        c2xSynced: true,
        // Fica gravado na ficha quando o envio NÃO pôde ser confirmado no banco do C2X, para o
        // caso não passar por concluído só porque saiu da fila.
        ...(confirmado ? {} : { c2xConfirmado: false }),
        c2xUserId,
      },
    })
    .eq("id", input.entityId);

  return { c2xUserId, entityId: input.entityId, status };
}

// ── CAMADA DE LOTE ────────────────────────────────────────────────────────

// O id da imobiliária no C2X para o `vinculed_by_id` do cliente. A imobiliária da CAD vive no
// relacionamento "Imobiliaria da CAD" (related_entity_id → a entidade PJ); dela sai o CNPJ e o id
// no C2X (users profile 6). As 24 imobiliárias das CADs JÁ existem no C2X, então isto só LÊ, não
// cria. Nulo = sem imobiliária vinculada (a CAD não pode subir). `cache` evita reconsultar o C2X
// pela mesma imobiliária no lote (são 24 distintas para centenas de clientes).
export async function resolverVinculedById(
  client: AdminClient,
  entityId: string,
  cache?: Map<string, number | null>,
): Promise<number | null> {
  // Vínculo por ENTIDADE (qualquer tipo de imobiliária: "imobiliaria" novo, "Imobiliaria da CAD"
  // legado), o mais recente vence. Ver imobiliaria-do-cliente.ts.
  const { data: rel } = await client
    .from("apolo_relationships")
    .select("related_entity_id")
    .eq("entity_id", entityId)
    .ilike("relationship_type", "imobili%")
    .not("related_entity_id", "is", null)
    .neq("status", "archived")
    .order("created_at", { ascending: false })
    .limit(1);
  const imobId = (rel ?? [])[0]?.related_entity_id as string | undefined;
  if (!imobId) return null;

  if (cache?.has(imobId)) return cache.get(imobId) ?? null;

  const { data: imob } = await client
    .from("apolo_entities")
    .select("document_masked")
    .eq("id", imobId)
    .single();
  const id = imob?.document_masked
    ? await lerIdC2xPorDocumento(imob.document_masked)
    : null;
  cache?.set(imobId, id);
  return id;
}

// Campos OBRIGATÓRIOS do C2X que podem faltar numa CAD. Devolve os que faltam (rótulo amigável) —
// é a lista de trabalho do time. CPF/email/telefone não entram (100% preenchidos hoje). Sexo e
// profissão também não: são opcionais no C2X.
const OBRIGATORIOS: { campo: string; rotulo: string }[] = [
  { campo: "estadoCivilId", rotulo: "Estado civil" },
  { campo: "escolaridadeId", rotulo: "Escolaridade" },
  { campo: "rendaId", rotulo: "Renda" },
  { campo: "naturalidade", rotulo: "Naturalidade" },
  { campo: "nacionalidade", rotulo: "Nacionalidade" },
  { campo: "nomeMae", rotulo: "Nome da mãe" },
  { campo: "dataNascimento", rotulo: "Nascimento" },
];

export function diagnosticarCadastro(
  cadMeta: Record<string, unknown>,
  temImobiliaria: boolean,
): string[] {
  const faltam: string[] = [];
  if (!temImobiliaria) faltam.push("Imobiliária");
  for (const o of OBRIGATORIOS) {
    if (!texto(cadMeta[o.campo])) faltam.push(o.rotulo);
  }
  const ec = texto(cadMeta.estadoCivilId);
  if ((ec === "2" || ec === "6") && !texto(cadMeta.regimeBensId)) {
    faltam.push("Regime de bens");
  }
  return faltam;
}

export type ItemLote = {
  // Campos em que `metadata.cadastro` e `apolo_esteira.ficha` discordam sobre QUEM é a pessoa.
  divergencias?: string[];
  entityId: string;
  erro?: string;
  faltantes: string[];
  nome: string;
  // "conferir" = a ficha tem dado de identidade divergente entre as duas fontes; fica fora do
  // envio automático porque nome da mãe e nascimento vão no contrato.
  // "sem_confirmacao" = foi enviada e a API aceitou, mas o cadastro não apareceu no banco do C2X.
  status:
    | "pronta"
    | "faltando"
    | "conferir"
    | "enviada"
    | "duplicada"
    | "erro"
    | "sem_confirmacao";
};

export type ResultadoLote = {
  // Para ONDE os cadastros vão. Aparece na tela porque o incidente de 01/08 (8 cadastros criados
  // no ambiente de teste sem ninguém perceber) só foi possível porque o destino era invisível.
  hostDestino: string;
  itens: ItemLote[];
  resumo: {
    conferir: number;
    duplicadas: number;
    enviadas: number;
    erros: number;
    faltando: number;
    prontas: number;
    // Enviadas que a API aceitou mas não apareceram no banco do C2X.
    semConfirmacao: number;
    total: number;
  };
};

// Processa o LOTE das CADs. `dryRun` só diagnostica (mostra o que subiria e o que falta, sem tocar
// o C2X); com `dryRun:false` envia as PRONTAS. Idempotente: quem já foi (c2xSynced) não entra.
export async function processarLoteC2x(input: {
  // Restringe o lote a UMA ficha. Usado pelo envio automático ao credenciar, que precisa da
  // mesma lógica do lote mas para uma pessoa só.
  apenasEntityId?: string;
  client?: AdminClient;
  dryRun: boolean;
  limit?: number;
  // Teto de ENVIOS REAIS nesta rodada (diferente de `limit`, que corta as candidatas lidas).
  // Serve para mandar um punhado primeiro, conferir no C2X e só então soltar o resto — criar
  // centenas de cadastros de uma vez não tem desfazer.
  maxEnvios?: number;
  // TENTA TODAS, inclusive as que o nosso diagnóstico reprovaria, e deixa a API do C2X decidir.
  //
  // Por que existe: o nosso gate é mais rígido que a API em alguns campos e mais frouxo em
  // outros — ele é uma SUPOSIÇÃO do que o C2X exige. Com isto ligado, a recusa passa a vir do
  // dono da regra, com a mensagem dele, e a lista de pendências vira a lista real.
  //
  // ⚠️ Ignora TAMBÉM o gate de divergência de identidade (nome da mãe / nascimento que não batem
  // entre importação e ficha). Esses campos vão no contrato: quem liga isto está aceitando que
  // um dado divergente suba e seja corrigido depois, à mão, no C2X. Decisão do Lucas em 01/08.
  tentarTodas?: boolean;
}): Promise<ResultadoLote> {
  const client = input.client ?? createApoloAdminClient();
  if (!client) {
    return {
      hostDestino: hostDeDestino(),
      itens: [],
      resumo: {
        conferir: 0,
        duplicadas: 0,
        enviadas: 0,
        erros: 0,
        faltando: 0,
        prontas: 0,
        semConfirmacao: 0,
        total: 0,
      },
    };
  }

  // Candidatas: CAD nascida no Apolo, PF, com cadastro, ainda não sincronizada.
  // Com `apenasEntityId`, o mesmo caminho serve para UMA ficha só — é assim que o envio
  // automático ao credenciar reusa a montagem, o diagnóstico e as travas daqui, em vez de manter
  // uma segunda cópia da regra que envelheceria em separado.
  let consulta = client
    .from("apolo_entities")
    .select("id, display_name, document_masked, metadata")
    .eq("entity_kind", "pf")
    .eq("metadata->>source", "apolo");
  if (input.apenasEntityId) consulta = consulta.eq("id", input.apenasEntityId);
  const { data: entidades } = await consulta.limit(input.limit ?? 1000);

  const candidatas = ((entidades ?? []) as {
    display_name: string | null;
    document_masked: string | null;
    id: string;
    metadata: Record<string, unknown> | null;
  }[]).filter((e) => {
    const meta = e.metadata ?? {};
    return Boolean(meta.cadastro) && meta.c2xSynced !== true;
  });

  // A ficha do operador de TODAS as candidatas de uma vez: é lá que moram sexo, regime de bens, RG
  // e o endereço. Uma consulta em blocos, em vez de uma por entidade.
  const fichas = await lerFichasDaEsteira(client, candidatas.map((e) => e.id));

  // As cidades de naturalidade SEM UF, todas numa consulta só, para derivar a nacionalidade.
  const cidadesSemUf = candidatas.flatMap((ent) => {
    const unido = unirCadastroEFicha(
      (ent.metadata ?? {}).cadastro as Record<string, unknown>,
      fichas.get(ent.id),
    );
    if (texto(unido.valores.nacionalidade)) return [];
    const natural = texto(unido.valores.naturalidade);
    if (!natural) return [];
    const { cidade, uf } = partesDaNaturalidade(natural);
    return uf ? [] : [cidade];
  });
  const cidadesBR = await cidadesBrasileiras(cidadesSemUf);

  const cacheImob = new Map<string, number | null>();
  const itens: ItemLote[] = [];
  let enviados = 0;

  for (const ent of candidatas) {
    const ficha = fichas.get(ent.id) ?? null;
    const unido = unirCadastroEFicha(
      (ent.metadata ?? {}).cadastro as Record<string, unknown>,
      ficha,
    );
    const cadMeta = { ...unido.valores } as Record<string, unknown>;

    // Nacionalidade derivada da naturalidade entra ANTES do diagnóstico, senão a ficha aparece
    // como "faltando Nacionalidade" sendo que o dado é dedutível.
    if (!texto(cadMeta.nacionalidade)) {
      const derivada = derivarNacionalidade(texto(cadMeta.naturalidade) ?? "", "", (c) =>
        cidadesBR.has(chaveDeCidade(c)),
      );
      if (derivada) cadMeta.nacionalidade = derivada;
    }

    const vinculedById = await resolverVinculedById(client, ent.id, cacheImob);
    const faltantes = diagnosticarCadastro(cadMeta, vinculedById != null);
    const nome = ent.display_name ?? "";

    // Com `tentarTodas`, o nosso diagnóstico vira aviso: quem decide é a API do C2X. Sem ele, a
    // ficha para aqui e nunca chega a ser testada contra a regra de verdade.
    if (faltantes.length > 0 && !input.tentarTodas) {
      itens.push({ entityId: ent.id, faltantes, nome, status: "faltando" });
      continue;
    }
    // Duas redes contra mandar a pessoa errada para o contrato: (1) as duas fontes discordando
    // sobre nome da mãe / nascimento; (2) titular e cônjuge dividindo um dado que duas pessoas não
    // dividem. Nenhuma delas substitui o diagnóstico do Asana (cad-diagnostico.ts), que é quem tem
    // a âncora de verdade — mas as duas custam nada e, quando disparam, disparam com razão.
    const costurada = sinaisDeFichaCosturada(ficha, ent.document_masked);
    if ((unido.divergenciasDeIdentidade.length > 0 || costurada.length > 0) && !input.tentarTodas) {
      itens.push({
        divergencias: [...unido.divergenciasDeIdentidade, ...costurada],
        entityId: ent.id,
        faltantes: [],
        nome,
        status: "conferir",
      });
      continue;
    }
    // Estourou o teto de envios desta rodada: a ficha continua pronta, só não foi a vez dela.
    if (input.dryRun || (input.maxEnvios != null && enviados >= input.maxEnvios)) {
      itens.push({ entityId: ent.id, faltantes: [], nome, status: "pronta" });
      continue;
    }
    enviados += 1;

    const r = await enviarEntidadeParaC2x({
      client,
      entityId: ent.id,
      ficha,
      vinculedById: vinculedById ?? undefined,
    });
    itens.push({
      entityId: ent.id,
      erro:
        r.erro ??
        (r.status === "sem_confirmacao"
          ? "A API aceitou, mas o cadastro não apareceu no C2X. Confira o ambiente de destino."
          : undefined),
      faltantes: [],
      nome,
      status:
        r.status === "resolvido"
          ? "enviada"
          : r.status === "duplicado"
            ? "duplicada"
            : r.status === "sem_confirmacao"
              ? "sem_confirmacao"
              : "erro",
    });
  }

  const resumo = {
    conferir: itens.filter((i) => i.status === "conferir").length,
    duplicadas: itens.filter((i) => i.status === "duplicada").length,
    semConfirmacao: itens.filter((i) => i.status === "sem_confirmacao").length,
    enviadas: itens.filter((i) => i.status === "enviada").length,
    erros: itens.filter((i) => i.status === "erro").length,
    faltando: itens.filter((i) => i.status === "faltando").length,
    prontas: itens.filter((i) => i.status === "pronta").length,
    total: itens.length,
  };
  return { hostDestino: hostDeDestino(), itens, resumo };
}

// Só o HOST de `C2X_WRITE_API_URL` — nunca a chave. Serve para a tela dizer, antes do clique, para
// qual C2X os cadastros vão.
function hostDeDestino(): string {
  const base = process.env.C2X_WRITE_API_URL?.trim();
  if (!base) return "não configurado";
  try {
    return new URL(base).host;
  } catch {
    return "inválido";
  }
}
