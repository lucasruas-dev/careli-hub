"""QA geometrico do masterplan inteiro: sobreposicao entre lotes, furo fora do lote,
poligono degenerado. Rasteriza cada poligono e mede intersecoes par a par (sem shapely)."""
import cv2, numpy as np, json, re, itertools, collections

SP = r"C:\Users\lucas\AppData\Local\Temp\claude\C--Users-lucas-Documents-Careli-C2x-Sistemas\aa75c3b5-c653-4fdf-b653-625694ef9095\scratchpad"
lotes = json.load(open(SP+r"\jdg-lotes-telao.json"))
carga = {r_["name"] for r_ in json.load(open(SP+r"\jdg-c2x.json"))}

def contorno(dpath):
    s = [x for x in dpath.split("M ") if x.strip() and " A " not in x][0]
    return np.array([[float(a) for a in par.split(",")] for par in re.findall(r"[-\d.]+,[-\d.]+", s)], np.float64)

def furos(dpath):
    out = []
    for s in dpath.split("M "):
        if " A " not in s: continue
        m = re.findall(r"[-\d.]+", s)
        x0, y0, r = float(m[0]), float(m[1]), float(m[2])
        out.append((x0 + r, y0, r))
    return out

polys = {n: contorno(d) for n, d in lotes.items()}
# rasterizacao global em 1/2 escala para medir sobreposicao
S = 2
canvas = {}
contagem = np.zeros((2160//S, 3840//S), np.uint8)
ids = np.zeros((2160//S, 3840//S), np.int32)
nomes = sorted(polys)
for i, n in enumerate(nomes, start=1):
    m = np.zeros((2160//S, 3840//S), np.uint8)
    cv2.fillPoly(m, [np.round(polys[n]/S).astype(np.int32)], 1)
    canvas[n] = m
    contagem += m
    ids[m > 0] = i

sobre = np.argwhere(contagem >= 2)
pares = collections.Counter()
if len(sobre):
    # para cada pixel sobreposto, descubro os pares dominantes por vizinhanca (aproximacao rapida)
    for n in nomes:
        m = canvas[n]
        inter = (m > 0) & (contagem >= 2)
        if inter.sum() > 30:   # >30px em 1/2 escala = ~120px2 reais
            pares[n] = int(inter.sum())
print("lotes com sobreposicao significativa (px 1/2-escala):")
suspeitos = dict(pares.most_common(20))
print(suspeitos if suspeitos else "  nenhum")

# furo fora do lote / poligono degenerado
ruins_furo, degenerados = [], []
for n, d in lotes.items():
    p = polys[n]
    a = cv2.contourArea(p.astype(np.float32).reshape(-1,1,2))
    if a < 200: degenerados.append(n)
    for fx, fy, fr in furos(d):
        if cv2.pointPolygonTest(p.astype(np.float32).reshape(-1,1,2), (fx, fy), True) < -fr*0.5:
            ruins_furo.append((n, round(fx), round(fy)))
print("degenerados:", degenerados)
print("furo caindo fora do lote:", ruins_furo[:10], f"({len(ruins_furo)} no total)")
json.dump({"sobrepostos": suspeitos, "furos_fora": [f[0] for f in ruins_furo]}, open(SP+r"\jdg-qa-geo.json","w"))
