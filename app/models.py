from flask_sqlalchemy import SQLAlchemy
from datetime import datetime
from cryptography.fernet import Fernet
import os
from flask import current_app

db = SQLAlchemy()

# On récupère la clé depuis l'environnement ou on en génère une (en prod, elle DOIT être fixe)
ENCRYPTION_KEY = os.getenv('DB_ENCRYPTION_KEY')
if not ENCRYPTION_KEY:
    # Pour le développement, on peut utiliser une clé dérivée de SECRET_KEY
    # Mais idéalement, il faut une clé dédiée.
    # Ici, on va juste utiliser un fallback pour éviter de planter, 
    # mais on préviendra l'utilisateur qu'il doit configurer DB_ENCRYPTION_KEY.
    ENCRYPTION_KEY = b'6_W9X_Z6y4v4Fv1_3_7_G_H_J_K_L_M_N_O_P_Q_R_S=' # Clé d'exemple 32 bytes base64

class Device(db.Model):
    __tablename__ = 'devices'
    
    id = db.Column(db.Integer, primary_key=True)
    device_type = db.Column(db.String(50), nullable=False) # 'vcenter', 'unity', 'powerstore', etc.
    name = db.Column(db.String(100), nullable=False)
    ip = db.Column(db.String(100), nullable=False)
    user = db.Column(db.String(100))
    _pwd = db.Column('pwd', db.String(255)) # Stockage chiffré
    port = db.Column(db.Integer)
    connection_mode = db.Column(db.String(50)) # 'REST', 'SDK', etc.
    extra_params = db.Column(db.Text) # JSON string for extra config
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    @property
    def pwd(self):
        if not self._pwd:
            return None
        try:
            f = Fernet(ENCRYPTION_KEY)
            return f.decrypt(self._pwd.encode()).decode()
        except Exception:
            # Si le déchiffrement échoue (ex: clé changée), on retourne la valeur telle quelle 
            # ou on log l'erreur. Ici on retourne None pour la sécurité.
            return None

    @pwd.setter
    def pwd(self, value):
        if value:
            f = Fernet(ENCRYPTION_KEY)
            self._pwd = f.encrypt(value.encode()).decode()
        else:
            self._pwd = None

    def to_dict(self):
        return {
            "id": self.id,
            "type": self.device_type,
            "name": self.name,
            "ip": self.ip,
            "user": self.user,
            "port": self.port,
            "connection_mode": self.connection_mode,
            "extra_params": self.extra_params
        }

class CapacitySnapshot(db.Model):
    __tablename__ = 'capacity_snapshots'
    
    id = db.Column(db.Integer, primary_key=True)
    timestamp = db.Column(db.DateTime, default=datetime.utcnow, index=True)
    device_type = db.Column(db.String(50), index=True)  # 'vmware', 'storage'
    device_name = db.Column(db.String(100), index=True)
    device_ip = db.Column(db.String(50))
    metric_name = db.Column(db.String(50), index=True)  # 'cpu_usage', 'mem_usage', 'storage_used_pct'
    value = db.Column(db.Float)

    def to_dict(self):
        return {
            "timestamp": self.timestamp.isoformat(),
            "device_type": self.device_type,
            "device_name": self.device_name,
            "metric_name": self.metric_name,
            "value": self.value
        }
