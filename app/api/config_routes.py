import os
import logging
import time
from flask import Blueprint, request, jsonify
from dotenv import load_dotenv, set_key
from app.utils.cache import global_cache

config_bp = Blueprint('config', __name__)

@config_bp.route('/api/config/add_device', methods=['POST'])
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

@config_bp.route('/api/diagnostics')
def api_diagnostics():
    """Retourne l'état du cache et les stats de collecte."""
    return jsonify({
        "timestamp": time.time(),
        "cache_size": len(global_cache.cache),
        "details": global_cache.diagnostics
    })
