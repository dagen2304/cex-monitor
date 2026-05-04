import pytest
from run import create_app
from app.models import db, Device
from app.config import Config

@pytest.fixture
def app():
    app = create_app({
        "TESTING": True,
        "SQLALCHEMY_DATABASE_URI": "sqlite:///:memory:",
        "SECRET_KEY": "test-key"
    })

    with app.app_context():
        # Add a test device
        dev = Device(
            device_type='vcenter',
            name='Test-VC',
            ip='1.2.3.4',
            user='user',
            pwd='pwd',
            port=443,
            connection_mode='SDK'
        )
        db.session.add(dev)
        db.session.commit()
        yield app

def test_db_device_loading(app):
    """Vérifie que les équipements sont chargés depuis la DB avec les nouveaux champs."""
    with app.app_context():
        vcs = Config.get_configured_vcenters()
        assert len(vcs) == 1
        assert vcs[0]['name'] == 'Test-VC'
        assert vcs[0]['port'] == 443
        assert vcs[0]['connection_mode'] == 'SDK'

def test_storage_list_building(app):
    """Vérifie la construction de la liste des baies de stockage."""
    from app.services.storage_health import _build_array_list
    with app.app_context():
        # Add a Unity device
        dev = Device(
            device_type='unity',
            name='Test-Unity',
            ip='5.6.7.8',
            user='u',
            pwd='p',
            port=443,
            connection_mode='REST'
        )
        db.session.add(dev)
        db.session.commit()
        
        arrays = _build_array_list('Unity', 'UNITY_')
        assert len(arrays) == 1
        assert arrays[0]['name'] == 'Test-Unity'
        assert arrays[0]['port'] == 443
        assert arrays[0]['connection_mode'] == 'REST'
