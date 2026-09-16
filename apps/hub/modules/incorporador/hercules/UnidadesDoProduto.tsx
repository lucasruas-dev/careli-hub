"use client";

import type { ApoloEnterpriseRow, ApoloEnterpriseUnit } from "@/lib/apolo/empreendimentos";
import { UnidadesTab } from "@/modules/apolo/blocks/empreendimentos/empreendimentos-view";

import { MOLDURA_TAILWIND } from "../TelaContratos";
import { useTemaDoPortal } from "../tema";
import { BotaoDeEditarUnidade } from "./EdicaoDaUnidade";

// UNIDADES DO PRODUTO — a aba Unidades do Apolo, dentro da aba Vendas da ficha do Hércules.
//
// Lucas (02/09/2026, olhando a ficha do Jardim das Gerais na aba Vendas): *"precisamos trazer a
// tela de unidades para dentro de Venda"*. Trazer é reaproveitar: é a MESMA `UnidadesTab` da ficha
// interna (modules/apolo/blocks/empreendimentos/empreendimentos-view.tsx) — busca, filtro por
// status, ordenação por coluna, cabeçalho travado, a atualização sozinha durante o lançamento —
// montada pela porta do portal: a prop `api` aponta para /api/incorporador/produto/unidades (cookie
// da sessão, escopo conferido do outro lado) e dispensa o Bearer do hub, que o coordenador não tem.
//
// O `emp` é o id que o painel de produtos devolveu ("pai:<uuid>" ou o id do C2X); a rota expande e
// cruza com o escopo da sessão (fora do escopo = 404). A `row` é a linha da ficha no formato do
// Apolo (`linhaParaRow`): a tabela só usa `codes` como gatilho do efeito — a URL vem pronta na
// prop `api`.
//
// ⚠️ ALTURA. A UnidadesTab é `flex min-h-0 flex-1` e conta com um pai de altura DEFINIDA para a
// tabela rolar por dentro e o thead sticky grudar (é assim que o EnterpriseDetail a monta: a
// <section> vira `flex min-h-0 flex-1 flex-col overflow-hidden` só nessa aba). Aqui a altura vem
// PRESA À SECTION DA FICHA, não ao viewport: a FichaDoProduto deixa a <section> em `flex-col` na
// aba Vendas e a TelaVendas, na sub-aba Unidades, vira um flex item que ocupa a section inteira
// com a última linha do grid (`minmax(0, 1fr)`) sendo este contêiner — então ele mede exatamente
// o que sobra abaixo do cabeçalho da Vendas e das pílulas, em qualquer largura.
//
// ⚠️ NÃO VOLTE PARA `calc(100dvh - N)`: a primeira versão usava 440px, calibrados a olho antes da
// casca nova, e a conta muda com a largura (os KPIs da ficha quebram em duas linhas abaixo de
// 1280px, `sm:grid-cols-3`) — no notebook o contêiner ficava ~35px MAIOR que a área visível e a
// tabela ganhava rolagem dupla (section da ficha + tabela). Preso à section, não há conta.
//
// Nunca abaixo de 420px: em tela baixa o contêiner transborda o grid e a section da ficha
// (overflow:auto) volta a rolar — pior que isso seria uma tabela de três linhas. No celular (o
// breakpoint da casca, 860px) a altura é do conteúdo, como nas outras telas do portal.
//
// ⚠️ TAILWIND DENTRO DO PORTAL. A moldura (`MOLDURA_TAILWIND`, a ÚNICA, da TelaContratos) e o
// `data-uix-theme` com o tema EFETIVO: sem eles a tabela apareceria clara no portal escuro. A ficha
// já os aplica por fora; ficam AQUI também para a tela funcionar montada em qualquer lugar.
/**
 * A linha da tabela pode ser corrigida por aqui? Só a unidade do PANTEON (id uuid de
 * `hercules_unidades`): a linha que ainda vem do C2X tem id numérico do legado, e a rota de correção
 * não conhece esse id (nem deve: o C2X é somente leitura).
 */
export function unidadeCorrigivelNoPortal(unidade: Pick<ApoloEnterpriseUnit, "id">): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(unidade.id ?? "").trim());
}

const CSS_UNIDADES = `
  .inc-hercules-unidades {
    color: var(--inc-text);
    display: flex;
    flex-direction: column;
    height: auto;
    min-height: 420px;
  }
  @media (max-width: 860px) {
    .inc-hercules-unidades { min-height: 60dvh; }
  }
`;

export function UnidadesDoProduto({
  emp,
  enterpriseId = null,
  podeEditar = false,
  row,
}: {
  /** O produto da ficha ("pai:<uuid>" do cadastro ou id do C2X) — o mesmo `empFixo` da Vendas. */
  emp: string;
  /**
   * O id do produto que a correção de unidade grava (o `enterpriseId` da linha do painel). Nulo =
   * a linha não aponta UM produto (pai com várias etapas), e a correção não aparece.
   */
  enterpriseId?: null | string;
  /**
   * O portal pode corrigir as unidades deste produto (`linha.podeEscrever`, a régua de quem opera,
   * D1/D2 de 16/09/2026). Falso = só consulta: a tabela não ganha a coluna de ação. A rota confere de
   * novo antes de gravar; isto só decide o botão.
   */
  podeEditar?: boolean;
  /** A linha da ficha no formato da tela do Apolo. */
  row: ApoloEnterpriseRow;
}) {
  // O tema efetivo (já resolvido o "seguir o aparelho") vira o atributo que os `dark:` leem.
  const { efetivo } = useTemaDoPortal();

  return (
    <div
      className="inc-hercules-unidades"
      data-uix-theme={efetivo === "escuro" ? "dark" : "light"}
      style={MOLDURA_TAILWIND}
    >
      <style>{CSS_UNIDADES}</style>
      {/* `onOpenEntity` é o CRM 360 interno; o portal não tem essa porta. Com `api` a tabela nem
          desenha o botão (o nome sai como texto) — o no-op fica só para satisfazer a prop. */}
      <UnidadesTab
        api={{
          rota: `/api/incorporador/produto/unidades?emp=${encodeURIComponent(emp)}`,
          semToken: true,
        }}
        // A coluna de ação só existe quando o portal opera o produto E a linha aponta um produto só.
        acaoDaUnidade={
          podeEditar && enterpriseId
            ? (unidade, recarregar) =>
                unidadeCorrigivelNoPortal(unidade) ? (
                  <BotaoDeEditarUnidade aoSalvar={recarregar} emp={enterpriseId} unidade={unidade} />
                ) : null
            : undefined
        }
        onOpenEntity={() => {}}
        row={row}
      />
    </div>
  );
}
