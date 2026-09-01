import { FileSignature, LayoutGrid, type LucideIcon, Percent, Settings } from "lucide-react";

// AS TELAS DA TÊMIS.
//
// A ordem é a que o Lucas definiu (01/09/2026): *"Board, Inteligência de Dados, Setup"* e *"A
// ordem, é Board primeiro"*.
//
// ⚠️ "INTELIGÊNCIA DE DADOS" AINDA NÃO EXISTE, e ficar de fora é deliberado: ele mesmo estranhou o
// nome (*"Inteligência de dados (não tem um nome melhor não)?"*) e a tela não tem escopo definido.
// Um item de menu que abre vazio ensina o time a ignorar o menu.
//
// O que existe hoje são as duas telas que sustentam a operação: as MINUTAS (o texto que o comprador
// assina) e os PLANOS (que decidem qual minuta cada venda usa).

export type TemisScreen = "board" | "minutas" | "planos" | "setup";

export const temisScreens: {
  description: string;
  hidden: boolean;
  icon: LucideIcon;
  id: TemisScreen;
  label: string;
}[] = [
  {
    description: "O que cada empreendimento consegue contratar hoje, e o que trava.",
    hidden: false,
    icon: LayoutGrid,
    id: "board",
    label: "Board",
  },
  {
    description: "O texto do contrato: importar, marcar as variáveis, publicar.",
    hidden: false,
    icon: FileSignature,
    id: "minutas",
    label: "Minutas",
  },
  {
    description: "Planos de pagamento e a minuta que cada um manda usar.",
    hidden: false,
    icon: Percent,
    id: "planos",
    label: "Planos",
  },
  {
    description: "Configuração do módulo.",
    hidden: false,
    icon: Settings,
    id: "setup",
    label: "Setup",
  },
];
