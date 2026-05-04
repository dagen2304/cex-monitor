"""
Collecteur Dell EMC Unity — REST API
Gère plusieurs versions OE Unity (4.x et 5.x+)
"""
import requests
import urllib3
from app.config import Config

# On ne désactive les warnings que si l'utilisateur l'a explicitement demandé via VERIFY_SSL=False
if not Config.VERIFY_SSL:
    urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

HEALTH_MAP = {5: "OK", 10: "DEGRADED", 15: "MINOR", 20: "MAJOR", 25: "CRITICAL"}
SEV_MAP = {1: "INFO", 2: "INFO", 4: "INFO", 8: "WARNING", 16: "ERROR", 32: "ERROR", 64: "CRITICAL", 128: "CRITICAL"}

LOGIN_ENDPOINTS = [
    "/api/loginSessionInfo",                      # Unity OE 5.x+
    "/api/types/loginSessionInfo/instances",       # Unity OE 4.x
]

def _empty_result(name, ip):
    return {
        "name": name, "ip": ip, "type": "unity", "state": "DOWN",
        "model": "N/A", "firmware": "N/A", "overall_status": "unknown",
        "capacity": {"total_gb": 0, "used_gb": 0, "free_gb": 0, "used_pct": 0},
        "pools": [], "hardware": {"disks_total": 0, "disks_failed": 0, "controllers": []},
        "alerts": [], "performance": {"iops_total": 0, "bandwidth_mbps": 0, "latency_ms": 0},
        "volumes": {"total": 0}
    }

def _setup_session(ip, user, password, port=443):
    port = port or 443
    if port == 443:
        host_port = ip
    else:
        host_port = f"{ip}:{port}"
        
    base = f"https://{host_port}/api"
    for endpoint in LOGIN_ENDPOINTS:
        session = requests.Session()
        session.verify = Config.VERIFY_SSL
        if Config.CA_BUNDLE and Config.VERIFY_SSL:
            session.verify = Config.CA_BUNDLE
            
        session.headers.update({"X-EMC-REST-CLIENT": "true", "Accept": "application/json", "Content-Type": "application/json"})
        try:
            r = session.get(f"https://{host_port}{endpoint}", auth=(user, password), timeout=15)
            if r.status_code == 200:
                body = r.json()
                csrf = body.get("content", {}).get("EMCCSRFToken", "")
                if not csrf and body.get("entries"):
                    csrf = body["entries"][0].get("content", {}).get("EMCCSRFToken", "")
                if csrf:
                    session.headers["EMC-CSRF-TOKEN"] = csrf
                return session, base, None
            elif r.status_code == 404:
                continue
            elif r.status_code == 401:
                return None, base, f"HTTP 401 — Identifiants refusés (user={user})"
            else:
                return None, base, f"HTTP {r.status_code}"
        except requests.exceptions.SSLError as e:
            return None, base, f"Erreur SSL: {e}. Vérifiez VERIFY_SSL."
        except requests.exceptions.ConnectTimeout:
            return None, base, "Timeout de connexion (15s)"
        except requests.exceptions.ConnectionError:
            return None, base, "Erreur de connexion réseau"
        except Exception as e:
            return None, base, f"Erreur inattendue: {str(e)}"
    return None, base, "Impossible d'établir une session"

def _fetch_system_info(session, base, result):
    r = session.get(f"{base}/instances/system/0?fields=name,model,softwareVersion,health", timeout=15)
    if r.status_code == 200:
        d = r.json().get("content", {})
        result["model"] = d.get("model", "N/A")
        result["firmware"] = d.get("softwareVersion", "N/A")
        hv = d.get("health", {}).get("value", 5)
        result["overall_status"] = HEALTH_MAP.get(hv, str(hv))

def _fetch_pools(session, base, result):
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
            "total_gb": round(total_cap / (1024**3), 2),
            "used_gb": round(total_used / (1024**3), 2),
            "free_gb": round((total_cap - total_used) / (1024**3), 2),
            "used_pct": round(total_used / total_cap * 100, 1) if total_cap > 0 else 0
        }

def _fetch_alerts(session, base, result):
    r = session.get(f"{base}/types/alert/instances?fields=message,severity,state&filter=state eq 2", timeout=15)
    if r.status_code == 200:
        for entry in r.json().get("entries", []):
            a = entry.get("content", {})
            result["alerts"].append({
                "id": a.get("id", "N/A"),
                "severity": SEV_MAP.get(a.get("severity", 2), "INFO"),
                "message": a.get("message", "N/A"),
                "timestamp": a.get("timestamp", "N/A"),
                "component": a.get("component", "System")
            })

def _fetch_hardware(session, base, result):
    # Disks
    r = session.get(f"{base}/types/disk/instances?fields=name,health,diskTechnology", timeout=15)
    if r.status_code == 200:
        disks = r.json().get("entries", [])
        result["hardware"]["disks_total"] = len(disks)
        result["hardware"]["disks_failed"] = sum(1 for d in disks if d.get("content", {}).get("health", {}).get("value", 5) != 5)
    
    # Controllers
    r = session.get(f"{base}/types/storageProcessor/instances?fields=name,health,model", timeout=15)
    if r.status_code == 200:
        for entry in r.json().get("entries", []):
            sp = entry.get("content", {})
            ph = sp.get("health", {}).get("value", 5)
            result["hardware"]["controllers"].append({
                "name": sp.get("name", "N/A"),
                "status": HEALTH_MAP.get(ph, "N/A")
            })

def _fetch_volumes(session, base, result):
    r = session.get(f"{base}/types/lun/instances?fields=name&compact=true", timeout=15)
    if r.status_code == 200:
        result["volumes"]["total"] = len(r.json().get("entries", []))

def _fetch_performance(session, base, result):
    r = session.get(f"{base}/types/system/0?fields=currIops,currBandwidth,currLatency", timeout=10)
    if r.status_code == 200:
        p = r.json().get("content", {})
        result["performance"] = {
            "iops_total": round(p.get("currIops", 0), 0),
            "bandwidth_mbps": round(p.get("currBandwidth", 0) / (1024**2), 2),
            "latency_ms": round(p.get("currLatency", 0) / 1000, 2)
        }

def collect(ip, name, user, password, port=443, extra_params=None):
    result = _empty_result(name, ip)
    session, base, err = _setup_session(ip, user, password, port)
    if not session:
        result["error"] = err
        result["overall_status"] = "Red"
        return result

    result["state"] = "UP"
    try:
        _fetch_system_info(session, base, result)
        _fetch_pools(session, base, result)
        _fetch_alerts(session, base, result)
        _fetch_hardware(session, base, result)
        _fetch_volumes(session, base, result)
        _fetch_performance(session, base, result)
    except Exception as e:
        result["error"] = str(e)
    finally:
        try:
            session.delete(f"{base}/loginSessionInfo", timeout=5)
        except Exception:
            pass
    return result
