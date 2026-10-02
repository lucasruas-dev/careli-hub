// OS DADOS BANCÁRIOS E O PIX DO FORNECEDOR — a regra que a tela e o servidor leem.
//
// Decisões do Lucas (02/10/2026), ao habilitar o cadastro de fornecedor no Apolo:
//   • o cadastro guarda dados bancários e PIX "já nesta entrega";
//   • é obrigatório ter UMA forma de pagar: a conta completa (banco, agência, conta) OU uma chave PIX.
//     As duas juntas também valem.
//
// ⚠️ UMA FUNÇÃO SÓ PARA A TELA E PARA A PORTA. O wizard usa `validarDadosBancarios` para travar o botão
// e listar o que falta; o servidor (lib/apolo/cadastro-salvar.ts) usa a mesma para recusar com 400. Duas
// listas um dia discordam, e a tela diz "está tudo certo" com o servidor recusando (é a regra que
// cadastro-obrigatorios.ts já escreve desde o incidente de 04/08).
//
// ⚠️ CONTA PELA METADE É ERRO, E NÃO "SEM CONTA". Banco e agência sem o número da conta não pagam
// ninguém, e gravar assim faria o financeiro descobrir no dia do pagamento. Quem não quer informar a
// conta deixa os três campos vazios e informa o PIX.
//
// O que NÃO é conferido, de propósito: se a agência e a conta existem no banco. Não há fonte para isso
// aqui; conferir o dígito de cada banco seria uma tabela por instituição e um beco sem saída para o
// operador com o comprovante na mão.
import { cnpjValido, cpfValido, soDigitos } from "@/lib/apolo/documento";

export const TIPOS_DE_CONTA = [
  { rotulo: "Conta corrente", valor: "corrente" },
  { rotulo: "Conta poupança", valor: "poupanca" },
  { rotulo: "Conta de pagamento", valor: "pagamento" },
] as const;

export type TipoDeConta = (typeof TIPOS_DE_CONTA)[number]["valor"];

export const TIPOS_DE_CHAVE_PIX = [
  { rotulo: "CPF", valor: "cpf" },
  { rotulo: "CNPJ", valor: "cnpj" },
  { rotulo: "E-mail", valor: "email" },
  { rotulo: "Celular", valor: "telefone" },
  { rotulo: "Chave aleatória", valor: "aleatoria" },
] as const;

export type TipoDeChavePix = (typeof TIPOS_DE_CHAVE_PIX)[number]["valor"];

// Os bancos mais comuns, só para SUGERIR na digitação (datalist). O campo continua livre: banco que não
// está aqui é digitado como vier, e o código, quando vier na frente ("341 - Itaú"), é separado.
export const BANCOS_SUGERIDOS = [
  "001 - Banco do Brasil",
  "033 - Santander",
  "041 - Banrisul",
  "070 - BRB",
  "077 - Banco Inter",
  "104 - Caixa Econômica Federal",
  "208 - BTG Pactual",
  "212 - Banco Original",
  "237 - Bradesco",
  "260 - Nubank",
  "290 - PagSeguro",
  "323 - Mercado Pago",
  "336 - C6 Bank",
  "341 - Itaú Unibanco",
  "380 - PicPay",
  "748 - Sicredi",
  "756 - Sicoob",
] as const;

/** O que o wizard manda (tudo texto, como foi digitado). */
export type DadosBancariosInformados = {
  agencia?: null | string;
  banco?: null | string;
  conta?: null | string;
  documentoTitular?: null | string;
  pixChave?: null | string;
  pixTipo?: null | string;
  tipoConta?: null | string;
  titular?: null | string;
};

/** O que é gravado: já limpo, e só com o que foi informado. */
export type DadosBancarios = {
  conta: null | {
    agencia: string;
    bancoCodigo: null | string;
    bancoNome: string;
    numero: string;
    tipo: TipoDeConta;
  };
  pix: null | { chave: string; tipo: TipoDeChavePix };
  titular: null | { documento: null | string; nome: null | string };
};

export type ValidacaoDadosBancarios =
  | { dados: DadosBancarios; ok: true }
  | { faltando: string[]; mensagem: string; ok: false };

const TAMANHO_MAXIMO = 120;

function texto(valor: unknown): string {
  return typeof valor === "string" ? valor.trim().slice(0, TAMANHO_MAXIMO) : "";
}

// Agência e conta guardam dígitos e o "X" do dígito verificador (Banco do Brasil usa X), com um hífen
// antes do dígito quando o operador digitou assim. Ponto, espaço e barra saem.
function agenciaOuConta(valor: unknown): string {
  return texto(valor)
    .toUpperCase()
    .replace(/[^0-9X-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

/** "341 - Itaú Unibanco" → código 341 e nome "Itaú Unibanco". Sem código na frente, só o nome. */
export function separarBanco(valor: unknown): { codigo: null | string; nome: string } {
  const bruto = texto(valor);
  const comCodigo = /^(\d{3})\s*[-–—.]?\s*(.*)$/.exec(bruto);
  if (comCodigo) {
    const nome = (comCodigo[2] ?? "").trim();
    return { codigo: comCodigo[1]!, nome: nome || comCodigo[1]! };
  }
  return { codigo: null, nome: bruto };
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// A chave aleatória do PIX (EVP) é um UUID.
const CHAVE_ALEATORIA_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function ehTipoDeChave(valor: string): valor is TipoDeChavePix {
  return TIPOS_DE_CHAVE_PIX.some((tipo) => tipo.valor === valor);
}

function ehTipoDeConta(valor: string): valor is TipoDeConta {
  return TIPOS_DE_CONTA.some((tipo) => tipo.valor === valor);
}

/**
 * A chave PIX no formato em que é guardada, ou `null` quando ela não serve para o tipo escolhido.
 *
 * Celular: 10 ou 11 dígitos com DDD, guardado com o +55 que o PIX usa ("+5562999998888"). Quem digita
 * o 55 na frente também passa.
 */
export function chavePixNormalizada(tipo: TipoDeChavePix, valor: unknown): null | string {
  const bruto = texto(valor);
  if (!bruto) return null;
  if (tipo === "cpf") return cpfValido(bruto) ? soDigitos(bruto) : null;
  if (tipo === "cnpj") return cnpjValido(bruto) ? soDigitos(bruto) : null;
  if (tipo === "email") return EMAIL_RE.test(bruto) ? bruto.toLowerCase() : null;
  if (tipo === "aleatoria") return CHAVE_ALEATORIA_RE.test(bruto) ? bruto.toLowerCase() : null;
  let digitos = soDigitos(bruto);
  if ((digitos.length === 12 || digitos.length === 13) && digitos.startsWith("55")) {
    digitos = digitos.slice(2);
  }
  return digitos.length === 10 || digitos.length === 11 ? `+55${digitos}` : null;
}

const NOME_DA_CHAVE: Record<TipoDeChavePix, string> = {
  aleatoria: "a chave aleatória (no formato 123e4567-e89b-12d3-a456-426614174000)",
  cnpj: "um CNPJ válido como chave PIX",
  cpf: "um CPF válido como chave PIX",
  email: "um e-mail válido como chave PIX",
  telefone: "um celular com DDD como chave PIX",
};

function juntar(itens: string[]): string {
  if (itens.length <= 1) return itens[0] ?? "";
  return `${itens.slice(0, -1).join(", ")} e ${itens[itens.length - 1]}`;
}

/**
 * Confere e limpa os dados bancários do fornecedor.
 *
 * Regra: a conta completa OU a chave PIX (as duas também valem). Conta começada e não terminada é
 * recusada, e chave PIX que não combina com o tipo escolhido também.
 */
export function validarDadosBancarios(
  entrada: DadosBancariosInformados | null | undefined,
): ValidacaoDadosBancarios {
  const banco = separarBanco(entrada?.banco);
  const agencia = agenciaOuConta(entrada?.agencia);
  const numero = agenciaOuConta(entrada?.conta);
  const tipoConta = texto(entrada?.tipoConta);
  const pixTipo = texto(entrada?.pixTipo);
  const pixBruto = texto(entrada?.pixChave);

  const faltando: string[] = [];

  const comecouConta = Boolean(banco.nome || agencia || numero);
  let conta: DadosBancarios["conta"] = null;
  if (comecouConta) {
    if (!banco.nome) faltando.push("o banco");
    if (!agencia) faltando.push("a agência");
    if (!numero) faltando.push("o número da conta");
    if (banco.nome && agencia && numero) {
      conta = {
        agencia,
        bancoCodigo: banco.codigo,
        bancoNome: banco.nome,
        numero,
        tipo: ehTipoDeConta(tipoConta) ? tipoConta : "corrente",
      };
    }
  }

  let pix: DadosBancarios["pix"] = null;
  if (pixBruto || pixTipo) {
    if (!ehTipoDeChave(pixTipo)) {
      faltando.push("o tipo da chave PIX");
    } else if (!pixBruto) {
      faltando.push("a chave PIX");
    } else {
      const chave = chavePixNormalizada(pixTipo, pixBruto);
      if (chave) pix = { chave, tipo: pixTipo };
      else faltando.push(NOME_DA_CHAVE[pixTipo]);
    }
  }

  if (faltando.length > 0) {
    return {
      faltando,
      mensagem: `Dados bancários: informe ${juntar(faltando)}.`,
      ok: false,
    };
  }
  if (!conta && !pix) {
    const falta = "a conta (banco, agência e conta) ou uma chave PIX";
    return {
      faltando: [falta],
      mensagem: `Dados bancários: informe ${falta} do fornecedor.`,
      ok: false,
    };
  }

  const documentoTitular = soDigitos(texto(entrada?.documentoTitular));
  if (documentoTitular && !cpfValido(documentoTitular) && !cnpjValido(documentoTitular)) {
    return {
      faltando: ["um CPF ou CNPJ válido do titular"],
      mensagem: "Dados bancários: o CPF ou CNPJ do titular não confere.",
      ok: false,
    };
  }
  const nomeTitular = texto(entrada?.titular);

  return {
    dados: {
      conta,
      pix,
      titular:
        nomeTitular || documentoTitular
          ? { documento: documentoTitular || null, nome: nomeTitular || null }
          : null,
    },
    ok: true,
  };
}

/** A linha de `apolo_entity_bank_accounts` (migration 0211) para uma ficha. */
export function linhaDaContaDoFornecedor(
  entityId: string,
  dados: DadosBancarios,
  criadoPor: null | string,
): Record<string, unknown> {
  return {
    account_number: dados.conta?.numero ?? null,
    account_type: dados.conta?.tipo ?? null,
    agency: dados.conta?.agencia ?? null,
    bank_code: dados.conta?.bancoCodigo ?? null,
    bank_name: dados.conta?.bancoNome ?? null,
    created_by: criadoPor,
    entity_id: entityId,
    holder_document: dados.titular?.documento ?? null,
    holder_name: dados.titular?.nome ?? null,
    pix_key: dados.pix?.chave ?? null,
    pix_key_type: dados.pix?.tipo ?? null,
  };
}

/** Rótulo do tipo de conta / de chave, para a ficha e a CAD. */
export function rotuloDoTipoDeConta(valor: null | string | undefined): string {
  return TIPOS_DE_CONTA.find((tipo) => tipo.valor === valor)?.rotulo ?? "";
}

export function rotuloDoTipoDeChave(valor: null | string | undefined): string {
  return TIPOS_DE_CHAVE_PIX.find((tipo) => tipo.valor === valor)?.rotulo ?? "";
}
