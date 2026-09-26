// Regras PURAS do formulário público de CAD: sem Supabase, sem rede, sem React.
//
// Estão separadas de propósito. São elas que decidem quem entra, com qual imobiliária e em
// qual empreendimento, e é exatamente esse tipo de decisão que precisa de teste automatizado:
// a rota pública é anônima, então um erro aqui não vira "tela feia", vira CAD nascendo no
// vínculo errado. Ver [[project_esteira_credenciamento_venda]].
import { cnpjValido, cpfValido, soDigitos } from "@/lib/apolo/documento";
import { cobertoPor } from "@/lib/apolo/empreendimento-equivalencia";
import { soDigitosTelefone, telefoneCompleto } from "@/lib/format/phone-br";

// ---------------------------------------------------------------------------
// Normalização de entrada
// ---------------------------------------------------------------------------

// O corretor digita no celular: vem com máscara, espaço sobrando, às vezes o CPF colado de
// outro app. Normalizar ANTES de qualquer I/O é o que barra scanner burro de graça e o que
// impede o mesmo CPF de virar duas entidades por causa de um ponto a mais.
export function normalizarCpf(valor: string | null | undefined): string {
  return soDigitos(String(valor ?? ""));
}

export function normalizarCnpj(valor: string | null | undefined): string {
  return soDigitos(String(valor ?? ""));
}

export function normalizarEmail(valor: string | null | undefined): string {
  return String(valor ?? "").trim().toLowerCase();
}

export function normalizarTelefone(valor: string | null | undefined): string {
  return soDigitosTelefone(String(valor ?? "").split(/[/;]/)[0] ?? "");
}

// CRECI é alfanumérico com UF ("MG 12345", "12345-F"). Só tiramos o excesso de espaço e
// subimos para maiúscula, sem inventar formato: cada conselho estadual escreve de um jeito.
export function normalizarCreci(valor: string | null | undefined): string {
  return String(valor ?? "").trim().replace(/\s+/g, " ").toUpperCase().slice(0, 40);
}

// Nome próprio: colapsa espaço e corta tamanho absurdo (campo livre em rota anônima).
export function normalizarNome(valor: string | null | undefined): string {
  return String(valor ?? "").trim().replace(/\s+/g, " ").slice(0, 160);
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function emailValido(valor: string | null | undefined): boolean {
  const email = normalizarEmail(valor);
  return email.length <= 254 && EMAIL_RE.test(email);
}

// Nome de gente tem pelo menos duas palavras. É a checagem que impede "João" virar cadastro,
// e o nome é o que sai impresso na CAD.
export function nomeCompletoValido(valor: string | null | undefined): boolean {
  const nome = normalizarNome(valor);
  if (nome.length < 5) return false;
  return nome.split(" ").filter((parte) => parte.length >= 2).length >= 2;
}

export { cnpjValido, cpfValido, telefoneCompleto };

// ---------------------------------------------------------------------------
// Por que o botão não acende
// ---------------------------------------------------------------------------

/**
 * A frase que explica ao visitante por que o "Continuar" está apagado. String vazia = nada a dizer.
 *
 * ⚠️ ISTO EXISTE PORQUE O BOTÃO CINZA NÃO EXPLICA NADA, e nas telas públicas não há a quem
 * perguntar. Lucas, 15/09/2026: *"as imobiliarias não estão conseguindo seguir com o cadastro"* —
 * e o print mostrava o CNPJ 61.061.769/0001-90 digitado, o botão apagado e a tela muda. Esse CNPJ
 * é inválido de verdade (o dígito verificador dá 04, não 90), e o validador está certo: medi os
 * 549 CNPJs de imobiliária do C2X e TODOS OS 549 passam nele. O defeito nunca foi a régua, foi o
 * silêncio.
 *
 * ⚠️ E É O MESMO DEFEITO QUE JÁ FOI RECLAMADO ANTES, em outra tela: *"o botão fica apagado mas sem
 * mensagem nenhuma"* (14/09/2026, sobre o bloqueio de unidade). Duas telas, a mesma falha de
 * desenho, e a pública é a que dói mais: quem está do outro lado é um parceiro tentando se
 * credenciar, não um operador que pode chamar no WhatsApp.
 *
 * ⚠️ "NÃO EXISTE" É AFIRMAÇÃO VERDADEIRA AQUI, e não força de expressão — foi a palavra que o
 * Lucas pediu ("tem que ter a mensagem falando que o cnpj não existe"), e ela se sustenta: o dígito
 * verificador faz parte da DEFINIÇÃO do número, então um documento que não fecha no DV não é um
 * documento que talvez exista e nós não achamos, é um número que a Receita nunca poderia ter
 * emitido. O que esta função NÃO afirma é situação cadastral: um CNPJ válido e baixado passa aqui,
 * e quem confere isso é a consulta do próximo passo.
 *
 * ⚠️ O SILÊNCIO ENQUANTO SE DIGITA É DELIBERADO. Acusar "CPF inválido" no terceiro dígito é
 * acusar quem está fazendo tudo certo. A frase só aparece quando o documento está COMPLETO e ainda
 * assim não fecha — aí, sim, houve um erro de digitação e ele não vai se corrigir sozinho.
 */
export function avisoDoDocumento(
  valor: null | string | undefined,
  tipo: "cnpj" | "cpf",
): string {
  const digitos = soDigitos(String(valor ?? ""));
  const completo = tipo === "cnpj" ? 14 : 11;

  // Ainda digitando, ou campo vazio: nada a dizer.
  if (digitos.length < completo) return "";

  if (tipo === "cnpj") {
    return cnpjValido(digitos)
      ? ""
      : "Esse CNPJ não existe. Revise os números e tente de novo.";
  }
  return cpfValido(digitos) ? "" : "Esse CPF não existe. Revise os números e tente de novo.";
}

// ---------------------------------------------------------------------------
// Validação dos dados do corretor (etapa S2)
// ---------------------------------------------------------------------------

export type DadosCorretor = {
  cpf: string;
  creci: string;
  email: string;
  nome: string;
  telefone: string;
};

export type ValidacaoCorretor =
  | { erros: string[]; ok: false }
  | { dados: DadosCorretor; ok: true };

// Mensagem de erro sempre diz O QUE FAZER, não só o que deu errado (regra do Lucas).
export function validarCorretor(entrada: Partial<DadosCorretor>): ValidacaoCorretor {
  const cpf = normalizarCpf(entrada.cpf);
  const nome = normalizarNome(entrada.nome);
  const email = normalizarEmail(entrada.email);
  const telefone = normalizarTelefone(entrada.telefone);
  const creci = normalizarCreci(entrada.creci);

  const erros: string[] = [];
  // CPF passa pelo módulo 11 completo, não só pelo tamanho. O wizard interno checa só
  // `length === 11`, e aqui isso não serve: o CPF É a trava do formulário público.
  if (!cpfValido(cpf)) erros.push("Confira o CPF: parece que faltou um dígito.");
  if (!nomeCompletoValido(nome)) erros.push("Informe o nome completo, com sobrenome.");
  if (!emailValido(email)) erros.push("Confira o e-mail: ele precisa ter @ e domínio.");
  if (!telefoneCompleto(telefone)) {
    erros.push("Confira o telefone: informe DDD e número, com 10 ou 11 dígitos.");
  }

  if (erros.length) return { erros, ok: false };
  return { dados: { cpf, creci, email, nome, telefone }, ok: true };
}

// ---------------------------------------------------------------------------
// Casamento corretor -> imobiliária
// ---------------------------------------------------------------------------

export type VinculoCorretor = {
  imobiliariaEntityId: string;
  imobiliariaNome: string;
  // 'active' na entidade da imobiliária. Só isso é "credenciada".
  imobiliariaAtiva: boolean;
};

export type ResolucaoVinculo =
  | { motivo: "descredenciada" | "sem-vinculo"; ok: false }
  | { ok: true; vinculo: VinculoCorretor };

// Um CPF pode aparecer ligado a mais de uma imobiliária (acontece no mercado). A regra:
// vale a PRIMEIRA credenciada; se nenhuma das ligadas está credenciada, o corretor não entra.
// Não escolhemos "a mais recente" nem somamos empreendimentos de duas imobiliárias: a CAD
// nasce vinculada a UMA imobiliária, e misturar seria falsificar a origem do negócio.
// ⚠️ Se o Lucas decidir que o corretor escolhe entre várias, esta função devolve a lista e a
// tela ganha uma etapa; a estrutura já suporta (ver `vinculosCredenciados`).
export function resolverVinculo(candidatos: VinculoCorretor[]): ResolucaoVinculo {
  if (!candidatos.length) return { motivo: "sem-vinculo", ok: false };
  const credenciados = vinculosCredenciados(candidatos);
  if (!credenciados.length) return { motivo: "descredenciada", ok: false };
  return { ok: true, vinculo: credenciados[0] as VinculoCorretor };
}

export function vinculosCredenciados(candidatos: VinculoCorretor[]): VinculoCorretor[] {
  return candidatos.filter((c) => c.imobiliariaAtiva && Boolean(c.imobiliariaEntityId));
}

// ---------------------------------------------------------------------------
// Empreendimentos habilitados
// ---------------------------------------------------------------------------

export type EmpreendimentoPublico = {
  code: string;
  id: string;
  logoUrl: string | null;
  name: string;
};

// HABILITADO = credenciamento EXPLÍCITO da imobiliária ∩ empreendimento ATIVO.
//
// ⚠️ NÃO usar `jaTrabalha` de `consultarImobiliariaPorCnpj`: ele soma
// `empreendimentosPorVendas`, que é "essa imobiliária já vendeu lá alguma vez no C2X". Isso é
// histórico, não autorização. Se entrasse aqui, uma venda antiga viraria permissão permanente
// para subir CAD em empreendimento onde ninguém habilitou ninguém.
export function filtrarEmpreendimentosHabilitados(
  credenciados: string[],
  ativos: (EmpreendimentoPublico & { stageIds?: string[] })[],
): EmpreendimentoPublico[] {
  // ⚠️ O VÍNCULO PODE ESTAR NO ID DA DIVISÃO, e isso não é caso hipotético.
  //
  // Lagoa Bonita aparece aqui como UM item, de id "group:Lagoa Bonita" — é a regra do Lucas, "para
  // eles não tem essa de divisão, isso é interno". Mas o vínculo da imobiliária pode ter sido
  // gravado com o id de uma divisão (33/LBF, 27/LBR, 32/LBP), que é como o C2X a conhece.
  //
  // Comparar só `emp.id` fazia a DANY CASTRO — habilitada e `verified` nas TRÊS divisões — não
  // enxergar o Lagoa Bonita no portal. Os corretores dela não conseguiam enviar CAD lá, e a
  // habilitação existia no banco o tempo todo. Vale igual para Lavra do Ouro, Rio de Pedras e
  // Portal dos Vales, que têm a mesma estrutura.
  const permitidos = new Set(credenciados.filter(Boolean).map(String));
  return ativos
    .filter((emp) => cobertoPor(emp, permitidos))
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
}

// ---------------------------------------------------------------------------
// Máquina de estados
// ---------------------------------------------------------------------------

export type EstadoCad =
  | "identificar" // S0  CPF
  | "cnpj" // S1  CNPJ da imobiliária
  | "dados" // S2  nome, e-mail, telefone
  | "creci" // S3  CRECI (busca MOST, com queda para digitação)
  | "confirmar" // S4  revisão do cadastro
  | "empreendimento" // S5  escolha (pula quando só há um)
  | "cad" // S6..S9 o formulário da CAD
  | "enviando" // S10 upload + geração do PDF
  | "sucesso" // S11 protocolo
  | "central"; // SX  terminal cordial (nunca diz o motivo)

export type EventoCad =
  | { tipo: "cpf-conhecido"; empreendimentos: number }
  | { tipo: "cpf-novo" }
  | { tipo: "cnpj-ok" }
  | { tipo: "cnpj-recusado" }
  | { tipo: "dados-ok" }
  | { tipo: "creci-ok" }
  | { tipo: "cadastrado"; empreendimentos: number }
  | { tipo: "empreendimento-escolhido" }
  | { tipo: "cad-pronta" }
  | { tipo: "enviada" }
  | { tipo: "sem-empreendimento" }
  | { tipo: "voltar" };

// Um passo por vez, e sempre o mesmo caminho: a tela não decide nada, ela só desenha o estado.
// Ter a transição isolada aqui é o que permite testar "1 empreendimento pula a escolha" sem
// montar React.
export function proximoEstado(atual: EstadoCad, evento: EventoCad): EstadoCad {
  if (evento.tipo === "sem-empreendimento") return "central";

  switch (atual) {
    case "identificar":
      if (evento.tipo === "cpf-novo") return "cnpj";
      if (evento.tipo === "cpf-conhecido") {
        // ⚠️ SEMPRE passa pela escolha, mesmo com UM empreendimento só — ver `PortaoCorretor`.
        // A regra anterior ("se tiver somente uma, seguir para o formulário") mandava o corretor
        // direto para a CAD, e ele não via para qual empreendimento estava cadastrando. Em 22/08
        // isso pôs uma CAD da Aldeia da Cachoeira no Vale do Ouro.
        return evento.empreendimentos >= 1 ? "empreendimento" : "central";
      }
      return atual;

    case "cnpj":
      if (evento.tipo === "cnpj-ok") return "dados";
      if (evento.tipo === "cnpj-recusado") return "central";
      if (evento.tipo === "voltar") return "identificar";
      return atual;

    case "dados":
      if (evento.tipo === "dados-ok") return "creci";
      if (evento.tipo === "voltar") return "cnpj";
      return atual;

    case "creci":
      if (evento.tipo === "creci-ok") return "confirmar";
      if (evento.tipo === "voltar") return "dados";
      return atual;

    case "confirmar":
      if (evento.tipo === "cadastrado") {
        // Mesma regra do `identificar`: a escolha do empreendimento nunca é pulada.
        return evento.empreendimentos >= 1 ? "empreendimento" : "central";
      }
      if (evento.tipo === "voltar") return "creci";
      return atual;

    case "empreendimento":
      if (evento.tipo === "empreendimento-escolhido") return "cad";
      return atual;

    case "cad":
      if (evento.tipo === "cad-pronta") return "enviando";
      // Voltar da CAD só faz sentido quando houve escolha de empreendimento.
      if (evento.tipo === "voltar") return "empreendimento";
      return atual;

    case "enviando":
      if (evento.tipo === "enviada") return "sucesso";
      return atual;

    // Terminais: sucesso e central não voltam sozinhos (o botão "Enviar outra CAD" reinicia
    // explicitamente, não é transição).
    default:
      return atual;
  }
}

// Progresso mostrado na barra. O corretor precisa saber quanto falta (regra do Lucas).
const ORDEM_CADASTRO: EstadoCad[] = [
  "identificar",
  "cnpj",
  "dados",
  "creci",
  "confirmar",
  "empreendimento",
  "cad",
];

export function progresso(estado: EstadoCad): { passo: number; total: number } {
  if (estado === "sucesso") return { passo: ORDEM_CADASTRO.length, total: ORDEM_CADASTRO.length };
  if (estado === "central") return { passo: 0, total: ORDEM_CADASTRO.length };
  if (estado === "enviando") return { passo: ORDEM_CADASTRO.length, total: ORDEM_CADASTRO.length };
  const idx = ORDEM_CADASTRO.indexOf(estado);
  return { passo: idx < 0 ? 0 : idx + 1, total: ORDEM_CADASTRO.length };
}

// ---------------------------------------------------------------------------
// Protocolo
// ---------------------------------------------------------------------------

// O que o corretor lê na tela de sucesso e repete para a central. Deriva do código de
// autenticação que o SERVIDOR gerou (CAD-2026-XXXXXXXX), então não há nada novo a inventar.
export function protocoloDaAutenticacao(autenticacao: string | null | undefined): string {
  const bruto = String(autenticacao ?? "").trim().toUpperCase();
  return /^CAD-\d{4}-[A-Z0-9]+$/.test(bruto) ? bruto : "";
}

// ---------------------------------------------------------------------------
// O que o corretor lê quando o cadastro é recusado
// ---------------------------------------------------------------------------

/**
 * Traduz a recusa de `createApoloEntity` no que a porta pública responde.
 *
 * ⚠️ O PADRÃO CONTINUA SENDO O SILÊNCIO. `rotas.ts` abre dizendo que três mensagens de erro
 * diferentes são três bits de informação para quem está enumerando, e isso segue valendo: só o que
 * o próprio corretor consegue CONSERTAR ganha texto próprio. Falha de gravação e verificação
 * indisponível continuam no genérico, porque saber delas não muda nada do lado de fora.
 *
 * ⚠️ NASCEU DE UM BECO SEM SAÍDA MEDIDO. Em 26/09/2026 o Israel, da CASAVISTA, tomou 500 oito vezes
 * seguidas no cadastro de corretor: o e-mail dele estava travado e a tela só sabia dizer "tente
 * novamente em alguns instantes". Ele tentou, oito vezes, e o resultado foi sempre o mesmo. Lucas:
 * *"olha o porque desse erro"*.
 *
 * ⚠️ A MENSAGEM NÃO DIZ DE QUEM É O E-MAIL. A do operador diz, de propósito (lib/apolo/email-unico.ts),
 * porque ele precisa resolver o conflito; aqui fora isso viraria oráculo — quem digitasse endereços
 * descobriria quem está na base da Careli. Diz o que fazer, e nada sobre a base.
 */
export function recusaPublicaDoCorretor(motivo?: string): {
  mensagem?: string;
  status: number;
} {
  if (motivo === "email-repetido") {
    return {
      mensagem:
        "Este e-mail já está em uso em outro cadastro. Use o seu e-mail pessoal, que é por ele " +
        "que a assinatura eletrônica identifica quem assinou. Se ele for mesmo seu, fale com a " +
        "nossa central.",
      status: 409,
    };
  }

  return { status: 500 };
}
