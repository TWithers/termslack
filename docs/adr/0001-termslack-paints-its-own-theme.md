# termslack paints the whole screen with its own theme

termslack sets every background and text colour itself from one built-in theme (in the style of Slack's dark mode) instead of drawing on the terminal's own colours. Mouse hover needed a background a small step from the real background, and termslack can't otherwise know it: we considered asking the terminal with OSC 11 at startup (and again on focus), but not every terminal answers, tmux may answer for itself, and a theme switch mid-run goes unnoticed. Owning the colours removes the guesswork and makes a light theme, a theme file and a switcher a matter of supplying different colours later.

## Consequences

- termslack no longer follows the terminal's theme; a user with a light terminal sees termslack's dark theme until a light theme exists.
- Every colour in the UI, message content included (people's name colours, links, code, mention highlights), comes from the theme; a hard-coded colour is a bug.
- Colours are exact RGB values; terminals limited to 256 colours get the nearest match, which can merge subtle shades such as hover against background.
