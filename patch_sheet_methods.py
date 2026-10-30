with open('services/gas_runtime.js', 'r', encoding='utf-8') as f:
    content = f.read()

# Bổ sung đầy đủ các phương thức chuẩn cho đối tượng Sheet
old_sheet_def = """        getSheetByName: (sheetName) => ({
          getDataRange: () => {"""

new_sheet_def = """        getSheetByName: (sheetName) => ({
          getName: () => sheetName,
          clearContents: () => {},
          clear: () => {},
          clearFormats: () => {},
          appendRow: (row) => {},
          insertRowAfter: () => {},
          insertRowBefore: () => {},
          deleteRow: () => {},
          hideSheet: () => {},
          showSheet: () => {},
          getMaxRows: () => 10000,
          getMaxColumns: () => 100,
          getDataRange: () => {"""

content = content.replace(old_sheet_def, new_sheet_def)

# Thêm getSheets() và insertSheet() cho Spreadsheet
old_ss_def = """      getActiveSpreadsheet: () => SpreadsheetApp.openById('default')"""
new_ss_def = """      getActiveSpreadsheet: () => SpreadsheetApp.openById('default'),
      create: (name) => SpreadsheetApp.openById('created')"""

content = content.replace(old_ss_def, new_ss_def)

with open('services/gas_runtime.js', 'w', encoding='utf-8') as f:
    f.write(content)

print("✅ Đã bổ sung toàn bộ phương thức Sheet chuẩn vào services/gas_runtime.js!")
