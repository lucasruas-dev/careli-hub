import type { EscalaDoTotem } from "@/lib/prometeu/escala-do-totem";

// OS TRÊS TAMANHOS DA TELA DE RESERVA, em um lugar só.
//
// Antes cada elemento carregava seu próprio `telaCheia ? "..." : "..."` no meio do JSX —
// quarenta e poucos ternários, e nenhum jeito de ver o conjunto. Com um terceiro degrau
// (o tablet deitado) isso viraria ternário triplo em quarenta lugares. Aqui a tabela é a
// tabela: dá para ler a escala inteira de uma vez e conferir se um degrau ficou fora do lugar.
//
// A régua entre os degraus é `lib/prometeu/escala-do-totem.ts` — quem decide QUAL usar. Este
// arquivo só diz o QUE cada um vale.
//
// Números soltos (não classes) são tamanho de ícone do lucide, que é prop, não CSS.

export type VisualDoTotem = {
  alvoDoChip: string;
  avatarDoCliente: string;
  avisoNoSucesso: string;
  botaoDeAcao: string;
  botaoFinalizar: string;
  cartaoDaQuadra: string;
  cartaoDoContador: string;
  cartaoDoLote: string;
  chipDeProponente: string;
  gradeDeLotes: string;
  gradeDeQuadras: string;
  iconeDaOrigem: number;
  iconeDeAcao: number;
  iconeDeSucesso: number;
  iconeDoAvatar: number;
  iconeDoBip: number;
  iconeDoChip: number;
  iconeDoLote: number;
  livresDaQuadra: string;
  lotesMarcados: string;
  lotesNoSucesso: string;
  medalhaDeSucesso: string;
  nomeDoCliente: string;
  nomeNoSucesso: string;
  numeroDaQuadra: string;
  numeroDoContador: string;
  numeroDoLote: string;
  origemDoCliente: string;
  paddingDoRodape: string;
  rotuloDoContador: string;
  seloDeProponentes: string;
  subtituloDoEvento: string;
  textoDeEspera: string;
  tituloDaQuadraAberta: string;
  tituloDoEvento: string;
};

// MONITOR DO POSTO — leitura a um metro ou mais. Em pé, o nome do cliente ganha um degrau: a
// altura sobra e a largura é o que aperta.
const AMPLA: VisualDoTotem = {
  alvoDoChip: "h-11 w-11",
  avatarDoCliente: "h-14 w-14",
  avisoNoSucesso: "text-xl",
  botaoDeAcao: "h-16 w-16",
  botaoFinalizar: "h-16 px-9 text-2xl",
  cartaoDaQuadra: "py-9",
  cartaoDoContador: "min-w-[92px] px-4 py-2",
  cartaoDoLote: "py-8",
  chipDeProponente: "py-1.5 pl-4 pr-2 text-base",
  gradeDeLotes: "grid-cols-[repeat(auto-fill,minmax(120px,1fr))] gap-4",
  gradeDeQuadras: "grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-4",
  iconeDaOrigem: 20,
  iconeDeAcao: 28,
  iconeDeSucesso: 64,
  iconeDoAvatar: 30,
  iconeDoBip: 28,
  iconeDoChip: 18,
  iconeDoLote: 26,
  livresDaQuadra: "text-lg",
  lotesMarcados: "text-base",
  lotesNoSucesso: "text-2xl",
  medalhaDeSucesso: "h-32 w-32",
  // ⚠️ O TAMANHO É DITADO PELO NOME MAIS LONGO, não pelo mais bonito: em retrato (1080 de
  // largura) o text-4xl cortava "FLAVIA CALDEIRA ANDRADE" em "FLAVIA CALDEIRA ANDR…", e nome
  // truncado no tótem é o operador confirmando reserva com meia identificação na tela.
  nomeDoCliente: "text-2xl portrait:text-3xl",
  nomeNoSucesso: "text-4xl",
  numeroDaQuadra: "text-5xl",
  numeroDoContador: "text-3xl",
  numeroDoLote: "text-4xl",
  origemDoCliente: "text-base",
  paddingDoRodape: "py-4",
  rotuloDoContador: "text-xs",
  seloDeProponentes: "text-base",
  subtituloDoEvento: "text-sm",
  textoDeEspera: "text-2xl",
  tituloDaQuadraAberta: "text-xl",
  tituloDoEvento: "text-xl portrait:text-2xl",
};

// TABLET DEITADO NO SUPORTE (Lucas, 28/08/2026: "pode deixar melhor deitado, o suporte que tenho
// fica bom assim"). O operador olha de perto, então o texto não precisa do tamanho de monitor —
// e não pode ter: com uns 800px de altura, cada degrau a mais no header e no rodapé sai da
// prateleira de lotes, que é a única parte que ele de fato opera. O alvo de toque, esse, NÃO
// encolhe junto: dedo continua do mesmo tamanho, e é tela de toque o tempo todo.
const MEDIA: VisualDoTotem = {
  alvoDoChip: "h-10 w-10",
  avatarDoCliente: "h-12 w-12",
  avisoNoSucesso: "text-base",
  botaoDeAcao: "h-14 w-14",
  botaoFinalizar: "h-14 px-7 text-xl",
  cartaoDaQuadra: "py-6",
  cartaoDoContador: "min-w-[88px] px-3 py-1.5",
  cartaoDoLote: "py-6",
  chipDeProponente: "py-1 pl-3 pr-1.5 text-sm",
  gradeDeLotes: "grid-cols-[repeat(auto-fill,minmax(104px,1fr))] gap-3",
  gradeDeQuadras: "grid-cols-[repeat(auto-fill,minmax(120px,1fr))] gap-3",
  iconeDaOrigem: 17,
  iconeDeAcao: 24,
  iconeDeSucesso: 48,
  iconeDoAvatar: 26,
  iconeDoBip: 24,
  iconeDoChip: 16,
  iconeDoLote: 22,
  livresDaQuadra: "text-base",
  lotesMarcados: "text-sm",
  lotesNoSucesso: "text-xl",
  medalhaDeSucesso: "h-24 w-24",
  // Fica no mesmo degrau da escala ampla de propósito: o nome é o que o operador confere contra
  // a etiqueta na mão, e o tablet deitado tem largura de sobra para ele.
  nomeDoCliente: "text-2xl",
  nomeNoSucesso: "text-3xl",
  numeroDaQuadra: "text-4xl",
  numeroDoContador: "text-2xl",
  numeroDoLote: "text-3xl",
  origemDoCliente: "text-sm",
  paddingDoRodape: "py-3",
  rotuloDoContador: "text-[11px]",
  seloDeProponentes: "text-sm",
  subtituloDoEvento: "text-sm",
  textoDeEspera: "text-xl",
  tituloDaQuadraAberta: "text-lg",
  tituloDoEvento: "text-lg",
};

// DENTRO DO HUB, com rail e abas em volta: aqui a tela não está operando um posto, está sendo
// conferida por alguém sentado.
const COMPACTA: VisualDoTotem = {
  alvoDoChip: "h-9 w-9",
  avatarDoCliente: "h-11 w-11",
  avisoNoSucesso: "text-sm",
  botaoDeAcao: "h-12 w-12",
  botaoFinalizar: "h-12 px-6 text-base",
  cartaoDaQuadra: "py-5",
  cartaoDoContador: "min-w-[86px] px-4 py-2",
  cartaoDoLote: "py-5",
  chipDeProponente: "py-1 pl-3 pr-1.5 text-xs",
  gradeDeLotes: "grid-cols-[repeat(auto-fill,minmax(96px,1fr))] gap-3",
  gradeDeQuadras: "grid-cols-[repeat(auto-fill,minmax(110px,1fr))] gap-3",
  iconeDaOrigem: 15,
  iconeDeAcao: 20,
  iconeDeSucesso: 40,
  iconeDoAvatar: 22,
  iconeDoBip: 20,
  iconeDoChip: 14,
  iconeDoLote: 18,
  livresDaQuadra: "text-sm",
  lotesMarcados: "text-xs",
  lotesNoSucesso: "text-lg",
  medalhaDeSucesso: "h-20 w-20",
  nomeDoCliente: "text-lg",
  nomeNoSucesso: "text-2xl",
  numeroDaQuadra: "text-3xl",
  numeroDoContador: "text-2xl",
  numeroDoLote: "text-2xl",
  origemDoCliente: "text-sm",
  paddingDoRodape: "py-3",
  rotuloDoContador: "text-[11px]",
  seloDeProponentes: "text-xs",
  subtituloDoEvento: "text-xs",
  textoDeEspera: "text-base",
  tituloDaQuadraAberta: "text-sm",
  tituloDoEvento: "text-lg",
};

const POR_ESCALA: Record<EscalaDoTotem, VisualDoTotem> = {
  ampla: AMPLA,
  compacta: COMPACTA,
  media: MEDIA,
};

export function visualDoTotem(escala: EscalaDoTotem): VisualDoTotem {
  return POR_ESCALA[escala];
}
