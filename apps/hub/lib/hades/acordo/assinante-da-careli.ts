import type { Pessoa } from "@/lib/assinatura/signatarios";

// QUEM ASSINA PELA CARELI NO TERMO DE ACORDO — um lugar só, e não um campo por acordo.
//
// ────────────────────────────────────────────────────────────────────────────────────────────
// ⚠️ ISTO NÃO É UM FORMULÁRIO, E ESSA É A DECISÃO INTEIRA DO ARQUIVO.
// ────────────────────────────────────────────────────────────────────────────────────────────
//
// Lucas, 20/09/2026: *"quem vai, o comprador, o incorporador e a nivea careli. o comprador e o
// incorporador tem no sistema a nivea pode ficar como padrao"*, e sobre o papel dela: *"Assina como
// careli"* — como representante da ADMINISTRADORA, não como testemunha. Digitar nome e e-mail a
// cada acordo criaria, na centésima vez, o envelope que vai para `nivea.carelli@` e nunca fecha; é
// a mesma disciplina de `lib/assinatura/signatarios.ts` ("o operador não digita signatário").
//
// ⚠️ POR QUE EM CÓDIGO, E NÃO EM TABELA. Foram três caminhos medidos em 20/09/2026, e dois não
// servem:
//
//   - `temis_assinantes` (o quadro do empreendimento) tem `enterprise_id` NOT NULL e um CHECK de
//     papel que só aceita `coordenador`, `testemunha` e `vendedora`. Pôr a Careli lá seria uma linha
//     POR EMPREENDIMENTO (40 hoje) mais migration no check, para um dado que é um só na casa
//     inteira;
//   - env sozinha não serve: variável marcada Sensitive na Vercel chega VAZIA no runtime (a
//     armadilha que fez nascer `/api/temis/assinatura/diagnostico`), e um signatário que chega vazio
//     é um envelope sem quem assina pela Careli.
//
// Sobrou o precedente da casa para "um valor, um lugar, com teste que o prende":
// `lib/apolo/termos-liberados.ts`. Trocar a pessoa é trocar duas linhas daqui, com deploy e
// changelog — que é exatamente o rito de quem muda quem assina em nome da empresa.
//
// ⚠️ A ENV EXISTE COMO SOCORRO, NÃO COMO FONTE. Se a Nívea sair de férias ou trocar de endereço num
// sábado, `CARELI_ASSINANTE_NOME` / `CARELI_ASSINANTE_EMAIL` resolvem sem esperar deploy. Elas são
// lidas com queda para o padrão daqui: env vazia (o caso do Sensitive) NÃO apaga o assinante.
//
// ⚠️ CPF NÃO ENTRA, E É DE PROPÓSITO. A Clicksign valida o CPF contra a Receita e, sem ele, manda
// `has_documentation: false` e autentica só pelo e-mail (ver `clicksign/envelope.ts`). Guardar o CPF
// de uma funcionária num arquivo do repositório é dado pessoal em git para sempre, em troca de nada:
// o que a Clicksign exige é nome com sobrenome e e-mail, e "Nivea Careli" passa nos dois.

/** O nome e o e-mail da pessoa que assina pela Careli. Trocar aqui troca em todo acordo. */
export const ASSINANTE_DA_CARELI = {
  email: "nivea.careli@careli.adm.br",
  nome: "Nivea Careli",
} as const;

/**
 * A pessoa que assina pela Careli, pronta para virar signatária.
 *
 * ⚠️ `?? ""` NÃO SERVE AQUI, e a razão é a armadilha do Sensitive: `process.env.X` de uma variável
 * marcada Sensitive na Vercel chega como string VAZIA, não como `undefined` — o nullish deixaria
 * passar o vazio e o envelope sairia com um signatário sem nome. A regra é a mesma de
 * [[reference_nullish_nao_troca_string_vazia]]: só texto com conteúdo vence o padrão.
 */
export function assinanteDaCareli(env: Record<string, undefined | string> = process.env): Pessoa {
  const nome = String(env.CARELI_ASSINANTE_NOME ?? "").trim();
  const email = String(env.CARELI_ASSINANTE_EMAIL ?? "").trim();

  return {
    cpf: null,
    email: email || ASSINANTE_DA_CARELI.email,
    nome: nome || ASSINANTE_DA_CARELI.nome,
    papel: "careli",
    telefone: null,
  };
}
