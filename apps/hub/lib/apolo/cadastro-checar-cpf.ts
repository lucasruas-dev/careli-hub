import { lerCadsDaEsteira, normalizarEnterpriseId } from "@/lib/apolo/esteira-cad";
import {
  conflitoDeNucleoFamiliar,
  mensagemDeConflito,
  type ConflitoNucleo,
} from "@/lib/apolo/nucleo-familiar";
import { hashIdentifier, type createApoloAdminClient } from "@/lib/apolo/server";

// A CHECAGEM DO CPF NA IDENTIFICAÇÃO — a conferência em si, sem a porta.
//
// Lucas (12/08): *"prefiro na identificação do cpf, pode ser via most ou digitação"*. O wizard
// pergunta assim que o CPF fecha, para ninguém preencher a ficha inteira e só descobrir no fim que a
// CAD não pode ser aberta. A trava de verdade continua sendo a do salvar (fail-closed, em
// `cadastro-persist.ts`); esta é conveniência.
//
// ⚠️ POR QUE SAIU DA ROTA (16/09/2026): o CRM do portal do incorporador faz a mesma pergunta, e a
// regra é "um código só". A rota do hub (/api/apolo/cadastro/checar-cpf) e a do portal
// (/api/incorporador/crm/cadastro/checar-cpf) chamam esta função; o que muda é a FRASE. O hub
// mostra onde a CAD está e de quem é o núcleo; o portal não pode nomear terceiros, e por isso o
// conflito sai daqui com a CATEGORIA (`tipo`) ao lado da frase do hub.
//
// Ver o porquê do núcleo familiar em lib/apolo/nucleo-familiar.ts.

type AdminClient = NonNullable<ReturnType<typeof createApoloAdminClient>>;

export type TipoDeConflitoDoCpf = "cpf-ja-tem-cad" | ConflitoNucleo["motivo"];

export type ConflitoDoCpf = {
  /** A frase do hub. Nomeia o empreendimento e o titular do núcleo: NÃO sai para fora da Careli. */
  mensagem: string;
  tipo: TipoDeConflitoDoCpf;
};

/**
 * Confere o CPF (e o do cônjuge) contra as CADs DO empreendimento.
 *
 * @param cpf         só dígitos, já conferido por `cpfValidoParaNucleo`.
 * @param cpfConjuge  só dígitos; vazio quando não há cônjuge.
 * @param enterpriseId já normalizado; quem chama garante que existe (sem ele não há o que comparar).
 * @returns `null` quando NÃO deu para conferir (leitura da esteira falhou): quem chama responde
 *          "não conferido" e deixa a decisão para a trava do salvar. `{ conflito: null }` = livre.
 */
export async function conferirCpfNoEmpreendimento(
  adminClient: AdminClient,
  { cpf, cpfConjuge, enterpriseId }: { cpf: string; cpfConjuge: string; enterpriseId: string },
): Promise<null | { conflito: ConflitoDoCpf | null }> {
  // Todas as fichas deste CPF, não uma: a mesma pessoa tem mais de uma ficha em 516 casos, e
  // olhar só a primeira foi o que deixou passar as CADs duplicadas de agosto.
  const docHash = hashIdentifier("cpf", cpf);
  const [{ data: porIdentificador }, { data: porDocumento }] = await Promise.all([
    adminClient
      .from("apolo_entity_identifiers")
      .select("entity_id")
      .eq("identifier_type", "cpf")
      .eq("value_hash", docHash),
    adminClient.from("apolo_entities").select("id").eq("document_hash", docHash),
  ]);

  const idsDoDocumento = [
    ...new Set([
      ...(porIdentificador ?? []).map((l: { entity_id: string }) => l.entity_id),
      ...(porDocumento ?? []).map((l: { id: string }) => l.id),
    ]),
  ].filter(Boolean);

  for (const id of idsDoDocumento) {
    let cads: { empreendimento: null | string; enterprise_id: null | string }[];
    try {
      cads = await lerCadsDaEsteira<{
        empreendimento: null | string;
        enterprise_id: null | string;
      }>(adminClient, id, "empreendimento, enterprise_id");
    } catch {
      // Esta checagem é conveniência, não autoridade: em dúvida deixa seguir, e a trava do salvar
      // decide, que aquela é fail-closed.
      return null;
    }

    const aqui = cads.find((c) => normalizarEnterpriseId(c.enterprise_id) === enterpriseId);
    if (aqui) {
      const onde = aqui.empreendimento?.trim();
      return {
        conflito: {
          mensagem:
            `Este CPF já possui CAD ${onde ? `para o empreendimento ${onde}` : "para esse empreendimento"}.`,
          tipo: "cpf-ja-tem-cad",
        },
      };
    }
  }

  const conflito = await conflitoDeNucleoFamiliar({
    adminClient,
    cpfConjuge,
    cpfTitular: cpf,
    enterpriseId,
    ignorarEntityIds: idsDoDocumento,
  });

  return {
    conflito: conflito ? { mensagem: mensagemDeConflito(conflito), tipo: conflito.motivo } : null,
  };
}
