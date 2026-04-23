"""
Collecteur Dell EMC PowerStore — REST API
Auth: Basic Auth
"""
import requests
import urllib3
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

def _empty_result(name, ip):
    return {
        "name": name, "ip": ip, "type": "powerstore", "state": "DOWN",
        "model": "N/A", "firmware": "N/A", "overall_status": "unknown",
        "capacity": {"total_tb": 0, "used_tb": 0, "free_tb": 0, "used_pct": 0},
        "pools": [], "hardware": {"disks_total": 0, "disks_failed": 0, "controllers": []},
        "alerts": [], "performance": {"iops_read": 0, "iops_write": 0, "latency_ms_read": 0, "latency_ms_write": 0, "bandwidth_mbps": 0},
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
        # Cluster info — timeout très élevé (120s) car PowerStore peut être extrêmement lent
        r = session.get(f"{base}/cluster?select=id,name,physical_mtu,state,global_id", timeout=120)
        if r.status_code not in [200, 206]:
            result["error"] = f"HTTP {r.status_code}"
            return result
        cluster_list = r.json()
        cluster = cluster_list[0] if cluster_list else {}
        result["state"] = "UP"
        result["overall_status"] = cluster.get("state", "unknown")

        # Appliance info (model, firmware)
        r = session.get(f"{base}/appliance?select=id,name,model,software_version_major,software_version_minor", timeout=15)
        if r.status_code in [200, 206] and r.json():
            appl = r.json()[0]
            result["model"] = appl.get("model", "N/A")
            maj = appl.get("software_version_major", "")
            minor = appl.get("software_version_minor", "")
            result["firmware"] = f"{maj}.{minor}" if maj else "N/A"
            appliance_id = appl.get("id")
        else:
            appliance_id = None

        # Hardware components
        r = session.get(f"{base}/hardware?select=id,name,type,state,lifecycle_state", timeout=15)
        if r.status_code in [200, 206]:
            hw_list = r.json()
            controllers = [h for h in hw_list if h.get("type") in ["Appliance", "Node"]]
            disks = [h for h in hw_list if h.get("type") in ["Drive", "NVMe_Drive"]]
            result["hardware"]["disks_total"] = len(disks)
            result["hardware"]["disks_failed"] = sum(1 for d in disks if d.get("state") not in ["Healthy", "healthy"])
            for c in controllers:
                result["hardware"]["controllers"].append({
                    "name": c.get("name", "N/A"),
                    "status": c.get("state", "N/A")
                })

        # Active Alerts
        r = session.get(f"{base}/alert?select=id,severity,name,description,resource_name,time,state&state=eq.ACTIVE", timeout=15)
        if r.status_code in [200, 206]:
            for a in r.json():
                sev = a.get("severity", "INFO")
                result["alerts"].append({
                    "severity": sev,
                    "message": f"{a.get('name','')}: {a.get('description','')}"
                })

        # Volumes for capacity estimation
        r = session.get(f"{base}/volume?select=id,name,size,state&size=2000", timeout=20)
        if r.status_code in [200, 206]:
            vols = r.json()
            result["volumes"]["total"] = len(vols)
            total_bytes = sum(v.get("size", 0) for v in vols)
            # Approximate usage (PowerStore compresses, so raw is an estimate)
            result["capacity"]["total_tb"] = round(total_bytes / (1024**4), 2)
            result["capacity"]["used_pct"] = 0  # Real usage via metrics query

        # Performance metrics (per appliance)
        if appliance_id:
            try:
                perf_body = {
                    "entity": "performance_metrics_by_appliance",
                    "entity_id": appliance_id,
                    "interval": "Twenty_Sec"
                }
                r = session.post(f"{base}/metrics/query", json=perf_body, timeout=15)
                if r.status_code in [200, 206] and r.json():
                    m = r.json()[-1]  # Latest sample
                    result["performance"]["iops_read"] = int(m.get("read_iops", 0) or 0)
                    result["performance"]["iops_write"] = int(m.get("write_iops", 0) or 0)
                    result["performance"]["latency_ms_read"] = round((m.get("avg_read_latency", 0) or 0) / 1000, 2)
                    result["performance"]["latency_ms_write"] = round((m.get("avg_write_latency", 0) or 0) / 1000, 2)
                    bw = (m.get("read_bandwidth", 0) or 0) + (m.get("write_bandwidth", 0) or 0)
                    result["performance"]["bandwidth_mbps"] = round(bw / (1024**2), 1)
            except Exception:
                pass

    except Exception as e:
        result["state"] = "DOWN"
        result["error"] = str(e)

    return result
