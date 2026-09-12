// ⚠️ ESTE ARQUIVO É A ÚNICA DESCRIÇÃO DO QUE A TELA DE ENVIO RECEBE — e ele nasceu porque essa
// descrição estava escrita DUAS vezes e as duas JÁ TINHAM DIVERGIDO. A rota montava o corpo em
// `corpoDaResposta` (com `contrato.unidadeId` e `ordem.origem`) e o modal declarava o mesmo tipo à
// mão, sem esses dois campos. Enquanto ninguém os usava a divergência ficou invisível; no dia em que
// alguém lesse `preparo.ordem.origem` para decidir alguma coisa, o TypeScript diria "não existe"
// sobre um campo que chega na resposta há semanas — ou, pior, um campo mudaria de nome no servidor e
// a tela continuaria compilando, lendo `undefined`.
//
// ⚠️ E POR ISSO ELE É PURO: NADA DE SUPABASE, NADA DE `process.env`, NADA DO CLIENTE DA CLICKSIGN.
// Este módulo entra no bundle do NAVEGADOR junto com o componente. É a mesma disciplina de
// `chaveDoSignatario` em `tipos.ts`: quem roda nos dois lados não pode arrastar o servidor junto.
// `envio-db.ts` puxa o cliente do Supabase, o storage e a API da Clicksign — importar daqui um tipo
// de lá levaria tudo isso para o navegador.
//
// Quem preenche: `app/api/temis/assinatura/enviar/route.ts` (GET).
// Quem lê: `modules/temis/blocks/assinatura/organizacao-da-assinatura.tsx`.

// ⚠️ IMPORT DE TIPO, E DE PROPÓSITO. `import type` é apagado na compilação, então `ordem-db` (que
// fala com o Supabase) não é arrastado para o bundle do navegador. Repetir o union aqui seria criar
// a TERCEIRA cópia de uma coisa que este arquivo existe para ter em um lugar só.
import type { OrigemDaRegra } from "./ordem-db";
import type { PapelNoContrato } from "./tipos";

/**
 * Uma pessoa, como a tela a recebe.
 *
 * ⚠️ `papelRotulo` VEM PRONTO DO SERVIDOR e a tela também sabe calculá-lo (`rotuloDoPapel`). Não é
 * redundância boba: o rótulo viaja para que qualquer leitor da resposta — um log, um relatório, o
 * suporte olhando a chamada na aba de rede — entenda "Coordenadora de vendas" sem ter o mapa do
 * código na mão.
 */
export type SignatarioDoPreparo = {
  email: string;
  nome: string;
  /** ⚠️ JÁ RESOLVIDA POR `ordenarSignatarios`. Mesmo papel = mesmo número = assinam JUNTOS. */
  ordem: number;
  papel: PapelNoContrato;
  papelRotulo: string;
};

/**
 * O que a resposta diz sobre o AMBIENTE e sobre a configuração.
 *
 * ⚠️ OS DOIS AVISOS MORAM JUNTOS PORQUE OS DOIS PARAM O ENVIO PELO MESMO MOTIVO: o operador não tem
 * como descobrir nenhum dos dois olhando a tela. Contrato assinado no sandbox não tem validade
 * jurídica e a API responde 200 igual; chave faltando não aparece em lugar nenhum até o 503 — e esse
 * 503 chegaria DEPOIS da confirmação, que é justamente o momento que esta tela existe para proteger.
 */
export type AmbienteDoEnvio = {
  /** A base URL configurada. `null` = não há env nenhuma, e aí não dá para enviar. */
  ambiente: null | string;
  /** A frase pronta para a tela gritar. `null` = está tudo no lugar. */
  avisoDeAmbiente: null | string;
  /**
   * As variáveis que faltam e que IMPEDEM o envio. `null` = nenhuma.
   *
   * ⚠️ `CLICKSIGN_WEBHOOK_SECRET` NÃO ENTRA NESTA LISTA. Sem ela o envio sai igual — o que não
   * acontece é o contrato VOLTAR sozinho: o webhook chega e é recusado, e o estado do envelope
   * congela em "aguardando" no Panteon enquanto o cliente já assinou lá. É um problema real, mas de
   * outra natureza, e bloquear o envio por ele seria impedir um contrato de sair por causa de uma
   * atualização de status.
   */
  configuracaoPendente: null | string[];
};

/**
 * TUDO que a tela de organização da assinatura mostra antes de alguém confirmar.
 *
 * ⚠️ A RESPOSTA NÃO RECUSA POR IMPEDIMENTO, ELA DEVOLVE O IMPEDIMENTO (ver `prepararEnvio`). A tela
 * precisa mostrar a lista de quem assina MESMO quando falta e-mail de alguém: é olhando a lista com
 * a frase ao lado que o operador entende o que corrigir. Quem recusa de verdade é o POST.
 */
export type RespostaDoPreparo = AmbienteDoEnvio & {
  /** O que falta e NÃO impede o envio (a vendedora sem cadastro é o caso de hoje). */
  avisos: string[];
  contrato: {
    criadoEm: string;
    documentoId: string;
    nome: string;
    /** A unidade da venda — é ela que decide a categoria, e a categoria decide a ordem. */
    unidadeId: null | string;
    versao: null | number;
  };
  /** A frase de quem tem de corrigir cadastro antes. `null` = dá para enviar. */
  impedimento: null | string;
  ordem: {
    descricao: string;
    ordenada: boolean;
    /** Categoria, empreendimento ou o padrão da casa — o recorte que mandou. */
    origem: OrigemDaRegra;
    /** A mesma coisa em uma frase, para a tela não ter de traduzir o union. */
    origemDescrita: string;
    papeis: PapelNoContrato[];
  };
  signatarios: SignatarioDoPreparo[];
};

/**
 * O corpo do POST que manda de verdade.
 *
 * ⚠️ `semCpf` SÓ LIGA COM `=== true` NO SERVIDOR (`corpo.semCpf === true`, na rota). Mandar `false`
 * funciona, mas quem escreve `semCpf: !pedirCpf` acaba mandando `false` quando quer "com CPF" e
 * `true` quando quer "sem" — e o dia em que alguém trocar a comparação do servidor por um `Boolean()`
 * a semântica inverte em silêncio. O tipo aqui aceita SÓ `true`: ou a bandeira vai levantada, ou não
 * vai. Ver `atributosDoSignatario` em `clicksign/envelope.ts`.
 *
 * ⚠️ E `emails` É CHAVEADO POR `chaveDoSignatario(papel, nome)` — nunca pelo índice da lista (a
 * ordem muda conforme a regra escolhida) e nunca pelo e-mail (que é justamente o que está sendo
 * trocado). Chave errada não dá erro: o servidor simplesmente não casa, manda o e-mail da ficha, e o
 * convite do contrato vai para o endereço errado sem ninguém ver.
 */
export type CorpoDoEnvio = {
  emails?: Record<string, string>;
  mensagem?: string;
  ordem?: { ordenada: boolean; papeis: PapelNoContrato[] };
  prazoEmDias?: number;
  /** ⚠️ A PROPOSTA, NUNCA O CARD DA TÊMIS. Ver a nota de `OrganizacaoDaAssinatura`. */
  propostaId: string;
  semCpf?: true;
};

/**
 * O que o POST devolve quando o envelope existe.
 *
 * ⚠️ CHEGAR AQUI JÁ É O PONTO SEM VOLTA. O envelope foi criado, ativado e notificado: tem custo, não
 * se apaga, e `envelopeId` é o número que o suporte da Clicksign pede. Por isso ele aparece na tela
 * de sucesso em vez de ficar só no log.
 */
export type RespostaDoEnvio = AmbienteDoEnvio & {
  envelopeId: string;
  nome: string;
  registroId: string;
  signatarios: SignatarioDoPreparo[];
};
