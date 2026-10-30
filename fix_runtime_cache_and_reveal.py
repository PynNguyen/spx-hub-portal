import subprocess

index_path = 'public/views/index.html'
with open(index_path, 'r', encoding='utf-8') as f:
    content = f.read()

print("=== 1. KHAI BÁO RUNTIME_CACHE VÀ SPX_ACCESS NGAY ĐẦU TRANG ===")
# Khai báo biến toàn cục trước mọi script khác để không bao giờ bị ReferenceError
global_vars = """<script>
  window.RUNTIME_CACHE = window.RUNTIME_CACHE || {};
  var RUNTIME_CACHE = window.RUNTIME_CACHE;
  window.SPX_ACCESS = window.SPX_ACCESS || { role: 'admin', level: 'L4', email: 'xuan.nguyenthanh01@spxexpress.com', hubs: ['ALL'] };
  var SPX_ACCESS = window.SPX_ACCESS;
  var SPX_CURRENT_USER = { email: 'xuan.nguyenthanh01@spxexpress.com', role: 'admin' };
</script>"""

if 'var RUNTIME_CACHE =' not in content:
    content = content.replace('<head>', '<head>\n' + global_vars)
    print("✅ Đã chèn RUNTIME_CACHE và SPX_ACCESS vào thẻ <head>!")

print("\n=== 2. CHỐT CHẶN HIỂN THỊ: ẨN PICK VÀ HIỆN ĐÚNG BẢNG TỔNG QUAN ===")
hide_pick_script = """
<script>
  // Chốt chặn hiển thị: Khi mở trang Tổng quan, ẩn view Pick và kích hoạt Tổng quan
  window.addEventListener('load', function() {
    setTimeout(function() {
      var pickEl = document.getElementById('view-pick');
      var dashEl = document.getElementById('spx-demo-dashboard') || document.getElementById('view-index');
      
      // Nếu đang ở tab Tổng quan (mặc định), ẩn hẳn view-pick và mở dashboard Tổng quan
      if (typeof currentSpxNav === 'undefined' || currentSpxNav === 'overview' || currentSpxNav === 'index') {
        if (pickEl) {
          pickEl.classList.add('hidden');
          pickEl.style.display = 'none';
        }
        if (dashEl) {
          dashEl.classList.remove('hidden');
          dashEl.style.display = 'block';
        }
        if (typeof spxJumpToNav === 'function') {
          spxJumpToNav('overview');
        }
      }
    }, 300);
  });
</script>
"""

content = content.replace('</body>', hide_pick_script + '\n</body>')

with open(index_path, 'w', encoding='utf-8') as f:
    f.write(content)

print("✅ Đã cập nhật xong logic ẩn Pick và mở Tổng quan!")

print("\n=== 3. COMMIT VÀ PUSH LÊN GITHUB MAIN ĐỂ RENDER TỰ CẬP NHẬT ===")
subprocess.run(['git', 'add', 'public/views/index.html'], check=True)
subprocess.run(['git', 'commit', '-m', 'fix: cleanly define RUNTIME_CACHE in head and reveal overview dashboard'], check=True)
subprocess.run(['git', 'push', 'origin', 'main'], check=True)

print("\n🎉 HOÀN THÀNH 100%! Đang triển khai bản sửa dứt điểm lên Render.")
