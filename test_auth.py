"""
Script de test d'authentification pour les baies de stockage.
Usage: python test_auth.py
"""
import requests, urllib3, os, json
from dotenv import load_dotenv
load_dotenv()
urllib3.disable_warnings()

SEP = "=" * 65

def ok(msg):  print(f"  [OK] {msg}")
def ko(msg):  print(f"  [KO] {msg}")
def inf(msg): print(f"  [INF] {msg}")

# ─────────────────────────────────────────────
def test_dorado(name, ip, user, pwd):
    print(f"\n{SEP}\n DORADO : {name} ({ip})  user={user}\n{SEP}")
    for scope, label in [(1, "LDAP/Domaine"), (0, "Local")]:
        url = f"https://{ip}:8088/deviceManager/rest/xxxxx/sessions"
        try:
            r = requests.post(url, json={"username": user, "password": pwd, "scope": scope},
                              verify=False, timeout=10)
            body = r.json()
            code = body.get("error", {}).get("code", -1)
            desc = body.get("error", {}).get("description", "")
            if code == 0:
                device = body["data"]["deviceid"]
                ok(f"scope={scope} ({label}) => Connecté ! device_id={device}")
                try:
                    requests.delete(f"https://{ip}:8088/deviceManager/rest/{device}/sessions",
                                    headers={"iBaseToken": body["data"]["iBaseToken"]},
                                    verify=False, timeout=5)
                except Exception:
                    pass
                return
            else:
                ko(f"scope={scope} ({label}) => code={code}: {desc}")
        except Exception as e:
            ko(f"scope={scope} ({label}) => {e}")
    inf("Conseil: vérifiez DORADO_USER et DORADO_PASSWORD dans .env")
    inf("Format username LDAP: essayez 'user' seul, puis 'domain\\\\user' si échec")

# ─────────────────────────────────────────────
def test_unity(name, ip, user, pwd):
    print(f"\n{SEP}\n UNITY : {name} ({ip})  user={user}\n{SEP}")
    base = f"https://{ip}/api"
    endpoints = [
        ("/api/loginSessionInfo",                   "OE 5.x"),
        ("/api/types/loginSessionInfo/instances",   "OE 4.x"),
    ]
    for endpoint, label in endpoints:
        s = requests.Session()
        s.verify = False
        s.headers.update({"X-EMC-REST-CLIENT": "true", "Accept": "application/json"})
        try:
            r = s.get(f"https://{ip}{endpoint}", auth=(user, pwd), timeout=12)
            if r.status_code == 200:
                csrf = ""
                try:
                    body = r.json()
                    csrf = body.get("content", {}).get("EMCCSRFToken", "")
                    if not csrf and body.get("entries"):
                        csrf = body["entries"][0].get("content", {}).get("EMCCSRFToken", "")
                except Exception:
                    pass
                ok(f"Login OK via {endpoint} ({label}) — CSRF={'présent' if csrf else 'absent'}")
                try: s.delete(f"{base}/loginSessionInfo", timeout=5)
                except Exception: pass
                return
            elif r.status_code == 404:
                inf(f"{endpoint} => 404 (non trouvé sur cette version)")
            elif r.status_code == 401:
                ko(f"{endpoint} => 401 — Identifiants refusés")
                return
            else:
                inf(f"{endpoint} => HTTP {r.status_code}: {r.text[:100]}")
        except requests.exceptions.ConnectTimeout:
            ko("Timeout TCP — baie non joignable (firewall ?)")
            return
        except Exception as e:
            inf(f"{endpoint} => {e}")
    
    # Fallback: Basic Auth directe
    inf("Tentative Basic Auth directe (sans login session)...")
    s2 = requests.Session()
    s2.verify = False
    s2.auth = (user, pwd)
    s2.headers.update({"X-EMC-REST-CLIENT": "true", "Accept": "application/json"})
    try:
        r = s2.get(f"{base}/instances/system/0?fields=name,model", timeout=12)
        if r.status_code == 200:
            model = r.json().get("content", {}).get("model", "?")
            ok(f"Basic Auth directe => OK ! Modèle: {model}")
        elif r.status_code == 422:
            ko("Basic Auth directe => 422 (CSRF requis mais pas de session)")
        elif r.status_code == 401:
            ko("Basic Auth directe => 401 — Identifiants incorrects")
        else:
            ko(f"Basic Auth directe => HTTP {r.status_code}: {r.text[:150]}")
    except Exception as e:
        ko(f"Basic Auth directe => {e}")

# ─────────────────────────────────────────────
def test_powerstore(name, ip, user, pwd):
    print(f"\n{SEP}\n POWERSTORE : {name} ({ip})  user={user}\n{SEP}")
    inf("Connexion en cours (peut prendre jusqu'à 120s)...")
    try:
        r = requests.get(f"https://{ip}/api/rest/cluster?select=id,name,state",
                         auth=(user, pwd), verify=False, timeout=120)
        if r.status_code in [200, 206]:
            data = r.json()
            cl = data[0] if data else {}
            ok(f"Connecté ! Cluster={cl.get('name','?')} | State={cl.get('state','?')}")
        elif r.status_code == 401:
            ko("HTTP 401 — Identifiants refusés")
        else:
            ko(f"HTTP {r.status_code}: {r.text[:150]}")
    except requests.exceptions.ReadTimeout:
        ko("Read timeout (>30s) — vérifiez que l'IP est bien celle du port MANAGEMENT (pas DATA)")
    except requests.exceptions.ConnectTimeout:
        ko("Connect timeout — baie non joignable depuis ce serveur (firewall ?)")
    except Exception as e:
        ko(str(e))

# ─────────────────────────────────────────────
def test_datadomain(name, ip, user, pwd):
    print(f"\n{SEP}\n DATA DOMAIN : {name} ({ip})  user={user}\n{SEP}")
    inf(f"Port cible: 3009 (API Data Domain)")
    s = requests.Session()
    s.verify = False
    s.headers.update({"Accept": "application/json", "Content-Type": "application/json"})

    # Test TCP port 3009 d'abord
    import socket
    try:
        sock = socket.create_connection((ip, 3009), timeout=5)
        sock.close()
        ok("Port 3009 joignable")
    except Exception as e:
        ko(f"Port 3009 NON joignable: {e}")
        inf("Vérifiez: sudo adminaccess enable https sur le Data Domain CLI")
        return

    # Auth sur chaque version
    for ver in ["v3.0", "v2.0", "v1.0"]:
        base = f"https://{ip}:3009/rest/{ver}"
        try:
            r = s.post(f"{base}/auth",
                       json={"auth_info": {"username": user, "password": pwd}},
                       timeout=10)
            inf(f"/rest/{ver}/auth => HTTP {r.status_code}")
            if r.status_code in [200, 201]:
                token = r.headers.get("X-Auth-Token", "")
                if not token:
                    try: token = r.json().get("auth_info", {}).get("token", "")
                    except Exception: pass
                ok(f"Auth OK sur /rest/{ver}/ ! Token: {token[:16]}..." if token else f"Auth OK (pas de token dans la réponse)")
                inf(f"Réponse body: {r.text[:300]}")
                # Logout
                try:
                    s.headers["X-Auth-Token"] = token
                    s.delete(f"{base}/auth", timeout=5)
                except Exception: pass
                return
            elif r.status_code == 401:
                ko(f"/rest/{ver}/auth => 401 Identifiants refusés")
                break
            elif r.status_code == 404:
                inf(f"/rest/{ver}/auth => 404 (cette version API absente)")
            else:
                inf(f"/rest/{ver}/auth => HTTP {r.status_code}: {r.text[:100]}")
        except Exception as e:
            inf(f"/rest/{ver}/auth => {e}")

    ko("Aucune auth réussie")
    inf("Si le port 3009 est joignable mais l'auth échoue:")
    inf("  1. Vérifiez les identifiants DD_USER/DD_PASSWORD dans .env")
    inf("  2. Sur le DD CLI: adminaccess show (vérifiez 'http-service: enabled')")

# ─────────────────────────────────────────────
print(f"\n{'#'*65}")
print("  TEST D'AUTHENTIFICATION — BAIES DE STOCKAGE NOC")
print(f"{'#'*65}")

for n in ["1","2"]:
    ip = os.getenv(f"DORADO_{n}_IP")
    if ip:
        test_dorado(os.getenv(f"DORADO_{n}_NAME", f"Dorado-{n}"), ip,
                    os.getenv("DORADO_USER",""), os.getenv("DORADO_PASSWORD",""))

for n in ["1","2","3","4","5","6","7","8"]:
    ip = os.getenv(f"UNITY_{n}_IP")
    if ip:
        test_unity(os.getenv(f"UNITY_{n}_NAME", f"Unity-{n}"), ip,
                   os.getenv("UNITY_USER",""), os.getenv("UNITY_PASSWORD",""))

for n in ["1","2","3"]:
    ip = os.getenv(f"POWERSTORE_{n}_IP")
    if ip:
        test_powerstore(os.getenv(f"POWERSTORE_{n}_NAME", f"PS-{n}"), ip,
                        os.getenv("POWERSTORE_USER",""), os.getenv("POWERSTORE_PASSWORD",""))

for n in ["1","2","3"]:
    ip = os.getenv(f"DD_{n}_IP")
    if ip:
        test_datadomain(os.getenv(f"DD_{n}_NAME", f"DD-{n}"), ip,
                        os.getenv("DD_USER",""), os.getenv("DD_PASSWORD",""))

print(f"\n{'#'*65}")
print("  FIN DES TESTS")
print(f"{'#'*65}\n")
