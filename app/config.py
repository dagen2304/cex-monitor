import os
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

class Config:
    SECRET_KEY = os.getenv('SECRET_KEY', 'you-will-never-guess')
    LOG_FILE = 'cex-monitor.log'
    LOG_FORMAT = '%(asctime)s - %(levelname)s - %(message)s'
    LOG_DATE_FORMAT = '%Y-%m-%d %H:%M:%S'
    
    # SSL Security
    VERIFY_SSL = os.getenv("VERIFY_SSL", "False").lower() == "true"
    CA_BUNDLE = os.getenv("REQUESTS_CA_BUNDLE", None)
    
    # Database
    SQLALCHEMY_DATABASE_URI = 'sqlite:///capacity.db'
    SQLALCHEMY_TRACK_MODIFICATIONS = False
    
    @staticmethod
    def get_configured_vcenters():
        from app.models import Device
        vcenters = []
        
        try:
            db_devices = Device.query.filter_by(device_type='vcenter').all()
            for dev in db_devices:
                vcenters.append({
                    "name": dev.name,
                    "ip": dev.ip,
                    "user": dev.user,
                    "pwd": dev.pwd,
                    "port": dev.port,
                    "connection_mode": dev.connection_mode,
                    "extra_params": dev.extra_params
                })
        except Exception as e:
            import logging
            logging.error(f"Erreur chargement vCenters depuis DB: {e}")
        
        return sorted(vcenters, key=lambda x: x['name'])
