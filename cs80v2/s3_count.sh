#!/bin/sh
# Cross-compile cs80v2 for the ESP32-S3 and list every zero-overhead loop body:
# static instructions, FP ops, branches, memory ops. Also lists calls made
# from control_tick (soft-float / libm helpers).
cd "$(dirname "$0")"
XT=../toolchain/xtensa-esp-elf/bin/xtensa-esp32s3-elf
$XT-g++ -std=c++17 -O2 -ffast-math -mlongcalls -fno-exceptions -fno-rtti -c s3_kernel.cpp -o s3_kernel.o || exit 1
$XT-objdump -d -C s3_kernel.o > s3_kernel.S
$XT-size -A s3_kernel.o | grep -E "^\.(text|literal|bss|data|rodata)" | awk '{s[$1]+=$2} END {for (k in s) print k, s[k]}'
python3 - <<'PY'
import re, collections
lines = open("s3_kernel.S").read().splitlines()
fn = None
funcs = collections.OrderedDict()
for i, l in enumerate(lines):
    m = re.match(r"[0-9a-f]+ <(.*)>:", l)
    if m:
        fn = m.group(1); funcs[fn] = []
        continue
    m = re.match(r"\s+([0-9a-f]+):\s+[0-9a-f]+\s+(\S+)\s*(.*)", l)
    if m and fn:
        funcs[fn].append((int(m.group(1), 16), m.group(2), m.group(3)))
for fn, ins in funcs.items():
    for k, (a, op, args) in enumerate(ins):
        if op in ("loop", "loopnez", "loopgtz"):
            end = int(re.match(r"a\d+,\s*([0-9a-f]+)", args).group(1), 16)
            body = [x for x in ins[k + 1:] if x[0] < end and not x[1].startswith(".byte")]
            n = len(body)
            fp = sum(x[1].endswith(".s") for x in body)
            br = sum(x[1].startswith("b") and x[1] not in ("break",) for x in body) + sum(x[1] == "j" for x in body)
            mem = sum(x[1].startswith(("l32", "s32", "l16", "s16", "lsi", "ssi", "lsx", "ssx", "lsip", "ssip", "l8", "s8")) for x in body)
            print(f"LOOP {fn[:70]:70s} @{a:#07x}: {n:3d} instr, {fp:3d} FP, {br:2d} branch, {mem:3d} mem")
# loops closed by a backward branch (no zero-overhead loop)
for fn, ins in funcs.items():
    if not any(k in fn for k in ("Chorus::process", "Plate", "EchoLine")): continue
    for k, (a, op, args) in enumerate(ins):
        m = re.match(r"(?:a\d+, )*(?:a\d+|b\d+), ([0-9a-f]+) <", args) if op.startswith("b") else None
        if m and int(m.group(1), 16) < a:
            t = int(m.group(1), 16)
            body = [x for x in ins if t <= x[0] <= a]
            fp = sum(x[1].endswith(".s") for x in body)
            calls = sum(x[1].startswith("call") for x in body)
            print(f"BLOOP {fn[:70]:70s} @{t:#07x}: {len(body):3d} instr, {fp:3d} FP, {calls} calls")
for fn, ins in funcs.items():
    if "::step(" in fn:
        n = len(ins); fp = sum(x[1].endswith(".s") for x in ins)
        br = sum(x[1].startswith("b") for x in ins)
        print(f"STEP {fn[:70]:70s}: {n:4d} static instr incl. prologue, {fp} FP, {br} branches")
for fn, ins in funcs.items():
    if "control_tick" in fn or "note_on" in fn or "run_events" in fn:
        calls = collections.Counter(x[2].split("<")[-1].rstrip(">") for x in ins if x[1].startswith("call"))
        print(f"FUNC {fn[:60]}: {len(ins)} static instr; calls: {dict(calls)}")
PY
