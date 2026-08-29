"""Etapa A do masterplan do JDG: mascara de lote, ilhas (quadras) e casamento com os numeros.

⚠️ POR QUE ASSIM. O PDF do masterplan e 100% raster (820 camadas de imagem, zero vetor), entao
os poligonos nao podem ser extraidos - tem que ser reconstruidos. O que o PDF DA de graca e o
texto com coordenada exata: 46 quadras, 442 lotes, 273 areas. Sao essas coordenadas que fazem a
reconstrucao ser assertiva em vez de tracada a olho.
"""
import cv2, numpy as np, json, glob, collections

SP = r"C:\Users\lucas\AppData\Local\Temp\claude\C--Users-lucas-Documents-Careli-C2x-Sistemas\aa75c3b5-c653-4fdf-b653-625694ef9095\scratchpad"

def carregar():
    # O mapa de IMPLANTACAO (fundo branco) e mais limpo que a arte de apresentacao: sem o verde
    # escuro da moldura, sem textos de marketing. Mesma projecao e mesmo tamanho do PDF
    # (10000x5626), entao as coordenadas do texto valem 1:1.
    p = glob.glob(r"C:\Users\lucas\Downloads\*JARDIM DAS GERAIS*MAPA*")[0]
    img = cv2.imdecode(np.fromfile(p, dtype=np.uint8), cv2.IMREAD_COLOR)
    spans = json.load(open(SP+r"\jdg-spans.json", encoding="utf-8"))
    return img, spans

def mascara_de_texto(shape, spans, folga=6):
    """Onde ha texto branco. Sem apagar, o glifo virava uma 'divisa' luminosa no watershed."""
    m = np.zeros(shape[:2], np.uint8)
    for s in spans:
        x0,y0,x1,y1 = s["bbox"]
        cv2.rectangle(m, (int(x0)-folga, int(y0)-folga), (int(x1)+folga, int(y1)+folga), 255, -1)
    return m

def mascara_de_lote(img):
    """Verde de lote nas DUAS fases.

    Fase 1 e verde saturado; fase 2 e o mesmo matiz lavado (quase pastel). O que separa as duas
    da mata e do fundo nao e o matiz - mata tambem e verde - mas a combinacao com saturacao e
    brilho: a mata e escura e a fase 2 e clara demais para ser mata.
    """
    hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
    H,S,V = hsv[:,:,0].astype(int), hsv[:,:,1].astype(int), hsv[:,:,2].astype(int)
    forte = (H>=45)&(H<=95)&(S>=90)&(V>=110)
    claro = (H>=45)&(H<=95)&(S>=18)&(S<90)&(V>=200)
    return ((forte|claro).astype(np.uint8))*255

def preencher_buracos(m):
    """Tudo que a mascara cerca vira mascara. Buraco = componente do fundo que nao toca a borda."""
    inv = cv2.bitwise_not(m)
    n, lab = cv2.connectedComponents(inv, connectivity=4)
    borda = set(lab[0,:].tolist()) | set(lab[-1,:].tolist()) | set(lab[:,0].tolist()) | set(lab[:,-1].tolist())
    externo = np.isin(lab, list(borda))
    return np.where(externo, m, 255).astype(np.uint8)

def main():
    img, spans = carregar()
    print("imagem:", img.shape)
    quadras = [s for s in spans if s["size"]==36.0 and s["t"].isdigit()]
    lotes   = [s for s in spans if s["size"]==30.0]
    print("quadras:", len(quadras), "lotes:", len(lotes))

    m = mascara_de_lote(img)
    # ⚠️ PREENCHER BURACOS, E NAO FECHAR MORFOLOGICAMENTE. O texto branco e as arvores abrem
    # buracos DENTRO do lote, e o instinto e um MORPH_CLOSE - mas o kernel que tapa um buraco de
    # 27px tambem engorda a borda externa em 27px, e as ruas do JDG sao estreitas: as quadras
    # vizinhas se fundiam atraves da rua (a maior ilha juntava NOVE quadras). Preencher buracos
    # so mexe no que esta cercado, e deixa a borda externa intacta.
    m = preencher_buracos(m)
    m = cv2.morphologyEx(m, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_ELLIPSE,(5,5)))
    print("cobertura de lote: %.2f%%" % (m.mean()/2.55))

    n, lab, stats, cent = cv2.connectedComponentsWithStats(m, connectivity=8)
    print("componentes:", n-1)
    grandes = [(stats[i, cv2.CC_STAT_AREA], i) for i in range(1,n) if stats[i, cv2.CC_STAT_AREA] > 20000]
    grandes.sort(reverse=True)
    print("ilhas com area > 20k px:", len(grandes))

    # Cada quadra cai numa ilha; cada lote tambem. A ilha e que amarra os dois.
    def ilha_de(s, r=60):
        x,y = int(s["x"]), int(s["y"])
        viz = lab[max(0,y-r):y+r, max(0,x-r):x+r]
        vals = viz[viz>0]
        if vals.size == 0: return 0
        return int(collections.Counter(vals.tolist()).most_common(1)[0][0])

    q_ilha = {q["t"]: ilha_de(q) for q in quadras}
    sem = [k for k,v in q_ilha.items() if v==0]
    print("quadras sem ilha:", sem)
    porilha = collections.Counter(q_ilha.values())
    print("ilhas com mais de uma quadra:", {k:v for k,v in porilha.items() if v>1 and k!=0})

    np.save(SP+r"\jdg-lab.npy", lab.astype(np.int32))
    cv2.imwrite(SP+r"\jdg-mask.png", m)
    json.dump({"q_ilha":q_ilha}, open(SP+r"\jdg-ilhas.json","w"))
    print("salvos jdg-lab.npy, jdg-mask.png, jdg-ilhas.json")

main()
