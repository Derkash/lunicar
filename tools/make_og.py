"""Image de partage (Open Graph) 1200 x 630 à partir de la photo d'accueil retenue.

    python3 tools/make_og.py        # lit RETENUES["accueil"] dans generate_images.py

Panneau marine à gauche (logo + accroche), photo de la voiture à droite, fondu entre les deux.
Polices : Georgia (macOS), à défaut la police par défaut de Pillow.
"""
import re
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
W, H, PHOTO_W, FADE = 1200, 630, 700, 260
NAVY, GOLD, GOLD_DARK, PALE = (13, 37, 65), (212, 178, 106), (184, 146, 58), (225, 230, 238)
FONTS = Path('/System/Library/Fonts/Supplemental')


def font(name, size):
    try:
        return ImageFont.truetype(str(FONTS / name), size)
    except OSError:
        return ImageFont.load_default()


def main():
    n = int(re.search(r'"accueil":\s*(\d+)', (ROOT / 'tools' / 'generate_images.py').read_text()).group(1))
    photo = Image.open(ROOT / '.image-raw' / f'accueil-{n:02d}.jpg').convert('RGB')
    pw, ph = photo.size
    # Moitié droite de la photo (la voiture), recadrée au format du panneau.
    left = int(pw * 0.42)
    h = int((pw - left) * H / PHOTO_W)
    crop = photo.crop((left, max(0, ph - h), pw, ph)).resize((PHOTO_W, H))
    mask = Image.new('L', (PHOTO_W, H), 255)
    md = ImageDraw.Draw(mask)
    for x in range(FADE):
        md.line([(x, 0), (x, H)], fill=int(255 * x / FADE))
    img = Image.new('RGB', (W, H), NAVY)
    img.paste(Image.composite(crop, Image.new('RGB', (PHOTO_W, H), NAVY), mask), (W - PHOTO_W, 0))

    d = ImageDraw.Draw(img)
    x0, y0 = 64, 64
    d.rounded_rectangle([x0, y0, x0 + 56, y0 + 56], radius=14, fill=(255, 255, 255))
    d.line([(x0 + 19, y0 + 15), (x0 + 19, y0 + 44), (x0 + 40, y0 + 44)], fill=NAVY, width=7, joint='curve')
    d.ellipse([x0 + 36, y0 + 16, x0 + 45, y0 + 25], fill=GOLD_DARK)
    bold = font('Georgia Bold.ttf', 36)
    d.text((x0 + 74, y0 + 10), 'LUNI', font=bold, fill=(255, 255, 255))
    d.text((x0 + 74 + d.textlength('LUNI', font=bold), y0 + 10), 'CAR', font=bold, fill=GOLD)

    big, it, small = font('Georgia.ttf', 58), font('Georgia Italic.ttf', 58), font('Georgia.ttf', 26)
    d.text((64, 200), 'Nous rachetons', font=big, fill=(255, 255, 255))
    d.text((64, 268), 'votre voiture,', font=big, fill=(255, 255, 255))
    d.text((64, 336), 'toutes marques.', font=it, fill=GOLD)
    d.text((64, 450), 'Offre sous 24 h · Virement bancaire', font=small, fill=PALE)
    d.text((64, 488), 'Paris et Île-de-France', font=small, fill=PALE)

    out = ROOT / 'public' / 'images' / 'og-lunicar.jpg'
    img.save(out, quality=84, optimize=True, progressive=True)
    print(out, out.stat().st_size)


if __name__ == '__main__':
    main()
