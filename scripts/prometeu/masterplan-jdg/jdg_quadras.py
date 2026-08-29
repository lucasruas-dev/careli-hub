"""Le os circulos VERMELHOS (numeros de quadra) e reatribui cada lote a quadra certa.

O agrupamento por ilha falha onde duas quadras se tocam sem rua (o 4301 caia dentro da q42).
O circulo vermelho da arte nova e a fonte direta: cada lote pertence a quadra do marcador
vermelho mais proximo DENTRO da mesma ilha - e o numero vem da leitura, nao do span antigo.
"""
import cv2, numpy as np, json, collections

SP = r"C:\Users\lucas\AppData\Local\Temp\claude\C--Users-lucas-Documents-Careli-C2x-Sistemas\aa75c3b5-c653-4fdf-b653-625694ef9095\scratchpad"
img = cv2.imdecode(np.fromfile(r"C:\Users\lucas\Downloads\GBR_JARDIM_V02-Recuperado-Recuperado.png", np.uint8), cv2.IMREAD_COLOR)
lab = np.load(SP+r"\jdg-lab.npy")
d = json.load(open(SP+r"\jdg-digitos.json"))
circ, donos, rot = d["circulos"], d["donos"], d["rotulo"]
nomes_prev = json.load(open(SP+r"\jdg-nomes.json"))
numeros = nomes_prev["numeros"]
carga = json.load(open(SP+r"\jdg-c2x.json"))
H, W = img.shape[:2]
B,G,R = img[:,:,0].astype(np.int16), img[:,:,1].astype(np.int16), img[:,:,2].astype(np.int16)

# 1. RECONSTROI os representantes de digito (mesma ordem do jdg_ler: deterministico)
def digitos_de(rec, w_, h_):
    m2 = (rec.min(axis=2) > 190).astype(np.uint8)
    msk = np.zeros((h_, w_), np.uint8)
    cv2.circle(msk, (w_//2, h_//2), int(min(w_,h_)*0.42), 1, -1)
    m2 &= msk
    nn, ll, st2, _ = cv2.connectedComponentsWithStats(m2, connectivity=8)
    comps = [i for i in range(1, nn) if st2[i, cv2.CC_STAT_AREA] > 40 and st2[i, cv2.CC_STAT_HEIGHT] > h_*0.2]
    comps.sort(key=lambda i: st2[i, cv2.CC_STAT_LEFT])
    out = []
    for i in comps[:2]:
        xx, yy, ww, hh = st2[i,cv2.CC_STAT_LEFT], st2[i,cv2.CC_STAT_TOP], st2[i,cv2.CC_STAT_WIDTH], st2[i,cv2.CC_STAT_HEIGHT]
        g = (ll[yy:yy+hh, xx:xx+ww] == i).astype(np.uint8)*255
        out.append(cv2.resize(g, (20, 28), interpolation=cv2.INTER_AREA))
    return out

reps = []
idx = 0
for k,(cx, cy, x0, y0, w_, h_) in enumerate(circ):
    for g in digitos_de(img[y0:y0+h_, x0:x0+w_], w_, h_):
        r_ = rot[idx]; idx += 1
        while len(reps) <= r_: reps.append(None)
        if reps[r_] is None: reps[r_] = g
LEITURA = {0:"0",1:"7",2:"0",3:"4",4:"0",5:"8",6:"1",7:"0",8:"6",9:"5",10:"1",
           11:"2",12:"9",13:"3",14:"7",15:"2",16:"0",17:"9",18:"8",19:"2",20:"2",21:"3"}
def ler_glifo(g):
    best, bi = -1, None
    for j, r_ in enumerate(reps):
        if r_ is None: continue
        c = cv2.matchTemplate(g.astype(np.float32), r_.astype(np.float32), cv2.TM_CCOEFF_NORMED)[0][0]
        if c > best: best, bi = c, j
    return LEITURA.get(bi, "?"), best

# 2. VERMELHOS
verm = ((R > 150) & (G < 90) & (B < 90)).astype(np.uint8)
verm = cv2.morphologyEx(verm, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE,(7,7)))
n, l, stats, cent = cv2.connectedComponentsWithStats(verm, connectivity=8)
qmarks = []
for i in range(1, n):
    a = stats[i, cv2.CC_STAT_AREA]; w_, h_ = stats[i, cv2.CC_STAT_WIDTH], stats[i, cv2.CC_STAT_HEIGHT]
    if not (2000 < a < 20000): continue
    if abs(w_ - h_) > 0.35 * max(w_, h_): continue
    x0, y0 = stats[i, cv2.CC_STAT_LEFT], stats[i, cv2.CC_STAT_TOP]
    gs = digitos_de(img[y0:y0+h_, x0:x0+w_], w_, h_)
    num = "".join(ler_glifo(g)[0] for g in gs)
    if num.isdigit() and 1 <= int(num) <= 46:
        qmarks.append({"q": f"{int(num):02d}", "x": float(cent[i][0]), "y": float(cent[i][1])})
print("marcadores de quadra lidos:", len(qmarks), sorted(m["q"] for m in qmarks))

# 3. REATRIBUI cada circulo preto a quadra do vermelho mais proximo
def ilha_de(x, y, r=60):
    viz = lab[max(0,int(y)-r):min(H,int(y)+r), max(0,int(x)-r):min(W,int(x)+r)]
    v = viz[viz>0]
    return int(collections.Counter(v.tolist()).most_common(1)[0][0]) if v.size else 0
ilha_q = {i: ilha_de(m["x"], m["y"]) for i,m in enumerate(qmarks)}
atrib = {}
for k,(cx, cy, *_r) in enumerate(circ):
    il = ilha_de(cx, cy)
    mesmos = [i for i,m in enumerate(qmarks) if ilha_q[i] == il]
    pool = mesmos if mesmos else range(len(qmarks))
    j = min(pool, key=lambda i:(qmarks[i]["x"]-cx)**2+(qmarks[i]["y"]-cy)**2)
    atrib[k] = qmarks[j]["q"]

# 4. QA: sem duplicata e sem falta (sobra = lote fora de venda, aceita)
carga_por_q = collections.defaultdict(set)
for r_ in carga: carga_por_q[r_["name"][3:5]].add(r_["name"][5:7])
lido_por_q = collections.defaultdict(list)
for k, num in numeros.items():
    lido_por_q[atrib[int(k)] if isinstance(k,str) else atrib[k]].append((num.zfill(2), int(k)))
ok, rever = 0, []
for q in sorted(carga_por_q):
    lidos = [nu for nu,_ in lido_por_q.get(q, [])]
    dups = {nu:c for nu,c in collections.Counter(lidos).items() if c>1}
    faltam = carga_por_q[q] - set(lidos)
    if not dups and not faltam: ok += 1
    else:
        rever.append(q)
        print(f"q{q}: dups={dups} faltam={sorted(faltam)} lidos={sorted(lidos)}")
print(f"\nquadras OK: {ok}/{len(carga_por_q)} | a rever: {rever}")
json.dump({"numeros": numeros, "atrib": atrib, "qmarks": qmarks}, open(SP+r"\jdg-nomes.json","w"))
