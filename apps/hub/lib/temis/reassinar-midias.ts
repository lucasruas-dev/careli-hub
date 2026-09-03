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

export const ROTA_DE_MIDIA = "/api/temis/minutas/upload";

export async function reassinarMidiasDoDocumento(
  nos: NoDoDocumento[],
  // ⚠️ ACEITA `null` PORQUE `getApoloAccessToken()` DEVOLVE `null` (sessão do hub ainda não
  // resolvida, ou expirada). Sem token a rota responderia 401 em toda mídia; devolver o documento
  // como está abre a minuta com o texto intacto e as imagens antigas — que é o comportamento de
  // qualquer falha de re-assinatura aqui.
  token: null | string,
): Promise<NoDoDocumento[]> {
  if (!token) return nos;

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
        const r = await fetch(`${ROTA_DE_MIDIA}?path=${encodeURIComponent(path)}&json=1`, {
          cache: "no-store",
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!r.ok) return;
        const corpo = (await r.json().catch(() => null)) as { url?: unknown } | null;
        if (typeof corpo?.url === "string" && corpo.url) novas.set(urlAntiga, corpo.url);
      } catch {
        // Rede falhou: fica a URL antiga (ver o cabeçalho).
      }
    }),
  );

  return trocarUrlsDeMidia(nos, (url) => novas.get(url) ?? null);
}
