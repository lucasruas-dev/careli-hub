"""Recorta os lotes por VORONOI dentro de cada quadra.

⚠️ POR QUE VORONOI E NAO WATERSHED. O watershed persegue contraste, e a divisa do JDG e uma
linha de 3px em verde-agua sobre verde, com arvores desenhadas por cima: ele acabava
contornando copa de arvore e cortava o lote atravessado. Mas lote de loteamento nao e uma
mancha - e uma FATIA da quadra, entre a rua e o fundo, e a divisa entre dois lotes vizinhos e
praticamente a mediatriz entre os centros deles. Isso e exatamente o que o Voronoi constroi, e
ele produz aresta RETA por definicao, sem depender de enxergar a linha no pixel.

O Voronoi e calculado POR ILHA (a mancha de quadra que as ruas isolam), senao o lote da ponta
de uma quadra rouba pixel da quadra do outro lado da rua.
"""
import cv2, numpy as np, json, collections

SP = r"C:\Users\lucas\AppData\Local\Temp\claude\C--Users-lucas-Documents-Careli-C2x-Sistemas\aa75c3b5-c653-4fdf-b653-625694ef9095\scratchpad"
spans = json.load(open(SP+r"\jdg-spans.json", encoding="utf-8"))
lab   = np.load(SP+r"\jdg-lab.npy")
mask  = cv2.imread(SP+r"\jdg-mask.png", cv2.IMREAD_GRAYSCALE)
lotes = [s for s in spans if s["size"]==30.0]
H, W = lab.shape

def ilha_de(x, y, r=60):
    viz = lab[max(0,y-r):min(H,y+r), max(0,x-r):min(W,x+r)]
    v = viz[viz>0]
    return int(collections.Counter(v.tolist()).most_common(1)[0][0]) if v.size else 0

por_ilha = collections.defaultdict(list)
for i,l in enumerate(lotes):
    por_ilha[ilha_de(int(l["x"]), int(l["y"]))].append(i)
print("ilhas com lote:", len(por_ilha), "| lotes fora de ilha:", len(por_ilha.get(0,[])))

saida = np.zeros((H,W), np.int32)
for il, idxs in por_ilha.items():
    if il == 0: continue
    ys, xs = np.where(lab == il)
    if ys.size == 0: continue
    y0,y1,x0,x1 = ys.min(), ys.max()+1, xs.min(), xs.max()+1
    sub = (lab[y0:y1, x0:x1] == il)
    # distanceTransform mede distancia ate o ZERO mais proximo: as sementes viram zeros e o
    # rotulo devolvido e o da semente vencedora. Voronoi exato, em uma passada.
    campo = np.ones(sub.shape, np.uint8)*255
    marc  = np.zeros(sub.shape, np.int32)
    for n,i in enumerate(idxs, start=1):
        cx,cy = int(lotes[i]["x"])-x0, int(lotes[i]["y"])-y0
        if 0<=cy<sub.shape[0] and 0<=cx<sub.shape[1]:
            cv2.circle(campo,(cx,cy),3,0,-1); cv2.circle(marc,(cx,cy),3,n,-1)
    # ⚠️ DIST_LABEL_CCOMP, e nao DIST_LABEL_PIXEL. Com PIXEL, cada pixel-zero vira um rotulo
    # proprio - e como a semente e um disco de raio 3, uma semente virava ~29 rotulos distintos
    # e a traducao so acertava um deles: as celulas saiam com 1 pixel de area. CCOMP rotula o
    # DISCO INTEIRO como um componente, que e o que "uma semente" significa aqui.
    _, lb = cv2.distanceTransformWithLabels(campo, cv2.DIST_L2, 5, labelType=cv2.DIST_LABEL_CCOMP)
    trad = np.zeros(int(lb.max())+1, np.int32)
    for n,i in enumerate(idxs, start=1):
        cx,cy = int(lotes[i]["x"])-x0, int(lotes[i]["y"])-y0
        if 0<=cy<lb.shape[0] and 0<=cx<lb.shape[1]:
            trad[lb[cy,cx]] = i+2
    cel = trad[lb]
    cel[~sub] = 0
    saida[y0:y1, x0:x1] = np.where(cel>0, cel, saida[y0:y1, x0:x1])

np.save(SP+r"\jdg-vor.npy", saida)
ar = collections.Counter(saida[saida>1].ravel().tolist())
v = sorted(ar.values())
print("celulas:", len(ar), "| area px: min %d mediana %d max %d" % (v[0], v[len(v)//2], v[-1]))
print("lotes sem celula:", sum(1 for i in range(len(lotes)) if (i+2) not in ar))
