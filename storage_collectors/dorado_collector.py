"""
Collecteur Huawei OceanStor Dorado — REST API
Auth: Session Token (iBaseToken)
Port: 8088
"""
import requests
import urllib3
import os
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

HUAWEI_SEV = {"1": "CRITICAL", "2": "MAJOR", "3": "WARNING", "4": "INFO"}

# scope=0 : compte local Dorado (ACTIF)
# scope=1 : compte LDAP/Domaine (Active Directory)
DORADO_AUTH_SCOPE = int(os.getenv("DORADO_SCOPE", "0"))  # Local par défaut

def _empty_result(name, ip):
    return {
        "name": name, "ip": ip, "type": "dorado", "state": "DOWN",
        "model": "N/A", "firmware": "N/A", "overall_status": "unknown",
        "capacity": {"total_gb": 0, "used_gb": 0, "free_gb": 0, "used_pct": 0},
        "pools": [], "hardware": {"disks_total": 0, "disks_failed": 0, "controllers": []},
        "alerts": [], "performance": {"iops_read": 0, "iops_write": 0, "latency_ms_read": 0, "latency_ms_write": 0, "bandwidth_mbps": 0},
        "volumes": {"total": 0}
    }

def collect(ip, name, user, password):
    result = _empty_result(name, ip)
    session = requests.Session()
    session.verify = False
    session.headers.update({"Accept": "application/json", "Content-Type": "application/json"})
    port = 8088
    base_login = f"https://{ip}:{port}/deviceManager/rest/xxxxx"

    try:
        # Step 1: Login (scope=1 = LDAP/Domaine)
        login_r = session.post(f"{base_login}/sessions",
                               json={"username": user, "password": password, "scope": DORADO_AUTH_SCOPE},
                               timeout=15)
        if login_r.status_code != 200:
            result["error"] = f"Login HTTP {login_r.status_code}"
            return result

        login_data = login_r.json()
        err_code = login_data.get("error", {}).get("code", -1)
        if err_code != 0:
            err_desc = login_data.get("error", {}).get("description", "Auth failed")
            if err_code in [-401, 1077949061]:
                result["error"] = f"Identifiants Dorado incorrects: {err_desc}. Vérifiez DORADO_USER/DORADO_PASSWORD dans .env"
            else:
                result["error"] = f"Erreur login Dorado (code {err_code}): {err_desc}"
            return result

        device_id = login_data["data"]["deviceid"]
        token = login_data["data"]["iBaseToken"]
        session.headers.update({"iBaseToken": token})
        base = f"https://{ip}:{port}/deviceManager/rest/{device_id}"
        result["state"] = "UP"

        # Step 2: System info
        r = session.get(f"{base}/system/", timeout=15)
        if r.status_code == 200 and r.json().get("error", {}).get("code", -1) == 0:
            sys_data = r.json().get("data", {})
            result["model"] = sys_data.get("productModel", "N/A")
            result["firmware"] = sys_data.get("pointRelease", "N/A")
            health_status = sys_data.get("healthStatus", "1")
            result["overall_status"] = "OK" if health_status == "1" else "DEGRADED"

        # Step 3: Storage Pools
        r = session.get(f"{base}/storagepool", timeout=15)
        if r.status_code == 200 and r.json().get("error", {}).get("code", -1) == 0:
            total_cap, total_used = 0, 0
            for pool in r.json().get("data", []):
                # Huawei returns capacity in sectors (512 bytes) or MB depending on version
                raw_total = int(pool.get("USERTOTALCAPACITY", 0))
                raw_used = int(pool.get("USERCONSUMEDCAPACITY", 0))
                # Convert from 512-byte sectors to bytes
                cap_bytes = raw_total * 512
                used_bytes = raw_used * 512
                total_cap += cap_bytes
                total_used += used_bytes
                health = "OK" if pool.get("HEALTHSTATUS") == "1" else "DEGRADED"
                result["pools"].append({
                    "name": pool.get("NAME", "N/A"),
                    "total_tb": round(cap_bytes / (1024**4), 2),
                    "used_tb": round(used_bytes / (1024**4), 2),
                    "used_pct": round(used_bytes / cap_bytes * 100, 1) if cap_bytes > 0 else 0,
                    "raid": pool.get("DISKDOMAINTYPE", "N/A"),
                    "status": health
                })
            result["capacity"] = {
                "total_gb": round(total_cap / (1024**3), 2),
                "used_gb": round(total_used / (1024**3), 2),
                "free_gb": round((total_cap - total_used) / (1024**3), 2),
                "used_pct": round(total_used / total_cap * 100, 1) if total_cap > 0 else 0
            }

        # Step 4: Controllers
        r = session.get(f"{base}/controller", timeout=15)
        if r.status_code == 200 and r.json().get("error", {}).get("code", -1) == 0:
            for ctrl in r.json().get("data", []):
                result["hardware"]["controllers"].append({
                    "name": ctrl.get("NAME", "N/A"),
                    "status": "OK" if ctrl.get("HEALTHSTATUS") == "1" else "DEGRADED"
                })

        # Step 5: Disks
        r = session.get(f"{base}/disk", timeout=15)
        if r.status_code == 200 and r.json().get("error", {}).get("code", -1) == 0:
            disks = r.json().get("data", [])
            result["hardware"]["disks_total"] = len(disks)
            result["hardware"]["disks_failed"] = sum(1 for d in disks if d.get("HEALTHSTATUS") != "1")

        # Step 6: Alarms
        r = session.get(f"{base}/alarm/currentalarm?range=[0-99]", timeout=15)
        if r.status_code == 200 and r.json().get("error", {}).get("code", -1) == 0:
            for alarm in r.json().get("data", []):
                sev_code = str(alarm.get("alarmLevel", "4"))
                result["alerts"].append({
                    "severity": HUAWEI_SEV.get(sev_code, "INFO"),
                    "message": alarm.get("alarmName", alarm.get("description", "N/A"))
                })

        # Step 7: Volumes (LUNs)
        r = session.get(f"{base}/lun?range=[0-99]", timeout=15)
        if r.status_code == 200 and r.json().get("error", {}).get("code", -1) == 0:
            result["volumes"]["total"] = len(r.json().get("data", []))

        # Step 8: Logout
        try:
            session.delete(f"{base}/sessions", timeout=5)
        except Exception:
            pass

    except Exception as e:
        result["state"] = "DOWN"
        result["error"] = str(e)

    return result
