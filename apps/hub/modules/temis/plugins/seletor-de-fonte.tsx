"use client";

import { FontFamilyPlugin } from "@platejs/basic-styles/react";
import { CaseSensitive, Eraser, WandSparkles } from "lucide-react";
import { KEYS } from "platejs";
import { useEditorPlugin, useEditorSelector } from "platejs/react";
import { useState } from "react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ToolbarButton, ToolbarMenuGroup } from "@/components/ui/toolbar";
import {
  FONTES_DO_CONTRATO,
  limparFonteDoDocumento,
  nomeDaPilha,
} from "@/lib/temis/fontes-do-contrato";

// O SELETOR DE FONTE DA BARRA — a família do trecho, e o caminho de volta ao padrão do contrato.
//
// ⚠️ O PLATE NÃO TRAZ ESTE BOTÃO PRONTO. Conferido em 08/09/2026 no registro do Plate UI
// (`platejs.org/r/registry.json`): os únicos itens com "font" são `font-color-toolbar-button`,
// `font-size-toolbar-button`, `font-base-kit` e `font-kit` — família não tem componente. O plugin
// existe e está ligado (`FontFamilyPlugin` em `components/editor/plugins/font-kit.tsx`); o que
// faltava era a tela.
//
// ⚠️ E O PLUGIN SÓ SABE PÔR, NÃO TIRAR. `tf.fontFamily.addMark(valor)` é a transformação inteira do
// `BaseFontFamilyPlugin` (lida no `dist` do `@platejs/basic-styles`: um `editor.tf.addMarks`). Para
// devolver o trecho ao piso do documento é preciso a API do editor — `removeMarks` na seleção,
// `unsetNodes` no documento inteiro. Por isso os dois primeiros itens não passam pelo plugin.
//
// ⚠️ ELE MORA NA BARRA DA TÊMIS, e não colado ao seletor de tamanho, porque o vizinho de tamanho
// (`components/ui/fixed-toolbar-buttons.tsx`) é gerado pelo CLI do Plate e pode ser regerado — a
// única edição nossa lá (a remoção do botão de IA genérico) já carrega esse aviso. Aqui o botão é
// nosso e sobrevive a uma regeração.

type Props = {
  /**
   * A faixa de aviso da tela. Chega por prop, e não pelas opções da barra, para este arquivo não
   * importar o `temis-toolbar-kit.tsx` que o importa — o ciclo compila, mas o módulo que carrega
   * primeiro enxerga o outro pela metade, e o defeito aparece só em produção.
   */
  aoAvisar?: (aviso: string) => void;
};

export function SeletorDeFonte({ aoAvisar }: Props) {
  const [aberto, setAberto] = useState(false);
  const { editor, tf } = useEditorPlugin(FontFamilyPlugin);

  // A fonte que valeria para o que se digitasse agora: a marca do trecho sob o cursor. É o mesmo
  // caminho do seletor de tamanho do Plate (`editor.api.marks()?.[KEYS.fontSize]`).
  const pilhaAtual = useEditorSelector(
    (ed) => (ed.api.marks()?.[KEYS.fontFamily] as string | undefined) ?? "",
    [],
  );

  const rotulo = nomeDaPilha(pilhaAtual) ?? "Georgia (padrão)";

  /** Devolve o trecho selecionado ao piso do documento, tirando a marca dele. */
  const limparSelecao = () => {
    editor.tf.focus();
    editor.tf.removeMarks(KEYS.fontFamily);
  };

  /**
   * Devolve o DOCUMENTO INTEIRO ao piso.
   *
   * ⚠️ A CONFIRMAÇÃO NÃO É ENFEITE: é a única ação do seletor que alcança texto que ninguém
   * selecionou. Mesmo formato do "importar .docx" ao lado, que também mexe na folha toda.
   */
  const limparTudo = () => {
    if (
      !window.confirm(
        "Isto remove a fonte gravada em TODO o documento — não só no trecho selecionado — e devolve o texto à fonte padrão do contrato (Georgia). Continuar?",
      )
    ) {
      return;
    }

    const quantos = limparFonteDoDocumento(editor);
    editor.tf.focus();
    aoAvisar?.(
      quantos === 0
        ? "Nenhum trecho tinha fonte gravada: o documento já estava todo na fonte padrão do contrato."
        : `${quantos} trecho(s) voltaram à fonte padrão do contrato (Georgia).`,
    );
  };

  return (
    <DropdownMenu modal={false} onOpenChange={setAberto} open={aberto}>
      <DropdownMenuTrigger asChild>
        <ToolbarButton className="min-w-[150px]" isDropdown pressed={aberto} tooltip="Fonte do texto">
          <CaseSensitive />
          <span className="truncate">{rotulo}</span>
        </ToolbarButton>
      </DropdownMenuTrigger>

      <DropdownMenuContent
        align="start"
        className="ignore-click-outside/toolbar min-w-0"
        onCloseAutoFocus={(e) => {
          e.preventDefault();
          editor.tf.focus();
        }}
      >
        {/* O caminho de volta ao piso, separado das famílias: aqui não se escolhe fonte, se
            desfaz a escolha. */}
        <DropdownMenuItem className="min-w-[230px] gap-2" onSelect={limparSelecao}>
          <Eraser />
          Fonte padrão do contrato
        </DropdownMenuItem>

        <DropdownMenuItem className="min-w-[230px] gap-2" onSelect={limparTudo}>
          <WandSparkles />
          Fonte padrão em todo o documento
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        <ToolbarMenuGroup
          label="Fonte"
          onValueChange={(pilha) => {
            editor.tf.focus();
            tf.fontFamily.addMark(pilha);
          }}
          value={pilhaAtual}
        >
          {/* ⚠️ CADA ITEM NA PRÓPRIA FONTE. Ler "Garamond" escrito em Garamond é o que faz a escolha
              ser uma escolha; escrito na fonte da interface, os nove itens são nove palavras iguais
              e quem escolhe está adivinhando.

              O `pl-8` do item fica como veio: é o recuo que abre lugar para a bolinha do indicador,
              e é ela que diz qual fonte está valendo no trecho. */}
          {FONTES_DO_CONTRATO.map((fonte) => (
            <DropdownMenuRadioItem className="min-w-[230px]" key={fonte.nome} value={fonte.pilha}>
              <span style={{ fontFamily: fonte.pilha }}>{fonte.nome}</span>
            </DropdownMenuRadioItem>
          ))}
        </ToolbarMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
