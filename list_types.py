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

print(f"--- LIST TYPES POWERSTORE {ip} ---")

try:
    r = session.get(f"{base}/types", timeout=15)
    if r.status_code == 200:
        types = [t["name"] for t in r.json()]
        print(f"Total Types: {len(types)}")
        # Look for space/capacity related types
        keywords = ["space", "capacity", "metric", "pool", "usage"]
        matches = [t for t in types if any(k in t.lower() for k in keywords)]
        print(f"Space related types: {matches}")
except Exception as e: print(f"Error: {e}")
