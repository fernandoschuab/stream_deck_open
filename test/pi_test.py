import base64, io, json, sys
from PIL import Image, ImageDraw
from playwright.sync_api import sync_playwright

UI = 'file:///home/claude/openwith/com.fernandoschuab.openwith.sdPlugin/ui/open.html'
OUT = '/home/claude/openwith/test/'

def icon(color):
    im = Image.new('RGBA', (64, 64), (0,0,0,0)); d = ImageDraw.Draw(im)
    d.rounded_rectangle((6,6,58,58), 13, fill=color)
    b = io.BytesIO(); im.save(b, 'PNG'); return 'data:image/png;base64,' + base64.b64encode(b.getvalue()).decode()

H = '/Users/fernandoschuab'
apps = [
 {'name':'Antigravity IDE','path':'/Applications/Antigravity IDE.app','electron':True},
 {'name':'Cursor','path':'/Applications/Cursor.app','electron':True},
 {'name':'Finder','path':'/System/Library/CoreServices/Finder.app','electron':False},
 {'name':'iTerm','path':'/Applications/iTerm.app','electron':False},
 {'name':'Sublime Text','path':'/Applications/Sublime Text.app','electron':False},
 {'name':'Terminal','path':'/System/Applications/Utilities/Terminal.app','electron':False},
 {'name':'Visual Studio Code','path':'/Applications/Visual Studio Code.app','electron':True},
 {'name':'Xcode','path':'/Applications/Xcode.app','electron':False},
 {'name':'Zed','path':'/Applications/Zed.app','electron':False},
]
icons = {apps[0]['path']: icon('#3d7bff'), apps[1]['path']: icon('#222'), apps[6]['path']: icon('#23a8f2'), apps[3]['path']: icon('#1a1a1a')}

MOCK = """
window.__sent = [];
window.__helloCount = 0;
window.__global = JSON.parse(sessionStorage.getItem('g') || '{}');
window.__mock = %s;
class FakeWS {
  constructor(url){ this.readyState = 0; window.__ws = this; setTimeout(()=>{ this.readyState = 1; this.onopen && this.onopen(); }, 10); }
  send(s){
    const m = JSON.parse(s); window.__sent.push(m);
    const reply = (payload, delay) => setTimeout(()=> this.onmessage && this.onmessage({data: JSON.stringify({event:'sendToPropertyInspector', payload})}), delay||20);
    if (m.event === 'getGlobalSettings') setTimeout(()=> this.onmessage && this.onmessage({data: JSON.stringify({event:'didReceiveGlobalSettings', payload:{settings: window.__global}})}), 30);
    if (m.event === 'setGlobalSettings') { window.__global = m.payload; sessionStorage.setItem('g', JSON.stringify(m.payload)); }
    if (m.event !== 'sendToPlugin') return;
    const p = m.payload, M = window.__mock;
    if (p.cmd==='hello') { window.__helloCount++; if (window.__helloCount >= 3) reply({type:'env', home: M.home, lang: 'pt', langPref: 'auto', autoLang: 'pt'}); }
    if (p.cmd==='setLanguage') reply({type:'env', home: M.home, lang: p.lang==='auto' ? 'pt' : p.lang, langPref: p.lang, autoLang: 'pt'});
    if (p.cmd==='listApps') { reply({type:'apps', apps: M.apps}, 200); reply({type:'icons', icons: M.icons}, 400); }
    if (p.cmd==='appInfo') reply({type:'appInfo', app: M.apps.find(a=>a.path===p.appPath)||{name:'x',path:p.appPath}, icon: M.icons[p.appPath]||null});
    if (p.cmd==='pick' && p.kind==='folder') reply({type:'picked', kind:'folder', paths: M.pickFolders}, 300);
    if (p.cmd==='checkPaths') { const st={}; p.paths.forEach(x=> st[x] = {exists: !x.includes('Antigo'), dir: !/\\.[a-z]+$/.test(x)}); reply({type:'pathStatus', status: st}); }
    if (p.cmd==='run') reply({type:'ran'}, 300);
  }
}
window.WebSocket = FakeWS;
""" % json.dumps({'home': H, 'apps': apps, 'icons': icons, 'pickFolders': [H+'/ACTION/Clientes/Domus/Working Files/DOMUS_API', H+'/ACTION/Clientes/Domus/Working Files/DOMUS_ADMIN']})

errors = []
with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={'width': 360, 'height': 760}, device_scale_factor=2)
    pg.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
    pg.on('pageerror', lambda e: errors.append(str(e)))
    pg.add_init_script(MOCK)
    pg.goto(UI)
    pg.evaluate("""connectElgatoStreamDeckSocket(12345, 'CTX', 'registerPropertyInspector', '{}', JSON.stringify({action:'com.fernandoschuab.openwith.open', context:'CTX', payload:{settings:{}}}))""")
    pg.wait_for_timeout(100)
    early = pg.inner_text('#testBtn').strip()
    pg.wait_for_timeout(1600)
    assert pg.evaluate('window.__helloCount') >= 3
    assert pg.inner_text('#testBtn').strip() == 'Testar agora', pg.inner_text('#testBtn')
    print('early label (before plugin reply):', early)
    pg.screenshot(path=OUT+'01_empty.png')

    # open app list
    pg.click('#appBtn'); pg.wait_for_timeout(600)
    pg.screenshot(path=OUT+'02_applist.png')
    pg.fill('#appSearch', 'anti'); pg.wait_for_timeout(100)
    pg.screenshot(path=OUT+'03_search.png')
    pg.keyboard.press('Enter'); pg.wait_for_timeout(200)
    s = pg.evaluate('window.__openWithPI.state.settings')
    assert s['appPath'] == '/Applications/Antigravity IDE.app', s
    assert s['newInstance'] is True, s

    # add folders
    pg.click('#addFolders'); pg.wait_for_timeout(100)
    busy = pg.inner_text('#addFolders')
    pg.wait_for_timeout(500)
    s = pg.evaluate('window.__openWithPI.state.settings')
    assert len(s['paths']) == 2, s
    # manual path (missing)
    pg.click('#addManual'); pg.fill('#manualInput', '~/Projetos/Antigo\\ Projeto/'); pg.keyboard.press('Enter'); pg.wait_for_timeout(300)
    s = pg.evaluate('window.__openWithPI.state.settings')
    assert s['paths'][2] == '~/Projetos/Antigo Projeto', s['paths']
    pg.evaluate("document.querySelector('.preview').open = true")
    pg.wait_for_timeout(1900)
    pg.screenshot(path=OUT+'04_filled.png', full_page=True)

    # reorder: move 2nd up
    pg.hover('.path-item >> nth=1')
    pg.click('.path-item >> nth=1 >> button[title=Subir]')
    s = pg.evaluate('window.__openWithPI.state.settings')
    assert s['paths'][0].endswith('DOMUS_ADMIN'), s['paths']
    # remove missing
    pg.hover('.path-item >> nth=2'); pg.click('.path-item >> nth=2 >> button[title=Remover]')
    s = pg.evaluate('window.__openWithPI.state.settings')
    assert len(s['paths']) == 2
    # mode together
    pg.click('#modeSeg button[data-mode=together]')
    assert pg.evaluate('window.__openWithPI.state.settings.mode') == 'together'
    assert pg.is_hidden('#delayOpt')
    pg.click('#modeSeg button[data-mode=separate]')
    # test run
    pg.click('#testBtn'); pg.wait_for_timeout(600)
    sent = pg.evaluate('window.__sent')
    last_settings = [m for m in sent if m['event']=='setSettings'][-1]['payload']
    print('last settings', json.dumps(last_settings, ensure_ascii=False))
    assert any(m['event']=='sendToPlugin' and m['payload']['cmd']=='run' for m in sent)
    print('preview:\n' + pg.inner_text('#cmdPreview'))
    print('busy label:', busy)

    # i18n
    assert pg.inner_text('#testBtn').strip() == 'Testar agora'
    assert pg.eval_on_selector('#langSel', 'e => e.options[0].textContent') == 'Automático (Português)'
    pg.select_option('#langSel', 'es'); pg.wait_for_timeout(200)
    assert pg.inner_text('#testBtn').strip() == 'Probar ahora', pg.inner_text('#testBtn')
    assert pg.inner_text('#pathCount') == '2 elementos'
    assert any(m['event']=='sendToPlugin' and m['payload'].get('cmd')=='setLanguage' and m['payload']['lang']=='es' for m in pg.evaluate('window.__sent'))
    assert pg.evaluate('window.__global') == {'language': 'es'}
    pg.screenshot(path=OUT+'06_es.png', full_page=True)
    pg.select_option('#langSel', 'en'); pg.wait_for_timeout(200)
    assert pg.inner_text('#addFolders').strip() == 'Folders'
    pg.click('#appBtn'); pg.wait_for_timeout(100); pg.fill('#appSearch', 'zzz'); pg.wait_for_timeout(100)
    assert 'No apps found' in pg.inner_text('#appList')
    pg.keyboard.press('Escape')
    pg.screenshot(path=OUT+'07_en.png', full_page=True)
    # untranslated leftovers (Portuguese words) in EN mode
    body = pg.inner_text('body')
    for w in ['Pastas','Abrir','Programa','Testar','Nenhum','Intervalo','Caminho']:
        assert w not in body, (w, body)
    pg.select_option('#langSel', 'auto'); pg.wait_for_timeout(200)
    assert pg.inner_text('#testBtn').strip() == 'Testar agora'

    # reopen: saved global preference (en) must win over system (pt); cached auto lang used before reply
    pg.select_option('#langSel', 'en'); pg.wait_for_timeout(100)
    pg.reload()
    pg.evaluate("""connectElgatoStreamDeckSocket(12345, 'CTX', 'registerPropertyInspector', '{}', JSON.stringify({action:'x', context:'CTX', payload:{settings:{}}}))""")
    pg.wait_for_function("document.querySelector('#testBtn').innerText.trim() === 'Test now'", timeout=900)
    assert pg.evaluate('window.__helloCount') < 3, 'global pref should apply before plugin reply'
    pg.wait_for_timeout(1500)
    assert pg.inner_text('#testBtn').strip() == 'Test now', pg.inner_text('#testBtn')
    assert pg.eval_on_selector('#langSel', 'e => e.value') == 'en'
    pg.select_option('#langSel', 'auto'); pg.wait_for_timeout(100)
    assert pg.inner_text('#testBtn').strip() == 'Testar agora'
    # reopen with auto + plugin silent: cached auto language (pt) is used
    pg.reload()
    pg.evaluate("window.__mock.silent = true")
    pg.evaluate("""connectElgatoStreamDeckSocket(12345, 'CTX', 'registerPropertyInspector', '{}', JSON.stringify({action:'x', context:'CTX', payload:{settings:{}}}))""")
    pg.wait_for_timeout(400)
    assert pg.evaluate('window.__helloCount') < 3
    assert pg.inner_text('#testBtn').strip() == 'Testar agora', pg.inner_text('#testBtn')
    assert pg.eval_on_selector('#langSel', 'e => e.value') == 'auto'

    # narrow width
    pg.set_viewport_size({'width': 290, 'height': 760}); pg.wait_for_timeout(100)
    pg.screenshot(path=OUT+'05_narrow.png', full_page=True)
    b.close()
print('errors:', errors)
