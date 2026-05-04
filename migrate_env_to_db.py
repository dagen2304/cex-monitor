import os
import json
from run import create_app
from app.models import db, Device
from dotenv import load_dotenv

def migrate():
    load_dotenv()
    app = create_app()
    
    with app.app_context():
        # Dictionnaire des préfixes et types correspondants
        mappings = {
            "VC": {"type": "vcenter", "mode": "SDK", "port": None},
            "UNITY": {"type": "unity", "mode": "REST", "port": 443},
            "POWERSTORE": {"type": "powerstore", "mode": "REST", "port": 443},
            "DD": {"type": "datadomain", "mode": "REST", "port": 3009},
            "DORADO": {"type": "dorado", "mode": "REST", "port": 8088},
            "SCALITY": {"type": "scality", "mode": "REST", "port": 443}
        }
        
        count_added = 0
        count_updated = 0
        
        dorado_scope = os.getenv("DORADO_SCOPE", "0")
        
        for prefix, info in mappings.items():
            dev_type = info["type"]
            mode = info["mode"]
            default_port = info["port"]
            
            # Récupérer les identifiants globaux pour ce type
            global_user = os.getenv(f"{prefix}_USER")
            global_pwd = os.getenv(f"{prefix}_PASSWORD")
            
            # Chercher les équipements de 1 à 100 pour chaque préfixe
            for i in range(1, 101):
                ip = os.getenv(f"{prefix}{i}_IP") or os.getenv(f"{prefix}_{i}_IP")
                if not ip:
                    continue
                
                name = os.getenv(f"{prefix}{i}_NAME") or os.getenv(f"{prefix}_{i}_NAME") or f"{dev_type}-{i}"
                user = os.getenv(f"{prefix}{i}_USER") or os.getenv(f"{prefix}_{i}_USER") or global_user
                pwd = os.getenv(f"{prefix}{i}_PASSWORD") or os.getenv(f"{prefix}_{i}_PASSWORD") or global_pwd
                
                # Nettoyage
                ip = ip.strip("'\"")
                name = name.strip("'\"")
                if user: user = user.strip("'\"")
                if pwd: pwd = pwd.strip("'\"")
                
                extra = None
                if dev_type == "dorado":
                    extra = json.dumps({"scope": dorado_scope})
                
                # Vérifier si déjà présent
                existing = Device.query.filter_by(ip=ip, device_type=dev_type).first()
                if not existing:
                    new_dev = Device(
                        device_type=dev_type,
                        name=name,
                        ip=ip,
                        user=user,
                        pwd=pwd,
                        port=default_port,
                        connection_mode=mode,
                        extra_params=extra
                    )
                    db.session.add(new_dev)
                    count_added += 1
                    print(f"Migration: {name} ({ip}) ajouté.")
                else:
                    # Mettre à jour
                    changed = False
                    if user and existing.user != user:
                        existing.user = user
                        changed = True
                    if pwd and existing.pwd != pwd:
                        existing.pwd = pwd
                        changed = True
                    if name and existing.name != name:
                        existing.name = name
                        changed = True
                    if existing.connection_mode != mode:
                        existing.connection_mode = mode
                        changed = True
                    if existing.port != default_port:
                        existing.port = default_port
                        changed = True
                    if existing.extra_params != extra:
                        existing.extra_params = extra
                        changed = True
                        
                    if changed:
                        count_updated += 1
                        print(f"Migration: {name} ({ip}) mis à jour.")
        
        db.session.commit()
        print(f"Terminé. {count_added} équipements ajoutés, {count_updated} mis à jour dans la DB.")

if __name__ == "__main__":
    migrate()
