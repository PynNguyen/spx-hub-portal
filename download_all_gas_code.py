import urllib.request
import subprocess
import json
import os

script_id = "1A_lTYBUfc6d0rkx5-vGdUifjKOH2ltVUOk2pQwf3JyGzo2nGtMbUwUSZ"
token = subprocess.check_output(['gcloud', 'auth', 'application-default', 'print-access-token']).decode().strip()

headers = {
    "Authorization": f"Bearer {token}",
    "X-Goog-User-Project": "spxshopee-280db"
}

output_dir = "src_gas"
os.makedirs(output_dir, exist_ok=True)

print("="*70)
print(f"BẮT ĐẦU TẢI TOÀN BỘ MÃ NGUỒN TỪ APPS SCRIPT ID: {script_id}")
print("="*70)

# 1. Thử gọi Apps Script API v1
api_url = f"https://script.googleapis.com/v1/projects/{script_id}/content"
req = urllib.request.Request(api_url, headers=headers)

try:
    with urllib.request.urlopen(req, timeout=15) as resp:
        project_data = json.loads(resp.read().decode())
        files = project_data.get('files', [])
        print(f"🎉 THÀNH CÔNG! Tìm thấy {len(files)} files trong dự án Google Apps Script!\n")

        saved_gs = []
        saved_html = []
        for f in files:
            name = f.get('name')
            ftype = f.get('type')
            source = f.get('source', '')

            ext = ".gs" if ftype == "SERVER_JS" else (".html" if ftype == "HTML" else ".json")
            file_path = os.path.join(output_dir, f"{name}{ext}")

            with open(file_path, 'w', encoding='utf-8') as out_f:
                out_f.write(source)

            if ext == ".gs":
                saved_gs.append(f"{name}.gs")
            elif ext == ".html":
                saved_html.append(f"{name}.html")

        print("--- DANH SÁCH FILE .gs (LOGIC & CÔNG THỨC SERVER GỐC) ---")
        for g in sorted(saved_gs):
            print(f"  📄 {g}")

        print(f"\n--- DANH SÁCH FILE .html (GIAO DIỆN & CLIENT JS GỐC) ---")
        for h in sorted(saved_html):
            print(f"  🌐 {h}")

        print(f"\n✅ ĐÃ LƯU TOÀN BỘ {len(files)} FILES VÀO THƯ MỤC: {output_dir}/")

except urllib.error.HTTPError as e:
    print(f"Mã lỗi HTTP: {e.code}")
    print("Chi tiết phản hồi từ Google:\n", e.read().decode())
except Exception as e:
    print("Lỗi:", e)
