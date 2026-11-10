{
 "patcher": {
  "fileversion": 1,
  "appversion": {
   "major": 9,
   "minor": 0,
   "revision": 0,
   "architecture": "x64",
   "modernui": 1
  },
  "classnamespace": "box",
  "rect": [
   100.0,
   100.0,
   960.0,
   560.0
  ],
  "openinpresentation": 1,
  "default_fontsize": 10.0,
  "default_fontface": 0,
  "default_fontname": "Arial",
  "gridonopen": 1,
  "gridsize": [
   8.0,
   8.0
  ],
  "gridsnaponopen": 1,
  "objectsnaponopen": 1,
  "statusbarvisible": 2,
  "toolbarvisible": 1,
  "boxes": [
   {
    "box": {
     "id": "obj-1",
     "maxclass": "newobj",
     "numinlets": 1,
     "numoutlets": 1,
     "patching_rect": [
      20.0,
      20.0,
      50.0,
      22.0
     ],
     "outlettype": [
      "int"
     ],
     "text": "midiin"
    }
   },
   {
    "box": {
     "id": "obj-2",
     "maxclass": "newobj",
     "numinlets": 1,
     "numoutlets": 0,
     "patching_rect": [
      20.0,
      420.0,
      55.0,
      22.0
     ],
     "text": "midiout"
    }
   },
   {
    "box": {
     "id": "obj-3",
     "maxclass": "newobj",
     "numinlets": 1,
     "numoutlets": 3,
     "patching_rect": [
      120.0,
      20.0,
      90.0,
      22.0
     ],
     "outlettype": [
      "bang",
      "int",
      "int"
     ],
     "text": "live.thisdevice"
    }
   },
   {
    "box": {
     "id": "obj-4",
     "maxclass": "v8ui",
     "numinlets": 1,
     "numoutlets": 2,
     "patching_rect": [
      20.0,
      200.0,
      860.0,
      169.0
     ],
     "outlettype": [
      "",
      ""
     ],
     "filename": "MidiVariator.js",
     "parameter_enable": 0,
     "border": 0,
     "presentation": 1,
     "presentation_rect": [
      0.0,
      0.0,
      860.0,
      169.0
     ]
    }
   },
   {
    "box": {
     "id": "obj-5",
     "maxclass": "newobj",
     "numinlets": 1,
     "numoutlets": 3,
     "patching_rect": [
      420.0,
      420.0,
      80.0,
      22.0
     ],
     "outlettype": [
      "",
      "",
      ""
     ],
     "text": "pattr state",
     "parameter_enable": 1,
     "varname": "state",
     "saved_attribute_attributes": {
      "valueof": {
       "parameter_longname": "state",
       "parameter_shortname": "state",
       "parameter_type": 3,
       "parameter_invisible": 1,
       "parameter_initial_enable": 0
      }
     }
    }
   },
   {
    "box": {
     "id": "obj-6",
     "maxclass": "newobj",
     "numinlets": 1,
     "numoutlets": 1,
     "patching_rect": [
      420.0,
      460.0,
      95.0,
      22.0
     ],
     "outlettype": [
      ""
     ],
     "text": "prepend restore"
    }
   }
  ],
  "lines": [
   {
    "patchline": {
     "source": [
      "obj-1",
      0
     ],
     "destination": [
      "obj-2",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "obj-3",
      0
     ],
     "destination": [
      "obj-4",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "obj-4",
      0
     ],
     "destination": [
      "obj-2",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "obj-4",
      1
     ],
     "destination": [
      "obj-5",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "obj-5",
      0
     ],
     "destination": [
      "obj-6",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "obj-6",
      0
     ],
     "destination": [
      "obj-4",
      0
     ]
    }
   }
  ],
  "parameters": {
   "obj-5": [
    "state",
    "state",
    0
   ],
   "inherited_shortname": 1
  },
  "dependency_cache": [
   {
    "name": "MidiVariator.js",
    "bootpath": ".",
    "type": "TEXT",
    "implicit": 1
   }
  ],
  "autosave": 0,
  "devicewidth": 860.0,
  "description": "",
  "digest": "",
  "tags": "",
  "style": "",
  "latency": 0,
  "is_mpe": 0
 }
}
