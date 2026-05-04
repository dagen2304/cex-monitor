import json
import logging
import time
import concurrent.futures
from flask import Blueprint, Response, jsonify
from app.config import Config
from app.utils.cache import global_cache
from app.services.vmware_health import fetch_vmware_stats

vmware_bp = Blueprint('vmware', __name__)

@vmware_bp.route('/api/vmware/stream')
def api_vmware_stream():
    vcenters = Config.get_configured_vcenters()

    def fetch_vc(vc):
        if not vc.get("ip"): return None
        
        cache_key = f"vc_{vc['ip']}"
        cached = global_cache.get(cache_key)
        if cached: return cached

        logging.info(f"Tentative de connexion au vCenter {vc['name']} ({vc['ip']})")
        start_time = time.time()
        vc_data = fetch_vmware_stats(vc["ip"], vc["user"], vc["pwd"])
        duration = round(time.time() - start_time, 2)
        
        result = {"vcenter": vc["name"], "ip": vc["ip"], "latency": duration}
        if vc_data.get("status") == "error":
            logging.error(f"Échec de la connexion au vCenter {vc['name']} ({vc['ip']}): {vc_data.get('error_msg')}")
            result["state"] = "DOWN"
            result["error"] = vc_data.get("error_msg")
        else:
            logging.info(f"Connexion réussie au vCenter {vc['name']} ({vc['ip']})")
            result["state"] = "UP"
            result["vms"] = vc_data["vms"]
            result["global_metrics"] = vc_data.get("global_metrics", {"cpu": 0, "ram": 0, "storage": 0})
            result["host_list"] = vc_data.get("host_list", [])
            result["vm_list"] = vc_data.get("vm_list", [])
            result["alerts"] = vc_data.get("alerts", [])
            
            result["clusters"] = []
            for cluster in vc_data.get("clusters", []):
                cluster["vcenter_name"] = vc["name"]
                result["clusters"].append(cluster)
                
            result["datastores"] = []
            for ds in vc_data.get("datastores", []):
                ds["vcenter_name"] = vc["name"]
                result["datastores"].append(ds)
        
        global_cache.set(cache_key, result)
        return result

    def generate():
        valid_vcenters = [vc for vc in vcenters if vc.get("ip")]
        if not valid_vcenters:
            yield f"event: end\ndata: {{}}\n\n"
            return
            
        with concurrent.futures.ThreadPoolExecutor(max_workers=len(valid_vcenters)) as executor:
            future_to_vc = {executor.submit(fetch_vc, vc): vc for vc in valid_vcenters}
            for future in concurrent.futures.as_completed(future_to_vc):
                try:
                    result = future.result()
                    if result:
                        yield f"data: {json.dumps(result)}\n\n"
                except Exception as exc:
                    vc = future_to_vc[future]
                    logging.error(f"Erreur d'exécution pour {vc['name']}: {exc}")
                    err_result = {"vcenter": vc["name"], "ip": vc["ip"], "state": "DOWN", "error": str(exc)}
                    yield f"data: {json.dumps(err_result)}\n\n"
                    
        yield f"event: end\ndata: {{}}\n\n"

    return Response(generate(), mimetype='text/event-stream')

@vmware_bp.route('/api/vmware')
def api_vmware():
    """Endpoint synchrone pour le JS d'origine."""
    vcenters = Config.get_configured_vcenters()
    valid_vcenters = [vc for vc in vcenters if vc.get("ip")]
    
    results = {
        "vcenter_states": [],
        "vms": {"on": 0, "off": 0, "suspend": 0, "total": 0},
        "clusters": [],
        "datastores": []
    }
    
    with concurrent.futures.ThreadPoolExecutor(max_workers=len(valid_vcenters)) as executor:
        future_to_vc = {executor.submit(fetch_vmware_stats, vc["ip"], vc["user"], vc["pwd"]): vc for vc in valid_vcenters}
        for future in concurrent.futures.as_completed(future_to_vc):
            vc = future_to_vc[future]
            try:
                data = future.result()
                state = "UP" if data.get("status") != "error" else "DOWN"
                results["vcenter_states"].append({"name": vc["name"], "ip": vc["ip"], "state": state})
                
                if state == "UP":
                    results["vms"]["total"] += data["vms"]["total"]
                    results["vms"]["on"] += data["vms"]["on"]
                    results["vms"]["off"] += data["vms"]["off"]
                    results["vms"]["suspend"] += data["vms"]["suspend"]
                    
                    for c in data.get("clusters", []):
                        c["vcenter_name"] = vc["name"]
                        results["clusters"].append(c)
                    
                    for ds in data.get("datastores", []):
                        ds["vcenter_name"] = vc["name"]
                        results["datastores"].append(ds)
            except Exception as e:
                results["vcenter_states"].append({"name": vc["name"], "ip": vc["ip"], "state": "DOWN", "error": str(e)})
                
    return jsonify(results)
