/* The MIDI Tool (Transform panel), run in Node on a pretend Max.
 *   node --test ableton/tests/
 * Build first: python3 ableton/kit/build.py ableton/tool/tool.json */
'use strict';
const path = require('node:path');
require('../kit/test/tool_suite.js')({ dir: path.join(__dirname, '..', 'tool'), name: 'Midi Variator', kind: 'transformation',
                                        inKey: false, beside: false });
