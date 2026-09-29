// O CÓDIGO DO CORRETOR AUTÔNOMO — quem é autônomo se reconhece pelo código.
//
// Lucas (27/09/2026): *"a minha ideia e gerar um codigo para esses corretores, assim saberemos que ele
// e autonomo, NAO QUERO TER A INFORMACAO QUE PODE TER PESSOA FISICA COMO IMOBILIARIA, isso sera bem
// restrito"*. E, perguntado onde o código aparece: *"minto, somente no CRM"* — não entra na reserva,
// na proposta, no contrato nem no BI.
//
// ⚠️ SEQUÊNCIA NO BANCO, E NÃO `count(*) + 1`. Dois cadastros ao mesmo tempo contariam a mesma base e
// tirariam o mesmo número. `nextval` é atômico. O buraco na numeração quando um cadastro é recusado é
// o preço, e é barato — o código serve para ACHAR o autônomo, não para contar quantos são. É o mesmo
// mecanismo do protocolo da Iris (migration 0025) e do COD da venda (0129).
//
// ⚠️ O QUE ACONTECE ENQUANTO A MIGRATION 0193 NÃO FOR APLICADA, dito inteiro (medido em 27/09/2026 em
// produção, bxgukywoxgivlrhjkwjx: coluna `broker_code` 0, função da sequência 0, sequência 0):
//   • O CADASTRO DE CORRETOR AUTÔNOMO RECUSA com a frase abaixo, e nada é gravado pela metade.
//     Inventar um número no app (contar, usar timestamp, usar o id da entidade) é o único caminho que
//     produz código repetido, e é isso que este módulo existe para impedir.
//   • TODO O RESTO DO APOLO CONTINUA DE PÉ. A leitura das fichas tolera a coluna não existir: ela
//     tenta com `broker_code` e, no erro 42703, repete sem (lib/apolo/server.ts, `lerFichas`). Sem
//     isso o PostgREST recusava a consulta INTEIRA com 400 e derrubava a lista do CRM, a busca, a
//     ficha e o seletor de imobiliária do wizard, para quem nunca vai cadastrar corretor.
// Um comentário que garante segurança onde não há desliga a desconfiança de quem faz o deploy: por
// isso as duas metades estão escritas aqui e no cabeçalho da 0193.
//
// ⚠️ ELE MORA EM COLUNA (`apolo_entities.broker_code`), NÃO EM `metadata`. Precedente medido e escrito
// na migration 0183 (CRECI): *"o sync do C2X substitui o jsonb INTEIRO... Dado que o contrato depende
// NAO pode morar em campo que outro processo reescreve"*. O código também não pode sumir num sync, e
// coluna é o único lugar onde o banco garante que ele é ÚNICO (índice único parcial da 0193).
import type { createApoloAdminClient } from "@/lib/apolo/server";

type AdminClient = NonNullable<ReturnType<typeof createApoloAdminClient>>;

// ⚠️ O FORMATO DO CÓDIGO ("CA-0001", o prefixo que o Lucas propôs em 27/09/2026) TEM UM DONO SÓ, E É
// O BANCO: `next_apolo_codigo_do_corretor()`, na migration 0193, devolve a STRING pronta. Aqui houve
// um `formatarCodigoDoCorretor` espelhando o mesmo formato, e ele nunca teve chamador de produção:
// o app recebe o código feito e só o repassa. Dois donos do mesmo formato é o par que discorda de si
// mesmo — quem trocasse o prefixo mexeria no TypeScript (é onde estava o teste), veria os testes
// verdes e o banco continuaria gerando "CA-0001". Quem quiser mudar o formato mexe na 0193.

/** A função do banco que entrega o próximo número (migration 0193). */
export const FUNCAO_DA_SEQUENCIA_DO_CODIGO = "next_apolo_codigo_do_corretor";

/**
 * O que o operador lê quando a sequência ainda não existe no banco.
 *
 * ⚠️ SEM JARGÃO DE BANCO. "sequence does not exist" manda o operador adivinhar, e o caminho mais curto
 * para ele seria cadastrar o autônomo como outra coisa — que é o dado errado entrando.
 */
export const MENSAGEM_SEM_SEQUENCIA_DO_CODIGO =
  "O código do corretor autônomo ainda não está liberado neste ambiente, e sem ele o cadastro não " +
  "pode ser salvo (o código precisa ser único). Fale com a equipe do Panteon antes de cadastrar.";

export type CodigoDoCorretor =
  | { codigo: string; ok: true }
  | { mensagem: string; ok: false };

/**
 * O próximo código, gerado pelo BANCO.
 *
 * Devolve `ok: false` quando a função da sequência não existe (migration não aplicada), quando a
 * leitura falha ou quando o banco responde vazio. NUNCA devolve um código inventado.
 */
export async function proximoCodigoDoCorretor(
  adminClient: AdminClient,
): Promise<CodigoDoCorretor> {
  try {
    const { data, error } = await adminClient.rpc(FUNCAO_DA_SEQUENCIA_DO_CODIGO);
    if (error) {
      console.error("[cadastro] sequencia do codigo do corretor indisponivel", error.message);
      return { mensagem: MENSAGEM_SEM_SEQUENCIA_DO_CODIGO, ok: false };
    }
    const codigo = typeof data === "string" ? data.trim() : "";
    if (!codigo) {
      return { mensagem: MENSAGEM_SEM_SEQUENCIA_DO_CODIGO, ok: false };
    }
    return { codigo, ok: true };
  } catch (erro) {
    console.error("[cadastro] falha ao gerar o codigo do corretor", erro);
    return { mensagem: MENSAGEM_SEM_SEQUENCIA_DO_CODIGO, ok: false };
  }
}
