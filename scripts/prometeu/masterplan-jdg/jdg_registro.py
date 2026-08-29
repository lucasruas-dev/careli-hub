"""Acha a transformacao (escala + deslocamento) da imagem-mestre 10000x5626 para a arte 4K
do telao, por template matching multi-escala de tres recortes distintos. Tres ancoras
independentes concordando = registro confiavel."""
import cv2, numpy as np, json

SP = r"C:\Users\lucas\AppData\Local\Temp\claude\C--Users-lucas-Documents-Careli-C2x-Sistemas\aa75c3b5-c653-4fdf-b653-625694ef9095\scratchpad"
big = cv2.imdecode(np.fromfile(r"C:\Users\lucas\Downloads\GBR_JARDIM_V02-Recuperado-Recuperado.png", np.uint8), cv2.IMREAD_COLOR)
art = cv2.imdecode(np.fromfile(r"C:\Users\lucas\Downloads\Masterplan Jardim das Gerais (4).png", np.uint8), cv2.IMREAD_COLOR)
gb = cv2.cvtColor(big, cv2.COLOR_BGR2GRAY); ga = cv2.cvtColor(art, cv2.COLOR_BGR2GRAY)

# ancoras: rotatoria central, ponta direita, ponta esquerda (regioes com estrutura unica)
ANCORAS = [(3000, 2350, 700), (4400, 2100, 600), (1300, 1500, 600)]
achados = []
for cx, cy, r in ANCORAS:
    patch = gb[cy-r//2:cy+r//2, cx-r//2:cx+r//2]
    melhor = None
    for esc1000 in range(300, 460, 4):
        e = esc1000/1000.0
        pw = int(patch.shape[1]*e); ph = int(patch.shape[0]*e)
        if pw < 40 or pw > ga.shape[1]: continue
        pt = cv2.resize(patch, (pw, ph), interpolation=cv2.INTER_AREA)
        res = cv2.matchTemplate(ga, pt, cv2.TM_CCOEFF_NORMED)
        _, mv, _, ml = cv2.minMaxLoc(res)
        if melhor is None or mv > melhor[0]:
            melhor = (mv, e, ml[0] + pw/2 - 0, ml[1] + ph/2)
    mv, e, ax, ay = melhor
    achados.append({"conf": round(mv,3), "esc": e, "big": [cx, cy], "art": [ax, ay]})
    print(f"ancora ({cx},{cy}): conf={mv:.3f} escala={e:.3f} -> art ({ax:.0f},{ay:.0f})")

escs = [a["esc"] for a in achados if a["conf"] > 0.5]
if len(escs) >= 2:
    esc = float(np.median([a["esc"] for a in achados]))
    # resolve o deslocamento com a escala consensual: art = big*esc + off
    offs = [(a["art"][0] - a["big"][0]*esc, a["art"][1] - a["big"][1]*esc) for a in achados if a["conf"] > 0.5]
    ox = float(np.median([o[0] for o in offs])); oy = float(np.median([o[1] for o in offs]))
    # residuo de cada ancora
    for a in achados:
        rx = a["big"][0]*esc + ox - a["art"][0]; ry = a["big"][1]*esc + oy - a["art"][1]
        print(f"  residuo ({a['big']}): {rx:+.1f},{ry:+.1f}px")
    json.dump({"escala": esc, "offset": [ox, oy]}, open(SP+r"\jdg-registro.json","w"))
    print(f"registro: escala={esc:.4f} offset=({ox:.1f},{oy:.1f})")
else:
    print("REGISTRO FRACO - conferir ancoras")
