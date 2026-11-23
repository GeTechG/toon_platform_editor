#!/usr/bin/env python3
"""Analyze and compare Firefox / Waterfox Profiler (.json / .json.gz) captures
for the toonop studio editor (WebGL2, rAF, Sync WebGL IPC, DOM/Styles, GC,
Compositor, and CanvasRenderer).

Usage:
    python3 scripts/analyze-gecko-profile.py <profile.json.gz> [after.json.gz ...]
"""

import gzip
import json
import os
import sys
from collections import Counter, defaultdict


def load_profile(path: str) -> dict:
    if path.endswith(".gz"):
        with gzip.open(path, "rt", encoding="utf-8") as f:
            return json.load(f)
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def pct(vals: list[float], p: float) -> float:
    if not vals:
        return 0.0
    s = sorted(vals)
    idx = min(len(s) - 1, max(0, int(round((p / 100.0) * (len(s) - 1)))))
    return s[idx]


def make_resolver(shared: dict):
    ft = shared["funcTable"]
    strs = shared["stringArray"]
    sources = shared.get("sources") or {}
    src_filenames = sources.get("filename") or []
    ft_names = ft["name"]
    ft_sources = ft.get("source") or []
    ft_filenames = ft.get("fileName") or []
    ft_isjs = ft.get("isJS") or []
    ft_flags = ft.get("flags") or []
    cache: dict[int, tuple[str, bool, str, str]] = {}

    def resolve(fidx: int) -> tuple[str, bool, str, str]:
        hit = cache.get(fidx)
        if hit is not None:
            return hit
        nidx = ft_names[fidx]
        name = strs[nidx] if nidx is not None and nidx < len(strs) else str(nidx)
        fname = ""
        if fidx < len(ft_sources) and ft_sources[fidx] is not None and ft_sources[fidx] > 0:
            sidx = ft_sources[fidx]
            if sidx < len(src_filenames) and src_filenames[sidx] is not None:
                fn_idx = src_filenames[sidx]
                if fn_idx < len(strs):
                    fname = strs[fn_idx]
        elif fidx < len(ft_filenames) and ft_filenames[fidx] is not None:
            fn_idx = ft_filenames[fidx]
            if fn_idx < len(strs):
                fname = strs[fn_idx]
        if ft_isjs:
            is_js = bool(ft_isjs[fidx]) if fidx < len(ft_isjs) else False
        elif ft_flags:
            is_js = bool(ft_flags[fidx] & 1) if fidx < len(ft_flags) else False
        else:
            is_js = False
        short = fname.split("/")[-1].split("?")[0] if fname else ""
        label = f"{name} [{short}]" if short and short != "<URL>" else name
        res = (label, is_js, name, fname)
        cache[fidx] = res
        return res

    return resolve


def get_stack_reader(thread: dict, shared: dict):
    st = thread.get("stackTable") or shared["stackTable"]
    fr = thread.get("frameTable") or shared["frameTable"]
    st_frame = st["frame"]
    st_prefix = st.get("prefix")
    st_po = st.get("prefixOffset")
    fr_func = fr["func"]

    def parent(s: int):
        if st_prefix is not None:
            return st_prefix[s]
        off = st_po[s]
        return None if (off is None or off == 0) else s - off

    return st_frame, fr_func, parent


def sample_timestamps(samples: dict) -> tuple[list[float], float]:
    td = samples.get("timeDeltas")
    if td:
        ts: list[float] = []
        cur = 0.0
        for i, d in enumerate(td):
            cur = float(d or 0.0) if i == 0 else cur + float(d or 0.0)
            ts.append(cur)
        span = (ts[-1] - ts[0]) if len(ts) > 1 else 0.0
        return ts, span
    t = samples.get("time") or []
    ts = [float(x or 0.0) for x in t]
    span = (ts[-1] - ts[0]) if len(ts) > 1 else 0.0
    return ts, span


def pair_markers(thread: dict, shared: dict):
    m = thread["markers"]
    strs = thread.get("stringArray") or shared["stringArray"]
    n = m["length"]
    names = m["name"]
    starts = m["startTime"]
    ends = m["endTime"]
    phases = m["phase"]
    datas = m["data"]

    open_stacks: dict[tuple, list] = defaultdict(list)
    intervals: dict[str, list[tuple[float, float, float, object]]] = defaultdict(list)
    dom_durs: dict[str, list[float]] = defaultdict(list)
    ipc_durs: dict[str, list[float]] = defaultdict(list)

    for i in range(n):
        nidx = names[i]
        mname = strs[nidx] if nidx is not None and nidx < len(strs) else str(nidx)
        ph = phases[i]
        st = starts[i]
        en = ends[i]
        data = datas[i] if i < len(datas) else None
        etype = data.get("eventType") if isinstance(data, dict) else None
        key = (mname, etype) if etype else (mname, None)

        dur = None
        real_start = st
        if ph == 1 and st is not None and en is not None and en >= st:
            dur = en - st
        elif ph == 2 and st is not None:
            open_stacks[key].append((st, data))
        elif ph == 3 and open_stacks[key] and en is not None:
            ost, odata = open_stacks[key].pop()
            if en >= ost:
                dur = en - ost
                real_start = ost
                data = odata if odata is not None else data

        if dur is not None and real_start is not None and en is not None:
            intervals[mname].append((real_start, en, dur, data))
            if mname == "DOMEvent" and etype:
                dom_durs[etype].append(dur)
            if isinstance(data, dict) and data.get("category") in ("Sync IPC", "IPC"):
                ipc_durs[mname].append(dur)

    return intervals, dom_durs, ipc_durs


def cpu_scale_to_ms(meta: dict) -> float:
    unit = (meta.get("sampleUnits") or {}).get("threadCPUDelta", "us")
    if unit == "ns":
        return 1e-6
    if unit in ("us", "µs"):
        return 1e-3
    return 1.0


def fmt_stats(d: list[float]) -> str:
    if not d:
        return "n=0"
    return (
        f"n={len(d):4d} sum={sum(d):7.1f}ms avg={sum(d)/len(d):6.2f}ms "
        f"p50={pct(d,50):5.2f}ms p95={pct(d,95):6.2f}ms p99={pct(d,99):6.2f}ms max={max(d):6.2f}ms"
    )


TARGET_WEBGL_FUNCS = (
    "composeAndPresent",
    "drawCoverageChunked",
    "uploadAndDraw",
    "subarray",
    "bufferData",
    "bufferSubData",
    "tessellateStroke",
    "#rebuildStack",
    "#composeFrame",
    "#rasterizeLayerGroup",
    "#acquireLayerGroupTargets",
    "#rasterizePreparedGroup",
    "#renderGhostsInto",
    "#presentSheet",
    "#checkHealthy",
    "getError",
    "getUniformLocation",
    "generateMipmap",
    "texImage2D",
    "texStorage2D",
    "drawArrays",
    "__memcpy_avx_unaligned_erms",
)


def analyze_profile(path: str) -> dict:
    p = load_profile(path)
    meta = p.get("meta") or {}
    shared = p.get("shared") or {}
    interval = float(meta.get("interval", 1.0))
    cpu_to_ms = cpu_scale_to_ms(meta)
    resolve = make_resolver(shared)

    # Identify editor content tab (highest samples with editor/WebGL stack signatures)
    best_tab = None
    best_score = -1
    for idx, t in enumerate(p["threads"]):
        if t.get("name") != "GeckoMain" or t.get("processType") != "tab":
            continue
        samples = t.get("samples") or {}
        if samples.get("length", 0) == 0:
            continue
        st_frame, fr_func, parent = get_stack_reader(t, shared)
        hits = 0
        for sidx in samples["stack"]:
            if sidx is None:
                continue
            cur = sidx
            while cur is not None:
                _, _, raw_name, raw_file = resolve(fr_func[st_frame[cur]])
                lf = raw_file.lower()
                if "canvasview" in lf or "composer" in lf or "composeAndPresent" in raw_name or "scheduleDraw" in raw_name:
                    hits += 1
                    break
                cur = parent(cur)
        if hits > best_score:
            best_score = hits
            best_tab = (idx, t)

    if best_tab is None:
        raise RuntimeError(f"No content GeckoMain thread found in {path}")

    tab_idx, tab = best_tab
    samples = tab["samples"]
    ts, span_ms = sample_timestamps(samples)
    span_s = max(0.001, span_ms / 1000.0)
    st_frame, fr_func, parent = get_stack_reader(tab, shared)

    intervals, dom_durs, ipc_durs = pair_markers(tab, shared)
    init_m = intervals.get("PWebGL::Msg_Initialize") or []
    init_end = init_m[0][1] if init_m else None
    rafs = sorted(intervals.get("requestAnimationFrame callbacks") or [], key=lambda x: x[0])
    t0 = rafs[0][0] if rafs else (ts[0] if ts else 0.0)

    steady_rafs = [x for x in rafs if init_end is None or x[0] > init_end + 500.0]
    cold_rafs = [x for x in rafs if init_end is not None and x[0] <= init_end + 500.0]
    get_errs = sorted(intervals.get("PWebGL::Msg_GetError") or [], key=lambda x: x[0])
    steady_errs = [x for x in get_errs if init_end is None or x[0] > init_end + 500.0]

    cpu_ms = sum(x for x in (samples.get("threadCPUDelta") or []) if x is not None and x > 0) * cpu_to_ms
    event_delays = [float(x) for x in (samples.get("eventDelay") or []) if x is not None]

    # Sample breakdown
    draw_all = Counter()
    draw_steady = Counter()
    targeted = Counter()
    svelte_css_ms = 0.0
    pmove_ms = 0.0
    canvas2d_hits = Counter()

    for i, sidx in enumerate(samples["stack"]):
        if sidx is None:
            continue
        is_steady = init_end is None or (i < len(ts) and ts[i] > init_end + 500.0)
        chain: list[str] = []
        cur = sidx
        while cur is not None:
            label, _, raw_name, _ = resolve(fr_func[st_frame[cur]])
            chain.append(raw_name)
            cur = parent(cur)
        chain.reverse()
        uniq = set(chain)

        for nm in uniq:
            for k in TARGET_WEBGL_FUNCS:
                if k.lower() in nm.lower():
                    targeted[nm] += interval
                    break
            if any(c in nm for c in ("CanvasRenderingContext2D", "FrameComposer", "Canvas2DSheetComposer")):
                canvas2d_hits[nm] += interval

        if any("CSSStyleDeclaration.setProperty" in nm for nm in uniq) and any("template_effect" in nm or "CanvasView" in nm for nm in uniq):
            svelte_css_ms += interval
        if any("onPointerMove" in nm for nm in uniq):
            pmove_ms += interval

        draw_pos = next((j for j, nm in enumerate(chain) if "scheduleDraw" in nm or nm == "draw" or "composeAndPresent" in nm), None)
        if draw_pos is not None:
            for nm in set(chain[draw_pos:]):
                draw_all[nm] += interval
                if is_steady:
                    draw_steady[nm] += interval

    # GC summary (incremental pause vs wall span)
    gc_major = intervals.get("GCMajor") or []
    gc_minor = intervals.get("GCMinor") or []
    gc_slices = intervals.get("GCSlice") or []
    max_gc_slice = max((x[2] for x in gc_slices), default=0.0)

    # Parent Compositor & CanvasRenderer
    comp_stats = {}
    cr_cpu_ms = 0.0
    cr_dispatch_ms = 0.0
    for t in p["threads"]:
        tname = t.get("name")
        if tname == "Compositor":
            c_int, _, _ = pair_markers(t, shared)
            for mk in ("CONTENT_FRAME_TIME", "CONTENT_FULL_PAINT_TIME", "ContentPaint Payload Presented"):
                if c_int.get(mk):
                    comp_stats[mk] = [x[2] for x in c_int[mk]]
        elif tname == "CanvasRenderer":
            cr_s = t["samples"]
            cr_cpu_ms = sum(x for x in (cr_s.get("threadCPUDelta") or []) if x is not None and x > 0) * cpu_to_ms
            crf, crfunc, crp = get_stack_reader(t, shared)
            for sidx in cr_s["stack"]:
                if sidx is None:
                    continue
                cur = sidx
                while cur is not None:
                    _, _, rn, _ = resolve(crfunc[crf[cur]])
                    if "RecvDispatchCommands" in rn or "Msg_DispatchCommands" in rn:
                        cr_dispatch_ms += interval
                        break
                    cur = crp(cur)

    # Per-second activity buckets
    buckets: dict[int, Counter] = defaultdict(Counter)
    for mk in ("requestAnimationFrame callbacks", "Styles", "DisplayList", "ViewManagerFlush", "PWebGL::Msg_GetError"):
        for st_t, _, _, _ in intervals.get(mk) or []:
            buckets[int((st_t - t0) // 1000)][mk] += 1
    for st_t, _, _, data in intervals.get("DOMEvent") or []:
        if isinstance(data, dict):
            et = data.get("eventType")
            if et in ("pointerdown", "pointermove", "pointerup"):
                buckets[int((st_t - t0) // 1000)][et] += 1

    return {
        "path": path,
        "name": os.path.basename(path),
        "product": f"{meta.get('product', '?')} {meta.get('misc', '')}".strip(),
        "os": meta.get("oscpu", "?"),
        "tab_idx": tab_idx,
        "pid": tab.get("pid"),
        "span_s": span_s,
        "cpu_ms": cpu_ms,
        "event_delays": event_delays,
        "rafs": rafs,
        "cold_rafs": cold_rafs,
        "steady_rafs": steady_rafs,
        "get_errs": get_errs,
        "steady_errs": steady_errs,
        "intervals": intervals,
        "dom_durs": dom_durs,
        "ipc_durs": ipc_durs,
        "draw_all": draw_all,
        "draw_steady": draw_steady,
        "targeted": targeted,
        "svelte_css_ms": svelte_css_ms,
        "pmove_ms": pmove_ms,
        "canvas2d_hits": canvas2d_hits,
        "gc_major": gc_major,
        "gc_minor": gc_minor,
        "max_gc_slice": max_gc_slice,
        "comp_stats": comp_stats,
        "cr_cpu_ms": cr_cpu_ms,
        "cr_dispatch_ms": cr_dispatch_ms,
        "buckets": buckets,
        "t0": t0,
    }


def print_report(r: dict) -> None:
    span = r["span_s"]
    print("=" * 95)
    print(f"PROFILE: {r['name']}")
    print(f"  Browser : {r['product']} | OS: {r['os']}")
    print(f"  Editor  : GeckoMain[{r['tab_idx']}] pid={r['pid']} | span={span:.2f}s | CPU={r['cpu_ms']:.1f}ms ({100*r['cpu_ms']/(span*1000):.1f}%)")

    ed = r["event_delays"]
    if ed:
        o16 = 100.0 * sum(1 for x in ed if x > 16.67) / len(ed)
        o50 = 100.0 * sum(1 for x in ed if x > 50.0) / len(ed)
        print(f"  EventDelay: avg={sum(ed)/len(ed):.2f}ms p50={pct(ed,50):.2f}ms p95={pct(ed,95):.2f}ms p99={pct(ed,99):.2f}ms max={max(ed):.2f}ms | >16.7ms:{o16:.1f}% >50ms:{o50:.1f}%")

    sd = [x[2] for x in r["steady_rafs"]]
    cd = [x[2] for x in r["cold_rafs"]]
    if cd:
        print(f"  Cold rAF  : {fmt_stats(cd)}")
    if sd:
        o16 = sum(1 for x in sd if x > 16.67)
        print(f"  Steady rAF: {fmt_stats(sd)} | >16.7ms:{o16}")
        slowest = sorted(r["steady_rafs"], key=lambda x: x[2], reverse=True)[:5]
        print(f"    Slowest steady rAFs (s: ms): {[(round((x[0]-r['t0'])/1000, 2), round(x[2], 2)) for x in slowest]}")

    for mk in ("RefreshDriverTick", "ViewManagerFlush", "DisplayList", "WrDisplayList", "Styles", "Reflow (sync)"):
        vals = [x[2] for x in r["intervals"].get(mk) or []]
        if vals:
            print(f"  {mk:20s}: {fmt_stats(vals)}")

    print(
        f"  GC        : GCMajor={len(r['gc_major'])} (max_slice={r['max_gc_slice']:.2f}ms), "
        f"GCMinor={len(r['gc_minor'])} (max={max((x[2] for x in r['gc_minor']), default=0.0):.2f}ms)"
    )

    print("  Sync/WebGL IPC:")
    for mk, vals in sorted(r["ipc_durs"].items(), key=lambda kv: sum(kv[1]), reverse=True)[:10]:
        print(f"    {mk:34s}: {fmt_stats(vals)} ({len(vals)/span:.1f}/s)")
    if r["steady_errs"]:
        print(
            "    Steady Msg_GetError (s: ms): "
            f"{[(round((x[0]-r['t0'])/1000, 2), round(x[2], 2)) for x in r['steady_errs'][:15]]}"
        )

    print("  Top DOMEvents:")
    for et, vals in sorted(r["dom_durs"].items(), key=lambda kv: sum(kv[1]), reverse=True)[:5]:
        print(f"    {et:22s}: {fmt_stats(vals)} ({len(vals)/span:.1f}/s)")

    print("  WebGL2 / Composer breakdown (ms, ms/s):")
    for fn, ms in r["targeted"].most_common(20):
        print(f"    {ms:6.1f}ms ({ms/span:5.1f}ms/s)  {fn}")

    print(f"  Cursor/Svelte hot path: onPointerMove={r['pmove_ms']:.0f}ms, template_effect setProperty={r['svelte_css_ms']:.0f}ms")
    if r["canvas2d_hits"]:
        print(f"  Canvas2D hits: {dict(r['canvas2d_hits'].most_common(5))}")
    else:
        print("  Canvas2D hits: none (100% WebGL2)")

    print(f"  CanvasRenderer: cpu={r['cr_cpu_ms']:.1f}ms ({100*r['cr_cpu_ms']/(span*1000):.1f}%), DispatchCommands={r['cr_dispatch_ms']:.0f}ms ({r['cr_dispatch_ms']/max(1,len(r['rafs'])):.2f}ms/rAF)")
    for mk, vals in r["comp_stats"].items():
        print(f"  Compositor {mk:30s}: {fmt_stats(vals)}")

    print("  Per-second timeline:")
    for sec in sorted(r["buckets"]):
        b = r["buckets"][sec]
        if sum(b.values()) == 0:
            continue
        print(
            f"    sec {sec:3d}: pdown={b['pointerdown']:2d} pmove={b['pointermove']:3d} pup={b['pointerup']:2d} | "
            f"rAF={b['requestAnimationFrame callbacks']:2d} | Styles={b['Styles']:3d} "
            f"DispList={b['DisplayList']:3d} Flush={b['ViewManagerFlush']:3d} | getErr={b['PWebGL::Msg_GetError']:2d}"
        )


def print_comparison(a: dict, b: dict) -> None:
    print("\n" + "=" * 95)
    print(f"COMPARISON: {a['name']}  -->  {b['name']}")
    sd_a = [x[2] for x in a["steady_rafs"]]
    sd_b = [x[2] for x in b["steady_rafs"]]
    ed_a = a["event_delays"]
    ed_b = b["event_delays"]
    cf_a = a["comp_stats"].get("CONTENT_FRAME_TIME") or []
    cf_b = b["comp_stats"].get("CONTENT_FRAME_TIME") or []

    rows = [
        ("Duration (s)", f"{a['span_s']:.2f}", f"{b['span_s']:.2f}"),
        ("Steady rAF avg / p95 / max (ms)",
         f"{sum(sd_a)/max(1,len(sd_a)):.2f} / {pct(sd_a,95):.2f} / {max(sd_a, default=0):.2f}",
         f"{sum(sd_b)/max(1,len(sd_b)):.2f} / {pct(sd_b,95):.2f} / {max(sd_b, default=0):.2f}"),
        ("Steady rAF > 16.7ms count",
         str(sum(1 for x in sd_a if x > 16.67)),
         str(sum(1 for x in sd_b if x > 16.67))),
        ("composeAndPresent (ms | ms/s)",
         f"{a['targeted']['composeAndPresent']:.0f} | {a['targeted']['composeAndPresent']/a['span_s']:.1f}",
         f"{b['targeted']['composeAndPresent']:.0f} | {b['targeted']['composeAndPresent']/b['span_s']:.1f}"),
        ("drawCoverageChunked (ms)",
         f"{a['targeted']['drawCoverageChunked']:.0f}",
         f"{b['targeted']['drawCoverageChunked']:.0f}"),
        ("tessellateStroke (ms)",
         f"{a['targeted']['tessellateStroke']:.0f}",
         f"{b['targeted']['tessellateStroke']:.0f}"),
        ("Steady PWebGL::Msg_GetError (n | ms)",
         f"{len(a['steady_errs'])} | {sum(x[2] for x in a['steady_errs']):.1f}",
         f"{len(b['steady_errs'])} | {sum(x[2] for x in b['steady_errs']):.1f}"),
        ("EventDelay avg / p95 / max (ms)",
         f"{sum(ed_a)/max(1,len(ed_a)):.2f} / {pct(ed_a,95):.2f} / {max(ed_a, default=0):.2f}",
         f"{sum(ed_b)/max(1,len(ed_b)):.2f} / {pct(ed_b,95):.2f} / {max(ed_b, default=0):.2f}"),
        ("CONTENT_FRAME_TIME avg / p95 / max",
         f"{sum(cf_a)/max(1,len(cf_a)):.2f} / {pct(cf_a,95):.2f} / {max(cf_a, default=0):.2f}",
         f"{sum(cf_b)/max(1,len(cf_b)):.2f} / {pct(cf_b,95):.2f} / {max(cf_b, default=0):.2f}"),
    ]
    for label, va, vb in rows:
        print(f"  {label:38s}: {va:24s} -> {vb}")


def main(argv: list[str]) -> int:
    if len(argv) < 2 or argv[1] in ("-h", "--help"):
        print(__doc__.strip())
        return 0 if len(argv) >= 2 else 2
    results = [analyze_profile(p) for p in argv[1:]]
    for r in results:
        print_report(r)
    if len(results) >= 2:
        print_comparison(results[0], results[-1])
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
