// O QUE A GENTE MANDOU PARA A IMOBILIÁRIA, e o que aconteceu com cada mensagem.
//
// Pedido do Lucas (17/08/2026): *"seria ótimo trazer os status do envio das mensagens, se foi
// enviado, hora, se recebeu, quem recebeu, para a gente não ficar no escuro"*.
//
// ⚠️ O QUE A BASE GUARDA E O QUE NÃO GUARDA. `apolo_disparos` tem `delivered_at`/`read_at`, mas
// eles só são preenchidos pelo webhook da Meta, casando por `wa_message_id`. Os avisos de
// credenciamento saem pelo gateway Evolution (número do Relacionamento), que NÃO devolve recibo:
// medido em 17/08, os 24 disparos `relacionamento:whatsapp` têm `wa_message_id`, `delivered_at` e
// `read_at` todos nulos. Então "recebeu" é uma informação que não existe para este canal, e a
// tela precisa DIZER ISSO em vez de inventar um "entregue" que ninguém confirmou.
//
// Este arquivo é só tradução e formatação, sem banco: dá para testar e é o mesmo vocabulário
// para a rota e para a tela.

export type LinhaDeDisparo = {
  created_at: string;
  delivered_at: null | string;
  destinatario: null | string;
  erro: null | string;
  id: string;
  origem: null | string;
  read_at: null | string;
  status: null | string;
  telefone: null | string;
  tipo: null | string;
  wa_message_id: null | string;
};

export type DisparoNaTela = {
  // O canal devolve confirmação de entrega para ESTA mensagem? `false` = não dá para saber se
  // chegou, e a tela diz exatamente isso.
  confirmaEntrega: boolean;
  contato: null | string;
  entregueEm: null | string;
  evento: string;
  id: string;
  lidoEm: null | string;
  // Motivo da falha em português. `null` quando não falhou.
  motivo: null | string;
  // O texto cru do provedor, para o tooltip de quem for investigar.
  motivoTecnico: null | string;
  para: string;
  quando: string;
  // Foi um reenvio manual do operador?
  reenvio: boolean;
  resultado: "entregue" | "enviado" | "falhou" | "lido";
};

// O NOME DO EVENTO em português. `credenciamento_aprovado` não diz nada para quem opera; "Aviso
// de habilitação" diz.
const EVENTOS: Record<string, string> = {
  coordenador: "Crédito reprovado (coordenador)",
  corretor: "Crédito reprovado (corretor)",
  credenciamento_aprovado: "Aviso de habilitação",
  credenciamento_coordenador: "Aviso ao coordenador do empreendimento",
  credenciamento_correcao: "Pedido de correção",
  credenciamento_indeferido: "Aviso de recusa",
  credenciamento_indeferido_coordenador: "Aviso de recusa (coordenador)",
  imob_credito_reprovado: "Crédito reprovado de um cliente",
  imob_pix_enviado: "PIX enviado a um cliente",
  imob_pix_pago: "PIX pago por um cliente",
  imob_relatorio: "Relatório da imobiliária",
  prevenda_cobranca: "Cobrança da pré-venda",
  prevenda_recibo: "Recibo da pré-venda",
};

export function rotuloDoEvento(tipo: null | string): string {
  const chave = (tipo ?? "").trim();
  if (!chave) return "Mensagem";
  return EVENTOS[chave] ?? chave.replace(/_/g, " ");
}

// TELEFONE PARCIAL: o suficiente para conferir se o número está certo, sem despejar o cadastro
// inteiro numa tela que fica aberta o dia todo.
export function mascararTelefone(valor: null | string): null | string {
  const digitos = (valor ?? "").replace(/\D/g, "");
  if (digitos.length < 8) return null;

  // O cadastro guarda sem DDI; o disparo guarda com. Os dois viram o mesmo formato aqui.
  const nacional = digitos.startsWith("55") && digitos.length >= 12 ? digitos.slice(2) : digitos;
  const ddd = nacional.slice(0, 2);
  const fim = nacional.slice(-4);
  return `(${ddd}) ${"*".repeat(Math.max(1, nacional.length - 6))}-${fim}`;
}

export function mascararEmail(valor: null | string): null | string {
  const v = (valor ?? "").trim();
  if (!v.includes("@")) return null;
  const [usuario = "", dominio = ""] = v.split("@");
  if (!dominio) return null;
  return `${usuario.slice(0, 3)}${"*".repeat(Math.max(1, usuario.length - 3))}@${dominio}`;
}

// QUEM RECEBEU. O campo `destinatario` guarda coisas diferentes conforme o fluxo: nos avisos de
// credenciamento é o PAPEL ("imobiliaria", "coordenador:FULANO"); nos disparos da pré-venda é o
// contato cru (telefone ou e-mail). Aqui os dois viram texto legível, e o contato cru sai
// MASCARADO — não é para a tela expor um e-mail inteiro só porque a coluna guardou assim.
export function rotuloDoDestinatario(destinatario: null | string): string {
  const v = (destinatario ?? "").trim();
  if (!v) return "Sem destinatário registrado";

  if (v === "imobiliaria") return "Imobiliária";
  if (v === "coordenador") return "Coordenador";
  if (v.startsWith("coordenador:")) {
    const nome = v.slice("coordenador:".length).trim();
    return nome ? `Coordenador · ${nome}` : "Coordenador";
  }
  if (v === "corretor") return "Corretor";

  const email = mascararEmail(v);
  if (email) return email;

  const telefone = mascararTelefone(v);
  if (telefone) return telefone;

  return v;
}

// ERRO DO PROVEDOR -> FRASE QUE DIZ O QUE FAZER. As entradas casam com o que está gravado de
// verdade em `apolo_disparos` (lido em 17/08/2026), não com uma lista imaginada.
const MOTIVOS: ReadonlyArray<{ para: string; quando: RegExp }> = [
  // O caso mais comum dos avisos de credenciamento: o Evolution responde `"exists": false`.
  { para: "O número não tem WhatsApp", quando: /"exists"\s*:\s*false|message undeliverable|131026|133010/i },
  { para: "A ficha não tem telefone para receber a mensagem", quando: /sem telefone/i },
  { para: "A ficha não tem e-mail cadastrado", quando: /sem e-mail/i },
  { para: "Telefone sem DDI: o gateway não envia", quando: /sem ddi/i },
  { para: "O gateway de WhatsApp não está configurado", quando: /gateway evolution nao configurado/i },
  { para: "Número de telefone inválido", quando: /131009|invalid.*phone/i },
  { para: "Template não existe ou não está aprovado na Meta", quando: /132001|template name does not exist/i },
  { para: "As variáveis do template não batem com o texto aprovado", quando: /132000|number of parameters/i },
  { para: "Limite de envio atingido: aguarde antes de tentar de novo", quando: /130429|rate limit/i },
  { para: "E-mail inválido", quando: /invalid to header|invalid.*recipient/i },
];

export function explicarErroDoDisparo(erro: null | string): null | string {
  const limpo = (erro ?? "").replace(/^erro:\s*/i, "").trim();
  if (!limpo) return null;

  const traduzido = MOTIVOS.find((m) => m.quando.test(limpo));
  if (traduzido) return traduzido.para;

  const doJson = limpo.match(/"message"\s*:\s*"([^"]+)"/);
  if (doJson?.[1]) return doJson[1];

  return limpo.length > 90 ? `${limpo.slice(0, 90)}…` : limpo;
}

/**
 * Uma linha do banco vira uma linha da tela.
 *
 * ⚠️ `confirmaEntrega` sai do `wa_message_id`, e não do canal. É o id que o webhook da Meta usa
 * para casar a devolutiva; sem ele, `delivered_at` e `read_at` NUNCA vão ser preenchidos, por
 * mais tempo que passe. Dizer "aguardando confirmação" nesse caso seria prometer uma resposta
 * que não vem.
 */
export function descreverDisparo(linha: LinhaDeDisparo): DisparoNaTela {
  const falhou = linha.status === "falhou" || Boolean(linha.erro);
  const resultado: DisparoNaTela["resultado"] = falhou
    ? "falhou"
    : linha.read_at
      ? "lido"
      : linha.delivered_at
        ? "entregue"
        : "enviado";

  return {
    confirmaEntrega: Boolean(linha.wa_message_id),
    contato: mascararTelefone(linha.telefone) ?? mascararEmail(linha.telefone),
    entregueEm: linha.delivered_at,
    evento: rotuloDoEvento(linha.tipo),
    id: linha.id,
    lidoEm: linha.read_at,
    motivo: falhou ? explicarErroDoDisparo(linha.erro) : null,
    motivoTecnico: falhou ? linha.erro : null,
    para: rotuloDoDestinatario(linha.destinatario),
    quando: linha.created_at,
    reenvio: (linha.origem ?? "").startsWith("reenvio"),
    resultado,
  };
}

// QUAL AVISO REENVIAR — o da situação em que a imobiliária ESTÁ, nunca um genérico.
//
// Reenviar "seu cadastro foi aprovado" para quem está esperando corrigir um documento seria pior
// do que não reenviar nada. Por isso a decisão sai do estado, e o estado mora em duas colunas
// (ver credenciamento-etapa.ts).
export type AvisoDeCredenciamento = "aprovado" | "correcao" | "indeferido";

export function avisoDoEstado(input: {
  entidadeStatus?: null | string;
  papelStatus?: null | string;
}): AvisoDeCredenciamento | null {
  if (input.papelStatus === "blocked") return "indeferido";
  if (input.papelStatus === "active") return "aprovado";
  if (input.entidadeStatus === "attention") return "correcao";
  return null;
}

const DESCRICOES: Record<AvisoDeCredenciamento, string> = {
  aprovado: "Aviso de habilitação",
  correcao: "Pedido de correção",
  indeferido: "Aviso de recusa",
};

export function descricaoDoAviso(aviso: AvisoDeCredenciamento): string {
  return DESCRICOES[aviso];
}

// O `tipo` com que o reenvio é registrado. É o MESMO do envio original de propósito: a lista da
// tela agrupa por evento, e um tipo novo faria o reenvio parecer outra mensagem.
const TIPOS: Record<AvisoDeCredenciamento, string> = {
  aprovado: "credenciamento_aprovado",
  correcao: "credenciamento_correcao",
  indeferido: "credenciamento_indeferido",
};

export function tipoDoAviso(aviso: AvisoDeCredenciamento): string {
  return TIPOS[aviso];
}

/**
 * É A PRIMEIRA VEZ que esta imobiliária recebe o aviso de habilitação?
 *
 * A mensagem muda inteira: `primeiraVez` dá boas-vindas ("seu cadastro foi aprovado"),
 * `!primeiraVez` fala de "mais um empreendimento". No reenvio não dá para chutar — quem já
 * recebeu o aviso de aprovação alguma vez está no segundo caso, e dizer "cadastro aprovado" para
 * um parceiro antigo soa como se tivéssemos perdido o cadastro dele.
 *
 * Só conta disparo que SAIU: falha não avisou ninguém, então quem só tem falha continua sendo
 * "primeira vez" e recebe as boas-vindas que nunca chegaram.
 */
export function ehPrimeiroAviso(anteriores: Pick<LinhaDeDisparo, "status" | "tipo">[]): boolean {
  return !anteriores.some(
    (linha) => linha.tipo === "credenciamento_aprovado" && linha.status !== "falhou",
  );
}
