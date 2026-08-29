# Masterplan do Jardim das Gerais (JDG) — geometria RECONSTRUÍDA

⚠️ **Este não é o caminho normal da casa.** Todos os outros masterplans (Vale do Ouro, Villa
Paris, Lagoa Bonita, Recanto do Pará, Vista Alegre) saem de um **SVG do projetista** com um path
por lote rotulado em `inkscape:label`, convertido por `scripts/apolo/masterplan-geometria-*.mjs`.

Para o JDG esse SVG **não existe**. O material entregue era todo raster:

| arquivo | o que é |
|---|---|
| `GBR_JARDIM_V02.cdr` | **vazio** — 11 KB, sem desenho (só o template do Corel) |
| `GBR_JARDIM_V02.pdf` | 1,5 GB, PSD achatado: 820 camadas de imagem, **zero vetor** |
| `GBR_JARDIM_V02.psd` | 1,2 GB, 16 bits, sem máscara vetorial aproveitável |
| `JARDIM DAS GERAIS_MAPA IMPLANTAÇÃO_FASES_*.jpg` | 10000×5626, fundo branco — **é o melhor fundo** |

## O que salvou

O PDF é raster no desenho, mas o **texto é texto**, com coordenada: **46 quadras** (36pt),
**442 lotes** (30pt) e **273 áreas** (20pt). São esses pontos que tornam a reconstrução
assertiva em vez de traçada a olho.

## Por que Voronoi, e não watershed

O watershed persegue contraste, e a divisa do JDG é uma linha de ~3px em verde-água sobre verde,
com árvores desenhadas por cima: ele contornava copa de árvore e cortava o lote atravessado.

Mas lote de loteamento não é mancha, é **fatia** da quadra entre a rua e o fundo — e a divisa
entre dois vizinhos é praticamente a mediatriz entre os centros deles. Isso é exatamente o que o
Voronoi constrói, e ele dá aresta reta por definição, sem depender de enxergar a linha no pixel.
O Voronoi roda **por ilha** (a mancha que as ruas isolam), senão o lote da ponta rouba pixel da
quadra do outro lado da rua.

## Ordem

```
python jdg_prep.py        # máscara de lote + ilhas (quadras)
python jdg_voronoi.py     # recorte dos 442 lotes
python jdg_inventario.py  # quadra/lote/área -> jdg-inventario.csv
python jdg_contornos.py   # -> public/masterplans-telao/jardim-das-gerais-lotes.json
```

Depende de `jdg-spans.json` (texto extraído do PDF via PyMuPDF) e do render `jdg-full.png`.

## O que está aberto

- **436 dos 442 lotes.** Seis caem em quadras que se tocam sem rua no meio (10, 11 e 42) e a
  associação lote→quadra ficou ambígua: `JDG1018`, `JDG1020`, `JDG1101`, `JDG1102`, `JDG4201`,
  `JDG4202`. Eles não pintam no telão até serem conferidos.
- **8 das 46 quadras** não fecham a sequência 01..N — as mesmas 10, 11, 18, 40, 41, 42, 43 e a
  01, que ficou sem lote. Ver a coluna do CSV.
- A geometria é **aproximada**. Quando o SVG do projetista chegar, jogue tudo isto fora e use
  `scripts/apolo/masterplan-geometria-*.mjs`, que é o caminho de verdade.
