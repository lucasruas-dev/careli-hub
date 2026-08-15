// ESCRITA DO CADASTRO PELO COCKPIT DA IRIS — corrigir identidade, arrumar contato e ligar o
// contato a alguém. Criar ficha NÃO é aqui: fica no Apolo (ver o bloco mais abaixo).
//
// Tudo aqui reusa o caminho que o Apolo já tem, em vez de abrir um segundo. A regra é essa
// porque cada caminho novo de escrita neste módulo reimplementou a trava de duplicidade e errou
// de um jeito diferente — o banco não ajuda: o índice único de documento foi derrubado na
// migration 0026 e nunca voltou.
//
// O QUE ESTA CAMADA NÃO FAZ, E POR QUÊ: não grava os campos pessoais da ficha (nascimento,
// estado civil, nome da mãe, naturalidade). A ficha do Apolo tem duas camadas e
// `metadata.cadastro` PERDE para `apolo_esteira.ficha` (lib/apolo/cadastro-cascata.ts). A tela de
// edição do CRM grava só na camada perdedora: o operador digita, salva, e o valor não aparece na
// CAD em PDF nem no que sobe para o C2X, sem erro nenhum. Enquanto essa cascata não for
// resolvida, o cockpit mexe apenas no que tem caminho seguro e auditado.
import { atualizarIdentidade } from "@/lib/apolo/identidade-persist";
import type { createApoloAdminClient } from "@/lib/apolo/server";

import { vinculoPermitido } from "./vinculos";

type AdminClient = NonNullable<ReturnType<typeof createApoloAdminClient>>;

export type ResultadoEscrita =
  | { entidadeId: string; ok: true }
  | { entidadeIdExistente?: string; erro: string; ok: false };

const soDigitos = (valor: null | string | undefined) => String(valor ?? "").replace(/\D/g, "");
const limpo = (valor: null | string | undefined) => String(valor ?? "").trim();

/** O autor só entra na auditoria se for uuid: a coluna é uuid e o hub tem usuário sem id real. */
const ehUuid = (valor: null | string): valor is string =>
  Boolean(valor) &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(valor));

/** Dígito verificador de CPF. O documento é a chave de identidade da ficha: aceitar um CPF
 *  inválido aqui é criar uma ficha que nunca vai casar com o C2X nem com outra CAD. */
function cpfValido(cpf: string): boolean {
  const digitos = soDigitos(cpf);
  if (digitos.length !== 11 || /^(\d)\1{10}$/.test(digitos)) return false;

  const calcula = (ate: number) => {
    let soma = 0;
    for (let i = 0; i < ate; i += 1) {
      soma += Number(digitos[i]) * (ate + 1 - i);
    }
    const resto = (soma * 10) % 11;
    return resto === 10 ? 0 : resto;
  };

  return calcula(9) === Number(digitos[9]) && calcula(10) === Number(digitos[10]);
}

function cnpjValido(cnpj: string): boolean {
  const digitos = soDigitos(cnpj);
  if (digitos.length !== 14 || /^(\d)\1{13}$/.test(digitos)) return false;

  const calcula = (ate: number) => {
    const pesos = ate === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    let soma = 0;
    for (let i = 0; i < ate; i += 1) soma += Number(digitos[i]) * (pesos[i] ?? 0);
    const resto = soma % 11;
    return resto < 2 ? 0 : 11 - resto;
  };

  return calcula(12) === Number(digitos[12]) && calcula(13) === Number(digitos[13]);
}

export function documentoValido(documento: string): "cnpj" | "cpf" | null {
  const digitos = soDigitos(documento);
  if (digitos.length === 11) return cpfValido(digitos) ? "cpf" : null;
  if (digitos.length === 14) return cnpjValido(digitos) ? "cnpj" : null;
  return null;
}

// --- criar ficha: NÃO É AQUI ------------------------------------------------------------------
//
// A criação de entidade ficou **no Apolo**, por decisão do Lucas (14/08): o cockpit vincula e
// corrige, mas não abre ficha nova. O motivo é bom — ficha nasce com papel, empreendimento,
// documentos e uma trilha de validação que o wizard conduz; um formulário de quatro campos no
// meio do atendimento criaria meia-ficha, e meia-ficha é o que vira duplicata depois.
//
// O cockpit leva o operador para lá com o telefone e o nome em mãos.

// --- corrigir identidade -----------------------------------------------------------------------

/**
 * Nome e documento passam pelo caminho auditado do Apolo (`atualizarIdentidade`), que valida o
 * dígito verificador, procura colisão em DUAS fontes, reescreve o identificador e o índice de
 * busca, e grava `apolo_audit_events` com o antes e o depois.
 *
 * Ele recusa ficha ESPELHO do C2X (id determinístico, resync de 6 em 6 horas reescreve a linha
 * inteira). É recusa correta: gravar ali é trabalho que some sozinho horas depois.
 */
export async function corrigirIdentidadeDoContato(
  client: AdminClient,
  entrada: {
    autorUserId: null | string;
    documento: string;
    entidadeId: string;
    motivo: string;
    nome: string;
  },
): Promise<ResultadoEscrita> {
  const tipo = documentoValido(entrada.documento);
  if (!tipo) {
    return { erro: "CPF ou CNPJ inválido.", ok: false };
  }

  const resultado = await atualizarIdentidade({
    autorUserId: entrada.autorUserId,
    client,
    documento: soDigitos(entrada.documento),
    entityId: entrada.entidadeId,
    motivo: limpo(entrada.motivo),
    nome: limpo(entrada.nome),
    tipo: tipo === "cpf" ? "pf" : "pj",
  });

  return resultado.ok
    ? { entidadeId: entrada.entidadeId, ok: true }
    : { erro: resultado.erro, ok: false };
}

// --- contato (telefone e e-mail) ---------------------------------------------------------------

/**
 * Grava telefone/e-mail em `apolo_contacts` **e** em `apolo_entity_identifiers`.
 *
 * ⚠️ `normalized_value` É OBRIGATÓRIO E TEM QUE SER OS DÍGITOS. O `upsertContato` da tela do CRM
 * atualiza só o `value` e deixa o `normalized_value` com o número ANTIGO. Como a busca de
 * identidade do cockpit casa por essa coluna, o telefone velho continua apontando para a ficha:
 * quem receber aquele número depois é apresentado como se fosse o dono anterior. Aqui os dois
 * campos andam juntos, sempre.
 *
 * O identificador (hash) entra junto porque é o que o phone-match consulta — sem ele, o contato
 * novo só é encontrado pela segunda fonte, e some se a primeira mudar.
 */
export async function atualizarContatoDoContato(
  client: AdminClient,
  entrada: {
    email?: null | string;
    entidadeId: string;
    telefone?: null | string;
  },
): Promise<ResultadoEscrita> {
  const { hashIdentifier } = await import("@/lib/apolo/server");

  const gravar = async (
    tipo: "email" | "phone",
    valorCru: string,
    normalizado: string,
    mascara: string,
  ) => {
    // Um principal por tipo: derruba os antigos antes de marcar o novo.
    await client
      .from("apolo_contacts")
      .update({ is_primary: false })
      .eq("entity_id", entrada.entidadeId)
      .in("contact_type", tipo === "phone" ? ["phone", "whatsapp"] : ["email"]);

    const { error: erroContato } = await client.from("apolo_contacts").insert({
      contact_type: tipo,
      entity_id: entrada.entidadeId,
      is_primary: true,
      normalized_value: normalizado,
      // ⚠️ NÃO É "active". O CHECK de `apolo_contacts` aceita só
      // verified | pending | attention | blocked, e a coluna é `text` — o typecheck passa verde e
      // o INSERT falha sempre. Pior: o `update({is_primary:false})` logo acima JÁ RODOU, então a
      // entidade ficava sem contato principal nenhum e o disparo caía num número antigo.
      // Mesmo bug já corrigido em `prevenda-fluxo.ts` (changelog v1.115.0); esta função nunca
      // tinha sido exercitada porque a escrita do cockpit ficou pronta sem UI.
      status: "pending",
      value: valorCru,
    });

    if (erroContato) return erroContato.message;

    const { error: erroIdentificador } = await client
      .from("apolo_entity_identifiers")
      .insert({
        confidence_score: 100,
        entity_id: entrada.entidadeId,
        identifier_type: tipo,
        is_primary: true,
        source_system: "iris",
        value_hash: hashIdentifier(tipo, normalizado),
        value_masked: mascara,
      });

    return erroIdentificador ? erroIdentificador.message : null;
  };

  const telefone = soDigitos(entrada.telefone);
  if (telefone.length >= 10) {
    const erro = await gravar(
      "phone",
      limpo(entrada.telefone),
      telefone,
      `(**) *****-**${telefone.slice(-2)}`,
    );
    if (erro) return { erro: `Não foi possível gravar o telefone: ${erro}`, ok: false };
  }

  const email = limpo(entrada.email).toLowerCase();
  if (email) {
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return { erro: "E-mail inválido.", ok: false };
    }
    const erro = await gravar("email", email, email, `${email[0]}***@${email.split("@")[1] ?? ""}`);
    if (erro) return { erro: `Não foi possível gravar o e-mail: ${erro}`, ok: false };
  }

  return { entidadeId: entrada.entidadeId, ok: true };
}

// --- vincular ----------------------------------------------------------------------------------

/**
 * Liga este contato a uma entidade que já existe — de trabalho ou de contato.
 *
 * É o que resolve os 101 telefones que hoje só existem dentro do metadata de um vínculo: o
 * cônjuge que liga pelo comprador, o corretor que fala pela imobiliária. Depois de vinculado, o
 * cockpit passa a saber quem é aquela pessoa na próxima mensagem.
 *
 * Grava com `metadata.kind` ("trabalho" ou "contato"), que é como o CRM separa as duas famílias
 * na leitura. Vínculo igual não é duplicado: se já existe, ATUALIZA o rótulo em vez de criar
 * outra linha — o operador que corrige "Sócio" para "Cônjuge" está corrigindo, não somando.
 */
export async function vincularContato(
  client: AdminClient,
  entrada: {
    autorUserId: null | string;
    entidadeId: string;
    kind: string;
    relacionadaId: string;
    tipo: string;
  },
): Promise<ResultadoEscrita> {
  const tipo = limpo(entrada.tipo);
  const kind = limpo(entrada.kind);

  if (!vinculoPermitido(tipo, kind)) {
    return { erro: "Tipo de vínculo inválido.", ok: false };
  }
  if (entrada.entidadeId === entrada.relacionadaId) {
    return { erro: "Não dá para vincular uma ficha a ela mesma.", ok: false };
  }

  // Já existe vínculo entre as duas fichas? Então é ATUALIZAÇÃO de rótulo, não vínculo novo.
  // Sem isto, corrigir "Sócio" para "Cônjuge" deixaria os dois na ficha, e o painel mostraria a
  // pessoa como as duas coisas.
  const { data: jaExiste } = await client
    .from("apolo_relationships")
    .select("id, relationship_type")
    .eq("entity_id", entrada.relacionadaId)
    .eq("related_entity_id", entrada.entidadeId)
    .neq("status", "archived")
    .limit(1)
    .maybeSingle();

  const anterior = (jaExiste as null | { id: string; relationship_type: null | string })
    ?.relationship_type;

  const { error } = jaExiste
    ? await client
        .from("apolo_relationships")
        .update({
          label: tipo,
          metadata: { atualizadoPor: "iris-cockpit", kind, origem: "iris-cockpit" },
          relationship_type: tipo,
        })
        .eq("id", (jaExiste as { id: string }).id)
    : // A relação é gravada NA ENTIDADE DONA (o comprador tem um cônjuge; a imobiliária tem um
      // corretor), com `related_entity_id` apontando para o contato — é a direção que o resto do
      // Apolo lê.
      await client.from("apolo_relationships").insert({
        entity_id: entrada.relacionadaId,
        label: tipo,
        metadata: { kind, origem: "iris-cockpit" },
        related_entity_id: entrada.entidadeId,
        relationship_type: tipo,
        // `apolo_relationships` tem o mesmo CHECK (+ 'archived') e também recusa "active".
        // `verified` é o valor certo aqui: quem vinculou foi uma pessoa, e os leitores que
        // filtram vínculo (empreendimentos credenciados, por exemplo) só enxergam verified.
        status: "verified",
      });

  if (error) return { erro: `Não foi possível gravar o vínculo: ${error.message}`, ok: false };

  // Colunas conferidas contra a tabela: `actor_user_id` (uuid), `metadata` (jsonb NOT NULL) e
  // `status` (NOT NULL). Nome errado aqui não estoura na cara — o insert falha e o vínculo fica
  // sem rastro, que é o pior dos dois mundos.
  await client.from("apolo_audit_events").insert({
    action: jaExiste ? "vinculo_atualizado" : "vinculo_criado",
    actor_user_id: ehUuid(entrada.autorUserId) ? entrada.autorUserId : null,
    entity_id: entrada.relacionadaId,
    field_name: "vinculo",
    metadata: {
      contato: entrada.entidadeId,
      de: anterior ?? null,
      kind,
      origem: "iris-cockpit",
      para: tipo,
    },
    status: "mapped",
  });

  return { entidadeId: entrada.entidadeId, ok: true };
}
