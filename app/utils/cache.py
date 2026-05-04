import time
from threading import Lock

class SimpleCache:
    def __init__(self, ttl=120):
        self.cache = {}
        self.ttl = ttl
        self.lock = Lock()
        self.diagnostics = {}

    def _purge_expired(self):
        """Supprime les entrées expirées du cache."""
        now = time.time()
        keys_to_delete = [
            k for k, (v, ts) in self.cache.items() 
            if now - ts > self.ttl
        ]
        for k in keys_to_delete:
            del self.cache[k]

    def get(self, key):
        with self.lock:
            self._purge_expired()
            if key in self.cache:
                val, timestamp = self.cache[key]
                return val
            return None

    def set(self, key, value):
        with self.lock:
            self._purge_expired()
            self.cache[key] = (value, time.time())
            # Update diagnostics
            if key not in self.diagnostics:
                self.diagnostics[key] = {"count": 0, "errors": 0, "last_time": 0}
            self.diagnostics[key]["count"] += 1
            self.diagnostics[key]["last_time"] = time.time()
            if isinstance(value, dict) and value.get("state") == "DOWN":
                self.diagnostics[key]["errors"] += 1

global_cache = SimpleCache(ttl=120)
