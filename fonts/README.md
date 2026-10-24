# Fonts

- `greciliae.ttf`: Greciliae, the default chant font of [Gregorio](https://gregorio-project.github.io/), version
  6.2.0, built unchanged from Gregorio's sources (`fonts/greciliae-base.sfd`) with Gregorio's own scripts: see
  `tools/build-greciliae.sh`. SIL Open Font License 1.1, with the Reserved Font Names "Caeciliae" and "Greciliae":
  see `OFL-greciliae.txt`. It is not changed here (not subset or converted), so it keeps its name.

`js/greciliae.js` lists the font's glyphs by name, with the character each is drawn with and its width. It is made
from the font by the same script and must be made again whenever the font changes: Gregorio's versions differ in
their glyphs and in the characters they are given.
