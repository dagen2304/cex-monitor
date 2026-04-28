"""
storage_health.py — Orchestrateur de collecte des baies de stockage
Parallélise les collectes de toutes les baies via ThreadPoolExecutor
Retourne un GÉNÉRATEUR : chaque résultat est émis dès qu'il arrive (pas en batch)
"""
import os
import concurrent.futures
import logging
from storage_collectors import unity_collector, powerstore_collector, datadomain_collector, dorado_collector

def _build_array_list(prefix, count, env_prefix_ip, env_prefix_name, global_user="", global_pwd=""):
    """Construit la liste des baies depuis les variables d'environnement."""
    arrays = []
    for i in range(1, count + 1):
        ip   = os.getenv(f"{env_prefix_ip}{i}_IP")
        name = os.getenv(f"{env_prefix_ip}{i}_NAME", f"{prefix}-{i}")
        user = os.getenv(f"{env_prefix_ip}{i}_USER", global_user)
        pwd = os.getenv(f"{env_prefix_ip}{i}_PASSWORD", global_pwd)
        if ip:
            arrays.append({"name": name, "ip": ip, "user": user, "pwd": pwd})
    return arrays

def fetch_all_storage_stats():
    """
    Collecte les statistiques de toutes les baies configurées.
    GÉNÉRATEUR : yield chaque résultat dès qu'il est disponible.
    Permet un streaming SSE immédiat sans attendre toutes les baies.
    """
    # Credentials par constructeur
    unity_user   = os.getenv("UNITY_USER",       "")
    unity_pass   = os.getenv("UNITY_PASSWORD",   "")
    ps_user      = os.getenv("POWERSTORE_USER",  "")
    ps_pass      = os.getenv("POWERSTORE_PASSWORD", "")
    dd_user      = os.getenv("DD_USER",          "")
    dd_pass      = os.getenv("DD_PASSWORD",      "")
    dorado_user  = os.getenv("DORADO_USER",      "")
    dorado_pass  = os.getenv("DORADO_PASSWORD",  "")

    # Construction de la liste de toutes les baies avec leur collecteur
    tasks = []

    for arr in _build_array_list("Unity", 50, "UNITY_", "UNITY_", unity_user, unity_pass):
        tasks.append((unity_collector.collect, arr["ip"], arr["name"], arr["user"], arr["pwd"]))

    for arr in _build_array_list("PowerStore", 50, "POWERSTORE_", "POWERSTORE_", ps_user, ps_pass):
        tasks.append((powerstore_collector.collect, arr["ip"], arr["name"], arr["user"], arr["pwd"]))

    for arr in _build_array_list("DataDomain", 50, "DD_", "DD_", dd_user, dd_pass):
        tasks.append((datadomain_collector.collect, arr["ip"], arr["name"], arr["user"], arr["pwd"]))

    for arr in _build_array_list("Dorado", 50, "DORADO_", "DORADO_", dorado_user, dorado_pass):
        tasks.append((dorado_collector.collect, arr["ip"], arr["name"], arr["user"], arr["pwd"]))

    if not tasks:
        logging.warning("Aucune baie configurée dans .env")
        return

    logging.info(f"Démarrage collecte : {len(tasks)} baie(s)")

    with concurrent.futures.ThreadPoolExecutor(max_workers=min(len(tasks), 16)) as executor:
        future_map = {
            executor.submit(fn, ip, name, usr, pwd): name
            for fn, ip, name, usr, pwd in tasks
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
