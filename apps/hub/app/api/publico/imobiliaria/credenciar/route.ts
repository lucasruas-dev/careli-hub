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
  telefoneDaImobiliaria,
} from "@/lib/apolo/disparo-credenciamento";
import { loadApoloEnterpriseCadastro } from "@/lib/apolo/empreendimentos";
import { contatoDaEntidadeImobiliaria } from "@/lib/apolo/disparo-imobiliaria";
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
import { preSessaoImobDoRequest } from "@/lib/publico/cad/sessao";

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
  // O CNPJ vem da PRÉ-SESSÃO quando ela existe (habilitação de quem já é credenciada, vinda do
  // portal externo): a antessala já o conferiu e o token o carrega assinado, então o corpo não
  // precisa repeti-lo — e não poderia trocá-lo por outro.
  const pre = preSessaoImobDoRequest(request);
  const cnpjDaSessao = pre.ok ? normalizarCnpj(pre.pre.cnpj) : "";
  const cnpj = cnpjDaSessao || normalizarCnpj(corpo?.cnpj);
  const razaoSocial = normalizarNome(corpo?.razaoSocial);
  const email = normalizarEmail(corpo?.email);
  const telefone = normalizarTelefone(corpo?.telefone);

  if (!cnpjValido(cnpj)) {
    return responder(inicio, erro("Confira o CNPJ: parece que faltou um dígito."));
  }

  try {
    const existente = await consultarImobiliariaCredenciada(adminClient, cnpj);

    // Só empreendimentos ATIVOS entram. O que o cliente mandar fora dessa lista é descartado
    // em silêncio: ele não escolhe o que não está aberto.
    const ativos = await listEmpreendimentosAtivos(adminClient);

    // Razão social, e-mail e telefone só fazem sentido no CADASTRO NOVO. Para quem já é
    // credenciada, a empresa já está cadastrada e exigir isso de novo travaria a habilitação.
    const errosCadastro: string[] = [];
    if (!existente.credenciada) {
      if (razaoSocial.length < 3) errosCadastro.push("Informe a razão social da imobiliária.");
      if (!emailValido(email)) errosCadastro.push("Confira o e-mail: ele precisa ter @ e domínio.");
      if (!telefoneCompleto(telefone)) {
        errosCadastro.push("Confira o telefone: informe DDD e número.");
      }
      if (errosCadastro.length) return responder(inicio, erro(errosCadastro.join(" ")));
    }

    // ⚠️ AUTO-APROVAÇÃO EXIGE A PRÉ-SESSÃO ASSINADA. Esta rota é pública, e este é o único
    // caminho que grava vínculo JÁ habilitado: sem o token, bastaria conhecer o CNPJ de uma
    // credenciada para habilitá-la em qualquer empreendimento. O token é emitido por
    // `/iniciar`, que confere o CNPJ, e carrega o próprio CNPJ assinado — não dá para trocar
    // pelo corpo. O cadastro NOVO (abaixo) segue aberto, porque ali nada nasce habilitado.
    if (existente.credenciada && !cnpjDaSessao) {
      return responder(inicio, erro("Sessao expirada. Comece de novo pelo CNPJ.", 401));
    }

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

  // Corretores informados, normalizados. UMA definição só: a lista é usada tanto no caminho que
// habilita quanto no atalho "já habilitada".
function corretoresValidos(cru: unknown): { cpf: string; nome: string }[] {
  return ((cru ?? []) as Array<{ cpf?: string; nome?: string }>)
    .map((c) => ({ cpf: soDigitosCpf(c?.cpf), nome: normalizarNome(c?.nome) }))
    .filter((c) => c.nome && c.cpf.length === 11);
}

async function gravarCorretores(
  adminClient: Parameters<typeof listEmpreendimentosAtivos>[0],
  entityId: string,
  equipe: { cpf: string; nome: string }[],
): Promise<boolean> {
  const { error } = await adminClient.from("apolo_relationships").insert(
    equipe.map((c) => ({
      entity_id: entityId,
      label: c.nome,
      metadata: { cpf: c.cpf, kind: "contato", role: "corretor", source: "publico-imobiliaria" },
      related_entity_id: null,
      relationship_type: "corretor",
      status: "verified",
    })),
  );

  return !error;
}

// Só os dígitos do CPF, para comparar com o que a trava do corretor apura no banco.
const soDigitosCpf = (v: unknown): string => (typeof v === "string" ? v.replace(/\D/g, "") : "");

// O que ela JÁ tem, para não duplicar vínculo nem "habilitar" o que já vale.
  const { data: existentes } = await adminClient
    .from("apolo_relationships")
    .select("id, metadata, status")
    .eq("entity_id", input.entityId)
    .eq("relationship_type", "empreendimento")
    .limit(500);

  const linhas = (existentes ?? []) as Array<{
    id: string;
    metadata: { enterpriseId?: string } | null;
    status: null | string;
  }>;

  // ⚠️ SÓ `verified` CONTA COMO JÁ HABILITADA. Antes este Set era montado ignorando o `status`,
  // então um pedido ANTIGO que ficou em `pending` (as 16 que estavam paradas tinham exatamente
  // isso) fazia a rota concluir "já habilitada", devolver tela de sucesso e DESCARTAR os
  // corretores informados — sem nunca habilitar nada. O pendente agora é PROMOVIDO.
  const jaVerified = new Set(
    linhas
      .filter((r) => r.status === "verified")
      .map((r) => String(r.metadata?.enterpriseId ?? ""))
      .filter(Boolean),
  );
  // ⚠️ SÓ `pending` É PROMOVIDO. `!== "verified"` varreria junto `blocked` e `archived`, e esta
  // rota é PÚBLICA: quem soubesse o CNPJ ressuscitaria por conta própria um vínculo que alguém
  // nossa equipe bloqueou de propósito. Vínculo bloqueado volta pela mão de um operador, no
  // Board, nunca por auto-aprovação.
  const pendentePorEnterprise = new Map(
    linhas
      .filter((r) => r.status === "pending" && r.metadata?.enterpriseId)
      .map((r) => [String(r.metadata?.enterpriseId), r.id] as const),
  );
  // Bloqueado/arquivado não é "já habilitada" nem "pendente": não pode virar vínculo novo
  // duplicado nem ser promovido. Fica de fora dos dois caminhos, de propósito.
  const travados = new Set(
    linhas
      .filter((r) => r.status === "blocked" || r.status === "archived")
      .map((r) => String(r.metadata?.enterpriseId ?? ""))
      .filter(Boolean),
  );

  const pedidos = alvos.filter((alvo) => !jaVerified.has(alvo.id) && !travados.has(alvo.id));

  const bloqueados = alvos.filter((alvo) => travados.has(alvo.id));
  if (bloqueados.length > 0 && pedidos.length === 0) {
    return erro(
      `A habilitacao em ${bloqueados.map((b) => b.label).join(", ")} esta bloqueada. Fale com a nossa equipe.`,
      409,
    );
  }
  const promover = pedidos
    .map((alvo) => pendentePorEnterprise.get(alvo.id))
    .filter((id): id is string => Boolean(id));
  const novos = pedidos.filter((alvo) => !pendentePorEnterprise.has(alvo.id));

  // ⚠️ "JÁ HABILITADA" NÃO PODE ENGOLIR OS CORRETORES. Este atalho é comum, não excepcional: a
  // vitrine do portal externo pede o empreendimento ANTES do CNPJ e não filtra o que a
  // imobiliária já trabalha, então marcar um que ela já tem é o caso provável. Ela digitou a
  // equipe, a tela disse "habilitada", e ninguém gravava os corretores nem descobria depois.
  if (pedidos.length === 0) {
    const equipe = corretoresValidos(input.corpo?.corretores);
    if (equipe.length > 0) {
      const gravou = await gravarCorretores(adminClient, input.entityId, equipe);
      if (!gravou) return erro(undefined, 500);
    }

    return json({ corretores: equipe.length, status: "ja-habilitada" });
  }

  // ── TRAVA DO CORRETOR ──────────────────────────────────────────────────────
  // Vale aqui também: se aprovamos na hora, é aqui que o conflito precisa ser barrado.
  const comNome = ((input.corpo?.corretores ?? []) as Array<{ cpf?: string; nome?: string }>)
    .map((c) => ({ cpf: soDigitosCpf(c?.cpf), nome: normalizarNome(c?.nome) }))
    .filter((c) => c.nome);
  const corretoresInformados = comNome;

  // ⚠️ CPF É OBRIGATÓRIO AQUI, e a razão é a trava: o conflito "esse corretor já trabalha este
  // empreendimento por outra imobiliária" é apurado POR CPF. Aceitar corretor sem CPF deixava a
  // trava contornável só deixando o campo em branco — e ainda gravava um vínculo que nunca
  // casaria com o corretor de verdade.
  const semCpf = corretoresInformados.filter((c) => c.cpf.length !== 11);
  if (semCpf.length > 0) {
    return erro(
      `Informe o CPF de ${semCpf.map((c) => c.nome).join(", ")} para concluir a habilitacao.`,
    );
  }

  if (corretoresInformados.length > 0) {
    const conflitos = await conflitosNoBanco(adminClient, {
      corretores: corretoresInformados,
      empreendimentos: pedidos.map((n) => ({ enterpriseId: n.id, label: n.label })),
      imobiliariaId: input.entityId,
    });

    if (conflitos.length > 0) {
      return erro(explicarConflitos(conflitos), 409);
    }
  }

  // Pedido antigo que ficou pendente é PROMOVIDO em vez de duplicado — senão a imobiliária
  // acumularia duas linhas do mesmo empreendimento, uma valendo e outra não.
  if (promover.length > 0) {
    const { error: promoverError } = await adminClient
      .from("apolo_relationships")
      .update({ status: "verified" })
      .in("id", promover);
    if (promoverError) return erro(undefined, 500);
  }

  const { error: vinculoError } = novos.length === 0
    ? { error: null }
    : await adminClient.from("apolo_relationships").insert(
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
  // Sem checar o erro, a equipe sumia em silêncio e a tela afirmava que tinha entrado.
  if (corretoresInformados.length > 0) {
    const gravou = await gravarCorretores(adminClient, input.entityId, corretoresInformados);
    if (!gravou) return erro(undefined, 500);
  }

  await adminClient.from("apolo_audit_events").insert({
    action: "credenciamento_habilitado",
    actor_user_id: null,
    entity_id: input.entityId,
    field_name: "credenciamento",
    metadata: {
      automatico: true,
      empreendimentos: pedidos.length,
      motivo: "imobiliaria ja credenciada",
      origem: "publico-imobiliaria",
    },
    status: "mapped",
  });

  // BOAS-VINDAS ao empreendimento novo + aviso a cada coordenador. `primeiraVez: false`: ela já
  // trabalha com a gente, e dizer "cadastro aprovado" soaria como se tivéssemos perdido o dela.
  const rep = await representanteDaImobiliaria(adminClient, input.entityId);
  const contatoDaEmpresa = await contatoDaEntidadeImobiliaria(adminClient, input.entityId);
  const coordenadores = await coordenadoresDosEmpreendimentos(
    adminClient,
    pedidos.map((n) => ({ enterpriseId: n.id, label: n.label })),
    loadApoloEnterpriseCadastro,
  );

  await avisarCredenciamentoAprovado(adminClient, {
    coordenadores,
    corretores: corretoresInformados.length,
    // TODOS os habilitados nesta rodada, não só os recém-inseridos: um pedido antigo que
    // estava pendente e foi PROMOVIDO agora também precisa aparecer na mensagem, senão a
    // imobiliária receberia um aviso sem empreendimento nenhum listado.
    empreendimentos: pedidos.map((n) => ({ label: n.label })),
    entityId: input.entityId,
    imobiliaria: input.nome,
    // ⚠️ TRÊS FONTES, NESTA ORDEM, e nenhuma delas pode ser string vazia.
    //
    // MEDIDO EM 16/08: as 3 imobiliárias habilitadas pelo portal não receberam nada — erro
    // "sem telefone" — enquanto o aviso ao coordenador, disparado no mesmo segundo, chegou. Duas
    // causas somadas: (1) o plano B era `corpo.telefone`, que só existe no CADASTRO NOVO — no
    // fluxo de habilitação o corpo traz apenas corretores e empreendimentos; e (2)
    // `normalizarTelefone(undefined)` devolve "" e o `??` NÃO troca string vazia, só null.
    //
    // As três tinham celular em `apolo_contacts` o tempo todo. Agora esse é o plano B de
    // verdade, igual ao que a rota do Board já fazia, e o `||` cobre o vazio.
    imobiliariaTelefone: telefoneDaImobiliaria([
      rep.telefone,
      contatoDaEmpresa.telefone,
      normalizarTelefone(input.corpo?.telefone),
    ]),
    primeiraVez: false,
    representante: rep.nome,
  });

  return json({ habilitados: pedidos.length, status: "habilitada" }, 201);
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

  // ⚠️ FILTRA NO BANCO pelos empreendimentos alvo. Antes puxava as 2000 primeiras linhas
  // `verified` e filtrava na memória: passando desse total, a trava simplesmente não enxergava
  // o conflito e deixava passar. São poucos ids aqui (os escolhidos), então o `.in` não corre o
  // risco de estourar a URL — o problema clássico é com centenas de ids.
  const { data: vinculos } = await adminClient
    .from("apolo_relationships")
    .select("entity_id, metadata")
    .eq("relationship_type", "empreendimento")
    .eq("status", "verified")
    .in("metadata->>enterpriseId", ids)
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
