// ESCRITA DO CADASTRO PELO COCKPIT DA IRIS — criar ficha, corrigir identidade, arrumar contato
// e ligar o contato a alguém.
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
import { createApoloEntity } from "@/lib/apolo/cadastro-persist";
import { atualizarIdentidade } from "@/lib/apolo/identidade-persist";
import type { createApoloAdminClient } from "@/lib/apolo/server";

import { VINCULOS_DO_COCKPIT } from "./vinculos";

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

// --- criar ficha -------------------------------------------------------------------------------

/**
 * Cadastro rápido a partir do atendimento.
 *
 * CPF/CNPJ é OBRIGATÓRIO (decisão do Lucas, 14/08: "vira uma pergunta obrigatória para o
 * operador"). Não é burocracia: é o documento que liga a ficha ao C2X e o que faz a trava de
 * duplicidade funcionar. Sem ele, `createApoloEntity` recusaria de qualquer forma, e uma ficha
 * sem documento vira a segunda ficha da mesma pessoa na semana seguinte.
 *
 * `dedupPorDocumento` ligado: se o documento já tem ficha, NÃO cria outra — devolve o id da
 * existente para o cockpit abrir aquela.
 */
export async function criarContatoDoAtendimento(
  client: AdminClient,
  entrada: {
    autorUserId: null | string;
    documento: string;
    email?: null | string;
    nome: string;
    telefone?: null | string;
  },
): Promise<ResultadoEscrita> {
  const nome = limpo(entrada.nome);
  const documento = soDigitos(entrada.documento);
  const tipo = documentoValido(documento);

  if (!nome) return { erro: "Informe o nome do contato.", ok: false };
  if (!tipo) {
    return {
      erro: "CPF ou CNPJ inválido. Confira o número com o cliente antes de cadastrar.",
      ok: false,
    };
  }

  const resultado = await createApoloEntity(client, {
    dedupPorDocumento: true,
    ...(tipo === "cpf"
      ? {
          identidade: { cpf: documento, nome },
          perfil: { email: limpo(entrada.email), telefone: limpo(entrada.telefone) },
          persona: "pf" as const,
        }
      : {
          empresa: {
            cnpj: documento,
            email: limpo(entrada.email),
            razaoSocial: nome,
            telefone: limpo(entrada.telefone),
          },
          persona: "pj" as const,
        }),
    origem: "iris-cockpit",
    ownerUserId: entrada.autorUserId,
    // Nasce como PROSPECT: quem chega pelo atendimento ainda não é comprador nem corretor, e o
    // papel de verdade é definido depois, no Apolo, por quem cuida do cadastro.
    role: "prospect",
  });

  if (!resultado.ok) {
    return {
      entidadeIdExistente: resultado.entityIdExistente,
      erro: resultado.entityIdExistente
        ? "Este documento já tem ficha no Apolo."
        : resultado.error,
      ok: false,
    };
  }

  return { entidadeId: resultado.entityId, ok: true };
}

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
      status: "active",
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

export async function vincularContato(
  client: AdminClient,
  entrada: {
    autorUserId: null | string;
    entidadeId: string;
    relacionadaId: string;
    tipo: string;
  },
): Promise<ResultadoEscrita> {
  const tipo = limpo(entrada.tipo);
  const permitido = VINCULOS_DO_COCKPIT.some((item) => item.valor === tipo);

  if (!permitido) return { erro: "Tipo de vínculo inválido.", ok: false };
  if (entrada.entidadeId === entrada.relacionadaId) {
    return { erro: "Não dá para vincular uma ficha a ela mesma.", ok: false };
  }

  // Não repete vínculo igual: o operador que clica duas vezes não deve criar dois.
  const { data: jaExiste } = await client
    .from("apolo_relationships")
    .select("id")
    .eq("entity_id", entrada.relacionadaId)
    .eq("related_entity_id", entrada.entidadeId)
    .eq("relationship_type", tipo)
    .neq("status", "archived")
    .maybeSingle();

  if (jaExiste) return { entidadeId: entrada.entidadeId, ok: true };

  // A relação é gravada NA ENTIDADE DONA (o comprador tem um cônjuge; a imobiliária tem um
  // corretor), com `related_entity_id` apontando para o contato — é a direção que o resto do
  // Apolo lê.
  const { error } = await client.from("apolo_relationships").insert({
    entity_id: entrada.relacionadaId,
    metadata: { origem: "iris-cockpit" },
    related_entity_id: entrada.entidadeId,
    relationship_type: tipo,
    status: "active",
  });

  if (error) return { erro: `Não foi possível criar o vínculo: ${error.message}`, ok: false };

  // Colunas conferidas contra a tabela: `actor_user_id` (uuid), `metadata` (jsonb NOT NULL) e
  // `status` (NOT NULL). Nome errado aqui não estoura na cara — o insert falha e o vínculo fica
  // sem rastro, que é o pior dos dois mundos.
  await client.from("apolo_audit_events").insert({
    action: "vinculo_criado",
    actor_user_id: ehUuid(entrada.autorUserId) ? entrada.autorUserId : null,
    entity_id: entrada.relacionadaId,
    field_name: "vinculo",
    metadata: { origem: "iris-cockpit", relacionada: entrada.entidadeId, tipo },
    status: "mapped",
  });

  return { entidadeId: entrada.entidadeId, ok: true };
}
