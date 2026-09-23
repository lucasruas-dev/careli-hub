import type { Metadata, Viewport } from "next";
import { notFound } from "next/navigation";

import { abrirTelaDeTv, geometriaDaTv } from "@/lib/hercules/espelho/abrir-tela-de-tv";
import { estadoDoEspelho } from "@/lib/hercules/espelho/estado-do-espelho";
import { estadoParaTv } from "@/lib/hercules/espelho/telas-de-tv";
import { TelaoDeVendas } from "@/modules/publico/espelho/TelaoDeVendas";

// A TV DO STAND — `c2x.app.br/tv/garden`.
//
// Lucas (22/09/2026): *"de preferencia, criar um link curto pois vou ter que digitar na tv"*. São
// 20 caracteres com o domínio, todos palavras, nenhum aleatório: `c2x.app.br/tv/garden`. O espelho
// público tem 33 (`/e/garden-<selo8>`), e os 8 do selo são justamente o pedaço que se erra no
// teclado virtual do controle remoto. O que substitui o selo é a lista curta escrita à mão em
// `lib/hercules/espelho/telas-de-tv.ts` — qualquer outro slug é 404, e a rota não consulta o
// cadastro para descobrir nomes.
//
// ⚠️ ESTA ROTA VIVE FORA DE /publico/, E ISSO EXIGIU UMA LINHA EM `lib/rotas/superficie.ts`. O gate
// de página do hub é client-side e libera por RAIZ; sem `tv` em `RAIZES_EXTERNAS`, o AuthProvider
// mandaria a televisão para /login sem erro nenhum no servidor — e o defeito apareceria como uma
// tela de login na parede do stand. O teste de superfície lê o disco e quebra a build de quem
// criar `app/tv/` sem classificar.
//
// ⚠️ A PRIMEIRA CARGA É NO SERVIDOR, COM O MAPA JÁ PINTADO — é o motivo de `force-dynamic`, e é a
// mesma escolha do telão do Prometeu (`app/publico/masterplan/page.tsx`). A TV liga sozinha, de
// manhã, com ninguém olhando; um instante de mapa sem cor, num stand de vendas, se lê como "tudo
// disponível".
//
// ⚠️ E O TOKEN DO ESPELHO NÃO ATRAVESSA. A página o emite por dentro (`abrirTelaDeTv`) e o consome
// aqui; o que vai para o navegador é o slug. Ver o cabeçalho de `abrir-tela-de-tv.ts` — o token
// abriria o espelho completo, com preço e área dos 404 lotes.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  // noindex: é um telão operacional, não conteúdo de busca. É a única proteção contra indexação
  // que o repo tem (não há robots.txt).
  robots: { follow: false, index: false },
  title: "Masterplan | C2X",
};

export const viewport: Viewport = {
  initialScale: 1,
  themeColor: "#f7f8fa",
  viewportFit: "cover",
  width: "device-width",
};

function Aviso({ texto }: { texto: string }) {
  return (
    <main
      style={{
        alignItems: "center",
        background: "#f7f8fa",
        color: "#667085",
        display: "grid",
        height: "100dvh",
        justifyItems: "center",
        padding: "0 32px",
        textAlign: "center",
        width: "100dvw",
      }}
    >
      <p style={{ fontSize: "clamp(18px, 1.6vw, 34px)", margin: 0 }}>{texto}</p>
    </main>
  );
}

export default async function TelaDeTvRoute({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const aberto = await abrirTelaDeTv(slug);

  // Slug que ninguém liberou: 404 de verdade. É o que impede `/tv/<qualquer nome>` de virar um
  // oráculo do que a Careli vende.
  if (!aberto.ok && aberto.erro === "sem_tela") notFound();
  if (!aberto.ok) return <Aviso texto="Sistema indisponível no momento." />;

  const { espelho, tela } = aberto;

  if (!espelho.masterplan) {
    // Acontece quando o empreendimento não tem masterplan publicado. Dizer isso é melhor que
    // deixar uma tela em branco na parede e alguém procurando defeito no cabo da TV.
    return <Aviso texto="Este empreendimento ainda não tem masterplan publicado." />;
  }

  try {
    const [geometria, estado] = await Promise.all([
      geometriaDaTv(espelho),
      estadoDoEspelho(espelho.client, {
        enterpriseIdDoPai: espelho.paiC2xId,
        enterpriseIdsDosFilhos: espelho.filhosC2xIds,
      }),
    ]);

    if (!geometria) return <Aviso texto="O mapa deste empreendimento está em preparação." />;

    return (
      <TelaoDeVendas
        estadoInicial={estadoParaTv(estado)}
        geometria={geometria}
        marcas={tela.marcas}
        slug={tela.slug}
        // ⚠️ A VERSÃO VAI NA URL DA ARTE, e não é enfeite: a rota responde `immutable` por um ano, e
        // sem a versão no endereço a CDN serviria o desenho antigo depois de uma publicação nova.
        urlDaArte={`/api/publico/espelho/tv/arte?t=${encodeURIComponent(tela.slug)}&v=${espelho.masterplan.versao}`}
      />
    );
  } catch (error) {
    console.error("[publico][tv] falha na primeira carga", error);

    // ⚠️ ERRO É ERRO, E NÃO MAPA VAZIO. Um palco com a foto aérea e nenhum lote pintado seria lido
    // no stand como "o loteamento inteiro está livre".
    return <Aviso texto="Não foi possível carregar o mapa agora." />;
  }
}
