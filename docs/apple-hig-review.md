# Review against Apple's Human Interface Guidelines: Foundations

Midi Variator checked against all 19 Foundations pages (the user's copy,
October 2026), the same review Transient Shuffler had. Writing was done
first, on its own ([0014](decisions/0014-window-text-follows-apples-writing-guidelines.md));
this covers the rest ([0015](decisions/0015-apples-hig-foundations.md)).

The window is drawn by ReaImGui inside REAPER, so some guidance cannot apply:
a script cannot reach VoiceOver, Dynamic Type or Increase Contrast, or read the
system's appearance. Where a guideline is not met for that reason, this says
so rather than counting it as met.

## What changed (1.4)

| Guideline | Before | Now |
| --- | --- | --- |
| **Accessibility: the keyboard alone** | Mouse only. | Keyboard navigation is on: Tab and the arrow keys move between controls, Space or Return presses one, and a near-white ring shows where you are. |
| **Accessibility, Typography: larger text** | One fixed size. | **View → Text Size**: 100%, 125%, 150% or 200%, also Cmd+= and Cmd+- (Ctrl on Windows), Cmd+0 for 100%. Remembered between runs. Buttons grow with the text and rows wrap at the window's edge. |
| **Typography: default size** | ReaImGui's own font. | The system's sans-serif at 13 points, the Mac's default text size. |
| **Accessibility: control size and spacing** | Buttons 19 points tall, 8 apart. | 28 points tall (Apple's Mac default) with 12 between them. |
| **Accessibility, Dark Mode: contrast** | Secondary text 4.7:1, warnings 3.4:1. | Every line of text is at least 7:1, the target for small text in a dark window: secondary text `#B0B6C0` (7.4:1), warnings `#FF9E96` (7.6:1). The house red is no longer used for words. |
| **Accessibility, Color: more than colour alone** | A chosen button was shown only by being yellow. | It also has a dark bar under its label. |
| **Layout: nothing important at the bottom of a window** | The message line came last, at the bottom. | It sits at the top, above step 1. |
| **Accessibility: avoid time-boxed elements** | (Messages stayed, but could not be cleared.) | A message stays until **Dismiss**, or a newer one replaces it. |

## Already met

- **Design principles.** One job, steps in reading order, only step 1 until something is read, no dead controls. Make, Vary Selected in Place and Put Back are each one REAPER undo step; unticking a change takes out only that change; the original is kept inside every variation and can always be put back.
- **Feedback.** Controls change on hover and press; the roll shows the original grey and the variation yellow; the playhead moves while auditioning; Audition turns into Stop.
- **Playback you control.** Nothing plays until Audition is clicked, and Stop (or REAPER's own stop) ends it.
- **Colour.** One yellow: *on* for a switch or choice, *what would be different* in the roll. The original's notes are grey and differ in lightness too (3.96:1 against 15:1 on the roll's ground).
- **Motion.** Nothing animates except the playhead, which follows playback.
- **Dark Mode.** Always dark. Apple allows this for apps built around media,
  and advises against an app-only appearance setting; it is also the house
  scheme.
- **Writing.** Decision 0014.
- **Privacy.** Nothing is collected or sent. Only preferences are saved, in REAPER's own settings.
- **Inclusion.** Plain musical words; the tooltips explain each choice.

## Not met, because a ReaImGui script can't

- **VoiceOver, Voice Control and Switch Control** cannot read a ReaImGui
  window.
- **Dynamic Type and Increase Contrast** cannot be read from a script. Text
  Size and the 7:1 colours stand in for them.
- **Right to left.** The window is English only; time runs left to right, as in
  every DAW.

## Not relevant

Materials (Liquid Glass), app icons, icons and SF Symbols, images, spatial
layout and immersive experiences: the window has none of these.

## Unverified in REAPER

- Whether REAPER hands Cmd+=, Cmd+- and Cmd+0 to the window (the View menu
  does the same either way).
- Which face "sans-serif" gives on each system (Helvetica or San Francisco on
  a Mac, Segoe UI or Arial on Windows).

## Checked by

`tests/test_ui.lua` with `tests/hig_mock.lua`: keyboard navigation on and its ring not the accent; 13-point text, 28-point controls, 12 points apart; every line of text 7:1 on the ground and every button's ink 7:1 on its fill; a bar on every chosen button; the warning above everything else, still there twenty frames later, gone on Dismiss; the View menu's sizes, the keys, every button wide enough for its label at 200%, the size saved, clamped and restored. Each was broken on purpose and the suite failed.
