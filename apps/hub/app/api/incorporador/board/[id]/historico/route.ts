import { historicoDaFicha } from "@/lib/apolo/board-do-servidor";
import {
  adminOu503,
  autorizarOperacaoDeVenda,
  cadNoEscopo,
  recorteDoProduto,
} from "@/lib/apolo/incorporador/board-do-portal";
import { lerEmpreendimentosDaPessoa } from "@/lib/apolo/incorporador/documentos-do-portal";
import {
  lerFamiliasDoCadastro,
  recorteComEspelhoDoPai,
  recorteDeLeituraDoPortal,
} from "@/lib/apolo/incorporador/familia-no-portal";
import {
  filtroDoHistoricoDoComercial,
  filtroDoHistoricoDoPortal,
} from "@/lib/apolo/incorporador/historico-do-portal";
import {
  ehPortalComercial,
  portalConfeccionaContrato,
} from "@/lib/apolo/incorporador/perfis-de-portal";

// HISTÓRICO da ficha pelo portal que opera a venda — GET /api/incorporador/board/[id]/historico?emp=
//
// Mesmo miolo da rota do hub (`historicoDaFicha`), com o escopo conferido antes: a pessoa tem
// que ter CAD (ou vínculo de imobiliária) no produto do coordenador. Fora dele: 404.
//
// (16/09/2026) E COM O FILTRO DO PORTAL. A pessoa estar no escopo não põe a história inteira dela
// no escopo: a edição marcada sai quando o empreendimento dela está no recorte; a SEM marca (antiga,
// identidade, ficha da imobiliária) sai só quando não há outro produto da pessoa de onde ela possa
// ter vindo; e quem é da equipe da Careli aparece como "Equipe Careli", sem nome nem e-mail
// (lib/apolo/incorporador/historico-do-portal.ts).
//
// (16/09/2026, D4 do Lucas) O COMERCIAL (a Gurgel) VOLTA A VER A FICHA COMO ANTES DA ONDA 1: os nomes
// dos analistas da Careli e a história inteira, inclusive o evento sem marca. Só o evento MARCADO com
// produto fora do recorte fica de fora (`filtroDoHistoricoDoComercial`).
//
// (16/09/2026, revisão do conjunto) No portal que opera sozinho, o espelho do pai só entra com CAD ou
// vínculo da pessoa numa divisão do recorte (`recorteDeLeituraDoPortal`): a ficha aproveitada pelo
// cadastro do Garden (D5) não abre a história do Vale do Ouro que a Careli guarda.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = autorizarOperacaoDeVenda(request);
  if (!auth.ok) return auth.response;

  const rec = await recorteDoProduto(request, auth.sessao);
  if (!rec.ok) return rec.response;

  const admin = adminOu503();
  if (!admin.ok) return admin.response;

  const { id } = await context.params;

  const escopo = await cadNoEscopo(admin.client, id, rec.recorte);
  if (!escopo.ok) return escopo.response;

  if (ehPortalComercial(auth.sessao.tipo)) {
    // O espelho do pai entra como sempre: a edição da CAD que mora no 35 é do produto de quem vende o
    // 37. Sem conseguir ler o cadastro, o recorte cru só esconde mais evento marcado, nunca mostra.
    let recorteDoComercial: ReadonlySet<string> = rec.recorte.ids;
    try {
      recorteDoComercial = recorteComEspelhoDoPai(rec.recorte.ids, await lerFamiliasDoCadastro(admin.client));
    } catch (erro) {
      console.error("[incorporador][board][historico] sem o cadastro para o espelho do pai", erro);
    }
    return historicoDaFicha(admin.client, id, filtroDoHistoricoDoComercial(recorteDoComercial));
  }

  // (16/09/2026, revisão) O EVENTO SEM MARCA PRECISA SABER DA PESSOA. Sem isto, a identidade, a
  // ficha da imobiliária e todo o histórico anterior ao deploy sumiam do board (inclusive o da
  // Gurgel). Os empreendimentos dela e o espelho do pai (a CAD do VOC mora no 35) são lidos aqui;
  // sem conseguir ler, cai no filtro estrito (só o evento marcado), nunca no histórico cru.
  let pessoa: Parameters<typeof filtroDoHistoricoDoPortal>[1];
  let recorte: ReadonlySet<string> = rec.recorte.ids;
  try {
    const [daPessoa, familias] = await Promise.all([
      lerEmpreendimentosDaPessoa(admin.client, id),
      lerFamiliasDoCadastro(admin.client),
    ]);
    pessoa = { ...daPessoa, imobiliaria: escopo.escopo.imobiliaria };
    recorte = recorteDeLeituraDoPortal({
      cadastro: familias,
      daPessoa,
      operaSozinho: portalConfeccionaContrato(auth.sessao.slug, auth.sessao.tipo),
      recorte: rec.recorte.ids,
    });
  } catch (erro) {
    console.error("[incorporador][board][historico] sem os empreendimentos da pessoa", erro);
  }

  return historicoDaFicha(admin.client, id, filtroDoHistoricoDoPortal(recorte, pessoa));
}
