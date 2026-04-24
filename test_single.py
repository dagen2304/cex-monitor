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

print(f"--- TEST SINGLE FIELD POWERSTORE {ip} ---")

for f in ["physical_total", "physical_used", "physical_total_bytes", "physical_used_bytes", "size", "capacity"]:
    print(f"Testing {f}...")
    try:
        r = session.get(f"{base}/appliance/A1?select={f}", timeout=10)
        if r.status_code == 200:
            print(f"  SUCCESS! {f} = {r.json().get(f)}")
        else:
            print(f"  Fail {f}: {r.status_code}")
    except Exception as e: print(f"  Error {f}: {e}")
