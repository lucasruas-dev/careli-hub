"""Funde ao lote as celulas-fantasma que sao enclave dele.

A fantasma existe para absorver area SEM dono (institucional, canteiro). Quando ela nasce
DENTRO de um lote comprido (o numero fica na frente; o fundo do lote fica longe da zona de
exclusao), ela rouba o fundo do lote. Enclave se reconhece pelo contato: fantasma cujo
perimetro toca majoritariamente UM unico lote e dele; a legitima toca varios lotes e a borda.
"""
import cv2, numpy as np, json, collections

SP = r"C:\Users\lucas\AppData\Local\Temp\claude\C--Users-lucas-Documents-Careli-C2x-Sistemas\aa75c3b5-c653-4fdf-b653-625694ef9095\scratchpad"
marc = np.load(SP+r"\jdg-marc.npy")
sementes = json.load(open(SP+r"\jdg-sementes-final.json"))
carga = json.load(open(SP+r"\jdg-c2x.json"))
H, W = marc.shape
area_carga = {r_["name"]: float(r_["area"]) for r_ in carga if r_["area"]}

fundo = (marc == 1).astype(np.uint8)
ncomp, comp, stats, _ = cv2.connectedComponentsWithStats(fundo, connectivity=4)
ordem = np.argsort(-stats[1:, cv2.CC_STAT_AREA]) + 1
externo = ordem[0]   # o maior componente de rotulo 1 e o mundo externo
fundidos = 0
for i in range(1, ncomp):
    if i == externo: continue
    a = stats[i, cv2.CC_STAT_AREA]
    if a < 50 or a > 60000: continue
    x0,y0 = stats[i,cv2.CC_STAT_LEFT], stats[i,cv2.CC_STAT_TOP]
    w_,h_ = stats[i,cv2.CC_STAT_WIDTH], stats[i,cv2.CC_STAT_HEIGHT]
    X0,Y0 = max(0,x0-6), max(0,y0-6)
    X1,Y1 = min(W,x0+w_+6), min(H,y0+h_+6)
    m = (comp[Y0:Y1, X0:X1] == i).astype(np.uint8)
    d = cv2.dilate(m, cv2.getStructuringElement(cv2.MORPH_ELLIPSE,(7,7)))
    viz = marc[Y0:Y1, X0:X1][(d>0) & (m==0)]
    viz = viz[viz > 1]                      # so lotes reais contam
    if viz.size == 0: continue
    cont = collections.Counter(viz.tolist())
    dono, toques = cont.most_common(1)[0]
    if toques / viz.size >= 0.65:
        marc[Y0:Y1, X0:X1][m > 0] = dono
        fundidos += 1
print("enclaves fundidos:", fundidos)

def poligono(m, off):
    cs,_ = cv2.findContours(m.astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not cs: return None
    c = max(cs, key=cv2.contourArea)
    ap = cv2.approxPolyDP(c, 0.006*cv2.arcLength(c, True), True).reshape(-1,2) + off
    return ap if len(ap) >= 3 else None

resultado, area_pol = {}, {}
for n, s_ in enumerate(sementes, start=2):
    ys, xs = np.where(marc == n)
    if ys.size == 0: continue
    y0,y1,x0,x1 = max(0,ys.min()-10), min(H,ys.max()+10), max(0,xs.min()-10), min(W,xs.max()+10)
    p = poligono(marc[y0:y1, x0:x1] == n, np.array([x0,y0]))
    if p is None: continue
    resultado[s_["nome"]] = p
    area_pol[s_["nome"]] = cv2.contourArea(p.reshape(-1,1,2).astype(np.int32))

nomes_carga = {r_["name"] for r_ in carga}
print(f"QA carga: {len(nomes_carga & set(resultado))}/{len(nomes_carga)}")
pares_qa = [(area_pol[n], area_carga[n]) for n in resultado if n in area_carga and area_carga[n] > 0]
a = np.array(pares_qa, float)
print(f"QA area: correlacao = {np.corrcoef(a[:,0], a[:,1])[0,1]:.4f}")
esc = np.median(a[:,0]/a[:,1])
dv = np.abs(a[:,0]/esc - a[:,1]) / a[:,1]
for lim in (0.1, 0.2, 0.35):
    print(f"    desvio > {int(lim*100)}%: {int((dv>lim).sum())}")
nomes_sel = [n for n in resultado if n in area_carga and area_carga[n] > 0]
for d_, n in sorted(zip(dv, nomes_sel), reverse=True)[:6]:
    print(f"    {n}: {d_*100:.0f}%")
json.dump({k: v.tolist() for k,v in resultado.items()}, open(SP+r"\jdg-poly-final.json","w"))
np.save(SP+r"\jdg-marc.npy", marc)
print("salvo")
