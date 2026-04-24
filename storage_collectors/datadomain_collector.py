"""
Collecteur Dell EMC Data Domain — REST API
"""
import requests
import urllib3
import logging
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

DD_PORT = 3009
API_VERSIONS = ["v1.0", "v2.0", "v3.0"]

def _empty_result(name, ip):
    return {
        "name": name, "ip": ip, "type": "datadomain", "state": "DOWN",
        "model": "N/A", "firmware": "N/A", "overall_status": "unknown",
        "capacity": {"total_gb": 0, "used_gb": 0, "free_gb": 0, "used_pct": 0},
        "compression": {"dedup_ratio": 0, "compression_ratio": 0, "total_savings_pct": 0, "pre_comp_tb": 0},
        "pools": [], "hardware": {"disks_total": 0, "disks_failed": 0, "controllers": []},
        "alerts": [], "performance": {"iops_read": 0, "iops_write": 0, "latency_ms_read": 0, "latency_ms_write": 0, "bandwidth_mbps": 0},
        "volumes": {"total": 0}
    }

def _login(session, ip, user, password):
    for ver in API_VERSIONS:
        base = f"https://{ip}:{DD_PORT}/rest/{ver}"
        try:
            r = session.post(f"{base}/auth", json={"auth_info": {"username": user, "password": password}}, timeout=10)
            if r.status_code in [200, 201]:
                # Data Domain uses X-DD-AUTH-TOKEN
                token = r.headers.get("X-DD-AUTH-TOKEN")
                if not token:
                    try: 
                        data = r.json()
                        token = data.get("auth_info", {}).get("token")
                    except: pass
                
                if token: 
                    session.headers["X-DD-AUTH-TOKEN"] = token
                    return base, None
                else:
                    # Some versions return 201 but token is already in headers or session
                    return base, None
        except Exception as e:
            logging.debug(f"Auth attempt {ver} failed for {ip}: {e}")
            continue
    return None, "Auth failed"

def collect(ip, name, user, password):
    result = _empty_result(name, ip)
    session = requests.Session()
    session.verify = False
    session.headers.update({"Accept": "application/json", "Content-Type": "application/json"})

    try:
        base, err = _login(session, ip, user, password)
        if not base:
            result["error"] = err
            return result

        result["state"] = "UP"

        # 1. System Info
        r = session.get(f"{base}/system", timeout=10)
        if r.status_code == 200:
            data = r.json()
            sys = data.get("system_info", data)
            result["model"] = sys.get("model", "N/A")
            result["firmware"] = sys.get("version", "N/A")
            result["overall_status"] = "Green" if sys.get("status", "").lower() in ["ok", "normal"] else "Yellow"
            
            # Capacity fallback for new API (DDOS 7.x)
            if "physical_capacity" in sys:
                pc = sys["physical_capacity"]
                total = pc.get("total", 0)
                used = pc.get("used", 0)
                if total > 0:
                    result["capacity"] = {
                        "total_gb": round(float(total) / (1024**3), 2),
                        "used_gb": round(float(used) / (1024**3), 2),
                        "free_gb": round((float(total) - float(used)) / (1024**3), 2),
                        "used_pct": round((float(used) / float(total)) * 100, 1)
                    }

        # 2. Capacity
        capacity_paths = ["/filesys", "/dd-systems/0/filesys", "/stats/capacity"]
        for path in capacity_paths:
            try:
                r = session.get(f"{base}{path}", timeout=10)
                if r.status_code == 200:
                    data = r.json()
                    fs = data.get("filesys", data.get("capacity", data.get("filesystem", data)))
                    if isinstance(fs, list) and len(fs) > 0: fs = fs[0]
                    
                    space = fs.get("space_usage", fs.get("storage_usage", fs.get("capacity", fs)))
                    total = space.get("total", space.get("size", space.get("total_size", space.get("capacity", 0))))
                    used = space.get("used", space.get("used_size", space.get("used_capacity", 0)))
                    
                    if total == 0:
                        total = fs.get("total_size", fs.get("pre_comp_size", 0))
                        used = fs.get("used_size", fs.get("pre_comp_used", 0))

                    if total > 0 and result["capacity"]["total_gb"] == 0:
                        result["capacity"] = {
                            "total_gb": round(float(total) / (1024**3), 2),
                            "used_gb": round(float(used) / (1024**3), 2),
                            "free_gb": round((float(total) - float(used)) / (1024**3), 2),
                            "used_pct": round((float(used) / float(total)) * 100, 1)
                        }
                        break
            except:
                continue

        # 3. Hardware
        r = session.get(f"{base}/dd-systems/0/disk", timeout=10)
        if r.status_code == 200:
            disks = r.json().get("disk", [])
            result["hardware"]["disks_total"] = len(disks)
            result["hardware"]["disks_failed"] = sum(1 for d in disks if d.get("state","").lower() not in ["normal", "ok", "active"])

    except Exception as e:
        result["state"] = "DOWN"
        result["error"] = str(e)
    finally:
        try: session.delete(f"{base}/auth", timeout=5)
        except: pass

    return result
