// A FOLHA DA PA — Proposta de Aquisição em A4, UMA POR UNIDADE reservada (Lucas, 24/08).
//
// Redesenho do documento do C2X que o Lucas mandou ("acho esse layout feio"): mesma estrutura
// jurídica (planos, declarações, recibo, assinaturas), layout limpo e PRÉ-PREENCHIDO com o que
// a reserva já sabe — proponente, CPF, imobiliária, corretor, quadra/lote/área — e os planos
// CALCULADOS do preço de tabela da unidade. O corretor só marca o plano e o vencimento.
//
// Impressão em documento isolado (iframe), padrão da casa; no posto com Chrome em modo
// quiosque a folha sai direto na A4 padrão, sem diálogo.

import {
  calcularParcela,
  fraseDeCorrecao,
  nomeDoIndice,
  ordenarParaAFolha,
  type PlanoComercial,
  rotuloDoPlano,
  textoDaTaxa,
  textoDoSinal,
} from "@/lib/apolo/planos-comerciais";

export type UnidadeDaPa = {
  area: null | string;
  codigo: string;
  lote: string;
  precoTabela: null | number;
  quadra: string;
  // Quando a reserva NASCEU (created_at da linha) — identificação forte: o mesmo lote pode
  // ser reservado, cancelado e reservado por outro cliente no mesmo dia; o papel na mesa
  // tem que apontar para O registro certo (Lucas, 24/08).
  reservadaEm: string;
};

export type ProponenteDaPa = {
  documento: null | string;
  nome: string;
  percentual: number;
};

export type DadosDaPa = {
  codigoCupom: string;
  /**
   * URL ABSOLUTA da logo da C2X, no topo da folha.
   *
   * ⚠️ É a MARCA que vai ali, e não o código da unidade (Lucas, 28/08: *"quando falei de
   * referencia c2x, eu queria a logo da c2x"*). O código continua no rodapé, junto do cupom,
   * que é onde ele serve para conferência. Caminho relativo não resolve dentro do iframe
   * about:blank — mesma lição da etiqueta e do cupom.
   */
  logoSrc: string;
  corretor: null | string;
  dataExtensa: string;
  imobiliaria: null | string;
  incorporadora: null | string;
  lancamento: string;
  /**
   * OS PLANOS DO EMPREENDIMENTO — quem manda no que a folha promete.
   *
   * ⚠️ VÊM DE FORA, sempre. A folha não tem plano próprio nem plano de reserva: quem decide o
   * que imprimir é a rota do cupom, que lê o empreendimento do lançamento e só cai nos planos
   * padrão da casa quando não há o que ler — avisando na TELA do posto, nunca no papel.
   */
  planos: PlanoComercial[];
  // Até 5 (limite do C2X); o 1º é o titular. A % de posse sai ao lado de cada um.
  proponentes: ProponenteDaPa[];
  qrDataUrl: string;
  unidades: UnidadeDaPa[];
};

// O DESENHO DA FOLHA — A4, uma por unidade, UMA PÁGINA SÓ, até 5 proponentes.
//
// ⚠️ REDESENHADA EM 28/08/2026, em três rodadas com o Lucas:
//
// 1. *"Achei muito fraca, quero algo mais bonito"* → os planos do lançamento encolheram de uma
//    tabela 4×4 para TRÊS LINHAS lidas como frase (sinal, parcelas, correção), e o espaço foi
//    para o plano personalizado, que virou o bloco principal da folha.
// 2. *"Quero em uma pagina somente"* + o texto jurídico completo → o técnico ficou miúdo
//    (5,4pt) e o recibo saiu da folha para o WhatsApp.
// 3. *"Simula um com 5 proponentes que será o maximo"* → o bloco de quem assina virou TABELA,
//    não grade de pares. Com cinco pessoas, a grade de duas colunas empurrava tudo para baixo;
//    a tabela põe nome, CPF e posse na mesma linha e cabe com folga.
//
// ⚠️ É UNIDADE, NÃO IMÓVEL (Lucas, 28/08: *"tira imovel e coloca unidade"*). Vale para o título
// e para o texto jurídico: "unidade" é como o C2X, o Apolo e o time chamam a coisa; "imóvel"
// era herança do documento antigo e criava duas palavras para o mesmo objeto.
//
// ⚠️ IMPRIME EM LASER PRETO E BRANCO. A hierarquia sai de peso, tamanho e filete; preenchimento
// sólido só nas faixas de seção, porque em A4 área preta grande é toner gasto.
export const PA_CSS = `
  @page { size: A4; margin: 8mm 10mm; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: Arial, Helvetica, sans-serif;
    color: #14161a;
    font-size: 9pt;
    line-height: 1.35;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  /* ⚠️ A FOLHA NÃO PODE PASSAR DA ÁREA IMPRIMÍVEL (210mm − 2×10mm de margem = 190mm).
     max-width e a rede: se algum bloco futuro pedir mais largura, ele se ajusta em vez de
     sair pela borda direita e ser cortado pela impressora, que foi o que aconteceu em 29/08. */
  .folha { page-break-after: always; max-width: 190mm; overflow: hidden; }
  .folha:last-child { page-break-after: auto; }

  /* CABEÇALHO — a unidade é o assunto da folha, então ela ocupa a direita inteira em caixas
     legíveis de longe: é por elas que o administrativo acha a folha certa na pilha. A
     REFERÊNCIA DO C2X fica no alto, junto do nome do lançamento, porque é o que amarra este
     papel ao sistema (Lucas, 28/08: "faltou a referencia do C2X"). */
  /* TRÊS COLUNAS: marca à esquerda, identificação ao centro, unidade à direita.
     ⚠️ AS LATERAIS NÃO TÊM LARGURA FIXA. A primeira versão travava as duas em 46mm para o
     centro cair no meio exato da página — só que o quadro da unidade precisa de quase 60mm, e
     com flex 0 0 46mm ele TRANSBORDOU para fora do papel: na impressão, as linhas da
     direita saíram cortadas e as palavras comidas. Agora cada lateral ocupa o que precisa e o
     centro fica com o resto; o nome fica visualmente equilibrado sem empurrar nada para fora. */
  .topo { display: flex; align-items: center; gap: 4mm; }
  .topo-l, .topo-r { flex: 0 0 auto; }
  .topo-c { flex: 1 1 auto; text-align: center; min-width: 0; }
  .logo { height: 8mm; width: auto; display: block; }

  /* ⚠️ ARIAL, E NÃO SERIF. O nome vinha em Georgia e destoava do resto da folha, que é Arial
     inteira (Lucas, 28/08: "melhorar a fonte, está destoando do reto"). Sem a serifa, o peso e
     o espaçamento é que fazem o nome ter presença — e a folha passa a ter UMA voz tipográfica. */
  .marca {
    font-size: 12pt; font-weight: 700; letter-spacing: 0.06em; line-height: 1.1;
    text-transform: uppercase;
    /* Nome comprido quebra em duas linhas em vez de empurrar o quadro da unidade para fora. */
    overflow-wrap: break-word;
  }
  .tit {
    font-size: 7pt; font-weight: 700; letter-spacing: 0.24em; text-transform: uppercase;
    margin-top: 1mm; color: #14161a;
  }

  /* A UNIDADE, EM TRÊS BLOCOS — é o que o administrativo procura primeiro na pilha de folhas.
     Eram três caixas soltas de borda fina; viraram um quadro único com filete interno, rótulo
     em faixa cinza e o valor grande. Sem espaço morto entre elas, o olho lê "G · 06 · 376,56"
     como uma coisa só, que é como a unidade é falada. */
  .lotebox { display: flex; border: 1.4px solid #14161a; text-align: center; flex-shrink: 0; }
  .lotebox div { min-width: 17mm; border-right: 0.8px solid #14161a; }
  .lotebox div:last-child { border-right: 0; }
  /* Rótulo em preto sólido com texto branco (Lucas: "deixa mais escuro os titulos do
     quadrado"): o cinza claro sumia na cópia, e é por estes três rótulos que o administrativo
     acha a folha certa na pilha. */
  .lotebox i {
    display: block; font-style: normal;
    font-size: 5.5pt; letter-spacing: 0.14em; color: #fff; text-transform: uppercase;
    background: #14161a; padding: 0.7mm 2mm;
    print-color-adjust: exact; -webkit-print-color-adjust: exact;
  }
  .lotebox b { font-size: 13pt; line-height: 1.15; display: block; padding: 1.2mm 2mm 0.4mm; }
  .lotebox u { text-decoration: none; font-size: 5.5pt; font-weight: 700; color: #14161a; display: block; padding-bottom: 1mm; }
  .regua { height: 1.8px; background: #14161a; margin: 2mm 0 2.5mm; }

  /* QUEM ASSINA — tabela, para caber cinco proponentes sem empurrar a folha. */
  .pessoas { width: 100%; border-collapse: collapse; }
  .pessoas th {
    font-size: 5.5pt; letter-spacing: 0.11em; color: #14161a; text-transform: uppercase;
    text-align: left; font-weight: 700; padding: 0 0 0.6mm;
    border-bottom: 0.8px solid #14161a;
  }
  .pessoas td { font-size: 8.5pt; padding: 0.6mm 0; border-bottom: 0.8px solid #dfe2e5; }
  .pessoas td:first-child { font-weight: 700; }
  .pessoas .num { color: #14161a; font-weight: 700; font-size: 6pt; padding-right: 1.5mm; }
  .pessoas .cpf { width: 32mm; }
  .pessoas .pct { width: 16mm; text-align: right; }
  .interm { display: grid; grid-template-columns: 1fr 1fr; gap: 1mm 6mm; margin-top: 1.5mm; }
  .interm div { border-bottom: 0.8px solid #c3c7cc; padding: 0.6mm 0; }
  .interm i { font-style: normal; font-size: 5.5pt; font-weight: 700; letter-spacing: 0.11em; color: #14161a; display: block; }
  .interm b { font-size: 8.5pt; }

  .sec {
    background: #14161a; color: #fff;
    font-size: 6.5pt; font-weight: 700; letter-spacing: 0.15em; text-transform: uppercase;
    padding: 0.8mm 2.5mm; margin: 2mm 0 1.2mm;
    print-color-adjust: exact; -webkit-print-color-adjust: exact;
  }
  .sec .nota { float: right; font-weight: 400; letter-spacing: 0.05em; opacity: 0.75; text-transform: none; }

  /* Valor de tabela à esquerda e o dia de vencimento à direita, na mesma linha: as duas
     decisões que valem para QUALQUER plano ficam juntas, antes de o corretor escolher um
     (Lucas: "o dia de vencimento das parcelas pode ir para depois do valor de tabela"). */
  .tabela { display: flex; align-items: baseline; gap: 2mm; margin-bottom: 1.5mm; }
  .tabela i { font-style: normal; font-size: 6pt; font-weight: 700; letter-spacing: 0.12em; color: #14161a; }
  .tabela b { font-size: 12pt; }
  .tabela .venc { margin-left: auto; font-size: 7pt; letter-spacing: 0.03em; color: #14161a; }
  .tabela .venc b { font-size: 9pt; font-weight: 400; }

  /* PLANOS — uma linha por plano, lida como frase. */
  .plano {
    display: grid;
    grid-template-columns: 32mm 1fr 1fr 32mm;
    align-items: center;
    gap: 2mm;
    border: 0.8px solid #c3c7cc;
    border-bottom: 0;
    padding: 0.85mm 2.5mm;
  }
  /* ⚠️ last-of-type, e NÃO nth-of-type(3): desde 29/08 a quantidade de planos vem do
     empreendimento (o C2X tem lançamentos com dois e com quatro). Com o índice fixo, um
     lançamento de dois planos ficava com a moldura aberta embaixo. */
  .plano:last-of-type { border-bottom: 0.8px solid #c3c7cc; }
  .plano .nome { font-size: 8pt; font-weight: 700; letter-spacing: 0.07em; }
  .plano .nome span { font-size: 10pt; font-weight: 400; margin-right: 1mm; }
  .plano em { font-style: normal; font-size: 5.5pt; font-weight: 700; letter-spacing: 0.1em; color: #14161a; display: block; }
  .plano b { font-size: 9pt; }
  .plano .obs { font-size: 6pt; color: #14161a; text-align: right; }

  /* PERSONALIZADO — o bloco principal. Moldura forte para dizer que é aqui que se escreve. */
  .perso { border: 1.5px solid #14161a; margin-top: 2.5mm; }
  .perso-tit {
    background: #14161a; color: #fff;
    font-size: 7pt; font-weight: 700; letter-spacing: 0.15em; text-transform: uppercase;
    padding: 1.1mm 2.5mm;
    print-color-adjust: exact; -webkit-print-color-adjust: exact;
  }
  .perso-tit .nota { float: right; font-weight: 400; letter-spacing: 0.04em; opacity: 0.75; text-transform: none; }
  /* ⚠️ QUADRADO BRANCO SÓLIDO, e não o caractere ☐ (Lucas, 29/08: "tem que deixar o quadrado
     com fundo branco, para ser marcados"). Na faixa preta o ☐ sai como contorno branco sobre
     preto, e caneta não marca em cima de preto — o corretor não tinha onde fazer o X. Aqui o
     quadrado é uma janela branca recortada na faixa. */
  .perso-tit .chk {
    display: inline-block;
    width: 3.2mm; height: 3.2mm;
    background: #fff;
    vertical-align: -0.5mm;
    margin-right: 1.8mm;
    print-color-adjust: exact; -webkit-print-color-adjust: exact;
  }
  .perso-corpo { padding: 1.6mm 3mm 2mm; }
  /* EM BRANCO, SEM RÓTULO NENHUM (Lucas, 28/08: *"o plano personalizado vc pode diminuir um
     pouco e deixa em branco sem nada escrito"*). A versão anterior guiava o corretor com onze
     perguntas impressas; ele preferiu a folha livre, e a folha livre é dele. Ficam só as linhas
     pautadas: elas não dizem o que escrever, mas fazem a escrita sair reta e legível para quem
     digita a proposta depois. */
  /* SEM LINHA NENHUMA (Lucas: "plano personalizado sem linhas, somente a marcação em
     branco"). Só o espaço em branco dentro da moldura — quem escreve decide o formato. */
  .pauta { height: 26mm; }

  /* TEXTO TÉCNICO — miúdo de propósito (Lucas: "a fonte do texto mais tecnico pode ser menor").
     5,4pt em laser 600dpi continua legível; abaixo disso a cópia começa a fechar as letras. */
  .regras { font-size: var(--regras); color: #23272d; margin-top: 2mm; line-height: 1.35; text-align: justify; }
  .decl { font-size: var(--decl); color: #23272d; line-height: var(--decl-lh); text-align: justify; padding-left: 3.6mm; }
  .decl > li { margin-bottom: 0.5mm; }
  .decl ol { padding-left: 3.6mm; margin-top: 0.5mm; }
  .decl ol > li { margin-bottom: 0.4mm; }

  /* ASSINATURAS — uma por proponente, mais a da Empreendedora. Com cinco proponentes são seis
     linhas, então elas quebram em duas fileiras em vez de espremer tudo numa só. */
  .assin { display: flex; flex-wrap: wrap; gap: 3.5mm 6mm; margin-top: 5mm; }
  .assin div { flex: 1 1 42mm; border-top: 0.9px solid #14161a; padding-top: 1mm; text-align: center; font-size: 6.5pt; }
  .assin i { font-style: normal; display: block; font-size: 5pt; font-weight: 700; letter-spacing: 0.1em; color: #14161a; text-transform: uppercase; margin-top: 0.3mm; }

  .rodape { display: flex; align-items: center; gap: 3mm; margin-top: 2.5mm; padding-top: 1.2mm; border-top: 0.8px dashed #adb2b8; }
  .rodape img { width: 11mm; height: 11mm; }
  .rodape span { font-size: 6pt; color: #14161a; line-height: 1.35; }
  .rodape b { font-size: 7.5pt; letter-spacing: 0.1em; color: #14161a; }
`;

function esc(valor: string | null | undefined): string {
  return (valor ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function moeda(valor: null | number): string {
  if (valor == null || !Number.isFinite(valor)) return "________________";
  return valor.toLocaleString("pt-BR", { currency: "BRL", style: "currency" });
}

function cpfBR(doc: string | null): string {
  const d = (doc ?? "").replace(/\D/g, "");
  if (d.length !== 11) return doc ?? "____________________";
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
}

// ⚠️ OS PLANOS SAÍRAM DAQUI EM 29/08/2026 — e a razão é maior do que "virou configuração".
//
// Até esta data, os três planos estavam FIXOS neste arquivo com os números do documento do
// Villa Paris (sinal 20%/12×, 30%/36×, 10%/120× em Tabela Price a 8% a.a.), e eram impressos
// em qualquer lançamento. A medição no C2X mostrou o tamanho do problema:
//
//   • 24 empreendimentos têm planos cadastrados, TODOS diferentes entre si. O plano NORMAL vai
//     de 37 a 200 parcelas; a entrada, de 0% a 30%.
//   • 21 dos 24 são SACOOC, e nos SACOOC a parcela emitida é a AMORTIZAÇÃO PURA, sem juros
//     embutidos — enquanto esta folha calculava tudo em Tabela Price.
//   • Nem o próprio Villa Paris batia: o C2X emite 180 parcelas de R$ 1.100,00 onde a folha
//     imprimia 120 de R$ 2.402,29. Parcela 2,2× maior, prazo 60 meses menor, no papel que o
//     cliente assina.
//
// A regra de cálculo agora vive em lib/apolo/planos-comerciais.ts, com os casos reais medidos
// como teste; os números vêm do empreendimento do lançamento, pela rota do cupom.
//
// ⚠️ A FOLHA NÃO ESCOLHE PLANO NEM INVENTA NÚMERO. Se `dados.planos` chegar vazio, ela imprime
// o que recebeu e quem avisa é a TELA do posto. Papel não é lugar de aviso de sistema.
// O TAMANHO DO TEXTO TÉCNICO DEPENDE DE QUANTOS ASSINAM.
//
// ⚠️ A folha tem altura fixa e conteúdo variável: cada proponente a mais custa uma linha na
// tabela e uma assinatura no rodapé. Com um proponente sobrava um palmo de papel em branco e o
// texto jurídico ficava miúdo à toa; com cinco, ele precisa encolher para tudo caber numa
// página (Lucas, 29/08: *"se foi um, ou dois proponentes, aumentar um pouco a escrita tecnica,
// ficou muito pequeno e sobrou muita folha (...) quando tiver os 5 acho que pode aumentar um
// pouquinho pois sobrou um pouco de folha"*).
//
// ⚠️ E TAMBÉM DE QUANTOS PLANOS O EMPREENDIMENTO TEM (29/08/2026). Enquanto os planos eram
// três constantes no código, a única variável era a quantidade de proponentes. Agora eles vêm
// do cadastro, e cada plano custa uma linha na tabela MAIS uma alínea no texto jurídico. Medido:
// o quarto plano sozinho empurra a folha em ~14mm, mais do que dois proponentes a mais.
//
// ⚠️ CADA VALOR SAIU DE UMA VARREDURA MEDIDA no navegador, e foi REFEITA nesta data porque o
// texto jurídico deixou de ser fixo: as 25 combinações (1..5 proponentes × 1..5 planos) foram
// renderizadas em todos os tamanhos de 7,6pt para baixo, com os nomes de plano mais longos que
// existem no C2X ("10% ENTRADA + 200 PARCELAS") e todos com juros, que é a alínea mais comprida.
// Ficou o MAIOR tamanho que cabe deixando ~6mm de sobra sobre os 281mm úteis do A4.
//
// A relação não é a intuitiva: mais proponentes custam linhas de tabela E blocos de assinatura,
// e a partir do quinto eles quebram numa segunda fileira. Por isso isto é uma tabela medida, e
// não uma fórmula.
//
// ⚠️ A ENTRELINHA SÓ APERTA QUANDO PRECISA. A varredura tenta 1,34 primeiro e só desce para
// 1,22 quando manter a entrelinha folgada obrigaria a fonte a furar o piso de legibilidade —
// entrelinha apertada incomoda menos, na laser, do que letra fechada.
//
// ⚠️ O PISO DE LEGIBILIDADE É 5,2pt. Abaixo disso a laser começa a falhar as letras, que foi
// exatamente a reclamação do Lucas em 29/08 sobre os textos miúdos. Até TRÊS planos — a faixa
// que existe de verdade, já que nenhum dos 24 empreendimentos do C2X tem mais de três planos
// amarrados aos slots — todas as combinações cabem acima do piso. As entradas de quatro e cinco
// planos ficam abaixo dele e estão marcadas: são um seguro para um cadastro futuro, não um
// caso suportado. Se aparecerem de verdade, a saída não é encolher mais a fonte.
//
// ⚠️ Mexer aqui sem repetir a varredura é como a folha volta a passar para a segunda página no
// meio do evento — sem ninguém perceber até o papel sair.
const ESCALA_DO_TEXTO: Record<string, { decl: number; entrelinha: string }> = {
  // proponentes × planos
  "1x1": { decl: 7.4, entrelinha: "1.34" },
  "1x2": { decl: 6.7, entrelinha: "1.34" },
  "1x3": { decl: 6.2, entrelinha: "1.34" },
  "1x4": { decl: 6.0, entrelinha: "1.34" },
  "1x5": { decl: 5.5, entrelinha: "1.34" },

  "2x1": { decl: 7.1, entrelinha: "1.34" },
  "2x2": { decl: 6.6, entrelinha: "1.34" },
  "2x3": { decl: 6.2, entrelinha: "1.34" },
  "2x4": { decl: 5.7, entrelinha: "1.34" },
  "2x5": { decl: 5.2, entrelinha: "1.34" },

  "3x1": { decl: 6.7, entrelinha: "1.34" },
  "3x2": { decl: 6.3, entrelinha: "1.34" },
  "3x3": { decl: 5.9, entrelinha: "1.34" },
  "3x4": { decl: 5.5, entrelinha: "1.34" },
  "3x5": { decl: 5.1, entrelinha: "1.22" }, // abaixo do piso

  "4x1": { decl: 6.2, entrelinha: "1.34" },
  "4x2": { decl: 5.7, entrelinha: "1.34" },
  "4x3": { decl: 5.4, entrelinha: "1.34" },
  "4x4": { decl: 5.2, entrelinha: "1.22" },
  "4x5": { decl: 4.5, entrelinha: "1.22" }, // abaixo do piso

  "5x1": { decl: 6.1, entrelinha: "1.34" },
  "5x2": { decl: 5.6, entrelinha: "1.34" },
  "5x3": { decl: 5.2, entrelinha: "1.34" },
  "5x4": { decl: 5.0, entrelinha: "1.22" }, // abaixo do piso
  "5x5": { decl: 4.3, entrelinha: "1.22" }, // abaixo do piso
};

function naFaixa(valor: number): number {
  return Math.min(5, Math.max(1, Math.round(valor) || 1));
}

function escalaDoTextoTecnico(
  proponentes: number,
  planos: number,
): { decl: string; entrelinha: string; regras: string } {
  // Fora da faixa cai no caso mais apertado: é melhor sobrar papel do que estourar a página.
  const chave = `${naFaixa(proponentes)}x${naFaixa(planos)}`;
  const medida = ESCALA_DO_TEXTO[chave] ?? ESCALA_DO_TEXTO["5x5"]!;
  // As regras andam 0,4pt acima das declarações — é um parágrafo só, e ele é o que o corretor
  // lê em voz alta para o cliente. A varredura mediu com essa mesma diferença.
  return {
    decl: `${medida.decl}pt`,
    entrelinha: medida.entrelinha,
    regras: `${Math.round((medida.decl + 0.4) * 10) / 10}pt`,
  };
}

/**
 * O parágrafo jurídico que descreve cada plano por extenso — a alínea B) em diante.
 *
 * ⚠️ DERIVADO DOS MESMOS OBJETOS QUE FAZEM A CONTA. Antes este texto era uma string fixa
 * repetindo "12 parcelas fixas", "36 parcelas", "até 120 parcelas pela Tabela Price, com juros
 * de 8% ao ano" — ao lado de números que eram calculados em outro lugar. Bastava um dos dois
 * mudar para o papel dizer uma coisa na tabela e outra na cláusula, sem erro visível. Agora os
 * dois saem da mesma fonte e não têm como divergir.
 */
function textoDasRegras(planos: PlanoComercial[]): string {
  // ⚠️ O RÓTULO VEM DO SLOT (INVESTIDOR/CURTO/NORMAL), nunca do nome cadastrado no C2X — ver a
  // nota em `rotuloDoPlano`. Foi isso que matou o "PLANO PLANO-NORMAL" da primeira prévia: o
  // texto prefixa "PLANO" porque o documento oficial escreve assim, e metade dos nomes de lá
  // já vinha com a palavra.
  const alineas = planos.map((p) => {
    const taxa = textoDaTaxa(p);
    const correcao =
      p.indiceCorrecao === "SEM_CORRECAO"
        ? "sem correção monetária"
        : `com correção monetária positiva pelo ${nomeDoIndice(p.indiceCorrecao)}`;

    // Sem entrada e sem juros, o plano é uma frase só — é como o documento oficial descrevia o
    // INVESTIDOR ("12 parcelas fixas, sem juros e sem correção").
    if (p.entradaPercentual <= 0 && !taxa) {
      return `<b>PLANO ${esc(rotuloDoPlano(p))}:</b> ${p.parcelas} parcelas fixas, sem juros e ${correcao}.`;
    }

    // ⚠️ A REDAÇÃO SEGUE O DOCUMENTO QUE O LUCAS APROVOU EM 29/08, palavra por palavra onde os
    // números permitem — "sinal mínimo de N%. O saldo de M% é financiado em K parcelas…". Só
    // os números e o trecho da amortização variam. Além da fidelidade jurídica, o texto tem
    // que caber: cada frase a mais aqui empurra a folha para a segunda página e obriga a
    // encolher a fonte, e abaixo de ~5,2pt a laser começa a falhar as letras.
    const abertura =
      p.entradaPercentual > 0
        ? `sinal mínimo de ${esc(textoDoSinal(p))}. O saldo de ${esc(
            `${Number((100 - p.entradaPercentual).toFixed(2))}`.replace(".", ","),
          )}% é`
        : "o valor da unidade é";

    const financiamento = !taxa
      ? `dividido em ${p.parcelas} parcelas, sem juros`
      : p.sistemaAmortizacao === "price"
        ? `financiado em até ${p.parcelas} parcelas pela Tabela Price, com juros de ${esc(taxa)} já embutidos na parcela`
        : p.sistemaAmortizacao === "sac"
          ? `financiado em ${p.parcelas} parcelas pelo sistema SAC, com juros de ${esc(taxa)} sobre o saldo devedor e parcelas decrescentes`
          : `financiado em ${p.parcelas} parcelas de amortização constante, com juros de ${esc(taxa)} aplicados no reajuste anual`;

    return `<b>PLANO ${esc(rotuloDoPlano(p))}:</b> ${abertura} ${financiamento}, ${correcao}.`;
  });

  const letra = (i: number) => `<b>${String.fromCharCode(65 + i)})</b>`;
  const partes = [
    `${letra(0)} Independentemente da modalidade do Plano escolhido, o valor do sinal deverá ser pago em até dois dias úteis, contados da assinatura da presente Proposta.`,
    ...alineas.map((a, i) => `${letra(i + 1)} ${a}`),
    `${letra(alineas.length + 1)} <b>PLANO PERSONALIZADO:</b> sujeito à aprovação da Empreendedora.`,
  ];
  return partes.join(" ");
}

/** Uma linha de plano pré-definido: caixa, nome, sinal, parcelas e a regra de correção. */
function linhaDoPlano(entrada: {
  correcao: string;
  nome: string;
  parcela: null | number;
  parcelas: number;
  percentual: string;
  sinal: null | number;
}): string {
  return `<div class="plano">
    <div class="nome"><span>☐</span>${esc(entrada.nome)}</div>
    <div><em>SINAL ${esc(entrada.percentual)}</em><b>${moeda(entrada.sinal)}</b></div>
    <div><em>${entrada.parcelas}× DE</em><b>${moeda(entrada.parcela)}</b></div>
    <div class="obs">${esc(entrada.correcao)}</div>
  </div>`;
}

export function folhaHTML(dados: DadosDaPa, unidade: UnidadeDaPa): string {
  const planosDaFolha = ordenarParaAFolha(dados.planos);
  const vendedora = esc(dados.incorporadora ?? "a Empreendedora");

  // ⚠️ ATÉ CINCO PROPONENTES, e todos precisam sair com nome, CPF e posse — é o que dá validade
  // à assinatura de cada um. Em TABELA e não em grade de pares (Lucas, 28/08: *"simula um com 5
  // proponentes que será o maximo que teremos de reserva, ae vc pode organizar melhor os
  // nomes"*): com cinco pessoas, a grade de duas colunas empurrava a folha para a segunda
  // página; a tabela põe os três dados na mesma linha e cabe com folga.
  const linhasDePessoas = dados.proponentes
    .map(
      (p, indice) => `<tr>
        <td><span class="num">${indice + 1}</span>${esc(p.nome)}</td>
        <td class="cpf">${esc(cpfBR(p.documento))}</td>
        <td class="pct">${String(p.percentual).replace(".", ",")}%</td>
      </tr>`,
    )
    .join("");

  const escala = escalaDoTextoTecnico(
    dados.proponentes.length,
    planosDaFolha.length,
  );

  return `<div class="folha" style="--decl:${escala.decl};--decl-lh:${escala.entrelinha};--regras:${escala.regras}">
    <div class="topo">
      <div class="topo-l"><img class="logo" src="${esc(dados.logoSrc)}" alt="C2X"></div>
      <div class="topo-c">
        <div class="marca">${esc(dados.lancamento)}</div>
        <div class="tit">Proposta de aquisição</div>
      </div>
      <div class="topo-r">
        <div class="lotebox">
          <div><i>QUADRA</i><b>${esc(unidade.quadra)}</b></div>
          <div><i>LOTE</i><b>${esc(unidade.lote)}</b></div>
          <div><i>ÁREA</i><b>${esc(unidade.area ?? "—")}</b><u>m²</u></div>
        </div>
      </div>
    </div>
    <div class="regua"></div>

    <table class="pessoas">
      <tr><th>Proponentes</th><th class="cpf">CPF</th><th class="pct">Posse</th></tr>
      ${linhasDePessoas}
    </table>
    <div class="interm">
      <div><i>IMOBILIÁRIA</i><b>${esc(dados.imobiliaria ?? "")}</b></div>
      <div><i>CORRETOR</i><b>${esc(dados.corretor ?? "")}</b></div>
    </div>

    <div class="sec">Planos comerciais <span class="nota">marque um, ou use o personalizado abaixo</span></div>
    <div class="tabela">
      <i>VALOR DE TABELA</i><b>${moeda(unidade.precoTabela)}</b>
      <span class="venc">DIA DE VENCIMENTO DAS PARCELAS: &nbsp; <b>☐</b> 10 &nbsp;&nbsp; <b>☐</b> 20</span>
    </div>
    ${planosDaFolha
      .map((p) => {
        const calculo = calcularParcela(p, unidade.precoTabela);
        return linhaDoPlano({
          correcao: fraseDeCorrecao(p),
          nome: rotuloDoPlano(p),
          parcela: calculo.parcela,
          parcelas: calculo.parcelas,
          percentual: textoDoSinal(p),
          sinal: calculo.sinal,
        });
      })
      .join("")}

    <div class="perso">
      <div class="perso-tit"><span class="chk"></span>Plano personalizado <span class="nota">preencher só se a negociação sair da tabela</span></div>
      <div class="perso-corpo">
        <div class="pauta"></div>
      </div>
    </div>

    <p class="regras">${textoDasRegras(planosDaFolha)}</p>

    <div class="sec">Declarações do proponente sobre a proposta</div>
    <ol class="decl">
      <li>Estou ciente que a presente Proposta será encaminhada a Empreendedora, sujeita à análise, que será realizada em até <b>05 (cinco) dias úteis</b>. Estou (Estamos) ciente(s) de que a Empreendedora pode recursar a presente Proposta, independentemente de justificativa.</li>
      <li>Concordo (Concordamos) que, se aprovada a Proposta, o valor do sinal pago, após decotado os honorários da Empresa Imobiliária (“Honorários de Intermediação”), conforme especificado a seguir, será apresentado à Instituição Bancária, para compensação imediata no preço da unidade, equivalendo-se ao pagamento. A quitação constará no contrato de promessa de compra e venda ou compra e venda com alienação fiduciária, conforme aplicável.</li>
      <li>Declaro (Declaramos) estar ciente(s) de que o contrato de promessa de compra e venda ou compra e venda com alienação fiduciária, conforme aplicável, será confeccionado em até <b>07 (sete) dias úteis</b>, se aprovada esta Proposta. Este prazo se inicia somente após a entrega da documentação completa, pelo Proponente, à Empresa Imobiliária, no prazo que lhe for solicitado.</li>
      <li>Declaro (Declaramos) estar ciente(s) de que assinarei (assinaremos) o contrato e seus anexos digitalmente em até <b>7 (sete) dias úteis</b>, após notificação pela Empresa Imobiliária que intermediou a negociação.</li>
      <li>Estou (Estamos) ciente(s) de que o não pagamento do valor do sinal no prazo estabelecido neste documento, a não assinatura do contrato de promessa de compra e venda ou compra e venda com alienação fiduciária ou entrega da documentação, na data indicada, tornará sem validade e eficácia a presente Proposta, desobrigando a Empreendedora de qualquer compromisso decorrente deste documento. Nessa hipótese, o valor pago a título de sinal será devolvido ao Proponente em até <b>10 (dez) dias úteis</b>, contados do término do prazo para o pagamento do sinal ou do escoamento do prazo para assinatura do contrato de promessa de compra e venda ou compra e venda com alienação fiduciária, conforme aplicável, sem direito a qualquer tipo de indenização, reparação ou perdas ou danos. O cancelamento da Proposta será informado por meios digitais. O documento da Proposta será desconsiderado e não terá mais nenhum efeito.</li>
      <li>Declaro (Declaramos) que contratei (Contratamos) os serviços profissionais da(s) Empresa Imobiliária(s) mencionada(s) no quadro resumo acima, para realizar, em meu (nosso) nome, a intermediação, assim como os atos necessários para a formalização desta Proposta, estando ciente que:
        <ol type="a">
          <li>Se a proposta for aprovada e aceita pela Empreendedora, será decotado do sinal pago pelo Proponente, sinal relativo aos Honorários de Intermediação a serem pagos à Empresa Imobiliária, os quais totalizam o percentual de <b>8% (oito por cento)</b> sobre o valor total de aquisição da unidade. O pagamento do saldo remanescente dos Honorários de Intermediação, deverá ser pagos via boleto bancário identificado como “ASAAS”. O pagamento do valor será realizado na mesma data de assinatura do contrato de promessa de compra e venda ou compra e venda com alienação fiduciária, conforme aplicável;</li>
          <li>Em caso de recusa ou não aceitação da proposta, a(s) Empresa Imobiliária(s) devolverá (devolverão) integralmente o sinal referente aos Honorários de Intermediação, sem quaisquer despesas adicionais, indenização, reparação ou perdas ou danos;</li>
          <li>As demais condições sobre a prestação de serviços estão detalhadas no Contrato de Corretagem, que será formalizado com a(s) Empresa Imobiliária(s) na mesma data de assinatura do contrato de promessa de compra e venda ou compra e venda com alienação fiduciária, conforme aplicável;</li>
        </ol>
      </li>
      <li>Declaro estar ciente de que em caso de intenção de troca de Proponentes, é facultado a Empreendedora proceder com nova análise de crédito, no prazo de <b>05 (cinco) dias</b>, que poderá ser recusada independentemente de justificativa. Se recusada, o sinal pago pelo Proponente original será devolvido em até <b>10 (dez) dias úteis</b>, contados da recusa da cessão da Proposta, pela Empreendedora. Se aceita, será cobrado do novo Proponente o percentual de <b>1% (um por cento)</b> sobre o valor total de aquisição da unidade;</li>
      <li>Concordo que em caso de troca de proponentes, plano de pagamento ou unidade distinta da descrita no quadro resumo, não é garantida a reserva ou disponibilidade da unidade.</li>
      <li>O prazo para desistência da presente proposta é de até <b>07 (sete) dias</b>, contados de sua assinatura. O sinal pago pelo Proponente será devolvido em até <b>10 (dez) dias úteis</b>, contados da formalização da desistência.</li>
    </ol>

    <div class="assin">
      ${dados.proponentes
        .map(
          (p, indice) =>
            `<div>${esc(p.nome)}<i>${indice + 1}º proponente</i></div>`,
        )
        .join("")}
      <div>${vendedora}<i>Empreendedora</i></div>
    </div>

    <div class="rodape">
      <img src="${dados.qrDataUrl}" alt="">
      <span><b>${esc(dados.codigoCupom)}</b> · unidade ${esc(unidade.codigo)} · ${esc(dados.dataExtensa)}<br>Reservada em ${esc(unidade.reservadaEm)} · documento gerado pelo Panteon</span>
    </div>
  </div>`;
}

function esperarImagens(doc: Document): Promise<void> {
  const imagens = Array.from(doc.images);
  return Promise.all(
    imagens.map((img) =>
      img.complete
        ? Promise.resolve()
        : new Promise<void>((resolver) => {
            img.addEventListener("load", () => resolver(), { once: true });
            img.addEventListener("error", () => resolver(), { once: true });
          }),
    ),
  ).then(() => undefined);
}

/** Imprime TODAS as folhas do cupom (uma por unidade) num único documento isolado. */
export async function imprimirFolhasDaPa(dados: DadosDaPa): Promise<void> {
  if (dados.unidades.length === 0) return;

  const corpo = dados.unidades.map((u) => folhaHTML(dados, u)).join("");

  const iframe = document.createElement("iframe");
  iframe.setAttribute("aria-hidden", "true");
  Object.assign(iframe.style, {
    border: "0",
    bottom: "0",
    height: "0",
    position: "fixed",
    right: "0",
    width: "0",
  });
  document.body.appendChild(iframe);

  const doc = iframe.contentDocument;
  const win = iframe.contentWindow;
  if (!doc || !win) {
    iframe.remove();
    return;
  }

  doc.open();
  doc.write(
    `<!doctype html><html><head><meta charset="utf-8"><style>${PA_CSS}</style></head><body>${corpo}</body></html>`,
  );
  doc.close();

  await esperarImagens(doc);

  let finalizado = false;
  const limpar = () => {
    if (finalizado) return;
    finalizado = true;
    window.setTimeout(() => iframe.remove(), 500);
  };
  win.addEventListener("afterprint", limpar, { once: true });
  window.setTimeout(limpar, 60_000);

  win.focus();
  win.print();
}
