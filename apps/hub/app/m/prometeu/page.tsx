import { EntradaGestorMobile } from "@/modules/prometeu/blocks/gestao/entrada-gestor-mobile";

// Entrada do Prometeu no celular. Quem chega aqui tem login do HUB e é considerado GESTOR, então
// abre na escolha Operação | Gestão (EntradaGestorMobile). OPERAÇÃO cai no seletor de posto
// (recepção/salão/secretaria, o fluxo de sempre); GESTÃO abre os indicadores + bip + reservas.
// Operador freela (sem login do hub) entra pelo /evento, não por aqui.
export const dynamic = "force-dynamic";

export default function MobilePrometeuPage() {
  return <EntradaGestorMobile />;
}
