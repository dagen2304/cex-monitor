import os
import requests
import urllib3
import json
from dotenv import load_dotenv

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
load_dotenv()

def test_powerstore(ip, user, password):
    print(f"\n--- Testing PowerStore: {ip} ---")
    session = requests.Session()
    session.auth = (user, password)
    session.verify = False
    base = f"https://{ip}/api/rest"
    
    try:
        r = session.get(f"{base}/cluster?select=id,name,state,physical_total_bytes,physical_used_bytes", timeout=30)
        print(f"Status: {r.status_code}")
        print(f"Response: {json.dumps(r.json(), indent=2)}")
    except Exception as e:
        print(f"Error: {e}")

def test_datadomain(ip, user, password):
    print(f"\n--- Testing Data Domain: {ip} ---")
    session = requests.Session()
    session.verify = False
    
    # Try login
    for ver in ["v1.0", "v2.0", "v3.0"]:
        base = f"https://{ip}:3009/rest/{ver}"
        try:
            print(f"Trying version {ver}...")
            r = session.post(f"{base}/auth", json={"auth_info": {"username": user, "password": password}}, timeout=10)
            if r.status_code in [200, 201]:
                print(f"Login success on {ver}!")
                # Try system info
                rs = session.get(f"{base}/system", timeout=10)
                print(f"System Info Status: {rs.status_code}")
                # Try capacity
                rc = session.get(f"{base}/filesys", timeout=10)
                print(f"Capacity Status: {rc.status_code}")
                if rc.status_code == 200:
                    print(f"Capacity Data: {json.dumps(rc.json(), indent=2)}")
                return
            else:
                print(f"Login failed: {r.status_code} - {r.text}")
        except Exception as e:
            print(f"Connection failed: {e}")

if __name__ == "__main__":
    ps_ip = os.getenv("POWERSTORE_1_IP")
    ps_user = os.getenv("POWERSTORE_USER")
    ps_pass = os.getenv("POWERSTORE_PASSWORD")
    
    dd_ip = os.getenv("DD_1_IP")
    dd_user = os.getenv("DD_USER")
    dd_pass = os.getenv("DD_PASSWORD")
    
    if ps_ip: test_powerstore(ps_ip, ps_user, ps_pass)
    if dd_ip: test_datadomain(dd_ip, dd_user, dd_pass)
