import re

with open('services/gas_runtime.js', 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Bổ sung các file .gs còn thiếu vào danh sách nạp
old_order = """    const order = [
      '00_Core_Config.gs',
      'StationConfig.gs',
      '01_Admin_Dashboard.gs',
      '02_Aging_Quahan.gs',
      '03_Pick_Operations.gs',
      '04_KPIFail_Analytics.gs',
      '06_RiderPlan_Forecast.gs',
      '07_Rescue_ViPham_Triggers.gs',
      'Flmkpi backend.gs'
    ];"""

new_order = """    const order = [
      '00_Core_Config.gs',
      'StationConfig.gs',
      '05_FMS_Live_Firestore.gs',
      'Firestore bridge.gs',
      'Multi_DB_Router.gs',
      '01_Admin_Dashboard.gs',
      '02_Aging_Quahan.gs',
      '03_Pick_Operations.gs',
      '04_KPIFail_Analytics.gs',
      '06_RiderPlan_Forecast.gs',
      '07_Rescue_ViPham_Triggers.gs',
      'Flmkpi backend.gs'
    ];"""

content = content.replace(old_order, new_order)

# 2. Thêm lock helper vào sandbox
old_sandbox = "LockService,"
new_sandbox = """LockService,
      _anaAcquireNamedLock: () => true,
      _anaReleaseNamedLock: () => true,"""

content = content.replace(old_sandbox, new_sandbox)

with open('services/gas_runtime.js', 'w', encoding='utf-8') as f:
    f.write(content)

print("✅ Đã cập nhật services/gas_runtime.js đầy đủ 12 file!")
