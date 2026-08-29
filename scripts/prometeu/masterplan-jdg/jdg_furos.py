"""Adiciona a cada lote o FURO do circulo do numero (subpath circular + fill-rule evenodd,
padrao do Villa Paris): a pintura contorna a bola preta e o numero continua legivel."""
import json, numpy as np, re

SP = r"C:\Users\lucas\AppData\Local\Temp\claude\C--Users-lucas-Documents-Careli-C2x-Sistemas\aa75c3b5-c653-4fdf-b653-625694ef9095\scratchpad"
lotes = json.load(open(SP+r"\jdg-lotes-telao.json"))
d = json.load(open(SP+r"\jdg-digitos.json")); circ = d["circulos"]
nm = json.load(open(SP+r"\jdg-nomes.json")); numeros, atrib = nm["numeros"], nm["atrib"]
reg = json.load(open(SP+r"\jdg-registro.json"))
e = reg["escala"]; ox, oy = reg["offset"]

# circulo de cada nome (com a reatribuicao do 0918 e os dois cravados a mao)
furo_de = {}
for k, num in numeros.items():
    cx, cy, _x0, _y0, w_, h_ = circ[int(k)]
    nome = f"JDG{atrib[str(k)]}{num.zfill(2)}"
    if nome == "JDG1018" and abs(cx - 4595) < 60 and abs(cy - 2275) < 60:
        nome = "JDG0918"
    furo_de[nome] = (cx, cy, max(w_, h_)/2 + 3)
furo_de["JDG0920"] = (4650, 2150, 36)
furo_de["JDG0919"] = (4665, 2295, 36)

saida = {}
com_furo = 0
for nome, path in lotes.items():
    f = furo_de.get(nome)
    if not f:
        saida[nome] = path; continue
    cx, cy, r = f[0]*e + ox, f[1]*e + oy, f[2]*e
    cx, cy, r = round(cx,1), round(cy,1), round(r,1)
    # o furo so vale se cair DENTRO do poligono (senao evenodd nao fura nada e o arco vira sujeira)
    pts = [[float(a) for a in par.split(",")] for par in re.findall(r"[-\d.]+,[-\d.]+", path)]
    xs = [p[0] for p in pts]; ys = [p[1] for p in pts]
    if not (min(xs)-r < cx < max(xs)+r and min(ys)-r < cy < max(ys)+r):
        saida[nome] = path; continue
    furo = f"M {cx-r},{cy} A {r},{r} 0 1 0 {cx+r},{cy} A {r},{r} 0 1 0 {cx-r},{cy} Z"
    saida[nome] = f"{path} {furo}"
    com_furo += 1
json.dump(saida, open(SP+r"\jdg-lotes-telao.json","w"), separators=(",",":"))
print(f"furos aplicados: {com_furo}/{len(lotes)}")
