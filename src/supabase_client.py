import os
import requests
import json

SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_KEY = os.getenv("SUPABASE_KEY", "")


class SupabaseClient:
    def __init__(self):
        self.url = SUPABASE_URL.rstrip("/")
        self.key = SUPABASE_KEY
        self.enabled = bool(self.url and self.key)
        if self.enabled:
            print(f"[Supabase] Connected to Cloud Database at {self.url}")
        else:
            print("[Supabase] Credentials not set. Running on local JSON + CSV database storage.")

    def _headers(self):
        return {
            "apikey": self.key,
            "Authorization": f"Bearer {self.key}",
            "Content-Type": "application/json",
            "Prefer": "resolution=merge-duplicates"
        }

    def sync_user(self, user_data):
        """Sync a user profile and embedding to Supabase 'users' table."""
        if not self.enabled:
            return False
        try:
            endpoint = f"{self.url}/rest/v1/users"
            payload = {
                "user_id": user_data.get("user_id"),
                "name": user_data.get("name"),
                "role": user_data.get("role", "User"),
                "registered_at": user_data.get("registered_at"),
                "face_image": user_data.get("face_image"),
                "feature_vector": user_data.get("feature"),
                "shortcuts": user_data.get("shortcuts", [])
            }
            res = requests.post(endpoint, headers=self._headers(), json=payload, timeout=5)
            return res.status_code in (200, 201)
        except Exception as e:
            print(f"[Supabase] User sync error: {e}")
            return False

    def fetch_user(self, user_id):
        """Fetch user data from Supabase 'users' table."""
        if not self.enabled:
            return None
        try:
            endpoint = f"{self.url}/rest/v1/users?user_id=eq.{user_id}&select=*"
            res = requests.get(endpoint, headers=self._headers(), timeout=5)
            if res.status_code == 200:
                data = res.json()
                if len(data) > 0:
                    return data[0]
            return None
        except Exception as e:
            print(f"[Supabase] Fetch user error: {e}")
            return None

    def sync_shortcut(self, user_id, shortcut_data):
        """Sync a personal shortcut/link to Supabase 'shortcuts' table."""
        if not self.enabled:
            return False
        try:
            endpoint = f"{self.url}/rest/v1/shortcuts"
            payload = {
                "id": shortcut_data.get("id"),
                "user_id": user_id,
                "name": shortcut_data.get("name"),
                "url": shortcut_data.get("url"),
                "type": shortcut_data.get("type"),
                "icon": shortcut_data.get("icon"),
                "color": shortcut_data.get("color"),
                "added_at": shortcut_data.get("added_at")
            }
            res = requests.post(endpoint, headers=self._headers(), json=payload, timeout=5)
            return res.status_code in (200, 201)
        except Exception as e:
            print(f"[Supabase] Shortcut sync error: {e}")
            return False


supabase = SupabaseClient()
