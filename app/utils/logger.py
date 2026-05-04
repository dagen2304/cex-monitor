import logging
from app.config import Config

def setup_logger():
    logging.basicConfig(
        filename=Config.LOG_FILE,
        level=logging.INFO,
        format=Config.LOG_FORMAT,
        datefmt=Config.LOG_DATE_FORMAT
    )
