with open('services/rpc_dispatcher.js', 'r', errors='ignore') as f:
    lines = f.readlines()

start = -1
for i, l in enumerate(lines):
    if 'getKpiBundle(' in l and i > 50:
        start = i
        break

if start != -1:
    print("".join(lines[start:start+100]))
