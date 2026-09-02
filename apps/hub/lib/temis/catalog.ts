import { LayoutGrid, type LucideIcon, Settings } from "lucide-react";

// AS TELAS DA TÊMIS.
//
// A ordem é a que o Lucas definiu (01/09/2026): *"Board, Inteligência de Dados, Setup"* e *"A
// ordem, é Board primeiro"*.
//
// ⚠️ "INTELIGÊNCIA DE DADOS" AINDA NÃO EXISTE, e ficar de fora é deliberado: ele mesmo estranhou o
// nome (*"Inteligência de dados (não tem um nome melhor não)?"*) e a tela não tem escopo definido.
// Um item de menu que abre vazio ensina o time a ignorar o menu.
//
// ⚠️ PLANOS SAIU DAQUI. Regra do Lucas (02/09/2026): *"plano não vive aqui no contrato, ele vive
// dentro do cadastro do empreendimento"*. A tela continua existindo — é a mesma `PlanosComerciaisTab`
// da ficha do empreendimento, no Apolo, e nada foi apagado. O que muda é onde ela é oferecida:
// plano de pagamento é decisão comercial do empreendimento, e ter uma segunda porta para ele na
// Têmis ensinaria o time a procurar cadastro dentro do módulo de contrato.
//
// ⚠️ MINUTAS E PLANOS SAÍRAM DO MENU, e por motivos diferentes. O PLANO vive no cadastro do
// empreendimento (*"plano não vive aqui no contrato"*) e continua lá, no Apolo. A MINUTA passou a
// viver DENTRO do Setup: *"acho que minutas tem que está dentro de setup"*. Faz sentido — escolher
// o empreendimento e ver o que ele tem cadastrado é um gesto só, e eram duas telas pedindo a mesma
// escolha para mostrar metade da resposta cada uma.
//
// Sobra o essencial: o BOARD, que é o trabalho de hoje, e o SETUP, que é o que cada empreendimento
// precisa ter para o trabalho poder acontecer.

export type TemisScreen = "board" | "setup";

export const temisScreens: {
  description: string;
  hidden: boolean;
  icon: LucideIcon;
  id: TemisScreen;
  label: string;
}[] = [
  {
    description: "O trabalho de hoje: contratos, cessões, distratos e cancelamentos.",
    hidden: false,
    icon: LayoutGrid,
    id: "board",
    label: "Board",
  },
  {
    description: "Os documentos e a taxa de cada empreendimento.",
    hidden: false,
    icon: Settings,
    id: "setup",
    label: "Setup",
  },
];
