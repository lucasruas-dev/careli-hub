import { SlateElement, type SlateElementProps } from "platejs/static";

import type { TQuebraDePaginaElement } from "./quebra-de-pagina-base";

// A QUEBRA DE PÁGINA NA VERSÃO ESTÁTICA (sem editor) — é o que a exportação da barra renderiza.
//
// ⚠️ AQUI ELA JÁ É O CSS DE VERDADE, e não o tracejado da tela: quem exporta quer a página cortada.
// O `page-break-before` antigo acompanha o `break-before` novo porque nem todo motor de impressão
// entende a propriedade moderna, e uma quebra ignorada em silêncio só aparece no papel.
//
// ⚠️ O CONTRATO ASSINADO NÃO PASSA POR AQUI. Ele sai de `lib/temis/documento-html.ts`, que escreve o
// mesmo CSS por conta própria. Este arquivo serve à visualização e ao export da barra.
export function QuebraDePaginaElementStatic(props: SlateElementProps<TQuebraDePaginaElement>) {
  return (
    <SlateElement
      {...props}
      as="div"
      attributes={{
        ...props.attributes,
        style: { breakBefore: "page", pageBreakBefore: "always" },
      }}
    >
      {props.children}
    </SlateElement>
  );
}
