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

print(f"--- BRUTE FORCE CLUSTER FIELDS POWERSTORE {ip} ---")

fields = ["physical_total", "physical_used", "logical_total", "logical_used", "size", "used", "total_capacity", "used_capacity"]
path = f"/cluster/0?select=id,{','.join(fields)}"
try:
    r = session.get(f"{base}{path}", timeout=15)
    print(f"Status: {r.status_code}")
    if r.status_code == 200:
        print(json.dumps(r.json(), indent=2))
    else:
        print(r.text)
except Exception as e: print(f"Error: {e}")
