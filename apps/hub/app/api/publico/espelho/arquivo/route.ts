import { NextResponse } from "next/server";

import { BUCKET_DO_PRODUTO, uuidValido } from "@/lib/apolo/arquivos-do-produto";
import { abrirEspelho, ERRO_GENERICO } from "@/lib/hercules/espelho/abrir-espelho";
import { acharArquivoDoEspelho } from "@/lib/hercules/espelho/arquivos-publicos";
import { SEM_CACHE } from "@/lib/hercules/espelho/pecas-do-espelho";

// A PORTA DOS ARQUIVOS DO ESPELHO PÚBLICO — o vídeo, o book e as 45 cenas do Garden no link que o
// corretor manda pelo WhatsApp (`c2x.app.br/e/garden-ksewinpw`).
//
// O bucket `produto-arquivos` é PRIVADO (`public = false`), então não existe URL pública para
// apontar: o espelho precisa de porta própria, como a arte do mapa tem a dela.
//
// ⚠️ O PARÂMETRO É O ID DO ARQUIVO (`a`), NUNCA UM CAMINHO. Um caminho vindo do navegador
// transformaria esta rota numa leitura livre do bucket, onde mora o material de TODOS os
// empreendimentos. Aqui o id vira caminho dentro do servidor, e só se o arquivo for do
// empreendimento DAQUELE link — é o `.in("enterprise_id", ...)` de `acharArquivoDoEspelho`.
//
// ⚠️ O ORIGINAL SAI POR 302 NUMA URL ASSINADA, E ISSO É DIFERENTE DA ARTE DO MAPA DE PROPÓSITO.
// A arte tem de 0,56 a 2,77 MB e os bytes passam pela função. Aqui o `Book Garden.pdf` tem
// 212.799.580 bytes MEDIDOS no banco (202,9 MB), e o Garden inteiro soma 518.136.930 bytes:
//
//   • o corpo de uma função da Vercel é cortado em 4,5 MB — o book não cabe, nem perto;
//   • `.download()` do Supabase devolve um Blob, isto é, o arquivo INTEIRO na memória da função;
//   • e, principalmente, o `<video>` do iPhone e o leitor de PDF do navegador pedem PEDAÇOS
//     (`Range`/206) para tocar e para pular página. Um proxy nosso responderia sempre o arquivo
//     todo, e o vídeo simplesmente não tocaria no aparelho do cliente.
//
// A URL assinada vale UM objeto por uma hora (a mesma validade do portal, que já entrega estes
// mesmos arquivos assim para a Cecílio Rocha). Não é credencial do bucket: é credencial daquele
// arquivo, e o que ela abre é material de divulgação que o corretor está mostrando ao cliente
// naquele instante. Documento de cliente NÃO mora neste bucket — aquele é o `apolo-documents`,
// cuja regra continua sendo a do espelho: bytes pela função, URL nenhuma.
//
// ⚠️ A MINIATURA (`m=1`) VAI PELO CAMINHO CONTRÁRIO: 28,5 KB em média (medido: 46 miniaturas do
// Garden somam 1.311.659 bytes). Cabem folgado no corpo da função, e passando por aqui elas podem
// ser cacheadas na CDN sem nenhuma credencial na URL da imagem — que é o `src` de 47 quadradinhos
// numa página que circula no WhatsApp.
//
// ⚠️ E `m=1` NUNCA CAI NO ORIGINAL. Arquivo sem miniatura responde 404 e a grade desenha o ícone.
// Um fallback "bonitinho" para o original aqui baixaria os 202,9 MB do book para montar um
// quadradinho de 160 px, no 4G, na frente do cliente.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Uma hora, a mesma validade do link que o portal já entrega para estes mesmos arquivos. */
const VALIDADE_DA_URL = 60 * 60;

/**
 * ⚠️ UMA HORA DE CACHE, E NÃO `immutable`. O caminho tem uuid e nunca muda, o que tentaria um ano
 * de cache — mas a CDN é COMPARTILHADA: a foto que a Cecílio remover no portal continuaria
 * aparecendo para todo mundo até 2027. Uma hora mata o tráfego repetido da mesma visita e deixa a
 * remoção valer no mesmo turno de trabalho.
 */
const CACHE_DA_MINIATURA = "public, max-age=3600";

const naoExiste = () =>
  NextResponse.json(
    { error: "Arquivo não encontrado." },
    { headers: { "Cache-Control": SEM_CACHE }, status: 404 },
  );

export async function GET(request: Request) {
  const busca = new URL(request.url).searchParams;
  const token = busca.get("e");
  const id = busca.get("a");
  const querMiniatura = busca.get("m") === "1";

  const aberto = await abrirEspelho(token);
  if (!aberto.ok) {
    return NextResponse.json(
      { error: ERRO_GENERICO },
      {
        headers: { "Cache-Control": SEM_CACHE },
        status: aberto.erro === "sem_token" ? 401 : 503,
      },
    );
  }

  // Antes de qualquer ida ao banco: o que não é uuid é caminho forjado ou lixo, e a resposta é a
  // mesma de "não existe" — a rota não pode dizer ao visitante O QUE ele errou.
  if (!uuidValido(id)) return naoExiste();

  const { client, filhosC2xIds, paiC2xId } = aberto.espelho;
  const ids = [paiC2xId, ...filhosC2xIds].filter(Boolean) as string[];

  const arquivo = await acharArquivoDoEspelho(client, ids, id);
  if (!arquivo) return naoExiste();

  if (querMiniatura) {
    if (!arquivo.miniaturaPath) return naoExiste();

    const { data, error } = await client.storage
      .from(BUCKET_DO_PRODUTO)
      .download(arquivo.miniaturaPath);

    if (error || !data) {
      console.error("[publico][espelho] miniatura ausente", arquivo.id, error?.message);
      return naoExiste();
    }

    return new NextResponse(await data.arrayBuffer(), {
      headers: {
        "Cache-Control": CACHE_DA_MINIATURA,
        // A miniatura é sempre o JPEG que o navegador gerou no envio (`caminhoDaMiniatura`).
        "Content-Type": "image/jpeg",
      },
    });
  }

  const { data, error } = await client.storage
    .from(BUCKET_DO_PRODUTO)
    .createSignedUrl(arquivo.storagePath, VALIDADE_DA_URL);

  if (error || !data?.signedUrl) {
    console.error("[publico][espelho] falha ao assinar o arquivo", arquivo.id, error?.message);
    return NextResponse.json(
      { error: "Não foi possível abrir este arquivo agora." },
      { headers: { "Cache-Control": SEM_CACHE }, status: 503 },
    );
  }

  // ⚠️ `no-store` NO REDIRECIONAMENTO: a URL assinada expira em uma hora, e um 302 guardado no
  // cache do celular mandaria o cliente para um link morto no meio da apresentação.
  return new NextResponse(null, {
    headers: { "Cache-Control": SEM_CACHE, Location: data.signedUrl },
    status: 302,
  });
}
