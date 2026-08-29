"""Reparo dirigido pos-watershed, usando a AREA DA CARGA como verdade.

Dois defeitos sobreviveram ao watershed global, ambos causados pelo bosque desenhado por cima
das divisas:
  1. PAR gordo+magro: a divisa entre dois vizinhos sumiu sob as arvores e um comeu o outro.
     Conserto: uniao das duas celulas, corte perpendicular ao eixo principal, na posicao que
     divide a area na PROPORCAO da carga. O contorno externo da uniao (que esta certo) e
     preservado.
  2. PRESO: o lote coberto de bosque prendeu a agua, e as fantasmas ficaram com o gramado.
     Conserto: devolver ao lote as celulas FANTASMA adjacentes, limitado ao raio da area
     esperada - fantasma legitima (area institucional) fica onde esta.
"""
import cv2, numpy as np, json, collections

SP = r"C:\Users\lucas\AppData\Local\Temp\claude\C--Users-lucas-Documents-Careli-C2x-Sistemas\aa75c3b5-c653-4fdf-b653-625694ef9095\scratchpad"
marc = np.load(SP+r"\jdg-marc.npy")
sementes = json.load(open(SP+r"\jdg-sementes-final.json"))
carga = json.load(open(SP+r"\jdg-c2x.json"))
H, W = marc.shape
area_carga = {r_["name"]: float(r_["area"]) for r_ in carga if r_["area"]}
nome_de = {n+2: s["nome"] for n, s in enumerate(sementes)}
rotulo_de = {v: k for k, v in nome_de.items()}

areas_px = collections.Counter(marc[marc > 1].ravel().tolist())
ESCALA = 9.49

def desvio(nome):
    r_ = rotulo_de[nome]
    if nome not in area_carga: return 0.0
    esperado = area_carga[nome] * ESCALA
    return (areas_px.get(r_, 0) - esperado) / esperado

def caixa(r_, folga=40):
    ys, xs = np.where(marc == r_)
    return max(0,ys.min()-folga), min(H,ys.max()+folga), max(0,xs.min()-folga), min(W,xs.max()+folga)

def adjacentes(r_):
    y0,y1,x0,x1 = caixa(r_, 8)
    m = (marc[y0:y1, x0:x1] == r_).astype(np.uint8)
    d = cv2.dilate(m, cv2.getStructuringElement(cv2.MORPH_ELLIPSE,(9,9)))
    viz = marc[y0:y1, x0:x1][(d > 0) & (m == 0)]
    return collections.Counter(viz[viz > 1].tolist())

# 1. PARES gordo+magro adjacentes, mesma quadra
reparados = []
candidatos = [n for n in rotulo_de if n in area_carga and abs(desvio(n)) > 0.25]
feitos = set()
for nome in sorted(candidatos, key=lambda n: -desvio(n)):
    if nome in feitos or desvio(nome) < 0.25: continue
    r_ = rotulo_de[nome]
    for viz_r, _cnt in adjacentes(r_).most_common():
        viz_nome = nome_de.get(viz_r)
        if not viz_nome or viz_nome[:5] != nome[:5] or viz_nome in feitos: continue
        if viz_nome not in area_carga or desvio(viz_nome) > -0.25: continue
        # uniao e corte proporcional
        y0 = min(caixa(r_)[0], caixa(viz_r)[0]); y1 = max(caixa(r_)[1], caixa(viz_r)[1])
        x0 = min(caixa(r_)[2], caixa(viz_r)[2]); x1 = max(caixa(r_)[3], caixa(viz_r)[3])
        jan = marc[y0:y1, x0:x1]
        uni = (jan == r_) | (jan == viz_r)
        ys, xs = np.where(uni)
        pts = np.column_stack([xs, ys]).astype(np.float32)
        media = pts.mean(axis=0)
        _, _, vt = np.linalg.svd(pts - media, full_matrices=False)
        eixo = vt[0]                       # direcao do eixo longo da uniao
        proj = (pts - media) @ eixo
        # ordena as projecoes; separa na fracao de area esperada, do lado onde esta cada semente
        sa = next(s_ for s_ in sementes if s_["nome"] == nome)
        sb = next(s_ for s_ in sementes if s_["nome"] == viz_nome)
        pa = (np.array([sa["x"]-x0, sa["y"]-y0]) - media) @ eixo
        pb = (np.array([sb["x"]-x0, sb["y"]-y0]) - media) @ eixo
        fa = area_carga[nome] / (area_carga[nome] + area_carga[viz_nome])
        corte = np.quantile(proj, fa if pa < pb else 1 - fa)
        lado_a = proj <= corte if pa < pb else proj > corte
        jan[ys[lado_a], xs[lado_a]] = r_
        jan[ys[~lado_a], xs[~lado_a]] = viz_r
        areas_px[r_] = int(lado_a.sum()); areas_px[viz_r] = int((~lado_a).sum())
        feitos.add(nome); feitos.add(viz_nome)
        reparados.append((nome, viz_nome))
        break
print("pares redivididos pela area da carga:", len(reparados), reparados)

# 2. PRESOS: devolve celulas fantasma adjacentes ate a area esperada
presos = [n for n in rotulo_de if n in area_carga and desvio(n) < -0.3 and n not in feitos]
soltos = []
for nome in presos:
    r_ = rotulo_de[nome]
    esperado = area_carga[nome] * ESCALA
    s_ = next(x for x in sementes if x["nome"] == nome)
    raio = int(np.sqrt(esperado / 3.14159) * 2.2)
    y0,y1,x0,x1 = max(0,int(s_["y"])-raio), min(H,int(s_["y"])+raio), max(0,int(s_["x"])-raio), min(W,int(s_["x"])+raio)
    jan = marc[y0:y1, x0:x1]
    antes = areas_px.get(r_, 0)
    # celulas fantasma (rotulo 1) conectadas ao lote dentro da janela
    m = (jan == r_).astype(np.uint8)
    fantasma = (jan == 1).astype(np.uint8)
    for _ in range(6):
        if areas_px.get(r_, 0) >= esperado * 0.85: break
        d = cv2.dilate(m, cv2.getStructuringElement(cv2.MORPH_ELLIPSE,(13,13)))
        ganho = (d > 0) & (fantasma > 0)
        if not ganho.any(): break
        jan[ganho] = r_
        m = (jan == r_).astype(np.uint8)
        fantasma = (jan == 1).astype(np.uint8)
        areas_px[r_] = int((marc == r_).sum())
    soltos.append((nome, antes, areas_px.get(r_, 0), int(esperado)))
print("presos alimentados por fantasmas:")
for t in soltos: print("   ", t)

# poligonos finais + QA
def poligono(m, off):
    cs,_ = cv2.findContours(m.astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not cs: return None
    c = max(cs, key=cv2.contourArea)
    ap = cv2.approxPolyDP(c, 0.006*cv2.arcLength(c, True), True).reshape(-1,2) + off
    return ap if len(ap) >= 3 else None

resultado, area_pol = {}, {}
for n, s_ in enumerate(sementes, start=2):
    y0,y1,x0,x1 = caixa(n, 10)
    m = (marc[y0:y1, x0:x1] == n)
    if not m.any(): continue
    p = poligono(m, np.array([x0,y0]))
    if p is None: continue
    resultado[s_["nome"]] = p
    area_pol[s_["nome"]] = cv2.contourArea(p.reshape(-1,1,2).astype(np.int32))

nomes_carga = {r_["name"] for r_ in carga}
print(f"\nQA carga: {len(nomes_carga & set(resultado))}/{len(nomes_carga)}")
pares_qa = [(area_pol[n], area_carga[n]) for n in resultado if n in area_carga and area_carga[n] > 0]
a = np.array(pares_qa, float)
corr = np.corrcoef(a[:,0], a[:,1])[0,1]
esc = np.median(a[:,0]/a[:,1])
dv = np.abs(a[:,0]/esc - a[:,1]) / a[:,1]
print(f"QA area: correlacao = {corr:.4f} | escala = {esc:.2f}")
for lim in (0.1, 0.2, 0.35):
    print(f"    desvio > {int(lim*100)}%: {int((dv>lim).sum())}")
nomes_sel = [n for n in resultado if n in area_carga and area_carga[n] > 0]
for d_, n in sorted(zip(dv, nomes_sel), reverse=True)[:8]:
    print(f"    {n}: {d_*100:.0f}%")
json.dump({k: v.tolist() for k,v in resultado.items()}, open(SP+r"\jdg-poly-final.json","w"))
np.save(SP+r"\jdg-marc.npy", marc)
print("salvo")
