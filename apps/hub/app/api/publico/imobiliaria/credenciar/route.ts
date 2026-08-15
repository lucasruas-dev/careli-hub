import { createApoloEntity } from "@/lib/apolo/cadastro-persist";
import { listEmpreendimentosAtivos } from "@/lib/apolo/credenciamento";
import {
  chaveDoCorretor,
  conflitosDeCorretor,
  explicarConflitos,
  type VinculoDeCorretor,
} from "@/lib/apolo/credenciamento-trava-corretor";
import {
  avisarCredenciamentoAprovado,
  coordenadoresDosEmpreendimentos,
  representanteDaImobiliaria,
} from "@/lib/apolo/disparo-credenciamento";
import { loadApoloEnterpriseCadastro } from "@/lib/apolo/empreendimentos";
import { consultarImobiliariaCredenciada } from "@/lib/publico/cad/dados";
import {
  cnpjValido,
  emailValido,
  normalizarCnpj,
  normalizarCreci,
  normalizarEmail,
  normalizarNome,
  normalizarTelefone,
  telefoneCompleto,
} from "@/lib/publico/cad/regras";
import { erro, json, lerCorpo, prepararRota, responder } from "@/lib/publico/cad/rotas";

// Auto-cadastro PÚBLICO de imobiliária: "a imobiliária se cadastra e escolhe os
// empreendimentos que quer trabalhar, restrito aos empreendimentos que o Lucas marcou como
// ATIVOS" (regra já existente no sistema).
//
// ⚠️ ISTO É UM PEDIDO, NÃO UM CREDENCIAMENTO. A entidade nasce em `status: 'review'` (padrão
// do createApoloEntity) e as habilitações de empreendimento nascem em `status: 'pending'`.
// Só quando alguém nosso vira a chave para 'active'/'verified' é que:
//   - o CNPJ passa a "credenciada" no formulário do corretor, e
//   - o empreendimento passa a aparecer na lista dele.
//
// ⚠️ MUDANÇA DE SEMÂNTICA em relação ao wizard interno, que grava 'verified' na marra
// (cadastro-persist.ts:414,433) sem ninguém aprovar. Aqui não dá para fazer isso: seria
// auto-aprovação de um formulário aberto ao mundo. Ver pendência 2 do relatório.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

type Corpo = {
  cnpj?: string;
  // Corretores que vão trabalhar os empreendimentos pedidos. É o passo que o Lucas descreveu:
  // *"depois que ela informou os corretores que estarão trabalhando com ela naquele
  // empreendimento, ao encaminhar, já aprova"*. Entram só no caminho da imobiliária JÁ
  // credenciada; no cadastro novo os corretores vêm pelo CadastroFlow.
  corretores?: { cpf?: string; nome?: string }[];
  creci?: string;
  email?: string;
  empreendimentos?: string[];
  nomeFantasia?: string;
  razaoSocial?: string;
  responsavel?: string;
  telefone?: string;
};

export async function POST(request: Request) {
  const preparo = await prepararRota(request, "imobiliaria");
  if (!preparo.ok) return preparo.response;
  const { adminClient, inicio } = preparo;

  const corpo = await lerCorpo<Corpo>(request);
  const cnpj = normalizarCnpj(corpo?.cnpj);
  const razaoSocial = normalizarNome(corpo?.razaoSocial);
  const email = normalizarEmail(corpo?.email);
  const telefone = normalizarTelefone(corpo?.telefone);

  const erros: string[] = [];
  if (!cnpjValido(cnpj)) erros.push("Confira o CNPJ: parece que faltou um dígito.");
  if (razaoSocial.length < 3) erros.push("Informe a razão social da imobiliária.");
  if (!emailValido(email)) erros.push("Confira o e-mail: ele precisa ter @ e domínio.");
  if (!telefoneCompleto(telefone)) erros.push("Confira o telefone: informe DDD e número.");
  if (erros.length) return responder(inicio, erro(erros.join(" ")));

  try {
    const existente = await consultarImobiliariaCredenciada(adminClient, cnpj);

    // Só empreendimentos ATIVOS entram. O que o cliente mandar fora dessa lista é descartado
    // em silêncio: ele não escolhe o que não está aberto.
    const ativos = await listEmpreendimentosAtivos(adminClient);

    // ── JÁ CREDENCIADA: HABILITA DIRETO, SEM FILA DE VALIDAÇÃO ────────────────
    // Regra do Lucas (15/08): *"imobiliária que já tem cadastro e está somente habilitando
    // aquele empreendimento não precisa cair na fila de validação (…) ao encaminhar, já aprova e
    // manda a mensagem de boas vindas"*. A empresa já foi validada (contrato social, CNPJ,
    // CRECI); revalidar tudo para liberar mais um produto é trabalho sem valor.
    //
    // ⚠️ ROTA PÚBLICA COM AUTO-APROVAÇÃO. Quem souber o CNPJ de uma credenciada consegue
    // habilitá-la num empreendimento. A contenção é o AVISO IMEDIATO ao coordenador e ao
    // representante: um pedido indevido aparece na hora para duas pessoas, em vez de ficar
    // escondido num vínculo do banco. Registrado em auditoria com origem `publico-imobiliaria`.
    if (existente.credenciada && existente.entityId) {
      return responder(
        inicio,
        await habilitarJaCredenciada(adminClient, {
          ativos,
          corpo,
          entityId: existente.entityId,
          nome: existente.nome ?? "Imobiliária",
        }),
      );
    }
    const permitidos = new Set(ativos.map((emp) => String(emp.id)));
    const escolhidos = (corpo?.empreendimentos ?? [])
      .map(String)
      .filter((id) => permitidos.has(id))
      .slice(0, 30);

    const criado = await createApoloEntity(adminClient, {
      empresa: {
        cnpj,
        creci: normalizarCreci(corpo?.creci),
        email,
        nomeFantasia: normalizarNome(corpo?.nomeFantasia),
        razaoSocial,
        telefone,
      },
      // ⚠️ GRUPO VIRA AS ETAPAS. "Lagoa Bonita" é uma linha só na vitrine, mas no C2X são três
      // empreendimentos (LBF, LBR, LBP). Gravar o id do grupo deixaria um vínculo que não casa
      // com nada: a imobiliária apareceria credenciada e não venderia em nenhum dos três.
      // Regra do Lucas (13/08): "ao cadastrar para lagoa bonita habilita os três".
      empreendimentos: escolhidos.flatMap((id) => {
        const emp = ativos.find((item) => String(item.id) === id);
        const label = emp?.name ?? "Empreendimento";
        const reais = emp?.stageIds.length ? emp.stageIds : [id];
        return reais.map((real) => ({ id: real, label }));
      }),
      origem: "publico-imobiliaria",
      ownerUserId: null,
      persona: "pj",
      role: "imobiliaria",
    });
    if (!criado.ok) return responder(inicio, erro(undefined, 500));

    // ⚠️⚠️ REBAIXA O PAPEL PARA 'review'. `createApoloEntity` grava SEMPRE
    // `apolo_entity_profiles.status = 'active'` (cadastro-persist.ts:281), e é exatamente esse
    // status que `consultarImobiliariaCredenciada` lê como "credenciada". Sem esta linha, uma
    // imobiliária qualquer se auto-credenciaria pelo formulário público e passaria a receber
    // CAD de corretor no mesmo minuto. Esta é a trava do auto-cadastro.
    const { error: papelError } = await adminClient
      .from("apolo_entity_profiles")
      .update({ status: "review" })
      .eq("entity_id", criado.entityId)
      .eq("profile", "imobiliaria");
    if (papelError) return responder(inicio, erro(undefined, 500));

    // Mesma lógica nas habilitações de empreendimento: `createApoloEntity` as cria 'verified',
    // e 'verified' aqui significaria "a imobiliária se auto-habilitou".
    const { error: pendenteError } = await adminClient
      .from("apolo_relationships")
      .update({ status: "pending" })
      .eq("entity_id", criado.entityId)
      .eq("relationship_type", "empreendimento");
    if (pendenteError) return responder(inicio, erro(undefined, 500));

    // O responsável que assinou o pedido, para a central saber com quem falar.
    const responsavel = normalizarNome(corpo?.responsavel);
    if (responsavel) {
      await adminClient.from("apolo_relationships").insert({
        entity_id: criado.entityId,
        label: responsavel,
        metadata: { email, kind: "contato", phone: telefone, role: "responsavel", source: "publico-imobiliaria" },
        related_entity_id: null,
        relationship_type: "representante_legal",
        status: "pending",
      });
    }

    return responder(inicio, json({ protocolo: criado.autenticacao, status: "recebido" }, 201));
  } catch {
    return responder(inicio, erro(undefined, 500));
  }
}

// HABILITA uma imobiliária JÁ CREDENCIADA em empreendimentos novos, sem passar pela fila.
//
// O que muda em relação ao cadastro novo: os vínculos nascem **`verified`** (e não `pending`),
// porque a empresa já foi validada. O papel dela já é `active` e não se mexe nele.
async function habilitarJaCredenciada(
  adminClient: Parameters<typeof listEmpreendimentosAtivos>[0],
  input: {
    ativos: Awaited<ReturnType<typeof listEmpreendimentosAtivos>>;
    corpo: Corpo | null;
    entityId: string;
    nome: string;
  },
) {
  const permitidos = new Set(input.ativos.map((emp) => String(emp.id)));
  const escolhidos = (input.corpo?.empreendimentos ?? [])
    .map(String)
    .filter((id) => permitidos.has(id))
    .slice(0, 30);

  if (escolhidos.length === 0) {
    return erro("Escolha ao menos um empreendimento.");
  }

  // Grupo vira as etapas reais (Lagoa Bonita = LBF + LBR + LBP), mesma regra do cadastro novo.
  const alvos = escolhidos.flatMap((id) => {
    const emp = input.ativos.find((item) => String(item.id) === id);
    const label = emp?.name ?? "Empreendimento";
    const reais = emp?.stageIds.length ? emp.stageIds : [id];
    return reais.map((real) => ({ id: String(real), label }));
  });

  // O que ela JÁ tem, para não duplicar vínculo nem "habilitar" o que já vale.
  const { data: existentes } = await adminClient
    .from("apolo_relationships")
    .select("metadata, status")
    .eq("entity_id", input.entityId)
    .eq("relationship_type", "empreendimento")
    .limit(500);

  const jaTem = new Set(
    ((existentes ?? []) as Array<{ metadata: { enterpriseId?: string } | null }>)
      .map((r) => String(r.metadata?.enterpriseId ?? ""))
      .filter(Boolean),
  );
  const novos = alvos.filter((alvo) => !jaTem.has(alvo.id));

  if (novos.length === 0) {
    return json({ status: "ja-habilitada" });
  }

  // ── TRAVA DO CORRETOR ──────────────────────────────────────────────────────
  // Vale aqui também: se aprovamos na hora, é aqui que o conflito precisa ser barrado.
  const corretoresInformados = ((input.corpo?.corretores ?? []) as Array<{
    cpf?: string;
    nome?: string;
  }>)
    .map((c) => ({ cpf: c?.cpf ?? null, nome: normalizarNome(c?.nome) }))
    .filter((c) => c.nome);

  if (corretoresInformados.length > 0) {
    const conflitos = await conflitosNoBanco(adminClient, {
      corretores: corretoresInformados,
      empreendimentos: novos.map((n) => ({ enterpriseId: n.id, label: n.label })),
      imobiliariaId: input.entityId,
    });

    if (conflitos.length > 0) {
      return erro(explicarConflitos(conflitos), 409);
    }
  }

  const { error: vinculoError } = await adminClient.from("apolo_relationships").insert(
    novos.map((alvo) => ({
      entity_id: input.entityId,
      label: alvo.label,
      metadata: {
        enterpriseId: alvo.id,
        kind: "trabalho",
        role: "empreendimento",
        source: "publico-imobiliaria",
      },
      related_entity_id: null,
      relationship_type: "empreendimento",
      // VERIFIED: aprovação automática, a empresa já é credenciada.
      status: "verified",
    })),
  );
  if (vinculoError) return erro(undefined, 500);

  // Corretores informados agora entram junto (idempotente por nome+cpf seria melhor, mas o
  // cadastro simples de corretor não tem chave única — duplicata some no dedup da tela).
  if (corretoresInformados.length > 0) {
    await adminClient.from("apolo_relationships").insert(
      corretoresInformados.map((c) => ({
        entity_id: input.entityId,
        label: c.nome,
        metadata: { cpf: c.cpf, kind: "contato", role: "corretor", source: "publico-imobiliaria" },
        related_entity_id: null,
        relationship_type: "corretor",
        status: "verified",
      })),
    );
  }

  await adminClient.from("apolo_audit_events").insert({
    action: "credenciamento_habilitado",
    actor_user_id: null,
    entity_id: input.entityId,
    field_name: "credenciamento",
    metadata: {
      automatico: true,
      empreendimentos: novos.length,
      motivo: "imobiliaria ja credenciada",
      origem: "publico-imobiliaria",
    },
    status: "mapped",
  });

  // BOAS-VINDAS ao empreendimento novo + aviso a cada coordenador. `primeiraVez: false`: ela já
  // trabalha com a gente, e dizer "cadastro aprovado" soaria como se tivéssemos perdido o dela.
  const rep = await representanteDaImobiliaria(adminClient, input.entityId);
  const coordenadores = await coordenadoresDosEmpreendimentos(
    adminClient,
    novos.map((n) => ({ enterpriseId: n.id, label: n.label })),
    loadApoloEnterpriseCadastro,
  );

  await avisarCredenciamentoAprovado(adminClient, {
    coordenadores,
    corretores: corretoresInformados.length,
    empreendimentos: novos.map((n) => ({ label: n.label })),
    entityId: input.entityId,
    imobiliaria: input.nome,
    imobiliariaTelefone: rep.telefone ?? normalizarTelefone(input.corpo?.telefone),
    primeiraVez: false,
    representante: rep.nome,
  });

  return json({ habilitados: novos.length, status: "habilitada" }, 201);
}


// Busca no banco os corretores das OUTRAS imobiliárias que já trabalham esses empreendimentos e
// devolve os conflitos. Separado da regra pura (`conflitosDeCorretor`) para que a regra continue
// testável sem banco.
async function conflitosNoBanco(
  adminClient: Parameters<typeof listEmpreendimentosAtivos>[0],
  input: {
    corretores: { cpf?: null | string; nome: string }[];
    empreendimentos: { enterpriseId: string; label: string }[];
    imobiliariaId: string;
  },
) {
  const ids = input.empreendimentos.map((e) => e.enterpriseId);

  const { data: vinculos } = await adminClient
    .from("apolo_relationships")
    .select("entity_id, metadata")
    .eq("relationship_type", "empreendimento")
    .eq("status", "verified")
    .limit(2000);

  const doEmpreendimento = ((vinculos ?? []) as Array<{
    entity_id: string;
    metadata: { enterpriseId?: string } | null;
  }>).filter(
    (v) => ids.includes(String(v.metadata?.enterpriseId)) && v.entity_id !== input.imobiliariaId,
  );

  const outras = [...new Set(doEmpreendimento.map((v) => v.entity_id))].slice(0, 100);
  if (outras.length === 0) return [];

  const [{ data: corretores }, { data: nomes }] = await Promise.all([
    adminClient
      .from("apolo_relationships")
      .select("entity_id, label, metadata")
      .eq("relationship_type", "corretor")
      .in("entity_id", outras)
      .limit(2000),
    adminClient.from("apolo_entities").select("id, display_name").in("id", outras),
  ]);

  const nomePorId = new Map(
    ((nomes ?? []) as Array<{ display_name: null | string; id: string }>).map((n) => [
      n.id,
      n.display_name ?? "outra imobiliária",
    ]),
  );

  const jaVinculados: VinculoDeCorretor[] = [];
  for (const c of (corretores ?? []) as Array<{
    entity_id: string;
    label: null | string;
    metadata: { cpf?: string } | null;
  }>) {
    for (const emp of doEmpreendimento.filter((v) => v.entity_id === c.entity_id)) {
      jaVinculados.push({
        chave: chaveDoCorretor({ cpf: c.metadata?.cpf, nome: c.label }),
        enterpriseId: String(emp.metadata?.enterpriseId),
        imobiliariaId: c.entity_id,
        imobiliariaNome: nomePorId.get(c.entity_id) ?? "outra imobiliária",
        nome: c.label ?? "",
      });
    }
  }

  return conflitosDeCorretor({
    corretores: input.corretores,
    empreendimentos: input.empreendimentos,
    imobiliariaId: input.imobiliariaId,
    jaVinculados,
  });
}
