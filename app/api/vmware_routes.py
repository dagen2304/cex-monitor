import json
import logging
import time
import concurrent.futures
from flask import Blueprint, Response, jsonify
from app.config import Config
from app.utils.cache import global_cache
from app.services.vmware_health import fetch_vmware_stats

vmware_bp = Blueprint('vmware', __name__)

MAX_VMWARE_WORKERS = 10

def _process_vc_result(vc, vc_data, start_time):
    """Formate le résultat brut d'un vCenter pour l'API."""
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
            
    return result

@vmware_bp.route('/api/vmware/stream')
def api_vmware_stream():
    vcenters = Config.get_configured_vcenters()

    def fetch_vc(vc):
        if not vc.get("ip"): return None
        
        cache_key = f"vc_{vc['ip']}"
        cached = global_cache.get(cache_key)
        if cached: return cached

        start_time = time.time()
        vc_data = fetch_vmware_stats(vc["ip"], vc["user"], vc["pwd"], vc.get("port"), vc.get("extra_params"))
        result = _process_vc_result(vc, vc_data, start_time)
        
        global_cache.set(cache_key, result)
        return result

    def generate():
        valid_vcenters = [vc for vc in vcenters if vc.get("ip")]
        if not valid_vcenters:
            yield f"event: end\ndata: {{}}\n\n"
            return
            
        with concurrent.futures.ThreadPoolExecutor(max_workers=min(len(valid_vcenters), MAX_VMWARE_WORKERS)) as executor:
            future_to_vc = {executor.submit(fetch_vc, vc): vc for vc in valid_vcenters}
            for future in concurrent.futures.as_completed(future_to_vc):
                try:
                    result = future.result()
                    if result:
                        yield f"data: {json.dumps(result)}\n\n"
                except Exception as exc:
                    vc = future_to_vc[future]
                    logging.error(f"Erreur d'exécution pour {vc['name']}: {exc}")
                    yield f"data: {json.dumps({'vcenter': vc['name'], 'ip': vc['ip'], 'state': 'DOWN', 'error': str(exc)})}\n\n"
                    
        yield f"event: end\ndata: {{}}\n\n"

    return Response(generate(), mimetype='text/event-stream')

@vmware_bp.route('/api/vmware')
def api_vmware():
    """Endpoint synchrone utilisant la logique commune et le cache."""
    vcenters = Config.get_configured_vcenters()
    valid_vcenters = [vc for vc in vcenters if vc.get("ip")]
    
    results = {
        "vcenter_states": [],
        "vms": {"on": 0, "off": 0, "suspend": 0, "total": 0},
        "clusters": [],
        "datastores": []
    }
    
    def fetch_and_process(vc):
        cache_key = f"vc_{vc['ip']}"
        cached = global_cache.get(cache_key)
        if cached: return cached
        
        start_time = time.time()
        vc_data = fetch_vmware_stats(vc["ip"], vc["user"], vc["pwd"], vc.get("port"), vc.get("extra_params"))
        res = _process_vc_result(vc, vc_data, start_time)
        global_cache.set(cache_key, res)
        return res

    with concurrent.futures.ThreadPoolExecutor(max_workers=min(len(valid_vcenters), MAX_VMWARE_WORKERS)) as executor:
        futures = [executor.submit(fetch_and_process, vc) for vc in valid_vcenters]
        for future in concurrent.futures.as_completed(futures):
            try:
                data = future.result()
                results["vcenter_states"].append({
                    "name": data["vcenter"], 
                    "ip": data["ip"], 
                    "state": data["state"],
                    "error": data.get("error")
                })
                
                if data["state"] == "UP":
                    results["vms"]["total"] += data["vms"]["total"]
                    results["vms"]["on"] += data["vms"]["on"]
                    results["vms"]["off"] += data["vms"]["off"]
                    results["vms"]["suspend"] += data["vms"]["suspend"]
                    results["clusters"].extend(data.get("clusters", []))
                    results["datastores"].extend(data.get("datastores", []))
            except Exception as e:
                logging.error(f"Erreur api_vmware: {e}")
                
    return jsonify(results)
