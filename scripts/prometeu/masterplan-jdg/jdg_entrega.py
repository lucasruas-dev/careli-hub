"""Fecha a geometria e gera o JSON do telao.

1. Ajuste final por AREA DA CARGA: lote com desvio > 25% e reescalado em torno do proprio
   centroide ate a area esperada (teto de 1,4x no crescimento, sem teto no encolhimento).
   E um ajuste honesto: mantem a forma e o lugar; a borda pode nao cravar a divisa nesses
   poucos, mas a pintura fica no lote certo e proporcional.
2. Transforma para o espaco da arte 4K com o registro por template matching (escala 0,4240,
   duas ancoras com residuo zero) e escreve o JSON no formato do telao.
"""
import cv2, numpy as np, json

SP = r"C:\Users\lucas\AppData\Local\Temp\claude\C--Users-lucas-Documents-Careli-C2x-Sistemas\aa75c3b5-c653-4fdf-b653-625694ef9095\scratchpad"
poly = {k: np.array(v, np.float64) for k, v in json.load(open(SP+r"\jdg-poly-final.json")).items()}
carga = json.load(open(SP+r"\jdg-c2x.json"))
reg = json.load(open(SP+r"\jdg-registro.json"))
area_carga = {r_["name"]: float(r_["area"]) for r_ in carga if r_["area"]}

def area(a): return cv2.contourArea(a.astype(np.float32).reshape(-1,1,2))

esc2 = np.median([area(a)/area_carga[n] for n, a in poly.items() if n in area_carga and area_carga[n] > 0])
ajustados = []
for n, a in list(poly.items()):
    if n not in area_carga or area_carga[n] <= 0: continue
    alvo = area_carga[n] * esc2
    atual = area(a)
    if atual <= 0: continue
    dv = atual/alvo - 1
    if abs(dv) <= 0.25: continue
    f = min(np.sqrt(alvo/atual), 1.4)
    c = a.mean(axis=0)
    poly[n] = (a - c) * f + c
    ajustados.append((n, round(dv*100), round(f, 2)))
print(f"ajustados por area: {len(ajustados)}")
for t in ajustados: print("   ", t)

# QA final
pares = [(area(poly[n]), area_carga[n]) for n in poly if n in area_carga and area_carga[n] > 0]
a2 = np.array(pares, float)
esc3 = np.median(a2[:,0]/a2[:,1])
dv = np.abs(a2[:,0]/esc3 - a2[:,1]) / a2[:,1]
print(f"QA pos-ajuste: correlacao={np.corrcoef(a2[:,0],a2[:,1])[0,1]:.4f} | >20%: {int((dv>0.2).sum())} | >35%: {int((dv>0.35).sum())}")

# para o espaco da arte 4K
e = reg["escala"]; ox, oy = reg["offset"]
saida = {}
for n, a in poly.items():
    pts = a * e + [ox, oy]
    d = "M " + " L ".join(f"{round(x,1)},{round(y,1)}" for x, y in pts) + " Z"
    saida[n] = d
json.dump(saida, open(SP+r"\jdg-lotes-telao.json","w"), separators=(",",":"))
nomes_carga = {r_["name"] for r_ in carga}
print(f"JSON do telao: {len(saida)} lotes | carga coberta: {len(nomes_carga & set(saida))}/{len(nomes_carga)}")
