"""
Collecteur Dell EMC Unity — REST API
Gère plusieurs versions OE Unity (4.x et 5.x+)

Unity OE 4.x : /api/types/loginSessionInfo/instances ou Basic Auth direct
Unity OE 5.x+: /api/loginSessionInfo (session + CSRF token)

HTTP 404 sur loginSessionInfo = version ancienne → fallback vers Basic Auth direct
"""
import requests
import urllib3
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

HEALTH_MAP = {5: "OK", 10: "DEGRADED", 15: "MINOR", 20: "MAJOR", 25: "CRITICAL"}
SEV_MAP = {1: "INFO", 2: "INFO", 4: "INFO", 8: "WARNING", 16: "ERROR", 32: "ERROR", 64: "CRITICAL", 128: "CRITICAL"}

# Endpoints de login à essayer par ordre de priorité
LOGIN_ENDPOINTS = [
    "/api/loginSessionInfo",                      # Unity OE 5.x+
    "/api/types/loginSessionInfo/instances",       # Unity OE 4.x (lecture directe)
]

def _empty_result(name, ip):
    return {
        "name": name, "ip": ip, "type": "unity", "state": "DOWN",
        "model": "N/A", "firmware": "N/A", "overall_status": "unknown",
        "capacity": {"total_tb": 0, "used_tb": 0, "free_tb": 0, "used_pct": 0},
        "pools": [], "hardware": {"disks_total": 0, "disks_failed": 0, "controllers": []},
        "alerts": [], "performance": {"iops_read": 0, "iops_write": 0, "latency_ms_read": 0, "latency_ms_write": 0, "bandwidth_mbps": 0},
        "volumes": {"total": 0}
    }

def _setup_session(ip, user, password):
    """
    Tente d'établir une session avec Unity.
    Retourne (session, base_url) ou (None, error_message).
    
    Stratégie:
    1. Essai avec /api/loginSessionInfo  (Unity 5.x)
    2. Essai avec /api/types/loginSessionInfo/instances (Unity 4.x)
    3. Fallback: Basic Auth directe sans CSRF (pour versions sans protection CSRF)
    """
    base = f"https://{ip}/api"
    
    for endpoint in LOGIN_ENDPOINTS:
        session = requests.Session()
        session.verify = False
        session.headers.update({
            "X-EMC-REST-CLIENT": "true",
            "Accept": "application/json",
            "Content-Type": "application/json"
        })
        try:
            r = session.get(f"https://{ip}{endpoint}", auth=(user, password), timeout=15)
            if r.status_code == 200:
                # Login OK — récupération du CSRF token si disponible
                try:
                    body = r.json()
                    # Format Unity 5.x : {"content": {"EMCCSRFToken": "..."}}
                    csrf = body.get("content", {}).get("EMCCSRFToken", "")
                    # Format Unity 4.x : {"entries": [{"content": {"EMCCSRFToken": "..."}}]}
                    if not csrf and body.get("entries"):
                        csrf = body["entries"][0].get("content", {}).get("EMCCSRFToken", "")
                    if csrf:
                        session.headers["EMC-CSRF-TOKEN"] = csrf
                except Exception:
                    pass
                return session, base, None
            elif r.status_code == 404:
                continue  # Essai de l'endpoint suivant
            elif r.status_code == 401:
                return None, base, f"HTTP 401 — Identifiants refusés (user={user})"
            else:
                return None, base, f"HTTP {r.status_code}"
        except requests.exceptions.ConnectTimeout:
            return None, base, "Timeout TCP — baie non joignable (firewall ?)"
        except Exception as e:
            return None, base, str(e)
    
    # Fallback: Basic Auth directe — test sur une ressource simple
    session = requests.Session()
    session.verify = False
    session.auth = (user, password)
    session.headers.update({
        "X-EMC-REST-CLIENT": "true",
        "Accept": "application/json",
        "Content-Type": "application/json"
    })
    try:
        test_r = session.get(f"{base}/instances/system/0?fields=name", timeout=15)
        if test_r.status_code == 200:
            return session, base, None
        elif test_r.status_code == 422:
            return None, base, "HTTP 422 — CSRF requis mais non fourni (endpoint login inconnu pour cette version Unity)"
        else:
            return None, base, f"Basic Auth fallback: HTTP {test_r.status_code}: {test_r.text[:150]}"
    except Exception as e:
        return None, base, str(e)

def collect(ip, name, user, password):
    result = _empty_result(name, ip)

    session, base, err = _setup_session(ip, user, password)
    if not session:
        result["error"] = err
        return result

    result["state"] = "UP"

    try:
        # === Infos système ===
        r = session.get(f"{base}/instances/system/0?fields=name,model,softwareVersion,health", timeout=15)
        if r.status_code == 200:
            d = r.json().get("content", {})
            result["model"] = d.get("model", "N/A")
            result["firmware"] = d.get("softwareVersion", "N/A")
            hv = d.get("health", {}).get("value", 5)
            result["overall_status"] = HEALTH_MAP.get(hv, str(hv))

        # === Pools ===
        r = session.get(f"{base}/types/pool/instances?fields=name,health,sizeTotal,sizeUsed,sizeFree,raidType", timeout=15)
        if r.status_code == 200:
            total_cap, total_used = 0, 0
            for entry in r.json().get("entries", []):
                p = entry.get("content", {})
                st, su = p.get("sizeTotal", 0), p.get("sizeUsed", 0)
                total_cap += st; total_used += su
                ph = p.get("health", {}).get("value", 5)
                raid_raw = p.get("raidType", {})
                raid_name = raid_raw.get("name", "N/A") if isinstance(raid_raw, dict) else str(raid_raw)
                result["pools"].append({
                    "name": p.get("name", "N/A"),
                    "total_tb": round(st / (1024**4), 2),
                    "used_tb": round(su / (1024**4), 2),
                    "used_pct": round(su / st * 100, 1) if st > 0 else 0,
                    "raid": raid_name,
                    "status": HEALTH_MAP.get(ph, "N/A")
                })
            result["capacity"] = {
                "total_tb": round(total_cap / (1024**4), 2),
                "used_tb": round(total_used / (1024**4), 2),
                "free_tb": round((total_cap - total_used) / (1024**4), 2),
                "used_pct": round(total_used / total_cap * 100, 1) if total_cap > 0 else 0
            }

        # === Alertes actives (state=2 = NEW) ===
        r = session.get(f"{base}/types/alert/instances?fields=message,severity,state&filter=state eq 2", timeout=15)
        if r.status_code == 200:
            for entry in r.json().get("entries", []):
                a = entry.get("content", {})
                result["alerts"].append({
                    "severity": SEV_MAP.get(a.get("severity", 2), "INFO"),
                    "message": a.get("message", "N/A")
                })

        # === Disques ===
        r = session.get(f"{base}/types/disk/instances?fields=name,health,diskTechnology", timeout=15)
        if r.status_code == 200:
            disks = r.json().get("entries", [])
            result["hardware"]["disks_total"] = len(disks)
            result["hardware"]["disks_failed"] = sum(
                1 for d in disks if d.get("content", {}).get("health", {}).get("value", 5) != 5
            )

        # === Storage Processors (contrôleurs) ===
        r = session.get(f"{base}/types/storageProcessor/instances?fields=name,health,model", timeout=15)
        if r.status_code == 200:
            for entry in r.json().get("entries", []):
                sp = entry.get("content", {})
                ph = sp.get("health", {}).get("value", 5)
                result["hardware"]["controllers"].append({
                    "name": sp.get("name", "N/A"),
                    "status": HEALTH_MAP.get(ph, "N/A")
                })

        # === Volumes (LUNs) ===
        r = session.get(f"{base}/types/lun/instances?fields=name&compact=true", timeout=15)
        if r.status_code == 200:
            result["volumes"]["total"] = len(r.json().get("entries", []))

    except Exception as e:
        result["error"] = str(e)

    finally:
        # Déconnexion propre
        try:
            session.delete(f"{base}/loginSessionInfo", timeout=5)
        except Exception:
            pass

    return result
