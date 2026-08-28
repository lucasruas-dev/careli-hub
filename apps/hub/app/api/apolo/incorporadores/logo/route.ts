import { NextResponse } from "next/server";

import { authorizeApoloWrite } from "@/lib/apolo/auth";
import { prefixoDeLogoPermitido } from "@/lib/apolo/incorporador/gestao";
import {
  ehVarianteDaLogo,
  LOGO_MAX_BASE64,
  MENSAGEM_LOGO_GRANDE,
  resolverLogoDoPortal,
  subirLogoDoIncorporador,
} from "@/lib/apolo/incorporador/logo";
import { createApoloAdminClient } from "@/lib/apolo/server";

// UPLOAD DA LOGO DO PORTAL (ferramenta INTERNA do Setup do Apolo).
//   POST = sobe/substitui uma variante e devolve a REFERÊNCIA para o formulário guardar.
//
// ⚠️ O arquivo só vira logo de verdade quando o formulário SALVA o incorporador com a referência
// devolvida aqui — quem manda é a coluna `logo_path`. Subir e não salvar deixa um objeto órfão no
// bucket que ninguém serve (a rota pública lê a referência do banco, não o storage).
//
// `authorizeApoloWrite` porque isto publica arte na porta de um cliente: não é dado de consulta.
//
// ── ⚠️ O SLUG DO CORPO NÃO ESCOLHE ONDE GRAVAR ───────────────────────────────────────────────
// Quem escolhe é `prefixoDeLogoPermitido`, a partir do `id` do registro que está sendo editado.
// O motivo está inteiro no comentário daquela função: com o slug do campo mandando, digitar o
// endereço de um portal alheio na criação de um cadastro novo SOBRESCREVIA a arte que está no ar
// naquele portal, e a mensagem de erro que vinha depois ("endereço já existe") não tinha como ser
// ligada ao estrago. Aqui o `slug` do corpo só serve para o caso NOVO, e mesmo assim depois de
// conferido contra a tabela.
//
// ── ⚠️ NÃO EXISTE MAIS DELETE AQUI ───────────────────────────────────────────────────────────
// A lixeira da tela agora só zera o campo do formulário; o objeto no bucket sai na gravação, no
// servidor, depois que a coluna já deixou de apontar para ele (`/api/apolo/incorporadores`).
// Endpoint autenticado com poder de apagar objeto do bucket e sem nenhum consumidor é só
// superfície de ataque — e, quando existia, apagava pelo slug DIGITADO, com o mesmo furo do POST.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  const auth = await authorizeApoloWrite(request);
  if (!auth.ok) return auth.response;

  const client = createApoloAdminClient();
  if (!client) return NextResponse.json({ error: "Sem acesso à base do Apolo." }, { status: 503 });

  const corpo = (await request.json().catch(() => null)) as null | {
    contentType?: null | string;
    fileBase64?: string;
    id?: null | string;
    nomeArquivo?: null | string;
    slug?: string;
    variante?: string;
  };

  const variante = corpo?.variante ?? "clara";

  if (!ehVarianteDaLogo(variante)) {
    return NextResponse.json({ error: "Variante de logo desconhecida." }, { status: 400 });
  }
  if (!corpo?.fileBase64) {
    return NextResponse.json({ error: "Nenhum arquivo enviado." }, { status: 400 });
  }
  // ⚠️ A Vercel corta a requisição por volta de 4,5MB e devolve 413 SEM mensagem (incidente do
  // upload de CAD). O corte aqui é bem antes disso, com texto que a tela consegue mostrar — e a
  // tela também confere antes de enviar, para o arquivo grande nem sair do navegador.
  if (corpo.fileBase64.length > LOGO_MAX_BASE64) {
    return NextResponse.json({ error: MENSAGEM_LOGO_GRANDE }, { status: 413 });
  }

  // O portão. Antes de qualquer byte tocar o bucket.
  const prefixo = await prefixoDeLogoPermitido(client, {
    id: corpo.id,
    slug: corpo.slug ?? "",
  });
  if (!prefixo.ok) return NextResponse.json({ error: prefixo.erro }, { status: 400 });

  const resultado = await subirLogoDoIncorporador({
    adminClient: client,
    contentType: corpo.contentType,
    fileBase64: corpo.fileBase64,
    nomeArquivo: corpo.nomeArquivo,
    slug: prefixo.slug,
    variante,
  });

  if (!resultado.ok) return NextResponse.json({ error: resultado.erro }, { status: 400 });

  return NextResponse.json({
    data: {
      referencia: resultado.referencia,
      // A prévia usa o MESMO endereço público que a porta vai usar — se a prévia aparecer, a
      // porta aparece. Só funciona depois de salvar (a rota lê a referência do banco), então a
      // tela mostra a prévia local até lá.
      url: resolverLogoDoPortal({
        referencia: resultado.referencia,
        slug: prefixo.slug,
        variante,
      }),
    },
  });
}
