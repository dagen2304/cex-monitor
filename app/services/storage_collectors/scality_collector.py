"""
Collecteur Scality Ring — Supervisor API v0.1
"""
import requests
import urllib3
import logging
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

def _empty_result(name, ip):
    return {
        "name": name, "ip": ip, "type": "scality", "state": "DOWN",
        "model": "Scality RING", "firmware": "N/A", "overall_status": "unknown",
        "capacity": {"total_gb": 0, "used_gb": 0, "free_gb": 0, "used_pct": 0},
        "compression": {"dedup_ratio": 0, "compression_ratio": 0, "total_savings_pct": 0},
        "pools": [], "hardware": {"disks_total": 0, "disks_failed": 0, "controllers": []},
        "alerts": [], "performance": {"iops_read": 0, "iops_write": 0, "latency_ms_read": 0, "latency_ms_write": 0, "bandwidth_mbps": 0},
        "volumes": {"total": 0}
    }

def collect(ip, name, user, password):
    """
    Collects metrics from Scality RING via Supervisor API v0.1.
    Targeting the /api/v0.1/rings endpoint.
    """
    result = _empty_result(name, ip)
    
    session = requests.Session()
    session.verify = False
    
    if user and password:
        session.auth = (user, password)
        
    try:
        # 1. Get Supervisor Status / Version
        url_status = f"https://{ip}/api/v0.1/status"
        r_status = session.get(url_status, timeout=10)
        if r_status.status_code == 200:
            status_data = r_status.json()
            result["firmware"] = f"RING {status_data.get('supapi_version', 'N/A')}"
            
        # 2. Get Rings Data
        url_rings = f"https://{ip}/api/v0.1/rings"
        r_rings = session.get(url_rings, timeout=10)
        
        if r_rings.status_code == 200:
            rings_data = r_rings.json()
            items = rings_data.get("_items", [])
            
            # Find the DATA ring (primary storage), or use the first available ring
            data_ring = next((r for r in items if r.get("id") == "DATA" or r.get("name") == "DATA"), None)
            if not data_ring and items:
                data_ring = items[0]
                
            if data_ring:
                logging.info(f"[Scality] Collecte réussie pour {name} ({ip}) - Ring: {data_ring.get('name')}")
                result["state"] = "UP"
                result["overall_status"] = "Green" if data_ring.get("status") == "OK" else "Yellow"
                
                # Capacity metrics (Scality returns values in bytes)
                total_bytes = data_ring.get("diskspace_total", 0)
                used_bytes = data_ring.get("diskspace_used", 0)
                free_bytes = total_bytes - used_bytes
                
                result["capacity"] = {
                    "total_gb": round(total_bytes / (10**9), 2),
                    "used_gb": round(used_bytes / (10**9), 2),
                    "free_gb": round(free_bytes / (10**9), 2),
                    "used_pct": round((used_bytes / total_bytes) * 100, 1) if total_bytes > 0 else 0
                }
                
                # Objects information (mapped into compression/volumes depending on dashboard capabilities)
                # Storing object count in volumes.total for display
                result["volumes"]["total"] = data_ring.get("number_of_objects", 0)
                
                # Hardware Info
                result["hardware"]["disks_total"] = data_ring.get("number_of_nodes", 0) # Displaying nodes as disks abstraction
                result["hardware"]["disks_failed"] = 0
                
                # Performance (We don't have IOPS in this endpoint, keeping default 0)
                pass
            else:
                result["state"] = "DOWN"
                result["error"] = "Aucun Ring trouvé"
        else:
            result["state"] = "DOWN"
            result["error"] = f"HTTP {r_rings.status_code}"

    except Exception as e:
        logging.error(f"[Scality] Erreur de collecte pour {name} ({ip}): {e}")
        result["state"] = "DOWN"
        result["error"] = str(e)
        
    return result
