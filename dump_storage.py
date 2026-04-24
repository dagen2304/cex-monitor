import os
import requests
import urllib3
import json
from dotenv import load_dotenv

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
load_dotenv()

def dump_powerstore(ip, user, password):
    print(f"\n--- DUMP PowerStore: {ip} ---")
    session = requests.Session()
    session.auth = (user, password)
    session.verify = False
    base = f"https://{ip}/api/rest"
    
    try:
        print("Fetching Cluster ALL fields...")
        r = session.get(f"{base}/cluster", timeout=30)
        if r.status_code == 200:
            print(json.dumps(r.json(), indent=2))
        
        print("\nFetching Appliance ALL fields...")
        r = session.get(f"{base}/appliance", timeout=30)
        if r.status_code == 200:
            print(json.dumps(r.json(), indent=2))
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    ps_ip = os.getenv("POWERSTORE_1_IP")
    ps_user = os.getenv("POWERSTORE_USER")
    ps_pass = os.getenv("POWERSTORE_PASSWORD")
    if ps_ip: dump_powerstore(ps_ip, ps_user, ps_pass)
