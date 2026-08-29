"""Le o numero de cada circulo preto: separa os digitos, agrupa por forma, gera um mosaico com
um representante por grupo para leitura visual. A fonte e unica, entao os grupos sao poucos."""
import cv2, numpy as np, json, collections

SP = r"C:\Users\lucas\AppData\Local\Temp\claude\C--Users-lucas-Documents-Careli-C2x-Sistemas\aa75c3b5-c653-4fdf-b653-625694ef9095\scratchpad"
img = cv2.imdecode(np.fromfile(r"C:\Users\lucas\Downloads\GBR_JARDIM_V02-Recuperado-Recuperado.png", np.uint8), cv2.IMREAD_COLOR)
H, W = img.shape[:2]
B,G,R = img[:,:,0].astype(np.int16), img[:,:,1].astype(np.int16), img[:,:,2].astype(np.int16)
mx = np.maximum(np.maximum(B,G),R); mn = np.minimum(np.minimum(B,G),R)

preto = ((mx < 80) & ~((G > R + 8) & (G > B + 8))).astype(np.uint8)
preto = cv2.morphologyEx(preto, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE,(7,7)))
n, l, stats, cent = cv2.connectedComponentsWithStats(preto, connectivity=8)
circ = []
for i in range(1, n):
    a = stats[i, cv2.CC_STAT_AREA]; w_, h_ = stats[i, cv2.CC_STAT_WIDTH], stats[i, cv2.CC_STAT_HEIGHT]
    if not (1200 < a < 12000): continue
    if w_ > 130 or h_ > 130: continue
    if abs(w_ - h_) > 0.35 * max(w_, h_): continue
    if a < 0.6 * (3.14159/4) * w_ * h_: continue
    circ.append((float(cent[i][0]), float(cent[i][1]), int(stats[i, cv2.CC_STAT_LEFT]), int(stats[i, cv2.CC_STAT_TOP]), int(w_), int(h_)))
print("circulos:", len(circ))

# dentro de cada circulo, o texto e BRANCO: recorta, binariza, separa digitos por coluna
digitos, donos = [], []   # imagem 20x28 normalizada, e (idx do circulo, posicao do digito)
for k,(cx, cy, x0, y0, w_, h_) in enumerate(circ):
    rec = img[y0:y0+h_, x0:x0+w_]
    m2 = (rec.min(axis=2) > 190).astype(np.uint8)
    # limpa borda: só o miolo do circulo
    msk = np.zeros((h_, w_), np.uint8)
    cv2.circle(msk, (w_//2, h_//2), int(min(w_,h_)*0.42), 1, -1)
    m2 &= msk
    nn, ll, st2, _ = cv2.connectedComponentsWithStats(m2, connectivity=8)
    comps = [i for i in range(1, nn) if st2[i, cv2.CC_STAT_AREA] > 40 and st2[i, cv2.CC_STAT_HEIGHT] > h_*0.2]
    comps.sort(key=lambda i: st2[i, cv2.CC_STAT_LEFT])
    for pos, i in enumerate(comps[:2]):
        xx, yy, ww, hh = st2[i, cv2.CC_STAT_LEFT], st2[i, cv2.CC_STAT_TOP], st2[i, cv2.CC_STAT_WIDTH], st2[i, cv2.CC_STAT_HEIGHT]
        g = (ll[yy:yy+hh, xx:xx+ww] == i).astype(np.uint8)*255
        digitos.append(cv2.resize(g, (20, 28), interpolation=cv2.INTER_AREA))
        donos.append((k, pos, len(comps[:2])))
print("digitos extraidos:", len(digitos))

# agrupa por correlacao
reps, rotulo = [], []
for d in digitos:
    best, bi = -1, -1
    for j, r_ in enumerate(reps):
        c = cv2.matchTemplate(d.astype(np.float32), r_.astype(np.float32), cv2.TM_CCOEFF_NORMED)[0][0]
        if c > best: best, bi = c, j
    if best > 0.82: rotulo.append(bi)
    else: reps.append(d); rotulo.append(len(reps)-1)
print("grupos de digito:", len(reps))
mos = np.hstack([cv2.copyMakeBorder(cv2.resize(r_, (40,56), interpolation=cv2.INTER_NEAREST), 20,4,4,4, cv2.BORDER_CONSTANT, value=0) for r_ in reps])
mos = cv2.cvtColor(mos, cv2.COLOR_GRAY2BGR)
for j in range(len(reps)):
    cv2.putText(mos, str(j), (j*48+6, 16), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (0,255,255), 1)
cv2.imwrite(SP+r"\digitos.png", mos)
json.dump({"circulos": circ, "donos": donos, "rotulo": rotulo}, open(SP+r"\jdg-digitos.json","w"))
print("salvo digitos.png (mosaico) e jdg-digitos.json")
