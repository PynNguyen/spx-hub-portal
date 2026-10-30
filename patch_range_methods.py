with open('services/gas_runtime.js', 'r', encoding='utf-8') as f:
    content = f.read()

# Cập nhật getRange đầy đủ các phương thức chuẩn của Google Apps Script Range
old_range_block = """          getRange: (...args) => ({
            getValues: () => this.getSheetValues(sheetName),
            getValue: () => (this.getSheetValues(sheetName)[0] || [])[0]
          }),"""

new_range_block = """          getRange: (r, c, numRows, numCols) => {
            const all = this.getSheetValues(sheetName);
            const startRow = (r && r > 0) ? r - 1 : 0;
            const endRow = (numRows && numRows > 0) ? startRow + numRows : all.length;
            const rowsSlice = all.slice(startRow, endRow);
            const sliceData = rowsSlice.map(row => {
              const startCol = (c && c > 0) ? c - 1 : 0;
              const endCol = (numCols && numCols > 0) ? startCol + numCols : row.length;
              return row.slice(startCol, endCol);
            });

            return {
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
            };
          },"""

content = content.replace(old_range_block, new_range_block)

# Bổ sung getDisplayValues cho getDataRange
old_dr = """          getDataRange: () => ({
            getValues: () => this.getSheetValues(sheetName)
          }),"""

new_dr = """          getDataRange: () => {
            const vals = this.getSheetValues(sheetName);
            return {
              getValues: () => vals,
              getDisplayValues: () => vals.map(row => row.map(v => String(v != null ? v : ''))),
              getLastRow: () => vals.length,
              getLastColumn: () => (vals[0] || []).length
            };
          },"""

content = content.replace(old_dr, new_dr)

with open('services/gas_runtime.js', 'w', encoding='utf-8') as f:
    f.write(content)

print("✅ Đã bổ sung getDisplayValues() đầy đủ vào services/gas_runtime.js!")
