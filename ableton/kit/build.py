#!/usr/bin/env python3
"""Builds a Max for Live device from a description: the patcher (.maxpat,
readable), the same patcher as a device (.amxd), and one script bundle
holding the runtimes, the repository's own code and the device's window.

    python3 ableton/kit/build.py ableton/device.json
    python3 ableton/kit/build.py --check ableton/device.json   # fails if stale

Standard library only. The .amxd is the unfrozen format Max writes: a short
header naming the device type, then the patcher's JSON. The bundle sits beside
it; Max finds files in the device's own folder. Freeze the device in Max
(the snowflake in the Max editor) to carry everything in the one file.
"""
import json
import os
import struct
import sys

KIT = os.path.dirname(os.path.abspath(__file__))
TYPES = {"midi": b"mmmm", "audio": b"aaaa", "instrument": b"iiii",
         # Live 12's MIDI Tools, as Ableton's maxdevtools (maxdiff/amxd_textconv.py) names them
         "generator": b"nagg", "transformation": b"natt"}
# Live's clip-view panel for a MIDI Tool, the size of Max's own templates.
TOOL_WINDOW = [152, 147]
HEIGHT = 169


def read(path):
    with open(path, "rb") as f:
        return f.read()


def bundle(desc, base):
    """One script: the device's settings, its files as byte strings (one
    character per byte, as Middaw's Lua and JSFX runtimes keep them), then
    every script in order."""
    out = ["/* %s - built by ableton/kit/build.py from ableton/%s. Do not edit; edit the sources and rebuild. */"
           % (desc["name"], os.path.basename(desc["_path"]))]
    files = {}
    for virtual, source in desc.get("files", {}).items():
        if isinstance(source, dict):
            data = source["text"].encode("utf-8")
        else:
            data = read(os.path.join(base, source))
        files[virtual] = data.decode("latin-1")
    device = dict(desc.get("device", {}))
    device.setdefault("title", desc["name"])
    out.append("var DEVICE = %s;" % json.dumps(device, sort_keys=True))
    out.append("DEVICE.files = %s;" % json.dumps(files, ensure_ascii=True, sort_keys=True))
    for script in desc["scripts"]:
        path = os.path.join(base, script)
        out.append("\n/* ---- %s ---- */" % script)
        out.append(read(path).decode("utf-8"))
    return "\n".join(out) + "\n"


class Patch:
    def __init__(self):
        self.boxes, self.lines, self.params = [], [], {}

    def add(self, text=None, at=(20, 20), size=None, maxclass="newobj", ins=1, outs=1, outtype=None, **attrs):
        oid = "obj-%d" % (len(self.boxes) + 1)
        box = {"id": oid, "maxclass": maxclass, "numinlets": ins, "numoutlets": outs,
               "patching_rect": [float(at[0]), float(at[1]), float(size[0] if size else 100), float(size[1] if size else 22)]}
        if outs:
            box["outlettype"] = outtype or [""] * outs
        if text is not None:
            box["text"] = text
        box.update(attrs)
        self.boxes.append({"box": box})
        return oid

    def wire(self, a, outlet, b, inlet=0):
        self.lines.append({"patchline": {"source": [a, outlet], "destination": [b, inlet]}})

    def state(self, at):
        """A [pattr] kept with the Live set: a hidden blob parameter, so a
        device's settings are saved with the song without being automatable."""
        oid = self.add("pattr state", at=at, size=(80, 22), outs=3, outtype=["", "", ""],
                       parameter_enable=1, varname="state",
                       saved_attribute_attributes={"valueof": {
                           "parameter_longname": "state", "parameter_shortname": "state",
                           "parameter_type": 3, "parameter_invisible": 1, "parameter_initial_enable": 0}})
        self.params[oid] = ["state", "state", 0]
        return oid

    def json(self, desc, width):
        params = dict(self.params)
        params["inherited_shortname"] = 1
        return {"patcher": {
            "fileversion": 1,
            "appversion": {"major": 9, "minor": 0, "revision": 0, "architecture": "x64", "modernui": 1},
            "classnamespace": "box",
            "rect": [100.0, 100.0, 960.0, 560.0],
            "openinpresentation": 1,
            "default_fontsize": 10.0, "default_fontface": 0, "default_fontname": "Arial",
            "gridonopen": 1, "gridsize": [8.0, 8.0], "gridsnaponopen": 1, "objectsnaponopen": 1,
            "statusbarvisible": 2, "toolbarvisible": 1,
            "boxes": self.boxes, "lines": self.lines,
            "parameters": params,
            "dependency_cache": [{"name": desc["_bundle"], "bootpath": ".", "type": "TEXT", "implicit": 1}],
            "autosave": 0,
            "devicewidth": float(width),
            "description": desc.get("description", ""),
            "digest": desc.get("digest", ""),
            "tags": "",
            "style": "",
            "latency": 0,
            "is_mpe": 0,
        }}

    def tool_json(self, desc, width, kind):
        """A MIDI Tool's patcher: the device's, plus the project block that
        says which kind of tool it is (Max's amxdtype is the header's
        four letters as a number) and the keys Max reads with it."""
        j = self.json(desc, width)
        p = j["patcher"]
        p["openrect"] = [0.0, 0.0, float(width), float(desc["window"][1])]
        p["minimum_live_version"] = "12.0"
        p["project"] = {
            "version": 1, "creationdate": 3590052493, "modificationdate": 3590052493,
            "viewrect": [25.0, 124.0, 300.0, 500.0], "autoorganize": 1, "hideprojectwindow": 1,
            "showdependencies": 1, "autolocalize": 0, "contents": {"patchers": {}}, "layout": {},
            "searchpath": {}, "detailsvisible": 0, "amxdtype": int.from_bytes(TYPES[kind], "big"),
            "readonly": 0, "devpathtype": 0, "devpath": ".", "sortmode": 0, "viewmode": 0, "includepackages": 0}
        return j


def window(p, desc, width, ins=1, outs=2, height=HEIGHT):
    return p.add(maxclass="v8ui", at=(20, 200), size=(width, height), ins=ins, outs=outs,
                 filename=desc["_bundle"], parameter_enable=0, border=0,
                 presentation=1, presentation_rect=[0.0, 0.0, float(width), float(height)])


def midi_effect(desc, width):
    """MIDI passes through; the window adds its own (what it plays) to it."""
    p = Patch()
    mi = p.add("midiin", at=(20, 20), size=(50, 22), ins=1, outs=1, outtype=["int"])
    mo = p.add("midiout", at=(20, 420), size=(55, 22), ins=1, outs=0)
    dev = p.add("live.thisdevice", at=(120, 20), size=(90, 22), outs=3, outtype=["bang", "int", "int"])
    ui = window(p, desc, width, ins=1, outs=desc.get("outlets", 2))
    st = p.state(at=(420, 420))
    pre = p.add("prepend restore", at=(420, 460), size=(95, 22), outs=1)
    p.wire(mi, 0, desc.get("midi_to_window") and ui or mo, 0)
    p.wire(dev, 0, ui, 0)
    p.wire(ui, 0, mo, 0)
    p.wire(ui, 1, st, 0)
    p.wire(st, 0, pre, 0)
    p.wire(pre, 0, ui, 0)
    return p


def midi_tool(desc, width):
    """A Live 12 MIDI Tool (Generator or Transformation): Live's notes and
    context in, joined into one dictionary for the window (miditool.js),
    which answers with the notes to write. The window's third outlet bangs
    [live.miditool.in] to ask Live to apply again after a setting changes."""
    p = Patch()
    tin = p.add("live.miditool.in", at=(20, 20), size=(110, 22), ins=1, outs=2, outtype=["", ""])
    join = p.add("dict.join", at=(20, 60), size=(70, 22), ins=2, outs=1, outtype=["dictionary"])
    dev = p.add("live.thisdevice", at=(160, 20), size=(90, 22), outs=3, outtype=["bang", "int", "int"])
    ui = window(p, desc, width, ins=1, outs=3, height=desc["window"][1])
    tout = p.add("live.miditool.out", at=(20, 420), size=(110, 22), ins=1, outs=0)
    st = p.state(at=(420, 420))
    pre = p.add("prepend restore", at=(420, 460), size=(95, 22), outs=1)
    # The context (right) arrives first and is held; the notes (left) send the join.
    p.wire(tin, 1, join, 1)
    p.wire(tin, 0, join, 0)
    p.wire(join, 0, ui, 0)
    p.wire(dev, 0, ui, 0)
    p.wire(ui, 0, tout, 0)
    p.wire(ui, 1, st, 0)
    p.wire(st, 0, pre, 0)
    p.wire(pre, 0, ui, 0)
    p.wire(ui, 2, tin, 0)
    return p


def inline_midi(desc, width):
    """A small window shown on the device itself (ScaleView): MIDI through the
    [v8ui], no Show Window."""
    gw, gh = desc.get("window", [200, 100])
    p = Patch()
    mi = p.add("midiin", at=(20, 20), size=(50, 22), outs=1, outtype=["int"])
    dev = p.add("live.thisdevice", at=(120, 20), size=(90, 22), outs=3, outtype=["bang", "int", "int"])
    ui = p.add(maxclass="v8ui", at=(20, 80), size=(gw, gh), ins=1, outs=3, filename=desc["_bundle"],
               parameter_enable=0, border=0, presentation=1, presentation_rect=[0.0, 0.0, float(gw), float(gh)])
    mo = p.add("midiout", at=(20, 420), size=(55, 22), ins=1, outs=0)
    st = p.state(at=(200, 420))
    pre = p.add("prepend restore", at=(200, 460), size=(95, 22), outs=1)
    p.wire(mi, 0, ui, 0); p.wire(dev, 0, ui, 0); p.wire(ui, 0, mo, 0)
    p.wire(ui, 1, st, 0); p.wire(st, 0, pre, 0); p.wire(pre, 0, ui, 0)
    return p


def jsfx_midi(desc, width):
    """A JSFX's own window, in a subpatcher the strip's Show Window opens; its
    code runs whether the window is open or not. The strip has the device's
    buttons and a status line."""
    gw, gh = desc.get("window", [800, 600])
    inner = Patch()
    pc_in = inner.add("inlet", at=(20, 20), size=(30, 30), maxclass="inlet", ins=0, outs=1, comment="window")
    data_in = inner.add("inlet", at=(120, 20), size=(30, 30), maxclass="inlet", ins=0, outs=1, comment="MIDI, bang, restore, actions")
    nout = (5 if desc.get("drops") else 4) if desc.get("_audio") else 3
    ui = inner.add(maxclass="v8ui", at=(120, 80), size=(gw, gh), ins=1, outs=nout, filename=desc["_bundle"],
                   parameter_enable=0, border=0, presentation=1, presentation_rect=[0.0, 0.0, float(gw), float(gh)])
    outs = [inner.add("outlet", at=(120 + 120 * i, 120 + gh), size=(30, 30), maxclass="outlet", ins=1, outs=0) for i in range(nout)]
    k = inner.add("key", at=(320, 20), size=(40, 22), ins=0, outs=4, outtype=["int", "int", "int", "int"])
    kp = inner.add("prepend key", at=(320, 50), size=(75, 22), outs=1)
    inner.wire(k, 0, kp, 0)
    inner.wire(kp, 0, ui, 0)
    inner.wire(data_in, 0, ui, 0)
    for i, o in enumerate(outs):
        inner.wire(ui, i, o, 0)
    sub = {"fileversion": 1, "appversion": {"major": 9, "minor": 0, "revision": 0, "architecture": "x64", "modernui": 1},
           "classnamespace": "box", "rect": [80.0, 80.0, float(gw), float(gh)], "openinpresentation": 1,
           "toolbarvisible": 0, "statusbarvisible": 0, "enablehscroll": 0, "enablevscroll": 0,
           "title": desc["name"], "boxes": inner.boxes, "lines": inner.lines}

    p = Patch()
    mi = p.add("midiin", at=(20, 20), size=(50, 22), outs=1, outtype=["int"])
    dev = p.add("live.thisdevice", at=(120, 20), size=(90, 22), outs=3, outtype=["bang", "int", "int"])
    win = p.add("p window", at=(20, 200), size=(140, 22), ins=2, outs=nout, patcher=sub)
    mo = p.add("midiout", at=(20, 420), size=(55, 22), ins=1, outs=0)
    st = p.state(at=(200, 420))
    pre = p.add("prepend restore", at=(200, 460), size=(95, 22), outs=1)
    status = p.add(maxclass="comment", at=(420, 420), size=(width - 16, 40), ins=1, outs=0, text=desc.get("hello", ""),
                   presentation=1, presentation_rect=[8.0, 8.0, float(width - 16), 40.0], linecount=2,
                   textcolor=[0.867, 0.882, 0.906, 1.0], fontsize=11.0)
    p.wire(mi, 0, win, 1)
    p.wire(dev, 0, win, 1)
    p.wire(win, 0, mo, 0)
    p.wire(win, 1, st, 0)
    p.wire(st, 0, pre, 0)
    p.wire(pre, 0, win, 1)
    p.wire(win, 2, status, 0)
    buttons = [["Show Window", None]] + desc.get("buttons", [])
    for i, (label, act) in enumerate(buttons):
        col, row = i % 2, i // 2
        bx, by = 8 + col * ((width - 24) // 2 + 8), 56 + row * 26
        b = p.add(maxclass="live.text", at=(420 + i * 130, 20), size=(120, 20), ins=1, outs=2, outtype=["", ""],
                  text=label, texton=label, mode=0, parameter_enable=0,
                  presentation=1, presentation_rect=[float(bx), float(by), float((width - 24) // 2), 22.0])
        r = p.add("route bang 1", at=(420 + i * 130, 60), size=(80, 22), outs=3)
        t = p.add("t b", at=(420 + i * 130, 100), size=(30, 22), outs=1, outtype=["bang"])
        p.wire(b, 0, r, 0)
        p.wire(r, 0, t, 0)
        p.wire(r, 1, t, 0)
        if act is None:
            m = p.add(maxclass="message", at=(420 + i * 130, 140), size=(40, 22), text="open", outs=1)
            pc = p.add("pcontrol", at=(420 + i * 130, 180), size=(60, 22), outs=1)
            p.wire(t, 0, m, 0)
            p.wire(m, 0, pc, 0)
            p.wire(pc, 0, win, 0)
        else:
            m = p.add(maxclass="message", at=(420 + i * 130, 140), size=(110, 22), text="action " + act, outs=1)
            p.wire(t, 0, m, 0)
            p.wire(m, 0, win, 1)
    return p


def gen_patcher(code, ins, outs):
    """A gen~ patcher: one codebox between [in N] and [out N]."""
    g = Patch()
    ins_ = [g.add("in %d" % (i + 1), at=(20 + 120 * i, 20), size=(40, 22), ins=0, outs=1) for i in range(max(1, ins))]
    cb = g.add(maxclass="codebox", at=(20, 80), size=(600, 400), ins=max(1, ins), outs=outs, outtype=[""] * outs,
               code=code, fontface=0, fontname="<Monospaced>", fontsize=12.0)
    outs_ = [g.add("out %d" % (i + 1), at=(20 + 120 * i, 520), size=(40, 22), ins=1, outs=0) for i in range(outs)]
    for i, b in enumerate(ins_):
        g.wire(b, 0, cb, i)
    for i, b in enumerate(outs_):
        g.wire(cb, i, b, 0)
    return {"fileversion": 1, "appversion": {"major": 9, "minor": 0, "revision": 0, "architecture": "x64", "modernui": 1},
            "classnamespace": "dsp.gen", "rect": [100.0, 100.0, 700.0, 600.0], "boxes": g.boxes, "lines": g.lines}


def jsfx_audio(desc, width):
    """A JSFX's DSP as gen~ (ableton/kit/jsfx2gen.js), between [plugin~] and
    [plugout~]; its window, in the subpatcher Show Window opens, runs the
    plug-in's own @gfx and sends what its sliders say to gen~."""
    import subprocess
    main = os.path.join(desc["_base"], desc["files"][desc["device"]["main"]])
    tr = json.loads(subprocess.check_output(["node", os.path.join(KIT, "jsfx2gen.js"), main,
                                             str(desc.get("memory", 1048576)), str(desc.get("block", 32)),
                                             ",".join(desc.get("from_window", []))]))
    desc["_gen"] = tr
    p = jsfx_midi(dict(desc, _audio=True), width)
    # jsfx_midi's boxes: midiin, live.thisdevice, p window, midiout, pattr, prepend, comment, buttons...
    win = "obj-3"
    ins, outs = tr["inputs"], tr["outputs"]
    gen = p.add("gen~", at=(20, 300), size=(160, 22), ins=max(1, ins), outs=outs, outtype=["signal"] * outs,
                patcher=gen_patcher(tr["code"], ins, outs))
    po = p.add("plugout~", at=(20, 360), size=(70, 22), ins=2, outs=0)
    for i in range(min(outs, 2)):
        p.wire(gen, i, po, i)
    if ins:
        pi = p.add("plugin~", at=(220, 260), size=(60, 22), ins=1, outs=2, outtype=["signal", "signal"])
        for i in range(min(ins, 2)):
            p.wire(pi, i, gen, i)
    p.wire(win, 3, gen, 0)
    # MIDI for gen~: a buffer~ the window writes, named per device by M4L's ---
    mq = p.add("buffer~ ---mq @samps 1024", at=(420, 300), size=(160, 22), outs=2)
    names = p.add(maxclass="message", at=(420, 260), size=(200, 22), text="mqname ---mq", outs=1)
    bind = p.add(maxclass="message", at=(220, 220), size=(100, 22), text="mq ---mq", outs=1)
    dev = "obj-2"
    p.wire(dev, 0, names, 0)
    p.wire(names, 0, win, 1)
    p.wire(dev, 0, bind, 0)
    p.wire(bind, 0, gen, 0)
    if desc.get("memory") == "buffer":
        # EEL2's memory as a buffer~ the window writes (Buffer M in the gen~ code)
        size = desc.get("buffer_samples", 8388608)
        p.add("buffer~ ---mem @samps %d" % size, at=(620, 300), size=(200, 22), outs=2)
        mn = p.add(maxclass="message", at=(620, 260), size=(140, 22), text="memname ---mem", outs=1)
        mb = p.add(maxclass="message", at=(220, 180), size=(100, 22), text="M ---mem", outs=1)
        p.wire(dev, 0, mn, 0); p.wire(mn, 0, win, 1)
        p.wire(dev, 0, mb, 0); p.wire(mb, 0, gen, 0)
    # Sounds dropped on the strip: a buffer~ each, which decodes them; the window reads it
    drops = desc.get("drops", [])
    if drops:
        rt = p.add("route " + " ".join(d[1] for d in drops), at=(820, 200), size=(120, 22), outs=len(drops) + 1)
        p.wire(win, 4, rt, 0)
    for i, (label, key) in enumerate(drops):
        bx = 8 + i * ((width - 24) // 2 + 8)
        drop = p.add(maxclass="live.drop", at=(820 + 140 * i, 20), size=(120, 40), ins=1, outs=2, outtype=["", ""],
                     parameter_enable=0, presentation=1,
                     presentation_rect=[float(bx), 108.0, float((width - 24) // 2), 52.0])
        lab = p.add(maxclass="comment", at=(820 + 140 * i, 0), size=(120, 20), ins=1, outs=0, text=label,
                    presentation=1, presentation_rect=[float(bx), 90.0, float((width - 24) // 2), 18.0],
                    textcolor=[0.867, 0.882, 0.906, 1.0], fontsize=10.0)
        dp = p.add("prepend drop " + key, at=(820 + 140 * i, 70), size=(110, 22), outs=1)
        p.wire(drop, 0, dp, 0); p.wire(dp, 0, win, 1)
        buf = p.add("buffer~ ---src" + key, at=(820 + 140 * i, 260), size=(120, 22), outs=2)
        p.wire(rt, i, buf, 0)
        done = p.add("t b", at=(820 + 140 * i, 300), size=(30, 22), outs=1, outtype=["bang"])
        msg = p.add(maxclass="message", at=(820 + 140 * i, 340), size=(110, 22), text="loaded " + key, outs=1)
        p.wire(buf, 1, done, 0); p.wire(done, 0, msg, 0); p.wire(msg, 0, win, 1)
        nm = p.add(maxclass="message", at=(820 + 140 * i, 380), size=(140, 22), text="srcname %s ---src%s" % (key, key), outs=1)
        p.wire(dev, 0, nm, 0); p.wire(nm, 0, win, 1)
    return p


TEMPLATES = {"midi_effect": midi_effect, "jsfx_midi": jsfx_midi, "jsfx_audio": jsfx_audio, "inline_midi": inline_midi,
             "midi_tool": midi_tool}


def amxd(kind, patcher):
    data = json.dumps(patcher, indent=1, sort_keys=False).encode("utf-8") + b"\n\x00"
    return (b"ampf" + struct.pack("<I", 4) + TYPES[kind] +
            b"meta" + struct.pack("<I", 4) + b"\x00\x00\x00\x00" +
            b"ptch" + struct.pack("<I", len(data)) + data)


def build(desc_path, check=False):
    desc_path = os.path.abspath(desc_path)
    base = os.path.dirname(desc_path)
    with open(desc_path, encoding="utf-8") as f:
        desc = json.load(f)
    desc["_path"] = desc_path
    slug = desc.get("slug") or desc["name"].replace(" ", "")
    desc["_bundle"] = slug + ".js"
    width = desc.get("width", 860)
    if desc.get("template") == "inline_midi":
        width = desc.get("window", [200, 100])[0]
    if desc.get("template") == "midi_tool":
        desc.setdefault("window", TOOL_WINDOW)
        width = desc["window"][0]
    desc["_base"] = base
    if desc.get("template") in ("jsfx_midi", "jsfx_audio") and "window" not in desc:
        import re
        main = desc["files"][desc["device"]["main"]]
        m = re.search(rb"^@gfx\s+(\d+)\s+(\d+)", read(os.path.join(base, main)), re.M)
        desc["window"] = [int(m.group(1)), int(m.group(2))] if m else [800, 600]
    built = TEMPLATES[desc.get("template", "midi_effect")](desc, width)
    kind = desc.get("kind", "midi")
    patch = built.tool_json(desc, width, kind) if desc.get("template") == "midi_tool" else built.json(desc, width)
    written, stale = [], []
    for name, data in ((desc["_bundle"], bundle(desc, base).encode("utf-8")),
                       (slug + ".maxpat", (json.dumps(patch, indent=1) + "\n").encode("utf-8")),
                       (desc["name"] + ".amxd", amxd(kind, patch))):
        path = os.path.join(base, name)
        if check:
            if not os.path.exists(path) or read(path) != data:
                stale.append(os.path.relpath(path))
            continue
        with open(path, "wb") as f:
            f.write(data)
        written.append(os.path.relpath(path))
    return stale if check else written


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if a != "--check"]
    if len(args) != 1:
        sys.exit("usage: build.py [--check] ableton/device.json")
    if "--check" in sys.argv:
        stale = build(args[0], check=True)
        for s in stale:
            print("STALE - rebuild: " + s)
        sys.exit(1 if stale else 0)
    for w in build(args[0]):
        print(w)
