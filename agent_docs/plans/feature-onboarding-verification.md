# Manual Verification: Onboarding phase 1 — the Drive tour

## Prerequisites
- [ ] A build of `feature/onboarding` running (`cargo dev`, or the e2e image).
- [ ] A browser that is not under automation (a normal Chrome window, not one Playwright opened).

## Steps to Verify

### Happy path
1. Register a new account and sign in. The "Set up encryption" dialog appears.
2. Create the key and finish the recovery kit dialog.
3. About half a second later the Drive tour appears: the page dims, the New button is ringed, and a
   card beside it reads "Drive tour", "1 of 6", "Create anything from here". Back is disabled and
   Next has focus.
4. Press Next (or →) through Quick access, Quick filters, Display mode, the top-right group and the
   storage meter. The spotlight moves to each; the count reads 2 of 6 … 6 of 6; the last button is Done.
5. Press Done. Reload. The tour does not come back.
6. Open the account menu (classic: your name, top right; other looks: the avatar). Choose
   "Take the Drive tour". It starts again at 1 of 6.

### Edge cases
1. **Skip and Esc:** on a fresh account, press Skip tour (or Esc) at step 1. Reload: no tour.
2. **Other device:** after finishing on one browser, sign in on another. No tour.
3. **Collapsed sidebar:** collapse the sidebar, replay. The storage step is left out: "1 of 5".
4. **Phone width (≤ 768 px):** replay. Steps in the off-canvas sidebar are left out and the count
   matches what is shown.
5. **Replay from elsewhere:** from Recent or Settings, "Take the Drive tour" goes to My Drive first,
   then starts.
6. **Palette:** ⌘K, "Take the tour of this app" replays it.
7. **Looks and themes:** repeat step 3 of the happy path in Classic, Light Flow, Quiet Precision and
   Blended, light and dark. The card uses the look's dialog surface and the accent ring is visible.
8. **Editors:** open a document. The account menu in the title bar has no tour entry (phase 2).
9. **Resize:** resize the window mid-tour. The spotlight and card follow the target.

## Expected Results
- The tour never appears over the encryption dialog or any other modal.
- `GET /api/v1/preferences` shows `"onboarding.toursSeen": ["drive"]` after Done or Skip, not before.
- Keyboard: focus is in the card; Tab cycles its buttons; ← → Enter and Esc work; focus returns to
  where it was when the tour ends.

## Cleanup
- To see the tour again on the same account, `PATCH /api/v1/preferences` with
  `{"values": {"onboarding.toursSeen": []}}`, or replay it from the account menu.
