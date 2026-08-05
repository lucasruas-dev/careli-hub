import { redirect } from "next/navigation";

// DISPARO EM MASSA — DESATIVADO (Lucas, 23/jul): não há mais disparo em massa; o PIX passou a ser
// gerado ficha a ficha, pelo botão da etapa de pré-venda no Board. A tela fica escondida por um
// redirect em vez de ser apagada: o componente (modules/apolo/blocks/asaas/disparo-massa.tsx) e a
// rota (api/apolo/asaas/disparo-lote) seguem no código, prontos se um dia precisar de novo.
export const dynamic = "force-dynamic";

export default function DisparoPixPage() {
  redirect("/apolo");
}
