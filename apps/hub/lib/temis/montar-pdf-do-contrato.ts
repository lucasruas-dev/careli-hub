// O MONTADOR DO PDF FINAL — capa + corpo + anexos, num arquivo só.
//
// O desenho é o de 07/09/2026, escrito em `variaveis.ts`: *"O CONTRATO É UMA MONTAGEM, não um
// documento só: capa + corpo + anexos. Só o corpo se escreve no editor."* Até 21/09/2026 existia
// só o corpo: `contrato-servico.ts` chamava `gerarPdfDoHtml` e gravava o resultado direto. A capa
// cadastrada na minuta e os anexos cadastrados no empreendimento nunca chegavam ao papel.
//
// ⚠️ A COSTURA É `pdf-lib`, E NÃO OUTRO CHROMIUM. O Chromium existe aqui porque a minuta é
// diagramação de verdade (tabela mesclada, nota de rodapé, fonte por trecho) — ver a nota do topo
// de `html-para-pdf.ts`. Capa e anexo já são PÁGINAS PRONTAS: não há o que diagramar, só o que
// copiar. `pdf-lib` já é dependência do repo (`^1.17.1`) e o precedente exato de concatenação está
// em `lib/apolo/cadastro-upload.ts` (`juntarEmPdf`), que junta RG frente e verso do CAD.
//
// ⚠️ A MONTAGEM ENTRA ANTES DA GAVETA, e isso é o que faz o PDF guardado, o que vai assinar e o
// que o cliente baixa serem o MESMO arquivo. Montar depois — na hora de baixar, por exemplo —
// criaria uma segunda verdade sobre o mesmo contrato, que é a dívida que `contrato-da-proposta.ts`
// existe para não repetir.
//
// ⚠️ O ANEXO SEMPRE COMEÇA EM PÁGINA NOVA, e isso é consequência, não escolha. Anexo é página
// pronta: ele não cabe no meio de um parágrafo. Nesta camada eles vão todos para o FIM, na ordem
// da posição. O `[anexo_2]` no MEIO do texto ainda não é honrado — ver "O QUE FALTA", no rodapé.
//
// ⚠️ PDF CRIPTOGRAFADO EXISTE E É COMUM (cartório, prefeitura), E ELE É RECUSADO — nomeando a peça.
// Esta nota já dizia isso em 21/09/2026 e o código não fazia: `PDFDocument.load` lança no arquivo
// cifrado, então a chamada passa `ignoreEncryption`, e `ignoreEncryption` NÃO DECIFRA — ele só
// deixa de lançar. O `copyPages` copiava o stream cifrado e o `save()` gravava sem `/Encrypt`: um
// contrato que se declara em claro carregando bytes cifrados, com a página do cartório em branco.
// Quem confere não vê, porque o PDF abre. Agora a pergunta é feita (`origem.isEncrypted`) e a
// montagem para ali. Aceitar a peça exigiria DECIFRAR antes de copiar (qpdf, pdfjs), e isso é
// outra entrega.
//
// ⚠️ E O FORMATO É LIDO DOS BYTES, não da extensão nem do `mime` declarado. Ver `formatoDosBytes`.

import { PDFDocument } from "pdf-lib";

/** Uma peça que vai para o PDF final. `mime` só importa na capa, que pode ser imagem. */
export type PecaDoContrato = {
  /** O tamanho que o CADASTRO já conhecia (`temis_anexos.arquivo_bytes`), para o teto decidir antes
   * de baixar. Ausente = ninguém mediu; aí o teto só pode olhar os bytes em mãos. */
  arquivoBytes?: null | number;
  bytes: Uint8Array;
  /**
   * O tipo que o cadastro DECLAROU. É pista, e só: quem decide é `formatoDosBytes`.
   *
   * ⚠️ DEIXOU DE MANDAR EM 21/09/2026, e o motivo está no comentário de `formatoDosBytes`.
   */
  mime?: string;
  /** O nome que aparece na recusa quando esta peça não abre. */
  nome: string;
};

/**
 * O formato REAL dos bytes, lido dos primeiros deles.
 *
 * ⚠️ OS BYTES MANDAM, E NÃO A EXTENSÃO NEM O `mime` DECLARADO. Até 21/09/2026 a capa era
 * classificada por `mimeDoCaminho`, que olha o fim do caminho no Storage e devolve
 * `application/pdf` para tudo que não terminar em `.png`, `.jpg` ou `.jpeg`. Um JPEG salvo pelo
 * Chrome sai com extensão `.jfif`: o upload aceitava (o navegador declarou `image/jpeg`), a
 * montagem tratava como PDF e TODO contrato daquele empreendimento passava a devolver 409 com uma
 * frase mandando tirar a senha de uma imagem que nunca teve senha.
 */
export function formatoDosBytes(bytes: Uint8Array): "desconhecido" | "jpeg" | "pdf" | "png" {
  if (bytes.length >= 5 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) {
    return "pdf";
  }
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return "png";
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpeg";
  return "desconhecido";
}

export type PedidoDeMontagem = {
  /** Os anexos, JÁ na ordem da posição. Vazio = o PDF é o corpo (com a capa, se houver). */
  anexos: readonly PecaDoContrato[];
  /** A capa cadastrada na minuta. PDF ou imagem. */
  capa: null | PecaDoContrato;
  /** O contrato preenchido, saído do Chromium. */
  corpo: Uint8Array;
};

export type MontagemDoPdf =
  | { erro: string; ok: false }
  | { ok: true; paginas: number; pdf: Uint8Array };

/**
 * Teto para a SOMA das peças em memória.
 *
 * ⚠️ NÃO É O MESMO TETO DO CADASTRO. Cada anexo já é limitado a 20 MB no upload
 * (`LIMITE_ANEXO_BYTES`), mas o que derruba a função é a SOMA: o `pdf-lib` carrega origem e
 * destino inteiros na RAM. 24 MB é o número que a casa já usa para juntar páginas baixando do
 * Storage (`TETO_JUNCAO_BYTES`, em `lib/apolo/cadastro-upload.ts`), e repetir o número conhecido
 * vale mais do que inventar um segundo.
 */
export const TETO_DA_MONTAGEM_BYTES = 24 * 1024 * 1024;
export const TETO_DA_MONTAGEM_ROTULO = "24MB";

/** Uma peça vista só pelo PESO: é o que o cadastro sabe antes de qualquer download. */
export type PesoDaPeca = { bytes: null | number; nome: string };

/**
 * A recusa do teto, ou `null` quando cabe. A MESMA frase nos dois momentos em que ela pode sair.
 *
 * ⚠️ ELA É CHAMADA DUAS VEZES, E A PRIMEIRA É A QUE IMPORTA. `temis_anexos.arquivo_bytes` guarda o
 * tamanho REAL do objeto desde o cadastro (`gravarAnexo` lê do Storage), e até 21/09/2026 ninguém
 * o usava: `baixarPecasDoContrato` trazia todas as peças para a memória da função e só então a
 * montagem comparava a soma com o teto. Medido na mesma data, com três anexos de 9MB (o limite por
 * peça é 20MB, então três peças legítimas já estouram): a rota recusava com 409 citando "24MB"
 * DEPOIS de transferir 27MB para dentro da função serverless. Com peças de 20MB, 60MB.
 *
 * ⚠️ E A SEGUNDA CHAMADA CONTINUA EXISTINDO porque a primeira pode subestimar: `arquivo_bytes` é
 * nulo nas linhas gravadas antes da coluna existir, e a capa não tem tamanho em canto nenhum.
 * Tamanho desconhecido não vira zero na conta da decisão — vira uma peça que só a segunda pesa.
 */
export function recusaPorTetoDaMontagem(
  corpoBytes: number,
  pecas: readonly PesoDaPeca[],
): null | string {
  const conhecidas = pecas.filter((p): p is { bytes: number; nome: string } =>
    typeof p.bytes === "number" && p.bytes > 0,
  );
  const total = corpoBytes + conhecidas.reduce((soma, p) => soma + p.bytes, 0);
  if (total <= TETO_DA_MONTAGEM_BYTES) return null;

  const maior = [...conhecidas].sort((a, b) => b.bytes - a.bytes)[0];
  return (
    `O contrato com a capa e os anexos passa de ${TETO_DA_MONTAGEM_ROTULO} (${megabytes(total)}) e não consigo montar o PDF. ` +
    (maior ? `A maior peça é "${maior.nome}", com ${megabytes(maior.bytes)}. ` : "") +
    "Reduza o arquivo (um PDF digitalizado costuma cair muito quando é salvo como PDF de texto) e gere de novo."
  );
}

/**
 * Costura capa, corpo e anexos.
 *
 * ⚠️ SEM CAPA E SEM ANEXO, O CORPO SAI INTOCADO. Não é economia: reabrir e re-salvar o PDF do
 * Chromium no `pdf-lib` reescreve a estrutura do arquivo (metadados, compressão, ordem de
 * objetos). Hoje isso não muda o que se lê, mas muda os BYTES — e `hercules_documentos` guarda
 * `tamanho_bytes`, a gaveta compara versões e o D4Sign assina o arquivo que recebeu. Os 594
 * contratos que já saem hoje continuam saindo byte a byte iguais.
 */
export async function montarPdfDoContrato(pedido: PedidoDeMontagem): Promise<MontagemDoPdf> {
  const pecas = [...(pedido.capa ? [pedido.capa] : []), ...pedido.anexos];
  if (pecas.length === 0) {
    return { ok: true, paginas: 0, pdf: pedido.corpo };
  }

  const recusa = recusaPorTetoDaMontagem(
    pedido.corpo.byteLength,
    pecas.map((p) => ({ bytes: p.bytes.byteLength, nome: p.nome })),
  );
  if (recusa) return { erro: recusa, ok: false };

  try {
    const destino = await PDFDocument.create();

    // ⚠️ O CORPO É LIDO ANTES DA CAPA, e a ordem importa: é dele que sai o tamanho do papel do
    // documento inteiro (ver `folhaDoCorpo`). A capa continua sendo a PRIMEIRA página do PDF; o que
    // mudou é só o momento da leitura.
    const corpo = await PDFDocument.load(pedido.corpo, { ignoreEncryption: true });
    const folha = folhaDoCorpo(corpo);

    if (pedido.capa) {
      // A capa pode ser imagem por decisão do cadastro (`TIPOS_DA_CAPA`): ela é desenhada no Canva.
      const falha = await acrescentar(destino, pedido.capa, { aceitaImagem: true, folha });
      if (falha) return { erro: falha, ok: false };
    }

    for (const pagina of await destino.copyPages(corpo, corpo.getPageIndices())) {
      destino.addPage(pagina);
    }

    for (const anexo of pedido.anexos) {
      // ⚠️ O ANEXO É SEMPRE PDF, por decisão de `anexos.ts` (*"o anexo é página pronta"*). Aceitar
      // imagem aqui empurraria a conversão para dentro da montagem, que é onde ela fica cara.
      const falha = await acrescentar(destino, anexo, { aceitaImagem: false, folha });
      if (falha) return { erro: falha, ok: false };
    }

    const bytes = await destino.save();
    return { ok: true, paginas: destino.getPageCount(), pdf: bytes };
  } catch (e) {
    console.error("[temis][contrato] falha ao montar o PDF final", e instanceof Error ? e.message : e);
    return {
      erro: "Não consegui juntar a capa e os anexos ao contrato. O texto está pronto; o problema é em uma das peças anexadas.",
      ok: false,
    };
  }
}

/** O papel do documento: a primeira página do corpo manda, e todas as peças se encaixam nela. */
type Folha = { altura: number; largura: number };

/**
 * O tamanho do papel do contrato.
 *
 * ⚠️ QUEM MANDA É O CORPO, e não um A4 escrito aqui: o corpo nasce do Chromium
 * (`html-para-pdf.ts`, `format: "A4"`), e se um dia ele mudar de papel a montagem acompanha sozinha.
 * Corpo sem página nenhuma (que não existe hoje) cai no A4 nominal.
 */
function folhaDoCorpo(corpo: PDFDocument): Folha {
  const primeira = corpo.getPageCount() > 0 ? corpo.getPage(0) : null;
  if (!primeira) return { altura: 841.89, largura: 595.28 };
  const { height, width } = primeira.getSize();
  return { altura: height, largura: width };
}

/**
 * Onde desenhar a peça dentro da folha: maior escala que cabe, centralizada.
 *
 * ⚠️ AS CHAVES DE SAÍDA SÃO `height` E `width`, EM INGLÊS, e isso não é desleixo de idioma: é o
 * contrato do `drawPage`/`drawImage` do pdf-lib. Nascidas em português (`altura`/`largura`), elas
 * eram IGNORADAS — a biblioteca não achava o que ler, caía no tamanho original e desenhava a arte
 * em 1:1 dentro de uma folha menor. Resultado medido no contrato do Vale do Ouro de 22/09/2026: a
 * capa A2 entrou em escala 1 numa folha A4 e saiu CORTADA pela metade, com o texto partido na
 * lateral. Nívea, no mesmo dia: *"A carta tambem esta ficando desconfigurada"*.
 *
 * ⚠️ E O TESTE NÃO PEGOU, porque ele conferia o tamanho da PÁGINA e a BBox do XObject, que
 * continuavam certos: o que estava errado era a MATRIZ de desenho, que nenhuma das duas medidas
 * enxerga. Por isso a suíte passou a afirmar a escala aplicada.
 */
function encaixar(
  peca: { altura: number; largura: number },
  folha: Folha,
): { height: number; width: number; x: number; y: number } {
  const escala = Math.min(folha.largura / peca.largura, folha.altura / peca.altura);
  const width = peca.largura * escala;
  const height = peca.altura * escala;
  return { height, width, x: (folha.largura - width) / 2, y: (folha.altura - height) / 2 };
}

/**
 * Uma peça vira páginas do destino. Devolve a frase da recusa, ou vazio quando deu certo.
 *
 * ⚠️ TODA PÁGINA DO CONTRATO SAI NO PAPEL DO CORPO. Lucas, 22/09/2026, com o print do contrato do
 * Vale do Ouro: *"capa está ficando desproporcional"*. Medida a capa cadastrada: 1190 x 1684 pt,
 * exatamente o DOBRO do A4 do corpo (595 x 842). A montagem copiava a página como ela era, e o
 * documento saía com uma folha gigante na frente de 32 folhas normais — no leitor, a capa aparece
 * enorme e o contrato minúsculo, na mesma tela.
 *
 * ⚠️ ENCAIXAR NÃO É ESTICAR, e era isso que a nota anterior confundia. A escala é a MESMA nos dois
 * eixos (`encaixar`), então a arte aprovada no Canva não deforma: ela só passa a caber na folha, e
 * sobra tarja apenas quando a proporção da peça difere da do papel. A capa do Vale do Ouro tem a
 * proporção exata do A4, então ela cobre a folha inteira, sem tarja e sem corte.
 *
 * ⚠️ PEÇA QUE JÁ VEM NO TAMANHO DA FOLHA NÃO MUDA: a escala dá 1 e o deslocamento dá zero.
 */
async function acrescentar(
  destino: PDFDocument,
  peca: PecaDoContrato,
  regra: { aceitaImagem: boolean; folha: Folha },
): Promise<string> {
  const nome = peca.nome || "a peça anexada";
  // O `mime` declarado no cadastro é PISTA; quem decide é o conteúdo. Ver `formatoDosBytes`.
  const formato = formatoDosBytes(peca.bytes);

  try {
    if (formato === "png" || formato === "jpeg") {
      if (!regra.aceitaImagem) {
        return (
          `O arquivo de "${nome}" é uma imagem (${formato.toUpperCase()}), e o anexo do contrato precisa ser PDF: ` +
          "ele entra como página pronta no documento montado. Converta para PDF e substitua o anexo."
        );
      }
      const imagem =
        formato === "png"
          ? await destino.embedPng(peca.bytes)
          : await destino.embedJpg(peca.bytes);
      // ⚠️ PIXEL NÃO É PONTO. `addPage([imagem.width, imagem.height])` tratava a medida em PIXELS
      // como medida em PONTOS: uma capa de 2480 px (A4 a 300 dpi) virava uma folha de 2480 pt, mais
      // de quatro vezes o A4. Agora a imagem se encaixa na folha do corpo.
      const pagina = destino.addPage([regra.folha.largura, regra.folha.altura]);
      pagina.drawImage(imagem, encaixar({ altura: imagem.height, largura: imagem.width }, regra.folha));
      return "";
    }

    // ⚠️ O QUE NÃO É PDF É RECUSADO PELO FORMATO, E A FRASE DIZ ISSO. Até 21/09/2026 um .docx
    // registrado pela rota derrubava a geração com uma mensagem mandando "salvar uma cópia sem
    // proteção" — e quem lia trocava o arquivo certo, porque ele nunca teve senha nenhuma.
    if (formato !== "pdf") {
      return (
        `O arquivo de "${nome}" não é um PDF (nem PNG ou JPEG): não consigo transformá-lo em página do contrato. ` +
        "Converta a peça para PDF e substitua o anexo."
      );
    }

    const origem = await PDFDocument.load(peca.bytes, { ignoreEncryption: true });

    // ⚠️ `ignoreEncryption` NÃO DECIFRA NADA — ele só deixa de lançar, e é isso que fazia o defeito
    // mais caro deste arquivo. O cartório entrega o PDF com o handler padrão e SENHA DE USUÁRIO
    // VAZIA quando marca "não permitir cópia/impressão": o arquivo abre em qualquer leitor, mas os
    // streams estão cifrados. O `copyPages` copiava o stream ainda cifrado e o `save()` gravava o
    // resultado SEM o dicionário `/Encrypt` — o contrato ia a cartório com uma página em branco ou
    // com lixo, se dizendo em claro, e a montagem devolvia `ok: true`. Medido em 21/09/2026: a
    // pergunta custa uma linha, porque o próprio pdf-lib já sabe a resposta depois do `load`.
    if (origem.isEncrypted) {
      return (
        `O arquivo de "${nome}" está protegido (senha, ou cópia e impressão bloqueadas), e eu não consigo copiar as páginas dele para o contrato. ` +
        "Se eu juntasse assim, a peça sairia em branco no papel e ninguém perceberia. Abra o arquivo, salve uma cópia sem proteção e substitua o anexo."
      );
    }

    // ⚠️ EMBUTIR E DESENHAR, e não copiar: `copyPages` preserva o MediaBox da origem, e era ele que
    // trazia a capa A2 para dentro de um contrato A4. `embedPage` transforma a página num objeto
    // desenhável, que cabe onde a gente mandar.
    //
    // ⚠️ PÁGINA SEM CONTEÚDO NÃO SE EMBUTE. O `pdf-lib` recusa `embedPage` numa página sem
    // `/Contents` (a folha realmente em branco), e a recusa derrubaria a montagem inteira por causa
    // de uma página vazia no meio de um anexo digitalizado. Ela entra como folha em branco, que é o
    // que ela é — e por isso o filtro vem ANTES da chamada, e não com um `continue` no meio dela.
    const daPeca = origem.getPages();
    const comConteudo = daPeca.filter((pagina) => pagina.node.Contents());

    // ⚠️ UMA CHAMADA SÓ, E NÃO UMA POR PÁGINA. `embedPage` cria um `PDFObjectCopier` NOVO a cada
    // chamada (pdf-lib, `PDFDocument.embedPages`), e cada copier tem o próprio cache: tudo o que as
    // páginas da peça COMPARTILHAM — as fontes, acima de tudo — era copiado de novo a cada página.
    // `embedPages` em lote usa um copier só e deduplica.
    //
    // ⚠️ O QUE ISSO CUSTAVA, MEDIDO EM 22/09/2026: num anexo de texto de 120 páginas, 242 streams
    // de fonte somando 2,402MB contra 62 somando 0,615MB — fonte duplicada explicava 79% do
    // inchaço daquele arquivo. Em peça DIGITALIZADA o ganho é ZERO, porque cada página é uma imagem
    // própria e não há o que compartilhar: é por isso que o contrato que sai hoje (capa + corpo +
    // matrícula escaneada) não inchava e ninguém tinha percebido. O preço aparecia no dia em que o
    // anexo fosse um memorial, um regulamento ou uma minuta: +37% a +62% medidos, e +723% numa peça
    // que repete a mesma imagem em várias páginas.
    //
    // ⚠️ A GEOMETRIA NÃO MUDA. Continua `embedPage` + `drawPage` com o mesmo `encaixar`: o que
    // muda é só quantos copiers o pdf-lib abre. Trocar por `copyPages` renderia mais, e foi medido,
    // mas mexe no MediaBox, no `/Rotate`, no clip do BBox e nas anotações — outra entrega.
    const embutidas = comConteudo.length > 0 ? await destino.embedPages(comConteudo) : [];
    const porPagina = new Map(comConteudo.map((pagina, i) => [pagina, embutidas[i]]));

    for (const dePagina of daPeca) {
      const pagina = destino.addPage([regra.folha.largura, regra.folha.altura]);
      const embutida = porPagina.get(dePagina);
      if (!embutida) continue;
      pagina.drawPage(embutida, encaixar({ altura: embutida.height, largura: embutida.width }, regra.folha));
    }
    return "";
  } catch (e) {
    console.error(`[temis][contrato] peça "${nome}" não abriu`, e instanceof Error ? e.message : e);
    return (
      `Não consegui ler o arquivo de "${nome}" para juntar ao contrato. ` +
      "Se ele foi digitalizado num cartório, é provável que esteja protegido por senha: abra, salve uma cópia sem proteção e substitua o anexo."
    );
  }
}

function megabytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

// ── O QUE FALTA, PARA QUEM PEGAR ESTA PEÇA DEPOIS ────────────────────────────
//
// `[anexo_2]` NO MEIO DA CLÁUSULA não é honrado, E ISSO VIROU DECISÃO, não mais dívida. Lucas,
// 22/09/2026, depois de ver o quadro medido: *"não tem problema, pode ir no fim"*. O marcador some
// do texto (ver `ehMarcadorDeMontagem`, em `preencher-contrato.ts`) e o arquivo entra no fim, na
// ordem da posição.
//
// ⚠️ A NOTA ANTERIOR ESTAVA ERRADA e vale corrigi-la, porque era ela que a próxima pessoa leria
// para decidir: ela dizia que NENHUMA das 11 minutas usava `[anexo_N]`. Medido em 22/09/2026, são
// 18 minutas e QUATRO usam — entre elas a VOL v10 e a VOC v2, as duas publicadas e em uso. Em
// 100% delas o `[anexo_N]` está no ÚLTIMO bloco do documento (bloco 280 de 280), então "no fim"
// coincide exatamente com onde o marcador foi escrito. É por isso que a decisão custa pouco: o
// desenho que o jurídico já usa (o contrato do Villa Paris, no C2X) também põe a peça no fim.
//
// E a trava do marcador órfão nunca dispara nessas minutas: o `[anexo_1]` está dentro de
// `[inicio_tem_anexo_1]`, e o bloco condicional cai antes de o marcador ser resolvido.
//
// Quando precisar: o caminho é renderizar POR SEGMENTOS — cortar os nós do documento em cada
// marcador, chamar `page.pdf()` uma vez por segmento no MESMO navegador (o `launch` é o caro, ~2,5s;
// o `setContent` de cada segmento é fração disso) e costurar aqui. É determinístico. A alternativa
// — página-sentinela e busca de texto com `pdfjs-dist` — depende de achar o número da página e
// falha calada quando a paginação muda.
