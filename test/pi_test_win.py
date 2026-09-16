"""Teste da UI no modo Windows (WebSocket simulado)."""
import json
from playwright.sync_api import sync_playwright

UI = 'file:///home/claude/openwith/com.fernandoschuab.openwith.sdPlugin/ui/open.html'
OUT = '/home/claude/openwith/test/'
H = 'C:\\Users\\Fer'
apps = [
    {'name': 'Visual Studio Code', 'path': H + '\\AppData\\Local\\Programs\\Microsoft VS Code\\Code.exe', 'electron': True},
    {'name': 'Explorador de Arquivos', 'path': 'C:\\Windows\\explorer.exe', 'electron': False},
    {'name': 'Notepad++', 'path': 'C:\\Program Files\\Notepad++\\notepad++.exe', 'electron': False},
]
M = {'home': H, 'apps': apps, 'pickFolders': ['C:\\Projetos\\Domus\\DOMUS_API', 'C:\\Projetos\\Domus\\DOMUS_ADMIN']}
MOCK = """
window.__sent = []; window.__mock = %s;
class FakeWS {
  constructor(){ this.readyState=0; setTimeout(()=>{this.readyState=1; this.onopen&&this.onopen();},5); }
  send(s){ const m=JSON.parse(s); window.__sent.push(m); const M=window.__mock;
    const r=(pl,d)=>setTimeout(()=>this.onmessage&&this.onmessage({data:JSON.stringify({event:'sendToPropertyInspector',payload:pl})}),d||10);
    if(m.event==='getGlobalSettings') setTimeout(()=>this.onmessage({data:JSON.stringify({event:'didReceiveGlobalSettings',payload:{settings:{}}})}),10);
    if(m.event!=='sendToPlugin') return; const p=m.payload;
    if(p.cmd==='hello') r({type:'env',home:M.home,platform:'windows',lang:'pt',langPref:'auto',autoLang:'pt'});
    if(p.cmd==='listApps') r({type:'apps',apps:M.apps},50);
    if(p.cmd==='pick'&&p.kind==='folder') setTimeout(()=>r({type:'picked',kind:'folder',paths:M.pickFolders}),300);
    if(p.cmd==='checkPaths'){const st={};p.paths.forEach(x=>st[x]={exists:!/Antigo/i.test(x),dir:true});r({type:'pathStatus',status:st});}
  } }
window.WebSocket = FakeWS;
""" % json.dumps(M)

errors = []
with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={'width': 360, 'height': 900}, device_scale_factor=2)
    pg.on('pageerror', lambda e: errors.append(str(e)))
    pg.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
    pg.add_init_script(MOCK)
    pg.goto(UI)
    info = json.dumps({'application': {'language': 'en', 'platform': 'windows'}})
    pg.evaluate("connectElgatoStreamDeckSocket(1,'CTX','registerPropertyInspector',%s,%s)" % (json.dumps(info), json.dumps(json.dumps({'action': 'x', 'context': 'CTX', 'payload': {'settings': {}}}))))
    pg.wait_for_timeout(300)
    st = lambda: pg.evaluate('window.__openWithPI.state')
    assert st()['platform'] == 'windows'
    assert pg.is_hidden('#niOpt'), 'nova instância deve ficar oculta no Windows'
    assert pg.get_attribute('#manualInput', 'placeholder') == 'C:\\Projetos\\minha-pasta'
    assert pg.inner_text('#appOther').strip() == 'Escolher outro app…'

    # app
    pg.click('#appBtn'); pg.wait_for_timeout(200)
    assert 'Electron' not in pg.inner_text('#appList')
    pg.fill('#appSearch', 'visual'); pg.keyboard.press('Enter'); pg.wait_for_timeout(100)
    s = st()['settings']
    assert s['appPath'].endswith('Code.exe') and s['newInstance'] is False, s
    assert pg.inner_text('#appSub').strip().lstrip('\u200e') == '~\\AppData\\Local\\Programs\\Microsoft VS Code\\Code.exe', pg.inner_text('#appSub')

    # pick
    pg.click('#addFolders'); pg.wait_for_timeout(50)
    assert pg.inner_text('#addFolders').strip() == 'Explorador…'
    pg.wait_for_timeout(500)
    assert pg.inner_text('#addFolders').strip() == 'Pastas'
    # manual: barras normais, barra final, duplicata sem diferenciar maiúsculas
    pg.click('#addManual')
    pg.fill('#manualInput', 'C:/Projetos/Antigo Projeto/'); pg.keyboard.press('Enter'); pg.wait_for_timeout(100)
    pg.fill('#manualInput', 'c:\\projetos\\domus\\domus_api'); pg.keyboard.press('Enter'); pg.wait_for_timeout(100)
    assert 'já está na lista' in pg.inner_text('#toast')
    pg.fill('#manualInput', 'C:\\'); pg.keyboard.press('Enter'); pg.wait_for_timeout(200)
    s = st()['settings']
    assert s['paths'] == ['C:\\Projetos\\Domus\\DOMUS_API', 'C:\\Projetos\\Domus\\DOMUS_ADMIN', 'C:\\Projetos\\Antigo Projeto', 'C:\\'], s['paths']
    names = pg.eval_on_selector_all('.path-name', 'els => els.map(e => e.textContent)')
    dirs = pg.eval_on_selector_all('.path-dir', 'els => els.map(e => e.textContent.replace(/\\u200e/g, ""))')
    assert names == ['DOMUS_API', 'DOMUS_ADMIN', 'Antigo Projeto', 'C:\\'], names
    assert dirs[0] == 'C:\\Projetos\\Domus' and dirs[2] == 'Não encontrado', dirs
    # remove root item
    pg.hover('.path-item >> nth=3'); pg.click('.path-item >> nth=3 >> button[title=Remover]')

    pg.evaluate("document.querySelector('.preview').open = true")
    pg.wait_for_timeout(1900)
    prev = pg.inner_text('#cmdPreview')
    print(prev)
    exe = "'C:\\Users\\Fer\\AppData\\Local\\Programs\\Microsoft VS Code\\Code.exe'"
    assert prev.splitlines() == [
        f"Start-Process {exe} -ArgumentList 'C:\\Projetos\\Domus\\DOMUS_API'",
        "Start-Sleep -Milliseconds 300",
        f"Start-Process {exe} -ArgumentList 'C:\\Projetos\\Domus\\DOMUS_ADMIN'",
    ], prev
    pg.click('#modeSeg button[data-mode=together]')
    assert pg.inner_text('#cmdPreview').splitlines() == [
        f"Start-Process {exe} -ArgumentList 'C:\\Projetos\\Domus\\DOMUS_API', 'C:\\Projetos\\Domus\\DOMUS_ADMIN'"]
    pg.click('#modeSeg button[data-mode=separate]')
    pg.screenshot(path=OUT + 'win_pt.png', full_page=True)
    pg.select_option('#langSel', 'en'); pg.wait_for_timeout(100)
    assert pg.get_attribute('#manualInput', 'placeholder') == 'C:\\Projects\\my-folder'
    pg.screenshot(path=OUT + 'win_en.png', full_page=True)
    b.close()
print('errors:', errors)
assert not errors
print('WIN UI OK')
