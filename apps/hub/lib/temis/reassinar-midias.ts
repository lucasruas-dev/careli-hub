import { APOLO_DOCS_BUCKET } from "@/lib/apolo/documentos";

import { midiasDoDocumento, type NoDoDocumento, trocarUrlsDeMidia } from "./documento-html";
import { caminhoDaUrlAssinada } from "./upload-midia";

// RE-ASSINAR AS MÍDIAS DA MINUTA AO ABRIR — do lado do cliente.
//
// ⚠️ A URL GRAVADA NO NÓ EXPIRA. A mídia do editor (imagem, PDF anexo, .docx) fica no bucket
// PRIVADO `apolo-documents`, e o nó guarda uma signed URL de leitura com 7 dias de prazo — não os
// 10 anos da primeira versão, que tornavam público (para quem tivesse o link, sem sessão do hub)
// qualquer anexo com dado de comprador, por uma década, em toda cópia do HTML do contrato.
//
// Por isso a minuta abre por aqui: cada URL vira o `path` do objeto (`caminhoDaUrlAssinada`) e a
// rota autenticada `GET /api/temis/minutas/upload?path=&json=1` devolve uma URL nova. Só quem está
// logado e tem leitura no Apolo consegue; a URL viva só existe enquanto alguém autenticado a pediu.
//
// Falhou re-assinar uma? Fica a antiga: se ainda valer, a imagem aparece; se não, some da tela — o
// texto da minuta nunca depende disso. Nunca se bloqueia a abertura por causa de mídia.
//
// ⚠️ A CHAMADA SAI PELA PORTA DA TELA, E NÃO POR UM TOKEN (16/09/2026). Antes esta função recebia o
// Bearer do hub e montava `/api/temis/...` sozinha; as minutas do portal que confecciona (Cecílio)
// abrem a MESMA minuta pelo cookie, em `/api/incorporador/temis/...`. Quem chama passa o
// `temisFetch` de `useApiDaTemis()`, que já sabe base e credencial — e esta lib continua sem
// importar nada de tela (o tipo é estrutural).

/** O subcaminho da rota de mídia DENTRO da porta da Têmis. */
export const SUBCAMINHO_DE_MIDIA = "/minutas/upload";

/** A rota de mídia no hub. Mantida pelo nome: é a que a nota acima e o servidor citam. */
export const ROTA_DE_MIDIA = `/api/temis${SUBCAMINHO_DE_MIDIA}`;

/** A mesma forma do `TemisFetch` de `modules/temis/api-da-temis.tsx`. */
export type BuscaNaTemis = (subcaminho: string, init?: RequestInit) => Promise<Response>;

export async function reassinarMidiasDoDocumento(
  nos: NoDoDocumento[],
  temisFetch: BuscaNaTemis,
): Promise<NoDoDocumento[]> {
  // URL antiga → path. A mesma mídia repetida no documento é pedida uma vez só.
  const caminhos = new Map<string, string>();
  for (const midia of midiasDoDocumento(nos)) {
    const path = caminhoDaUrlAssinada(midia.url, APOLO_DOCS_BUCKET);
    if (path) caminhos.set(midia.url, path);
  }
  if (caminhos.size === 0) return nos;

  const novas = new Map<string, string>();
  await Promise.all(
    [...caminhos].map(async ([urlAntiga, path]) => {
      try {
        // ⚠️ SEM SESSÃO, `temisFetch` DO HUB LANÇA antes de chamar, e o `catch` abaixo deixa a URL
        // antiga — o mesmo desfecho do `token` nulo de antes: a minuta abre com o texto intacto.
        const r = await temisFetch(
          `${SUBCAMINHO_DE_MIDIA}?path=${encodeURIComponent(path)}&json=1`,
          { cache: "no-store" },
        );
        if (!r.ok) return;
        const corpo = (await r.json().catch(() => null)) as { url?: unknown } | null;
        if (typeof corpo?.url === "string" && corpo.url) novas.set(urlAntiga, corpo.url);
      } catch {
        // Rede (ou sessão) falhou: fica a URL antiga (ver o cabeçalho).
      }
    }),
  );

  return trocarUrlsDeMidia(nos, (url) => novas.get(url) ?? null);
}
