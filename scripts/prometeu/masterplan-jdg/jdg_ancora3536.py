"""Corrige o deslocamento sistematico da leitura de regua nas q35/q36, ancorando nos centros
EXATOS dos circulos (do detector): delta mediano por quadra move os quads; o furo vira o
centro verdadeiro."""
import json, re, numpy as np

SP = r"C:\Users\lucas\AppData\Local\Temp\claude\C--Users-lucas-Documents-Careli-C2x-Sistemas\aa75c3b5-c653-4fdf-b653-625694ef9095\scratchpad"
lotes = json.load(open(SP+r"\jdg-lotes-telao.json"))
d = json.load(open(SP+r"\jdg-digitos.json")); circ = d["circulos"]
nm = json.load(open(SP+r"\jdg-nomes.json")); numeros, atrib = nm["numeros"], nm["atrib"]
E, OX, OY = 0.4240, -107.0, -316.4

centro = {}
for k, num in numeros.items():
    nome = f"JDG{atrib[str(k)]}{num.zfill(2)}"
    cx, cy = circ[int(k)][0]*E+OX, circ[int(k)][1]*E+OY
    centro[nome] = (cx, cy)

def partes(dpath):
    cont, furo = None, None
    for s in [x for x in dpath.split("M ") if x.strip()]:
        if " A " in s:
            m = re.findall(r"[-\d.]+", s); furo = (float(m[0])+float(m[2]), float(m[1]), float(m[2]))
        else:
            cont = np.array([[float(a) for a in par.split(",")] for par in re.findall(r"[-\d.]+,[-\d.]+", s)])
    return cont, furo

for q in ("35","36"):
    nomes = [n for n in lotes if n[3:5] == q]
    deltas = []
    for n in nomes:
        if n not in centro: continue
        _, furo = partes(lotes[n])
        if furo: deltas.append((centro[n][0]-furo[0], centro[n][1]-furo[1]))
    dx = float(np.median([t[0] for t in deltas])); dy = float(np.median([t[1] for t in deltas]))
    print(f"q{q}: delta mediano ({dx:+.1f},{dy:+.1f}) 4K, {len(deltas)} ancoras")
    for n in nomes:
        cont, furo = partes(lotes[n])
        cont = cont + [dx, dy]
        dnew = "M " + " L ".join(f"{round(x,1)},{round(y,1)}" for x,y in cont) + " Z"
        cx, cy = centro.get(n, (furo[0]+dx, furo[1]+dy))
        r = 14.0
        dnew += f" M {round(cx-r,1)},{round(cy,1)} A {r},{r} 0 1 0 {round(cx+r,1)},{round(cy,1)} A {r},{r} 0 1 0 {round(cx-r,1)},{round(cy,1)} Z"
        lotes[n] = dnew
json.dump(lotes, open(SP+r"\jdg-lotes-telao.json","w"), separators=(",",":"))
print("salvo")
