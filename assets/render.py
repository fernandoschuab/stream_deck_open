from playwright.sync_api import sync_playwright
import os
D='/home/claude/openwith/com.fernandoschuab.openwith.sdPlugin/imgs'
jobs=[('glyph.svg',f'{D}/actions/open/icon.png',20,True),('glyph.svg',f'{D}/actions/open/icon@2x.png',40,True),
('glyph.svg',f'{D}/plugin/category-icon.png',28,True),('glyph.svg',f'{D}/plugin/category-icon@2x.png',56,True),
('key.svg',f'{D}/actions/open/key.png',72,False),('key.svg',f'{D}/actions/open/key@2x.png',144,False),
('market.svg',f'{D}/plugin/marketplace.png',288,False),('market.svg',f'{D}/plugin/marketplace@2x.png',512,False)]
with sync_playwright() as p:
    b=p.chromium.launch()
    for src,out,size,transparent in jobs:
        svg=open(src).read()
        pg=b.new_page(viewport={'width':size,'height':size})
        tag = '<svg width="%d" height="%d" ' % (size, size)
        html = '<html><body style="margin:0;background:transparent">' + svg.replace('<svg ', tag, 1) + '</body></html>'
        pg.set_content(html)
        pg.screenshot(path=out,omit_background=transparent, clip={'x':0,'y':0,'width':size,'height':size})
        pg.close()
    b.close()
