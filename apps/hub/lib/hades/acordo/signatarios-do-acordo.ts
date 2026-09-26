import { nomeDeSignatario, ORDEM_PADRAO, ordenarSignatarios, type RegraDeOrdem } from "@/lib/assinatura/ordem";
import { conferirSignatarios, type Pessoa } from "@/lib/assinatura/signatarios";
import type { Signatario } from "@/lib/assinatura/tipos";

// QUEM ASSINA O TERMO DE ACORDO — três partes, nesta ordem, nenhuma digitada.
//
// Lucas, 20/09/2026: *"quem vai, o comprador, o incorporador e a nivea careli. o comprador e o
// incorporador tem no sistema a nivea pode ficar como padrao"*.
//
//     comprador      hercules_propostas.compradores → `dadosDaProposta` → `signatariosDoContrato`
//     incorporador   temis_assinantes `termos_vendedora` → `assinanteDeTermosDaVendedora`
//                    ↘ sem ninguém apontado → a vendedora do quadro
//                    ↘ e os dois degraus são procurados na divisão da unidade, no empreendimento da
//                      proposta e no pai dele, nessa ordem (`incorporadorDoAcordo`, em envio-db.ts)
//                    ↘ até 25/09/2026 havia um terceiro, o representante legal herdado da ficha da
//                      PJ; ele saiu quando o quadro virou a única fonte de quem assina (0191)
//     Careli         lib/hades/acordo/assinante-da-careli.ts
//
// ⚠️ O PRIMEIRO DEGRAU DO INCORPORADOR NASCEU EM 20/09/2026, e ele é o campo que o Lucas pediu:
// *"nessa tela vc pode abrir mais um campo para assinatura de termos vendedora, ae eu posso apontar
// quem vai assinar os termos, não precisa necessariamente ser os representantes legais, pode ser o
// juridico, analista, enfim"*. Quem assina a compra e venda pela empresa costuma NÃO ser quem
// despacha um termo de acordo, e antes disto o acordo só tinha os dois degraus de baixo, que são os
// do CONTRATO. Esta função continua PURA: quem encadeia a precedência é `envio-db.ts`.
//
// ⚠️ NENHUMA DAS TRÊS SAI DO C2X, E ISSO NÃO É PREFERÊNCIA DE ARQUITETURA: O C2X NÃO TEM O CAMPO. A
// ficha do Hades (`loadHadesAttendanceClient`), que é de onde o PDF tira nome, CPF, qualificação e
// endereço do comprador, NÃO traz e-mail nem telefone — e e-mail é o campo por onde a Clicksign
// manda o convite, sem o qual não existe signatário (`conferirSignatarios`). O cadastro que tem
// e-mail por pessoa é o do Panteon. Por isso o PAPEL continua vindo do C2X (é a mesma leitura que o
// operador vê na tela antes de clicar) e o ENVELOPE vem do Panteon.
//
// ⚠️ O CÔNJUGE NÃO ENTRA, E QUEM DISSE ISSO FOI O LUCAS (20/09/2026): *"entra no envelope somente o
// proponente"*. O termo de acordo qualifica UM comprador
// (é o cliente da carteira, o dono do débito) e o Lucas pediu três signatários. Mandar o cônjuge
// assinar poria no envelope alguém que o documento não menciona — a mesma regra que
// `signatariosDoContrato` aplica ao ligar o cônjuge só quando o contrato o qualificou. Se algum dia
// o termo passar a qualificar o casal, é o PAPEL que muda primeiro, e o envelope segue.
//
// ⚠️ E A COORDENADORA, O CORRETOR E A TESTEMUNHA TAMBÉM FICAM DE FORA. Eles são partes do CONTRATO
// de venda; o acordo é entre quem deve, quem vende e quem administra a carteira. O quadro do
// empreendimento é lido inteiro (é uma consulta só) e aqui se pega apenas a vendedora.

/** Como a tela e a rota recebem a montagem: quem assina, e a frase quando falta alguém. */
export type MontagemDoAcordo = {
  /**
   * O que IMPEDE o envio, em uma frase — `null` quando dá para mandar.
   *
   * ⚠️ FRASE, E NÃO `boolean`, pela mesma razão do gate do termo: um botão apagado que não diz o
   * motivo faz a pessoa achar que o sistema quebrou. E a frase diz QUAL DADO falta e ONDE arrumar,
   * porque o operador da cobrança não sabe (nem precisa saber) o que é `vendedor_entity_id`.
   */
  impedimento: null | string;
  /** Já com o número da ordem resolvido: é o que a tela mostra e o que vai para a Clicksign. */
  signatarios: Signatario[];
};

/**
 * A ORDEM DO ACORDO: comprador, depois o incorporador, depois a Careli.
 *
 * ⚠️ ORDENADA DE VERDADE (`ordenada: true`), ao contrário do padrão do contrato, que nasce
 * desligado. Lucas pediu a sequência com todas as letras (*"na ordem comprador, incorporador e
 * nivea careli"*), e ela tem a mesma lógica do contrato: quem pode desistir assina primeiro. Colher
 * a assinatura da Careli antes gastaria a formalidade do lado de cá num acordo que o cliente ainda
 * pode não aceitar.
 *
 * ⚠️ OS NÚMEROS SÃO OS CANÔNICOS, e não 1/2/3 escritos à mão. `ordenarSignatarios` COMPACTA o
 * conjunto: com comprador (1), vendedora (3) e careli (7) presentes, saem 1, 2 e 3. Escrever os três
 * na mão aqui criaria uma segunda tabela de números que envelheceria na primeira mudança de
 * `PAPEIS`.
 */
export const ORDEM_DO_ACORDO: RegraDeOrdem = {
  ordenada: true,
  ordens: { ...ORDEM_PADRAO.ordens },
};

/**
 * As três partes do acordo, na ordem, ou a frase que diz qual dado falta.
 *
 * `comprador` e `incorporador` chegam prontos de quem leu o Panteon (`envio-db.ts`); `careli` chega
 * da configuração. Esta função é PURA de propósito: ela roda no servidor, mas a régua que ela aplica
 * é exatamente a que a tela precisa explicar, e uma régua que só existe dentro de um `await` não
 * tem como ser conferida linha a linha.
 */
export function signatariosDoAcordo(partes: {
  careli: Pessoa;
  comprador: null | Pessoa;
  incorporador: null | Pessoa;
}): MontagemDoAcordo {
  const pessoas: Pessoa[] = [];

  // ⚠️ A ORDEM DESTA LISTA É A ORDEM DAS PARTES NO PAPEL, e não a de assinatura (quem decide aquela
  // é `ordenarSignatarios`). É a ordem em que a tela mostra as três pessoas para conferência.
  if (partes.comprador) pessoas.push(partes.comprador);
  if (partes.incorporador) pessoas.push(partes.incorporador);
  pessoas.push(partes.careli);

  // ⚠️ O NOME SAI NO PADRÃO DA CASA. Ver `nomeDeSignatario`: no termo que foi para o cliente em
  // 23/09/2026 saíram, em sequência, dois nomes do cadastro em caixa alta e o da Careli em "Nivea
  // Careli", porque as três partes vêm de fontes diferentes.
  for (const p of pessoas) p.nome = nomeDeSignatario(p.nome);

  const impedimento = faltaAlgumaParte(partes) ?? conferencia(pessoas);

  return { impedimento, signatarios: ordenarSignatarios(pessoas, ORDEM_DO_ACORDO) };
}

/**
 * A parte que não existe no cadastro, em uma frase que diz onde arrumar.
 *
 * ⚠️ O INCORPORADOR É O BURACO MEDIDO, E ELE VALE PARA OS 18 ACORDOS APROVADOS. Medição de
 * 20/09/2026 no Supabase de produção: os 18 chegam a um `vendedor_entity_id` (pela cadeia acordo →
 * proposta → empreendimento ou unidade → settings), mas ZERO das vendedoras tem representante legal
 * em `apolo_relationships` e a tabela `temis_assinantes` está VAZIA — ou seja, hoje NENHUM acordo
 * tem pessoa física para assinar pelo incorporador. A frase abaixo é, hoje, a que todo operador vai
 * ler; ela existe para que ele saiba que o defeito é de cadastro, e em qual tela se arruma.
 *
 * ⚠️ E ELA APONTA PRIMEIRO O CAMPO DOS TERMOS, que é o caminho barato. Os 18 acordos aprovados estão
 * em 4 empreendimentos de 3 incorporadoras (medido em 20/09/2026): apontar uma pessoa por
 * incorporadora, repetida nos 4 empreendimentos, tira os 18 desta frase. Mandar o operador atrás do
 * representante legal da PJ é mandá-lo mexer no cadastro da empresa, que muda o CONTRATO de venda
 * também — e o Lucas foi explícito que quem assina termo *"não precisa necessariamente ser os
 * representantes legais"*.
 *
 * ⚠️ E O CAMINHO É O DE VERDADE: ABA SETUP, SUB-ABA ASSINATURA (revisão de 20/09/2026). A frase
 * dizia *"na aba Assinatura da tela do empreendimento"*, e no primeiro nível de abas
 * (`empreendimentos-view.tsx`: Visão geral, Unidades, Carteira, …, Setup) NÃO EXISTE aba com esse
 * nome — a Assinatura é sub-aba de dentro do Setup. Como esta frase é hoje a única instrução que os
 * 18 acordos aprovados entregam ao operador, mandá-lo procurar uma aba que não está lá é mandá-lo
 * desistir.
 *
 * ⚠️ E O ENVIO PARA, EM VEZ DE SAIR SEM ELE. No CONTRATO, vendedora ausente vira AVISO e o envelope
 * sai assim mesmo — decisão tomada em 08/09/2026 para não travar o primeiro teste do ZZ TESTE por um
 * cadastro que ninguém tinha preenchido. Aqui não: o Lucas nomeou as três partes, e um acordo
 * assinado só pelo comprador e pela Careli é um acordo em que o dono da carteira não figura. Cada
 * envelope custa e não se apaga; mandar um que já nasce incompleto é pagar para errar.
 */
function faltaAlgumaParte(partes: {
  comprador: null | Pessoa;
  incorporador: null | Pessoa;
}): null | string {
  if (!partes.comprador) {
    return (
      "Este acordo não tem comprador com nome no cadastro do Panteon, e é ele a primeira assinatura do termo. " +
      "Confira o cadastro do comprador na venda antes de mandar para assinatura."
    );
  }

  if (!partes.incorporador) {
    return (
      "Falta apontar quem assina os TERMOS pelo INCORPORADOR deste empreendimento: ninguém foi apontado em Assinatura de termos (vendedora), " +
      "e nenhuma pessoa está cadastrada como vendedora no quadro. " +
      "Aponte a pessoa no Quadro de assinatura do empreendimento, na aba Setup, sub-aba Assinatura, da tela do empreendimento (Apolo). " +
      "Pode ser alguém do jurídico ou um analista, não precisa ser o representante legal. Depois mande de novo."
    );
  }

  return null;
}

/**
 * A conferência da casa, antes de existir envelope.
 *
 * ⚠️ É A MESMA `conferirSignatarios` DO CONTRATO, e reusá-la não é economia de linha: ela é quem
 * recusa e-mail faltando, e-mail repetido, nome de uma palavra só e nome com número — as quatro
 * coisas que a Clicksign recusa DEPOIS de o envelope existir, com metade dos signatários dentro,
 * numa conta de produção onde o rascunho só se apaga enquanto ninguém ativou.
 *
 * ⚠️ E O E-MAIL REPETIDO TEM UM CASO NOVO AQUI: o comprador que deu como contato o e-mail da
 * própria imobiliária, ou a vendedora cujo representante usa o endereço institucional que a Careli
 * também usa. No contrato a armadilha é o cônjuge; no acordo, é a empresa.
 */
function conferencia(pessoas: readonly Pessoa[]): null | string {
  const veredito = conferirSignatarios(pessoas);
  return veredito.ok ? null : veredito.erro;
}
