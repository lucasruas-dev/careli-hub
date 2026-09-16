// O PAINEL DO HÉRCULES NO FORMATO DA TELA DO APOLO.
//
// Lucas (02/09/2026): *"produtos é replicar a tela que temos hoje em empreendimento do apolo"*.
// A tela do Apolo (modules/apolo/blocks/empreendimentos/empreendimentos-view.tsx) só entende
// `ApoloEnterprisesData` ({ rows, totals }); o portal comercial recebe `PainelDeProdutos`
// ({ cards, linhas }) de /api/incorporador/produtos/painel. Este arquivo é a ponte: converte o
// painel para o formato da tela, e a tela do Apolo é reaproveitada SEM cópia.
//
// O QUE É O QUÊ:
//  - `linha.id` vira `row.id` como está: "pai:<uuid>" para pai do cadastro ou o id do C2X. É o
//    mesmo id que a rota de Vendas aceita (lib/hercules/expandir-id-do-painel), então a ficha
//    abre a Vendas com `row.id` direto, sem traduzir.
//  - `filhos` viram `stages` (a tela expande no chevron). Cada filho vira uma row COMPLETA, com
//    `stages: []` — a tela não desce mais de um nível, e o tipo exige o campo.
//  - `incorporador: null` de propósito: o portal é do coordenador, e a ficha do Hércules não
//    mostra esse campo (o Cadastro lá é o board de CADs, não os dados gerais do C2X).
//  - `aviso` vira `mirror` + `mirrorLabel`: é o MESMO rótulo do C2X ("Histórico · mesmos lotes de
//    VOC + VOL") que a rota do painel põe na linha cujo número vem de um espelho parado. A tela do
//    Apolo ainda não desenha o selo (pendência registrada no tipo), mas a ficha do Hércules pode
//    ler `row.mirrorLabel` e avisar. Sem aviso, `mirror: false`: a rota já CONSUMIU o espelho (o
//    pai é a soma dos filhos) e nada chega repetido. Ver painel-de-produtos.ts.
//
// Função pura, sem React e sem fetch: quem carrega é a tela (ProdutosDoHercules).
import type { ApoloEnterpriseRow, ApoloEnterprisesData } from "@/lib/apolo/empreendimentos";

import type { FilhoDoPainel, LinhaDoPainel, PainelDeProdutos } from "./painel-de-produtos";

/** Um filho do painel como a tela do Apolo espera dentro de `stages`. */
function filhoParaRow(filho: FilhoDoPainel, pai: LinhaDoPainel): ApoloEnterpriseRow {
  return {
    // Cidade/UF do pai: o filho do cadastro não carrega endereço próprio, e a etapa fica no
    // mesmo lugar que o produto.
    city: pai.cidade,
    code: filho.codigo,
    codes: [filho.codigo],
    id: filho.id,
    incorporador: null,
    mirror: false,
    mirrorLabel: null,
    mirrorNote: null,
    name: filho.nome,
    scenario: filho.scenario,
    stages: [],
    state: pai.uf,
  };
}

export function linhaParaRow(linha: LinhaDoPainel): ApoloEnterpriseRow {
  // `aviso` pode vir ausente (campo opcional no tipo) ou nulo: os dois querem dizer linha viva.
  const aviso = linha.aviso ?? null;

  return {
    city: linha.cidade,
    code: linha.codigo,
    codes: linha.codes,
    id: linha.id,
    incorporador: null,
    mirror: aviso !== null,
    mirrorLabel: aviso,
    // ⚠️ O PAINEL DO PORTAL SÓ TEM O AVISO CURTO. Ele nasce de `LinhaDoPainel`, que carrega um
    // `aviso` de uma linha — não o texto longo do cadastro de espelhos. Inventar um aqui seria
    // escrever, no portal do incorporador, uma explicação que ninguém revisou; o rótulo basta, e o
    // `title` simplesmente não aparece.
    mirrorNote: null,
    name: linha.nome,
    scenario: linha.scenario,
    stages: linha.filhos.map((filho) => filhoParaRow(filho, linha)),
    state: linha.uf,
  };
}

export function painelParaApolo(painel: PainelDeProdutos): ApoloEnterprisesData {
  return {
    rows: painel.linhas.map(linhaParaRow),
    // Os cards já vêm somados pela rota (sem repetir o espelho); a tela usa como "Todos".
    totals: painel.cards,
  };
}

/**
 * O filho como uma LINHA do painel. A ficha do Hércules (FichaDoProduto) recebe `LinhaDoPainel`,
 * e o "Ver mais" de uma ETAPA expandida abre a ficha daquela etapa só: o id é o do C2X (a rota de
 * Vendas aceita), `codes` é o código dela, e sem filhos. Endereço vem do pai (o filho do cadastro
 * não tem o próprio).
 */
export function linhaDoFilho(filho: FilhoDoPainel, pai: LinhaDoPainel): LinhaDoPainel {
  return {
    // Filho autorizado é linha VIVA por definição (o espelho é sempre o pai): sem aviso.
    aviso: null,
    cidade: pai.cidade,
    codigo: filho.codigo,
    codes: [filho.codigo],
    etapas: 0,
    filhos: [],
    id: filho.id,
    nome: filho.nome,
    scenario: filho.scenario,
    uf: pai.uf,
  };
}

/**
 * A linha da ficha aberta numa ETAPA (o "Ver mais" de um filho), com a escrita DO FILHO.
 *
 * ⚠️ `linhaDoFilho` monta a moldura do filho e não carrega `podeEscrever`, `enterpriseId` nem
 * `tipoProduto`. Sem isto, toda etapa aberta pelo "Ver mais" sairia só consulta, inclusive a etapa
 * que o portal opera, e um prédio abriria o formulário de lote. O filho já vem com a régua aplicada
 * (`podeEscrever` dele, não o do pai): quem monta o índice da tela passa a linha por aqui.
 *
 * (16/09/2026, revisão do conjunto) ⚠️ MORA AQUI, E NÃO EM painel-de-produtos.ts. Este arquivo é
 * importado POR VALOR pela tela (ProdutosDoHercules, "use client") e só importa TIPOS. O
 * painel-de-produtos puxa `findEnterpriseMirror` (lib/guardian/c2x-analytics → db.ts → mysql2), e um
 * import de valor dele na tela levava o mysql2 ao bundle do navegador ("Can't resolve 'net'"),
 * derrubando o portal da Cecílio e o da Gurgel no build.
 */
export function comEscritaDoFilho(linha: LinhaDoPainel, filho: FilhoDoPainel): LinhaDoPainel {
  return {
    ...linha,
    enterpriseId: filho.id,
    operadoPor: filho.operadoPor ?? null,
    podeEscrever: filho.podeEscrever === true,
    tipoProduto: linha.tipoProduto ?? filho.tipoProduto,
  };
}

/**
 * Id → linha do painel, PAIS E FILHOS. É o índice que resolve o "Ver mais": a row aberta pode ser
 * uma etapa (stage), e a etapa não está em `linhas`, está dentro do pai. Um filho com o mesmo id
 * de uma linha simples não acontece (a rota consome cada c2x id numa linha só); se acontecesse, a
 * linha de cima vence — `set` do pai vem antes.
 */
export function indiceDoPainel(painel: PainelDeProdutos): Map<string, LinhaDoPainel> {
  const indice = new Map<string, LinhaDoPainel>();

  for (const linha of painel.linhas) {
    indice.set(linha.id, linha);
    for (const filho of linha.filhos) {
      if (!indice.has(filho.id)) indice.set(filho.id, linhaDoFilho(filho, linha));
    }
  }

  return indice;
}
