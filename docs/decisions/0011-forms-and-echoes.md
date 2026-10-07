# 0011. Motif memory is a form for the batch; an echo is the same changes played afresh

Taken 2026-10-07. Stands. 0003 holds: every variation, echoes included,
is made from the original.

## Context

Asked for: a "motif memory" so variations can echo each other - an
A A' A A'' form.

## Decision

**A Form** (`M.FORMS`) says which variation plays at each place after the
original: 0 is home - the original again, played afresh (no changes, only
the feel); 1, 2, 3 are the batch's own variations, A', A'', A'''. Four
forms: All new (as before), Home between (A' A A'' A), In pairs (A' A'
A'' A''), A refrain (A' A'' A' A''').

**An echo** is made from its original's seed and with the series memory as
its original found it (a copy), so it has exactly the same changes; its
feel draws from its own seed (`feelSeed`), the way a player never plays a
phrase twice alike. Echoes and homes add nothing to the memory.

**Shown only with more than one variation**, with the batch's letters
beside it.

## Alternatives

**Echo the notes of an earlier variation exactly**, feel and all. A
mechanical repeat - the point of an echo in performance is that it is
played again. Rejected.

**A free "echo chance".** Unpredictable form; the musician asked for named
shapes. Rejected.
