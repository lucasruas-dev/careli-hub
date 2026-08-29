"""POLIMENTO da geometria: bordas limpas, bola vermelha por baixo do lote com furo, bola preta
furada. Parte do campo de marcadores FINAL (pos-watershed, pos-reparos) - so refaz o desenho.

O que o zoom do Lucas mostrou (29/08, print):
  1. a bola VERMELHA da quadra era MURALHA no watershed, entao a celula a contornava - e o
     contorno virava um octogono serrilhado horroroso em volta dela. Correcao: a celula ENGOLE
     o circulo vermelho encostado (fecha a concavidade) e ele vira FURO evenodd, como as pretas;
  2. borda pixelada do watershed - suavizacao (mediana) antes do contorno + epsilon maior;
  3. (do SVG de conferencia) rgba() nao e SVG puro - visualizador que nao entende pinta PRETO.
     Cor via fill + fill-opacity.
"""
import cv2, numpy as np, json, collections

SP = r"C:\Users\lucas\AppData\Local\Temp\claude\C--Users-lucas-Documents-Careli-C2x-Sistemas\aa75c3b5-c653-4fdf-b653-625694ef9095\scratchpad"
img = cv2.imdecode(np.fromfile(r"C:\Users\lucas\Downloads\GBR_JARDIM_V02-Recuperado-Recuperado.png", np.uint8), cv2.IMREAD_COLOR)
marc = np.load(SP+r"\jdg-marc.npy")
sementes = json.load(open(SP+r"\jdg-sementes-final.json"))
carga = json.load(open(SP+r"\jdg-c2x.json"))
d = json.load(open(SP+r"\jdg-digitos.json")); circ = d["circulos"]
nm = json.load(open(SP+r"\jdg-nomes.json")); numeros, atrib = nm["numeros"], nm["atrib"]
reg = json.load(open(SP+r"\jdg-registro.json"))
H, W = marc.shape
B,G,R = img[:,:,0].astype(np.int16), img[:,:,1].astype(np.int16), img[:,:,2].astype(np.int16)
area_carga = {r_["name"]: float(r_["area"]) for r_ in carga if r_["area"]}

# BOLAS VERMELHAS: componentes circulares da mascara vermelha, com centro e raio
verm = ((R > 150) & (G < 90) & (B < 90)).astype(np.uint8)
verm = cv2.morphologyEx(verm, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE,(7,7)))
nv, lv, sv, cv_ = cv2.connectedComponentsWithStats(verm, connectivity=8)
bolas_verm = []
for i in range(1, nv):
    a = sv[i, cv2.CC_STAT_AREA]; w_, h_ = sv[i, cv2.CC_STAT_WIDTH], sv[i, cv2.CC_STAT_HEIGHT]
    if 2000 < a < 22000 and abs(w_-h_) <= 0.35*max(w_,h_):
        bolas_verm.append((float(cv_[i][0]), float(cv_[i][1]), max(w_,h_)/2 + 3))
print("bolas vermelhas:", len(bolas_verm))

# BOLAS PRETAS por lote (mesma logica do jdg_furos, com a reatribuicao do 0918 e as cravadas)
furo_de = {}
for k, num in numeros.items():
    cx, cy, _x0, _y0, w_, h_ = circ[int(k)]
    nome = f"JDG{atrib[str(k)]}{num.zfill(2)}"
    if nome == "JDG1018" and abs(cx - 4595) < 60 and abs(cy - 2275) < 60:
        nome = "JDG0918"
    furo_de[nome] = (cx, cy, max(w_, h_)/2 + 3)
furo_de["JDG0920"] = (4650, 2150, 36)
furo_de["JDG0919"] = (4665, 2295, 36)

def poligono_limpo(m, off):
    # mediana tira o serrilhado do watershed sem mover a borda; o epsilon 0.010 endireita as
    # retas (as divisas SAO retas; vertice de sobra e ruido, nao informacao)
    mm = cv2.medianBlur(m.astype(np.uint8)*255, 9)
    cs,_ = cv2.findContours(mm, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not cs: return None
    c = max(cs, key=cv2.contourArea)
    ap = cv2.approxPolyDP(c, 0.010*cv2.arcLength(c, True), True).reshape(-1,2) + off
    return ap if len(ap) >= 3 else None

resultado, furos = {}, {}
for n, s_ in enumerate(sementes, start=2):
    ys, xs = np.where(marc == n)
    if ys.size == 0: continue
    y0,y1,x0,x1 = max(0,ys.min()-16), min(H,ys.max()+16), max(0,xs.min()-16), min(W,xs.max()+16)
    m = (marc[y0:y1, x0:x1] == n).astype(np.uint8)
    meus_furos = []
    # bola vermelha ENCOSTADA na celula: engole (fecha a concavidade) e vira furo
    for bx, by, br in bolas_verm:
        if not (x0-br < bx < x1+br and y0-br < by < y1+br): continue
        disco = np.zeros_like(m)
        cv2.circle(disco, (int(bx-x0), int(by-y0)), int(br+4), 1, -1)
        toque = cv2.dilate(m, cv2.getStructuringElement(cv2.MORPH_ELLIPSE,(9,9)))
        if (disco & toque).sum() > 0.25 * disco.sum():
            m |= disco
            meus_furos.append((bx, by, br))
    f = furo_de.get(s_["nome"])
    if f: meus_furos.append(f)
    p = poligono_limpo(m, np.array([x0,y0]))
    if p is None: continue
    resultado[s_["nome"]] = p.astype(np.float64)
    furos[s_["nome"]] = meus_furos

# ajuste final por area da carga, COM CLIP CONTRA OS VIZINHOS. Escalar um poligono para cima
# invade o vizinho (o QA global pegou 20 sobreposicoes); o campo do watershed e disjunto por
# construcao, entao a POSSE original manda: o que cresceu e cair em cima de outro lote e
# recortado fora, rasterizando na vizinhanca.
def area(a): return cv2.contourArea(a.astype(np.float32).reshape(-1,1,2))
esc2 = np.median([area(a)/area_carga[nn] for nn, a in resultado.items() if nn in area_carga and area_carga[nn] > 0])
originais = {nn: a.copy() for nn, a in resultado.items()}
for nn, a in list(resultado.items()):
    if nn not in area_carga or area_carga[nn] <= 0: continue
    dv = area(a)/(area_carga[nn]*esc2) - 1
    if abs(dv) <= 0.25: continue
    f2 = min(np.sqrt((area_carga[nn]*esc2)/area(a)), 1.4)
    c2 = a.mean(axis=0)
    novo = (a - c2) * f2 + c2
    if f2 > 1.0:
        # rasteriza o candidato e subtrai os vizinhos originais que ele tocar
        x0, y0 = novo.min(axis=0) - 8; x1, y1 = novo.max(axis=0) + 8
        x0, y0, x1, y1 = int(x0), int(y0), int(x1), int(y1)
        mcand = np.zeros((y1-y0, x1-x0), np.uint8)
        cv2.fillPoly(mcand, [np.round(novo - [x0,y0]).astype(np.int32)], 255)
        for viz, b in originais.items():
            if viz == nn: continue
            if b[:,0].max() < x0 or b[:,0].min() > x1 or b[:,1].max() < y0 or b[:,1].min() > y1: continue
            cv2.fillPoly(mcand, [np.round(b - [x0,y0]).astype(np.int32)], 0)
        mcand = cv2.medianBlur(mcand, 5)
        cs,_ = cv2.findContours(mcand, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        if cs:
            c3 = max(cs, key=cv2.contourArea)
            ap = cv2.approxPolyDP(c3, 0.010*cv2.arcLength(c3, True), True).reshape(-1,2)
            if len(ap) >= 3: novo = ap.astype(np.float64) + [x0, y0]
    resultado[nn] = novo

pares = [(area(resultado[nn]), area_carga[nn]) for nn in resultado if nn in area_carga and area_carga[nn] > 0]
a2 = np.array(pares, float)
esc3 = np.median(a2[:,0]/a2[:,1]); dv = np.abs(a2[:,0]/esc3 - a2[:,1]) / a2[:,1]
print(f"QA: correlacao={np.corrcoef(a2[:,0],a2[:,1])[0,1]:.4f} | >20%: {int((dv>0.2).sum())} | >35%: {int((dv>0.35).sum())}")
vtx = [len(v) for v in resultado.values()]
print(f"vertices por lote: mediana {sorted(vtx)[len(vtx)//2]} max {max(vtx)}")

# JSON do telao (espaco 4K) com furos evenodd
e = reg["escala"]; ox, oy = reg["offset"]
saida = {}
for nn, a in resultado.items():
    pts = a * e + [ox, oy]
    dpath = "M " + " L ".join(f"{round(x,1)},{round(y,1)}" for x, y in pts) + " Z"
    for fx, fy, fr in furos.get(nn, []):
        cx2, cy2, r2 = round(fx*e+ox,1), round(fy*e+oy,1), round(fr*e,1)
        dpath += f" M {cx2-r2},{cy2} A {r2},{r2} 0 1 0 {cx2+r2},{cy2} A {r2},{r2} 0 1 0 {cx2-r2},{cy2} Z"
    saida[nn] = dpath
json.dump(saida, open(SP+r"\jdg-lotes-telao.json","w"), separators=(",",":"))
nomes_carga = {r_["name"] for r_ in carga}
print(f"JSON: {len(saida)} lotes | carga: {len(nomes_carga & set(saida))}/{len(nomes_carga)}")
