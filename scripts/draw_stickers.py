"""Generate the original starter sticker pack. Pillow is only needed to regenerate assets."""
from pathlib import Path
from PIL import Image, ImageDraw
import json

root = Path(__file__).resolve().parents[1] / 'assets' / 'stickers'
root.mkdir(parents=True, exist_ok=True)
catalog = []
items = [('happy', '开心地笑，分享好消息', ['开心', '笑', '高兴']), ('listening', '点头，认真听你说', ['倾听', '点头', '明白']), ('thinking', '想一想，有点疑惑', ['思考', '疑问']), ('shy', '有些害羞，不好意思', ['害羞', '夸奖']), ('cheer', '为你加油，庆祝进展', ['加油', '庆祝'])]
for slug, description, tags in items:
    image = Image.new('RGBA', (768, 768))
    draw = ImageDraw.Draw(image)
    ink, face = '#294b61', '#fff2cf'
    draw.rounded_rectangle((108, 120, 660, 663), radius=190, fill=face, outline=ink, width=15)
    draw.ellipse((147, 393, 255, 459), fill='#ffb9ab')
    draw.ellipse((516, 393, 624, 459), fill='#ffb9ab')
    if slug in ('happy', 'cheer'):
        draw.arc((225, 261, 321, 354), 190, 350, fill=ink, width=15)
        draw.arc((447, 261, 543, 354), 190, 350, fill=ink, width=15)
        draw.arc((282, 345, 486, 513), 0, 180, fill=ink, width=18)
    else:
        draw.ellipse((261, 297, 288, 348), fill=ink)
        draw.ellipse((471, 297, 498, 348), fill=ink)
        draw.arc((324, 375, 438, 447), 0, 180, fill=ink, width=12)
    if slug == 'shy':
        for x in (168, 201, 543, 576): draw.line((x, 399, x-12, 441), fill='#df7f82', width=9)
    if slug == 'thinking':
        for x, y, r in ((594, 132, 15), (645, 90, 21), (705, 45, 27)): draw.ellipse((x-r, y-r, x+r, y+r), fill='#bde4ec', outline=ink, width=6)
    if slug == 'cheer':
        for x, y in ((78, 216), (693, 216)):
            draw.polygon([(x,y-42),(x+12,y-12),(x+42,y),(x+12,y+12),(x,y+42),(x-12,y+12),(x-42,y),(x-12,y-12)],fill='#f7c55c',outline=ink,width=6)
    if slug == 'listening': draw.arc((255, 30, 489, 120), 15, 165, fill='#6ba7b6', width=12)
    image.resize((256, 256), Image.Resampling.LANCZOS).save(root / f'{slug}.png', optimize=True)
    catalog.append({'slug':slug,'description':description,'tags':tags,'file':f'{slug}.png'})
(root / 'catalog.json').write_text(json.dumps(catalog,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
