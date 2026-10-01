#!/usr/bin/env python3
"""Fabrique la régie d'Hélène Laudijois (/regie-helene/) à partir de la régie de l'Être (/regie/).

Copie autonome : son nom et son logo, régie vierge, ni synchronisation ni visio,
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

# Aucun compte : ni synchronisation, ni visio
s, n = re.subn(r"const SB_URL='[^']*';", "const SB_URL='';   // régie autonome : aucun compte, aucune synchronisation", s); assert n == 1
s, n = re.subn(r"const SB_KEY='[^']*';", "const SB_KEY='';", s); assert n == 1
s, n = re.subn(r"const RDV_API='[^']*';", "const RDV_API='';   // pas de visio dans cette régie", s); assert n == 1
rep("function planifierSync(){", "function planifierSync(){return;")
rep("async function synchroniser(){", "async function synchroniser(){return;")
rep("function demarrerSync(){", "function demarrerSync(){return;")
rep('<button class="sync" id="etat-sync" type="button"></button>', '')
s, n = re.subn(r'\n *<button class="btn" data-visio="\$\{s\.id\}"[^\n]*</button>', '', s); assert n == 1
s, n = re.subn(r'<button id="b-import">[^<]*</button>', '', s); assert n == 1
rep("$('#b-import').onclick=fenetreImport;", "")
rep("if(visioDirect)setTimeout(", "if(false)setTimeout(")

# Régie vierge
i = s.index("function contenuDepart(){"); j = s.index("const PREFS=")
s = s[:i] + "function contenuDepart(){\n  return {schema:1,maj:Date.now(),seances:[],mesBlocs:[],musiques:[],bilans:[],prefs:{}};\n}\n" + s[j:]
s = s.replace("D.seances.forEach(s=>{if(s.titre==='Méditer ensemble')s.titre='Atelier du jeudi'});", "")
assert 'issedanlnadbhidlymnc' not in s and 'rendez-vous.prendresoindesonhetre' not in s
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
