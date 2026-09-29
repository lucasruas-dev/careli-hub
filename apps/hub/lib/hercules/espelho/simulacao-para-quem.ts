// PARA QUEM A SIMULAÇÃO FOI FEITA — o nome opcional que o corretor escreve no link do espelho.
//
// Lucas (27/09/2026): *"faz uma coisa para mim, na parte do simulador do link do espelho, coloca a
// opção de inserir um nome na proposta simulada"*.
//
// ⚠️ ELE NÃO É COMPRADOR, E ISSO É O PONTO INTEIRO. A seção COMPRADORES foi TIRADA da folha da
// simulação de propósito (`if (!dados.simulacao)`, em `lib/hercules/proposta-pdf.ts`) — Lucas
// (10/09/2026), vendo o primeiro PDF: *"isso é uma simulação, ou seja, não precisa nome"*. O que o
// pedido de 27/09 acrescenta é um RÓTULO de cortesia, "Simulação para Fulano", numa linha do alto
// da folha. Ninguém foi qualificado, nada foi assinado, `compradores` continua uma lista vazia, e
// nada disto é gravado em lugar nenhum: a rota da simulação não escreve no banco (medido: zero
// `insert`/`update`/`upsert` em `app/api/publico/espelho/simulacao/route.ts` e em toda a pasta
// `lib/hercules/espelho/`) e não deve passar a escrever por causa deste campo — o client dela é
// ADMIN, sem RLS, numa página SEM LOGIN.
//
// ⚠️ E É TEXTO LIVRE VINDO DE PÁGINA SEM LOGIN, o SEGUNDO desta rota. O primeiro é a descrição do
// bem (`TAMANHO_MAXIMO_DA_DESCRICAO = 300`, em `lib/hercules/bens-e-permutas.ts`), e ela mora numa
// TABELA, com coluna própria e corte visual. Este mora numa LINHA do alto do papel, ao lado de um
// rótulo fixo, embaixo da logo do empreendimento.
//
// ⚠️ ERRO MEDIDO E CORRIGIDO EM 27/09/2026: A PRIMEIRA VERSÃO DESTE ARQUIVO SÓ TINHA TETO DE
// TAMANHO, E O TETO NÃO BARRAVA FRASE NENHUMA. Medido com pdf-lib (Helvetica 8,6, linha útil de
// 526,28pt, rótulo "Simulação para " de 61,96pt, sobra de 464,32pt): *"RESERVADO E PAGO - CONTRATO
// ASSINADO - DESCONTO 40% OK"* (54 caracteres) mede 278,78pt, *"VOCE GANHOU ESTE LOTE. LIGUE 0800
// 000 0000 PARA RETIRAR."* (56) mede 270,68pt e *"Corretor Joao - WhatsApp 62 99999-9999 - Careli
// Oficial"* (55) mede 216,17pt. As três passavam pelo teto de 60 e saíam IMPRESSAS INTEIRAS, sem
// reticências, com 40% da linha de folga — a última transformando o PDF da Careli em papel de
// captura de um terceiro. O teto tinha sido medido contra UMA frase de 116 caracteres e
// generalizado para todas; e a própria frase de 116 mede 442,75pt, ou seja também caberia inteira
// se o teto não a cortasse. Por isso a régua deixou de ser só TAMANHO e passou a ser FORMA DE NOME.

/**
 * Quanto nome cabe na linha "Simulação para " da folha.
 *
 * ⚠️ 80, E O NÚMERO SAIU DE MEDIÇÃO COM pdf-lib EM 27/09/2026, NÃO DE CHUTE. A sobra da linha é
 * 464,32pt, onde cabem 97 letras "a", 64 "M" e 57 "W". "MARIA APARECIDA DA SILVA FERREIRA NOGUEIRA
 * DOS SANTOS OLIVEIRA" tem 62 caracteres e mede 311,72pt: um nome completo de verdade CABE na
 * linha, e o teto anterior de 60 o cortava em "...DOS SANTOS OLIVEI", sem marca nenhuma, entregando
 * ao cliente um nome com cara de digitado errado. 80 letras "a" medem 382,53pt e continuam dentro
 * da linha; 80 "W" medem 649,47pt e estouram, e para esse caso quem marca o corte é `encurtar`
 * (`proposta-pdf.ts`), que escreve as reticências.
 *
 * ⚠️ E ELE MORA AQUI, E NÃO NO JSX, porque a TELA usa o mesmo número no `maxLength` — o par exato da
 * descrição do bem (`SimuladorDeProposta.tsx`). Duas cópias do número é como o quadro do contrato
 * ganhou a própria soma e imprimiu R$ 2.000.080.000.100.000,00 embaixo de uma cláusula que dizia
 * R$ 0,00.
 */
export const TAMANHO_MAXIMO_DO_SIMULACAO_PARA = 80;

/**
 * Quantas palavras um nome de gente tem, no máximo.
 *
 * ⚠️ 9, E O NÚMERO É O DO NOME MEDIDO, NÃO UMA PREFERÊNCIA: "MARIA APARECIDA DA SILVA FERREIRA
 * NOGUEIRA DOS SANTOS OLIVEIRA" tem exatamente 9 palavras, e composto com "da", "dos" e "de" isso
 * é nome brasileiro comum. Serve para barrar PARÁGRAFO: a frase de 116 caracteres tem 20 palavras.
 *
 * ⚠️ E O QUE ELE NÃO BARRA, DITO EM VOZ ALTA: um slogan só de letras, de até 9 palavras, ainda
 * passa. Medido: *"RESERVADO E PAGO CONTRATO ASSINADO DESCONTO APROVADO PELA DIRETORIA"* tem 9
 * palavras e 67 caracteres, e sai impresso. Nenhuma contagem de palavras separa um nome de 9
 * palavras de um slogan de 9 palavras: quem derruba as três frases MEDIDAS no papel de hoje é a
 * régua de FORMA logo abaixo (todas as três carregam dígito), e não este número. Se o slogan puro
 * incomodar, o caminho é o Lucas decidir baixar isto para ~6 palavras sabendo que aí "MARIA
 * APARECIDA DA SILVA FERREIRA NOGUEIRA DOS SANTOS OLIVEIRA" deixa de sair.
 */
export const MAXIMO_DE_PALAVRAS_DO_SIMULACAO_PARA = 9;

/**
 * Tudo que o papel não sabe escrever, ou escreve sem se ver.
 *
 * ⚠️ TRÊS FAMÍLIAS, E CADA UMA POR UM MOTIVO MEDIDO:
 *
 *   • CONTROLE (U+0000..U+001F, U+007F..U+009F). `seguro()` (proposta-pdf.ts) APAGA o caractere em
 *     vez de trocá-lo por espaço, então "Maria\nJosé" saía impresso como "MariaJosé". E o NUL ainda
 *     quebraria um `Content-Disposition` no dia em que alguém levasse o nome ao nome do arquivo.
 *   • INVISÍVEIS DO LATIN-1 (U+00AD, o hífen mole, e U+00A0, o espaço fixo). Estes SOBREVIVEM a
 *     `seguro()`, porque estão dentro da faixa que a Helvetica escreve — e no papel não se veem.
 *   • FORA DO LATIN-1 (acima de U+00FF). `seguro()` os joga fora: um nome só em cirílico ou em emoji
 *     chegaria ao papel como um rótulo "Simulação para" com nada depois. Aqui eles viram espaço, e
 *     um nome que sobra vazio é tratado como nome nenhum. É também o que tira o override de direção
 *     U+202E, que desenha o texto ao contrário.
 */
// Tirar caractere de controle É o trabalho desta expressão; a regra do eslint existe para pegar
// quem os escreveu sem querer.
// eslint-disable-next-line no-control-regex
const O_QUE_O_PAPEL_NAO_ESCREVE = /[\u0000-\u001f\u007f-\u009f\u00ad\u00a0]|[^\u0020-\u00ff]/g;

/**
 * A FORMA de um nome de pessoa: letra (com acento), espaço, apóstrofo, hífen e ponto. Nada mais.
 *
 * ⚠️ FOI ESTA RÉGUA QUE FALTAVA, E ELA ACEITA EXATAMENTE OS NOMES QUE A PRIMEIRA VERSÃO USOU PARA
 * SE DEFENDER: "D'Ávila", "Ana-Clara" e "Jr." passam (medido no teste ao lado). O que ela derruba é
 * dígito, %, R$, @, barra, parêntese e vírgula — e com eles as TRÊS frases medidas no papel:
 * "DESCONTO 40% OK" (tem dígito e %), "LIGUE 0800 000 0000" (dígito) e "WhatsApp 62 99999-9999"
 * (dígito). A recusa anterior de "lista branca de letras" foi escrita contra um espantalho: ela
 * dizia que barrar apóstrofo, hífen ou ponto mataria esses três nomes, e ninguém precisa barrá-los.
 *
 * ⚠️ AS LETRAS SÃO AS DO LATIN-1, e não `\p{L}`, porque o papel não escreve fora do Latin-1: o que
 * está acima de U+00FF já virou espaço em `O_QUE_O_PAPEL_NAO_ESCREVE`. Faixas: A-Z, a-z,
 * U+00C0..U+00D6, U+00D8..U+00F6, U+00F8..U+00FF (o "×" U+00D7 e o "÷" U+00F7 ficam de fora, e é o
 * que se quer).
 */
const FORMA_DE_NOME = /^[A-Za-z\u00c0-\u00d6\u00d8-\u00f6\u00f8-\u00ff'. -]+$/;

/** Pelo menos uma letra: "..." e "- - -" casam com a forma e não são nome de ninguém. */
const TEM_LETRA = /[A-Za-z\u00c0-\u00d6\u00d8-\u00f6\u00f8-\u00ff]/;

/**
 * O nome que a folha da simulação pode imprimir, ou nulo quando ninguém informou nada.
 *
 * ⚠️ NULO EM VEZ DE 422, E ISSO NÃO É BRANDURA: quem digita coisa que não é nome recebe o PDF, só
 * sem a linha "Simulação para" — exatamente a folha de quem não digitou nada. Derrubar o PDF
 * inteiro castigaria quem só queria ver o preço, e esta folha jura no rodapé que não constitui
 * proposta, não reserva a unidade e não vincula as partes. Quem avisa ANTES do clique é a tela
 * (`EspelhoPublico.tsx`), que lê esta mesma função e escreve "a folha sai sem esta linha".
 *
 * ⚠️ E O CORTE, QUANDO ACONTECE, É NO ESPAÇO E COM RETICÊNCIAS. O `.slice(0, 60)` da primeira
 * versão partia palavra no meio e calado: "...DOS SANTOS OLIVEI" chega ao cliente com cara de nome
 * digitado errado, e não de nome cortado. Aqui o corte recua até o último espaço e escreve "...",
 * o mesmo sinal que `encurtar` usa no papel.
 */
export function simulacaoParaAceito(valor: unknown): null | string {
  if (typeof valor !== "string") return null;

  const limpo = valor
    // ⚠️ NFC PRIMEIRO, SENÃO O PAPEL APAGA O ACENTO. Quem digita no celular produz forma
    // DECOMPOSTA ("a" + U+0301), e `seguro()` joga o acento combinante fora: "Márcia" chegaria à
    // folha como "Marcia". Medido em 27/09/2026.
    .normalize("NFC")
    .replace(O_QUE_O_PAPEL_NAO_ESCREVE, " ")
    // Espaço repetido colapsa: a folha tem uma linha para isto, e não um alinhamento.
    .replace(/\s+/g, " ")
    .trim();

  if (limpo === "") return null;
  if (!FORMA_DE_NOME.test(limpo)) return null;
  if (!TEM_LETRA.test(limpo)) return null;
  if (limpo.split(" ").length > MAXIMO_DE_PALAVRAS_DO_SIMULACAO_PARA) return null;
  if (limpo.length <= TAMANHO_MAXIMO_DO_SIMULACAO_PARA) return limpo;

  // ⚠️ AS RETICÊNCIAS CONTAM PARA O TETO: o que sai daqui nunca passa de
  // `TAMANHO_MAXIMO_DO_SIMULACAO_PARA`, senão o teste que mede o tamanho mediria outra coisa que
  // não o tamanho impresso.
  const cabe = limpo.slice(0, TAMANHO_MAXIMO_DO_SIMULACAO_PARA - 3);
  const ultimoEspaco = cabe.lastIndexOf(" ");
  const base = ultimoEspaco > 0 ? cabe.slice(0, ultimoEspaco) : cabe;

  return `${base.trimEnd()}...`;
}
