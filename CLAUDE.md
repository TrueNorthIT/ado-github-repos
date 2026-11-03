# GitHub Repos for Azure DevOps

## UI rule: azure-devops-ui first

The extension must look native to Azure DevOps, and native ADO is built from the azure-devops-ui (`bolt-*`) components.

- Build every piece of UI from azure-devops-ui components: Header, TabBar/Tab/TabBadge, Card (including `collapsible`), Table with SimpleTableCell/TwoLineTableCell, Tree, MasterPanel, Splitter, Status, Pill, Button/MenuButton/MoreButton, Link, Icon, Dropdown, TextField, Checkbox, Panel, Dialog, MessageCard, ZeroData, VssPersona, and so on.
- If nothing matches exactly, use the closest component and adapt it with its props or a `className`.
- Hand-roll markup (raw `button`, `table`, `ul`, `details`, `dl`, custom tab-like labels) only when no component can do the job. Each time, say what was hand-rolled and why, in the commit message and in your report.
- Match native spacing by measuring a native page with `getComputedStyle`, not by eye.

Hand-rolled CSS put the 0.3.0 redesign, and later the first Actions run and log pages, in the uncanny valley.
