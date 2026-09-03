import { SlateElement, type SlateElementProps } from "platejs/static";

import type { TVariavelElement } from "./variavel-kit-base";

// A VARIÁVEL NA VERSÃO ESTÁTICA (sem editor): é o que a exportação em PDF/HTML/DOCX da barra
// renderiza. Sem este componente o chip sumiria do arquivo exportado — o void não tem texto e o
// Plate estático renderizaria uma caixa vazia.
//
// ⚠️ O CONTRATO ASSINADO NÃO PASSA POR AQUI. Ele sai de `lib/temis/documento-html.ts`, que escreve
// `[nome]` puro para o motor de geração preencher. Este arquivo serve à visualização e ao export.
export function VariavelElementStatic(props: SlateElementProps<TVariavelElement>) {
  return (
    <SlateElement
      {...props}
      as="span"
      attributes={{ ...props.attributes, "data-slate-value": props.element.nome }}
      className="inline-block rounded bg-[#A07C3B]/10 px-1 align-baseline font-mono text-[0.9em]"
    >
      {props.children}[{props.element.nome}]
    </SlateElement>
  );
}
