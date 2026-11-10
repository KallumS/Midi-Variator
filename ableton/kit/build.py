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
TYPES = {"midi": b"mmmm", "audio": b"aaaa", "instrument": b"iiii"}
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


def window(p, desc, width, ins=1, outs=2):
    return p.add(maxclass="v8ui", at=(20, 200), size=(width, HEIGHT), ins=ins, outs=outs,
                 filename=desc["_bundle"], parameter_enable=0, border=0,
                 presentation=1, presentation_rect=[0.0, 0.0, float(width), float(HEIGHT)])


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


TEMPLATES = {"midi_effect": midi_effect}


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
    patch = TEMPLATES[desc.get("template", "midi_effect")](desc, width).json(desc, width)
    written, stale = [], []
    for name, data in ((desc["_bundle"], bundle(desc, base).encode("utf-8")),
                       (slug + ".maxpat", (json.dumps(patch, indent=1) + "\n").encode("utf-8")),
                       (desc["name"] + ".amxd", amxd(desc.get("kind", "midi"), patch))):
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
