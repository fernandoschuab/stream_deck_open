import base64, json, os
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__))
UI = 'file://' + HERE + '/../com.fernandoschuab.openwith.sdPlugin/ui/open.html'
icon = 'data:image/png;base64,' + base64.b64encode(open(HERE + '/out/editor-icon-128.png','rb').read()).decode()
H = '/Users/you'
APP = '/Applications/Code Editor.app'
M = {'home': H, 'apps': [{'name':'Code Editor','path':APP,'electron':True}], 'icons': {APP: icon}}
MOCK = """
window.__mock = %s;
class FakeWS { constructor(){ this.readyState=0; setTimeout(()=>{this.readyState=1; this.onopen&&this.onopen();},5); }
 send(s){ const m=JSON.parse(s); if(m.event!=='sendToPlugin') return; const p=m.payload, M=window.__mock;
  const r=(pl)=>setTimeout(()=>this.onmessage&&this.onmessage({data:JSON.stringify({event:'sendToPropertyInspector',payload:pl})}),5);
  if(p.cmd==='hello') r({type:'env',home:M.home,lang:'en',langPref:'auto',autoLang:'en'});
  if(p.cmd==='appInfo') r({type:'appInfo',app:M.apps[0],icon:M.icons[p.appPath]});
  if(p.cmd==='checkPaths'){const st={};p.paths.forEach(x=>st[x]={exists:true,dir:true});r({type:'pathStatus',status:st});}
 } }
window.WebSocket = FakeWS;
""" % json.dumps(M)
FONTS = ''.join(f"@font-face{{font-family:Inter;font-weight:{w};src:url('file://{HERE}/fonts/inter-latin-{w}-normal.woff2') format('woff2')}}" for w in (400,500,600,700,800))
settings = {'appPath': APP, 'appName': 'Code Editor', 'paths': [H+'/Projects/acme/api', H+'/Projects/acme/web', H+'/Projects/acme/docs'],
            'mode':'separate','newInstance':True,'delay':300,'useAppIcon':True}
with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={'width': 380, 'height': 900}, device_scale_factor=2)
    pg.add_init_script(MOCK)
    pg.goto(UI)
    pg.add_style_tag(content=FONTS + 'html,body{font-family:Inter,sans-serif !important}')
    pg.evaluate("connectElgatoStreamDeckSocket(1,'CTX','registerPropertyInspector','{}',%s)" % json.dumps(json.dumps({'action':'x','context':'CTX','payload':{'settings':settings}})))
    pg.wait_for_timeout(500)
    pg.evaluate("document.fonts.ready")
    pg.evaluate("(()=>{const h=document.getElementById('niHint');h.textContent='Turned on automatically (Electron app)';h.classList.add('auto');})()")
    box = pg.locator('#testBtn').bounding_box()
    pg.screenshot(path=HERE + '/out/ui-en.png', clip={'x':0,'y':0,'width':380,'height':box['y']+box['height']+14})
    b.close()
