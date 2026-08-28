// A ABA CADASTRO (e os Relacionamentos) DA FICHA DO PORTAL DO INCORPORADOR.
//
// Pedido do Lucas (18/08/2026), palavra dele: *"CRM, tem que ser igual, cadastro, tudo que
// estiver no apolo tem que está aqui, os documentos"*. Este arquivo monta a MESMA ficha da aba
// Cadastro do CRM interno (modules/apolo/blocks/crm/panels.tsx → RegistrationPanel), com os
// mesmos três grupos — Dados do cliente, Dados cadastrais, Dados do cônjuge — e a MESMA
// prioridade de fontes do read-model interno (board/[id] e montarCadDeEntidade):
//
//   metadata.cadastro (importação) < c2xCadastro (ficha AO VIVO do C2X) < apolo_esteira.ficha
//   (o que o operador editou; ganha de tudo) < metadata.cadastroEditado (correção humana).
//
// ⚠️ A ficha vive em DOIS lugares e a esteira VENCE o metadata — ver [[apolo-ficha-vs-cadastro]].
// Para comprador importado do C2X (caso do Vista Alegre inteiro), o cadastro vem das tabelas do
// C2X (users + spouses + addresses), pelo MESMO `fetchC2xCadastroByEntity` do CRM interno.
//
// O payload continua allowlist campo a campo: os grupos são montados AQUI, no servidor, rótulo a
// rótulo — nenhum objeto de loader atravessa para o navegador.
import {
  C2X_ESCOLARIDADE,
  C2X_ESTADO_CIVIL,
  C2X_FAIXA_RENDA,
  C2X_REGIME_BENS,
  C2X_SEXO,
  calcIdade,
  formatDateBR,
  titleCase,
  type C2xOption,
} from "@/lib/apolo/c2x-fields";
import { mapearC2xParaFicha } from "@/lib/apolo/cad-de-entidade";
import { lerCadsDaEsteira } from "@/lib/apolo/esteira-cad";
import { casarProfissaoNaLista, profissaoExibida } from "@/lib/apolo/profissao";
import { createApoloAdminClient, fetchC2xCadastroByEntity } from "@/lib/apolo/server";
import type { ApoloC2xCadastro } from "@/lib/apolo/types";
import { getHadesDbPool } from "@/lib/guardian/db";

type AdminClient = NonNullable<ReturnType<typeof createApoloAdminClient>>;

// ── TIPOS DO PAYLOAD ────────────────────────────────────────────────────────

export type CampoDoCadastro = { rotulo: string; valor: string };

export type GrupoDoCadastro = {
  campos: CampoDoCadastro[];
  eyebrow: string;
  titulo: string;
};

/** Um contrato da pessoa DENTRO do escopo — vira card na aba Relacionamentos. */
export type ContratoDaFicha = {
  codigo: string;
  empreendimento: null | string;
  etapa: string;
};

/**
 * A rede da pessoa, no recorte que o cliente externo pode ver: cônjuge (só o nome), a
 * imobiliária e o corretor do contrato, e os contratos dela no escopo. SEM telefone/e-mail de
 * terceiros e SEM ações de criar/excluir — vínculo é operação interna da Careli.
 */
export type RelacionamentosDaFicha = {
  conjuge: null | { nome: string };
  contratos: ContratoDaFicha[];
  corretor: null | string;
  imobiliaria: null | string;
};

// ── REGRAS PURAS ────────────────────────────────────────────────────────────

/**
 * CPF/CNPJ SEM MÁSCARA, só normalizado com a pontuação padrão.
 *
 * Ordem do Lucas (18/08/2026): *"tem que ser igual, cadastro, tudo que estiver no apolo tem que
 * está aqui"* — o documento sai INTEIRO no portal do incorporador, na lista e na ficha, como já
 * sai no Panteon interno (ele já tinha mandado tirar a máscara de lá). Substitui a
 * `mascararDocumento` que valia até 17/08 neste portal.
 *
 * O que não tem 11/14 dígitos sai como veio (aparado): é o mesmo que o CRM interno faz com
 * `documentMasked`, e inventar formato esconderia erro de cadastro que o dono quer ver.
 */
export function formatarDocumento(valor: null | string | undefined): null | string {
  const cru = String(valor ?? "").trim();
  if (!cru) return null;

  const digitos = cru.replace(/\D/g, "");

  if (digitos.length === 11) {
    return `${digitos.slice(0, 3)}.${digitos.slice(3, 6)}.${digitos.slice(6, 9)}-${digitos.slice(9)}`;
  }

  if (digitos.length === 14) {
    return `${digitos.slice(0, 2)}.${digitos.slice(2, 5)}.${digitos.slice(5, 8)}/${digitos.slice(8, 12)}-${digitos.slice(12)}`;
  }

  return cru;
}

const texto = (v: unknown): string => (typeof v === "string" ? v.trim() : v == null ? "" : String(v).trim());

/** Rótulo de uma lista do C2X a partir do id gravado na ficha (mesmo `opcao` do wizard). */
function opcao(lista: readonly C2xOption[], id: unknown): string {
  const alvo = texto(id);
  if (!alvo) return "";
  return lista.find((item) => String(item.id) === alvo)?.label ?? "";
}

/** O que `montarGruposDeCadastro` precisa — já lido e mesclado pelo IO abaixo. */
export type InsumosDoCadastro = {
  /** A ficha AO VIVO do C2X (nula para entidade nascida no Apolo). */
  c2x: ApoloC2xCadastro | null;
  conjuge: {
    cpf: null | string;
    documento: null | string;
    email: null | string;
    nascimento: null | string;
    nome: null | string;
    profissao: null | string;
    telefone: null | string;
  };
  contatos: { email: null | string; telefone: null | string };
  /** CRU (sem máscara) — ver `formatarDocumento`. */
  documento: null | string;
  ehPj: boolean;
  /** Endereço do Apolo (apolo_addresses), chaves já normalizadas para as da ficha. */
  endereco: null | Record<string, string>;
  /** metadata.cadastro < C2X mapeado < esteira.ficha < cadastroEditado, já mesclado (id-space). */
  ficha: Record<string, unknown>;
  nome: string;
  razaoSocial: null | string;
};

/**
 * Os grupos da aba Cadastro, ESPELHO do RegistrationPanel interno: mesmos três grupos, mesmos
 * rótulos, mesma regra por perfil (PJ não tem nascimento/RG/estado civil; regime de bens só
 * casado; cônjuge só PF casada ou com cônjuge registrado).
 */
export function montarGruposDeCadastro(insumos: InsumosDoCadastro): GrupoDoCadastro[] {
  const { c2x, conjuge, contatos, documento, ehPj, endereco, ficha: c, nome, razaoSocial } = insumos;

  const end = (chave: string): string => texto(c[chave]) || texto(endereco?.[chave]);
  const cidadeUf = [end("cidade"), end("uf")].filter(Boolean).join("-");

  const enderecoLinha = [
    [end("logradouro"), end("numero")].filter(Boolean).join(", "),
    end("bairro"),
    cidadeUf,
  ]
    .filter(Boolean)
    .join(" · ");

  // Mesma dedupe do interno: a razão social só aparece quando difere do nome de exibição.
  const mostraRazao = Boolean(
    razaoSocial && razaoSocial.trim().toLowerCase() !== nome.trim().toLowerCase(),
  );

  const campo = (rotulo: string, valor: string): CampoDoCadastro => ({
    rotulo,
    valor: valor.trim() || "-",
  });

  const grupos: GrupoDoCadastro[] = [];

  grupos.push({
    campos: [
      campo("Nome", nome),
      // ⚠️ SEM MÁSCARA, por ordem do dono (18/08/2026) — ver `formatarDocumento`.
      campo("CPF/CNPJ", formatarDocumento(documento) ?? ""),
      ...(mostraRazao ? [campo("Razão social", razaoSocial ?? "")] : []),
      campo("Telefone", texto(c.telefone) || texto(contatos.telefone)),
      campo("E-mail", texto(c.email) || texto(contatos.email)),
      campo("Endereço", enderecoLinha),
    ],
    eyebrow: "Dados do cliente",
    titulo: "Cadastro",
  });

  const estadoCivil = opcao(C2X_ESTADO_CIVIL, c.estadoCivilId) || texto(c2x?.civilState);
  const casado = /casad|uni[aã]o est[aá]vel/i.test(estadoCivil) || ["2", "6"].includes(texto(c.estadoCivilId));
  const nascimento = formatDateBR(texto(c.dataNascimento)) || texto(c2x?.birthday);
  const creci = texto(c.creci) || texto(c2x?.creciNumber);

  const linhasEndereco: CampoDoCadastro[] = [
    campo("Endereço", end("logradouro")),
    campo("Número", end("numero")),
    campo("Bairro", end("bairro")),
    campo("Complemento", end("complemento")),
    campo("CEP", end("cep")),
    campo("Cidade", cidadeUf),
  ];

  if (ehPj) {
    grupos.push({
      campos: [
        campo("Tipo pessoa", "Pessoa jurídica"),
        ...(creci ? [campo("CRECI", creci)] : []),
        campo("NIRE", texto(c2x?.nire)),
        campo("Inscrição municipal", texto(c2x?.municipalInscription)),
        campo("Data de abertura", formatDateBR(texto(c.dataAbertura)) || texto(c2x?.openCompanyDate)),
        campo(
          "Atualização cadastral",
          formatDateBR(texto(c.dataAtualizacaoCadastral)) || texto(c2x?.socialContractUpdatedAt),
        ),
        ...linhasEndereco,
      ],
      eyebrow: "Cadastro completo",
      titulo: "Dados cadastrais",
    });
  } else {
    grupos.push({
      campos: [
        campo("Tipo pessoa", "Pessoa física"),
        campo("RG", texto(c2x?.rg) || texto(c.rg)),
        ...(creci ? [campo("CRECI", creci)] : []),
        campo("Nascimento", nascimento),
        campo("Idade", calcIdade(texto(c.dataNascimento)) || texto(c2x?.age)),
        campo("Sexo", opcao(C2X_SEXO, c.sexoId) || texto(c2x?.sex)),
        campo("Estado civil", estadoCivil),
        ...(casado
          ? [campo("Regime de bens", opcao(C2X_REGIME_BENS, c.regimeBensId) || texto(c2x?.propertyRegime))]
          : []),
        // A profissão DIGITADA no cadastro (fora das 234 do C2X) sai marcada "(a padronizar)" —
        // antes desta linha não existia campo para ela e a ficha mostrava "—" com o dado salvo do
        // lado. O id do legado entra pelo RÓTULO que ele devolve, e não como último recurso, porque
        // "PROFISSÃO NÃO DECLARADA" (o vazio do C2X) não pode encobrir o que o cliente declarou.
        // Ver lib/apolo/profissao.ts.
        campo(
          "Profissão",
          profissaoExibida(
            texto(c.profissaoId) || casarProfissaoNaLista(texto(c2x?.profession)),
            c.profissaoOutro,
          ) || titleCase(texto(c2x?.profession)),
        ),
        campo("Renda", opcao(C2X_FAIXA_RENDA, c.rendaId) || texto(c2x?.salaryRange)),
        campo("Escolaridade", opcao(C2X_ESCOLARIDADE, c.escolaridadeId) || texto(c2x?.schooling)),
        campo("Naturalidade", titleCase(texto(c.naturalidade)) || texto(c2x?.naturalness)),
        campo("Nacionalidade", titleCase(texto(c.nacionalidade)) || texto(c2x?.nacionality)),
        campo("Nome da mãe", titleCase(texto(c.nomeMae)) || titleCase(texto(c2x?.motherName))),
        ...linhasEndereco,
      ],
      eyebrow: "Cadastro completo",
      titulo: "Dados cadastrais",
    });

    // Cônjuge: mesmo gatilho do interno — PF casada OU com cônjuge registrado.
    if (casado || conjuge.nome) {
      grupos.push({
        campos: [
          campo("Cônjuge", titleCase(texto(conjuge.nome))),
          campo("CPF", formatarDocumento(conjuge.cpf) ?? ""),
          campo("Telefone", texto(conjuge.telefone)),
          campo("E-mail", texto(conjuge.email)),
          campo("Nascimento", texto(conjuge.nascimento)),
          campo("Documento", texto(conjuge.documento)),
          campo("Profissão", titleCase(texto(conjuge.profissao))),
        ],
        eyebrow: "Cônjuge",
        titulo: "Dados do cônjuge",
      });
    }
  }

  return grupos;
}

// ── LEITURA (Supabase + C2X) ────────────────────────────────────────────────

type EntityRow = {
  display_name: null | string;
  document_masked: null | string;
  entity_kind: null | string;
  id: string;
  legal_name: null | string;
  metadata: null | {
    cadastro?: Record<string, unknown>;
    cadastroEditado?: Record<string, unknown>;
  };
  trade_name: null | string;
};

type LinhaEsteiraFicha = {
  atualizado_em: null | string;
  created_at: null | string;
  enterprise_id: null | string;
  entity_id: string;
  ficha: null | Record<string, unknown>;
};

export type CadastroDaPessoa = {
  /** users.id no C2X, quando a entidade tem vínculo — os documentos/histórico dependem dele. */
  c2xUserId: null | number;
  conjugeNome: null | string;
  /** E-mails de contato (uso INTERNO no servidor: identidade das reuniões; não saem no payload). */
  emails: string[];
  grupos: GrupoDoCadastro[];
};

const CADASTRO_VAZIO: CadastroDaPessoa = {
  c2xUserId: null,
  conjugeNome: null,
  emails: [],
  grupos: [],
};

/** O users.id do C2X desta entidade, via apolo_source_links (nulo quando não há vínculo). */
export async function lerC2xUserId(
  admin: AdminClient,
  entityId: string,
): Promise<null | number> {
  const { data } = await admin
    .from("apolo_source_links")
    .select("source_id, source_system, source_table")
    .eq("entity_id", entityId)
    .eq("source_system", "c2x")
    .eq("source_table", "users")
    .limit(1)
    .returns<Array<{ source_id: null | string }>>();

  const bruto = data?.[0]?.source_id;
  const id = Number(bruto);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/**
 * Lê e monta o cadastro completo de UMA pessoa, com as mesmas fontes e a mesma prioridade do CRM
 * interno. Qualquer falha vira cadastro vazio: a ficha do portal abre sem a aba preenchida, nunca
 * travada — mesma postura de `documentoDaEntidade`.
 *
 * ⚠️ ISTO NÃO CONFERE ESCOPO. Quem chama (montarFicha) já provou que a pessoa pertence à sessão;
 * esta função só junta os dados dela.
 */
export async function lerCadastroDaPessoa({
  enterpriseIds,
  entityId,
}: {
  /** Ids de empreendimento que a sessão alcança — escolhem QUAL CAD da esteira vale. */
  enterpriseIds: string[];
  entityId: string;
}): Promise<CadastroDaPessoa> {
  const admin = createApoloAdminClient();
  if (!admin) return CADASTRO_VAZIO;

  try {
    const [{ data: entityData }, { data: enderecos }, { data: contatos }, { data: relConjuge }, linksC2x, linhasEsteira] =
      await Promise.all([
        admin
          .from("apolo_entities")
          .select("id, display_name, legal_name, trade_name, document_masked, entity_kind, metadata")
          .eq("id", entityId)
          .limit(1)
          .returns<EntityRow[]>(),
        admin
          .from("apolo_addresses")
          .select("street, number, complement, district, city, state, postal_code, is_primary")
          .eq("entity_id", entityId)
          .order("is_primary", { ascending: false })
          .limit(1)
          .returns<Array<Record<string, null | string>>>(),
        admin
          .from("apolo_contacts")
          .select("contact_type, value")
          .eq("entity_id", entityId)
          .limit(20)
          .returns<Array<{ contact_type: string; value: string }>>(),
        admin
          .from("apolo_relationships")
          .select("label, metadata")
          .eq("entity_id", entityId)
          .eq("relationship_type", "conjuge")
          .limit(1)
          .returns<Array<{ label: null | string; metadata: null | Record<string, unknown> }>>(),
        admin
          .from("apolo_source_links")
          .select("entity_id, source_system, source_table, source_id")
          .eq("entity_id", entityId)
          .eq("source_system", "c2x")
          .eq("source_table", "users")
          .returns<Array<{ entity_id: string; source_id: null | string; source_system: null | string; source_table: null | string }>>(),
        // Todas as CADs da pessoa; a do empreendimento do ESCOPO vence, senão a mais recente.
        // (A ficha da esteira é dado PESSOAL — nascimento, profissão — não carrega nome de
        // empreendimento, então a mais recente é aceitável quando nenhuma é do escopo.)
        lerCadsDaEsteira<LinhaEsteiraFicha>(
          admin,
          entityId,
          "entity_id, enterprise_id, ficha, atualizado_em, created_at",
        ).catch(() => [] as LinhaEsteiraFicha[]),
      ]);

    const entity = entityData?.[0] ?? null;

    // Ficha AO VIVO do C2X (best-effort, mesmo caminho do CRM interno). Sem vínculo ou com o
    // C2X fora, segue sem — a aba mostra o que o Apolo tem.
    let c2x: ApoloC2xCadastro | null = null;
    let c2xUserId: null | number = null;
    const links = (linksC2x.data ?? []).filter((l) => /^\d+$/.test(String(l.source_id ?? "")));
    if (links.length > 0) {
      c2xUserId = Number(links[0]?.source_id);
      try {
        const { cadastro } = await fetchC2xCadastroByEntity(admin, links, new Set(), new Set());
        c2x = cadastro.get(entityId) ?? null;
      } catch {
        c2x = null;
      }
    }

    const doEscopo = new Set(enterpriseIds.map((id) => String(id).trim()));
    const cadDaEsteira =
      linhasEsteira.find((linha) => doEscopo.has(String(linha.enterprise_id ?? "").trim())) ??
      linhasEsteira[0] ??
      null;

    const meta = entity?.metadata ?? {};
    // A MESMA mescla de montarCadDeEntidade: metadata cru < C2X < esteira < correção humana.
    const ficha: Record<string, unknown> = {
      ...(meta.cadastro ?? {}),
      ...(c2x ? mapearC2xParaFicha(c2x) : {}),
      ...(cadDaEsteira?.ficha ?? {}),
      ...(meta.cadastroEditado ?? {}),
    };

    const listaContatos = contatos ?? [];
    const emails = listaContatos
      .filter((item) => item.contact_type === "email" && item.value.trim())
      .map((item) => item.value.trim().toLowerCase());

    const end = (enderecos ?? [])[0] ?? null;
    const rel = (relConjuge ?? [])[0] ?? null;
    const daEsteira = (cadDaEsteira?.ficha ?? {}) as Record<string, unknown>;

    const conjuge = {
      cpf: texto(daEsteira.conjugeCpf) || texto(rel?.metadata?.cpf) || texto(c2x?.spouse?.cpf) || null,
      documento: texto(c2x?.spouse?.document) || null,
      email: texto(daEsteira.conjugeEmail) || texto(rel?.metadata?.email) || texto(c2x?.spouse?.email) || null,
      nascimento:
        formatDateBR(texto(daEsteira.conjugeNascimento)) ||
        texto(rel?.metadata?.dataNascimento) ||
        texto(c2x?.spouse?.birthday) ||
        null,
      nome: texto(daEsteira.conjugeNome) || texto(c2x?.spouse?.name) || texto(rel?.label) || null,
      profissao: texto(c2x?.spouse?.profession) || null,
      telefone:
        texto(daEsteira.conjugeTelefone) || texto(rel?.metadata?.phone) || texto(c2x?.spouse?.phone) || null,
    };

    const ehPj = entity?.entity_kind === "pj" || Boolean(c2x?.isCompany);
    const nome =
      titleCase(texto(entity?.display_name) || texto(entity?.trade_name) || texto(entity?.legal_name)) ||
      "Sem nome";

    const grupos = montarGruposDeCadastro({
      c2x,
      conjuge,
      contatos: {
        email: emails[0] ?? null,
        telefone:
          listaContatos.find((item) => item.contact_type === "whatsapp")?.value ??
          listaContatos.find((item) => item.contact_type === "phone")?.value ??
          null,
      },
      documento: texto(entity?.document_masked) || texto(c2x?.cpf) || texto(c2x?.cnpj) || null,
      ehPj,
      endereco: end
        ? {
            bairro: texto(end.district),
            cep: texto(end.postal_code),
            cidade: texto(end.city),
            complemento: texto(end.complement),
            logradouro: texto(end.street),
            numero: texto(end.number),
            uf: texto(end.state),
          }
        : null,
      ficha,
      nome,
      razaoSocial: ehPj ? texto(entity?.legal_name) || null : null,
    });

    return { c2xUserId, conjugeNome: conjuge.nome, emails, grupos };
  } catch {
    return CADASTRO_VAZIO;
  }
}

/**
 * O corretor do contrato da pessoa DENTRO do escopo (C2X: acquisition_requests.corretor_id).
 * A lista/carteira não traz corretor (o C2X liga corretor à PROPOSTA, não à unidade), então é
 * uma consulta própria — sempre estreitada pelos codes da sessão.
 */
export async function lerCorretorDoContrato(
  c2xUserId: null | number,
  codes: string[],
): Promise<null | string> {
  if (!c2xUserId || codes.length === 0) return null;

  const pool = getHadesDbPool();
  if (!pool.ok) return null;

  try {
    const placeholders = codes.map(() => "?").join(",");
    const [linhas] = await pool.pool.query(
      `select coalesce(nullif(trim(cor.name), ''), nullif(trim(cor.fantasy_name), ''),
              nullif(trim(cor.social_name), '')) as corretor_name
         from acquisition_requests ar
         join enterprise_unities eu on eu.id = ar.enterprise_unity_id
         join enterprises e on e.id = eu.enterprise_id
         join users cor on cor.id = ar.corretor_id
        where ar.client_id = ? and e.code in (${placeholders})
        order by ar.created_at desc, ar.id desc
        limit 1`,
      [c2xUserId, ...codes],
    );

    const nome = (linhas as Array<{ corretor_name: null | string }>)[0]?.corretor_name;
    return nome?.trim() ? nome.trim() : null;
  } catch {
    return null;
  }
}
