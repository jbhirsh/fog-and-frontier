<!-- What changes and why. Link the issue: "Closes #123". -->

## Visual changes

<!--
UI changes need before/after visuals; the "PR visuals" check fails without
them.

Stills are the visual baselines this PR changes: the check keeps a "Visual
changes" comment with each changed state, phone and desktop, before → after.
Update the baselines with the UI (run "Update visual baselines" on this
branch, then push again). A state no baseline shows gets a visual scenario
first (tests/visual/), so its picture guards the change from then on.

Motion (drag, animation, opening and closing, scrolling, a multi-step flow)
gets a GIF: change or add a scenario in scripts/gif-scenarios/ and push. The
"PR GIFs" workflow records main and this branch against production's catalog
and photos, with the pointer and keys drawn in, and adds the GIFs at the end
of this description, labelled "GIF:"; each later push records them again in
place (a failed one keeps the last GIFs, marked "Not updated"). Keep the
scenario on the branch: once the PR no longer changes it, its GIFs are
dropped. Running "PR GIFs" by hand, with this PR's number and a scenario's
path, is the fallback: for a scenario this PR doesn't change, side by side, a
failed recording, or a fork's PR, which is never attached on its own. A
scenario whose header asks for build variables of its own (the sign-in ones)
can't get them in Actions: record it with `npm run gif` and drag its GIFs in,
alt text "GIF: …".

Only a still of a screen outside the app (Google's or Apple's sign-in page) is dragged
into this editor by hand, with alt text saying why:
![No test draws: Apple's sign-in page](https://github.com/user-attachments/assets/…)
-->

- [ ] No visible UI change

## Validation

<!-- What you ran (lint, tsc -b, test:coverage, build) and the tests you added. -->
