import {
  type ApoloAuthResult,
  authorizeApoloCoordenacao,
  authorizeApoloRead,
} from "@/lib/apolo/auth";

// QUEM EMITE CONTRATO — o portão da Têmis, num lugar só.
//
// Lucas, 08/09/2026, com o portal comercial da Gurgel aberto no perfil de coordenador, vendo o
// botão "Gerar e guardar o contrato" no rodapé da prévia: *"estou como coordenador, não pode ter
// esse botão de gerar contrato, isso é somente o time administrativo interno"*. E a régua:
// *"para o perfil da gurgel, comercial, pode tirar. Na Têmis só quem tiver relacionado ao setor de
// contratos e os admin"*.
//
// ⚠️ ESCONDER O BOTÃO NÃO FECHA A PORTA. `/api/temis/contrato/gerar` é uma rota HTTP como outra
// qualquer: quem tem sessão a chama do console do navegador, sem passar pela tela. Tirar o botão
// resolve o que o coordenador VÊ; quem resolve o que ele PODE é esta função.
//
// ⚠️ ESTE ARQUIVO É O PONTO ÚNICO, E É DE PROPÓSITO. A etapa 2 (Lucas, mesma conversa: "só quem
// tiver relacionado ao setor de contratos") troca o recorte por papel do Hub por "tem `temis:manage`
// ou é admin", lido de `hub_permissions` — e a troca é dentro DESTAS duas funções, sem varrer rota
// por rota. `hub_permissions` ficou de fora agora porque foi MEDIDO: `temis` nem está cadastrado
// como recurso, a tabela de concessões está vazia e o único leitor dela é o Ares
// (`financeiro-view`/`financeiro-manage`) — ligar a checagem hoje trancaria a Têmis inteira,
// inclusive para quem tem que emitir.
//
// ⚠️ E HOJE ISTO NÃO TIRA NINGUÉM DE DENTRO — saber disso evita concluir que a trava foi provada em
// produção. Medido em `hub_users` (08/09/2026): dos 7 usuários ATIVOS, 2 são `admin` e 5 são
// `leader`; zero `operator` e zero `viewer`. O recorte da coordenação é a garantia para o dia em que
// existir um operador; o que muda hoje, na tela do Lucas, é o botão sair do portal.
//
// ⚠️ O COORDENADOR DO PORTAL NÃO ENTRA POR AQUI. Ele vem pelo cookie `apolo_inc`
// (`apolo_incorporador_usuarios` — 2 usuários no portal comercial da Gurgel, medido em 08/09/2026),
// que é outra sessão, com escopo por empreendimento assinado no login. Ver a nota de
// `lib/apolo/incorporador/sessao.ts`: a porta do Apolo não é a porta de quem vem de fora.

/**
 * EMITIR: cria o PDF, grava no bucket e abre linha em `hercules_documentos`. Recorte da
 * coordenação (admin + leader) — o `operator`/analista não emite contrato.
 *
 * ⚠️ NÃO É `authorizeApoloWrite`. Escrever no Apolo (importar CAD, mexer na esteira) é trabalho de
 * analista; emitir contrato é ato jurídico com número de versão e nome de quem gerou impresso na
 * gaveta. São dois "escrever" diferentes, e o segundo é mais estreito.
 */
export function autorizarEmissaoDeContrato(request: Request): Promise<ApoloAuthResult> {
  return authorizeApoloCoordenacao(request);
}

/**
 * ABRIR/LISTAR o que já foi emitido. Continua na leitura do Apolo, de propósito.
 *
 * ⚠️ VER UM CONTRATO JÁ GERADO NÃO É GERAR CONTRATO, e é exatamente o que o comercial faz na tela
 * de prévia: conferir. Fechar esta leitura no recorte da emissão apagaria "Abrir o contrato
 * guardado" do rodapé e, na Têmis, faria o botão de emitir mentir — é a lista por proposta que o faz
 * dizer "Gerar a versão 2" em vez de criar a v2 às escondidas.
 *
 * ⚠️ E NÃO ABRE PORTA NOVA: as mesmas linhas de `hercules_documentos` já são lidas com esta mesma
 * régua pela aba Documentos da venda e pela ficha do cliente no Apolo. O recorte que impede um id
 * qualquer de virar link assinado é o `tipo = contrato`, em `abrirContratoGuardado`.
 */
export function autorizarLeituraDeContrato(request: Request): Promise<ApoloAuthResult> {
  return authorizeApoloRead(request);
}
