import { NextResponse } from "next/server";

import { authorizeApoloRead, authorizeApoloWrite } from "@/lib/apolo/auth";
import { lerCadDaEsteira, normalizarEnterpriseId } from "@/lib/apolo/esteira-cad";
import { formatarTelefoneBR } from "@/lib/format/phone-br";
import { toTitleCase } from "@/lib/format/name-case";
import { createApoloAdminClient, fetchC2xCadastroByEntity } from "@/lib/apolo/server";
import {
  C2X_ESCOLARIDADE,
  C2X_ESTADO_CIVIL,
  C2X_FAIXA_RENDA,
  C2X_REGIME_BENS,
  C2X_SEXO,
  normalizeSearch,
} from "@/lib/apolo/c2x-fields";
import type { C2xOption } from "@/lib/apolo/c2x-fields";
import { C2X_PROFISSOES } from "@/lib/apolo/c2x-professions";
import type { ApoloC2xCadastro } from "@/lib/apolo/types";

// Ficha COMPLETA de um item da esteira, pro operador validar com o documento ao lado. Devolve os
// dados crus salvos no cadastro (metadata.cadastro + endereço + contatos); quem monta as seções
// é a tela, que já tem os catálogos (sexo, estado civil, profissão) e os formatadores.
// Ver [[project_esteira_credenciamento_venda]].
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type EntityRow = {
  created_at: string;
  display_name: string;
  document_masked: string | null;
  entity_kind: string;
  id: string;
  legal_name: string | null;
  metadata: {
    bornRole?: string;
    cadastro?: Record<string, unknown>;
    cadastroEditado?: Record<string, unknown>;
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

const texto = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

// `authorizeApoloWrite` devolve "local-hub-user" quando não há Supabase server-side; gravar
// isso em coluna uuid quebra o insert inteiro.
// Campos que são NOME de gente ou de lugar: vão para "Primeira Maiúscula".
const CAMPOS_DE_NOME = new Set([
  "bairro",
  "cidade",
  "complemento",
  "conjugeMae",
  "conjugeNome",
  "logradouro",
  "nacionalidade",
  "naturalidade",
  "nomeMae",
  "nomePai",
]);

function padronizar(chave: string, valor: unknown): unknown {
  if (typeof valor !== "string") return valor;
  if (chave.toLowerCase().includes("telefone")) return formatarTelefoneBR(valor);
  if (CAMPOS_DE_NOME.has(chave)) return toTitleCase(valor);
  return valor;
}

const ehUuid = (valor: string): boolean =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(valor);

// Reverte um VALOR já resolvido do C2X (ex.: "Masculino", "Casado (a)") para o ID que a tela
// de validação usa nos selects. A ficha lê `sexoId`/`estadoCivilId`/etc. e resolve o rótulo
// com `opcao(lista, id)`; o c2xCadastro já traz o rótulo pronto, então o caminho é o inverso:
// achar na lista o item cujo label bate (tolerante a acento/caixa) e devolver o id como string.
function idPorRotulo(lista: C2xOption[], valor: string | null): string {
  if (!valor) return "";
  const alvo = normalizeSearch(valor);
  const achado = lista.find((o) => normalizeSearch(o.label) === alvo);
  return achado ? String(achado.id) : "";
}

// "02/05/1980" (BR, como o c2xCadastro devolve) -> "1980-05-02" (ISO, o que o input date da
// ficha espera; a EXIBIÇÃO via formatDateBR e o calcIdade aceitam os dois formatos).
function brParaIso(valor: string | null): string {
  if (!valor) return "";
  const m = valor.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : valor;
}

// Converte a ficha AO VIVO do C2X (`ApoloC2xCadastro`, a mesma fonte da aba Cadastro do CRM
// 360) para as MESMAS chaves que a tela de validação lê de `cadastro` — ver `montarSecoes` em
// modules/apolo/blocks/board/board-view.tsx. Só devolve chave COM valor: assim o merge nunca
// apaga o que veio do metadata/esteira com uma string vazia.
function mapearC2xParaFicha(c2x: ApoloC2xCadastro): Record<string, string> {
  const bruto: Record<string, string> = {
    // Identificação (PF)
    dataNascimento: brParaIso(c2x.birthday),
    nomeMae: c2x.motherName ?? "",
    naturalidade: c2x.naturalness ?? "",
    nacionalidade: c2x.nacionality ?? "",
    sexoId: idPorRotulo(C2X_SEXO, c2x.sex),
    estadoCivilId: idPorRotulo(C2X_ESTADO_CIVIL, c2x.civilState),
    regimeBensId: idPorRotulo(C2X_REGIME_BENS, c2x.propertyRegime),
    // Perfil (PF)
    escolaridadeId: idPorRotulo(C2X_ESCOLARIDADE, c2x.schooling),
    rendaId: idPorRotulo(C2X_FAIXA_RENDA, c2x.salaryRange),
    profissaoId: idPorRotulo(C2X_PROFISSOES, c2x.profession),
    // Endereço
    logradouro: c2x.street ?? "",
    numero: c2x.number ?? "",
    complemento: c2x.complement ?? "",
    bairro: c2x.district ?? "",
    cep: c2x.zipcode ?? "",
    cidade: c2x.city ?? "",
    uf: c2x.state ?? "",
    // Empresa (PJ) — só os campos com correspondência direta no C2X.
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

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await authorizeApoloRead(request);
  if (!auth.ok) return auth.response;

  const adminClient = createApoloAdminClient();
  if (!adminClient) {
    return NextResponse.json({ error: "Supabase indisponivel." }, { status: 503 });
  }

  const { id } = await context.params;

  const { data: entity } = await adminClient
    .from("apolo_entities")
    .select(
      "id, display_name, legal_name, trade_name, document_masked, entity_kind, metadata, created_at",
    )
    .eq("id", id)
    .maybeSingle<EntityRow>();

  if (!entity) {
    return NextResponse.json({ error: "Entidade nao encontrada." }, { status: 404 });
  }

  const [{ data: enderecos }, { data: contatos }] = await Promise.all([
    adminClient
      .from("apolo_addresses")
      .select("street, number, complement, district, city, state, postal_code")
      .eq("entity_id", id)
      .limit(5),
    adminClient
      .from("apolo_contacts")
      .select("contact_type, value")
      .eq("entity_id", id)
      .limit(20),
  ]);

  const endereco = ((enderecos ?? []) as AddressRow[])[0] ?? null;
  const lista = (contatos ?? []) as ContactRow[];

  // A ficha vive em `apolo_esteira.ficha` (tabela própria) — o que o OCR leu, o que veio do
  // formulário do Asana e o que o OPERADOR digitou. Não pode ficar no metadata da entidade:
  // o sync do C2X substitui o metadata inteiro a cada rodada e apagaria o trabalho dele.
  //
  // ⚠️ `[id]` É A PESSOA, NÃO A CAD (a chave da esteira é `entity_id + enterprise_id` desde a
  // 0080). `?enterpriseId=` diz de qual CAD é a ficha; sem ele, a MAIS RECENTE. Enquanto o card
  // do Board for por pessoa, este default é o que mantém a tela coerente com o que ela lista.
  const enterpriseId = new URL(request.url).searchParams.get("enterpriseId");
  const esteiraRow = await lerCadDaEsteira<{
    ficha: Record<string, unknown> | null;
    ficha_editada_em: string | null;
  }>(adminClient, id, "ficha, ficha_editada_em", { enterpriseId });

  const daEsteira = (esteiraRow?.ficha ?? {}) as Record<string, unknown>;

  // O que o FORMULÁRIO do Asana diz sobre esta CAD (último laudo do diagnóstico). É a
  // referência que o operador usa para decidir: o Asana separa proponente de cônjuge e diz
  // se é PF ou PJ. Sem isso na tela, ele teria que abrir o Asana a cada ficha.
  const { data: laudoRow } = await adminClient
    .from("apolo_audit_events")
    .select("metadata, created_at")
    .eq("entity_id", id)
    .eq("action", "diagnostico_cad")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const laudo = ((laudoRow as { metadata: Record<string, unknown> } | null)?.metadata ??
    null) as Record<string, unknown> | null;

  // CÔNJUGE: vive em `apolo_relationships` (label = nome, metadata = cpf/nascimento/contato).
  // A tela precisa dele para o contrato — casado sem cônjuge não fecha venda.
  const { data: relConjuge } = await adminClient
    .from("apolo_relationships")
    .select("label, metadata")
    .eq("entity_id", id)
    .eq("relationship_type", "conjuge")
    .limit(1)
    .maybeSingle();

  const doRelacionamento = (relConjuge ?? null) as {
    label: string | null;
    metadata: Record<string, unknown> | null;
  } | null;
  // Ficha AO VIVO do C2X. Os CADs que vieram do sync têm `metadata.cadastro` só com nomes
  // (sem nascimento/mãe/sexo/naturalidade/endereço) e `apolo_esteira.ficha` só com o que o
  // operador mexeu — por isso a validação mostrava tudo "—" para eles. A fonte completa é a
  // MESMA da aba Cadastro do CRM 360: o `users` do C2X, resolvido por fetchC2xCadastroByEntity.
  // Best-effort: se o C2X estiver fora do ar (ou a entidade não tiver vínculo com o C2X), cai
  // no comportamento anterior sem derrubar a rota — a ficha do Apolo puro nem passa por aqui.
  let c2xMapeado: Record<string, string> = {};
  try {
    const { data: sourceLinks } = await adminClient
      .from("apolo_source_links")
      .select("entity_id, source_system, source_table, source_id")
      .eq("entity_id", id)
      .eq("source_system", "c2x")
      .eq("source_table", "users");

    const links = (sourceLinks ?? []) as {
      entity_id: string;
      source_id: string | null;
      source_system: string | null;
      source_table: string | null;
    }[];

    if (links.length > 0) {
      // Sets vazios: só afetam flags de comprador/inadimplência no grafo de relacionamentos,
      // não o cadastro básico do titular que a ficha precisa.
      const { cadastro: c2xByEntity } = await fetchC2xCadastroByEntity(
        adminClient,
        links,
        new Set<number>(),
        new Set<number>(),
      );
      const c2x = c2xByEntity.get(id);
      if (c2x) {
        c2xMapeado = mapearC2xParaFicha(c2x);
      }
    }
  } catch (erro) {
    console.error("[apolo] board validacao: c2xCadastro indisponivel", erro);
  }

  // Prioridade: o que o operador editou (esteira) GANHA do C2X, e o C2X GANHA do metadata cru
  // da importação. Assim a digitação humana nunca é sobrescrita e o CAD do C2X deixa de vir vazio.
  const cadastro = {
    ...(entity.metadata?.cadastro ?? {}),
    ...c2xMapeado,
    ...daEsteira,
    // ⚠️ POR ÚLTIMO, DE PROPÓSITO: `cadastroEditado` é o que um operador DIGITOU nesta tela para
    // uma ficha sem esteira (imobiliária). Se entrasse junto com `cadastro`, o C2X passaria por
    // cima — e o C2X manda em `creci`, `dataAbertura`, `dataAtualizacaoCadastral` e no endereço
    // inteiro. O operador corrigiria o CRECI, veria salvo, e no F5 o valor velho voltaria.
    // Correção humana ganha de tudo; é a única camada que não tem de onde ser regenerada.
    ...(entity.metadata?.cadastroEditado ?? {}),
  };

  return NextResponse.json(
    {
      data: {
        cadastro,
        contato: {
          email: lista.find((c) => c.contact_type === "email")?.value ?? "",
          // ⚠️ O C2X grava o telefone como 'whatsapp' (4.064 registros) e quase nunca como
          // 'phone' (248). Procurar só por 'phone' deixava 94% das fichas sem telefone na
          // validação — o operador via um traço e ia atrás de um dado que já estava no banco.
          telefone:
            lista.find((c) => c.contact_type === "whatsapp")?.value ??
            lista.find((c) => c.contact_type === "phone")?.value ??
            "",
        },
        endereco: endereco
          ? {
              bairro: endereco.district ?? "",
              cep: endereco.postal_code ?? "",
              cidade: endereco.city ?? "",
              complemento: endereco.complement ?? "",
              logradouro: endereco.street ?? "",
              numero: endereco.number ?? "",
              uf: endereco.state ?? "",
            }
          : null,
        // Referência do Asana + divergências, para a tela avisar em vez de o operador adivinhar.
        asana: laudo
          ? {
              conjuge: (laudo.conjugeAsana as string) ?? null,
              perfil: (laudo.perfilAsana as string) ?? null,
              proponente: (laudo.proponenteAsana as string) ?? null,
              tipoDiverge: Boolean(laudo.divergeTipo),
              tipoNoAsana: (laudo.tipoNoAsana as string) ?? null,
              veredito: (laudo.veredito as string) ?? null,
            }
          : null,
        // O que o operador editou na ficha GANHA do que veio do relacionamento.
        // A ficha COMPLETA (23/08): sexo, renda, escolaridade, profissão, patrimônio e
        // naturalidade agora chegam do wizard via metadata do relacionamento — antes só o PDF
        // os tinha, e a validação abria vazia.
        conjuge: {
          cpf: texto(daEsteira.conjugeCpf) || texto(doRelacionamento?.metadata?.cpf),
          dataNascimento:
            texto(daEsteira.conjugeNascimento) ||
            texto(doRelacionamento?.metadata?.dataNascimento),
          email: texto(daEsteira.conjugeEmail) || texto(doRelacionamento?.metadata?.email),
          escolaridadeId:
            texto(daEsteira.conjugeEscolaridadeId) ||
            texto(doRelacionamento?.metadata?.escolaridadeId),
          nacionalidade:
            texto(daEsteira.conjugeNacionalidade) ||
            texto(doRelacionamento?.metadata?.nacionalidade),
          naturalidade:
            texto(daEsteira.conjugeNaturalidade) ||
            texto(doRelacionamento?.metadata?.naturalidade),
          nome: texto(daEsteira.conjugeNome) || (doRelacionamento?.label ?? ""),
          nomeMae: texto(daEsteira.conjugeMae) || texto(doRelacionamento?.metadata?.nomeMae),
          patrimonio:
            texto(daEsteira.conjugePatrimonio) ||
            texto(doRelacionamento?.metadata?.patrimonio),
          profissaoId:
            texto(daEsteira.conjugeProfissaoId) ||
            texto(doRelacionamento?.metadata?.profissaoId),
          // Profissão DIGITADA no wizard (fora das 234 do C2X). Chega para a validação padronizar;
          // nunca vira `profession` no C2X. Ver lib/apolo/profissao.ts.
          profissaoOutro:
            texto(daEsteira.conjugeProfissaoOutro) ||
            texto(doRelacionamento?.metadata?.profissaoOutro),
          rendaId:
            texto(daEsteira.conjugeRendaId) || texto(doRelacionamento?.metadata?.rendaId),
          sexoId:
            texto(daEsteira.conjugeSexoId) || texto(doRelacionamento?.metadata?.sexoId),
          telefone:
            texto(daEsteira.conjugeTelefone) || texto(doRelacionamento?.metadata?.phone),
        },
        entidade: {
          criadoEm: entity.created_at,
          documento: entity.document_masked ?? "",
          nome: entity.legal_name || entity.display_name,
          nomeFantasia: entity.trade_name ?? "",
          papel: entity.metadata?.bornRole ?? "",
          tipo: entity.entity_kind,
        },
      },
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

// Salva o que o OPERADOR completou na validação.
//
// Grava em `apolo_esteira.ficha`, não no metadata da entidade: o sync do C2X substitui o
// metadata inteiro a cada rodada e apagaria o trabalho dele — foi o que aconteceu com a
// esteira em 20/jul. Aqui o prejuízo seria pior, porque é digitação humana.
//
// Grava a ficha de quem NÃO tem CAD na esteira (hoje: as imobiliárias e demais PJ) em
// `apolo_entities.metadata.cadastro` — a mesma chave que o GET lê como base da ficha.
//
// ⚠️ O `metadata` é REESCRITO INTEIRO no update, então ele é lido antes e mesclado em dois
// níveis: o objeto de fora (para não derrubar `bornRole` e o que mais viva ali) e o `cadastro`
// de dentro (para não derrubar os campos que o operador não tocou). Escrever `{ cadastro }`
// direto apagaria o resto do metadata — foi assim que o sync do C2X já apagou metadata antes.
async function salvarNoCadastroDaEntidade(
  adminClient: ReturnType<typeof createApoloAdminClient> & object,
  entityId: string,
  campos: Record<string, unknown>,
  userId: string,
): Promise<
  | { auditoria: null | string; ok: true }
  | { error: string; ok: false; status: number }
> {
  const { data: entidade, error: erroLeitura } = await adminClient
    .from("apolo_entities")
    .select("metadata")
    .eq("id", entityId)
    .maybeSingle();

  if (erroLeitura) {
    return { error: erroLeitura.message, ok: false, status: 500 };
  }
  if (!entidade) {
    return { error: "Ficha não encontrada.", ok: false, status: 404 };
  }

  const metadata = (entidade.metadata ?? {}) as Record<string, unknown>;
  // Grava numa camada PRÓPRIA (`cadastroEditado`), não em `cadastro`. Duas razões: o GET a
  // aplica por último, então a correção não é encoberta pelo C2X ao vivo; e o que veio da
  // importação continua intacto ao lado, para efeito de comparação e auditoria.
  const cadastroAtual = (metadata.cadastroEditado ?? {}) as Record<string, unknown>;
  const cadastro: Record<string, unknown> = { ...cadastroAtual };

  // Mesma regra do caminho da esteira: vazio APAGA (deixa o operador limpar o que veio errado
  // do OCR) e o que fica entra padronizado pelo servidor.
  for (const [chave, valor] of Object.entries(campos)) {
    if (valor === "" || valor === null) {
      delete cadastro[chave];
      continue;
    }
    cadastro[chave] = padronizar(chave, valor);
  }

  // NOME FANTASIA tem coluna própria (`apolo_entities.trade_name`) e é DELA que o CRM lê
  // (server.ts:3249 `fantasyName`). Gravar só no cadastro deixaria a tela de validação certa e o
  // resto do Apolo mostrando o nome antigo. O sync do C2X não desfaz: desde 04/08 ele usa
  // ON CONFLICT DO NOTHING para as tabelas de identidade e não toca em quem já existe.
  const patchEntidade: Record<string, unknown> = {
    metadata: { ...metadata, cadastroEditado: cadastro },
  };
  if (typeof campos.nomeFantasia === "string") {
    patchEntidade.trade_name = campos.nomeFantasia.trim() || null;
  }

  const { error } = await adminClient
    .from("apolo_entities")
    .update(patchEntidade)
    .eq("id", entityId);

  if (error) {
    return { error: error.message, ok: false, status: 500 };
  }

  // TELEFONE E E-MAIL TAMBÉM VÃO PARA `apolo_contacts`. A tela mostra o cadastro por cima do
  // contato, então gravar só no metadata deixaria a tela certa e o resto do sistema errado: o
  // disparo de credenciamento, o phone-match do cockpit e a fila leem de `apolo_contacts`. O
  // operador corrigiria o número, veria "salvo", e a mensagem continuaria indo para o antigo.
  //
  // `atualizarContatoDoContato` é reusada porque ela grava `value` E `normalized_value` juntos —
  // o upsert do CRM deixa o normalizado velho e a busca passa a devolver a ficha errada.
  const telefoneNovo = typeof campos.telefone === "string" ? campos.telefone : null;
  const emailNovo = typeof campos.email === "string" ? campos.email : null;
  if (telefoneNovo || emailNovo) {
    const { atualizarContatoDoContato } = await import("@/lib/iris/apolo/escrita-contato");
    const gravado = await atualizarContatoDoContato(adminClient, {
      email: emailNovo,
      entidadeId: entityId,
      telefone: telefoneNovo,
    });
    // ⚠️ FALHA AQUI É FALHA DE SALVAMENTO, e devolve erro. A versão anterior devolvia
    // `{ auditoria: erro, ok: true }` — a resposta saía 200, a tela lia só `resposta.ok` e dizia
    // "salvo", enquanto o telefone continuava o antigo para todo o resto do sistema. Ninguém lê
    // o campo `auditoria` na tela, então aquilo era engolir o erro com passos extras.
    if (!gravado.ok) {
      return {
        error: `Cadastro salvo, mas o contato nao foi atualizado: ${gravado.erro}`,
        ok: false,
        status: 500,
      };
    }
  }

  // ⚠️ COMPARAÇÃO ESTÁVEL, não `String()`. Sócio e corretor chegam aqui como ARRAY, e
  // `String([{...}])` devolve "[object Object]" para qualquer conteúdo: dois arrays diferentes
  // pareciam iguais e a edição do telefone do representante nunca virava linha de auditoria.
  const mesmoValor = (a: unknown, b: unknown): boolean => {
    if (typeof a === "object" && a !== null) return JSON.stringify(a) === JSON.stringify(b);
    if (typeof b === "object" && b !== null) return false;
    return String(a ?? "") === String(b ?? "");
  };

  const trilha = Object.entries(campos)
    .filter(([chave, valor]) => !mesmoValor(cadastroAtual[chave], valor))
    .map(([chave, valor]) => ({
      action: "edit_ficha",
      actor_user_id: ehUuid(userId) ? userId : null,
      entity_id: entityId,
      field_name: chave,
      metadata: {
        de: cadastroAtual[chave] ?? null,
        origem: "board-validacao-entidade",
        para: valor === "" || valor === null ? null : valor,
      },
      status: "mapped",
    }));

  let auditoria: null | string = null;
  if (trilha.length > 0) {
    const { error: erroAuditoria } = await adminClient
      .from("apolo_audit_events")
      .insert(trilha);
    if (erroAuditoria) auditoria = erroAuditoria.message;
  }

  return { auditoria, ok: true };
}

// Faz MERGE, nunca replace: o operador salva um campo por vez e não pode zerar o resto.
export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await authorizeApoloWrite(request);
  if (!auth.ok) return auth.response;

  const adminClient = createApoloAdminClient();
  if (!adminClient) {
    return NextResponse.json({ error: "Supabase indisponivel." }, { status: 503 });
  }

  const { id } = await context.params;
  const body = (await request.json().catch(() => ({}))) as {
    campos?: Record<string, unknown>;
    // De qual CAD é a ficha. Sem ele, a mais recente (ver o GET acima).
    enterpriseId?: null | number | string;
  };

  const campos = body.campos ?? {};
  if (Object.keys(campos).length === 0) {
    return NextResponse.json({ error: "Nada para salvar." }, { status: 400 });
  }

  const atual = await lerCadDaEsteira<{
    enterprise_id: string | null;
    ficha: Record<string, unknown> | null;
  }>(adminClient, id, "enterprise_id, ficha", { enterpriseId: body.enterpriseId });

  // SALVAR FICHA NÃO CRIA CAD. Antes este upsert criava a linha do zero quando ela não existia —
  // sem empreendimento, como efeito colateral de um "salvar campo". Com `enterprise_id` NOT NULL
  // e na chave, isso viraria erro cru do Postgres; e mesmo se coubesse, criar CAD por engano num
  // salvar de campo é o tipo de dado que ninguém desconfia depois.
  const alvoEnterpriseId =
    normalizarEnterpriseId(body.enterpriseId) ?? normalizarEnterpriseId(atual?.enterprise_id);

  // ⚠️ QUEM NÃO TEM ESTEIRA GRAVA NO CADASTRO DA ENTIDADE, NÃO DÁ 409.
  //
  // A esteira é CAD de PESSOA num empreendimento. **Imobiliária não tem linha lá — medido em
  // 15/08: das 435 com papel `imobiliaria`, ZERO têm esteira.** Como este PATCH era o único
  // caminho de gravação da tela, o "Salvar" do modo Editar respondia 409 para TODAS elas, e
  // nem os campos que já tinham `chave` (telefone, e-mail) gravavam. Foi o que o Lucas
  // encontrou ao tentar corrigir o telefone da imobiliária para seguir os testes.
  //
  // Sem conflito de fonte: o GET monta a ficha como `metadata.cadastro` < C2X < esteira, então
  // gravar no metadata só é a resposta certa justamente quando não existe esteira para ganhar
  // dele. Pessoa física com CAD segue exatamente no caminho de antes.
  if (!atual || !alvoEnterpriseId) {
    const semEsteira = await salvarNoCadastroDaEntidade(adminClient, id, campos, auth.userId);
    if (!semEsteira.ok) {
      return NextResponse.json({ error: semEsteira.error }, { status: semEsteira.status });
    }
    return NextResponse.json({ data: { auditoria: semEsteira.auditoria, destino: "entidade" } });
  }

  const fichaAtual = (atual.ficha ?? {}) as Record<string, unknown>;

  // Campo apagado pelo operador (string vazia) some da ficha, em vez de virar "" — assim ele
  // consegue LIMPAR um dado que o OCR leu errado.
  //
  // PADRONIZAÇÃO no servidor, não só na tela: o mesmo dado entra por aqui pela digitação do
  // operador E pela importação do Asana, e tem que sair igual dos dois lados (regra do Lucas,
  // 21/jul). Nome em "Primeira Maiúscula" (regra global do Hub, 13/jul) e telefone no padrão
  // (37) 99956-9096 — as CADs trouxeram "37999569096", "(37)998256365", "+55 37 99860-2317".
  const mesclada: Record<string, unknown> = { ...fichaAtual };
  for (const [chave, valor] of Object.entries(campos)) {
    if (valor === "" || valor === null) {
      delete mesclada[chave];
      continue;
    }
    mesclada[chave] = padronizar(chave, valor);
  }

  const { error } = await adminClient
    .from("apolo_esteira")
    .update({
      ficha: mesclada,
      ficha_editada_em: new Date().toISOString(),
      ficha_editada_por: auth.userId,
    })
    .eq("entity_id", id)
    .eq("enterprise_id", alvoEnterpriseId);

  // E-MAIL/TELEFONE EDITADOS AQUI TAMBÉM ESPELHAM em `apolo_contacts` e em
  // `metadata.cadastroEditado` (24/08) — o ramo SEM esteira sempre fez isso; este não, e a
  // ficha virava um valor imortal que o Editar cadastro do CRM nunca alcançava (as duas telas
  // escreviam e-mail em camadas diferentes; quem lia decidia qual aparecia).
  const contatoNovo = {
    email: typeof campos.email === "string" ? campos.email : null,
    telefone: typeof campos.telefone === "string" ? campos.telefone : null,
  };
  if (!error && (contatoNovo.email || contatoNovo.telefone)) {
    const { atualizarContatoDoContato } = await import("@/lib/iris/apolo/escrita-contato");
    const gravado = await atualizarContatoDoContato(adminClient, {
      email: contatoNovo.email,
      entidadeId: id,
      telefone: contatoNovo.telefone,
    });
    if (!gravado.ok) {
      return NextResponse.json(
        { error: `Ficha salva, mas o contato nao foi atualizado: ${gravado.erro}` },
        { status: 500 },
      );
    }

    const { data: entidadeAtual } = await adminClient
      .from("apolo_entities")
      .select("metadata")
      .eq("id", id)
      .maybeSingle<{ metadata: Record<string, unknown> | null }>();
    if (entidadeAtual) {
      const metaAtual = entidadeAtual.metadata ?? {};
      const editadoAtual = (metaAtual.cadastroEditado ?? {}) as Record<string, unknown>;
      await adminClient
        .from("apolo_entities")
        .update({
          metadata: {
            ...metaAtual,
            cadastroEditado: {
              ...editadoAtual,
              ...(contatoNovo.email ? { email: contatoNovo.email } : {}),
              ...(contatoNovo.telefone ? { telefone: contatoNovo.telefone } : {}),
            },
          },
          updated_at: new Date().toISOString(),
        })
        .eq("id", id);
    }
  }

  // TRILHA DE AUDITORIA por campo (exigência do Lucas, 21/jul): "o que mudou, para qual valor
  // e quem — para caso eu precise validar depois". Uma linha POR CAMPO, com o valor de antes
  // e o de agora. `ficha_editada_por` sozinho só guarda o ÚLTIMO editor e não conta a história.
  //
  // Gravada DEPOIS do salvamento e sem travar a resposta: falha de auditoria não pode fazer o
  // operador perder o que digitou. Mas o erro é reportado no corpo, para não sumir calado.
  const trilha = Object.entries(campos)
    .filter(([chave, valor]) => {
      const antes = fichaAtual[chave] ?? "";
      const agora = valor ?? "";
      return String(antes) !== String(agora);
    })
    .map(([chave, valor]) => ({
      action: "edit_ficha",
      actor_user_id: ehUuid(auth.userId) ? auth.userId : null,
      entity_id: id,
      field_name: chave,
      metadata: {
        de: fichaAtual[chave] ?? null,
        origem: "board-validacao",
        para: valor === "" || valor === null ? null : valor,
      },
      status: "mapped",
    }));

  let auditoria: string | null = null;
  if (trilha.length > 0) {
    const { error: erroAuditoria } = await adminClient
      .from("apolo_audit_events")
      .insert(trilha);
    if (erroAuditoria) auditoria = erroAuditoria.message;
  }

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ data: { auditoria, ficha: mesclada, ok: true } });
}
