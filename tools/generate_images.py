"""Génère les photos du site avec Gemini (nano banana).

    python3 tools/generate_images.py                  # toutes les scènes manquantes
    python3 tools/generate_images.py accueil panne    # scènes choisies (nouvelle variante)
    python3 tools/generate_images.py --export         # réexporte les images retenues, sans appel API

Les originaux partent dans .image-raw/<scene>-NN.jpg (jamais écrasés, non publiés).
La variante retenue est celle listée dans RETENUES ; elle est exportée en WebP
dans public/images/photos/<scene>-{1600,800}.webp.
Clé : GEMINI_API_KEY dans l'environnement ou dans work/boubou-queens/.env.
"""
import os, sys, re
from pathlib import Path
from io import BytesIO
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / ".image-raw"
OUT = ROOT / "public" / "images" / "photos"
MODEL = "gemini-3.1-flash-image"
PRIX_2K = 0.101  # $ par image 2K (1 680 jetons à 60 $/M)

# Variante retenue par scène après relecture (numéro du fichier dans .image-raw).
RETENUES = {
    "accueil": 8, "recente": 2, "electrique": 1, "panne": 1, "sans-ct": 1, "accidentee": 2,
    "cash": 1, "utilitaire": 2, "ile-de-france": 1, "signature": 2,
}

SCENES = {
    "accueil": "a 2018 Renault Clio IV hatchback (fourth generation, 2016 facelift: C-shaped LED daytime running lights, chrome-trimmed grille with large diamond-shaped badge area, smooth rounded bodywork, five doors with hidden rear door handles in the window frame), metallic dark grey, very clean condition, parked along a Parisian street lined with cream-coloured Haussmann stone buildings and wrought-iron balconies; a used-car buyer in a dark navy jacket seen from behind walks towards it holding a tablet at his side; soft early-morning light, the car is the hero of the frame, three-quarter front view, the car on the right half of the frame",
    "recente": "a nearly new white compact SUV parked in a bright modern residential car park in the Paris suburbs, two people seen only from the shoulders down standing by the open driver door, one handing a car key to the other; clean contemporary architecture, daylight",
    "electrique": "a modern dark blue electric hatchback plugged into a public charging station on a quiet tree-lined Paris street in the late afternoon, a person seen strictly from behind unplugging the charging cable, wet pavement reflecting warm light",
    "panne": "an old grey compact car being slowly winched onto the tilted bed of a flatbed tow truck in a quiet residential street of a Paris suburb, a man seen from behind operating the winch lever, late-afternoon light",
    "sans-ct": "a tight close-up of a man's two hands lifting the open bonnet of a car and checking the engine oil dipstick, engine bay in sharp focus — cropped at the forearms, no head anywhere in the frame",
    "accidentee": "a dark blue unbadged generic hatchback with a crumpled front bumper and a cracked headlight, parked in a clean concrete underground car park; in the foreground only the back of a man's shoulder and his hand holding up a smartphone to photograph the damage — the man is seen strictly from behind, his head is cut off by the top of the frame, the car front grille is plain with no emblem",
    "cash": "a close-up of two different people's hands over the roof of a car, one hand passing a car key to the other open hand, street softly blurred behind — cropped at the wrists and forearms, no faces anywhere",
    "utilitaire": "a single plain white compact panel van, both rear doors closed, parked at the kerb in three-quarter rear view in front of a small craftsman's workshop with a half-open grey roller shutter, in a quiet suburb of Paris, nobody around, overcast soft light — one van only, a normal van with exactly two rear doors",
    "ile-de-france": "a car driving on an elevated ring road at dusk with the rooftops and apartment blocks of the Paris suburbs stretching to the horizon, warm low sun, light trails, seen from a slightly raised viewpoint",
    "signature": "a top-down close-up of a car bonnet: a blank sheet of paper, a pen held by one hand signing it, and a set of car keys lying next to the paper — the frame shows only the bonnet, the paper, the keys and one hand cropped at the wrist; no arm above the elbow, no shoulder, no head, no face, no second person; the paper is completely blank",
}

PROMPT = """Photorealistic documentary photograph, landscape orientation.
USE OF THIS IMAGE: it is a wide editorial photograph on the website of a Paris company that buys used cars from private owners. It is shown either as a full-width band between two text sections, or very darkened behind a white headline. It must read clearly at a glance and remain calm, not busy.
SCENE: {scene}
THE PERSON: when a person appears, they are seen strictly from behind, in profile from behind the shoulder, or only as hands and forearms. The face is never visible and never identifiable. Real everyday clothes, natural gesture, never posing, never looking at the camera.
LOOK: real reportage photograph. Natural light, shallow depth of field, honest muted colours with a slightly warm tone, a little grain. Not a studio shot, not a cheerful stock photo, not an illustration, not a 3D render, not an advertisement.
DO NOT INCLUDE: no text, no letter, no number, no readable licence plate, no logo, no car brand badge, no watermark, no signage. No face, no portrait. No deformed or extra fingers."""


def api_key():
    k = os.environ.get("GEMINI_API_KEY")
    if k:
        return k
    env = ROOT.parents[1] / "work" / "boubou-queens" / ".env"
    for line in env.read_text().splitlines():
        m = re.match(r"\s*GEMINI_API_KEY\s*=\s*(.+)", line)
        if m:
            return m.group(1).strip().strip("'\"")
    sys.exit("GEMINI_API_KEY introuvable")


def generate(name):
    # Appel REST direct : le SDK Python installé ne connaît pas encore imageSize.
    import json, base64, urllib.request
    body = {
        "contents": [{"parts": [{"text": PROMPT.format(scene=SCENES[name])}]}],
        "generationConfig": {"responseModalities": ["IMAGE"], "imageConfig": {"aspectRatio": "16:9", "imageSize": "2K"}},
    }
    req = urllib.request.Request(
        f"https://generativelanguage.googleapis.com/v1beta/models/{MODEL}:generateContent",
        data=json.dumps(body).encode(), headers={"Content-Type": "application/json", "x-goog-api-key": api_key()})
    with urllib.request.urlopen(req, timeout=180) as r:
        resp = json.load(r)
    for part in resp["candidates"][0]["content"]["parts"]:
        data = part.get("inlineData", {}).get("data")
        if data:
            RAW.mkdir(exist_ok=True)
            n = len(list(RAW.glob(f"{name}-*.jpg"))) + 1
            path = RAW / f"{name}-{n:02d}.jpg"
            Image.open(BytesIO(base64.b64decode(data))).convert("RGB").save(path, quality=95)
            return path
    raise RuntimeError("aucune image renvoyée")


def export(name):
    n = RETENUES.get(name)
    src = RAW / f"{name}-{n:02d}.jpg" if n else max(RAW.glob(f"{name}-*.jpg"), default=None)
    if not src or not src.exists():
        return None
    OUT.mkdir(parents=True, exist_ok=True)
    img = Image.open(src).convert("RGB")
    for w in (1600, 800):
        h = round(img.height * w / img.width)
        img.resize((w, h), Image.LANCZOS).save(OUT / f"{name}-{w}.webp", "WEBP", quality=78, method=6)
    return src


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    if "--export" in sys.argv:
        for name in SCENES:
            print(name, export(name))
        sys.exit()
    names = args or [n for n in SCENES if not list(RAW.glob(f"{n}-*.jpg"))]
    cost = 0
    for name in names:
        try:
            p = generate(name)
            cost += PRIX_2K
            print(f"✓ {name}: {p.name}", flush=True)
        except Exception as e:
            print(f"✗ {name}: {e}", flush=True)
    print(f"Coût : {cost:.2f} $")
