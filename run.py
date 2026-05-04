from flask import Flask
from app.api.main_routes import main_bp
from app.api.vmware_routes import vmware_bp
from app.api.storage_routes import storage_bp
from app.api.config_routes import config_bp
from app.api.capacity_routes import capacity_bp
from app.utils.logger import setup_logger
from app.models import db
from app.config import Config
from app.services.scheduler import init_scheduler

def create_app():
    # Configuration du logging
    setup_logger()
    
    app = Flask(__name__)
    app.config.from_object(Config)
    
    # Initialisation DB
    db.init_app(app)
    with app.app_context():
        db.create_all()
    
    # Initialisation Scheduler
    init_scheduler(app)
    
    # Registration des Blueprints
    app.register_blueprint(main_bp)
    app.register_blueprint(vmware_bp)
    app.register_blueprint(storage_bp)
    app.register_blueprint(config_bp)
    app.register_blueprint(capacity_bp)
    
    return app

if __name__ == '__main__':
    app = create_app()
    # On désactive le reloader sur Windows pour éviter WinError 10038
    app.run(debug=True, host='0.0.0.0', port=5000, use_reloader=False)
