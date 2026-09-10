import type { Metadata, Viewport } from "next";
import { notFound } from "next/navigation";

import { createApoloAdminClient } from "@/lib/apolo/server";
import { abrirEspelho } from "@/lib/hercules/espelho/abrir-espelho";
import { estadoDoEspelho } from "@/lib/hercules/espelho/estado-do-espelho";
import { planosPublicos } from "@/lib/hercules/espelho/planos-publicos";
import {
  apelidoDoEspelho,
  emitirTokenDoEspelho,
  partirLinkCurto,
  seloConfere,
} from "@/lib/hercules/link-do-espelho";
import { EspelhoPublico } from "@/modules/publico/espelho/EspelhoPublico";

// O ESPELHO PÚBLICO NO ENDEREÇO CURTO — `c2x.app.br/e/vale-do-ouro-3f9c2a7b`.
//
// Lucas (10/09/2026): *"o url tem que ser mais personalizada, está longa, pode encurtar ela"*. O
// link circula por WhatsApp, é lido em voz alta e às vezes digitado.
//
// ⚠️ ESTA ROTA VIVE FORA DE /publico/, E ISSO EXIGIU UMA LINHA NO auth-provider. O gate de página
// do hub é client-side e libera por PREFIXO de pathname (`/publico/`, `/evento`, `/incorporador`);
// sem `/e/` naquela lista, o visitante seria mandado para /login e o link "não funcionaria" sem
// nenhum erro no servidor.
//
// ⚠️ E O APELIDO SOZINHO NÃO ABRE NADA. `vale-do-ouro` é público por natureza; quem autoriza é o
// selo de 8 caracteres, que é assinatura HS256 do código. Apelido sem selo, selo errado ou
// apelido que não existe: 404, sempre igual — a resposta não pode diferenciar "não existe" de
// "selo errado", senão a rota vira um oráculo para varrer o que a casa vende.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  // noindex: é um link operacional que o corretor manda, não conteúdo de busca. É a única
  // proteção contra indexação que o repo tem (não há robots.txt).
  robots: { follow: false, index: false },
  title: "Espelho do empreendimento | C2X",
};

export const viewport: Viewport = {
  initialScale: 1,
  // O mapa usa a tela inteira; `viewport-fit=cover` faz env(safe-area-inset-*) valer no iPhone.
  viewportFit: "cover",
  width: "device-width",
};

export default async function EspelhoCurtoRoute({
  params,
}: {
  params: Promise<{ link: string }>;
}) {
  const { link } = await params;
  const partes = partirLinkCurto(link);
  if (!partes) notFound();

  const client = createApoloAdminClient();
  if (!client) notFound();

  // O apelido sai do NOME, e o nome mora no cadastro: a resolução é uma leitura só, sobre 38
  // linhas. Coluna de slug seria uma migration para ganhar nada nesse tamanho.
  const { data } = await client
    .from("hercules_empreendimentos")
    .select("codigo, nome, pai_id");

  const linhas = (data ?? []) as {
    codigo: string;
    nome: string;
    pai_id: null | string;
  }[];

  const achado = linhas.find(
    (e) => apelidoDoEspelho(e.nome) === partes.apelido && seloConfere(e.codigo, partes.selo),
  );
  if (!achado) notFound();

  // Daqui para baixo é o mesmo caminho de `/publico/espelho`: o token completo é o que as três
  // rotas de API entendem, e é ele que a página passa ao componente.
  const token = emitirTokenDoEspelho(achado.codigo);
  const aberto = await abrirEspelho(token);
  if (!aberto.ok) {
    return <EspelhoPublico erroInicial="Link inválido ou indisponível." token="" />;
  }

  const { filhosC2xIds, masterplan, nome, paiC2xId } = aberto.espelho;

  try {
    const [estado, planos] = await Promise.all([
      estadoDoEspelho(aberto.espelho.client, {
        enterpriseIdDoPai: paiC2xId,
        enterpriseIdsDosFilhos: filhosC2xIds,
      }),
      planosPublicos(aberto.espelho.client, [paiC2xId, ...filhosC2xIds].filter(Boolean) as string[]),
    ]);

    return (
      <EspelhoPublico
        inicial={{
          ...estado,
          planos,
          empreendimento: { codigo: aberto.espelho.codigo, nome },
          temMapa: masterplan !== null,
        }}
        token={token ?? ""}
      />
    );
  } catch (error) {
    console.error("[publico][espelho] falha na primeira carga", error);

    // Erro é erro: a tela avisa e oferece recarregar. Mapa vazio seria lido como "não tem nada
    // à venda aqui".
    return (
      <EspelhoPublico
        erroInicial="Não foi possível carregar o mapa agora."
        token={token ?? ""}
      />
    );
  }
}
