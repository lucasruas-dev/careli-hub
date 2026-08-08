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
  C2X_ANEXO_MAX_BYTES,
  C2X_CAMPO_CONTRATO_SOCIAL,
  documentoDoCadastro,
  enviarUsuarioC2x,
  montarPayload,
  payloadParaAuditoria,
  perfilPorPapel,
  soDigitos,
  type AnexoC2x,
  type DadosDaEntidade,
  type EnderecoC2x,
  type PerfilC2x,
} from "./c2x-write";
import { APOLO_DOCS_BUCKET, guessMime, lerDocumentoDoStorage } from "./documentos";
import type { ApoloC2xCadastro, ApoloC2xRepresentante, ApoloC2xSpouse } from "./types";

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

// ── ESTA PESSOA JÁ EXISTE NO C2X? (produção, read-only) ───────────────────
//
// O endpoint de escrita do C2X é o genérico `POST /api/v1/users`: cada chamada CRIA DE NOVO, não
// olha o documento e NÃO TEM DESFAZER. O único jeito de saber, ANTES do POST, que a pessoa já
// está lá é perguntar ao banco de produção pelo DOCUMENTO (CPF/CNPJ), que é a chave natural.
//
// ⚠️ SÓ DÍGITOS DOS DOIS LADOS: no C2X o cpf/cnpj pode estar com ou sem máscara.
//
// Este bloco é o ÚNICO lugar do servidor que faz essa leitura — a mesma que o
// scripts/apolo/subir-cads-pendentes.mjs já fazia por fora e que descobriu as 132 pessoas que
// estão no C2X sem uma linha sequer na nossa `apolo_c2x_sync` (entraram por importação antiga ou
// por cadastro manual lá dentro; a fila só ganha linha quando NÓS enviamos).

// ⚠️ TRÊS RESPOSTAS, NÃO DUAS — e a terceira é a que protege:
//   ok:true  + documento no `ids`          -> a pessoa EXISTE no C2X;
//   ok:true  + documento fora do `ids`     -> perguntamos e ela NÃO existe;
//   ok:false                               -> NÃO DEU PARA PERGUNTAR (banco fora, credencial,
//                                             timeout).
// Achatar o terceiro caso no segundo é exatamente como nasce cadastro duplicado num sistema de
// CONTRATOS: "não consegui perguntar" viraria "pode criar".
export type ConsultaC2xPorDocumento =
  | {
      // Os documentos que a consulta REALMENTE cobriu (só dígitos). Quem não está aqui não foi
      // perguntado, e "não perguntei" nunca pode ser lido como "não existe".
      consultados: Set<string>;
      // documento (só dígitos) -> users.id no C2X. Havendo mais de um, vence o MAIOR id — o mesmo
      // critério do `ORDER BY id DESC LIMIT 1` que esta leitura sempre usou.
      ids: Map<string, number>;
      ok: true;
    }
  | { motivo: string; ok: false };

// Blocos de 200 documentos por consulta. O legado é de PRODUÇÃO e um `IN` com centenas de valores
// pesa; é o mesmo tamanho que o script de leitura cruzada já usa.
const BLOCO_DOCUMENTOS_C2X = 200;

// Quais destes documentos existem como usuário no C2X, EM UMA CONSULTA (por bloco) — não uma por
// pessoa. É o que impede a trava anti-duplicado de virar N+1 no lote, que processa dezenas.
export async function consultarDocumentosNoC2x(
  documentos: (string | null | undefined)[],
): Promise<ConsultaC2xPorDocumento> {
  const limpos = [...new Set(documentos.map((d) => soDigitos(d ?? "")).filter(Boolean))];
  if (limpos.length === 0) return { consultados: new Set(), ids: new Map(), ok: true };

  const poolResult = getHadesDbPool();
  if (!poolResult.ok) {
    return { motivo: "o banco do C2X não está configurado ou não respondeu", ok: false };
  }

  const semMascara = (coluna: string) =>
    `REPLACE(REPLACE(REPLACE(REPLACE(${coluna},'.',''),'-',''),'/',''),' ','')`;

  const ids = new Map<string, number>();
  try {
    for (let i = 0; i < limpos.length; i += BLOCO_DOCUMENTOS_C2X) {
      const bloco = limpos.slice(i, i + BLOCO_DOCUMENTOS_C2X);
      const marcadores = bloco.map(() => "?").join(",");
      const [rows] = await poolResult.pool.query<RowDataPacket[]>(
        `SELECT id, ${semMascara("cpf")} AS doc FROM users
           WHERE ${semMascara("cpf")} IN (${marcadores})
         UNION ALL
         SELECT id, ${semMascara("cnpj")} AS doc FROM users
           WHERE ${semMascara("cnpj")} IN (${marcadores})`,
        [...bloco, ...bloco],
      );
      for (const linha of rows) {
        const doc = String(linha.doc ?? "");
        const id = typeof linha.id === "number" ? linha.id : Number(linha.id);
        if (!doc || !Number.isFinite(id)) continue;
        const atual = ids.get(doc);
        if (atual == null || id > atual) ids.set(doc, id);
      }
    }
  } catch (erro) {
    // Falha de consulta é `ok:false`, NUNCA "não achei". Quem chama decide o que fazer — e a
    // decisão desta casa é não enviar.
    return { motivo: erro instanceof Error ? erro.message : String(erro), ok: false };
  }

  return { consultados: new Set(limpos), ids, ok: true };
}

// A situação de UM documento, reusando a consulta em bloco quando ela já cobriu este documento.
// Sem cache (ou com um documento que o bloco não cobriu) faz a consulta unitária.
export type SituacaoNoC2x =
  | { c2xUserId: number; situacao: "existe" }
  | { motivo: string; situacao: "indisponivel" }
  | { situacao: "nao_existe" };

// ⚠️ NA DÚVIDA, NÃO ENVIA — e diz por quê.
//
// Decisão desta tarefa, e ela tem um lado escolhido de propósito: quando a checagem no C2X falha,
// o envio fica ADIADO, não "liberado por otimismo". Um envio atrasado se resolve com um clique
// depois; um cadastro duplicado num sistema de contratos não se resolve — o endpoint não desfaz e
// o time passa a ter duas pessoas com o mesmo CPF no legado. O motivo real da falha viaja junto na
// mensagem para isto não virar silêncio.
export function msgC2xNaoConferido(motivo: string): string {
  return (
    `NADA foi enviado: não deu para conferir no C2X se esta pessoa já existe lá (${motivo}). ` +
    "O envio ficou adiado de propósito — o endpoint de escrita cria um cadastro novo a cada " +
    "chamada e não tem desfazer. Tente de novo quando o C2X responder."
  );
}

export async function situacaoNoC2x(
  documento: string | null | undefined,
  consulta?: ConsultaC2xPorDocumento,
): Promise<SituacaoNoC2x> {
  const doc = soDigitos(documento ?? "");
  // Sem documento não há como perguntar — e sem pergunta não há envio. O C2X recusaria do mesmo
  // jeito (CPF/CNPJ é obrigatório lá), só que depois de criar a chance de duplicar.
  if (!doc) {
    return { motivo: "a ficha não tem CPF/CNPJ para conferir", situacao: "indisponivel" };
  }

  // A consulta em bloco veio quebrada. Não adianta reperguntar de um em um ao mesmo banco que
  // acabou de não responder: o desfecho seria o mesmo e o legado é de produção.
  if (consulta && !consulta.ok) return { motivo: consulta.motivo, situacao: "indisponivel" };

  if (consulta?.ok && consulta.consultados.has(doc)) {
    const id = consulta.ids.get(doc);
    return id != null ? { c2xUserId: id, situacao: "existe" } : { situacao: "nao_existe" };
  }

  const unitaria = await consultarDocumentosNoC2x([doc]);
  if (!unitaria.ok) return { motivo: unitaria.motivo, situacao: "indisponivel" };
  const id = unitaria.ids.get(doc);
  return id != null ? { c2xUserId: id, situacao: "existe" } : { situacao: "nao_existe" };
}

// A API devolve token, não id. Depois de criar, achamos o id do usuário no banco de produção pelo
// DOCUMENTO. Assinatura de sempre (null = não achei OU não deu para perguntar), porque quem a usa
// roda DEPOIS do POST, onde os dois casos dão no mesmo. Quem precisa distinguir usa `situacaoNoC2x`.
export async function lerIdC2xPorDocumento(documento: string): Promise<number | null> {
  const consulta = await consultarDocumentosNoC2x([documento]);
  return consulta.ok ? (consulta.ids.get(soDigitos(documento)) ?? null) : null;
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

// PERFIL DA FICHA NO C2X = PAPEL da entidade, NUNCA a persona PF/PJ.
//
// Antes o perfil saía de `entity_kind === "pj" ? "imobiliaria" : "cliente"`. Decidir pela persona
// é o bug: com o filtro de PJ liberado, os clientes PJ credenciados nasceriam como IMOBILIÁRIA
// (profile_id 6) em produção, e o POST genérico cria de novo a cada chamada — não tem desfazer.
//
// `metadata.bornRole` é a fonte: 109 de 109 fichas nascidas no Apolo (`source = 'apolo'`) têm o
// campo, e só essas sobem. Sem papel nenhum (fichas que vieram do próprio sync do C2X):
//   • PF cai em "cliente" — é o comportamento de hoje, e o único perfil que a fila de cliente monta;
//   • PJ NÃO sobe (null), porque é exatamente aí que a regra antiga chutava imobiliária.
//
// UMA função só para o FILTRO de candidatas e a MONTAGEM do payload: se cada lado tivesse a sua
// cópia, um dia um mudaria e o outro não.
export function perfilDaFicha(
  metadata: Record<string, unknown> | null | undefined,
  entityKind: string | null | undefined,
): PerfilC2x | null {
  const papel = texto((metadata ?? {}).bornRole) ?? "";
  const ehPj = entityKind === "pj";
  return perfilPorPapel(papel) ?? (!papel && !ehPj ? "cliente" : null);
}

// O SÓCIO QUE ASSINA PELA EMPRESA (só PJ).
//
// Fonte 1: `metadata.cadastro.socios[]` — a ficha completa que a etapa Sócios do wizard salvou.
// Fonte 2: o relacionamento tipado 'representante_legal' — guarda nome, CPF, e-mail e telefone, e
// SOBREVIVE ao sync do C2X (que substitui o metadata inteiro; lição da migration 0057). Por isso
// ele é a reserva, e não o contrário.
//
// Sem nenhum dos dois devolve null: a empresa fica sem assinante e o diagnóstico mostra a
// pendência, em vez de eleger um sócio qualquer para assinar contrato.
async function lerRepresentanteLegal(
  client: AdminClient,
  entityId: string,
  cadEmpresa: Record<string, unknown>,
): Promise<ApoloC2xRepresentante | null> {
  const socios = Array.isArray(cadEmpresa.socios)
    ? (cadEmpresa.socios as Record<string, unknown>[])
    : [];
  const socio = socios.find((s) => s?.representanteLegal === true) ?? null;
  if (socio && texto(socio.nome)) {
    return {
      cpf: texto(socio.cpf),
      email: texto(socio.email),
      name: texto(socio.nome),
      // A etapa Sócios NÃO coleta profissão hoje (a seção Perfil do wizard só existe no ramo PF),
      // então isto vem nulo e o payload cai em "PROFISSÃO NÃO DECLARADA". Quando o campo nascer,
      // ele passa a valer aqui sem mexer no envio.
      profession: label(C2X_PROFISSOES, socio.profissaoId),
    };
  }

  const { data } = await client
    .from("apolo_relationships")
    .select("label, metadata")
    .eq("entity_id", entityId)
    .eq("relationship_type", "representante_legal")
    .limit(1);
  const rel = (data ?? [])[0] as
    | { label: string | null; metadata: Record<string, unknown> | null }
    | undefined;
  if (!rel?.label) return null;

  return {
    cpf: texto(rel.metadata?.cpf),
    email: texto(rel.metadata?.email),
    name: texto(rel.label),
    profession: null,
  };
}

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
  // Null = a entidade NÃO tem perfil no C2X (corretor, fornecedor, parceiro, colaborador) ou o
  // papel dela é desconhecido. Quem chama não envia — chutar um perfil cria cadastro errado, e o
  // POST genérico não tem desfazer.
  perfil: PerfilC2x | null;
}> {
  const meta = entity.metadata ?? {};
  const isPj = entity.entity_kind === "pj";
  // Bloco de EMPRESA da ficha (porte, data de abertura, sócios). Vem direto de
  // `metadata.cadastro`: a cascata cadastro+ficha só carrega os CAMPOS_PESSOAIS, então ler
  // `dataAbertura` de lá devolvia sempre vazio — e o cliente PJ subiria sem data de abertura.
  const cadEmpresa = (meta.cadastro ?? {}) as Record<string, unknown>;

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

  // REPRESENTANTE LEGAL (só PJ): é ele quem assina pela empresa e de quem sai a profissão.
  // Fonte 1: `metadata.cadastro.socios[]`, o que a etapa Sócios do wizard salvou.
  // Fonte 2 (reserva): o relacionamento 'representante_legal', que SOBREVIVE ao sync do C2X —
  // o metadata não (o upsert do sync substitui o jsonb inteiro; lição da migration 0057).
  const representante = isPj ? await lerRepresentanteLegal(client, entity.id, cadEmpresa) : null;

  const cadastro: ApoloC2xCadastro = {
    age: null,
    birthday: texto(cad.dataNascimento),
    city: null,
    civilState: label(C2X_ESTADO_CIVIL, cad.estadoCivilId),
    cnpj: isPj ? entity.document_masked : null,
    companySize: isPj ? texto(cadEmpresa.porte) : null,
    complement: null,
    cpf: isPj ? null : entity.document_masked,
    creciNumber: null,
    creciValidate: null,
    district: null,
    fantasyName: entity.trade_name,
    isCompany: isPj,
    legalRepresentative: representante,
    motherName: texto(cad.nomeMae),
    municipalInscription: isPj ? "Isento" : null,
    nacionality: texto(cad.nacionalidade),
    naturalness: texto(cad.naturalidade),
    nire: isPj ? "Isento" : null,
    number: null,
    // Da ficha de EMPRESA (ver `cadEmpresa` acima), não da cascata de campos pessoais.
    openCompanyDate: texto(cadEmpresa.dataAbertura),
    profession: label(C2X_PROFISSOES, cad.profissaoId),
    propertyRegime: label(C2X_REGIME_BENS, cad.regimeBensId),
    rg: texto(cad.rg),
    salaryRange: label(C2X_FAIXA_RENDA, cad.rendaId),
    schooling: label(C2X_ESCOLARIDADE, cad.escolaridadeId),
    sex: label(C2X_SEXO, cad.sexoId),
    // DATA DA ATUALIZAÇÃO CADASTRAL (só PJ; o C2X recusa a empresa sem ela). A fonte real é a
    // "situação cadastral" do cartão CNPJ, que o cadastro guarda em
    // `metadata.cadastro.dataAtualizacaoCadastral`; a data de abertura é a reserva natural, porque
    // em 464 dos 523 clientes PJ do C2X as duas são o MESMO dia. Vazio aqui cai em "hoje" na
    // montagem do payload (ver `dataAtualizacaoCadastralC2x`), que é o último recurso autorizado.
    socialContractUpdatedAt: isPj
      ? (texto(cadEmpresa.dataAtualizacaoCadastral) ?? texto(cadEmpresa.dataAbertura))
      : null,
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

  // Mesma decisão do filtro de candidatas (ver `perfilDaFicha`): o perfil sai do PAPEL.
  const perfil = perfilDaFicha(meta, entity.entity_kind);

  return {
    dados: { cadastro, email, endereco, nome: entity.display_name ?? "", telefone },
    imobiliariaUuid: texto(meta.imobiliariaId),
    perfil,
  };
}

// ── CONTRATO SOCIAL (anexo da PJ) ─────────────────────────────────────────

// Categoria do documento no Apolo. É a mesma string que a etapa Documentos do wizard grava
// (lib/apolo/cadastro-upload.ts, rótulo "Contrato social").
const CATEGORIA_CONTRATO_SOCIAL = "contrato_social";

function emMB(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export type ContratoSocialParaC2x = {
  anexo: AnexoC2x | null;
  documentoId: string | null;
  // Por que NÃO deu para anexar. Nulo quando o anexo foi montado.
  motivo: string | null;
};

// O ARQUIVO do contrato social da empresa, pronto para virar a parte de arquivo do multipart. É o
// MESMO PDF que o corretor anexa na etapa Documentos do cadastro PJ (regra do Lucas em 05/08:
// "pode subir o que estamos coletando"), lido do bucket privado com service role.
//
// ⚠️ NUNCA LANÇA E NUNCA BLOQUEIA O CADASTRO. Devolve `motivo` quando não dá para anexar, e quem
// chama envia a ficha assim mesmo e grava o motivo em `apolo_c2x_sync`. Um anexo que não foi não
// pode impedir a tentativa — e também não pode sumir em silêncio.
export async function lerContratoSocialParaC2x(
  client: AdminClient,
  entityId: string,
): Promise<ContratoSocialParaC2x> {
  const vazio = { anexo: null, documentoId: null };

  const { data, error } = await client
    .from("apolo_documents")
    .select("id, storage_bucket, storage_path, metadata")
    .eq("entity_id", entityId)
    .eq("document_type", CATEGORIA_CONTRATO_SOCIAL)
    .order("created_at", { ascending: false })
    .limit(1);

  if (error) {
    return { ...vazio, motivo: `falha ao consultar o documento no Apolo (${error.message}).` };
  }

  const doc = (data ?? [])[0] as
    | {
        id: string;
        metadata: { fileName?: string; sizeBytes?: number } | null;
        storage_bucket: string | null;
        storage_path: string | null;
      }
    | undefined;

  if (!doc) {
    return {
      ...vazio,
      motivo: "nenhum documento da categoria \"Contrato social\" foi anexado nesta entidade.",
    };
  }

  const caminho = texto(doc.storage_path);
  if (!caminho) {
    return { anexo: null, documentoId: doc.id, motivo: "a linha existe no Apolo, mas sem arquivo." };
  }

  // `lerDocumentoDoStorage` lê SEMPRE do bucket `apolo-documents`. Linha gravada em outro bucket
  // seria baixada do lugar errado (ou não seria baixada) — melhor recusar dizendo o porquê.
  const bucket = texto(doc.storage_bucket) ?? APOLO_DOCS_BUCKET;
  if (bucket !== APOLO_DOCS_BUCKET) {
    return {
      anexo: null,
      documentoId: doc.id,
      motivo: `o arquivo está no bucket "${bucket}", e o envio ao C2X só lê "${APOLO_DOCS_BUCKET}".`,
    };
  }

  // Tamanho declarado na linha: corta ANTES de baixar, para arquivo grande não passar pela memória
  // da function à toa. A conferência que vale é a dos bytes reais, logo abaixo.
  const meta = doc.metadata ?? {};
  const declarado = typeof meta.sizeBytes === "number" ? meta.sizeBytes : null;
  if (declarado != null && declarado > C2X_ANEXO_MAX_BYTES) {
    return {
      anexo: null,
      documentoId: doc.id,
      motivo: `o arquivo tem ${emMB(declarado)} e o limite do envio ao C2X é ${emMB(C2X_ANEXO_MAX_BYTES)}.`,
    };
  }

  const bytes = await lerDocumentoDoStorage(client, caminho);
  if (!bytes) {
    return {
      anexo: null,
      documentoId: doc.id,
      motivo: "não foi possível baixar o arquivo do armazenamento.",
    };
  }
  if (bytes.byteLength > C2X_ANEXO_MAX_BYTES) {
    return {
      anexo: null,
      documentoId: doc.id,
      motivo: `o arquivo tem ${emMB(bytes.byteLength)} e o limite do envio ao C2X é ${emMB(C2X_ANEXO_MAX_BYTES)}.`,
    };
  }

  const nome = texto(meta.fileName) ?? caminho.split("/").pop() ?? "contrato-social.pdf";
  return {
    anexo: {
      bytes,
      campo: C2X_CAMPO_CONTRATO_SOCIAL,
      contentType: guessMime(nome),
      fileName: nome,
    },
    documentoId: doc.id,
    motivo: null,
  };
}

// ── ENVIO DE UMA ENTIDADE ─────────────────────────────────────────────────

// A mesma frase nos dois lugares que a mostram (o item do lote e o retorno do envio unitário),
// para elas nunca divergirem.
const AVISO_SEM_CONFIRMACAO =
  "A API aceitou, mas o cadastro não apareceu no C2X. Confira o ambiente de destino.";

export type ResultadoEnvio = {
  c2xUserId?: number | null;
  entityId: string;
  erro?: string;
  // "sem_confirmacao" = a API aceitou, mas o usuário não apareceu no banco do C2X. Quase sempre
  // significa que a escrita foi para outro ambiente.
  // "ja_no_c2x"      = a pessoa JÁ ESTAVA no C2X antes de a gente falar com a API; NADA foi
  //                    enviado e o id foi reconciliado na nossa fila. Não é sucesso (não criamos
  //                    nada) e não é erro (está tudo certo) — é um terceiro desfecho.
  status: "resolvido" | "duplicado" | "erro" | "sem_confirmacao" | "ja_no_c2x";
};

// JÁ ESTAVA LÁ: registra o achado, sem enviar nada.
//
// É o desfecho das 132 pessoas que estão no C2X e são invisíveis para a nossa fila (entraram por
// importação antiga ou cadastro manual lá dentro). Hoje o card acusa "não subiu" para elas e, no
// clique, a API responde "E-mail de acesso já cadastrado" — que é a API dizendo "essa pessoa já
// existe" e a tela lendo como erro de cadastro. Foram 7 das 10 falhas do envio em massa de 08/08.
//
// Grava nos DOIS lugares de propósito:
//   • `apolo_c2x_sync` — o livro-razão durável. Sobrevive ao sync do C2X, que faz upsert em
//     `apolo_entities` e SUBSTITUI o metadata inteiro (lição da migration 0057).
//   • `metadata` da entidade — MERGE, nunca substituição. É o que faz o selo do card apagar na
//     hora (`jaEstaNoC2x`, em c2x-alerta-board.ts) e o que tira a ficha da fila de candidatas.
//
// `c2xConfirmado: true` porque a prova veio do BANCO DE PRODUÇÃO do C2X, não da resposta da API —
// é a mesma prova que o envio normal usa para se declarar confirmado, e desarma o caso de quem
// ficou marcado como não confirmado no incidente do ambiente de teste mas está em produção.
export async function reconciliarJaNoC2x(
  client: AdminClient,
  input: { c2xUserId: number; documento: string | null; entityId: string; perfil: PerfilC2x },
): Promise<ResultadoEnvio> {
  const agora = new Date().toISOString();

  // ⚠️ `error` conferido SEMPRE: upsert do PostgREST falha em silêncio quando bate em NOT NULL sem
  // default. `perfil` é NOT NULL nesta tabela e por isso entra explícito.
  const { error: erroFila } = await client.from("apolo_c2x_sync").upsert(
    {
      atualizado_em: agora,
      c2x_user_id: input.c2xUserId,
      documento: input.documento,
      entity_id: input.entityId,
      // Um erro antigo (a recusa "já cadastrado", por exemplo) tem que sair: a pendência acabou.
      erro: null,
      perfil: input.perfil,
      resposta: {
        _origem: "reconciliacao",
        c2x_user_id: input.c2xUserId,
        // Fica registrado que NÃO houve POST: o id veio de leitura no banco de produção.
        prova: "users.id lido no banco de produção do C2X pelo documento",
        quando: agora,
      },
      status: "ja_no_c2x",
    },
    { onConflict: "entity_id" },
  );
  if (erroFila) {
    return {
      entityId: input.entityId,
      erro: `Esta pessoa JÁ EXISTE no C2X (id ${input.c2xUserId}) e nada foi enviado, mas não consegui gravar isso na fila: ${erroFila.message}`,
      status: "erro",
    };
  }

  const { data } = await client
    .from("apolo_entities")
    .select("metadata")
    .eq("id", input.entityId)
    .single();
  const metaAtual = ((data as { metadata: Record<string, unknown> | null } | null)?.metadata ??
    {}) as Record<string, unknown>;
  await client
    .from("apolo_entities")
    .update({
      metadata: {
        ...metaAtual,
        c2xConfirmado: true,
        // Marca que a pessoa está lá SEM ter sido criada por nós. Sem isto, um dia alguém lê
        // `c2xSynced: true` e conclui que este envio saiu daqui.
        c2xReconciliado: true,
        c2xSynced: true,
        c2xUserId: input.c2xUserId,
      },
    })
    .eq("id", input.entityId);

  return { c2xUserId: input.c2xUserId, entityId: input.entityId, status: "ja_no_c2x" };
}

// ⚠️ TRAVA DE ENVIO EM VOO — MORA AQUI, NÃO NA ROTA.
//
// O endpoint de escrita do C2X é o genérico `POST /api/v1/users`: cada chamada CRIA DE NOVO, sem
// checar documento e sem desfazer. A única proteção contra mandar a mesma ficha duas vezes era o
// filtro de candidatas do lote (`metadata.c2xSynced !== true`) — e esse carimbo só é escrito
// DEPOIS que o POST volta. Enquanto o primeiro envio está viajando, a ficha continua candidata.
//
// A checagem NÃO pode viver só na rota do botão, porque o botão não é o único disparador de envio
// REAL. Os dois automáticos chamam `processarLoteC2x` direto, sem passar por rota nenhuma:
//   • esteira.ts (mudança de etapa para "credenciado") — esperado;
//   • prevenda-fluxo.ts (PIX da pré-venda confirmado) — BEST-EFFORT COM TETO DE 8s: estourando o
//     teto ele PARA DE ESPERAR e "o envio segue em segundo plano".
// Ou seja: existe envio real em voo que ninguém está esperando. Uma trava só na rota deixa passar
// exatamente a colisão mais provável (clique no card enquanto o envio do PIX ainda viaja) e a
// colisão entre os dois automáticos.
//
// Aqui a fila `apolo_c2x_sync` deixa de ser só rastro e vira a trava: a linha vira 'pendente'
// ANTES do POST e só sai desse estado com a resposta. Linha 'pendente' recente = tem envio
// acontecendo agora. A checagem fica coladinha no upsert que reivindica a linha, então a janela
// entre olhar e reivindicar é um round-trip — e não o `montarDados` + leitura do contrato social
// no Storage inteiros, que é a janela de quem checa lá na entrada da rota.
//
// A JANELA: nenhuma rota de envio passa de 60s (`maxDuration`) e o best-effort do PIX corta em 8s.
// Acima de 3 minutos a linha é resto de execução que morreu, e o envio volta a ser permitido —
// nesse caso não dá para saber se o POST chegou a landar, que é o mesmo risco que o lote já corre.
export const ENVIO_EM_VOO_MS = 3 * 60 * 1000;

export const MSG_ENVIO_EM_VOO =
  "Já existe um envio desta ficha para o C2X em andamento (a fila está em 'pendente'). " +
  "Espere terminar e recarregue: mandar de novo agora criaria um cadastro DUPLICADO no C2X, " +
  "que não tem desfazer.";

// Tem envio REAL viajando para esta entidade agora? Lê a fila `apolo_c2x_sync` — nunca o C2X.
export async function envioEmVooC2x(
  client: AdminClient,
  entityId: string,
): Promise<boolean> {
  const { data } = await client
    .from("apolo_c2x_sync")
    .select("status, atualizado_em")
    .eq("entity_id", entityId)
    .maybeSingle();

  const linha = data as { atualizado_em: string | null; status: string | null } | null;
  if (!linha || linha.status !== "pendente") return false;

  const quando = linha.atualizado_em ? Date.parse(linha.atualizado_em) : Number.NaN;
  // Data ilegível com status 'pendente': o seguro é tratar como em voo e não mandar de novo.
  if (Number.isNaN(quando)) return true;
  return Date.now() - quando < ENVIO_EM_VOO_MS;
}

// Envia UMA entidade para o C2X e reconcilia o id. `vinculedById` (id da imobiliária no C2X) é
// obrigatório para cliente; quem chama o lote resolve a imobiliária ANTES e passa aqui.
export async function enviarEntidadeParaC2x(input: {
  client?: AdminClient;
  // A leitura em bloco de "quem já existe no C2X", quando quem chama já a fez (lote). Evita uma
  // consulta ao MySQL por entidade. Ausente = a checagem consulta este documento sozinha.
  consultaC2x?: ConsultaC2xPorDocumento;
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

  // Papel sem perfil no C2X (corretor, fornecedor, parceiro, colaborador) ou papel desconhecido:
  // NÃO envia. Antes daqui saía "imobiliária" para qualquer PJ, e o POST genérico cria de novo a
  // cada chamada — não existe desfazer para um cadastro criado com o perfil errado.
  if (!perfil) {
    return {
      entityId: input.entityId,
      erro: "Papel da entidade não sobe para o C2X (ou não foi possível determiná-lo).",
      status: "erro",
    };
  }

  // 🔴 TRAVA ANTI-DUPLICADO — A CHECAGEM MORA AQUI PORQUE AQUI É O FUNIL.
  //
  // Todo envio REAL passa por esta função: o lote, o botão do card (que chama o lote com
  // `apenasEntityId`), o gancho de credenciar e o do PIX da pré-venda. Antes, a pergunta "essa
  // pessoa já existe no C2X?" só era feita DE FORA, no scripts/apolo/subir-cads-pendentes.mjs —
  // para o botão e para os automáticos, quem não tinha o carimbo `c2xSynced` era ficha nova. E é
  // assim que nasce cliente duplicado num sistema de CONTRATOS: o `POST /api/v1/users` é genérico,
  // cria de novo a cada chamada e NÃO TEM DESFAZER.
  //
  // ⚠️ ANTES do gate da imobiliária de propósito: quem já está no C2X não precisa de
  // `vinculed_by_id` para nada — não vamos criar ninguém. Deixar o gate na frente devolveria
  // "Cliente sem imobiliária vinculada" para gente que está lá desde sempre.
  const situacao = await situacaoNoC2x(documento, input.consultaC2x);
  if (situacao.situacao === "existe") {
    return reconciliarJaNoC2x(client, {
      c2xUserId: situacao.c2xUserId,
      documento,
      entityId: input.entityId,
      perfil,
    });
  }
  if (situacao.situacao === "indisponivel") {
    const erro = msgC2xNaoConferido(situacao.motivo);
    // Fica no log do servidor para o caso dos disparadores AUTOMÁTICOS (credenciar, PIX pago), em
    // que ninguém está olhando uma tela. A fila NÃO é tocada: ela é o livro-razão dos ENVIOS, e
    // aqui nenhum envio começou — carimbar 'erro' em quem nunca foi tentado apagaria o sinal de
    // "nunca_enviado" do board por causa de uma queda de rede.
    console.error(`[c2x] envio adiado (${input.entityId}): ${erro}`);
    return { entityId: input.entityId, erro, status: "erro" };
  }

  if (perfil === "cliente" && !input.vinculedById) {
    return {
      entityId: input.entityId,
      erro: "Cliente sem imobiliária vinculada no C2X (vinculed_by_id).",
      status: "erro",
    };
  }

  // O montador certo por perfil. `montarPayload` já separa cliente / imobiliária / incorporador,
  // e dentro do cliente separa PF de PJ pelo `isCompany` da ficha.
  const payload = montarPayload(perfil, dados, { vinculedById: input.vinculedById });

  // CONTRATO SOCIAL: só o CLIENTE PJ. A PF não tem esse campo no C2X e a imobiliária tem fluxo
  // próprio — nenhum dos dois é tocado aqui (o `anexo` fica nulo e o corpo continua sendo o JSON
  // de sempre).
  const ehClientePj = perfil === "cliente" && dados.cadastro.isCompany;
  const contrato: ContratoSocialParaC2x = ehClientePj
    ? await lerContratoSocialParaC2x(client, input.entityId)
    : { anexo: null, documentoId: null, motivo: null };

  // O motivo de o anexo não ter ido gruda em QUALQUER erro gravado na fila — inclusive quando o
  // cadastro deu certo. Anexo que falhou nunca é engolido.
  const juntarMotivo = (base: string | null): string | null => {
    const partes = [
      base,
      contrato.motivo ? `Contrato social NÃO anexado: ${contrato.motivo}` : null,
    ].filter((p): p is string => Boolean(p));
    return partes.length > 0 ? partes.join(" | ") : null;
  };

  // ÚLTIMA PARADA ANTES DO POST: já tem envio desta ficha viajando? Aqui, e não lá na entrada,
  // porque o que separa esta linha do upsert que reivindica a fila é um round-trip — enquanto na
  // entrada da rota o caminho até aqui inclui MySQL do C2X, `montarDados` e a leitura do contrato
  // social no Storage, tempo de sobra para um segundo disparo passar pela mesma checagem.
  if (await envioEmVooC2x(client, input.entityId)) {
    return { entityId: input.entityId, erro: MSG_ENVIO_EM_VOO, status: "erro" };
  }

  // Grava a fila como pendente ANTES de enviar: se o processo cair no meio, fica o rastro.
  await client.from("apolo_c2x_sync").upsert(
    {
      atualizado_em: new Date().toISOString(),
      documento,
      entity_id: input.entityId,
      perfil,
      requisicao: {
        ...payloadParaAuditoria(payload),
        // Chave de AUDITORIA (o "_" marca que não é campo do payload): o arquivo não cabe aqui,
        // mas o que foi anexado (ou por que não foi) tem que ficar registrado.
        ...(ehClientePj
          ? {
              _anexo_contrato_social: contrato.anexo
                ? {
                    bytes: contrato.anexo.bytes.byteLength,
                    campo: contrato.anexo.campo,
                    documentoId: contrato.documentoId,
                    nome: contrato.anexo.fileName,
                  }
                : { erro: contrato.motivo },
            }
          : {}),
      },
      status: "pendente",
    },
    { onConflict: "entity_id" },
  );

  const resposta = await enviarUsuarioC2x(payload, contrato.anexo);

  // Sucesso OU duplicado: em ambos o usuário existe no C2X — lemos o id pelo documento.
  const criouOuExiste =
    resposta.status === "success" ||
    (resposta.status === "failed" && resposta.duplicado);

  if (!criouOuExiste) {
    const motivoApi =
      resposta.status === "failed"
        ? resposta.mensagem
        : resposta.status === "erro_transporte"
          ? resposta.detalhe
          : "Falha desconhecida.";
    // Com o anexo faltando, o "não pode ficar em branco" do C2X passa a vir acompanhado do motivo
    // real — senão a recusa parece inexplicável e manda o time caçar env errada.
    const erro = juntarMotivo(motivoApi) ?? motivoApi;
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
      erro: juntarMotivo(
        confirmado
          ? null
          : "A API respondeu sucesso, mas o usuário não foi encontrado no banco do C2X. Conferir para qual ambiente C2X_WRITE_API_URL está apontando.",
      ),
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

  // O aviso do anexo volta MESMO quando o cadastro subiu: a tela precisa mostrar que a ficha foi,
  // mas sem o contrato social. O status continua "resolvido" — o cadastro existe no C2X.
  return {
    c2xUserId,
    entityId: input.entityId,
    erro: juntarMotivo(confirmado ? null : AVISO_SEM_CONFIRMACAO) ?? undefined,
    status,
  };
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

// Campos OBRIGATÓRIOS do C2X que podem faltar numa CAD de PESSOA FÍSICA. Devolve os que faltam
// (rótulo amigável) — é a lista de trabalho do time. CPF/email/telefone não entram (100%
// preenchidos hoje). Sexo e profissão também não: são opcionais no C2X.
// A PJ tem lista PRÓPRIA (`faltantesDaEmpresa`): nenhum destes campos existe numa ficha de empresa.
const OBRIGATORIOS: { campo: string; rotulo: string }[] = [
  { campo: "estadoCivilId", rotulo: "Estado civil" },
  { campo: "escolaridadeId", rotulo: "Escolaridade" },
  { campo: "rendaId", rotulo: "Renda" },
  { campo: "naturalidade", rotulo: "Naturalidade" },
  { campo: "nacionalidade", rotulo: "Nacionalidade" },
  { campo: "nomeMae", rotulo: "Nome da mãe" },
  { campo: "dataNascimento", rotulo: "Nascimento" },
];

// A ficha de EMPRESA para o diagnóstico da PJ. `cadastro` é o `metadata.cadastro` cru (é lá que
// moram porte, data de abertura e sócios — a cascata de campos pessoais não os carrega).
export type EmpresaParaDiagnostico = {
  cadastro: Record<string, unknown>;
  cnpj: string | null;
  razaoSocial: string | null;
};

// Obrigatórios de uma PJ. São OUTROS: nenhum campo pessoal existe na ficha de empresa (a da Vovó
// Braga tem só cnae, porte, atividade, dataAbertura, natureza jurídica e situação cadastral).
// Sem esta lista própria, TODA PJ cairia em "faltando Estado civil, Escolaridade, Renda..." e o
// silêncio só mudaria de lugar: sairia do filtro e entraria no diagnóstico.
//
// Porte e data de abertura entram porque os 80 clientes PJ que já existem no C2X têm os dois
// preenchidos. O representante legal entra porque é ele quem assina o contrato.
function faltantesDaEmpresa(empresa: EmpresaParaDiagnostico): string[] {
  const faltam: string[] = [];
  if (!soDigitos(empresa.cnpj)) faltam.push("CNPJ");
  if (!texto(empresa.razaoSocial)) faltam.push("Razão social");
  if (!texto(empresa.cadastro.porte)) faltam.push("Porte");
  if (!texto(empresa.cadastro.dataAbertura)) faltam.push("Data de abertura");

  const socios = Array.isArray(empresa.cadastro.socios)
    ? (empresa.cadastro.socios as Record<string, unknown>[])
    : [];
  const rep = socios.find((s) => s?.representanteLegal === true) ?? null;
  if (!rep || !texto(rep.nome)) faltam.push("Representante legal");
  else if (!soDigitos(texto(rep.cpf))) faltam.push("CPF do representante legal");

  return faltam;
}

// `empresa` presente = a ficha é PJ e o diagnóstico usa a lista de empresa, não a de pessoa.
export function diagnosticarCadastro(
  cadMeta: Record<string, unknown>,
  temImobiliaria: boolean,
  empresa?: EmpresaParaDiagnostico | null,
): string[] {
  const faltam: string[] = [];
  if (!temImobiliaria) faltam.push("Imobiliária");
  if (empresa) return [...faltam, ...faltantesDaEmpresa(empresa)];
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
  // "ja_no_c2x" = a pessoa JÁ ESTAVA no C2X antes de qualquer envio nosso. NADA foi enviado.
  status:
    | "pronta"
    | "faltando"
    | "conferir"
    | "enviada"
    | "duplicada"
    | "erro"
    | "sem_confirmacao"
    | "ja_no_c2x";
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
    // Já estavam no C2X antes de qualquer envio nosso. NADA foi enviado por elas.
    jaNoC2x: number;
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
  // MODO RECONCILIAÇÃO: grava quem JÁ ESTÁ no C2X e não envia NINGUÉM. É a execução segura do
  // conserto das fichas invisíveis (as que estão no legado sem linha na nossa fila): não existe
  // caminho, neste modo, que chegue a um POST. O ensaio correspondente é `dryRun: true`, que
  // mostra quantas seriam reconciliadas sem gravar nada.
  apenasReconciliar?: boolean;
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
        jaNoC2x: 0,
        prontas: 0,
        semConfirmacao: 0,
        total: 0,
      },
    };
  }

  // Candidatas: CAD nascida no Apolo, com PAPEL DE CLIENTE, com cadastro, ainda não sincronizada.
  // Com `apenasEntityId`, o mesmo caminho serve para UMA ficha só — é assim que o envio
  // automático ao credenciar reusa a montagem, o diagnóstico e as travas daqui, em vez de manter
  // uma segunda cópia da regra que envelheceria em separado.
  //
  // ⚠️ O RECORTE DEIXOU DE SER "PF" E PASSOU A SER "PAPEL DE CLIENTE" (`perfilDaFicha`). Trocar
  // `entity_kind = 'pf'` por nada arrastaria imobiliárias e outros papéis para uma fila que monta
  // payload de CLIENTE. Com o papel:
  //   • entram os 6 clientes PJ credenciados que estavam mudos (nenhuma linha em apolo_c2x_sync,
  //     porque a linha só nasce no momento do envio);
  //   • saem os 15 corretores PF nascidos no Apolo, que hoje só não sobem como cliente porque não
  //     têm imobiliária vinculada — com `tentarTodas` ligado eles subiriam (o corretor mora só no
  //     Apolo, decisão do Lucas em 28/jul);
  //   • fica de fora a 1 imobiliária nascida no Apolo, que tem fluxo próprio.
  // Os clientes PF (o fluxo principal) continuam entrando exatamente como antes.
  let consulta = client
    .from("apolo_entities")
    .select("id, display_name, legal_name, document_masked, entity_kind, metadata")
    .eq("metadata->>source", "apolo");
  if (input.apenasEntityId) consulta = consulta.eq("id", input.apenasEntityId);
  const { data: entidades } = await consulta.limit(input.limit ?? 1000);

  const candidatas = ((entidades ?? []) as {
    display_name: string | null;
    document_masked: string | null;
    entity_kind: string | null;
    id: string;
    legal_name: string | null;
    metadata: Record<string, unknown> | null;
  }[]).filter((e) => {
    const meta = e.metadata ?? {};
    if (perfilDaFicha(meta, e.entity_kind) !== "cliente") return false;
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

  // 🔴 QUEM DESTAS JÁ ESTÁ NO C2X — UMA CONSULTA (por bloco de 200) PARA O LOTE INTEIRO.
  //
  // A trava anti-duplicado tem que valer para todo mundo, mas perguntar de um em um faria o lote
  // abrir dezenas de conexões no MySQL de PRODUÇÃO do legado. Aqui a resposta vem de uma vez e
  // desce para `enviarEntidadeParaC2x`, que a reusa em vez de reconsultar.
  //
  // O documento é o `document_masked` da entidade, que é EXATAMENTE o que vira `cpf`/`cnpj` no
  // payload (ver `montarDados`): a pergunta feita aqui e a que o funil refaz são sobre o mesmo
  // documento, então uma nunca diz o contrário da outra.
  const consultaC2x = await consultarDocumentosNoC2x(
    candidatas.map((ent) => ent.document_masked),
  );

  // Envio REAL só quando não é ensaio e não é o modo "só reconciliar".
  const podeEnviar = !input.dryRun && !input.apenasReconciliar;
  // O ensaio não grava NADA, nem na nossa tabela: "ensaio" tem que significar a mesma coisa em
  // todo lugar, senão o operador que roda o diagnóstico para olhar acaba mudando o estado.
  const podeGravarReconciliacao = !input.dryRun;

  const cacheImob = new Map<string, number | null>();
  const itens: ItemLote[] = [];
  let enviados = 0;

  for (const ent of candidatas) {
    const nome = ent.display_name ?? "";

    // 🔴 PRIMEIRA PERGUNTA DO LOOP: essa pessoa já está no C2X?
    //
    // Antes do diagnóstico de campos de propósito. Quem já está lá não vai ser criada, então
    // cobrar Escolaridade ou Imobiliária dela é cobrar para um envio que não vai acontecer — e era
    // isso que prendia as fichas invisíveis em "faltando", onde o botão do card nunca chegaria à
    // reconciliação. O funil (`enviarEntidadeParaC2x`) refaz a checagem para quem passa daqui:
    // esta é a saída antecipada, aquela é a trava.
    const jaNoC2xId = consultaC2x.ok
      ? (consultaC2x.ids.get(soDigitos(ent.document_masked ?? "")) ?? null)
      : null;
    if (jaNoC2xId != null) {
      const perfilDaEntidade = perfilDaFicha(ent.metadata ?? {}, ent.entity_kind);
      if (podeGravarReconciliacao && perfilDaEntidade) {
        const r = await reconciliarJaNoC2x(client, {
          c2xUserId: jaNoC2xId,
          documento: ent.document_masked,
          entityId: ent.id,
          perfil: perfilDaEntidade,
        });
        itens.push({
          entityId: ent.id,
          erro: r.erro,
          faltantes: [],
          nome,
          status: r.status === "ja_no_c2x" ? "ja_no_c2x" : "erro",
        });
      } else {
        itens.push({ entityId: ent.id, faltantes: [], nome, status: "ja_no_c2x" });
      }
      continue;
    }

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
    // PJ tem lista de obrigatórios PRÓPRIA (CNPJ, razão social, porte, abertura, representante
    // legal). Sem isto ela cairia em "faltando Estado civil / Escolaridade / Renda...", campos
    // que não existem em ficha de empresa, e o silêncio de hoje só mudaria de lugar.
    const ehPj = ent.entity_kind === "pj";
    const faltantes = diagnosticarCadastro(
      cadMeta,
      vinculedById != null,
      ehPj
        ? {
            cadastro: ((ent.metadata ?? {}).cadastro ?? {}) as Record<string, unknown>,
            cnpj: ent.document_masked,
            razaoSocial: ent.legal_name,
          }
        : null,
    );

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
    if (!podeEnviar || (input.maxEnvios != null && enviados >= input.maxEnvios)) {
      itens.push({ entityId: ent.id, faltantes: [], nome, status: "pronta" });
      continue;
    }
    // 🔴 NÃO DEU PARA PERGUNTAR AO C2X: ninguém sobe nesta rodada.
    //
    // Sem a resposta do legado não dá para afirmar que esta pessoa não está lá, e enviar no escuro
    // é o desfecho caro (cadastro duplicado, sem desfazer). O corte é AQUI, e não dentro do funil,
    // só para não bater no MySQL caído uma vez por ficha — o funil recusaria igual.
    if (!consultaC2x.ok) {
      itens.push({
        entityId: ent.id,
        erro: msgC2xNaoConferido(consultaC2x.motivo),
        faltantes: [],
        nome,
        status: "erro",
      });
      continue;
    }
    enviados += 1;

    const r = await enviarEntidadeParaC2x({
      client,
      consultaC2x,
      entityId: ent.id,
      ficha,
      vinculedById: vinculedById ?? undefined,
    });
    itens.push({
      entityId: ent.id,
      erro: r.erro ?? (r.status === "sem_confirmacao" ? AVISO_SEM_CONFIRMACAO : undefined),
      faltantes: [],
      nome,
      status:
        r.status === "resolvido"
          ? "enviada"
          : r.status === "duplicado"
            ? "duplicada"
            : r.status === "sem_confirmacao"
              ? "sem_confirmacao"
              : // A trava do funil pegou o que a saída antecipada do loop não pegou (documento da
                // ficha diferente do `document_masked`, por exemplo). Nada foi enviado.
                r.status === "ja_no_c2x"
                ? "ja_no_c2x"
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
    jaNoC2x: itens.filter((i) => i.status === "ja_no_c2x").length,
    prontas: itens.filter((i) => i.status === "pronta").length,
    total: itens.length,
  };
  return { hostDestino: hostDeDestino(), itens, resumo };
}

// Só o HOST de `C2X_WRITE_API_URL` — nunca a chave. Serve para a tela dizer, antes do clique, para
// qual C2X os cadastros vão. Exportado porque a rota do botão do card também precisa carimbar o
// destino nas respostas que ela devolve SEM passar pelo lote (envio já em voo, por exemplo): duas
// leituras da mesma env em lugares diferentes acabariam divergindo.
export function hostDeDestino(): string {
  const base = process.env.C2X_WRITE_API_URL?.trim();
  if (!base) return "não configurado";
  try {
    return new URL(base).host;
  } catch {
    return "inválido";
  }
}
