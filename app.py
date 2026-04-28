from flask import Flask, render_template, jsonify, Response, stream_with_context
import os
import json
import concurrent.futures
from dotenv import load_dotenv, set_key
from vmware_health import fetch_vmware_stats
from storage_health import fetch_all_storage_stats
import logging
import time
from threading import Lock

# --- Système de Cache Simple ---
class SimpleCache:
    def __init__(self, ttl=120):
        self.cache = {}
        self.ttl = ttl
        self.lock = Lock()
        self.diagnostics = {}

    def get(self, key):
        with self.lock:
            if key in self.cache:
                val, timestamp = self.cache[key]
                if time.time() - timestamp < self.ttl:
                    return val
            return None

    def set(self, key, value):
        with self.lock:
            self.cache[key] = (value, time.time())
            # Update diagnostics
            if key not in self.diagnostics:
                self.diagnostics[key] = {"count": 0, "errors": 0, "last_time": 0}
            self.diagnostics[key]["count"] += 1
            self.diagnostics[key]["last_time"] = time.time()
            if isinstance(value, dict) and value.get("state") == "DOWN":
                self.diagnostics[key]["errors"] += 1

global_cache = SimpleCache(ttl=120)

# Configuration du logging
logging.basicConfig(
    filename='vCenter.log',
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S'
)

load_dotenv()
app = Flask(__name__)

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/api/vmware/stream')
def api_vmware_stream():
    user = os.getenv("VC_USER")
    pwd = os.getenv("VC_PASSWORD")

    # Récupération dynamique des vCenters configurés
    vcenters = []
    for i in range(1, 51):
        ip = os.getenv(f"VC{i}_IP")
        if ip:
            vc_user = os.getenv(f"VC{i}_USER", user)
            vc_pwd = os.getenv(f"VC{i}_PASSWORD", pwd)
            vcenters.append({
                "name": os.getenv(f"VC{i}_NAME", f"vCenter {i}"), 
                "ip": ip,
                "user": vc_user,
                "pwd": vc_pwd
            })

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

@app.route('/api/storage/stream')
def api_storage_stream():
    @stream_with_context
    def generate():
        try:
            logging.info("Début de la collecte des baies de stockage (streaming)")
            count = 0
            for result in fetch_all_storage_stats():
                cache_key = f"storage_{result['ip'] or result['name']}"
                global_cache.set(cache_key, result)
                # Envoi immédiat de chaque baie dès qu'elle est prête
                yield f"data: {json.dumps(result)}\n\n"
                count += 1
            logging.info(f"Collecte terminée : {count} baies traitées")
        except Exception as exc:
            logging.error(f"Erreur collecte storage: {exc}")
        yield f"event: end\ndata: {{}}\n\n"

    resp = Response(generate(), mimetype='text/event-stream')
    resp.headers['Cache-Control']       = 'no-cache'
    resp.headers['X-Accel-Buffering']   = 'no'
    resp.headers['Access-Control-Allow-Origin'] = '*'
    return resp

@app.route('/api/vmware')
def api_vmware():
    """Endpoint synchrone pour le JS d'origine."""
    user = os.getenv("VC_USER")
    pwd = os.getenv("VC_PASSWORD")
    vcenters = [
        {"name": os.getenv("VC1_NAME", "vCenter 1"), "ip": os.getenv("VC1_IP")},
        {"name": os.getenv("VC2_NAME", "vCenter 2"), "ip": os.getenv("VC2_IP")},
        {"name": os.getenv("VC3_NAME", "vCenter 3"), "ip": os.getenv("VC3_IP")},
        {"name": os.getenv("VC4_NAME", "vCenter 4"), "ip": os.getenv("VC4_IP")},
        {"name": os.getenv("VC5_NAME", "vCenter 5"), "ip": os.getenv("VC5_IP")},
        {"name": os.getenv("VC6_NAME", "vCenter 6"), "ip": os.getenv("VC6_IP")},
        {"name": os.getenv("VC7_NAME", "vCenter 7"), "ip": os.getenv("VC7_IP")},
    ]
    valid_vcenters = [vc for vc in vcenters if vc.get("ip")]
    
    results = {
        "vcenter_states": [],
        "vms": {"on": 0, "off": 0, "suspend": 0, "total": 0},
        "clusters": [],
        "datastores": []
    }
    
    with concurrent.futures.ThreadPoolExecutor(max_workers=len(valid_vcenters)) as executor:
        future_to_vc = {executor.submit(fetch_vmware_stats, vc["ip"], user, pwd): vc for vc in valid_vcenters}
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

@app.route('/api/storage/test')
def api_storage_test():
    """Endpoint de diagnostic: teste la connexion à chaque baie configurée."""
    from storage_health import _build_array_list
    import os
    results = []
    checks = [
        ("unity",       "UNITY",       8,  "UNITY_USER",       "UNITY_PASSWORD"),
        ("powerstore",  "POWERSTORE",  3,  "POWERSTORE_USER",  "POWERSTORE_PASSWORD"),
        ("datadomain",  "DD",          3,  "DD_USER",          "DD_PASSWORD"),
        ("dorado",      "DORADO",      2,  "DORADO_USER",      "DORADO_PASSWORD"),
    ]
    for arr_type, prefix, count, user_key, pwd_key in checks:
        user = os.getenv(user_key, "")
        pwd  = os.getenv(pwd_key, "")
        arrays = _build_array_list(prefix, count, prefix + "_", prefix + "_")
        for arr in arrays:
            r = {"name": arr["name"], "ip": arr["ip"], "type": arr_type,
                 "user_configured": bool(user), "ip_configured": bool(arr["ip"])}
            if arr["ip"] and user:
                try:
                    import requests, urllib3
                    urllib3.disable_warnings()
                    # Test TCP basique avant la vraie connexion
                    import socket
                    port = 8088 if arr_type == "dorado" else 443
                    s = socket.create_connection((arr["ip"], port), timeout=5)
                    s.close()
                    r["tcp_ok"] = True
                except Exception as e:
                    r["tcp_ok"] = False
                    r["tcp_error"] = str(e)
            results.append(r)
    return jsonify(results)

from flask import request

@app.route('/api/config/add_device', methods=['POST'])
def api_add_device():
    data = request.json
    device_type = data.get('type')
    name = data.get('name')
    ip = data.get('ip')
    user = data.get('user')
    pwd = data.get('pwd')
    
    if not device_type or not name or not ip:
        return jsonify({"success": False, "error": "Champs manquants"}), 400
        
    env_file = ".env"
    prefix = ""
    if device_type == "vcenter":
        prefix = "VC"
    elif device_type == "unity":
        prefix = "UNITY_"
    elif device_type == "powerstore":
        prefix = "POWERSTORE_"
    elif device_type == "datadomain":
        prefix = "DD_"
    elif device_type == "dorado":
        prefix = "DORADO_"
    elif device_type == "scality":
        prefix = "SCALITY_"
    else:
        return jsonify({"success": False, "error": "Type invalide"}), 400

    # Find next available index
    next_idx = 1
    for i in range(1, 100):
        if not os.getenv(f"{prefix}{i}_IP"):
            next_idx = i
            break

    try:
        # Append to .env safely
        set_key(env_file, f"{prefix}{next_idx}_NAME", name)
        set_key(env_file, f"{prefix}{next_idx}_IP", ip)
        
        if user:
            set_key(env_file, f"{prefix}{next_idx}_USER", user)
        if pwd:
            set_key(env_file, f"{prefix}{next_idx}_PASSWORD", pwd)
        
        # Reload environment
        load_dotenv(override=True)
        return jsonify({"success": True, "message": f"Équipement ajouté à l'index {next_idx}"})
    except Exception as e:
        logging.error(f"Erreur lors de l'ajout d'équipement : {e}")
        return jsonify({"success": False, "error": str(e)}), 500

@app.route('/api/diagnostics')
def api_diagnostics():
    """Retourne l'état du cache et les stats de collecte."""
    return jsonify({
        "timestamp": time.time(),
        "cache_size": len(global_cache.cache),
        "details": global_cache.diagnostics
    })

if __name__ == '__main__':
    # On désactive le reloader sur Windows pour éviter WinError 10038
    app.run(debug=True, host='0.0.0.0', port=5000, use_reloader=False)