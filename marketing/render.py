import sys, os
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__))
FONTS = ''.join(f"@font-face{{font-family:Inter;font-weight:{w};src:url('file://{HERE}/fonts/inter-latin-{w}-normal.woff2') format('woff2')}}" for w in (400,500,600,700,800))
def render(html_file, out, w, h, transparent=False, scale=1):
    with sync_playwright() as p:
        b = p.chromium.launch()
        pg = b.new_page(viewport={'width': w, 'height': h}, device_scale_factor=scale)
        pg.goto('file://' + os.path.join(HERE, html_file))
        pg.add_style_tag(content=FONTS)
        pg.evaluate('document.fonts.ready')
        pg.wait_for_timeout(400)
        pg.screenshot(path=out, omit_background=transparent, clip={'x':0,'y':0,'width':w,'height':h})
        b.close()
if __name__ == '__main__':
    f, out, w, h = sys.argv[1], sys.argv[2], int(sys.argv[3]), int(sys.argv[4])
    render(f, out, w, h, transparent=('--t' in sys.argv), scale=(2 if '--2x' in sys.argv else 1))
