// QUEM É ESTE CONTATO NO APOLO — a resposta que o cockpit da Iris precisa dar antes de tudo.
//
// O phone-match (`/api/iris/apolo/phone-match`) responde "registered" ou "missing" olhando UMA
// fonte: `apolo_entity_identifiers`. Isso deixa dois buracos que a operação sente todo dia:
//
//   1. QUEM SÓ EXISTE COMO VÍNCULO É INVISÍVEL. O cônjuge do comprador, o corretor da
//      imobiliária e o representante legal têm nome e telefone gravados no `metadata` do
//      relacionamento, e essa fonte nunca é consultada. Medido em 14/08: 204 vínculos guardam
//      telefone, e 101 desses números não pertencem a nenhuma entidade — 80 são cônjuges. Na
//      prática, a esposa do comprador manda mensagem e a Iris a trata como estranha, mesmo com
//      os dados dela no contrato do marido.
//
//   2. "NÃO ACHEI" E "NÃO CONSEGUI OLHAR" VIRAM A MESMA COISA. Quando a consulta falha, a tela
//      fica idêntica à de um desconhecido. O operador não tem como saber se cadastra alguém novo
//      ou se está prestes a duplicar uma ficha que existe.
//
// Por isso aqui o retorno é um ESTADO explícito, nunca um booleano: `entidade`, `vinculo`,
// `nenhum` ou `indisponivel`. A tela mostra cada um de um jeito, e "indisponível" pede nova
// tentativa em vez de mentir.
import { createHash } from "node:crypto";

import type { createApoloAdminClient } from "@/lib/apolo/server";

type AdminClient = NonNullable<ReturnType<typeof createApoloAdminClient>>;

export type PapelDoContato = { profile: string; status: null | string };

export type VinculoDoContato = {
  /** Nome da entidade do outro lado (a imobiliária, o comprador). */
  entidade: null | string;
  entidadeId: null | string;
  /**
   * O que o OUTRO LADO é nesta relação — "Imobiliária", "Corretor", "Cônjuge".
   *
   * ⚠️ NÃO é o papel de quem está no atendimento, e confundir os dois foi um erro real: a Ilza
   * é COMPRADORA e o vínculo dela é `Imobiliaria ou responsavel comercial → IMPARAVEL`. Exibir
   * esse rótulo como se fosse dela dizia ao operador que ela é a responsável comercial da
   * imobiliária, quando ela é a cliente que comprou um lote atendida por essa imobiliária.
   */
  papelDoOutro: string;
  /**
   * A frase pronta, já na direção certa. É o que a tela mostra.
   *
   * A DIREÇÃO depende de quem é o dono do vínculo, e ignorar isso inverte o sentido:
   *   • o vínculo é DELA (`entity_id` = ela) → o tipo descreve a contraparte:
   *     "Imobiliária: Imparável" (a imobiliária dela é a Imparável);
   *   • o vínculo é de OUTRA ficha apontando para ela (`related_entity_id` = ela) → o tipo
   *     descreve ELA: "Corretor de Ariel Barros" (ela é a corretora do Ariel).
   * Sem essa distinção, a Ingrity — que é corretora de três clientes — apareceria como se o
   * corretor dela fosse cada um deles.
   */
  descricao: string;
  /**
   * O vínculo é DESTA ficha (true) ou de outra apontando para ela (false)?
   *
   * É o que define a preposição na tela: dono → "Imobiliária: Imparável"; alvo → "Corretor de
   * Ariel". A tela não deve deduzir isso quebrando a `descricao` em pedaços.
   */
  souODono: boolean;
  /**
   * "trabalho" ou "contato" — as duas famílias do CRM.
   *
   * Vem de `metadata.kind`, que só existe nos vínculos criados pelo wizard novo. Nos antigos
   * (4.107 linhas de "Imobiliaria ou responsavel comercial", por exemplo) é nulo, e aí a família
   * é DEDUZIDA da lista de tipos pessoais abaixo. Deduzir é honesto aqui: "cônjuge" nunca é
   * relação de trabalho, e o resto do que existe na base é comercial.
   */
  kind: "contato" | "trabalho";
  /** Rótulo do vínculo como está gravado ("corretor", "conjuge", "Imobiliaria da CAD"). */
  tipo: string;
};

/**
 * `relationship_type` → o que o OUTRO LADO é.
 *
 * Os rótulos do legado descrevem a contraparte, não o titular: "Imobiliaria ou responsavel
 * comercial" (4.108 linhas, escrito pelo sync em `lib/apolo/server.ts:4222`) quer dizer "a
 * imobiliária desta pessoa é X". Traduzir aqui é o que evita o painel dizer que o comprador é a
 * imobiliária dele mesmo.
 */
const PAPEL_DO_OUTRO: Record<string, string> = {
  "conjuge": "Cônjuge",
  "corretagem": "Corretor",
  "corretor": "Corretor",
  "empreendimento": "Empreendimento",
  "imobiliaria": "Imobiliária",
  "imobiliaria da cad": "Imobiliária",
  "imobiliaria ou responsavel comercial": "Imobiliária",
  "origem comercial": "Origem comercial",
  "representante_legal": "Representante legal",
  "socio": "Sócio",
  "vinculo comercial": "Vínculo comercial",
};

function papelDoOutroLado(tipo: null | string): string {
  const normalizado = String(tipo ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();

  return PAPEL_DO_OUTRO[normalizado] ?? (tipo ?? "Vínculo").trim();
}

/** Tipos que são relação PESSOAL. O que não está aqui é tratado como trabalho. */
const TIPOS_DE_CONTATO = [
  "conjuge",
  "cônjuge",
  "mae",
  "mãe",
  "pai",
  "filho",
  "filha",
  "irmao",
  "irmã",
  "irmao(a)",
  "socio",
  "sócio",
  "representante_legal",
  "representante legal",
  "amigo",
  "avo",
  "tio",
];

function familiaDoVinculo(
  tipo: null | string,
  kindGravado: null | string,
): "contato" | "trabalho" {
  if (kindGravado === "contato" || kindGravado === "trabalho") return kindGravado;

  const normalizado = String(tipo ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();

  return TIPOS_DE_CONTATO.some((item) =>
    normalizado.includes(
      item.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase(),
    ),
  )
    ? "contato"
    : "trabalho";
}

export type ContatoDaFicha = { tipo: string; valor: string };

export type IdentidadeDoContato =
  | {
      /** Achado como ENTIDADE própria: tem ficha no Apolo. */
      estado: "entidade";
      /** E-mail e telefones da ficha — o painel usa para preencher os campos que hoje ficam "-". */
      contatos: ContatoDaFicha[];
      documentoMascarado: null | string;
      entidadeId: string;
      /** 'person' | 'company' — o formulário mostra CPF ou CNPJ conforme isto. */
      tipo: null | string;
      nome: string;
      papeis: PapelDoContato[];
      /**
       * O que a pessoa É para a Careli: "Comprador", "Imobiliária", "Corretor", "Incorporador",
       * "Prospect". Null quando não dá para afirmar.
       *
       * ⚠️ NÃO SAI DE `apolo_entity_profiles` sozinho. Lá, comprador de verdade costuma ter só
       * `pessoa_fisica` e `usuario` — rótulos do cadastro, não papel de negócio (a Ilza, que tem
       * 47 registros de carteira, é exatamente esse caso). Quem manda é a CARTEIRA: tem unidade
       * comprada, é Comprador. É a mesma régua do `isBuyer` do CRM (`lib/apolo/server.ts:1008`).
       */
      perfil: null | string;
      /** Como o telefone foi encontrado: por identificador ou pela lista de contatos da ficha. */
      via: "contato" | "identificador";
      vinculos: VinculoDoContato[];
    }
  | {
      /**
       * Achado apenas como VÍNCULO de outra pessoa: não tem ficha própria.
       *
       * É o caso do cônjuge que liga pelo comprador e do corretor que fala pela imobiliária. O
       * cockpit mostra de quem ele é, e oferece criar a ficha própria.
       */
      estado: "vinculo";
      nome: null | string;
      vinculos: VinculoDoContato[];
    }
  | { estado: "indisponivel"; motivo: string }
  | { estado: "nenhum" };

/** Mesmo hash do phone-match: se mudar aqui sem mudar lá, os dois passam a discordar. */
function hashIdentifier(type: string, value: string): string {
  return createHash("sha256")
    .update(`apolo-identifier:${type}:${value.trim().toLowerCase()}`)
    .digest("hex");
}

const digitos = (valor: null | string | undefined) => String(valor ?? "").replace(/\D/g, "");

/**
 * Variantes do telefone, incluindo com e sem o nono dígito.
 *
 * O WhatsApp entrega o número às vezes com 8 dígitos depois do DDD e às vezes com 9, e o cadastro
 * tem o outro. Sem gerar as duas formas, o casamento falha em número que existe — foi assim que a
 * Ingrity (corretora da L&I, com CPF e telefone cadastrados) apareceu no cockpit como
 * desconhecida.
 */
export function variantesDeTelefone(telefone: null | string): string[] {
  const bruto = digitos(telefone);
  if (bruto.length < 8) return [];

  const variantes = new Set<string>([bruto]);
  const nacional = bruto.startsWith("55") ? bruto.slice(2) : bruto;

  if (nacional.length >= 8) {
    variantes.add(nacional);
    variantes.add(`55${nacional}`);
  }
  if (nacional.length === 11 && nacional[2] === "9") {
    const semNono = `${nacional.slice(0, 2)}${nacional.slice(3)}`;
    variantes.add(semNono);
    variantes.add(`55${semNono}`);
  }
  if (nacional.length === 10) {
    const comNono = `${nacional.slice(0, 2)}9${nacional.slice(2)}`;
    variantes.add(comNono);
    variantes.add(`55${comNono}`);
  }

  return [...variantes].filter((variante) => variante.length >= 8);
}

/** Os 8 últimos dígitos: é o que sobrevive a DDI, DDD e nono dígito na comparação por texto. */
const final8 = (telefone: null | string) => digitos(telefone).slice(-8);

/** Papéis do cadastro que NÃO dizem o que a pessoa é para o negócio. */
const PAPEL_TECNICO = new Set(["pessoa_fisica", "pessoa_juridica", "usuario"]);

const ROTULO_PERFIL: Record<string, string> = {
  colaborador: "Colaborador",
  corretor: "Corretor",
  imobiliaria: "Imobiliária",
  incorporador: "Incorporador",
  parceiro: "Parceiro",
  prospect: "Prospect",
};

async function papeisEVinculos(
  client: AdminClient,
  entidadeId: string,
): Promise<{
  papeis: PapelDoContato[];
  perfil: null | string;
  vinculos: VinculoDoContato[];
}> {
  const [{ data: perfis }, { data: relacoes }, { count: temCarteira }] = await Promise.all([
    client.from("apolo_entity_profiles").select("profile, status").eq("entity_id", entidadeId),
    client
      .from("apolo_relationships")
      .select("relationship_type, label, related_entity_id, entity_id, metadata")
      .or(`entity_id.eq.${entidadeId},related_entity_id.eq.${entidadeId}`)
      .neq("status", "archived")
      .limit(30),
    // Tem carteira? Uma linha basta — `head: true` traz só a contagem, sem puxar as 47 parcelas
    // da Ilza (a tabela tem 200 mil linhas no total).
    client
      .from("apolo_financial_snapshots")
      .select("entity_id", { count: "exact", head: true })
      .eq("entity_id", entidadeId),
  ]);

  const linhas = (relacoes ?? []) as Array<{
    entity_id: string;
    label: null | string;
    metadata: null | { kind?: string };
    related_entity_id: null | string;
    relationship_type: null | string;
  }>;

  // Nome da entidade do outro lado do vínculo (a imobiliária, o comprador).
  const outros = [
    ...new Set(
      linhas
        .map((linha) => (linha.entity_id === entidadeId ? linha.related_entity_id : linha.entity_id))
        .filter((id): id is string => Boolean(id) && id !== entidadeId),
    ),
  ];

  const nomePorId = new Map<string, string>();
  if (outros.length) {
    const { data: entidades } = await client
      .from("apolo_entities")
      .select("id, display_name, legal_name")
      .in("id", outros.slice(0, 30));
    for (const entidade of (entidades ?? []) as Array<{
      display_name: null | string;
      id: string;
      legal_name: null | string;
    }>) {
      nomePorId.set(
        entidade.id,
        (entidade.legal_name || entidade.display_name || "").trim() || "Sem nome",
      );
    }
  }

  const papeis = ((perfis ?? []) as PapelDoContato[]).filter((perfil) => perfil.profile);

  // A ORDEM importa: carteira ganha de tudo. Quem comprou é Comprador, mesmo que o cadastro só
  // tenha `pessoa_fisica`. Depois vem o papel de negócio do cadastro (imobiliária, corretor,
  // incorporador, prospect). Se nada disso existe, não inventamos: null, e a tela omite a linha.
  const papelDeNegocio = papeis
    .map((papel) => papel.profile)
    .find((papel) => !PAPEL_TECNICO.has(papel));

  const perfil =
    (temCarteira ?? 0) > 0
      ? "Comprador"
      : papelDeNegocio
        ? (ROTULO_PERFIL[papelDeNegocio] ?? papelDeNegocio)
        : null;

  return {
    papeis,
    perfil,
    vinculos: linhas.map((linha) => {
      const outroId =
        linha.entity_id === entidadeId ? linha.related_entity_id : linha.entity_id;
      const tipo = (linha.relationship_type ?? "vínculo").trim();

      const outroNome = outroId
        ? (nomePorId.get(outroId) ?? null)
        : (linha.label?.trim() || null);
      const papel = papelDoOutroLado(tipo);
      // Dono do vínculo = esta ficha? Então o tipo fala do OUTRO. Se o vínculo é de outra ficha
      // apontando para cá, o tipo fala DESTA pessoa.
      const souODono = linha.entity_id === entidadeId;

      return {
        souODono,
        descricao: souODono
          ? `${papel}${outroNome ? `: ${outroNome}` : ""}`
          : `${papel}${outroNome ? ` de ${outroNome}` : ""}`,
        entidade: outroNome,
        entidadeId: outroId ?? null,
        kind: familiaDoVinculo(tipo, linha.metadata?.kind ?? null),
        papelDoOutro: papel,
        tipo,
      };
    }),
  };
}

/**
 * Resolve o telefone do atendimento nas TRÊS fontes, em ordem de confiança:
 *   1. `apolo_entity_identifiers` (hash) — é a chave forte, a mesma do phone-match;
 *   2. `apolo_contacts` (texto) — a ficha tem o telefone na lista de contatos;
 *   3. `apolo_relationships.metadata->>'phone'` — só existe como vínculo de outra pessoa.
 */
export async function identidadeDoContato(
  client: AdminClient,
  telefone: null | string,
): Promise<IdentidadeDoContato> {
  const variantes = variantesDeTelefone(telefone);
  if (!variantes.length) return { estado: "nenhum" };

  try {
    // 1) Identificador (hash). Chave forte.
    const hashes = variantes.map((variante) => hashIdentifier("phone", variante));
    const { data: identificadores, error: erroIdentificador } = await client
      .from("apolo_entity_identifiers")
      .select("entity_id")
      .eq("identifier_type", "phone")
      .in("value_hash", hashes)
      .limit(5);

    if (erroIdentificador) {
      return { estado: "indisponivel", motivo: "Não foi possível consultar o Apolo agora." };
    }

    let entidadeId = (identificadores ?? [])[0]?.entity_id ?? null;
    let via: "contato" | "identificador" = "identificador";

    // 2) Lista de contatos da ficha. Casa pelos 8 últimos dígitos, que é o que sobrevive a
    //    DDI/DDD/nono dígito. O `like` corre sobre poucos milhares de linhas, é barato.
    if (!entidadeId) {
      const { data: contatos } = await client
        .from("apolo_contacts")
        .select("entity_id, value, normalized_value")
        .in("contact_type", ["phone", "whatsapp"])
        .like("normalized_value", `%${final8(telefone)}`)
        .limit(5);

      entidadeId = (contatos ?? [])[0]?.entity_id ?? null;
      if (entidadeId) via = "contato";
    }

    if (entidadeId) {
      const [{ data: entidade }, extras, { data: contatos }] = await Promise.all([
        client
          .from("apolo_entities")
          .select("id, display_name, legal_name, document_masked, entity_kind")
          .eq("id", entidadeId)
          .maybeSingle(),
        papeisEVinculos(client, entidadeId),
        client
          .from("apolo_contacts")
          .select("contact_type, value, is_primary")
          .eq("entity_id", entidadeId)
          .neq("status", "archived")
          .limit(20),
      ]);

      const ficha = entidade as null | {
        display_name: null | string;
        document_masked: null | string;
        entity_kind: null | string;
        id: string;
        legal_name: null | string;
      };

      return {
        contatos: ((contatos ?? []) as Array<{
          contact_type: null | string;
          is_primary: boolean | null;
          value: null | string;
        }>)
          // O principal primeiro: é o que o painel mostra quando só cabe um.
          .sort((a, b) => Number(b.is_primary ?? false) - Number(a.is_primary ?? false))
          .map((contato) => ({
            tipo: (contato.contact_type ?? "").trim(),
            valor: (contato.value ?? "").trim(),
          }))
          .filter((contato) => contato.tipo && contato.valor),
        documentoMascarado: ficha?.document_masked?.trim() || null,
        entidadeId,
        estado: "entidade",
        nome: (ficha?.legal_name || ficha?.display_name || "").trim() || "Sem nome",
        papeis: extras.papeis,
        perfil: extras.perfil,
        tipo: ficha?.entity_kind?.trim() || null,
        via,
        vinculos: extras.vinculos,
      };
    }

    // 3) Só como VÍNCULO de outra pessoa (cônjuge, corretor, sócio, representante). O telefone
    //    mora dentro do metadata do relacionamento, e é por isso que ninguém acha essa gente hoje.
    const { data: vinculos } = await client
      .from("apolo_relationships")
      .select("entity_id, relationship_type, label, metadata")
      .neq("status", "archived")
      .not("metadata->>phone", "is", null)
      .limit(1000);

    const alvo = final8(telefone);
    const casados = ((vinculos ?? []) as Array<{
      entity_id: string;
      label: null | string;
      metadata: null | { nome?: string; phone?: string };
      relationship_type: null | string;
    }>).filter((vinculo) => final8(vinculo.metadata?.phone ?? "") === alvo && alvo.length === 8);

    if (casados.length) {
      const donos = [...new Set(casados.map((vinculo) => vinculo.entity_id))];
      const { data: entidades } = await client
        .from("apolo_entities")
        .select("id, display_name, legal_name")
        .in("id", donos.slice(0, 10));

      const nomePorId = new Map(
        ((entidades ?? []) as Array<{
          display_name: null | string;
          id: string;
          legal_name: null | string;
        }>).map((entidade) => [
          entidade.id,
          (entidade.legal_name || entidade.display_name || "").trim() || "Sem nome",
        ]),
      );

      return {
        estado: "vinculo",
        nome: casados[0]?.metadata?.nome?.trim() || null,
        vinculos: casados.map((vinculo) => {
          const tipo = (vinculo.relationship_type ?? "vínculo").trim();
          const dono = nomePorId.get(vinculo.entity_id) ?? null;
          const papel = papelDoOutroLado(tipo);

          return {
            // Aqui a direcao e sempre a mesma: o telefone foi achado DENTRO do vinculo de outra
            // ficha, entao o tipo descreve esta pessoa ("Conjuge de Edi Carlos").
            descricao: `${papel}${dono ? ` de ${dono}` : ""}`,
            souODono: false,
            entidade: dono,
            entidadeId: vinculo.entity_id,
            kind: familiaDoVinculo(tipo, null),
            papelDoOutro: papel,
            tipo,
          };
        }),
      };
    }

    return { estado: "nenhum" };
  } catch (error) {
    console.error("[iris][identidade-contato] falha", error);
    return { estado: "indisponivel", motivo: "Não foi possível consultar o Apolo agora." };
  }
}
