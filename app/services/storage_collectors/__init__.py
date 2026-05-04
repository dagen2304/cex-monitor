from .unity_collector import collect as unity_collect
from .powerstore_collector import collect as powerstore_collect
from .datadomain_collector import collect as datadomain_collect
from .dorado_collector import collect as dorado_collect
from .scality_collector import collect as scality_collect

COLLECTOR_REGISTRY = {
    "Unity": {
        "fn": unity_collect,
        "prefix": "UNITY_",
        "user_env": "UNITY_USER",
        "pwd_env": "UNITY_PASSWORD"
    },
    "PowerStore": {
        "fn": powerstore_collect,
        "prefix": "POWERSTORE_",
        "user_env": "POWERSTORE_USER",
        "pwd_env": "POWERSTORE_PASSWORD"
    },
    "DataDomain": {
        "fn": datadomain_collect,
        "prefix": "DD_",
        "user_env": "DD_USER",
        "pwd_env": "DD_PASSWORD"
    },
    "Dorado": {
        "fn": dorado_collect,
        "prefix": "DORADO_",
        "user_env": "DORADO_USER",
        "pwd_env": "DORADO_PASSWORD"
    },
    "Scality": {
        "fn": scality_collect,
        "prefix": "SCALITY_",
        "user_env": "SCALITY_USER",
        "pwd_env": "SCALITY_PASSWORD"
    }
}
