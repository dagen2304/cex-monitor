import os
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

class Config:
    LOG_FILE = 'cex-monitor.log'
    LOG_FORMAT = '%(asctime)s - %(levelname)s - %(message)s'
    LOG_DATE_FORMAT = '%Y-%m-%d %H:%M:%S'
    
    @staticmethod
    def get_vcenter_user():
        return os.getenv("VC_USER")

    @staticmethod
    def get_vcenter_password():
        return os.getenv("VC_PASSWORD")

    @staticmethod
    def get_configured_vcenters():
        user = Config.get_vcenter_user()
        pwd = Config.get_vcenter_password()
        vcenters = []
        for i in range(1, 51):
            ip = os.getenv(f"VC{i}_IP")
            if ip:
                vc_user = os.getenv(f"VC{i}_USER", user)
                vc_pwd = os.getenv(f"VC{i}_PASSWORD", pwd)
                vcenters.append({
                    "name": os.getenv(f"VC{i}_NAME", f"vCenter {i}"), 
                    "ip": ip,
                    "user": vc_user,
                    "pwd": vc_pwd
                })
        return vcenters

    @staticmethod
    def get_storage_credentials():
        return {
            "unity": (os.getenv("UNITY_USER", ""), os.getenv("UNITY_PASSWORD", "")),
            "powerstore": (os.getenv("POWERSTORE_USER", ""), os.getenv("POWERSTORE_PASSWORD", "")),
            "datadomain": (os.getenv("DD_USER", ""), os.getenv("DD_PASSWORD", "")),
            "dorado": (os.getenv("DORADO_USER", ""), os.getenv("DORADO_PASSWORD", "")),
            "scality": (os.getenv("SCALITY_USER", ""), os.getenv("SCALITY_PASSWORD", ""))
        }
