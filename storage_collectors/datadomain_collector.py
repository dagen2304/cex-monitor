"""
Collecteur Dell EMC Data Domain — REST API
PORT : 3009 (pas 443 !)
Auth : POST https://{ip}:3009/rest/v1.0/auth
Body : {"auth_info": {"username": "...", "password": "..."}}
Auth type : session cookie (pas de token dans le header)
"""
import requests
import urllib3
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

DD_PORT = 3009
# On teste v1.0 en premier car c'est la seule qui fonctionne sur DDOS courant
API_VERSIONS = ["v1.0", "v2.0", "v3.0"]

def _empty_result(name, ip):
    return {
        "name": name, "ip": ip, "type": "datadomain", "state": "DOWN",
        "model": "N/A", "firmware": "N/A", "overall_status": "unknown",
        "capacity": {"total_tb": 0, "used_tb": 0, "free_tb": 0, "used_pct": 0},
        "compression": {"dedup_ratio": 0, "compression_ratio": 0, "total_savings_pct": 0, "pre_comp_tb": 0},
        "pools": [], "hardware": {"disks_total": 0, "disks_failed": 0, "controllers": []},
        "alerts": [], "performance": {"iops_read": 0, "iops_write": 0, "latency_ms_read": 0, "latency_ms_write": 0, "bandwidth_mbps": 0},
        "volumes": {"total": 0}
    }

def _login(session, ip, user, password):
    """
    Auth Data Domain via POST /auth
    Body: {"auth_info": {"username": "...", "password": "..."}}
    Réponse: cookie de session (pas de token dans le body ni le header)
    Retourne (base_url, version) ou (None, error).
    """
    for ver in API_VERSIONS:
        base = f"https://{ip}:{DD_PORT}/rest/{ver}"
        try:
            r = session.post(
                f"{base}/auth",
                json={"auth_info": {"username": user, "password": password}},
                timeout=15
            )
            if r.status_code in [200, 201]:
                # Succès — session cookie automatiquement stockée par requests.Session
                # Optionnel: récupérer le token s'il est dans le body
                try:
                    body = r.json()
                    token = body.get("auth_info", {}).get("token", "")
                    if token:
                        session.headers["X-Auth-Token"] = token
                except Exception:
                    pass
                return base, None
            elif r.status_code == 401:
                return None, "Identifiants refusés (HTTP 401)"
            # 404 = version non disponible, on essaie la suivante
        except Exception as e:
            return None, str(e)
    return None, f"Aucune version API disponible sur port {DD_PORT}"

def collect(ip, name, user, password):
    result = _empty_result(name, ip)
    session = requests.Session()
    session.verify = False
    session.headers.update({
        "Accept": "application/json",
        "Content-Type": "application/json"
    })

    try:
        # === Login ===
        base, err = _login(session, ip, user, password)
        if not base:
            result["error"] = err
            return result

        result["state"] = "UP"

        # === Infos système — endpoints par priorité ===
        for sys_path in ["/system", "/dd-systems/0"]:
            r = session.get(f"{base}{sys_path}", timeout=15)
            if r.status_code == 200:
                body = r.json()
                # Format possible: {"system_info": {...}} ou flat
                sys_data = body.get("system_info", body.get("system", body))
                result["model"] = sys_data.get("model", sys_data.get("modelNumber", "N/A"))
                result["firmware"] = sys_data.get("version", sys_data.get("ddosVersion", "N/A"))
                result["overall_status"] = sys_data.get("status", "OK")
                break

        # === Filesystem / Capacité + Compression ===
        for fs_path in ["/dd-systems/0/filesys", "/filesys"]:
            r = session.get(f"{base}{fs_path}", timeout=15)
            if r.status_code == 200:
                body = r.json()
                fs = body.get("filesys", body.get("filesystem", body))

                # Capacité (valeurs en octets)
                space = fs.get("space_usage", fs)
                total_b = space.get("total", space.get("size", 0))
                used_b  = space.get("used",  space.get("used_size", 0))
                free_b  = space.get("avail", space.get("available", 0))

                if total_b:
                    result["capacity"] = {
                        "total_tb": round(total_b / (1024**4), 2),
                        "used_tb":  round(used_b  / (1024**4), 2),
                        "free_tb":  round(free_b  / (1024**4), 2),
                        "used_pct": round(used_b / total_b * 100, 1) if total_b else 0
                    }

                # Compression / déduplication
                comp = fs.get("compression", {})
                if comp:
                    result["compression"] = {
                        "dedup_ratio":       round(float(comp.get("local_comp_factor",  0) or 0), 2),
                        "compression_ratio": round(float(comp.get("global_comp_factor", 0) or 0), 2),
                        "total_savings_pct": round(float(comp.get("total_comp_factor",  0) or 0), 2),
                        "pre_comp_tb": round(
                            float(comp.get("pre_comp_used", 0) or 0) / (1024**4), 2
                        )
                    }
                break

        # === Alertes actives ===
        for alert_path in ["/dd-systems/0/alerts/current-alerts", "/alerts/current-alerts"]:
            r = session.get(f"{base}{alert_path}", timeout=15)
            if r.status_code == 200:
                body = r.json()
                alert_list = body.get("alert", body.get("alerts", []))
                for a in (alert_list if isinstance(alert_list, list) else []):
                    result["alerts"].append({
                        "severity": str(a.get("severity", "INFO")).upper(),
                        "message": a.get("message", a.get("description", "N/A"))
                    })
                break

        # === Disques ===
        for disk_path in ["/dd-systems/0/disk", "/disk"]:
            r = session.get(f"{base}{disk_path}", timeout=15)
            if r.status_code == 200:
                body = r.json()
                disks = body.get("disk", body.get("disks", []))
                result["hardware"]["disks_total"] = len(disks)
                result["hardware"]["disks_failed"] = sum(
                    1 for d in disks
                    if str(d.get("state", "normal")).upper() not in ["NORMAL", "OK", "ACTIVE"]
                )
                break

    except Exception as e:
        result["state"] = "DOWN"
        result["error"] = str(e)

    finally:
        # Déconnexion propre
        try:
            if base:
                session.delete(f"{base}/auth", timeout=5)
        except Exception:
            pass

    return result
