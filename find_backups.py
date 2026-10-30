import os
import subprocess

print("=== 1. TÌM FILE BACKUP / .GS TRONG TOÀN BỘ CLOUD SHELL ===")
res = subprocess.run([
    "find", os.path.expanduser("~"), 
    "-maxdepth", "4",
    "(", 
      "-name", "*backup*", "-o", 
      "-name", "*.gs", "-o", 
      "-name", "*Du_An*", "-o", 
      "-name", "*toi_uu*", "-o",
      "-name", "*archive*"
    ")"
], capture_output=True, text=True)

lines = res.stdout.strip().split("\n") if res.stdout.strip() else []
found = [l for l in lines if not any(x in l for x in ['.git/', 'node_modules/', '.cache/'])]

if found:
    for f in found:
        print("  📁", f)
else:
    print("Không thấy trong các tên phổ biến, kiểm tra Git Stash / Branch...")

print("\n=== 2. KIỂM TRA GIT STASH & CÁC NHÁNH GIT ===")
subprocess.run(["git", "stash", "list"])
subprocess.run(["git", "branch", "-a"])
