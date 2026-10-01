#!/usr/bin/env python3
"""Fabrique la régie d'Hélène Laudijois (/regie-helene/) à partir de la régie de l'Être (/regie/).

Copie à elle : son nom, son logo et ses couleurs, régie vierge, son propre compte chiffré, pas de visio,
stockage sous d'autres noms (aucun mélange avec la régie de l'Être).
Les images (logo.png, icone-*.png) et manifest.json de regie-helene/ ne sont pas touchés.

Usage, depuis la racine du dépôt : python3 outils/fabriquer-regie-helene.py
"""
import re, shutil, pathlib

racine = pathlib.Path(__file__).resolve().parent.parent
src, dst = racine / 'regie', racine / 'regie-helene'
dst.mkdir(exist_ok=True)
shutil.copy(src / 'lame.min.js', dst / 'lame.min.js')

s = (src / 'index.html').read_text()

def rep(a, b, n=1):
    global s
    assert s.count(a) == n, (a[:70], s.count(a))
    s = s.replace(a, b)

# Identité
rep('<meta name="apple-mobile-web-app-title" content="Régie">', '<meta name="apple-mobile-web-app-title" content="Ma régie">')
rep('<title>Régie de l’Être</title>', '<title>Régie · Hélène Laudijois Hypnocoach</title>')
rep('<div class="marque"><img src="logo.png" alt=""><span>Régie de l’Être</span></div>',
    '<div class="marque"><img src="logo.png" alt=""><span class="marque-nom">Hélène Laudijois<small>Hypnocoach</small></span></div>')
s = s.replace(':root{', '''/* Pas de visio dans cette régie : on cache ses réglages */
label.champ:has(select[data-k=visio]),.o-infos .chip[title="Mode de la salle de visio"]{display:none!important}
.marque-nom{display:flex;flex-direction:column;line-height:1.1}
.marque-nom small{font-family:var(--sans,inherit);font-style:normal;font-size:11px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:#d29a1c;margin-top:2px}
:root{''', 1)
rep('Préparez une séance une fois, guidez-la en présentiel comme en visio.', 'Préparez une séance une fois, guidez-la et enregistrez-la.')
rep("a.download=`regie-de-l-etre-sauvegarde-", "a.download=`regie-helene-laudijois-sauvegarde-")

# Stockage à part : jamais les mêmes noms que la régie de l'Être
rep("const CLE='regieEtre.v1';", "const CLE='regieHelene.v1';")
rep("localStorage.setItem('regieEtre.test','1');localStorage.removeItem('regieEtre.test')",
    "localStorage.setItem('regieHelene.test','1');localStorage.removeItem('regieHelene.test')")
rep("indexedDB.open('regie-etre',1)", "indexedDB.open('regie-helene',1)")
rep("const CLE_ENR='regieEtre.enr'", "const CLE_ENR='regieHelene.enr'")
rep("const CLE_BASE='regieEtre.base';", "const CLE_BASE='regieHelene.base';")

# Son compte : une ligne chiffrée dans la table regie_comptes (illisible pour la propriétaire de la base).
# Pas de visio.
rep("const COMPTE=null;", "const COMPTE={table:'regie_comptes'};")
s, n = re.subn(r"const RDV_API='[^']*';", "const RDV_API='';   // pas de visio dans cette régie", s); assert n == 1
s, n = re.subn(r'\n *<button class="btn" data-visio="\$\{s\.id\}"[^\n]*</button>', '', s); assert n == 1
s, n = re.subn(r'<button id="b-import">[^<]*</button>', '', s); assert n == 1
rep("$('#b-import').onclick=fenetreImport;", "")
rep("if(visioDirect)setTimeout(", "if(false)setTimeout(")

# Régie vierge
i = s.index("function contenuDepart(){"); j = s.index("const PREFS=")
s = s[:i] + "function contenuDepart(){\n  return {schema:1,maj:Date.now(),seances:[],mesBlocs:[],musiques:[],bilans:[],prefs:{}};\n}\n" + s[j:]
s = s.replace("D.seances.forEach(s=>{if(s.titre==='Méditer ensemble')s.titre='Atelier du jeudi'});", "")
# Ses couleurs : un soleil doux, tirées de son logo (crème, miel, pêche, prune et halos arc-en-ciel pastel).
# Le mode nuit garde la palette d'origine.
DOUX = """
/* ===== Palette d'Hélène : soleil très doux =====
   Les couleurs de son logo, en voiles : le soleil (miel pâle) et le cercle
   arc-en-ciel (pêche, rose, menthe, ciel, lavande), sur un fond crème. */
:root{
  --fond:#fffcf6; --carte:rgba(255,255,255,.82); --plein:#fffefb; --ink:#5b504c; --muted:#9a8e87;
  --line:#f5ede2; --line-bleu:#f1e3d0; --canard:#c9937a; --canard-deep:#bd8870; --canard-dark:#a87862; --canard-light:#fdf4ec;
  --aqua-pale:#fff6e0; --aqua:#ffeab8; --violet-soft:#f8f1f7; --violet:#e2cde0; --peri-deep:#b39bc0; --peri-darker:#8e7499;
  --info-pale:#fff6e0; --attente-pale:#fff3e3;
  --t-parole:#f6f0f9; --t-parole-f:#9a82aa; --t-instrument:#eef6f8; --t-instrument-f:#6e9fab; --t-musique:#fcf0f3; --t-musique-f:#b9849a;
  --t-silence:#f6f3ef; --t-silence-f:#9a8f87; --t-transition:#f0f7ee; --t-transition-f:#7fa47b; --t-partage:#fdf2e8; --t-partage-f:#c28e6d;
  --ombre:0 20px 50px -34px rgba(190,150,110,.32); --sable:#f8eedd;
}
body:not(.nuit)::before{background-image:
  radial-gradient(46% 36% at 90% -2%,rgba(255,232,165,.5),transparent 70%),
  radial-gradient(40% 30% at 2% 8%,rgba(252,222,226,.42),transparent 72%),
  radial-gradient(44% 30% at 98% 52%,rgba(222,240,226,.4),transparent 72%),
  radial-gradient(40% 30% at 30% 100%,rgba(220,234,246,.38),transparent 72%),
  radial-gradient(40% 30% at 0% 70%,rgba(234,224,246,.38),transparent 72%)}
body:not(.nuit) .haut{background:rgba(255,252,246,.84)}
.btn.p{box-shadow:0 14px 30px -18px rgba(179,155,192,.75)}
.btn{border-color:var(--line-bleu)}
.marque img{height:38px}
.marque span{color:var(--peri-darker)}
.marque-nom small{color:#d4a64a}
.g-texte{color:#5b504c}
.voile{background:rgba(150,125,110,.22);backdrop-filter:blur(3px)}
"""
i = s.index('</style>'); s = s[:i] + DOUX + s[i:]
s = s.replace('<meta name="theme-color" content="#f4f0fb">', '<meta name="theme-color" content="#fffaf2">')
s = s.replace("document.querySelector('meta[name=theme-color]').content=on?'#13111b':'#f4f0fb'", "document.querySelector('meta[name=theme-color]').content=on?'#13111b':'#fffaf2'")
assert 'rendez-vous.prendresoindesonhetre' not in s and "const COMPTE={table:'regie_comptes'}" in s
(dst / 'index.html').write_text(s)

# Service hors ligne : même version que la régie de l'Être, propre au dossier
w = (src / 'sw.js').read_text()
v = re.search(r"const CACHE = 'regie-etre-(v\d+)';", w).group(1)
w = w.replace(f"const CACHE = 'regie-etre-{v}';", f"const CACHE = 'regie-helene-{v}';")
w = w.replace("x.startsWith('regie-etre-')", "x.startsWith('regie-helene-')")
w = w.replace("startsWith('/regie/')", "startsWith('/regie-helene/')")
w = re.sub(r"^// Régie de l'Être — ", "// Régie d'Hélène Laudijois — ", w)
w = w.replace("Ne touche qu'aux fichiers de /regie/ ; la\n// synchronisation (Supabase) passe directement, sans cache.", "Ne touche qu'aux fichiers de /regie-helene/.")
(dst / 'sw.js').write_text(w)
print('regie-helene/ fabriquée (cache', 'regie-helene-' + v + ')')
