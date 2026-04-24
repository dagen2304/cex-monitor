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

print(f"--- DISKS POWERSTORE {ip} ---")

path = "/hardware?type=eq.Drive&select=id,name,state,capacity"
try:
    r = session.get(f"{base}{path}", timeout=15)
    print(f"Status: {r.status_code}")
    if r.status_code == 200:
        disks = r.json()
        print(f"Total Disks: {len(disks)}")
        if disks:
            print(f"First Disk: {json.dumps(disks[0], indent=2)}")
            total_raw = sum(d.get("capacity", 0) for d in disks)
            print(f"Total Raw Capacity: {total_raw / (1024**4)} TB")
    else:
        print(r.text)
except Exception as e: print(f"Error: {e}")
