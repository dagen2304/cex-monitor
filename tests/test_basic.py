import pytest
from run import create_app
from app.models import db

@pytest.fixture
def app():
    app = create_app({
        "TESTING": True,
        "SQLALCHEMY_DATABASE_URI": "sqlite:///:memory:",
        "SECRET_KEY": "test-key"
    })

    with app.app_context():
        yield app

@pytest.fixture
def client(app):
    return app.test_client()

def test_config_loading(app):
    """Vérifie que la configuration se charge correctement."""
    assert app.config['SECRET_KEY'] is not None
    assert 'VERIFY_SSL' in app.config

def test_main_route(client):
    """Vérifie que la page d'accueil est accessible."""
    response = client.get('/')
    assert response.status_code == 200
