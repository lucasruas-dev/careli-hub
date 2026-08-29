"""Monta o numero de cada circulo com os digitos lidos e confere QUADRA A QUADRA contra a
carga do C2X. Quadra que nao fecha o conjunto exato vai para revisao visual - nada e chutado."""
import cv2, numpy as np, json, collections

SP = r"C:\Users\lucas\AppData\Local\Temp\claude\C--Users-lucas-Documents-Careli-C2x-Sistemas\aa75c3b5-c653-4fdf-b653-625694ef9095\scratchpad"
d = json.load(open(SP+r"\jdg-digitos.json"))
circ, donos, rot = d["circulos"], d["donos"], d["rotulo"]
carga = json.load(open(SP+r"\jdg-c2x.json"))
spans = json.load(open(SP+r"\jdg-spans.json", encoding="utf-8"))
lab = np.load(SP+r"\jdg-lab.npy")
H, W = lab.shape

LEITURA = {0:"0",1:"7",2:"0",3:"4",4:"0",5:"8",6:"1",7:"0",8:"6",9:"5",10:"1",
           11:"2",12:"9",13:"3",14:"7",15:"2",16:"0",17:"9",18:"8",19:"2",20:"2",21:"3"}

# numero de cada circulo
por_circ = collections.defaultdict(dict)
for i,(k,pos,ndig) in enumerate(donos):
    por_circ[k][pos] = LEITURA[rot[i]]
numeros = {}
for k, dd in por_circ.items():
    if len(dd) == 2: numeros[k] = dd[0] + dd[1]
    elif len(dd) == 1: numeros[k] = dd[0]
print("circulos com numero montado:", len(numeros))

# quadra de cada circulo: pela ilha; desempate pelo marcador de quadra mais proximo
quadras = [s for s in spans if s["size"]==36.0 and s["t"].isdigit()]
def ilha_de(x, y, r=60):
    viz = lab[max(0,int(y)-r):min(H,int(y)+r), max(0,int(x)-r):min(W,int(x)+r)]
    v = viz[viz>0]
    return int(collections.Counter(v.tolist()).most_common(1)[0][0]) if v.size else 0
q_da_ilha = collections.defaultdict(list)
for q in quadras: q_da_ilha[ilha_de(q["x"], q["y"])].append(q)

atrib = {}
for k,(cx, cy, *_r) in enumerate(circ):
    il = ilha_de(cx, cy)
    cand = q_da_ilha.get(il, [])
    if len(cand) == 1: q = cand[0]["t"]
    elif cand: q = min(cand, key=lambda s:(s["x"]-cx)**2+(s["y"]-cy)**2)["t"]
    else: q = min(quadras, key=lambda s:(s["x"]-cx)**2+(s["y"]-cy)**2)["t"]
    atrib[k] = q

# QA contra a carga
carga_por_q = collections.defaultdict(set)
for r_ in carga: carga_por_q[r_["name"][3:5]].add(r_["name"][5:7])
lido_por_q = collections.defaultdict(list)
for k, num in numeros.items():
    lido_por_q[f"{int(atrib[k]):02d}"].append((num.zfill(2), k))

ok, rever = 0, []
for q in sorted(set(carga_por_q) | set(lido_por_q)):
    esperado = carga_por_q.get(q, set())
    lidos = [n for n,_ in lido_por_q.get(q, [])]
    contagem = collections.Counter(lidos)
    dups = {n:c for n,c in contagem.items() if c>1}
    faltam = esperado - set(lidos)
    sobram = set(lidos) - esperado
    if not dups and not faltam and not sobram and esperado:
        ok += 1
    else:
        rever.append(q)
        print(f"q{q}: carga={len(esperado)} lidos={len(lidos)} dups={dups} faltam={sorted(faltam)} fora-da-carga={sorted(sobram)}")
print(f"\nquadras fechadas com a carga: {ok}/{len(carga_por_q)} | a rever: {rever}")
json.dump({"numeros": numeros, "atrib": atrib}, open(SP+r"\jdg-nomes.json","w"))
