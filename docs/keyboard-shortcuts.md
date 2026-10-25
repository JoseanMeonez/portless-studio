# Keyboard shortcuts

Every action in the page has a key. Press `?` in the page for this list, or `Ctrl+K` (`Cmd+K` on
macOS) to run any action by name. Keys that act on a route need a selected row.

| Keys | Action |
| --- | --- |
| `j` / `↓`, `k` / `↑` | Next and previous row |
| `Home`, `End` | First and last row |
| `/` | Search routes |
| `Enter` or `o` | Open the selected route |
| `c` | Copy its URL |
| `r` | Rename an alias |
| `Delete` or `Backspace` | Remove an alias |
| `f` | Pin or unpin as favorite |
| `.` or `Shift+F10` | Open with, copy path and more |
| `t` | Open a terminal in its folder; in the right pane, selecting a row shows its terminal |
| `n` | Name a port |
| `v` / `Shift+V` | Next view / open the view menu |
| `Shift+F` | Open the filters |
| `[`, `]` | Collapse or expand all groups |
| `Ctrl+K` / `Cmd+K` | Command menu |
| `,` | Settings |
| `?` | All keyboard shortcuts |
| `Esc` | Close a dialog or cancel |

## In the terminal panel

These work while the panel has focus, the terminal screen included. The `?` sheet and the
command menu list them under Terminal.

| Keys | What it does |
| --- | --- |
| `Ctrl+B` / `Cmd+B` | Toggle terminal list: hide it (a dropdown picks the terminal) or show it |
| `Ctrl+Shift+F` | Full screen terminal, on or off |
| `Esc` | Leave full screen, from the list or the header (in the terminal screen it goes to the program) |
| `↓`, `↑` | Next and previous card, while a card in the list has focus |
| `Enter` | Put the keyboard in the terminal of the focused card |
| `F2` | Rename the active terminal |
| `Ctrl+PageDown` / `Ctrl+PageUp` | Next or previous terminal, in the order the list shows them |
| `Ctrl+Shift+W` | Close the active terminal, stopping its command |
| `←`, `→`, `↑`, `↓`, `Home`, `End` | Resize the panel or the list while its edge has focus; double-click the edge to reset |

`Ctrl+B` is also the readline key for "back one character" and the default tmux prefix; inside
Studio's terminal area the page keeps it, so use the left arrow key, or another tmux prefix, there.

Browsers may keep `Ctrl+PageUp`, `Ctrl+PageDown` and `Ctrl+Shift+W` for their own tabs and
windows, so in a normal browser tab the page may never see them; they reach Studio when it runs
as an installed app window. The list and the dropdown work with the mouse and Tab either way.
