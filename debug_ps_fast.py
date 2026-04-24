import os
import requests
import urllib3
import json
from dotenv import load_dotenv

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
load_dotenv()

ip = os.getenv("POWERSTORE_1_IP")
user = os.getenv("POWERSTORE_USER")
pwd = os.getenv("POWERSTORE_PASSWORD")
base = f"https://{ip}/api/rest"

session = requests.Session()
session.auth = (user, pwd)
session.verify = False

print(f"--- DEBUG POWERSTORE {ip} ---")

try:
    print("1. Fetching /cluster...")
    r = session.get(f"{base}/cluster", timeout=15)
    print(f"Status: {r.status_code}")
    if r.status_code == 200:
        print(json.dumps(r.json(), indent=2))
except Exception as e: print(f"Error /cluster: {e}")

try:
    print("\n2. Fetching /appliance...")
    r = session.get(f"{base}/appliance", timeout=15)
    print(f"Status: {r.status_code}")
    if r.status_code == 200:
        print(json.dumps(r.json(), indent=2))
except Exception as e: print(f"Error /appliance: {e}")

try:
    print("\n3. Fetching /space_metrics (limit 1)...")
    r = session.get(f"{base}/space_metrics?limit=1&order=timestamp.desc", timeout=15)
    print(f"Status: {r.status_code}")
    if r.status_code == 200:
        print(json.dumps(r.json(), indent=2))
except Exception as e: print(f"Error /space_metrics: {e}")
