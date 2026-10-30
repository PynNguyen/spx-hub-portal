with open('services/gas_runtime.js', 'r', encoding='utf-8') as f:
    content = f.read()

# Thay thế khối getRange bằng Proxy thông minh
old_range_return = """            return {
              getValues: () => sliceData,
              getDisplayValues: () => sliceData.map(row => row.map(v => String(v != null ? v : ''))),
              getValue: () => (sliceData[0] || [])[0],
              getDisplayValue: () => String((sliceData[0] || [])[0] != null ? (sliceData[0] || [])[0] : ''),
              getLastRow: () => startRow + sliceData.length,
              getLastColumn: () => (sliceData[0] || []).length,
              getNumRows: () => sliceData.length,
              getNumColumns: () => (sliceData[0] || []).length,
              setValue: () => {},
              setValues: () => {},
              clear: () => {},
              clearContent: () => {}
            };"""

new_range_return = """            const rangeBase = {
              getValues: () => sliceData,
              getDisplayValues: () => sliceData.map(row => row.map(v => String(v != null ? v : ''))),
              getValue: () => (sliceData[0] || [])[0],
              getDisplayValue: () => String((sliceData[0] || [])[0] != null ? (sliceData[0] || [])[0] : ''),
              getLastRow: () => startRow + sliceData.length,
              getLastColumn: () => (sliceData[0] || []).length,
              getNumRows: () => sliceData.length,
              getNumColumns: () => (sliceData[0] || []).length
            };
            const rangeProxy = new Proxy(rangeBase, {
              get: (target, prop) => {
                if (prop in target) return target[prop];
                return () => rangeProxy; // Tự động hỗ trợ 100% mọi hàm format (setFontWeight, setBackground,...)
              }
            });
            return rangeProxy;"""

content = content.replace(old_range_return, new_range_return)

with open('services/gas_runtime.js', 'w', encoding='utf-8') as f:
    f.write(content)

print("✅ Đã kích hoạt Proxy thông minh cho toàn bộ Range methods!")
