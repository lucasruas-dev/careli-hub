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
import { confereNomeC2x, semNomeNoC2x } from "./c2x-nome-confere";
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
  motivoDaRecusaC2x,
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
// UM cadastro do C2X que carrega este documento. Sempre em lista: no legado, "o usuário do CPF"
// não é uma coisa só (ver o comentário de `candidatos`).
export type CandidatoC2x = { id: number; nome: string };

export type ConsultaC2xPorDocumento =
  | {
      // 🔴 documento (só dígitos) -> TODOS os usuários do C2X com aquele documento, não só um.
      //
      // Guardar um só era a versão perigosa desta leitura, e a medição de 08/08 mostra por quê: no
      // C2X existem 27 documentos com mais de um `users.id` (90 usuários no total), e o critério
      // "vence o MAIOR id" acertava em 6 dos 12 grupos em que dá para saber qual é o certo —
      // moeda ao ar, num sistema de CONTRATOS. Um caso já está gravado errado na fila hoje: RAFAEL
      // GONCALVES LEITE (13261969601) foi ligado ao 4776, que tem ZERO acquisition_requests,
      // enquanto o pedido dele está no 4068. E o nome não pega isso: os dois cadastros se chamam
      // igual, então a conferência aprova o par errado com toda a razão do mundo.
      //
      // Com a lista inteira aqui, quem decide o que fazer com a ambiguidade é o chamador — e a
      // resposta certa é NÃO DECIDIR SOZINHO (ver `situacaoNoC2x`).
      candidatos: Map<string, CandidatoC2x[]>;
      // Os documentos que a consulta REALMENTE cobriu (só dígitos). Quem não está aqui não foi
      // perguntado, e "não perguntei" nunca pode ser lido como "não existe".
      consultados: Set<string>;
      // documento (só dígitos) -> users.id no C2X. Havendo mais de um, vence o MAIOR id. MANTIDO
      // para quem só precisa de um número e não tem decisão de identidade a tomar (a resolução da
      // imobiliária, `lerIdC2xPorDocumento`) — nunca para reconciliar cliente.
      ids: Map<string, number>;
      // documento (só dígitos) -> users.name DO MESMO id que está em `ids`. É a segunda testemunha
      // do casamento: o documento diz QUAL cadastro, o nome diz se é a MESMA PESSOA. Sem ele, um
      // CPF digitado errado no Apolo ligaria a CAD ao cliente errado, calado (ver c2x-nome-confere).
      nomes: Map<string, string>;
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
  if (limpos.length === 0) {
    return {
      candidatos: new Map(),
      consultados: new Set(),
      ids: new Map(),
      nomes: new Map(),
      ok: true,
    };
  }

  const poolResult = getHadesDbPool();
  if (!poolResult.ok) {
    return { motivo: "o banco do C2X não está configurado ou não respondeu", ok: false };
  }

  const semMascara = (coluna: string) =>
    `REPLACE(REPLACE(REPLACE(REPLACE(${coluna},'.',''),'-',''),'/',''),' ','')`;

  const candidatos = new Map<string, CandidatoC2x[]>();
  const ids = new Map<string, number>();
  const nomes = new Map<string, string>();
  try {
    for (let i = 0; i < limpos.length; i += BLOCO_DOCUMENTOS_C2X) {
      const bloco = limpos.slice(i, i + BLOCO_DOCUMENTOS_C2X);
      const marcadores = bloco.map(() => "?").join(",");
      // `name` vem junto na MESMA consulta: perguntar o nome depois seria uma segunda ida ao MySQL
      // de produção por pessoa — exatamente o N+1 que o bloco de 200 existe para evitar.
      const [rows] = await poolResult.pool.query<RowDataPacket[]>(
        `SELECT id, name, ${semMascara("cpf")} AS doc FROM users
           WHERE ${semMascara("cpf")} IN (${marcadores})
         UNION ALL
         SELECT id, name, ${semMascara("cnpj")} AS doc FROM users
           WHERE ${semMascara("cnpj")} IN (${marcadores})`,
        [...bloco, ...bloco],
      );
      for (const linha of rows) {
        const doc = String(linha.doc ?? "");
        const id = typeof linha.id === "number" ? linha.id : Number(linha.id);
        if (!doc || !Number.isFinite(id)) continue;
        const nome = String(linha.name ?? "").trim();

        // A LISTA INTEIRA, sempre. `UNION ALL` de cpf e cnpj pode trazer o mesmo `users.id` duas
        // vezes (10 usuários do C2X têm os DOIS campos preenchidos), e um id repetido viraria
        // "documento ambíguo" onde há um cadastro só — falso alarme na cara do operador.
        const lista = candidatos.get(doc);
        if (!lista) candidatos.set(doc, [{ id, nome }]);
        else if (!lista.some((c) => c.id === id)) lista.push({ id, nome });

        const atual = ids.get(doc);
        if (atual != null && id <= atual) continue;
        ids.set(doc, id);
        // O nome ANDA COM O ID: trocou o id vencedor, troca o nome. Guardar o nome de um cadastro e
        // o id de outro seria a pior versão possível desta leitura — a conferência aprovaria o par
        // errado.
        nomes.set(doc, String(linha.name ?? "").trim());
      }
    }
  } catch (erro) {
    // Falha de consulta é `ok:false`, NUNCA "não achei". Quem chama decide o que fazer — e a
    // decisão desta casa é não enviar.
    return { motivo: erro instanceof Error ? erro.message : String(erro), ok: false };
  }

  return { candidatos, consultados: new Set(limpos), ids, nomes, ok: true };
}

// A situação de UM documento, reusando a consulta em bloco quando ela já cobriu este documento.
// Sem cache (ou com um documento que o bloco não cobriu) faz a consulta unitária.
export type SituacaoNoC2x =
  // 🔴 O DOCUMENTO ACHOU MAIS DE UM CADASTRO NO C2X. Não é "existe": é "existem", e escolher um
  // deles é apostar. Ver o comentário de `candidatos` em `ConsultaC2xPorDocumento` para a medição
  // que trouxe este caso à tona (moeda ao ar em 6 de 12 grupos decidíveis, 1 já gravado errado).
  | { candidatos: CandidatoC2x[]; situacao: "ambiguo" }
  // `nomeNoC2x` = o `users.name` DESSE id. Vem junto porque quem recebe "existe" tem uma decisão a
  // tomar (reconciliar) que não pode ser tomada só com o documento.
  | { c2xUserId: number; nomeNoC2x: string | null; situacao: "existe" }
  // ⚠️ DUAS COISAS DIFERENTES caem em "indisponivel", e quem grava a recusa precisa separá-las:
  // `semDocumento` = a FICHA não tem CPF/CNPJ (o conserto é na ficha); sem ele, foi o C2X que não
  // respondeu (o conserto é esperar e tentar de novo). Antes as duas viravam a mesma frase e o
  // operador não sabia se tinha trabalho para fazer.
  | { motivo: string; semDocumento: boolean; situacao: "indisponivel" }
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
    return {
      motivo: "a ficha não tem CPF/CNPJ para conferir",
      semDocumento: true,
      situacao: "indisponivel",
    };
  }

  // A consulta em bloco veio quebrada. Não adianta reperguntar de um em um ao mesmo banco que
  // acabou de não responder: o desfecho seria o mesmo e o legado é de produção.
  if (consulta && !consulta.ok) {
    return { motivo: consulta.motivo, semDocumento: false, situacao: "indisponivel" };
  }

  if (consulta?.ok && consulta.consultados.has(doc)) return doDocumento(consulta, doc);

  const unitaria = await consultarDocumentosNoC2x([doc]);
  if (!unitaria.ok) {
    return { motivo: unitaria.motivo, semDocumento: false, situacao: "indisponivel" };
  }
  return doDocumento(unitaria, doc);
}

// A leitura de UM documento dentro de uma consulta que já deu certo. Um lugar só, porque os dois
// caminhos (cache do lote e consulta unitária) precisam contar a MESMA história — inclusive sobre a
// ambiguidade, que é justamente a parte que dá vontade de simplificar.
function doDocumento(consulta: ConsultaC2xPorDocumento, doc: string): SituacaoNoC2x {
  if (!consulta.ok) return { motivo: consulta.motivo, semDocumento: false, situacao: "indisponivel" };

  const lista = consulta.candidatos.get(doc) ?? [];
  if (lista.length === 0) return { situacao: "nao_existe" };
  // ⚠️ A ORDEM É POR ID CRESCENTE e não é enfeite: a mensagem da recusa lista os cadastros nessa
  // ordem, e no legado o id menor é o mais ANTIGO — que é onde os `acquisition_requests` costumam
  // estar quando existe um gêmeo vazio mais novo.
  if (lista.length > 1) {
    return { candidatos: [...lista].sort((a, b) => a.id - b.id), situacao: "ambiguo" };
  }

  const unico = lista[0];
  if (!unico) return { situacao: "nao_existe" };
  return { c2xUserId: unico.id, nomeNoC2x: unico.nome || null, situacao: "existe" };
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

// ── TODA RECUSA VIRA LINHA ────────────────────────────────────────────────
//
// O BURACO, medido em 08/08: no envio em massa, ~8 CADs foram recusadas com "Cliente sem
// imobiliária vinculada no C2X (vinculed_by_id)" e, na `apolo_c2x_sync`, um
// `where erro ilike '%imobili%'` devolvia ZERO linha. A frase existiu só na resposta HTTP e
// evaporou com ela: o card dessas fichas não mostrava motivo nenhum, e foi esse silêncio que fez o
// dono perguntar "por que não subiu?".
//
// A CLASSE DO PROBLEMA — e ela é maior que este caso: a linha da fila só nascia no upsert
// 'pendente', que fica IMEDIATAMENTE ANTES do POST. A tabela era o livro-razão dos POSTs, não o
// das TENTATIVAS. Toda decisão tomada antes dele (papel que não sobe, C2X que não deu para
// consultar, imobiliária sem cadastro lá, campo obrigatório em branco, divergência de identidade)
// existia só no VALOR DE RETORNO — e os quatro disparadores jogam esse retorno fora:
//   • esteira.ts (chegou em credenciado) -> `await subirParaC2xAoCredenciar(...)`, resultado ignorado;
//   • prevenda-fluxo.ts (PIX pago)       -> vira string no corpo da resposta do webhook do Asaas;
//   • botão do card                      -> aparece na tela e some no primeiro reload;
//   • lote                               -> aparece na lista e some ao sair da página.
// Erro que não vira registro não vira trabalho.
//
// A REGRA AGORA: tentativa REAL que termina em recusa GRAVA linha, com o motivo real e com a
// CLASSE (de quem é o conserto). O ENSAIO continua não gravando nada — diagnóstico que muda o
// estado é a outra metade do mesmo problema, e quem roda o dry-run está só olhando.
export type ClasseRecusaC2x =
  // Falta dado NA FICHA do cliente (o caso dos 25 "campo em branco").
  | "ficha"
  // As duas fontes discordam sobre QUEM é a pessoa (nome da mãe, nascimento).
  | "identidade"
  // ⚠️ NÃO é a ficha do cliente: é o cadastro da IMOBILIÁRIA no C2X que não existe (ou está sem
  // CNPJ no Apolo). Sem o `vinculed_by_id` dela, o cliente não pode ser criado lá.
  | "imobiliaria"
  // Não deu para falar com o C2X. Ninguém é culpado; é para tentar de novo.
  | "indisponivel"
  // O papel desta ficha não sobe para o C2X (corretor, fornecedor, parceiro, colaborador).
  | "papel";

// O PREFIXO QUE DIZ PARA ONDE IR. Quem lê o card precisa saber, na primeira linha, se o trabalho é
// na ficha do cliente, no cadastro da imobiliária ou em lugar nenhum (esperar o C2X voltar).
const PARA_ONDE_IR: Record<ClasseRecusaC2x, string> = {
  ficha: "FICHA DO CLIENTE",
  identidade: "CONFERIR A IDENTIDADE",
  imobiliaria: "CADASTRO DA IMOBILIÁRIA",
  indisponivel: "C2X NÃO RESPONDEU",
  papel: "PAPEL DA FICHA",
};

export function mensagemDeRecusaC2x(classe: ClasseRecusaC2x, motivo: string): string {
  return `${PARA_ONDE_IR[classe]}: ${motivo}`;
}

// Perfil de quem foi recusado ANTES de ter perfil definido. A coluna é NOT NULL (e sem default),
// e o upsert do PostgREST falha em SILÊNCIO quando bate nisso: sem um valor aqui, a linha da
// recusa por papel simplesmente não existiria — que é exatamente o bug que este bloco conserta.
const PERFIL_INDEFINIDO = "indefinido";

// Grava a recusa na fila e devolve a MESMA mensagem que vai para quem chamou — uma frase só, para
// a tela e a tabela nunca contarem histórias diferentes sobre a mesma tentativa.
//
// ⚠️ NÃO gravam linha, de propósito (e cada um por um motivo diferente):
//   • ENVIO EM VOO — a linha 'pendente' é do envio que está viajando AGORA; sobrescrevê-la com
//     'erro' destruiria a trava anti-duplicado e o `requisicao` do envio de verdade;
//   • ENTIDADE INEXISTENTE / SUPABASE FORA — `entity_id` é FK para `apolo_entities` e sem cliente
//     não há como escrever; não é escolha, é impossibilidade;
//   • ENSAIO (`dryRun`) e modo `apenasReconciliar` — ninguém tentou enviar nada.
export async function registrarRecusaC2x(
  client: AdminClient,
  input: {
    classe: ClasseRecusaC2x;
    documento?: string | null;
    entityId: string;
    motivo: string;
    // Null quando a recusa é justamente "esta ficha não tem perfil no C2X".
    perfil: PerfilC2x | null;
  },
): Promise<string> {
  const mensagem = mensagemDeRecusaC2x(input.classe, input.motivo);
  const agora = new Date().toISOString();

  // 🔴 A REGRA DE CIMA VALE PARA ESTE UPSERT TAMBÉM — E NÃO VALIA.
  //
  // O comentário acima promete que "envio em voo NÃO grava", mas quem cumpria essa promessa era só
  // o `return` do `envioEmVooC2x` lá no funil — e ele fica DEPOIS de todas as recusas. Quer dizer:
  // uma recusa disparada por OUTRO gatilho (o lote do PIX pago e o gancho de credenciar chamam
  // `processarLoteC2x` direto, sem passar pela rota que tem o atalho) caía neste upsert e
  // sobrescrevia com 'erro' a linha 'pendente' de um envio que estava viajando naquele instante.
  //
  // O ESTRAGO NÃO É O TEXTO, É A TRAVA: `envioEmVooC2x` reconhece envio em curso por
  // `status = 'pendente'`. Apagado esse status, o próximo disparo passa livre e o
  // `POST /api/v1/users` — genérico, que cria de novo a cada chamada e NÃO TEM DESFAZER — roda pela
  // segunda vez para a mesma pessoa. Trocar um cadastro duplicado num sistema de CONTRATOS por uma
  // linha de recusa é um péssimo negócio, ainda mais porque essa linha vem aí de qualquer jeito: o
  // envio que está no ar grava o desfecho DELE quando voltar. Não gravar aqui não é silêncio, é
  // esperar o dono da linha terminar de escrever.
  if (await envioEmVooC2x(client, input.entityId)) {
    console.warn(
      `[c2x] recusa de ${input.entityId} NÃO gravada: há envio em voo (linha 'pendente'). Motivo: ${mensagem}`,
    );
    return mensagem;
  }

  // `documento` só entra quando existe: no upsert do PostgREST as colunas do corpo SOBRESCREVEM a
  // linha antiga, e mandar null aqui apagaria o documento já reconciliado de uma tentativa anterior.
  const linha: Record<string, unknown> = {
    atualizado_em: agora,
    entity_id: input.entityId,
    erro: mensagem,
    perfil: input.perfil ?? PERFIL_INDEFINIDO,
    resposta: {
      _classe: input.classe,
      // Marca que NÃO houve POST: a recusa é NOSSA, antes de falar com o C2X. É o que separa esta
      // linha de uma recusa da API do C2X (onde `resposta` é o corpo cru que ele devolveu).
      _origem: "recusa_local",
      motivo: input.motivo,
      quando: agora,
    },
    status: "erro",
  };
  if (input.documento) linha.documento = input.documento;

  // ⚠️ `error` conferido SEMPRE: upsert do PostgREST falha em silêncio quando bate em NOT NULL sem
  // default. Uma gravação de recusa que falha calada recria o bug que este código conserta, então
  // o fracasso vai para o log do servidor com o motivo original junto.
  const { error } = await client
    .from("apolo_c2x_sync")
    .upsert(linha, { onConflict: "entity_id" });
  if (error) {
    console.error(
      `[c2x] NÃO consegui gravar a recusa de ${input.entityId} (${error.message}). Motivo original: ${mensagem}`,
    );
  }
  return mensagem;
}

// 🔴 O DOCUMENTO BATEU E O NOME NÃO — O PIOR DESFECHO DESTA FASE, E O ÚNICO SEM ALARME NATURAL.
//
// Reconciliar é ligar esta CAD a um `users.id` do C2X. Quando o documento casa com OUTRA pessoa (um
// CPF digitado errado no Apolo é o caminho mais curto para isso), as duas saídas óbvias são ruins:
//   • reconciliar -> a CAD de um vira o cliente de outro, num sistema de CONTRATOS, em silêncio;
//   • enviar      -> nasce um segundo cadastro com um documento que já é de alguém no C2X.
// Então a saída é a terceira: não faz nem uma nem outra, e vira TRABALHO — linha na fila, classe
// "identidade", com os dois nomes escritos na mensagem para a conferência ser de olho, não de fé.
//
// A frase mora aqui, e não em cada chamador, porque são dois (o funil e o laço do lote) e eles
// precisam contar a MESMA história sobre o mesmo par.
export function msgDocumentoDeOutraPessoa(input: {
  c2xUserId: number;
  documento: string | null;
  motivo: string;
  nomeApolo: string | null;
  nomeNoC2x: string | null;
}): string {
  // 🔴 SEM NOME NO C2X NÃO É "OUTRA PESSOA" — E MANDAR O OPERADOR CONFERIR O CPF É MANDÁ-LO CAÇAR
  // UM ERRO QUE NÃO EXISTE.
  //
  // Medido em 08/08: 425 dos ~4.500 usuários do C2X estão com `name` vazio (as imobiliárias, em
  // peso). Isso responde por 423 dos 471 vetos de nome — 90% deles. Com a frase genérica, cada um
  // desses cards dizia "parece ser de OUTRA PESSOA... confira o CPF/CNPJ na ficha; se as duas
  // pessoas forem a mesma, corrija o nome para eles baterem": um beco sem saída, porque o CPF está
  // certo e não existe nome do outro lado para fazer bater. O bloqueio continua (sem nome não dá
  // para confirmar identidade, e enviar duplicaria o documento), mas agora ele aponta para o
  // conserto de verdade, que é do lado do C2X.
  if (semNomeNoC2x(input.nomeNoC2x)) {
    return (
      `o documento desta ficha (${input.documento ?? "vazio"}) já existe no C2X, no usuário ` +
      `${input.c2xUserId} — mas esse cadastro está SEM NOME lá, então não dá para confirmar que é ` +
      `a mesma pessoa que esta ficha ("${input.nomeApolo ?? "(sem nome)"}"). NADA foi enviado e ` +
      "NADA foi reconciliado. ⚠️ O CPF/CNPJ daqui provavelmente está CERTO: o conserto é preencher " +
      `o nome do usuário ${input.c2xUserId} no C2X e mandar de novo.`
    );
  }
  return (
    `o documento desta ficha (${input.documento ?? "vazio"}) já pertence a um cadastro do C2X que ` +
    `parece ser de OUTRA PESSOA: aqui a ficha é "${input.nomeApolo ?? "(sem nome)"}" e lá o ` +
    `usuário ${input.c2xUserId} é "${input.nomeNoC2x ?? "(sem nome)"}" — ${input.motivo} ` +
    "NADA foi enviado e NADA foi reconciliado: reconciliar ligaria esta CAD ao cliente errado e " +
    "enviar criaria um segundo cadastro com o mesmo documento. Confira o CPF/CNPJ na ficha; se as " +
    "duas pessoas forem a mesma, corrija o nome para eles baterem."
  );
}

// 🔴 O MESMO DOCUMENTO EM VÁRIOS CADASTROS DO C2X — A ESCOLHA QUE NÃO PODE SER NOSSA.
//
// O nome não salva este caso, e é isso que o torna pior que a divergência: os gêmeos do legado se
// chamam IGUAL (mesma pessoa cadastrada duas vezes), então a conferência aprova, e aí o critério
// que decide qual `users.id` vai para a fila é "o maior id". Medido no banco de produção em 08/08:
// dos 12 grupos em que dá para saber qual é o certo (um irmão tem `acquisition_requests` e o outro
// não), o maior id acertou 6. Moeda ao ar. E já tem um erro gravado: RAFAEL GONCALVES LEITE
// (13261969601) está ligado ao 4776, que tem ZERO pedidos, enquanto o pedido está no 4068 — o card
// do Apolo mostra um cliente sem contrato nenhum e ninguém desconfia.
//
// Também não dá para enviar: o documento existe lá, então o POST criaria o TERCEIRO cadastro.
// Sobra a única saída honesta — parar e mostrar a lista para uma pessoa escolher.
export function msgDocumentoAmbiguoNoC2x(input: {
  candidatos: CandidatoC2x[];
  documento: string | null;
  nomeApolo: string | null;
}): string {
  const lista = input.candidatos
    .map((c) => `${c.id} ("${c.nome || "(sem nome)"}")`)
    .join(", ");
  return (
    `o documento desta ficha (${input.documento ?? "vazio"}) aparece em ${input.candidatos.length} ` +
    `cadastros do C2X ao mesmo tempo: ${lista}. NADA foi enviado e NADA foi reconciliado — enviar ` +
    "criaria mais um cadastro com o mesmo documento, e escolher um deles por conta própria ligaria " +
    `esta CAD ("${input.nomeApolo ?? "(sem nome)"}") ao cadastro errado, que costuma ser o gêmeo ` +
    "VAZIO (sem pedidos). Alguém precisa dizer qual é o cadastro bom — normalmente é o de id MENOR, " +
    "que é o mais antigo e o que carrega os pedidos, mas isso tem que ser conferido no C2X."
  );
}

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
      erro: await registrarRecusaC2x(client, {
        classe: "papel",
        documento,
        entityId: input.entityId,
        motivo:
          "o papel desta ficha não sobe pela fila do C2X (corretor, fornecedor, parceiro, " +
          "colaborador ou papel não identificado). NADA foi enviado.",
        perfil: null,
      }),
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
    // ⚠️ O DOCUMENTO NÃO DECIDE SOZINHO. Antes de carimbar o `c2x_user_id` desta pessoa na nossa
    // fila, o nome tem que sustentar o casamento — senão o CPF errado de hoje vira o contrato
    // errado de amanhã. Ver `c2x-nome-confere.ts` para o que é tolerado (acento, caixa, nome do
    // meio, um erro de digitação) e o que não é (troca de nome próprio ou de sobrenome).
    const confere = confereNomeC2x(
      [entity.display_name, entity.legal_name, entity.trade_name],
      situacao.nomeNoC2x,
    );
    if (!confere.confere) {
      return {
        entityId: input.entityId,
        erro: await registrarRecusaC2x(client, {
          classe: "identidade",
          documento,
          entityId: input.entityId,
          motivo: msgDocumentoDeOutraPessoa({
            c2xUserId: situacao.c2xUserId,
            documento,
            motivo: confere.motivo,
            nomeApolo: confere.nomeApolo,
            nomeNoC2x: situacao.nomeNoC2x,
          }),
          perfil,
        }),
        status: "erro",
      };
    }
    return reconciliarJaNoC2x(client, {
      c2xUserId: situacao.c2xUserId,
      documento,
      entityId: input.entityId,
      perfil,
    });
  }

  // 🔴 VÁRIOS CADASTROS COM O MESMO DOCUMENTO: não reconcilia (escolheria por sorte) e não envia
  // (criaria mais um). Fica no funil, e não só no lote, porque o funil é por onde passam TAMBÉM os
  // disparadores automáticos — credenciar e PIX pago não olham a lista do lote.
  if (situacao.situacao === "ambiguo") {
    return {
      entityId: input.entityId,
      erro: await registrarRecusaC2x(client, {
        classe: "identidade",
        documento,
        entityId: input.entityId,
        motivo: msgDocumentoAmbiguoNoC2x({
          candidatos: situacao.candidatos,
          documento,
          nomeApolo: entity.display_name ?? entity.legal_name ?? null,
        }),
        perfil,
      }),
      status: "erro",
    };
  }

  if (situacao.situacao === "indisponivel") {
    // Continua no log do servidor por causa dos disparadores AUTOMÁTICOS (credenciar, PIX pago),
    // em que ninguém está olhando uma tela...
    console.error(`[c2x] envio adiado (${input.entityId}): ${situacao.motivo}`);
    // ...mas AGORA TAMBÉM VIRA LINHA. O argumento antigo para não gravar era que carimbar 'erro'
    // apagaria o sinal de "nunca_enviado" do board por causa de uma queda de rede. Só que o card
    // fica igualmente vermelho nos dois casos (o alerta 'nunca_enviado' também acende), e a
    // diferença é só que agora ele diz POR QUE — e a linha se corrige sozinha no primeiro envio
    // que der certo, porque o upsert é pela entidade.
    return {
      entityId: input.entityId,
      erro: await registrarRecusaC2x(client, {
        // Ficha sem CPF/CNPJ é trabalho para o time; C2X mudo não é culpa de ninguém.
        classe: situacao.semDocumento ? "ficha" : "indisponivel",
        documento,
        entityId: input.entityId,
        motivo: msgC2xNaoConferido(situacao.motivo),
        perfil,
      }),
      status: "erro",
    };
  }

  // 🔴 SEM IMOBILIÁRIA NO C2X — A RECUSA QUE SUMIA (08/08).
  //
  // Esta era a recusa que a resposta HTTP mostrava e ninguém gravava: ~8 CADs no envio em massa,
  // `erro ilike '%imobili%'` na fila devolvendo ZERO, e o card sem motivo nenhum. Agora vira linha,
  // e vira linha DIZENDO DE QUEM É O CONSERTO: a ficha do cliente pode estar impecável, o que falta
  // é o cadastro da IMOBILIÁRIA no C2X (ou o CNPJ dela no Apolo).
  //
  // Quem vem pelo lote já foi recusado antes daqui, com o NOME da imobiliária junto (o lote sabe
  // qual é). Este gate é a rede de baixo: pega quem chamar o funil direto, e por isso a frase aqui
  // é a genérica.
  if (perfil === "cliente" && !input.vinculedById) {
    return {
      entityId: input.entityId,
      erro: await registrarRecusaC2x(client, {
        classe: "imobiliaria",
        documento,
        entityId: input.entityId,
        motivo:
          "a imobiliária vinculada a esta CAD não tem cadastro no C2X (ou está sem CNPJ no " +
          "Apolo), então não existe `vinculed_by_id` e o cliente não pode ser criado lá. NADA foi " +
          "enviado. O conserto é no cadastro da IMOBILIÁRIA, não na ficha do cliente.",
        perfil,
      }),
      status: "erro",
    };
  }

  // O montador certo por perfil. `montarPayload` já separa cliente / imobiliária / incorporador,
  // e dentro do cliente separa PF de PJ pelo `isCompany` da ficha.
  const payload = montarPayload(perfil, dados, { vinculedById: input.vinculedById });

  // ⚠️ CONTRATO SOCIAL NÃO SOBE MAIS (decisão do Lucas, 22/08: "não precisa subir documentação
  // para o C2X"). O anexo era o que fazia o envio de CLIENTE PJ virar multipart — e o multipart
  // é exatamente o caminho que o C2X respondia com 500 Internal Server Error sem mensagem:
  // NENHUMA PJ jamais foi criada por esta integração (zero resolvidas na fila; TBTC e VIDRO TELA
  // falharam em 22/08 às 08:43 e o time teve que criar na mão às 08:49). Sem o anexo, o PJ
  // viaja como JSON — o mesmo transporte que cria PF aos montes. O documento continua guardado
  // no Apolo; só não é enviado ao legado.
  const ehClientePj = perfil === "cliente" && dados.cadastro.isCompany;
  const contrato: ContratoSocialParaC2x = {
    anexo: null,
    documentoId: null,
    motivo: ehClientePj ? "documentação não sobe para o C2X (decisão do Lucas, 22/08)" : null,
  };

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
  //
  // ⚠️ ÚNICA RECUSA QUE NÃO VIRA LINHA, e o motivo é o oposto do descuido: a linha desta entidade
  // JÁ EXISTE e está em 'pendente' porque tem um envio de verdade viajando agora. Carimbar 'erro'
  // por cima destruiria a trava anti-duplicado e o `requisicao` do envio real.
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
    // ⚠️ NUNCA `resposta.mensagem` CRU AQUI. O C2X já recusou com `errors_message` E `errors` os
    // dois vazios (três CADs PJ em 08/08), e a linha ia para a fila com `erro = ''` — o card
    // acendia vermelho dizendo "motivo não registrado", que é o silêncio de novo, agora do lado de
    // lá do POST. `motivoDaRecusaC2x` garante frase: mensagem, senão os erros campo a campo, senão
    // a confissão de que a API não disse nada.
    const motivoApi = motivoDaRecusaC2x(resposta);
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
export type ImobiliariaDaCad = {
  // O `vinculed_by_id` do cliente. Null = a imobiliária não foi encontrada no C2X pelo documento.
  c2xUserId: number | null;
  // ⚠️ false = NÃO DEU PARA PERGUNTAR ao C2X (banco do legado fora). Sem este campo, o
  // `c2xUserId: null` de uma queda de rede vira a frase "a imobiliária não tem cadastro no C2X" —
  // e aí a recusa acusa a imobiliária (e manda o time consertar o que não está quebrado) por causa
  // de um timeout. É a mesma armadilha que `ConsultaC2xPorDocumento` já evita do outro lado.
  conferida: boolean;
  documento: string | null;
  // Null = a CAD não tem NENHUMA imobiliária vinculada no Apolo (é outro conserto, e outro time).
  entityId: string | null;
  nome: string | null;
};

// QUEM é a imobiliária desta CAD e qual o id dela no C2X. Devolve a identidade inteira, não só o
// número, porque a recusa por falta de `vinculed_by_id` precisa dizer QUAL imobiliária resolver —
// "sem imobiliária no C2X" manda o operador procurar no escuro; "a imobiliária RICAJ NEGOCIOS
// IMOBILIARIOS LTDA está sem CNPJ" já é a tarefa pronta.
export async function resolverImobiliariaDaCad(
  client: AdminClient,
  entityId: string,
  cache?: Map<string, ImobiliariaDaCad>,
): Promise<ImobiliariaDaCad> {
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
  if (!imobId) {
    // Nada a conferir no C2X: a pendência é o vínculo no Apolo, e disso a gente sabe sozinho.
    return { c2xUserId: null, conferida: true, documento: null, entityId: null, nome: null };
  }

  const emCache = cache?.get(imobId);
  if (emCache) return emCache;

  const { data: imob } = await client
    .from("apolo_entities")
    .select("display_name, legal_name, document_masked")
    .eq("id", imobId)
    .single();
  const linha = imob as
    | { display_name: string | null; document_masked: string | null; legal_name: string | null }
    | null;

  // A consulta CRUA (e não `lerIdC2xPorDocumento`) porque aqui a diferença entre "não achei" e
  // "não consegui perguntar" é justamente o que precisa sobreviver até a mensagem da recusa.
  const documento = linha?.document_masked ?? null;
  const digitos = soDigitos(documento);
  const consulta = digitos ? await consultarDocumentosNoC2x([digitos]) : null;

  const achada: ImobiliariaDaCad = {
    c2xUserId: consulta?.ok ? (consulta.ids.get(digitos) ?? null) : null,
    // Sem dígitos nem chegamos a perguntar, e não precisamos: o CNPJ vazio já é a pendência.
    conferida: consulta ? consulta.ok : true,
    documento,
    entityId: imobId,
    nome: texto(linha?.display_name) ?? texto(linha?.legal_name),
  };
  cache?.set(imobId, achada);
  return achada;
}

// O número puro, para quem só precisa dele. Continua exportada porque é o contrato antigo desta
// casa: quem chama para montar o payload não tem por que saber o nome da imobiliária.
export async function resolverVinculedById(
  client: AdminClient,
  entityId: string,
  cache?: Map<string, ImobiliariaDaCad>,
): Promise<number | null> {
  return (await resolverImobiliariaDaCad(client, entityId, cache)).c2xUserId;
}

// A RECUSA POR FALTA DE `vinculed_by_id`, com nome e sobrenome do problema. São QUATRO desfechos
// com quatro consertos diferentes, em lugares diferentes — e o pior deles seria achatá-los na
// mesma frase ("Cliente sem imobiliária vinculada no C2X"), que foi o que se viu em 08/08 e não
// dizia a ninguém o que fazer.
//
// A classe vem JUNTO com a frase de propósito: separar as duas coisas é como nasce uma linha que
// diz "não é culpa da ficha" carimbada como culpa da ficha.
export function recusaPorImobiliaria(imob: ImobiliariaDaCad): {
  classe: ClasseRecusaC2x;
  motivo: string;
} {
  if (!imob.entityId) {
    return {
      classe: "imobiliaria",
      motivo:
        "esta CAD não tem imobiliária vinculada no Apolo, e o C2X exige o `vinculed_by_id` para " +
        "criar um cliente. NADA foi enviado. Vincule a imobiliária na CAD e mande de novo.",
    };
  }
  const quem = imob.nome ?? "a imobiliária vinculada";
  if (!soDigitos(imob.documento)) {
    return {
      classe: "imobiliaria",
      motivo:
        `${quem} está sem CNPJ utilizável no Apolo (\`${imob.documento ?? "vazio"}\`), então não ` +
        "dá para achar o cadastro dela no C2X e o cliente fica sem `vinculed_by_id`. NADA foi " +
        "enviado. O conserto é no cadastro da IMOBILIÁRIA, não na ficha do cliente.",
    };
  }
  // NÃO DEU PARA PERGUNTAR. Não é da imobiliária nem da ficha: é para tentar de novo.
  if (!imob.conferida) {
    return {
      classe: "indisponivel",
      motivo:
        `não deu para conferir no C2X o cadastro da imobiliária ${quem} (${imob.documento}), e ` +
        "sem o `vinculed_by_id` dela o cliente não pode ser criado. NADA foi enviado. Tente de " +
        "novo quando o C2X responder.",
    };
  }
  return {
    classe: "imobiliaria",
    motivo:
      `${quem} (${imob.documento}) não tem cadastro no C2X, então o cliente fica sem ` +
      "`vinculed_by_id` e não pode ser criado lá. NADA foi enviado. O conserto é no cadastro da " +
      "IMOBILIÁRIA, não na ficha do cliente.",
  };
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
  // O `users.id` do C2X encontrado pelo DOCUMENTO, quando a pessoa já está lá. Vem no ensaio também
  // (onde nada é gravado): é o que o operador confere antes de autorizar a reconciliação.
  // TODOS os `users.id` do C2X que carregam o documento desta ficha, quando são mais de um. Vem
  // separado de `c2xUserId` porque significa o oposto: lá há uma escolha feita, aqui há uma escolha
  // PENDENTE. Sem este campo o caso ambíguo sumiria do relatório de reconciliação, que separa os
  // suspeitos justamente por terem um id do C2X — e o silêncio voltaria pela porta dos fundos.
  c2xCandidatos?: number[];
  c2xUserId?: number;
  // Campos em que `metadata.cadastro` e `apolo_esteira.ficha` discordam sobre QUEM é a pessoa.
  divergencias?: string[];
  entityId: string;
  erro?: string;
  faltantes: string[];
  nome: string;
  // O `users.name` do cadastro achado no C2X, LADO A LADO com `nome` (o do Apolo). Sem os dois na
  // mesma linha, conferir uma reconciliação exige abrir dois sistemas — e ninguém confere.
  nomeNoC2x?: string | null;
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
  // "Quem destas já está no C2X", quando quem chama JÁ perguntou. Ausente (o normal) = o lote
  // pergunta sozinho, em blocos. Mesmo contrato que `enviarEntidadeParaC2x` já tem, e pela mesma
  // razão: a resposta é cara (MySQL de produção) e ninguém deve pedi-la duas vezes.
  consultaC2x?: ConsultaC2xPorDocumento;
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
    // `trade_name` entra por causa da conferência de nome: o funil compara os TRÊS nomes da
    // entidade e o lote comparava dois. Duas réguas para a mesma decisão divergem um dia — e a
    // frouxa é sempre a que roda em lote, sem ninguém olhando (foi assim com as duas
    // `matchFaixaRendaId`). Hoje a diferença de veredito é ZERO em produção; é para continuar.
    .select("id, display_name, legal_name, trade_name, document_masked, entity_kind, metadata")
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
    trade_name: string | null;
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
  const consultaC2x =
    input.consultaC2x ??
    (await consultarDocumentosNoC2x(candidatas.map((ent) => ent.document_masked)));

  // Envio REAL só quando não é ensaio e não é o modo "só reconciliar".
  const podeEnviar = !input.dryRun && !input.apenasReconciliar;
  // O ensaio não grava NADA, nem na nossa tabela: "ensaio" tem que significar a mesma coisa em
  // todo lugar, senão o operador que roda o diagnóstico para olhar acaba mudando o estado.
  const podeGravarReconciliacao = !input.dryRun;

  const cacheImob = new Map<string, ImobiliariaDaCad>();
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
    const docDaEntidade = soDigitos(ent.document_masked ?? "");
    const candidatosNoC2x = consultaC2x.ok
      ? (consultaC2x.candidatos.get(docDaEntidade) ?? [])
      : [];

    // 🔴 MAIS DE UM CADASTRO COM ESTE DOCUMENTO NO C2X. Sai ANTES da conferência de nome porque o
    // nome não resolve isto: os gêmeos do legado têm o MESMO nome, a régua aprova, e o que decide
    // vira "o maior id" — que a medição de 08/08 mostrou ser moeda ao ar (6 acertos em 12 grupos
    // decidíveis). Nem reconcilia nem envia: vira "conferir", que é a gaveta de quem precisa de
    // gente olhando.
    if (candidatosNoC2x.length > 1) {
      const ordenados = [...candidatosNoC2x].sort((a, b) => a.id - b.id);
      const motivo = msgDocumentoAmbiguoNoC2x({
        candidatos: ordenados,
        documento: ent.document_masked,
        nomeApolo: nome || ent.legal_name || null,
      });
      if (podeGravarReconciliacao) {
        await registrarRecusaC2x(client, {
          classe: "identidade",
          documento: ent.document_masked,
          entityId: ent.id,
          motivo,
          perfil: perfilDaFicha(ent.metadata ?? {}, ent.entity_kind) ?? "cliente",
        });
      }
      itens.push({
        c2xCandidatos: ordenados.map((c) => c.id),
        divergencias: [`o documento aparece em ${ordenados.length} cadastros do C2X`],
        entityId: ent.id,
        erro: motivo,
        faltantes: [],
        nome,
        status: "conferir",
      });
      continue;
    }

    const jaNoC2xId = candidatosNoC2x[0]?.id ?? null;
    if (jaNoC2xId != null) {
      const perfilDaEntidade = perfilDaFicha(ent.metadata ?? {}, ent.entity_kind);
      const nomeNoC2x = candidatosNoC2x[0]?.nome || null;

      // 🔴 O DOCUMENTO BATEU — MAS É A MESMA PESSOA? Aqui é onde o risco desta fase mora: um CPF
      // digitado errado no Apolo casa com outra pessoa no C2X, e a reconciliação amarraria a CAD ao
      // cliente errado sem barulho nenhum. Nome que não sustenta o casamento sai como "conferir",
      // que é a MESMA gaveta das outras divergências de identidade — o operador já sabe o que fazer
      // com ela — e NÃO vira envio: mandar criaria um segundo cadastro com o mesmo documento.
      //
      // ⚠️ `tentarTodas` NÃO passa por cima disto, de propósito. Aquela chave existe para os campos
      // em que o nosso gate é um palpite sobre a regra da API; esta trava não é palpite nenhum, é
      // uma checagem nossa contra o banco de produção do C2X, e a API não tem como refazê-la.
      const confere = confereNomeC2x(
        [ent.display_name, ent.legal_name, ent.trade_name],
        nomeNoC2x,
      );
      if (!confere.confere) {
        const motivo = msgDocumentoDeOutraPessoa({
          c2xUserId: jaNoC2xId,
          documento: ent.document_masked,
          motivo: confere.motivo,
          nomeApolo: confere.nomeApolo,
          nomeNoC2x,
        });
        // Grava quando a rodada é de VERDADE (envio real ou modo reconciliação): nos dois casos
        // houve uma tentativa de mexer nesta ficha, e ela foi recusada. O ensaio não grava nada.
        if (podeGravarReconciliacao) {
          await registrarRecusaC2x(client, {
            classe: "identidade",
            documento: ent.document_masked,
            entityId: ent.id,
            motivo,
            perfil: perfilDaEntidade ?? "cliente",
          });
        }
        itens.push({
          c2xUserId: jaNoC2xId,
          divergencias: [confere.motivo],
          entityId: ent.id,
          erro: motivo,
          faltantes: [],
          nome,
          nomeNoC2x,
          status: "conferir",
        });
        continue;
      }

      if (podeGravarReconciliacao && perfilDaEntidade) {
        const r = await reconciliarJaNoC2x(client, {
          c2xUserId: jaNoC2xId,
          documento: ent.document_masked,
          entityId: ent.id,
          perfil: perfilDaEntidade,
        });
        itens.push({
          c2xUserId: jaNoC2xId,
          entityId: ent.id,
          erro: r.erro,
          faltantes: [],
          nome,
          nomeNoC2x,
          status: r.status === "ja_no_c2x" ? "ja_no_c2x" : "erro",
        });
      } else {
        itens.push({
          c2xUserId: jaNoC2xId,
          entityId: ent.id,
          faltantes: [],
          nome,
          nomeNoC2x,
          status: "ja_no_c2x",
        });
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

    const imob = await resolverImobiliariaDaCad(client, ent.id, cacheImob);
    const vinculedById = imob.c2xUserId;
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
    //
    // 🔴 EXCETO A IMOBILIÁRIA — ela é TRAVA LOCAL, não palpite nosso sobre a regra do C2X.
    // `tentarTodas` existe para os campos em que o nosso gate é uma SUPOSIÇÃO do que a API exige;
    // sem `vinculed_by_id` a API nem chega a ser chamada (o funil recusa antes), então deixar
    // passar aqui só troca uma recusa COM NOME por uma recusa cega lá na frente. Foi exatamente
    // assim que as ~8 de 08/08 viraram "Cliente sem imobiliária vinculada" sem dizer qual.
    const semImobiliaria = vinculedById == null;
    if (faltantes.length > 0 && (!input.tentarTodas || semImobiliaria)) {
      const outros = faltantes.filter((f) => f !== "Imobiliária");
      const daImobiliaria = semImobiliaria ? recusaPorImobiliaria(imob) : null;
      // A FRASE É CALCULADA SEMPRE, mesmo no ensaio — o que o ensaio não faz é GRAVAR.
      //
      // ⚠️ Ela também sobe no `ItemLote`, e isso conserta uma divergência que a medição pegou: a
      // linha da fila dizia "CADASTRO DA IMOBILIÁRIA: esta CAD não tem imobiliária vinculada no
      // Apolo", enquanto a tela, montada só a partir de `faltantes`, dizia "esta ficha ainda não
      // tem Imobiliária. Complete na ficha e clique de novo." — mandando o operador procurar, na
      // ficha do CLIENTE, um campo que não existe lá. Duas versões da mesma recusa é como o
      // trabalho vira volta perdida.
      const motivo = daImobiliaria
        ? daImobiliaria.motivo +
          (outros.length > 0 ? ` Além disso, falta preencher na ficha: ${outros.join(", ")}.` : "")
        : `falta preencher na ficha antes de subir: ${faltantes.join(", ")}. NADA foi enviado.`;
      const classe = daImobiliaria?.classe ?? "ficha";

      // Ensaio não grava: quem roda o diagnóstico está olhando, não tentando.
      const mensagem = podeEnviar
        ? await registrarRecusaC2x(client, {
            classe,
            documento: ent.document_masked,
            entityId: ent.id,
            // Com a imobiliária travando, o que falta NA FICHA vai junto: o operador resolve os
            // dois de uma vez em vez de descobrir o segundo problema só na próxima tentativa.
            motivo,
            perfil: "cliente",
          })
        : mensagemDeRecusaC2x(classe, motivo);
      itens.push({ entityId: ent.id, erro: mensagem, faltantes, nome, status: "faltando" });
      continue;
    }
    // Duas redes contra mandar a pessoa errada para o contrato: (1) as duas fontes discordando
    // sobre nome da mãe / nascimento; (2) titular e cônjuge dividindo um dado que duas pessoas não
    // dividem. Nenhuma delas substitui o diagnóstico do Asana (cad-diagnostico.ts), que é quem tem
    // a âncora de verdade — mas as duas custam nada e, quando disparam, disparam com razão.
    const costurada = sinaisDeFichaCosturada(ficha, ent.document_masked);
    if ((unido.divergenciasDeIdentidade.length > 0 || costurada.length > 0) && !input.tentarTodas) {
      const divergencias = [...unido.divergenciasDeIdentidade, ...costurada];
      if (podeEnviar) {
        await registrarRecusaC2x(client, {
          classe: "identidade",
          documento: ent.document_masked,
          entityId: ent.id,
          motivo:
            `as duas fontes da ficha discordam sobre quem é a pessoa (${divergencias.join("; ")}). ` +
            "Esses campos vão no CONTRATO, então NADA foi enviado até alguém conferir.",
          perfil: "cliente",
        });
      }
      itens.push({
        divergencias,
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
        // Aqui `podeEnviar` já é verdade (o gate acima passou), então isto é uma tentativa REAL
        // que terminou em recusa: vira linha, com a classe que diz "não é trabalho de ninguém,
        // é para tentar de novo quando o C2X voltar".
        erro: await registrarRecusaC2x(client, {
          classe: "indisponivel",
          documento: ent.document_masked,
          entityId: ent.id,
          motivo: msgC2xNaoConferido(consultaC2x.motivo),
          perfil: "cliente",
        }),
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
