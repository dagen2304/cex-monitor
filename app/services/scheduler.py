import logging
from datetime import datetime
from apscheduler.schedulers.background import BackgroundScheduler
from app.models import db, CapacitySnapshot
from app.config import Config
from app.services.vmware_health import fetch_vmware_stats
from app.services.storage_health import fetch_all_storage_stats

def take_capacity_snapshot(app):
    """Effectue une collecte de tous les équipements et sauvegarde l'état dans la DB."""
    with app.app_context():
        logging.info("Démarrage de la capture capacitaire planifiée...")
        
        # 1. VMware
        vcenters = Config.get_configured_vcenters()
        for vc in vcenters:
            if not vc.get("ip"): continue
            try:
                data = fetch_vmware_stats(vc["ip"], vc["user"], vc["pwd"], vc.get("port"), vc.get("extra_params"))
                if data.get("status") == "success":
                    metrics = [
                        ('cpu_usage', data['global_metrics']['cpu']),
                        ('ram_usage', data['global_metrics']['ram']),
                        ('storage_usage', data['global_metrics']['storage'])
                    ]
                    for m_name, val in metrics:
                        snap = CapacitySnapshot(
                            device_type='vmware',
                            device_name=vc["name"],
                            device_ip=vc["ip"],
                            metric_name=m_name,
                            value=val
                        )
                        db.session.add(snap)
            except Exception as e:
                logging.error(f"Erreur snapshot VMware {vc['name']}: {e}")

        # 2. Storage
        try:
            for result in fetch_all_storage_stats():
                if result.get("state") == "UP" and result.get("capacity"):
                    snap = CapacitySnapshot(
                        device_type='storage',
                        device_name=result["name"],
                        device_ip=result["ip"],
                        metric_name='storage_used_pct',
                        value=result["capacity"]["used_pct"]
                    )
                    db.session.add(snap)
        except Exception as e:
            logging.error(f"Erreur snapshot Storage: {e}")

        db.session.commit()
        logging.info("Capture capacitaire terminée et sauvegardée.")

def init_scheduler(app):
    scheduler = BackgroundScheduler()
    # Planifier une capture toutes les 24h à minuit
    scheduler.add_job(func=take_capacity_snapshot, trigger="cron", hour=0, minute=0, args=[app])
    
    # Optionnel: Effectuer une capture immédiate au démarrage si la DB est vide
    with app.app_context():
        if CapacitySnapshot.query.count() == 0:
            logging.info("Base de données vide, lancement d'une capture initiale...")
            scheduler.add_job(func=take_capacity_snapshot, trigger="date", run_date=datetime.now(), args=[app])
            
    scheduler.start()
    return scheduler
