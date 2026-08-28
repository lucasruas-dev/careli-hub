// Monta a CAD REAL (a mesma `montarCadPdf` do wizard) a partir dos dados JÁ salvos de uma
// entidade — para anexar a ficha de verdade no disparo de reprovação de crédito, em vez de um
// PDF de amostra.
//
// Fonte dos dados = o MESMO read-model do GET de /api/apolo/board/[id]:
//   metadata.cadastro (importação)  <  c2xCadastro (ficha ao vivo do C2X)  <  apolo_esteira.ficha
//   (o que o operador editou; ganha de tudo), + endereço, contatos e cônjuge (tabelas próprias).
// A montagem das seções ESPELHA `montarCadDoc` (blocks/cadastro/cadastro-flow.tsx) e `montarSecoes`
// (blocks/board/board-view.tsx): mesma ordem, mesmos rótulos. O nome vai no topo da ficha, então
// não é repetido como campo (idêntico ao wizard).
//
// A SEÇÃO NOVA "Análise de crédito" (por último) vem da última consulta de sucesso em
// `serasa_consultas` daquele entity_id, e carrega SÓ o STATUS (aprovado/reprovado) + a data.
// Regra do Lucas (21/jul): os valores em R$ (score, restrições, motivo) NÃO vão na CAD — eles
// ficam só no comprovante da consulta, que é outra feature. A CAD é uma versão só, a mesma que
// vai pro coordenador e pro corretor.

import {
  C2X_ESCOLARIDADE,
  C2X_ESTADO_CIVIL,
  C2X_FAIXA_RENDA,
  C2X_REGIME_BENS,
  C2X_SEXO,
  calcIdade,
  formatDateBR,
  normalizeSearch,
  titleCase,
} from "@/lib/apolo/c2x-fields";
import type { C2xOption } from "@/lib/apolo/c2x-fields";
import { C2X_PROFISSOES } from "@/lib/apolo/c2x-professions";
import { profissaoDeclarada, profissaoExibida } from "@/lib/apolo/profissao";
import { gerarCodigoAutenticacao } from "@/lib/apolo/cadastro-persist";
import { lerCadDaEsteira } from "@/lib/apolo/esteira-cad";
import { createApoloAdminClient, fetchC2xCadastroByEntity } from "@/lib/apolo/server";
import type { ApoloC2xCadastro } from "@/lib/apolo/types";
import { formatarTelefoneBR } from "@/lib/format/phone-br";
import { avaliarCredito } from "@/lib/serasa/avaliacao";
import { resolverLimiteCredito } from "@/lib/apolo/limite-credito";
import type { CadCampo, CadDoc, CadSecao } from "@/modules/apolo/blocks/cadastro/cad-pdf";

type AdminClient = NonNullable<ReturnType<typeof createApoloAdminClient>>;

type EntityRow = {
  created_at: string;
  display_name: string;
  document_masked: string | null;
  entity_kind: string;
  id: string;
  legal_name: string | null;
  metadata: {
    autenticacao?: { codigo?: string } | null;
    bornRole?: string;
    cadastro?: Record<string, unknown>;
  } | null;
  trade_name: string | null;
};

type AddressRow = {
  city: string | null;
  complement: string | null;
  district: string | null;
  number: string | null;
  postal_code: string | null;
  state: string | null;
  street: string | null;
};

type ContactRow = { contact_type: string; value: string };

type RelConjugeRow = { label: string | null; metadata: Record<string, unknown> | null };

type ConsultaRow = {
  created_at: string;
  report_name: string | null;
  resposta: unknown;
  resumo: unknown;
  status: string;
};

const texto = (v: unknown): string => (typeof v === "string" ? v : v == null ? "" : String(v));

// Rótulo de uma lista do C2X a partir do id (string ou número), como `label`/`opcao` no wizard.
const opcao = (lista: C2xOption[], id: unknown): string =>
  lista.find((o) => String(o.id) === texto(id))?.label ?? "";

const campo = (label: string, value: string, full = false): CadCampo => ({ full, label, value });

// ---- espelho de board/[id] GET: reverte um VALOR do C2X para o id que a ficha usa nos selects.
function idPorRotulo(lista: C2xOption[], valor: string | null): string {
  if (!valor) return "";
  const alvo = normalizeSearch(valor);
  const achado = lista.find((o) => normalizeSearch(o.label) === alvo);
  return achado ? String(achado.id) : "";
}

// "02/05/1980" (BR) -> "1980-05-02" (ISO), como o board/[id] faz para os inputs de data.
function brParaIso(valor: string | null): string {
  if (!valor) return "";
  const m = valor.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : valor;
}

// Mapeia a ficha AO VIVO do C2X para as MESMAS chaves de `cadastro` que a ficha lê — cópia
// fiel de mapearC2xParaFicha em app/api/apolo/board/[id]/route.ts (só devolve chave com valor).
// Exportada porque a aba Cadastro do portal do incorporador (lib/apolo/incorporador/
// ficha-cadastro.ts) precisa da MESMA tradução valor→id para a prioridade
// metadata.cadastro < C2X < esteira.ficha ser idêntica à do CRM interno.
export function mapearC2xParaFicha(c2x: ApoloC2xCadastro): Record<string, string> {
  const bruto: Record<string, string> = {
    dataNascimento: brParaIso(c2x.birthday),
    nomeMae: c2x.motherName ?? "",
    naturalidade: c2x.naturalness ?? "",
    nacionalidade: c2x.nacionality ?? "",
    sexoId: idPorRotulo(C2X_SEXO, c2x.sex),
    estadoCivilId: idPorRotulo(C2X_ESTADO_CIVIL, c2x.civilState),
    regimeBensId: idPorRotulo(C2X_REGIME_BENS, c2x.propertyRegime),
    escolaridadeId: idPorRotulo(C2X_ESCOLARIDADE, c2x.schooling),
    rendaId: idPorRotulo(C2X_FAIXA_RENDA, c2x.salaryRange),
    profissaoId: idPorRotulo(C2X_PROFISSOES, c2x.profession),
    logradouro: c2x.street ?? "",
    numero: c2x.number ?? "",
    complemento: c2x.complement ?? "",
    bairro: c2x.district ?? "",
    cep: c2x.zipcode ?? "",
    cidade: c2x.city ?? "",
    uf: c2x.state ?? "",
    dataAbertura: brParaIso(c2x.openCompanyDate),
    dataAtualizacaoCadastral: brParaIso(c2x.socialContractUpdatedAt),
    creci: c2x.creciNumber ?? "",
  };
  const limpo: Record<string, string> = {};
  for (const [chave, valor] of Object.entries(bruto)) {
    if (valor) limpo[chave] = valor;
  }
  return limpo;
}

// ---- Análise de crédito ----------------------------------------------------------------------

function dataBR(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
}

// Monta a seção "Análise de crédito" a partir da última consulta de sucesso. SÓ o status
// (aprovado/reprovado) + a data — os valores em R$ ficam no comprovante, não na CAD. Sem
// consulta, devolve um único campo informativo (o montarCadPdf ainda descarta seção 100% vazia).
//
// O `limite` DEVE ser o mesmo da decisão (o do empreendimento). Sem ele, avaliarCredito usaria o
// default R$ 1.000 e a CAD poderia dizer APROVADO num aviso de reprovação (empreendimento com
// limite < 1.000).
function secaoAnaliseCredito(consulta: ConsultaRow | null, limite: number | null): CadSecao {
  if (!consulta) {
    return {
      fields: [campo("Análise", "Sem consulta registrada", true)],
      title: "Análise de crédito",
    };
  }

  const veredito = avaliarCredito(consulta.resposta, limite ?? undefined);

  return {
    fields: [
      campo("Resultado", veredito.aprovado ? "APROVADO" : "REPROVADO"),
      campo("Consultado em", dataBR(consulta.created_at)),
    ],
    title: "Análise de crédito",
  };
}

// ---- montagem principal ----------------------------------------------------------------------

// `enterpriseId` diz de QUAL CAD é o PDF. Desde a 0080 a mesma pessoa pode ter CAD em vários
// empreendimentos, e "a CAD do fulano" deixou de ser uma coisa só: cada uma tem a sua ficha, o
// seu corretor e a sua imobiliária. Sem o id, monta a MAIS RECENTE — mesmo default do Board, que
// hoje mostra um card por pessoa. Quem chamar com o id em mãos deve passar.
export async function montarCadDeEntidade(
  adminClient: AdminClient,
  entityId: string,
  opts: { enterpriseId?: null | number | string } = {},
): Promise<CadDoc | null> {
  const { data: entityData } = await adminClient
    .from("apolo_entities")
    .select(
      "id, display_name, legal_name, trade_name, document_masked, entity_kind, metadata, created_at",
    )
    .eq("id", entityId)
    .maybeSingle();

  const entity = (entityData ?? null) as EntityRow | null;
  if (!entity) return null;

  const [
    { data: enderecos },
    { data: contatos },
    esteiraData,
    { data: relConjugeData },
    { data: consultaData },
  ] = await Promise.all([
    adminClient
      .from("apolo_addresses")
      .select("street, number, complement, district, city, state, postal_code")
      .eq("entity_id", entityId)
      .limit(5),
    adminClient
      .from("apolo_contacts")
      .select("contact_type, value")
      .eq("entity_id", entityId)
      .limit(20),
    lerCadDaEsteira<{
      corretor: string | null;
      ficha: Record<string, unknown> | null;
      imobiliaria: string | null;
    }>(adminClient, entityId, "ficha, corretor, imobiliaria", {
      enterpriseId: opts.enterpriseId,
    }),
    adminClient
      .from("apolo_relationships")
      .select("label, metadata")
      .eq("entity_id", entityId)
      .eq("relationship_type", "conjuge")
      .limit(1)
      .maybeSingle(),
    // ⚠️ FILTRA PELO DOCUMENTO DO TITULAR, não só pelo entity_id. A consulta de crédito do
    // CÔNJUGE é gravada no entity_id do titular (o cônjuge não é entidade própria), então sem
    // este filtro ela seria lida como "a última consulta da ficha" e a CAD do titular sairia
    // carimbada com o resultado do cônjuge. Filtramos por documento e não por `finalidade`
    // porque finalidade é texto livre e as linhas antigas não têm valor confiável.
    adminClient
      .from("serasa_consultas")
      .select("resposta, resumo, report_name, created_at, status")
      .eq("entity_id", entityId)
      .eq("documento", (entity.document_masked ?? "").replace(/\D/g, ""))
      .eq("status", "sucesso")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const enderecoRow = ((enderecos ?? []) as AddressRow[])[0] ?? null;
  // Normaliza os nomes de coluna do banco (street, postal_code…) para as chaves da ficha
  // (logradouro, cep…), como o GET de board/[id] devolve.
  const endereco: Record<string, string> | null = enderecoRow
    ? {
        bairro: enderecoRow.district ?? "",
        cep: enderecoRow.postal_code ?? "",
        cidade: enderecoRow.city ?? "",
        complemento: enderecoRow.complement ?? "",
        logradouro: enderecoRow.street ?? "",
        numero: enderecoRow.number ?? "",
        uf: enderecoRow.state ?? "",
      }
    : null;
  const lista = (contatos ?? []) as ContactRow[];
  const esteira = esteiraData;
  const daEsteira = (esteira?.ficha ?? {}) as Record<string, unknown>;
  const relConjuge = (relConjugeData ?? null) as RelConjugeRow | null;
  const consulta = (consultaData ?? null) as ConsultaRow | null;

  // Ficha AO VIVO do C2X (best-effort, igual ao GET): se o C2X estiver fora ou a entidade não
  // tiver vínculo, segue sem — não derruba a geração da CAD.
  let c2xMapeado: Record<string, string> = {};
  try {
    const { data: sourceLinks } = await adminClient
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

    if (links.length > 0) {
      const { cadastro: c2xByEntity } = await fetchC2xCadastroByEntity(
        adminClient,
        links,
        new Set<number>(),
        new Set<number>(),
      );
      const c2x = c2xByEntity.get(entityId);
      if (c2x) c2xMapeado = mapearC2xParaFicha(c2x);
    }
  } catch (erro) {
    console.error("[apolo] montarCadDeEntidade: c2xCadastro indisponivel", erro);
  }

  // Prioridade idêntica ao GET: correção humana > esteira > C2X > metadata cru.
  // A edição do Board entra POR ÚLTIMO — o C2X manda em creci, datas e endereço, e sem isso a
  // correção do operador ficaria invisível aqui enquanto aparece certa na tela de validação.
  const c = {
    ...(entity.metadata?.cadastro ?? {}),
    ...c2xMapeado,
    ...daEsteira,
    ...((entity.metadata as { cadastroEditado?: Record<string, unknown> } | null)
      ?.cadastroEditado ?? {}),
  } as Record<string, unknown>;

  const contato = {
    email: lista.find((item) => item.contact_type === "email")?.value ?? "",
    telefone:
      lista.find((item) => item.contact_type === "whatsapp")?.value ??
      lista.find((item) => item.contact_type === "phone")?.value ??
      "",
  };

  const conjuge = {
    cpf: texto(daEsteira.conjugeCpf) || texto(relConjuge?.metadata?.cpf),
    dataNascimento:
      texto(daEsteira.conjugeNascimento) || texto(relConjuge?.metadata?.dataNascimento),
    email: texto(daEsteira.conjugeEmail) || texto(relConjuge?.metadata?.email),
    nome: texto(daEsteira.conjugeNome) || (relConjuge?.label ?? ""),
    nomeMae: texto(daEsteira.conjugeMae) || texto(relConjuge?.metadata?.nomeMae),
    telefone: texto(daEsteira.conjugeTelefone) || texto(relConjuge?.metadata?.phone),
  };

  const isPj = entity.entity_kind === "pj";
  const bornRole = texto(entity.metadata?.bornRole);
  const isImobiliaria = bornRole === "imobiliaria";
  const nome = titleCase(entity.legal_name || entity.display_name);
  const documento = entity.document_masked ?? "";
  // Endereço: o que o operador editou (ficha) ganha do endereço cadastrado — como montarSecoes.
  const end = (chave: string): string => texto(c[chave]) || texto(endereco?.[chave]);
  // 2 = Casado, 6 = União Estável (ids do C2X). Decide regime de bens e a seção Cônjuge.
  const casado = ["2", "6"].includes(texto(c.estadoCivilId));

  const secoes: CadSecao[] = [];

  if (isPj) {
    // "Dados da empresa" — espelha montarCadDoc PJ (razão social vai no topo, não como campo).
    secoes.push({
      fields: [
        campo("Nome fantasia", titleCase(entity.trade_name ?? "")),
        campo("CNPJ", documento),
        campo("Porte", texto(c.porte)),
        campo("Abertura", formatDateBR(texto(c.dataAbertura))),
        campo("Atualização cadastral", formatDateBR(texto(c.dataAtualizacaoCadastral))),
        campo("Situação cadastral", texto(c.situacaoCadastral)),
        campo("Natureza jurídica", texto(c.naturezaJuridica), true),
        campo("CNAE", texto(c.cnae)),
        campo("Atividade principal", texto(c.atividade), true),
        ...(texto(c.creci) ? [campo("CRECI Jurídico", texto(c.creci))] : []),
      ],
      title: "Dados da empresa",
    });
    // Endereço PJ (sem complemento, como montarCadDoc PJ).
    secoes.push({
      fields: [
        campo("Logradouro", titleCase(end("logradouro")), true),
        campo("Número", end("numero")),
        campo("Bairro", titleCase(end("bairro"))),
        campo("CEP", end("cep")),
        campo("Cidade", titleCase(end("cidade"))),
        campo("UF", end("uf")),
      ],
      title: "Endereço",
    });
    secoes.push({
      fields: [
        campo("Telefone", formatarTelefoneBR(texto(c.telefone) || contato.telefone)),
        campo("E-mail", texto(c.email) || contato.email),
      ],
      title: "Contato",
    });
  } else {
    // Identificação (PF) — espelha montarCadDoc: nome vai no topo, não é campo.
    secoes.push({
      fields: [
        campo("CPF", documento),
        campo("Nascimento", formatDateBR(texto(c.dataNascimento))),
        campo("Idade", calcIdade(texto(c.dataNascimento))),
        campo("Nome da mãe", titleCase(texto(c.nomeMae)), true),
        campo("Naturalidade", titleCase(texto(c.naturalidade))),
        campo("Nacionalidade", titleCase(texto(c.nacionalidade))),
        campo("Sexo", opcao(C2X_SEXO, c.sexoId)),
        campo("Estado civil", opcao(C2X_ESTADO_CIVIL, c.estadoCivilId)),
        ...(texto(c.regimeBensId)
          ? [campo("Regime de bens", opcao(C2X_REGIME_BENS, c.regimeBensId))]
          : []),
      ],
      title: "Identificação",
    });
    secoes.push({
      fields: [
        campo("Escolaridade", opcao(C2X_ESCOLARIDADE, c.escolaridadeId)),
        campo("Faixa de renda", opcao(C2X_FAIXA_RENDA, c.rendaId)),
        campo("Patrimônio", texto(c.patrimonio)),
        // PROFISSÃO DIGITADA À MÃO (fora das 234 do C2X) sai NA CAD, marcada "(a padronizar)" —
        // a pendência tem que estar no papel que o analista lê, não só na tela de validação.
        // Já padronizada, o texto original vira um campo próprio: é o que o cliente DECLAROU, e
        // esse dado não se perde ao ser traduzido para o catálogo. Ver lib/apolo/profissao.ts.
        campo("Profissão", profissaoExibida(c.profissaoId, c.profissaoOutro)),
        ...(profissaoDeclarada(c.profissaoId, c.profissaoOutro)
          ? [campo("Profissão declarada", profissaoDeclarada(c.profissaoId, c.profissaoOutro))]
          : []),
      ],
      title: "Perfil",
    });
    secoes.push({
      fields: [
        campo("Logradouro", titleCase(end("logradouro")), true),
        campo("Número", end("numero")),
        campo("Complemento", titleCase(end("complemento"))),
        campo("Bairro", titleCase(end("bairro"))),
        campo("CEP", end("cep")),
        campo("Cidade", titleCase(end("cidade"))),
        campo("UF", end("uf")),
      ],
      title: "Endereço",
    });
    secoes.push({
      fields: [
        campo("Telefone", formatarTelefoneBR(texto(c.telefone) || contato.telefone)),
        campo("E-mail", texto(c.email) || contato.email, true),
      ],
      title: "Contato",
    });
    // Cônjuge — só casado/união estável; campos limitados ao que o read-model carrega (espelha
    // a seção Cônjuge de montarSecoes).
    if (casado) {
      secoes.push({
        fields: [
          campo("Nome", titleCase(conjuge.nome), true),
          campo("CPF", conjuge.cpf),
          campo("Nascimento", formatDateBR(conjuge.dataNascimento)),
          campo("Idade", calcIdade(conjuge.dataNascimento)),
          campo("Nome da mãe", titleCase(conjuge.nomeMae), true),
          campo("Telefone", formatarTelefoneBR(conjuge.telefone)),
          campo("E-mail", conjuge.email, true),
        ],
        title: "Cônjuge",
      });
    }
  }

  // SEÇÃO NOVA, sempre por último. O limite vem do EMPREENDIMENTO do cliente (o mesmo da decisão),
  // pra CAD e veredito nunca se contradizerem. Só resolve quando há consulta (evita query à toa).
  const limiteCredito = consulta
    ? await resolverLimiteCredito(adminClient, entityId, opts.enterpriseId)
    : null;
  secoes.push(secaoAnaliseCredito(consulta, limiteCredito));

  const agora = new Date();
  const data = agora.toLocaleDateString("pt-BR");
  const hora = agora.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

  return {
    arquivo: `CAD - ${nome} - ${data} ${hora}`,
    // Toda CAD tem autenticação (regra do Lucas): usa o código salvo ou gera um determinístico
    // a partir do id da entidade — assim as importadas do C2X, que não têm o selo, também saem
    // com autenticação no rodapé.
    autenticacao:
      texto(entity.metadata?.autenticacao?.codigo) ||
      gerarCodigoAutenticacao(entity.id, new Date(entity.created_at)),
    corretor: esteira?.corretor ?? undefined,
    data,
    hora,
    imobiliaria: esteira?.imobiliaria ?? undefined,
    nome,
    papel: isImobiliaria ? "Imobiliária" : isPj ? "Pessoa jurídica" : "Prospect",
    secoes,
    titulo: isImobiliaria ? "Cadastro de Imobiliária" : "Cadastro de CAD",
    vinculo: "",
  };
}
