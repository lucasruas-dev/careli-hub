// ABRIR UMA TELA DE TV — do slug do controle remoto até o espelho já resolvido.
//
// A página `/tv/<slug>` e as duas rotas que ela chama (arte e situação) começam iguais: resolver o
// slug na lista curta, emitir o token do espelho daquele empreendimento e abrir. Mora aqui para as
// três nunca discordarem sobre o que um slug significa.
//
// ⚠️ O TOKEN DO ESPELHO É EMITIDO AQUI E MORRE AQUI — ele NÃO viaja para o navegador da TV. Essa é
// a diferença que justifica as rotas próprias `/api/publico/espelho/tv/*` em vez de reaproveitar
// `/api/publico/espelho/{arte,situacao}?e=<token>` direto na página. O token abre o espelho
// COMPLETO: preço de tabela e área dos 404 lotes, mais o simulador de proposta. Se ele fosse parar
// no `src` de uma `<img>` ou num `fetch` do cliente, bastaria abrir o código-fonte de um endereço
// que qualquer um digita (`c2x.app.br/tv/garden`, sem selo) para ter a credencial do espelho
// inteiro. Com o slug na URL e o token só no servidor, o link público da TV dá acesso a duas cores
// e a nada mais.
//
// O QUE QUEBRA SEM ISTO: a TV continuaria funcionando igual — e o link sem selo passaria a ser,
// na prática, o link do espelho com preço.
import { abrirEspelho, type EspelhoAberto } from "./abrir-espelho";
import { BUCKET_DO_ESPELHO, caminhoDaGeometria } from "./pecas-do-espelho";
import { emitirTokenDoEspelho } from "../link-do-espelho";
import { telaDeTv, type TelaDeTv } from "./telas-de-tv";

export type TelaDeTvAberta = {
  espelho: EspelhoAberto;
  tela: TelaDeTv;
};

/**
 * Resolve o slug numa tela pronta, ou diz por quê não.
 *
 * ⚠️ OS DOIS MOTIVOS SÃO DIFERENTES DE PROPÓSITO, ao contrário do espelho público. Lá a resposta é
 * sempre igual para não virar oráculo de códigos; aqui não há o que esconder — a lista de slugs é
 * escrita à mão e não diz nada sobre o cadastro. `sem_tela` é 404 (slug que ninguém liberou) e
 * `indisponivel` é 503 (Supabase fora, segredo ausente), e distinguir os dois é o que evita alguém
 * trocar o cabo da TV procurando um erro de digitação que não existe.
 */
export async function abrirTelaDeTv(
  slug: null | string | undefined,
): Promise<
  { erro: "indisponivel" | "sem_tela"; ok: false } | { ok: true } & TelaDeTvAberta
> {
  const tela = telaDeTv(slug);
  if (!tela) return { erro: "sem_tela", ok: false };

  const token = emitirTokenDoEspelho(tela.codigo);
  const aberto = await abrirEspelho(token);
  if (!aberto.ok) return { erro: "indisponivel", ok: false };

  return { espelho: aberto.espelho, ok: true, tela };
}

/** Os contornos dos lotes e o viewBox — a mesma peça que a rota `/geometria` serve ao espelho. */
export type GeometriaDaTv = {
  contornos: { codigo: string; d: string }[];
  viewBox: string;
};

/**
 * Baixa a geometria do masterplan publicado.
 *
 * ⚠️ É LIDA NO SERVIDOR E VAI JUNTO COM A PÁGINA, e não por `fetch` depois da primeira pintura como
 * no espelho e no telão do Prometeu. O motivo é o mesmo que fez a página do telão ser
 * `force-dynamic`: a TV do stand liga sozinha e ninguém está olhando para ela naquele segundo. Com a
 * geometria vindo depois, o primeiro quadro é a foto aérea SEM COR NENHUMA — e um mapa de
 * loteamento sem cor, num stand de vendas, se lê como "tudo disponível". São 33 KB no Garden
 * (medido no storage), contra os 2,4 MB da arte: cabem na resposta sem pesar.
 *
 * `null` quando não há masterplan publicado ou o derivado não foi preparado — a página avisa, em
 * vez de desenhar um palco vazio.
 */
export async function geometriaDaTv(espelho: EspelhoAberto): Promise<GeometriaDaTv | null> {
  if (!espelho.masterplan) return null;

  const { data, error } = await espelho.client.storage
    .from(BUCKET_DO_ESPELHO)
    .download(caminhoDaGeometria(espelho.codigo, espelho.masterplan.versao));

  if (error || !data) {
    console.error(
      `[publico][tv] geometria ausente para ${espelho.codigo} v${espelho.masterplan.versao}.`,
      "Rode scripts/hercules/preparar-espelho.mts --pai",
      espelho.codigo,
      "--gravar",
    );
    return null;
  }

  try {
    const lido = JSON.parse(await data.text()) as GeometriaDaTv;
    // ⚠️ VAZIO NÃO É MAPA. Um `contornos: []` passaria daqui e a TV mostraria a foto aérea sem um
    // lote pintado — que é exatamente o pior quadro possível nesta tela.
    if (!Array.isArray(lido?.contornos) || lido.contornos.length === 0) return null;
    return { contornos: lido.contornos, viewBox: lido.viewBox };
  } catch (erro) {
    console.error("[publico][tv] geometria ilegível", erro);
    return null;
  }
}
