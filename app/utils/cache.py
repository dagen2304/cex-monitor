import time
from threading import Lock

class SimpleCache:
    def __init__(self, ttl=120):
        self.cache = {}
        self.ttl = ttl
        self.lock = Lock()
        self.diagnostics = {}

    def get(self, key):
        with self.lock:
            if key in self.cache:
                val, timestamp = self.cache[key]
                if time.time() - timestamp < self.ttl:
                    return val
            return None

    def set(self, key, value):
        with self.lock:
            self.cache[key] = (value, time.time())
            # Update diagnostics
            if key not in self.diagnostics:
                self.diagnostics[key] = {"count": 0, "errors": 0, "last_time": 0}
            self.diagnostics[key]["count"] += 1
            self.diagnostics[key]["last_time"] = time.time()
            if isinstance(value, dict) and value.get("state") == "DOWN":
                self.diagnostics[key]["errors"] += 1

global_cache = SimpleCache(ttl=120)
