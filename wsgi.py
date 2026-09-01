import sys
import os

# Add src folder to Python module path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "src"))

from server import app

if __name__ == "__main__":
    app.run()
