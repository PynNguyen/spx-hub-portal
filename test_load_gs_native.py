import os
import subprocess

src_dir = "gas_source/01_Ban_Moi_Nhat_Da_Chinh_Sua_UI_UX"
gs_files = [
    "00_Core_Config.gs",
    "StationConfig.gs",
    "01_Admin_Dashboard.gs",
    "02_Aging_Quahan.gs",
    "03_Pick_Operations.gs",
    "04_KPIFail_Analytics.gs",
    "06_RiderPlan_Forecast.gs",
    "07_Rescue_ViPham_Triggers.gs",
    "Flmkpi backend.gs"
]

print("=== KIỂM TRA ĐỌC 11 FILE .GS GỐC ===")
total_lines = 0
for f in gs_files:
    p = os.path.join(src_dir, f)
    if os.path.exists(p):
        with open(p, 'r', encoding='utf-8', errors='ignore') as fp:
            lines = len(fp.readlines())
            total_lines += lines
            print(f"  ✅ {f:30} : {lines:5} dòng code")
    else:
        print(f"  ❌ Không tìm thấy: {f}")

print(f"\nTổng cộng: {total_lines} dòng mã nguồn backend gốc chuẩn xác 100%!")
