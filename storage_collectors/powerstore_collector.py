"""
Collecteur Dell EMC PowerStore — REST API
Optimisé pour le rôle Storage Operator (Accès aux métriques)
"""
import requests
import urllib3
import logging
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

def _empty_result(name, ip):
    return {
        "name": name, "ip": ip, "type": "powerstore", "state": "DOWN",
        "model": "N/A", "firmware": "N/A", "overall_status": "unknown",
        "capacity": {"total_gb": 0, "used_gb": 0, "free_gb": 0, "used_pct": 0},
        "pools": [], "hardware": {"disks_total": 0, "disks_failed": 0, "controllers": []},
        "alerts": [], "performance": {"iops_read": 0, "iops_write": 0, "latency_ms": 0, "bandwidth_mbps": 0},
        "volumes": {"total": 0}
    }

def collect(ip, name, user, password):
    result = _empty_result(name, ip)
    session = requests.Session()
    session.auth = (user, password)
    session.verify = False
    session.headers.update({"Accept": "application/json", "Content-Type": "application/json"})
    base = f"https://{ip}/api/rest"

    try:
        # 1. Appliance ID & Info
        # explicitly select fields to avoid getting only IDs
        r = session.get(f"{base}/appliance?select=*", timeout=60)
        if r.status_code != 200 or not r.json():
            result["error"] = f"Appliance query failed: {r.status_code}"
            result["overall_status"] = "Red"
            return result
        
        appl = r.json()[0]
        app_id = appl.get("id")
        result["model"] = appl.get("model", "N/A")
        # Try software_version first (PowerStore 3.x), then legacy major/minor
        result["firmware"] = appl.get("software_version", "N/A")
        if result["firmware"] == "N/A":
             result["firmware"] = f"{appl.get('software_version_major')}.{appl.get('software_version_minor')}"
        result["state"] = "UP"

        # 2. Capacity Metrics (Try multiple paths)
        cap_found = False
        for path in ["/space_metrics", "/appliance_metrics"]:
            try:
                r = session.get(f"{base}{path}?appliance_id=eq.{app_id}&order=timestamp.desc&limit=1", timeout=60)
                if r.status_code == 200 and r.json():
                    m = r.json()[0]
                    total = m.get("physical_total", m.get("physical_total_bytes", 0))
                    used = m.get("physical_used", m.get("physical_used_bytes", 0))
                    if total > 0:
                        result["capacity"] = {
                            "total_gb": round(total / (1024**3), 2),
                            "used_gb": round(used / (1024**3), 2),
                            "free_gb": round((total - used) / (1024**3), 2),
                            "used_pct": round((used / total) * 100, 1)
                        }
                        cap_found = True
                        break
                elif r.status_code == 403:
                    result["error"] = "Metrics access denied (403)"
            except: continue

        # Fallback to Cluster capacity if metrics fail
        if not cap_found:
            r = session.get(f"{base}/cluster?select=physical_total_bytes,physical_used_bytes", timeout=60)
            if r.status_code == 200 and r.json():
                cl = r.json()[0]
                total = cl.get("physical_total_bytes", 0)
                used = cl.get("physical_used_bytes", 0)
                if total > 0:
                    result["capacity"] = {
                        "total_gb": round(total / (1024**3), 2),
                        "used_gb": round(used / (1024**3), 2),
                        "free_gb": round((total - used) / (1024**3), 2),
                        "used_pct": round((used / total) * 100, 1)
                    }

        # 3. Performance Metrics
        for path in ["/performance_metrics_by_appliance", "/metrics/appliance"]:
            try:
                r = session.get(f"{base}{path}?appliance_id=eq.{app_id}&order=timestamp.desc&limit=1", timeout=60)
                if r.status_code == 200 and r.json():
                    p = r.json()[0]
                    result["performance"] = {
                        "iops_read": int(p.get("read_iops", 0) or 0),
                        "iops_write": int(p.get("write_iops", 0) or 0),
                        "latency_ms": round((p.get("avg_latency", 0) or 0) / 1000, 2),
                        "bandwidth_mbps": round((p.get("total_bandwidth", 0) or 0) / (1024**2), 1)
                    }
                    break
            except: continue

        # 4. Status
        r = session.get(f"{base}/cluster?select=state", timeout=60)
        if r.status_code == 200:
            ps_state = r.json()[0].get("state", "unknown")
            status_map = {"Healthy": "Green", "Configured": "Green", "Minor_Failure": "Yellow", "Major_Failure": "Red"}
            result["overall_status"] = status_map.get(ps_state, "Gray")

        # 5. Alerts (Active)
        r = session.get(f"{base}/alert?select=id,severity,description,resource_name,timestamp&severity=neq.Info&is_acknowledged=eq.false", timeout=15)
        if r.status_code == 200:
            for a in r.json():
                result["alerts"].append({
                    "id": a.get("id"),
                    "severity": a.get("severity", "Warning").upper(),
                    "message": a.get("description", "N/A"),
                    "timestamp": a.get("timestamp", "N/A"),
                    "component": a.get("resource_name", "Appliance")
                })

    except Exception as e:
        result["state"] = "DOWN"
        result["error"] = str(e)

    return result
