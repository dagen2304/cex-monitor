"""
storage_health.py — Orchestrateur de collecte des baies de stockage
Parallélise les collectes de toutes les baies via ThreadPoolExecutor
Retourne un GÉNÉRATEUR : chaque résultat est émis dès qu'il arrive (pas en batch)
"""
import os
import concurrent.futures
import logging
from .storage_collectors import COLLECTOR_REGISTRY

def _build_array_list(prefix_type, env_prefix):
    """
    Construit la liste des baies en interrogeant uniquement la base de données.
    """
    from app.models import Device
    arrays = []
    
    try:
        db_devices = Device.query.filter_by(device_type=prefix_type.lower()).all()
        for dev in db_devices:
            arrays.append({
                "name": dev.name,
                "ip": dev.ip,
                "user": dev.user,
                "pwd": dev.pwd,
                "port": dev.port,
                "connection_mode": dev.connection_mode,
                "extra_params": dev.extra_params
            })
    except Exception as e:
        logging.error(f"Erreur chargement baies {prefix_type} depuis DB: {e}")
            
    return sorted(arrays, key=lambda x: x['name'])

def fetch_all_storage_stats():
    """
    Collecte les statistiques de toutes les baies configurées en DB.
    GÉNÉRATEUR : yield chaque résultat dès qu'il est disponible.
    """
    tasks = []

    for type_name, config in COLLECTOR_REGISTRY.items():
        arrays = _build_array_list(type_name, config["prefix"].strip('_'))
        for arr in arrays:
            tasks.append((
                config["fn"], 
                arr["ip"], 
                arr["name"], 
                arr["user"], 
                arr["pwd"], 
                arr["port"], 
                arr["extra_params"]
            ))

    if not tasks:
        logging.warning("Aucune baie configurée dans la base de données.")
        return

    logging.info(f"Démarrage collecte : {len(tasks)} baie(s)")

    with concurrent.futures.ThreadPoolExecutor(max_workers=min(len(tasks), 16)) as executor:
        future_map = {
            executor.submit(fn, ip, name, usr, pwd, port, extra): name
            for fn, ip, name, usr, pwd, port, extra in tasks
        }
        # as_completed : yield chaque résultat DÈS qu'il est prêt
        for future in concurrent.futures.as_completed(future_map):
            array_name = future_map[future]
            try:
                result = future.result(timeout=120)
                state  = result.get("state", "DOWN")
                error  = result.get("error", "")
                if error:
                    logging.warning(f"Baie {array_name} — {state} — {error}")
                else:
                    logging.info(f"Baie {array_name} — {state}")
                yield result
            except concurrent.futures.TimeoutError:
                logging.error(f"Timeout (120s) collecte baie {array_name}")
                yield {"name": array_name, "state": "DOWN", "type": "unknown",
                       "error": "Timeout collecte (>120s)", "ip": ""}
            except Exception as exc:
                logging.error(f"Erreur collecte baie {array_name}: {exc}")
                yield {"name": array_name, "state": "DOWN", "type": "unknown",
                       "error": str(exc), "ip": ""}
