"use client";

import { IS_APPLE, KEYS, type TText } from "platejs";
import {
  PlateElement,
  type PlateElementProps,
  toPlatePlugin,
  useFocused,
  useReadOnly,
  useSelected,
} from "platejs/react";
import { useEffect, useState } from "react";

import { acharVariavel } from "@/lib/temis/variaveis";
import { cn } from "@/lib/utils";

import { BaseVariavelPlugin, origemPendente, type TVariavelElement } from "./variavel-kit-base";

// O CHIP DA VARIÁVEL NA FOLHA — a parte React do plugin. Molde: `mention-node` do registro do Plate.
//
// Três cores, três respostas de relance para o jurídico:
// - dourado (marca da casa): o Panteon sabe preencher;
// - dourado com sublinhado tracejado âmbar: está no catálogo, mas a coluna ainda não existe no
//   Panteon (origem "pendente"); sai vazio no contrato até existir;
// - vermelho: o sistema NÃO conhece o nome — é o `[Nome]` das minutas antigas, que sai impresso
//   literalmente no papel.

/** `true` depois da primeira renderização no navegador (a ordem dos filhos depende do SO). */
function useMontado() {
  const [montado, setMontado] = useState(false);
  useEffect(() => setMontado(true), []);
  return montado;
}

export function VariavelElement(props: PlateElementProps<TVariavelElement>) {
  const { element } = props;
  const selecionada = useSelected();
  const focado = useFocused();
  const somenteLeitura = useReadOnly();
  const montado = useMontado();

  const variavel = acharVariavel(element.nome);
  const pendente = origemPendente(variavel);
  const filho = element.children[0] as TText | undefined;

  const titulo = variavel
    ? `${variavel.rotulo} · ${variavel.origem}${pendente ? " · PENDENTE: o Panteon ainda não tem este dado" : ""}`
    : `Variável desconhecida: o sistema não sabe preencher [${element.nome}] e ela sairia impressa assim no contrato`;

  return (
    <PlateElement
      {...props}
      attributes={{
        ...props.attributes,
        contentEditable: false,
        "data-slate-value": element.nome,
        draggable: true,
        title: titulo,
      }}
      className={cn(
        "inline-block rounded px-1 align-baseline font-mono text-[0.9em] leading-snug",
        variavel ? "bg-[#A07C3B]/10 text-[#6B5227]" : "bg-red-100 text-red-800",
        pendente && "border-b border-dashed border-amber-500",
        !somenteLeitura && "cursor-pointer",
        selecionada && focado && "ring-2 ring-[#A07C3B]/60",
        filho?.[KEYS.bold] === true && "font-bold",
        filho?.[KEYS.italic] === true && "italic",
        filho?.[KEYS.underline] === true && "underline",
      )}
    >
      {/* ⚠️ `children` SEMPRE renderizado: o Slate exige o filho de texto (vazio) no DOM, senão a
          seleção por teclado tropeça no void. No Mac ele vem antes do texto por causa do IME
          (slate#3490); nos outros, depois (slate#5360). */}
      {montado && IS_APPLE ? (
        <>
          {props.children}[{element.nome}]
        </>
      ) : (
        <>
          [{element.nome}]{props.children}
        </>
      )}
    </PlateElement>
  );
}

export const VariavelPlugin = toPlatePlugin(BaseVariavelPlugin).withComponent(VariavelElement);

export const VariavelKit = [VariavelPlugin];
