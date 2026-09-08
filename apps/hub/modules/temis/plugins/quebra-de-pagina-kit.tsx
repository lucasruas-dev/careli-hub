"use client";

import { PlateElement, type PlateElementProps, toPlatePlugin, useFocused, useSelected } from "platejs/react";

import { cn } from "@/lib/utils";

import { BaseQuebraDePaginaPlugin, type TQuebraDePaginaElement } from "./quebra-de-pagina-base";

// A QUEBRA DE PÁGINA NA FOLHA — a parte React.
//
// ⚠️ ELA PRECISA SER VISÍVEL. Esse é o ponto todo: o Lucas perguntou onde a página quebra porque não
// havia como saber. Uma linha tracejada com o rótulo "Quebra de página" responde a pergunta sem
// abrir a pré-visualização — quem escreve vê o corte enquanto escreve.
//
// ⚠️ E ELA NÃO SAI ASSIM NO CONTRATO. No PDF não há tracejado nem rótulo: o serializador
// (`documento-html.ts`) emite só o CSS de quebra. O que se vê aqui é andaime de edição.

export function QuebraDePaginaElement(props: PlateElementProps<TQuebraDePaginaElement>) {
  const selecionada = useSelected();
  const focado = useFocused();

  return (
    <PlateElement {...props} attributes={{ ...props.attributes, contentEditable: false }} className="my-4">
      <div
        className={cn(
          "flex select-none items-center gap-3 text-[11px] font-medium uppercase tracking-wider text-neutral-400",
          selecionada && focado && "text-[#A07C3B]",
        )}
        title="A próxima linha começa em uma folha nova do contrato"
      >
        <span
          className={cn(
            "h-px flex-1 border-t border-dashed border-neutral-300",
            selecionada && focado && "border-[#A07C3B]",
          )}
        />
        Quebra de página
        <span
          className={cn(
            "h-px flex-1 border-t border-dashed border-neutral-300",
            selecionada && focado && "border-[#A07C3B]",
          )}
        />
      </div>
      {/* O Slate exige o filho de texto no DOM mesmo em void de bloco — sem ele a seleção tropeça. */}
      {props.children}
    </PlateElement>
  );
}

export const QuebraDePaginaPlugin = toPlatePlugin(BaseQuebraDePaginaPlugin).withComponent(QuebraDePaginaElement);

export const QuebraDePaginaKit = [QuebraDePaginaPlugin];
