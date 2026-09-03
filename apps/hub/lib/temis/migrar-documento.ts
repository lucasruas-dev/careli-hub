import type { NoDeTexto, NoDoDocumento } from "./documento-html";

// MINUTA SALVA PELO EDITOR ANTIGO ABRE NO NOVO SEM PERDER O ALINHAMENTO.
//
// ⚠️ DUAS CHAVES PARA A MESMA COISA. O editor de 01/09/2026 alinhava com
// `editor.tf.setNodes({ [KEYS.textAlign]: valor })` — e `KEYS.textAlign` é a string "textAlign",
// então o JSON gravado tem `{ type: "h1", textAlign: "center" }`. O AlignKit do Plate UI (desde
// 02/09/2026, pedido do Lucas: *"quero isso completo, estamos muito simples"*) lê e grava `align`.
// Sem migrar, o título centralizado de uma minuta antiga abre à esquerda; e se o jurídico
// realinhar, o nó fica com as DUAS chaves — foi o que fez o contrato sair centralizado enquanto a
// tela mostrava justificado.
//
// A migração é pura e roda na abertura (`editor-de-minuta.tsx`): `textAlign` vira `align` quando
// não há `align`, e some em qualquer caso. O serializador (`documento-html.ts`) continua lendo as
// duas chaves, com `align` na frente — é a segunda trava, para o JSON que não passou por aqui.
//
// ⚠️ Regra nova não alcança o passado: o `conteudo` gravado no banco NÃO é reescrito por isto. Ele
// só muda quando o jurídico salvar de novo. Até lá, o serializador cobre.

function ehTexto(no: NoDeTexto | NoDoDocumento): no is NoDeTexto {
  return typeof (no as NoDeTexto).text === "string" && !(no as NoDoDocumento).type;
}

/** `textAlign` (chave do editor antigo) vira `align` (chave do AlignKit), em toda profundidade. */
export function migrarAlinhamentoAntigo(nos: NoDoDocumento[]): NoDoDocumento[] {
  const percorrer = (no: NoDeTexto | NoDoDocumento): NoDeTexto | NoDoDocumento => {
    if (ehTexto(no)) return no;

    const { textAlign, ...resto } = no;
    const filhos = no.children ? no.children.map(percorrer) : undefined;
    const copia: NoDoDocumento = filhos ? { ...resto, children: filhos } : resto;

    // `align` presente manda (é o que o editor atual gravou); `textAlign` só preenche o vazio.
    if (textAlign && !copia.align) return { ...copia, align: textAlign };
    return copia;
  };

  return nos.map((no) => percorrer(no) as NoDoDocumento);
}
