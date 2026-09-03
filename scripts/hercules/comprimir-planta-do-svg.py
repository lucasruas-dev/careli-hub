# COMPRIME A PLANTA EMBUTIDA DE UM MASTERPLAN SVG — para caber no bucket (50 MB do projeto Supabase).
#
# Caso concreto (02/09/2026): o SVG do Veredas do Ouro tem 66 MB porque a planta vai embutida como
# PNG em base64. Os lotes (os <path> com inkscape:label) pesam quase nada; o peso é a imagem. Este
# script troca a imagem por WebP (ou JPEG), com a MESMA largura/altura, e não toca em mais nada do
# arquivo — labels, ids, viewBox e geometria saem byte a byte iguais.
#
# ⚠️ NÃO REDIMENSIONA por padrão: mudar o tamanho da imagem não muda o viewBox nem os paths (a
#    imagem tem width/height próprios no <image>), mas piora a nitidez do mapa em zoom. Só reduz
#    com --escala se a qualidade sozinha não bastar.
# ⚠️ Só escreve o arquivo de SAÍDA. Não mexe no original.
#
# Uso:
#   python scripts/hercules/comprimir-planta-do-svg.py "C:/.../Masterplan - Veredas do Ouro_Masterplan.svg" \
#          "C:/.../MASTERPLAN_VEREDAS_DO_OURO.svg" [--qualidade 82] [--formato webp|jpeg] [--escala 1.0]

import argparse
import base64
import io
import re
import sys
from pathlib import Path

from PIL import Image

Image.MAX_IMAGE_PIXELS = None  # plantas de 3840x2160 e maiores são o normal aqui

ap = argparse.ArgumentParser()
ap.add_argument("entrada")
ap.add_argument("saida")
ap.add_argument("--qualidade", type=int, default=82)
ap.add_argument("--formato", choices=["webp", "jpeg"], default="webp")
ap.add_argument("--escala", type=float, default=1.0)
args = ap.parse_args()

texto = Path(args.entrada).read_text(encoding="utf-8")
tamanho_antes = len(texto.encode("utf-8"))

# Toda imagem embutida: xlink:href ou href, PNG/JPEG/WebP em base64.
# ⚠️ O INKSCAPE QUEBRA O BASE64 COM ENTIDADES (`&#10;` a cada 76 caracteres): o padrão precisa
# aceitá-las dentro da corrida, e o decode precisa tirá-las antes. Sem isso, "0 imagens trocadas".
padrao = re.compile(
    r'((?:xlink:)?href=")data:image/(png|jpeg|jpg|webp);base64,((?:[A-Za-z0-9+/=]|&#x?[0-9a-fA-F]+;|\s)+)(")'
)

trocas = 0
economia = 0


def trocar(m: re.Match) -> str:
    global trocas, economia
    bruto = base64.b64decode(re.sub(r"&#x?[0-9a-fA-F]+;|\s+", "", m.group(3)))
    img = Image.open(io.BytesIO(bruto))
    if args.escala != 1.0:
        img = img.resize((int(img.width * args.escala), int(img.height * args.escala)), Image.LANCZOS)
    if args.formato == "jpeg" and img.mode in ("RGBA", "LA", "P"):
        img = img.convert("RGB")
    buf = io.BytesIO()
    if args.formato == "webp":
        img.save(buf, format="WEBP", quality=args.qualidade, method=6)
        mime = "image/webp"
    else:
        img.save(buf, format="JPEG", quality=args.qualidade, optimize=True, progressive=True)
        mime = "image/jpeg"
    novo = base64.b64encode(buf.getvalue()).decode("ascii")
    trocas += 1
    economia += len(m.group(3)) - len(novo)
    print(f"imagem {trocas}: {img.width}x{img.height} {m.group(2)} {len(bruto)//1024} KB -> {args.formato} {len(buf.getvalue())//1024} KB")
    return f"{m.group(1)}data:{mime};base64,{novo}{m.group(4)}"


saida = padrao.sub(trocar, texto)
Path(args.saida).write_text(saida, encoding="utf-8")
tamanho_depois = len(saida.encode("utf-8"))

labels_antes = len(re.findall(r'inkscape:label="', texto))
labels_depois = len(re.findall(r'inkscape:label="', saida))
print(f"\n{trocas} imagem(ns) trocada(s); labels {labels_antes} -> {labels_depois}")
print(f"{tamanho_antes/1024/1024:.1f} MB -> {tamanho_depois/1024/1024:.1f} MB")
if labels_antes != labels_depois:
    print("⚠️ a contagem de labels mudou: NÃO use a saída.")
    sys.exit(2)
if tamanho_depois > 48 * 1024 * 1024:
    print("⚠️ ainda acima de 48 MB: baixe a qualidade ou use --escala 0.85.")
    sys.exit(3)
