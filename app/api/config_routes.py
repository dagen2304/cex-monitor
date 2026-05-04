import os
import logging
import time
from flask import Blueprint, request, jsonify
from dotenv import load_dotenv, set_key
from app.utils.cache import global_cache

from app.models import db, Device

config_bp = Blueprint('config', __name__)

@config_bp.route('/api/config/add_device', methods=['POST'])
def api_add_device():
    data = request.json
    device_type = data.get('type')
    name = data.get('name')
    ip = data.get('ip')
    user = data.get('user')
    pwd = data.get('pwd')
    port = data.get('port')
    connection_mode = data.get('connection_mode')
    extra_params = data.get('extra_params')
    
    if not device_type or not name or not ip:
        return jsonify({"success": False, "error": "Champs manquants"}), 400
        
    try:
        # Check for duplicates in DB
        existing = Device.query.filter_by(ip=ip, device_type=device_type).first()
        if existing:
            return jsonify({"success": False, "error": f"L'équipement avec l'IP {ip} existe déjà."}), 400

        new_device = Device(
            device_type=device_type,
            name=name,
            ip=ip,
            user=user if user else None,
            pwd=pwd if pwd else None,
            port=port if port else None,
            connection_mode=connection_mode if connection_mode else None,
            extra_params=extra_params if extra_params else None
        )
        db.session.add(new_device)
        db.session.commit()
        
        logging.info(f"Équipement {name} ({device_type}) ajouté en base de données.")
        return jsonify({"success": True, "message": f"Équipement {name} ajouté avec succès."})
    except Exception as e:
        db.session.rollback()
        logging.error(f"Erreur lors de l'ajout d'équipement en DB : {e}")
        return jsonify({"success": False, "error": str(e)}), 500

@config_bp.route('/api/config/devices', methods=['GET'])
def api_get_devices():
    """Liste tous les équipements configurés."""
    devices = Device.query.all()
    return jsonify([d.to_dict() for d in devices])

@config_bp.route('/api/config/devices/<int:device_id>', methods=['GET'])
def api_get_device(device_id):
    """Récupère un équipement spécifique."""
    device = Device.query.get_or_404(device_id)
    return jsonify(device.to_dict())

@config_bp.route('/api/config/devices/<int:device_id>', methods=['PUT'])
def api_update_device(device_id):
    """Met à jour un équipement."""
    device = Device.query.get_or_404(device_id)
    data = request.json
    
    device.device_type = data.get('type', device.device_type)
    device.name = data.get('name', device.name)
    device.ip = data.get('ip', device.ip)
    device.user = data.get('user', device.user)
    device.port = data.get('port', device.port)
    device.connection_mode = data.get('connection_mode', device.connection_mode)
    device.extra_params = data.get('extra_params', device.extra_params)
    
    # Ne mettre à jour le mot de passe que si fourni
    if data.get('pwd'):
        device.pwd = data.get('pwd')
        
    try:
        db.session.commit()
        return jsonify({"success": True, "message": f"Équipement {device.name} mis à jour."})
    except Exception as e:
        db.session.rollback()
        return jsonify({"success": False, "error": str(e)}), 500

@config_bp.route('/api/config/devices/<int:device_id>', methods=['DELETE'])
def api_delete_device(device_id):
    """Supprime un équipement."""
    device = Device.query.get_or_404(device_id)
    try:
        db.session.delete(device)
        db.session.commit()
        return jsonify({"success": True, "message": f"Équipement {device.name} supprimé."})
    except Exception as e:
        db.session.rollback()
        return jsonify({"success": False, "error": str(e)}), 500

@config_bp.route('/api/diagnostics')
def api_diagnostics():
    """Retourne l'état du cache et les stats de collecte."""
    return jsonify({
        "timestamp": time.time(),
        "cache_size": len(global_cache.cache),
        "details": global_cache.diagnostics
    })
