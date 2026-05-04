import json
import logging
from flask import Blueprint, Response, jsonify, stream_with_context
from app.utils.cache import global_cache
from app.services.storage_health import fetch_all_storage_stats, _build_array_list

storage_bp = Blueprint('storage', __name__)

@storage_bp.route('/api/storage/stream')
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

@storage_bp.route('/api/storage/test')
def api_storage_test():
    """Endpoint de diagnostic: teste la connexion à chaque baie configurée."""
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
