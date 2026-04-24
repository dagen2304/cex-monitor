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

print(f"--- SEARCHING FOR 175.8 TB VALUE IN {ip} ---")

target_value = 175.8 * (1024**4)
print(f"Target value around: {target_value}")

def search_obj(path):
    print(f"\nChecking {path}...")
    try:
        r = session.get(f"{base}{path}", timeout=15)
        if r.status_code == 200:
            data = r.json()
            if isinstance(data, list): data = data[0]
            for k, v in data.items():
                if isinstance(v, (int, float)):
                    tb = v / (1024**4)
                    if 150 < tb < 200:
                        print(f"  FOUND! {k} = {v} ({tb:.2f} TB)")
                    elif 800 < tb < 900:
                        print(f"  RAW? {k} = {v} ({tb:.2f} TB)")
        else: print(f"Error {path}: {r.status_code}")
    except Exception as e: print(f"Error {path}: {e}")

search_obj("/cluster/0")
search_obj("/appliance/A1")
search_obj("/storage_container/844dd1c9-a46b-4cfd-92ec-74fd6e3bb8d1")
search_obj("/hardware?type=eq.Drive")
