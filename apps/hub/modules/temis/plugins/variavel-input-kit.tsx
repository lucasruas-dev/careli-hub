"use client";

import { type TriggerComboboxPluginOptions, withTriggerCombobox } from "@platejs/combobox";
import { Check } from "lucide-react";
import {
  ElementApi,
  KEYS,
  type PluginConfig,
  type SlateEditor,
  type TComboboxInputElement,
} from "platejs";
import {
  createTPlatePlugin,
  type OverrideEditor,
  PlateElement,
  type PlateElementProps,
  useEditorSelector,
} from "platejs/react";
import { useState } from "react";

import {
  InlineCombobox,
  InlineComboboxContent,
  InlineComboboxEmpty,
  InlineComboboxGroup,
  InlineComboboxGroupLabel,
  InlineComboboxInput,
  InlineComboboxItem,
} from "@/components/ui/inline-combobox";

import {
  noDeVariavel,
  origemPendente,
  VARIAVEIS_POR_GRUPO,
  variaveisNoValor,
} from "./variavel-kit-base";

// DIGITOU `[`, ABRIU O CATÁLOGO. Molde: `mention-kit` + `InlineCombobox` do registro do Plate.
//
// O painel lateral continua existindo (é onde se vê o catálogo inteiro por grupo); este é o
// caminho de quem está com as mãos no teclado, marcando uma minuta de 27 páginas: `[`, três letras
// do nome, Enter. Só oferece o que o Panteon sabe preencher — o `[nome_clientes]` digitado à mão,
// que já imprimiu contrato errado, não tem como acontecer por aqui.
//
// ⚠️ O GATILHO ROUBA O `[` DO AUTOFORMAT: o `[] ` que viraria lista de tarefas no kit do Plate
// nunca chega lá, porque este plugin vem depois dele e intercepta o `[` primeiro. Em minuta isso é
// o comportamento desejado (lista de tarefas continua pelo menu e pelo `/`). Escape devolve o `[`
// como texto comum.

export const VARIAVEL_INPUT_KEY = "variavel_input" as const;

type VariavelInputConfig = PluginConfig<typeof VARIAVEL_INPUT_KEY, TriggerComboboxPluginOptions>;

/**
 * Insere a variável no ponto do cursor e deixa o cursor logo depois dela.
 *
 * O mesmo gesto do `getMentionOnSelectItem` do Plate: `insertNodes` seleciona o void recém-criado e
 * o `move` de um offset sai dele. Sem o `move`, a próxima tecla apagaria a variável.
 */
export function inserirVariavel(editor: SlateEditor, nome: string) {
  editor.tf.insertNodes(noDeVariavel(nome));
  editor.tf.move({ unit: "offset" });
}

export function VariavelInputElement(props: PlateElementProps<TComboboxInputElement>) {
  const { editor, element } = props;
  const [busca, setBusca] = useState("");

  // Quais já estão no texto: o combobox marca, como o painel, para responder "já pus o CPF?" sem
  // sair do teclado.
  const jaUsadas = useEditorSelector((ed) => new Set(variaveisNoValor(ed.children)), []);

  return (
    <PlateElement {...props} as="span">
      <InlineCombobox
        element={element}
        setValue={setBusca}
        showTrigger
        trigger="["
        value={busca}
      >
        <span className="inline-block rounded bg-[#A07C3B]/10 px-1 align-baseline font-mono text-[0.9em] ring-[#A07C3B]/50 focus-within:ring-2">
          <InlineComboboxInput />
        </span>

        <InlineComboboxContent className="my-1.5 w-[380px]">
          <InlineComboboxEmpty>
            Nenhuma variável com esse nome. Esc mantém o texto como está.
          </InlineComboboxEmpty>

          {VARIAVEIS_POR_GRUPO.map((g) => (
            <InlineComboboxGroup key={g.grupo}>
              <InlineComboboxGroupLabel>{g.rotulo}</InlineComboboxGroupLabel>

              {g.variaveis.map((v) => {
                const pendente = origemPendente(v);
                return (
                  <InlineComboboxItem
                    className="h-auto py-1"
                    group={g.rotulo}
                    key={v.nome}
                    // O nome com espaços entra nas palavras-chave para "nome cliente" achar
                    // `nome_cliente` — o filtro do Plate compara palavra a palavra.
                    keywords={[v.rotulo, v.nome.replace(/_/g, " ")]}
                    label={v.rotulo}
                    onClick={() => inserirVariavel(editor, v.nome)}
                    value={v.nome}
                  >
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="flex items-center gap-1.5 truncate text-sm">
                        {jaUsadas.has(v.nome) ? (
                          <Check aria-hidden="true" className="size-3 shrink-0 text-emerald-600" />
                        ) : null}
                        {v.rotulo}
                        {pendente ? (
                          <span className="rounded bg-amber-100 px-1 text-[10px] font-semibold uppercase text-amber-800">
                            pendente
                          </span>
                        ) : null}
                      </span>
                      <span className="truncate font-mono text-[11px] text-muted-foreground">
                        [{v.nome}]
                      </span>
                    </span>
                  </InlineComboboxItem>
                );
              })}
            </InlineComboboxGroup>
          ))}
        </InlineComboboxContent>
      </InlineCombobox>

      {props.children}
    </PlateElement>
  );
}

export const VariavelInputPlugin = createTPlatePlugin<VariavelInputConfig>({
  key: VARIAVEL_INPUT_KEY,
  node: { isElement: true, isInline: true, isVoid: true },
  options: {
    trigger: "[",
    // Qualquer caractere antes (ou nenhum): na minuta o `[` vem depois de espaço, de `(`, de aspas
    // ou de `nº` colado — o padrão do Plate (só início de linha ou espaço) perderia metade dos casos.
    triggerPreviousCharPattern: /^.?$/s,
    // Dentro de bloco de código o `[` é código.
    triggerQuery: (editor) =>
      !editor.api.some({
        match: (n) => ElementApi.isElement(n) && n.type === KEYS.codeLine,
      }),
  },
})
  // O `withTriggerCombobox` é tipado para `PluginConfig<any, TriggerComboboxPluginOptions>`; com o
  // strict da casa o `any` da chave não casa com a literal `variavel_input`. É o mesmo override que
  // o `BaseMentionPlugin` usa — o cast só alinha a chave.
  .overrideEditor(withTriggerCombobox as unknown as OverrideEditor<VariavelInputConfig>)
  .withComponent(VariavelInputElement);

export const VariavelInputKit = [VariavelInputPlugin];
