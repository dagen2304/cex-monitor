import os
from dotenv import load_dotenv
from storage_collectors import powerstore_collector
import json

load_dotenv()

ip = os.getenv("POWERSTORE_1_IP")
user = os.getenv("POWERSTORE_USER")
pwd = os.getenv("POWERSTORE_PASSWORD")
name = os.getenv("POWERSTORE_1_NAME", "Test-PS")

print(f"Testing collector for {name} ({ip})...")
res = powerstore_collector.collect(ip, name, user, pwd)
print(json.dumps(res, indent=2))
