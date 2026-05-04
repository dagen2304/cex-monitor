from flask import Flask
from app.api.main_routes import main_bp
from app.api.vmware_routes import vmware_bp
from app.api.storage_routes import storage_bp
from app.api.config_routes import config_bp
from app.utils.logger import setup_logger

def create_app():
    # Configuration du logging
    setup_logger()
    
    app = Flask(__name__)
    
    # Registration des Blueprints
    app.register_blueprint(main_bp)
    app.register_blueprint(vmware_bp)
    app.register_blueprint(storage_bp)
    app.register_blueprint(config_bp)
    
    return app

if __name__ == '__main__':
    app = create_app()
    # On désactive le reloader sur Windows pour éviter WinError 10038
    app.run(debug=True, host='0.0.0.0', port=5000, use_reloader=False)
